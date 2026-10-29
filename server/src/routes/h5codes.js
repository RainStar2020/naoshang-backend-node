/**
 * 激活码发放与库存（2026-10-24 用户拍板：最后一个先做，直接交前端接口）
 *
 * 业务背景（产品截图规则）：
 *   - 粉丝会员 FS：线下门店缴费 19.9，门店给激活码激活；
 *   - 1阶菁英 JY：线下门店缴费 3990，门店给激活码激活；
 *   - 1阶超级 CJ：家长开通 9980 VIP 合伙人后，上级赠送激活码；
 *   - 2阶行能 XN / 3阶羿烁 YS：家长开通 29800 / 69800 天使合伙人后，上级赠送激活码。
 *
 * 本模块实现「发码 → 绑码 → 核销 → 台账」闭环：
 *   ① 总部批量发码（admin）：任意类型，可绑门店/绑家长；
 *   ② 门店收款发码（agency：区域代理身份）：仅 fs/jy，码归属门店区域码，散客可用；
 *   ③ 上级赠码（partner：upline 给直属下级家长）：仅 cj/xn/ys，码绑定该家长（仅其可用）；
 *   ④ 核销：激活即核销（h5biz /activations 消费码 + 校验绑定 + 记台账）；
 *   ⑤ 作废（admin）/ 查询 / 统计。
 *
 * 激活码记录字段（db.activationCodes，在原契约字段上扩展）：
 *   code/targetType/targetId/maxUses/uses/status/expiresAt/usedBy（原有）
 *   + channel（admin|store|upline）/ storeId / issuedBy / issuedTo（绑定家长）/ batchId / note / createdAt
 *
 * 运行：由 routes/h5.js 在 h5biz 之后委托（返回 false 表示未命中）。
 */

const TIER_RANK = { none: 0, vip: 1, angel: 2, private: 3, cofounder: 4 };

/** 门店可发放的会员等级码（线下收款场景） */
const STORE_TYPES = ['fs', 'jy'];
/** 上级可赠送的会员等级码（截图规则：cj/xn/ys 为上级赠送） */
const GIFT_TYPES = ['cj', 'xn', 'ys'];
/** 会员等级码 → 激活时要求的家长档位（与 identity.MEMBER_TIER_MIN_TIER_SCORE 一致） */
const MIN_TIER_RANK = { fs: 0, jy: 0, cj: 1, xn: 2, ys: 2 };

const nowMs = () => Date.now();
const rid = (p) => p + Math.random().toString(36).slice(2, 10);

/** 生成不重复激活码：NS-<TYPE>-<6位随机> */
function genCode(db, targetType) {
  const T = String(targetType).toUpperCase();
  for (let i = 0; i < 50; i++) {
    const c = 'NS-' + T + '-' + Math.random().toString(36).slice(2, 8).toUpperCase();
    if (!db.activationCodes.some((x) => x.code === c)) return c;
  }
  return 'NS-' + T + '-' + Date.now().toString(36).toUpperCase();
}

/** 统一发码（内部）：admin/store/upline 三渠道共用 */
function issue(db, { targetType, targetId = null, count = 1, channel, issuedBy, storeId = null, issuedTo = null, expiresInDays = 90, note = '', batchId = null }) {
  db.activationCodes = db.activationCodes || [];
  const n = Math.min(Math.max(parseInt(count, 10) || 1, 1), 100);
  const exp = nowMs() + Math.max(1, parseInt(expiresInDays, 10) || 90) * 86400000;
  const batch = batchId || rid('batch_');
  const out = [];
  for (let i = 0; i < n; i++) {
    const rec = {
      code: genCode(db, targetType), targetType, targetId,
      maxUses: 1, uses: 0, status: 'active', expiresAt: exp, usedBy: [],
      channel, issuedBy, storeId, issuedTo, batchId: batch, note: note || null, createdAt: nowMs(),
    };
    db.activationCodes.push(rec);
    out.push(rec);
  }
  return { batchId: batch, codes: out.map((r) => r.code), records: out };
}

/** 对外视图 */
function publicCode(r) {
  return {
    code: r.code, targetType: r.targetType, targetId: r.targetId || null,
    status: r.status, uses: r.uses, maxUses: r.maxUses,
    expiresAt: r.expiresAt ? new Date(r.expiresAt).toISOString() : null,
    channel: r.channel || null, storeId: r.storeId || null,
    issuedBy: r.issuedBy || null, issuedTo: r.issuedTo || null,
    batchId: r.batchId || null, note: r.note || null,
    usedBy: (r.usedBy || []).map((u) => ({ memberId: u.memberId, at: u.at ? new Date(u.at).toISOString() : null, channel: u.channel || null })),
    createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : null,
  };
}

const VALID_TYPES = ['level', 'column', 'fs', 'jy', 'cj', 'xn', 'ys', 'member'];

async function handle(db, req, res, url, ctx) {
  const { sess, ok, fail, save, q, readBody, resolveContext } = ctx;
  const p = url.pathname;
  const m = req.method;

  // ───────────────── ① 总部批量发码 / 查询 / 作废（admin） ─────────────────
  if (p === '/admin/activation-codes' && m === 'POST') {
    if (!sess || sess.role !== 'admin') return fail(403, '仅总部可批量发码');
    const b = await readBody(req);
    if (!b.targetType || !VALID_TYPES.includes(b.targetType)) return fail(400, 'targetType 非法（level/column/fs/jy/cj/xn/ys）');
    if (b.targetType === 'level' && !b.targetId) return fail(400, 'level 类型必须指定 targetId');
    if (b.issuedTo && !db.users[b.issuedTo]) return fail(404, '绑定家长不存在');
    const r = issue(db, {
      targetType: b.targetType, targetId: b.targetId || null, count: b.count || 1,
      channel: 'admin', issuedBy: 'admin', storeId: b.storeId || null, issuedTo: b.issuedTo || null,
      expiresInDays: b.expiresInDays, note: b.note,
    });
    save();
    return ok(200, { batchId: r.batchId, codes: r.codes, records: r.records.map(publicCode) });
  }
  if (p === '/admin/activation-codes' && m === 'GET') {
    if (!sess || sess.role !== 'admin') return fail(403, '仅总部可查询激活码');
    const st = q('status'), tt = q('targetType'), ch = q('channel'), storeId = q('storeId');
    let items = (db.activationCodes || []).slice();
    if (st) items = items.filter((r) => r.status === st);
    if (tt) items = items.filter((r) => r.targetType === tt);
    if (ch) items = items.filter((r) => r.channel === ch);
    if (storeId) items = items.filter((r) => r.storeId === storeId);
    items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const all = db.activationCodes || [];
    const stats = {
      total: all.length,
      active: all.filter((r) => r.status === 'active' && (!r.expiresAt || r.expiresAt >= nowMs())).length,
      used: all.filter((r) => r.uses >= r.maxUses).length,
      void: all.filter((r) => r.status === 'void').length,
      expired: all.filter((r) => r.status === 'active' && r.expiresAt && r.expiresAt < nowMs()).length,
    };
    return ok(200, { items: items.map(publicCode), stats, hasMore: false, nextCursor: null });
  }
  if (p.startsWith('/admin/activation-codes/') && p.endsWith('/void') && m === 'POST') {
    if (!sess || sess.role !== 'admin') return fail(403, '仅总部可作废激活码');
    const code = decodeURIComponent(p.slice('/admin/activation-codes/'.length, p.length - '/void'.length)).toUpperCase();
    const rec = (db.activationCodes || []).find((r) => r.code === code);
    if (!rec) return fail(404, '激活码不存在');
    if (rec.uses >= rec.maxUses) return fail(400, '该码已核销，不能作废');
    rec.status = 'void'; rec.voidedAt = nowMs(); rec.voidedBy = 'admin';
    save();
    return ok(200, { code: rec.code, status: 'void' });
  }

  // ───────────────── ② 门店收款发码（agency：区域代理身份） ─────────────────
  if (p === '/agency/activation-codes' && m === 'POST') {
    if (!sess || sess.role !== 'user') return fail(401, '未登录');
    const b = await readBody(req);
    const cid = b.contextId;
    if (!cid) return fail(400, 'contextId 必填');
    const { userId } = resolveContext(cid);
    const agent = (db.regionalAgents || []).find((a) => a.partner_id === userId);
    if (!agent) return fail(403, '该上下文不是区域代理（门店/区县/市/省代）');
    if (!STORE_TYPES.includes(b.targetType)) return fail(400, '门店仅可发放粉丝/菁英激活码（fs/jy）');
    const r = issue(db, {
      targetType: b.targetType, count: b.count || 1,
      channel: 'store', issuedBy: userId, storeId: agent.region_code || agent.id,
      note: b.note || ('门店收款发码（' + agent.region_type + '）'),
    });
    save();
    return ok(200, { batchId: r.batchId, codes: r.codes, storeId: agent.region_code || agent.id, records: r.records.map(publicCode) });
  }
  if (p === '/agency/activation-codes' && m === 'GET') {
    if (!sess || sess.role !== 'user') return fail(401, '未登录');
    const cid = q('contextId');
    if (!cid) return fail(400, 'contextId 必填');
    const { userId } = resolveContext(cid);
    const agent = (db.regionalAgents || []).find((a) => a.partner_id === userId);
    if (!agent) return fail(403, '该上下文不是区域代理');
    const items = (db.activationCodes || []).filter((r) => r.channel === 'store' && r.issuedBy === userId)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return ok(200, { items: items.map(publicCode), storeId: agent.region_code || agent.id, hasMore: false, nextCursor: null });
  }

  // ───────────────── ③ 上级赠码（partner：upline → 直属下级家长） ─────────────────
  if (p === '/partner/gift-codes' && m === 'POST') {
    if (!sess || sess.role !== 'user') return fail(401, '未登录');
    const b = await readBody(req);
    const cid = b.contextId;
    if (!cid) return fail(400, 'contextId 必填');
    const { userId: gifterId } = resolveContext(cid);
    if (gifterId !== sess.userId) return fail(403, '仅可以本人（上级）身份赠码');
    if (!GIFT_TYPES.includes(b.targetType)) return fail(400, '上级仅可赠送 cj/xn/ys 激活码（粉丝/菁英请走门店收款）');
    const toUserId = b.toUserId || (b.toPhone ? (Object.values(db.users).find((u) => u.phone === b.toPhone) || {}).id : null);
    const target = toUserId ? db.users[toUserId] : null;
    if (!target) return fail(404, '受赠家长不存在（toUserId/toPhone）');
    if (target.upline_id !== gifterId) return fail(403, '仅可给直属下级家长赠码');
    if ((TIER_RANK[target.tier] || 0) < (MIN_TIER_RANK[b.targetType] || 0)) {
      const need = { cj: 'VIP 合伙人', xn: '天使合伙人', ys: '天使合伙人' }[b.targetType];
      return fail(403, '受赠家长需先成为' + need + '才能激活该等级');
    }
    const r = issue(db, {
      targetType: b.targetType, count: b.count || 1,
      channel: 'upline', issuedBy: gifterId, issuedTo: toUserId,
      note: b.note || ('上级赠码：' + gifterId + ' → ' + toUserId),
    });
    save();
    return ok(200, { batchId: r.batchId, codes: r.codes, issuedTo: toUserId, records: r.records.map(publicCode) });
  }
  if (p === '/partner/gift-codes' && m === 'GET') {
    if (!sess || sess.role !== 'user') return fail(401, '未登录');
    const cid = q('contextId');
    if (!cid) return fail(400, 'contextId 必填');
    const { userId: gifterId } = resolveContext(cid);
    if (gifterId !== sess.userId) return fail(403, '仅可查看本人赠码记录');
    const items = (db.activationCodes || []).filter((r) => r.channel === 'upline' && r.issuedBy === gifterId)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return ok(200, { items: items.map(publicCode), hasMore: false, nextCursor: null });
  }

  // ───────────────── ④ 我的激活码（家长查看绑定自己的赠码） ─────────────────
  if (p === '/me/activation-codes' && m === 'GET') {
    if (!sess || sess.role !== 'user') return fail(401, '未登录');
    const items = (db.activationCodes || []).filter((r) => r.issuedTo === sess.userId)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return ok(200, { items: items.map(publicCode), hasMore: false, nextCursor: null });
  }

  return false; // 未命中
}

module.exports = { handle, issue, genCode, publicCode, STORE_TYPES, GIFT_TYPES };

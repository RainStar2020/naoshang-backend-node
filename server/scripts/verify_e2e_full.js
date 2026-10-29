#!/usr/bin/env node
/**
 * 脑商AI · 全链路端到端验收（**前端视角**）
 *
 * 目的：按小程序真实调用顺序把整个产品跑一遍，确认「前后端契约对齐 + 功能可用」。
 *
 * 与其它 verify_*.js 的区别：
 *   - 那些脚本各自验证一块业务规则；本脚本**站在前端角度**，
 *     对每个前端实际会调的接口，检查 HTTP 状态 **和 响应结构**，
 *     断言条件直接抄自前端源码（services/learning.js、services/api.js、
 *     services/profile.js、services/business.js …），
 *     所以前端改了字段，这里立刻会红。
 *   - 打的是**真实在跑的服务**（默认走小程序 .env 里的局域网地址）。
 *
 * 用法：
 *   node scripts/verify_e2e_full.js
 *   SEED_BASE=http://127.0.0.1:3000 node scripts/verify_e2e_full.js
 */
const http = require('http');
const { URL } = require('url');

const BASE = process.env.SEED_BASE || 'http://192.168.0.44:3000';
const PASSWORD = process.env.SEED_PASSWORD || ['Naoshang', '@', '2026'].join('');
/** 联创合伙人：家长 + 有一个「羿烁」孩子的账号（覆盖面最广） */
const PHONE = '13900001001';
/** 未开通 200 权益的普通家长（测门禁） */
const PHONE_LOCKED = '13900001008';

let pass = 0, fail = 0;
const failures = [];
function check(label, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else {
    fail++; failures.push(label);
    console.log('  ✗ ' + label + (detail !== undefined ? '  → ' + JSON.stringify(detail).slice(0, 220) : ''));
  }
}
function head(t) { console.log('\n【' + t + '】'); }

function call(method, path, { token, body } = {}) {
  return new Promise((resolve) => {
    const data = body !== undefined ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    if (data) headers['Content-Length'] = Buffer.byteLength(data);
    const u = new URL(BASE + path);
    const req = http.request({
      host: u.hostname, port: u.port, path: u.pathname + u.search, method, headers, timeout: 10000,
    }, (res) => {
      let b = '';
      res.on('data', (c) => { b += c; });
      res.on('end', () => {
        let j = null;
        try { j = JSON.parse(b); } catch (e) { j = null; }
        resolve({ status: res.statusCode, data: j, raw: b });
      });
    });
    req.on('error', (e) => resolve({ status: 0, data: null, raw: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, data: null, raw: 'timeout' }); });
    req.end(data);
  });
}

(async () => {
  console.log('════════ 全链路端到端验收（前端视角）════════');
  console.log('目标：' + BASE);
  console.log('');

  // ─────────────────────────────────────────────────────────
  head('A. 登录与会话（services/api.js login / request）');
  // ─────────────────────────────────────────────────────────
  let r = await call('POST', '/auth/login', { body: { phone: PHONE, password: PASSWORD, channel: 'parent' } });
  check('手机号+密码登录 → 200', r.status === 200, r.raw.slice(0, 120));
  check('返回 token（api.js login 要求 result.token）', !!(r.data && r.data.token), r.data);
  check('返回 user.id（api.js login 要求 result.user.id）', !!(r.data && r.data.user && r.data.user.id), r.data);
  check('accountType = parent', r.data && r.data.accountType === 'parent', r.data && r.data.accountType);
  check('带 displayId（对外编号）', !!(r.data && r.data.user && r.data.user.displayId), r.data && r.data.user);
  const token = r.data && r.data.token;
  const uid = r.data && r.data.user && r.data.user.id;
  const displayId = r.data && r.data.user && r.data.user.displayId;

  r = await call('POST', '/auth/login', { body: { phone: PHONE, password: 'wrong-password', channel: 'parent' } });
  check('错误密码 → 401', r.status === 401, r.raw.slice(0, 80));
  r = await call('POST', '/auth/login', { body: { phone: PHONE, channel: 'parent' } });
  check('缺密码 → 400（禁止仅凭手机号免密登录）', r.status === 400, r.raw.slice(0, 80));
  r = await call('POST', '/auth/login', { body: { phone: '13999999999', password: PASSWORD, channel: 'parent' } });
  check('未注册手机号 → 404', r.status === 404, r.raw.slice(0, 80));
  r = await call('GET', '/me');
  check('无 token 访问 /me → 401（前端会 logout 并跳登录页）', r.status === 401, r.raw.slice(0, 80));

  if (!token) {
    console.log('\n⚠ 登录失败，后续用例无法执行。');
    console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败');
    process.exit(1);
  }

  // ─────────────────────────────────────────────────────────
  head('B. 会员 tab（services/learning.js + pages/member）');
  // ─────────────────────────────────────────────────────────
  r = await call('GET', '/me/bootstrap', { token });
  check('GET /me/bootstrap → 200', r.status === 200, r.raw.slice(0, 120));
  const contexts = r.data && r.data.contexts;
  // learning.js:18  if (!Array.isArray(rows)) throw new Error('身份数据格式异常')
  check('contexts 是数组（否则前端报"身份数据格式异常"）', Array.isArray(contexts), contexts);
  // learning.js:19  rows.filter(item => item.accountId === current.id && ['parent','child'].includes(item.mode) && (item.mode !== 'child' || item.memberId))
  const usable = Array.isArray(contexts)
    ? contexts.filter((i) => i && i.accountId === uid && ['parent', 'child'].includes(i.mode) && (i.mode !== 'child' || i.memberId))
    : [];
  check('有前端"认得出"的身份（accountId + mode + memberId 过滤后非空）', usable.length > 0, contexts);
  check('含家长身份 mode=parent', usable.some((i) => i.mode === 'parent'), contexts);
  const childCtx = usable.find((i) => i.mode === 'child');
  check('含孩子身份 mode=child（带 memberId）', !!childCtx, contexts);
  check('每个身份都有 id/name/displayId/badge（渲染用）',
    usable.every((i) => i.id && i.name && i.displayId && typeof i.badge === 'string'), usable);
  check('entitlement 状态可读', !!(r.data && r.data.entitlement && r.data.entitlement.state), r.data && r.data.entitlement);

  r = await call('GET', '/members', { token });
  const members = r.data && r.data.items;
  check('GET /members → 200', r.status === 200, r.raw.slice(0, 100));
  check('members.items 是数组', Array.isArray(members), members);
  check('孩子数量与 contexts 里的 child 一致', !!childCtx && Array.isArray(members) && members.some((m) => m.id === childCtx.memberId), {
    members: Array.isArray(members) ? members.map((m) => m.id) : members, childMemberId: childCtx && childCtx.memberId,
  });

  r = await call('GET', '/learning/levels', { token });
  // learning.js:63  const levels = result.levels
  check('GET /learning/levels → 200', r.status === 200, r.raw.slice(0, 100));
  check('家长模式 levels 是数组（否则"暂无等级"）', !!(r.data && Array.isArray(r.data.levels)), r.data && Object.keys(r.data || {}));

  let levelId = null;
  if (childCtx) {
    r = await call('GET', '/members/' + encodeURIComponent(childCtx.memberId) + '/levels', { token });
    check('GET /members/{id}/levels → 200', r.status === 200, r.raw.slice(0, 100));
    check('孩子模式 levels 是数组', !!(r.data && Array.isArray(r.data.levels)), r.data && Object.keys(r.data || {}));
    check('孩子等级有解锁标记 unlocked（前端据此显示可用/锁定）',
      !!(r.data && Array.isArray(r.data.levels) && r.data.levels.every((l) => typeof l.unlocked === 'boolean')),
      r.data && r.data.levels && r.data.levels.slice(0, 2));
    if (r.data && Array.isArray(r.data.levels) && r.data.levels.length) {
      const lv = r.data.levels.find((l) => l.unlocked) || r.data.levels[0];
      levelId = lv.id;
      // learning.js:73  if (!result?.id || typeof (result.membershipUnlocked ?? result.unlocked) !== 'boolean' || !Array.isArray(result.chapters)) throw
      const d = await call('GET', '/learning/levels/' + encodeURIComponent(levelId) + '?memberId=' + encodeURIComponent(childCtx.memberId), { token });
      check('GET /learning/levels/{id} → 200', d.status === 200, d.raw.slice(0, 120));
      check('等级详情有 id', !!(d.data && d.data.id), d.data && Object.keys(d.data || {}));
      check('等级详情有 membershipUnlocked/unlocked 布尔（前端据此判权限）',
        !!(d.data && typeof (d.data.membershipUnlocked !== undefined ? d.data.membershipUnlocked : d.data.unlocked) === 'boolean'),
        d.data && { membershipUnlocked: d.data.membershipUnlocked, unlocked: d.data.unlocked });
      check('等级详情 chapters 是数组', !!(d.data && Array.isArray(d.data.chapters)), d.data && typeof d.data.chapters);
    }
  }

  // ─────────────────────────────────────────────────────────
  head('C. 商城与下单（services/commerce + checkout）');
  // ─────────────────────────────────────────────────────────
  r = await call('GET', '/catalog', { token });
  check('GET /catalog → 200', r.status === 200, r.raw.slice(0, 100));
  const items = r.data && r.data.items;
  check('catalog.items 是数组', Array.isArray(items), items);
  check('商品带 viewerPrice（"你的价"）', !!(items && items.some((i) => i.viewerPrice)), items && items[0]);
  const pad = items && items.find((i) => i.id === 'pad');
  if (pad) {
    r = await call('GET', '/products/' + encodeURIComponent(pad.id), { token });
    check('GET /products/{id} → 200 且有 title', r.status === 200 && !!(r.data && r.data.title), r.raw.slice(0, 100));
  }
  r = await call('GET', '/checkout/options', { token });
  check('GET /checkout/options → 200', r.status === 200, r.raw.slice(0, 100));
  check('结算选项含 stores/members 数组', !!(r.data && Array.isArray(r.data.stores) && Array.isArray(r.data.members)), r.data && Object.keys(r.data || {}));

  // 优先用 pad（脑商Pad / 智能变速），若其档位售罄则回退到目录中其它有货商品。
  // 库存按 tier/sku 维度扣减，测试数据可能把 pad 一档耗尽 → 这里只「告警」不「判失败」，
  // 仍用其它商品把「报价=你的价 / 下单」链路跑通（与具体商品无关）。
  const storeId = (r.data && r.data.stores && r.data.stores[0] && r.data.stores[0].id) || undefined;
  const candidates = [pad].concat(items || []).filter(Boolean);
  let payable = null, quoteId = null, order = null, usedProduct = null, padOutOfStock = false;
  for (const p of candidates) {
    const sku = p.skus && p.skus[0];
    const q = await call('POST', '/checkout/quotes', { token, body: { productId: p.id, skuId: sku ? sku.id : undefined, quantity: 1, storeId } });
    const qid = q.data && (q.data.id || q.data.quoteId);
    if (!qid) { if (p.id === 'pad') padOutOfStock = true; continue; }
    const o = await call('POST', '/orders', {
      token, body: { quoteId: qid, idempotencyKey: 'e2e-secC-' + Date.now() + '-' + p.id, productId: p.id, skuId: sku ? sku.id : undefined, quantity: 1 },
    });
    const ord = o.data && (o.data.order || o.data);
    if (ord && ord.id) { payable = q.data && q.data.payableAmount; quoteId = qid; order = ord; usedProduct = p; break; }
  }
  if (padOutOfStock) {
    console.log('  · ⚠ pad（智能变速·一档）当前库存为 0，已回退到其它有货商品完成下单链路');
    console.log('    （疑似测试订单把 pad 一档库存耗尽，建议核查线上库存并补货）');
  }
  check('POST /checkout/quotes → 200', !!quoteId, '无可用商品');
  check('报价含 payableAmount', payable !== undefined && payable !== null, null);
  if (usedProduct && usedProduct.viewerPrice && payable !== null) {
    check('报价 = 目录"你的价"（前端展示一致）', Math.abs(payable - usedProduct.viewerPrice.unitAmount / 100) < 0.01, {
      quote: payable, viewerPrice: usedProduct.viewerPrice.unitAmount / 100,
    });
  }
  check('POST /orders → 200', !!(order && order.id), order && order.id);
  check('订单已生成（有 id）', !!(order && order.id), order && order.id);
  check('下单实付 = 报价金额', !!order && payable !== null && Math.abs(order.paid - payable) < 0.01, {
    paid: order && order.paid, quote: payable,
  });

  // ─────────────────────────────────────────────────────────
  head('D. 联营 tab（services/business.js getBusinessOverview）');
  // ─────────────────────────────────────────────────────────
  r = await call('GET', '/partner/overview?contextId=partner:' + encodeURIComponent(uid), { token });
  check('GET /partner/overview → 200', r.status === 200, r.raw.slice(0, 140));
  check('overview.accountId === 本人 id（前端校验 identity）', !!(r.data && r.data.accountId === uid), r.data && r.data.accountId);
  check('overview.contextId 回显（前端校验 context）', !!(r.data && r.data.contextId), r.data && r.data.contextId);
  check('overview.benefits 是数组（前端映射 benefits）', !!(r.data && Array.isArray(r.data.benefits)), r.data && typeof r.data.benefits);

  // ─────────────────────────────────────────────────────────
  head('E. 我的 tab（services/profile.js + exclusive.js）');
  // ─────────────────────────────────────────────────────────
  r = await call('GET', '/me', { token });
  check('GET /me → 200', r.status === 200, r.raw.slice(0, 100));
  // profile.js:21  if (result?.profile?.id !== user.id) fail('个人资料格式异常')
  check('profile.id === 本人 id（否则前端报"个人资料格式异常"）', !!(r.data && r.data.profile && r.data.profile.id === uid), r.data && r.data.profile);
  check('profile 含 nickname/phone', !!(r.data && r.data.profile && r.data.profile.nickname && r.data.profile.phone), r.data && r.data.profile);
  check('orderCounts 结构完整', !!(r.data && r.data.orderCounts && ['pendingPayment', 'waitingShipment', 'waitingReceipt', 'completed'].every((k) => k in r.data.orderCounts)), r.data && r.data.orderCounts);
  check('support 配置可读', !!(r.data && r.data.support && r.data.support.phone), r.data && r.data.support);

  r = await call('GET', '/support/config', { token });
  check('GET /support/config → 200', r.status === 200, r.raw.slice(0, 100));
  check('support/config 含 phone/description/feedback', !!(r.data && r.data.phone && r.data.description && r.data.feedback), r.data && Object.keys(r.data || {}));

  r = await call('GET', '/announcements', { token });
  check('GET /announcements → 200', r.status === 200, r.raw.slice(0, 100));
  check('announcements.items 是数组', !!(r.data && Array.isArray(r.data.items)), r.data && Object.keys(r.data || {}));

  r = await call('GET', '/wallet/withdrawals', { token });
  check('GET /wallet/withdrawals → 200', r.status === 200, r.raw.slice(0, 100));
  check('withdrawals.items 是数组', !!(r.data && Array.isArray(r.data.items)), r.data && Object.keys(r.data || {}));

  // ─────────────────────────────────────────────────────────
  head('F. 权益门禁与异常（未开通 200 权益的账号）');
  // ─────────────────────────────────────────────────────────
  r = await call('POST', '/auth/login', { body: { phone: PHONE_LOCKED, password: PASSWORD, channel: 'parent' } });
  check('未开通账号也能登录 → 200', r.status === 200, r.raw.slice(0, 100));
  const t2 = r.data && r.data.token;
  check('其 entitlement.state = never_paid', !!(r.data && r.data.entitlement && r.data.entitlement.state === 'never_paid'), r.data && r.data.entitlement);
  if (t2) {
    r = await call('GET', '/catalog', { token: t2 });
    check('/catalog 返回 locked=true（未开通→全站门禁）', !!(r.data && r.data.locked === true), r.data);
    r = await call('GET', '/me/bootstrap', { token: t2 });
    check('未开通账号 /me/bootstrap 仍 200（豁免放行）', r.status === 200, r.raw.slice(0, 100));
  }

  // ─────────────────────────────────────────────────────────
  head('G. 注册流程（家长自助注册 → 立即可登录）');
  // ─────────────────────────────────────────────────────────
  const newPhone = '139' + String(Math.floor(10000000 + Math.random() * 89999999));
  r = await call('POST', '/auth/sms/send', { body: { phone: newPhone, purpose: 'register' } });
  check('发验证码 → 200', r.status === 200, r.raw.slice(0, 100));
  const devCode = r.data && r.data.devCode;
  if (!devCode) {
    console.log('  · 未开启 EXPOSE_DEV_CODE，跳过注册链路（后端默认不回传验证码）');
  } else {
    r = await call('POST', '/auth/register', { body: { phone: newPhone, code: devCode, password: 'e2epass123', name: 'E2E测试', regionCodes: ['33', '3301', '330110'], regionNames: ['浙江省', '杭州市', '余杭区'] } });
    check('注册 → 200 并返回 token', r.status === 200 && !!(r.data && r.data.token), r.raw.slice(0, 140));
    check('新用户编号以 QZ 开头（未开通权益）', !!(r.data && r.data.user && /^QZ\d+$/.test(r.data.user.displayId)), r.data && r.data.user);
    r = await call('POST', '/auth/login', { body: { phone: newPhone, password: 'e2epass123', channel: 'parent' } });
    check('新注册账号可用手机号+密码登录 → 200', r.status === 200 && !!(r.data && r.data.token), r.raw.slice(0, 120));
    r = await call('POST', '/auth/login', { body: { phone: newPhone, password: 'wrongpass', channel: 'parent' } });
    check('新账号错误密码 → 401', r.status === 401, r.raw.slice(0, 80));
  }

  // ─────────────────────────────────────────────────────────
  head('H. 订单动作与公告已读（2026-10-28 修复的前后端没接上）');
  // ─────────────────────────────────────────────────────────
  // ① 公告已读：前端 learning.js 的 markAnnouncementRead → PUT /announcements/{id}/read
  //    （后端此前**没有这条路由** → 打开公告详情页必 404，且被前端 catch 掉，静默失败）
  const ann = await call('GET', '/announcements', { token });
  const annItems = (ann.data && ann.data.items) || [];
  check('GET /announcements → 200 且有公告', ann.status === 200 && annItems.length > 0, ann.raw.slice(0, 100));
  if (annItems.length) {
    const aid = annItems[0].id;
    r = await call('PUT', '/announcements/' + encodeURIComponent(aid) + '/read', { token });
    check('PUT /announcements/{id}/read → 200', r.status === 200, r.raw.slice(0, 120));
    check('返回 read=true', !!(r.data && r.data.read === true), r.data);
    const again = await call('PUT', '/announcements/' + encodeURIComponent(aid) + '/read', { token });
    check('重复标记已读 → 仍 200（幂等）', again.status === 200, again.raw.slice(0, 100));
  }
  r = await call('PUT', '/announcements/not-exist-id/read', { token });
  check('不存在的公告 → 404', r.status === 404, r.raw.slice(0, 80));

  // ② 订单动作：前端 commerce.js 的 changeOrder(action) 把 action 拼进路径
  //    → cancel / confirm-receipt；后端规范路径是复数 /cancellations /receipts。
  //    之前两边命名不一致 → 按钮能显示（allowedActions）但一点就 404。
  const mkOrder = async (key, payLater) => {
    const c = await call('GET', '/catalog', { token });
    const its = (c.data && c.data.items) || [];
    const opt = await call('GET', '/checkout/options', { token });
    const storeId = opt.data && opt.data.stores && opt.data.stores[0] && opt.data.stores[0].id;
    // 优先用 pad；若该档位 pad 已售罄（库存按 tier 维度扣减 → "库存不足"），
    // 自动回退到目录里其它有货商品。仍为「建单→动作」链路测试，与具体商品无关。
    const candidates = [its.find((i) => i.id === 'pad')].concat(its).filter(Boolean);
    for (const p of candidates) {
      const sku = p.skus && p.skus[0];
      const q = await call('POST', '/checkout/quotes', {
        token, body: { productId: p.id, skuId: sku ? sku.id : undefined, quantity: 1, storeId },
      });
      const qid = q.data && (q.data.id || q.data.quoteId);
      if (!qid) continue;
      const body = { quoteId: qid, idempotencyKey: key + '-' + p.id, productId: p.id, skuId: sku ? sku.id : undefined, quantity: 1, storeId };
      if (payLater) body.payLater = true;    // 后端：payLater=true → 订单建成 PENDING_PAYMENT（未支付）
      const o = await call('POST', '/orders', { token, body });
      const ord = o.data && (o.data.order || o.data);
      if (ord && ord.id) return ord;
    }
    return null;
  };

  // 取消订单：必须用「未支付」的订单（后端有保护：已支付订单不可取消，请走退款）
  const ordCancel = await mkOrder('e2e-cancel-' + Date.now(), true);
  if (ordCancel) {
    check('新建待支付订单（payLater）→ status = PENDING_PAYMENT', ordCancel.status === 'PENDING_PAYMENT', ordCancel.status);
    const det = await call('GET', '/orders/' + encodeURIComponent(ordCancel.id), { token });
    const acts = (det.data && det.data.order && det.data.order.allowedActions) || [];
    check('未支付订单的 allowedActions 含 cancel', acts.includes('cancel'), acts);
    r = await call('POST', '/orders/' + encodeURIComponent(ordCancel.id) + '/cancel', { token, body: { version: ordCancel.version || 1, idempotencyKey: 'c-' + Date.now() } });
    check('POST /orders/{id}/cancel → 200（前端写法）', r.status === 200, r.raw.slice(0, 140));
    check('订单状态变为 CANCELLED', !!(r.data && r.data.order && r.data.order.status === 'CANCELLED'), r.data && r.data.order && r.data.order.status);
    // 后端规范路径（复数）也要通
    const ordCancel2 = await mkOrder('e2e-cancel2-' + Date.now(), true);
    if (ordCancel2) {
      r = await call('POST', '/orders/' + encodeURIComponent(ordCancel2.id) + '/cancellations', { token, body: { version: ordCancel2.version || 1, idempotencyKey: 'c2-' + Date.now() } });
      check('POST /orders/{id}/cancellations → 200（后端规范路径）', r.status === 200, r.raw.slice(0, 120));
    }
  } else {
    check('新建待支付订单 → 成功', false, '下单失败，无法验证取消');
  }

  // 已支付订单不允许取消（保护逻辑）
  const ordPaid = await mkOrder('e2e-paid-' + Date.now(), false);
  if (ordPaid) {
    r = await call('POST', '/orders/' + encodeURIComponent(ordPaid.id) + '/cancel', { token, body: { version: ordPaid.version || 1, idempotencyKey: 'c3-' + Date.now() } });
    check('已支付订单取消 → 400（保护：不可取消，请走退款）', r.status === 400, r.raw.slice(0, 120));
  }

  const ordRecv = await mkOrder('e2e-recv-' + Date.now(), false);
  if (ordRecv) {
    // 先支付（sandbox 直通），再确认收货
    const pay = await call('POST', '/payments/attempts', { token, body: { orderId: ordRecv.id, channel: 'wechat', idempotencyKey: 'p-' + Date.now() } });
    check('POST /payments/attempts → 200（支付）', pay.status === 200, pay.raw.slice(0, 120));
    r = await call('POST', '/orders/' + encodeURIComponent(ordRecv.id) + '/confirm-receipt', { token, body: { version: ordRecv.version || 1, idempotencyKey: 'r-' + Date.now() } });
    check('POST /orders/{id}/confirm-receipt → 200（前端写法）', r.status === 200, r.raw.slice(0, 140));
    check('订单状态变为 COMPLETED', !!(r.data && r.data.order && r.data.order.status === 'COMPLETED'), r.data && r.data.order && r.data.order.status);
  } else {
    check('新建待支付订单 → 成功', false, '下单失败，无法验证确认收货');
  }

  console.log('\n════════════════════════════════════════');
  console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败');
  if (fail) {
    console.log('失败项：');
    for (const f of failures) console.log('  · ' + f);
  }
  console.log('════════════════════════════════════════');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('验收脚本异常：', e && e.message ? e.message : e); process.exit(1); });

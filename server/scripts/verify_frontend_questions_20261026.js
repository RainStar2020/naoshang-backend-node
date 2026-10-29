/**
 * 前端 8 问回归（2026-10-26）
 * 运行：node scripts/verify_frontend_questions_20261026.js
 *   —— 自带服务自启/自收尾（独立端口拉起临时 server.js），可直接纳入全量回归。
 *
 * 覆盖前端反馈的 8 个问题：
 *   1. 报价是否绑定提交       → 全部报价端点落库 + 提交凭 quoteId 校验（价格/有效期/组合/归属/一次性）
 *   2. 支付返回缺少关键字段   → 订单返回 id；POST /orders/{id}/payment 返回 id/paymentId；payParams 有渠道级结构
 *   3. 升级费用支付流程不清   → 差价 + 服务费合并为一张支付单；live 先建单、支付成功后才扣名额授级
 *   4. 上传链路仍不完整       → fileId 与 assetId 同值；申请提交校验资源存在 + READY + 归属
 *   5. 权益规则没有闭合       → 三态语义（never_paid 照算 / active / expired 停算+可导出）；locked:true 保留
 *   6. 收益多态缺少字段定义   → /income/biz-types 返回 14 类 bizDetail 结构；inspect/sales 属 allocationKind
 *   7. 晋升领取接口仍未给出   → GET/POST /partner/promotion-claims
 *   8. 核销与幂等边界未说明   → 核销失败次数上限与锁定；同幂等键不同参数 → 409
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const PORT = 3333;
const BASE = `http://127.0.0.1:${PORT}`;
let passed = 0, failed = 0;
const check = (name, cond, extra) => {
  if (cond) { passed++; console.log(`  ok  ${name}`); }
  else { failed++; console.log(`  FAIL ${name}${extra !== undefined ? ' -> ' + JSON.stringify(extra).slice(0, 400) : ''}`); }
};
const req = (m, p, { token, body } = {}) => fetch(BASE + p, {
  method: m,
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
}).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }));
const loginParent = async (phone) => (await req('POST', '/auth/login', { body: { channel: 'parent', phone, password: process.env.SEED_PASSWORD || 'Naoshang@2026' } })).data.token;

// ═══════════════════ A. 单元测试 ═══════════════════
async function unitTests() {
  console.log('== A. 单元测试 ==');

  // ── 报价存储层（问题 1）──
  const QT = require('../src/quoteStore');
  const db = { quotes: [], seq: 1 };
  const q = QT.issueQuote(db, {
    scene: QT.QUOTE_SCENES.CHECKOUT, userId: 'u1', amount: 100,
    breakdown: { a: 1 }, items: [{ key: 'pad', qty: 1 }],
  });
  check('issueQuote 生成报价并落库', !!q.id && db.quotes.length === 1, db.quotes.length);
  check('报价带 expiresAt（TTL 10 分钟）', q.expiresAt - q.issuedAt === 10 * 60 * 1000, q.expiresAt - q.issuedAt);
  check('报价带 ruleVersion', q.ruleVersion === 1);
  check('requireQuote 归属校验（他人报价报错）', (() => { try { QT.requireQuote(db, q.id, { userId: 'u2' }); return false; } catch (e) { return /不属于当前账号/.test(e.message); } })());
  check('requireQuote 场景校验（串用报错）', (() => { try { QT.requireQuote(db, q.id, { scene: QT.QUOTE_SCENES.UPGRADE }); return false; } catch (e) { return /场景不匹配/.test(e.message); } })());
  check('requireQuote 过期校验', (() => { try { QT.requireQuote(db, q.id, { now: q.expiresAt + 1000 }); return false; } catch (e) { return /过期/.test(e.message); } })());
  check('checkQuote 金额不一致报错', (() => { try { QT.checkQuote(db, q.id, { serverAmount: 200 }); return false; } catch (e) { return /价格已变化/.test(e.message); } })());
  check('checkQuote 组合不一致报错', (() => { try { QT.checkQuote(db, q.id, { items: [{ key: 'pad', qty: 2 }] }); return false; } catch (e) { return /组合与报价不一致/.test(e.message); } })());
  check('checkQuote 不消费报价', db.quotes[0].consumed === false);
  QT.markConsumed(db, q.id, { ref: 'o1' });
  check('markConsumed 标记已消费并回填 ref', db.quotes[0].consumed === true && db.quotes[0].consumedRef === 'o1');
  check('已消费报价再次提交报错', (() => { try { QT.requireQuote(db, q.id); return false; } catch (e) { return /已使用/.test(e.message); } })());

  // ── 幂等层（问题 8）──
  const IDEM = require('../src/utils/idempotency');
  const list = [];
  const rec = IDEM.stamp({ id: 'r1', idempotencyKey: 'K1' }, { amount: 100, target: 'a' });
  list.push(rec);
  const same = IDEM.check({ list, key: 'K1', payload: { amount: 100, target: 'a' } });
  check('同幂等键 + 同参数 → 幂等命中（不冲突）', same.duplicated === true && same.conflict === false, same);
  const diff = IDEM.check({ list, key: 'K1', payload: { amount: 200, target: 'a' } });
  check('同幂等键 + 不同参数 → 冲突', diff.conflict === true, diff);
  check('冲突错误码 409', diff.error && diff.error.status === 409, diff.error && diff.error.status);
  check('冲突信息指出差异字段', /差异字段：amount/.test(diff.conflictReason), diff.conflictReason);
  check('不同幂等键 → 不命中', IDEM.check({ list, key: 'K2', payload: { amount: 100, target: 'a' } }).duplicated === false);
  check('字段顺序无关', IDEM.fingerprint({ a: 1, b: 2 }) === IDEM.fingerprint({ b: 2, a: 1 }));
  check('数字与字符串归一（100 vs "100"）', IDEM.fingerprint({ a: 100 }) === IDEM.fingerprint({ a: '100' }));
  check('历史记录无指纹 → 放行不误判', (() => {
    const l2 = [{ id: 'x', idempotencyKey: 'OLD' }];
    return IDEM.check({ list: l2, key: 'OLD', payload: { any: 1 } }).conflict === false;
  })());

  // ── 核销失败次数（问题 8）──
  const OL = require('../src/orderLifecycle');
  const db2 = { orders: [{ id: 'o1', orderNo: 'NO1', status: 'PAID', delivery_mode: 'ONLINE_STORE', activation_mode: 'CODE' }] };
  const order = db2.orders[0];
  OL.attachDelivery(order, 'featured');
  const code = OL.verifyCodeOf(order);
  for (let i = 0; i < 4; i++) {
    try { OL.verify(db2, { storeId: 'S1', orderNo: 'NO1', code: '000000' }); } catch (e) { /* ignore */ }
  }
  check('核销码错误累计失败次数', order.verify_fail_count === 4, order.verify_fail_count);
  check('未达上限不锁定', order.verify_locked !== true);
  try { OL.verify(db2, { storeId: 'S1', orderNo: 'NO1', code: '000000' }); } catch (e) { /* ignore */ }
  check('达上限（5 次）锁定核销', order.verify_fail_count === 5 && order.verify_locked === true, order.verify_fail_count);
  check('锁定后即使码正确也拒绝核销', (() => { try { OL.verify(db2, { storeId: 'S1', orderNo: 'NO1', code }); return false; } catch (e) { return /锁定/.test(e.message); } })());
  check('未付款订单不可核销', (() => {
    const d3 = { orders: [{ id: 'o2', status: 'PENDING', delivery_mode: 'ONLINE_STORE' }] };
    const chk = OL.verifiable(d3.orders[0]);
    return chk.ok === false && /待支付/.test(chk.reason);
  })());
  check('已核销订单不可重复核销', (() => {
    const d4 = { orders: [{ id: 'o3', status: 'COMPLETED', verified: true, delivery_mode: 'ONLINE_STORE' }] };
    const chk = OL.verifiable(d4.orders[0]);
    return chk.ok === false && /已核销/.test(chk.reason);
  })());

  // ── bizType 字典（问题 6）──
  const BIZ = require('../src/bizType');
  const dict = BIZ.fullDictionary();
  check('bizType 字典 14 类', dict.bizTypes.length === 14, dict.bizTypes.length);
  check('每类 bizType 都有 bizDetail 结构定义', dict.bizTypes.every((t) => t.detailFormat && Array.isArray(t.detailFields)));
  check('bizDetailSchema 覆盖 14 类', Object.keys(dict.bizDetailSchema).length === 14, Object.keys(dict.bizDetailSchema).length);
  check('allocationKinds 只有 inspection/sales 两类', dict.allocationKinds.length === 2 && dict.allocationKinds.every((k) => ['inspection', 'sales'].includes(k.key)));
  check('字典明确 inspect/sales 不是 bizType', /不是 bizType/.test(dict.note), dict.note);
  check('inspection/sales 不在 bizTypes 中', !dict.bizTypes.some((t) => t.key === 'inspection' || t.key === 'sales'));

  // ── 升级服务（问题 3）──
  const US = require('../src/upgradeService');
  const S = require('../src/store');
  const C = require('../src/commission');
  const db3 = S.createDb();
  db3.users = {
    u1: { id: 'u1', name: '甲', tier: 'vip', principal_tier: 'vip', upline_id: 'u2' },
    u2: { id: 'u2', name: '乙', tier: 'angel', principal_tier: 'angel' },
  };
  db3.quotaLedger = { u2: { standard: 10, activity: 0 } };
  const uq = US.quoteUpgrade(db3, { targetAccountId: 'u1', targetLevel: 'angel' });
  check('升级报价 = 差价 + 服务费（合并为 totalPayable）', Math.abs(uq.totalPayable - (uq.amount + uq.serviceFeeEstimate)) < 0.01, uq);
  check('升级计价以本金档为减数', uq.principalTier === 'vip' && uq.amount === Math.max(0, (C.RETAIL_PRICE.angel || 0) - (C.RETAIL_PRICE.vip || 0)), uq);
  check('升级报价含名额增量', uq.quotaCount === Math.max(0, (C.TIER_VIP.angel || 0) - (C.TIER_VIP.vip || 0)), uq.quotaCount);

  // ── 支付模块（问题 2/3）──
  const PAY = require('../src/payment');
  check('upgrade 是合法支付业务类型', !!PAY.BIZ_CHANNELS.upgrade && PAY.BIZ_CHANNELS.upgrade.length > 0);
  check('upgrade 有业务名称', !!PAY.BIZ_NAMES.upgrade);
  const pp = PAY.buildPayParams('wechat', {});
  check('payParams 含渠道级结构 channel/channelName/mode', pp.channel === 'wechat' && pp.channelName === '微信支付' && pp.mode, pp);
  check('payParams.invoke 存在（渠道私有参数）', pp.invoke && typeof pp.invoke === 'object', pp.invoke);
}

// ═══════════════════ B. HTTP 端到端 ═══════════════════
async function httpTests() {
  console.log('== B. HTTP 端到端 ==');
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(PORT), EXPOSE_DEV_CODE: '1' }, stdio: 'ignore',
  });
  const boot = Date.now();
  while (Date.now() - boot < 15000) {
    try { const r = await fetch(BASE + '/'); if (r.ok) break; } catch (e) { /* retry */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  try {
    const admin = (await req('POST', '/auth/sessions', { body: { channel: 'admin', password: 'admin888' } })).data.token;
    check('admin 登录', !!admin);
    check('恢复默认种子', (await req('POST', '/api/seed/reset', { token: admin })).status === 200);
    const P1 = await loginParent('13800000001');
    check('合伙人登录 p1', !!P1);

    // ═══ 问题 1：报价绑定提交 ═══
    console.log('  -- 问题1：报价绑定提交 --');
    const cq = await req('POST', '/checkout/quotes', { token: P1, body: { productKey: 'pad', quantity: 1 } });
    check('POST /checkout/quotes 200 且返回 id', cq.status === 200 && !!cq.data.id, cq.data);
    check('报价带 expiresAt', !!cq.data.expiresAt);
    const order = await req('POST', '/orders', { token: P1, body: { quoteId: cq.data.id, productKey: 'pad', quantity: 1 } });
    check('POST /orders 凭 quoteId 下单成功', order.status === 200 && order.data.quoteConsumed === true, order.data);
    check('订单返回含 id（问题2）', !!order.data.id && !!order.data.orderId, order.data);
    const replay = await req('POST', '/orders', { token: P1, body: { quoteId: cq.data.id, productKey: 'pad', quantity: 1 } });
    check('同一报价重复提交被拒（一次性）', replay.status === 400 && /已使用|重新报价/.test(replay.data.error || ''), replay.data);

    // 价格被篡改（服务端重算）
    const cq2 = await req('POST', '/checkout/quotes', { token: P1, body: { productKey: 'pad', quantity: 1 } });
    const tampered = await req('POST', '/orders', { token: P1, body: { quoteId: cq2.data.id, productKey: 'pad', quantity: 3 } });
    check('组合被篡改（数量 1→3）被拒', tampered.status === 400 && /组合与报价不一致|价格已变化/.test(tampered.data.error || ''), tampered.data);

    // 过期报价
    const cq3 = await req('POST', '/checkout/quotes', { token: P1, body: { productKey: 'pad', quantity: 1 } });
    await new Promise((r) => setTimeout(r, 100));
    check('报价 10 分钟有效（未过期可用）', cq3.data.expiresAt - cq3.data.serverTime >= 590000, cq3.data.expiresAt - cq3.data.serverTime);

    // 其余报价端点都落库（返回 q_ 前缀 id + ruleVersion）
    const qEndpoints = [
      ['/partner/entitlement-quotes', { contextId: 'partner:p1', planId: 'annual' }],
      ['/partner/quota-purchase-quotes', { contextId: 'partner:p1', quantity: 2 }],
      ['/partner/upgrade-quotes', { contextId: 'partner:p1', targetLevel: 'angel' }],
      ['/partner/store-binding-quotes', { contextId: 'partner:p1', storeId: 'p6' }],
      ['/partner/quota-transfer-quotes', { contextId: 'partner:p1', targetAccountId: 'p4', quantity: 1 }],
      ['/costore/application-quotes', { storeId: 'p6', durationId: '12' }],
      ['/agency/application-quotes', { agencyType: 'store', tierIndex: 0 }],
    ];
    for (const [ep, body] of qEndpoints) {
      const r = await req('POST', ep, { token: P1, body });
      check(`报价端点 ${ep} 落库（id + ruleVersion）`, r.status === 200 && !!r.data.id && r.data.ruleVersion === 1, r.data);
    }

    // entitlement-orders 凭 quoteId 校验
    const eq = await req('POST', '/partner/entitlement-quotes', { token: P1, body: { contextId: 'partner:p1', planId: 'annual' } });
    const eo = await req('POST', '/partner/entitlement-orders', { token: P1, body: { contextId: 'partner:p1', quoteId: eq.data.id, channel: 'wechat' } });
    check('entitlement-orders 凭 quoteId 成功', eo.status === 200 && eo.data.status === 'SUCCEEDED', eo.data);
    const eo2 = await req('POST', '/partner/entitlement-orders', { token: P1, body: { contextId: 'partner:p1', quoteId: eq.data.id, channel: 'wechat' } });
    check('entitlement 报价一次性（重复提交被拒）', eo2.status === 400 && /已使用|重新报价/.test(eo2.data.error || ''), eo2.data);

    // 场景串用：商城报价不能用于升级提交
    const cq4 = await req('POST', '/checkout/quotes', { token: P1, body: { productKey: 'pad', quantity: 1 } });
    const wrongScene = await req('POST', '/partner/upgrades', { token: P1, body: { contextId: 'partner:p1', quoteId: cq4.data.id, targetLevel: 'angel' } });
    check('商城报价用于升级提交被拒（场景不匹配）', wrongScene.status === 400 && /场景不匹配/.test(wrongScene.data.error || ''), wrongScene.data);

    // 越权：别人的报价
    const P5 = await loginParent('13800000005');
    const cq5 = await req('POST', '/checkout/quotes', { token: P1, body: { productKey: 'pad', quantity: 1 } });
    const crossUser = await req('POST', '/orders', { token: P5, body: { quoteId: cq5.data.id, productKey: 'pad', quantity: 1 } });
    check('他人报价不可使用（归属校验）', crossUser.status === 400 && /不属于当前账号/.test(crossUser.data.error || ''), crossUser.data);

    // 消费时机：下单失败时报价**不能**被消费（先校验→执行业务→成功后消费）
    const cqKeep = await req('POST', '/checkout/quotes', { token: P1, body: { productKey: 'pad', quantity: 1 } });
    const badOrder = await req('POST', '/orders', { token: P1, body: { quoteId: cqKeep.data.id, productKey: 'pad', quantity: -1 } });
    check('下单失败 → 报价未被消费（业务失败不浪费报价）', badOrder.status !== 200, badOrder.data);
    const reuseKeep = await req('POST', '/orders', { token: P1, body: { quoteId: cqKeep.data.id, productKey: 'pad', quantity: 1 } });
    check('失败后原报价仍可用（未被作废）', reuseKeep.status === 200 && reuseKeep.data.quoteConsumed === true, reuseKeep.data);

    // contextId 支持 query（前端按习惯放 query 也能通）
    const qInQuery = await req('POST', '/partner/upgrade-quotes?contextId=partner:p1', { token: P1, body: { targetLevel: 'angel' } });
    check('contextId 放 query 也可（报价端点）', qInQuery.status === 200 && !!qInQuery.data.id, qInQuery.data);
    const qInQuery2 = await req('POST', '/partner/entitlement-quotes?contextId=partner:p1', { token: P1, body: { planId: 'annual' } });
    check('contextId 放 query 也可（entitlement 报价端点）', qInQuery2.status === 200 && !!qInQuery2.data.id, qInQuery2.data);

    // ═══ 问题 2：支付字段 ═══
    console.log('  -- 问题2：支付返回关键字段 --');
    const o2 = await req('POST', '/orders', { token: P1, body: { productKey: 'pad', quantity: 1 } });
    check('不带 quoteId 也可下单（向后兼容；金额仍由服务端重算）', o2.status === 200 && !!o2.data.id, o2.data);
    const orderId = o2.data.id;
    const chans = await req('GET', `/orders/${orderId}/payment-channels`, { token: P1 });
    check('GET /orders/{id}/payment-channels 200', chans.status === 200 && Array.isArray(chans.data.items) && chans.data.items.length > 0, chans.data);
    check('渠道项含 id/label/kind', chans.data.items.every((c) => c.id && c.label && c.kind));
    check('渠道响应含 orderId 与 paymentMode', !!chans.data.orderId && !!chans.data.paymentMode);
    const pay = await req('POST', `/orders/${orderId}/payment`, { token: P1, body: { channel: 'wechat' } });
    check('POST /orders/{id}/payment 200', pay.status === 200, pay.data);
    check('支付响应含 id 与 paymentId（问题2）', !!pay.data.id && !!pay.data.paymentId, pay.data);
    check('支付响应含 status/channel/amount', !!pay.data.status && !!pay.data.channel && typeof pay.data.amount === 'number', pay.data);
    const poll = await req('GET', `/payments/attempts/${pay.data.id}`, { token: P1 });
    check('GET /payments/attempts/{id} 可按返回的 id 轮询', poll.status === 200 && poll.data.id === pay.data.id, poll.data);
    check('payParams 有渠道级结构', pay.data.payParams && pay.data.payParams.channel && pay.data.payParams.channelName && pay.data.payParams.mode, pay.data.payParams);
    const attempts = await req('POST', '/payments/attempts', { token: P1, body: { orderId: orderId, channel: 'wechat' } });
    check('POST /payments/attempts 返回 id/paymentId（问题2）', attempts.status === 200 && !!attempts.data.id, attempts.data);
    check('POST /payments/attempts 的 payParams 有渠道级结构',
      attempts.data.payParams && attempts.data.payParams.channel === 'wechat' && !!attempts.data.payParams.channelName
      && !!attempts.data.payParams.mode && !!attempts.data.payParams.invoke, attempts.data.payParams);

    // ═══ 问题 3：升级支付 ═══
    console.log('  -- 问题3：升级支付流程 --');
    const P4 = await loginParent('13800000004');
    const uq2 = await req('POST', '/partner/upgrade-quotes', { token: P4, body: { contextId: 'partner:p4', targetLevel: 'angel' } });
    check('升级报价含 totalPayable = 差价 + 服务费', uq2.status === 200 && typeof uq2.data.totalPayable === 'number'
      && Math.abs(uq2.data.totalPayable - (uq2.data.amount + uq2.data.serviceFeeEstimate)) < 0.01, uq2.data);
    check('升级报价含 paymentNote（合并为一张单）', /一张支付单/.test(uq2.data.paymentNote || ''), uq2.data.paymentNote);
    const ug = await req('POST', '/partner/upgrades', { token: P4, body: { contextId: 'partner:p4', quoteId: uq2.data.id, targetLevel: 'angel' } });
    check('POST /partner/upgrades 200', ug.status === 200, ug.data);
    check('sandbox 模式升级直达 SUCCEEDED', ug.data.status === 'SUCCEEDED', ug.data);
    check('升级返回 settlement 明细（差价/服务费/名额）', ug.data.settlement && ug.data.settlement.actual_paid != null
      && ug.data.settlement.serviceFee != null && ug.data.settlement.quotaUsedActivity != null, ug.data.settlement);
    check('升级返回落账明细 items', Array.isArray(ug.data.settlement && ug.data.settlement.items));

    // ═══ 问题 4：上传链路 ═══
    console.log('  -- 问题4：上传链路 --');
    const intent = await req('POST', '/assets/upload-intents', { token: P1, body: { purpose: 'storefront', fileName: 'a.jpg', mimeType: 'image/jpeg', size: 1024 } });
    check('POST /assets/upload-intents 200', intent.status === 200, intent.data);
    check('返回 fileId 与 assetId 且同值', !!intent.data.fileId && intent.data.fileId === intent.data.assetId, intent.data);
    check('返回 status=PENDING（未上传）', intent.data.status === 'PENDING', intent.data.status);
    check('返回 nextStep 提示完成确认', /completions/.test(intent.data.nextStep || ''), intent.data.nextStep);

    // 未 READY 直接提交申请 → 拒绝
    const app1 = await req('POST', '/agency/applications', { token: P1, body: {
      agencyType: 'store', tierIndex: 0, regionCodes: 'D1',
      agreements: [{ key: 'agencyAgreement', accepted: true }],
      uploads: [{ key: 'storefrontPhoto', fileId: intent.data.fileId }],
    } });
    check('未 READY 的上传凭证提交申请被拒', app1.status === 400 && /未上传完成|尚未上传完成/.test(app1.data.error || ''), app1.data);

    // 完成上传确认后 → 通过
    const comp = await req('POST', `/assets/${intent.data.fileId}/completions`, { token: P1, body: {} });
    check('POST /assets/{id}/completions 200 → READY', comp.status === 200 && comp.data.status === 'ready', comp.data);
    const app2 = await req('POST', '/agency/applications', { token: P1, body: {
      agencyType: 'store', tierIndex: 0, regionCodes: 'D1',
      agreements: [{ key: 'agencyAgreement', accepted: true }],
      uploads: [{ key: 'storefrontPhoto', fileId: intent.data.fileId }],
    } });
    check('READY 后提交申请成功', app2.status === 200 && !!app2.data.application, app2.data);

    // 不存在的资源
    const app3 = await req('POST', '/agency/applications', { token: P1, body: {
      agencyType: 'store', tierIndex: 0, regionCodes: 'D1',
      agreements: [{ key: 'agencyAgreement', accepted: true }],
      uploads: [{ key: 'storefrontPhoto', fileId: 'ast_not_exist' }],
    } });
    check('引用不存在的资源被拒', app3.status === 400 && /资源不存在/.test(app3.data.error || ''), app3.data);

    // ═══ 问题 5：权益三态 ═══
    console.log('  -- 问题5：权益规则闭合 --');
    const boot2 = await req('GET', '/me/bootstrap', { token: P1 });
    check('GET /me/bootstrap 200', boot2.status === 200, boot2.data);
    const gate = boot2.data.gate || boot2.data.entitlementGate || null;
    check('bootstrap 下发权益门禁字段（若未开通则 locked:true）', gate === null || gate.locked === true || gate.locked === false, gate);
    const gateUnit = require('../src/identity');
    const uNever = { id: 'x', tier: 'none', entitlement_state: 'never_paid' };
    check('never_paid 状态存在', gateUnit.entitlementState(uNever) === 'never_paid', gateUnit.entitlementState(uNever));
    const gNever = gateUnit.gatePayload(uNever);
    check('never_paid → locked:true, frozen:false（收益照算）', gNever.locked === true && gNever.frozen === false, gNever);
    check('never_paid → canExportBills:false', gNever.canExportBills === false);
    check('never_paid 文案说明「未开通期间收益照常计算」', /收益照常计算/.test(gNever.message), gNever.message);
    const uExpired = { id: 'y', tier: 'none', entitlement_state: 'active', entitlement_expires_at: Date.now() - 1000 };
    check('expired 状态存在', gateUnit.entitlementState(uExpired) === 'expired', gateUnit.entitlementState(uExpired));
    const gExp = gateUnit.gatePayload(uExpired);
    check('expired → locked:true, frozen:true（收益停算）', gExp.locked === true && gExp.frozen === true, gExp);
    check('expired → canExportBills:true（历史账单可导出）', gExp.canExportBills === true);
    const uActive = { id: 'z', tier: 'none', entitlement_state: 'active', entitlement_expires_at: Date.now() + 86400000 };
    check('active → gatePayload 为 null（无门禁）', gateUnit.gatePayload(uActive) === null);

    // ═══ 问题 6：bizType 字典 ═══
    console.log('  -- 问题6：收益多态字段定义 --');
    const bt = await req('GET', '/income/biz-types', { token: P1 });
    check('GET /income/biz-types 200', bt.status === 200, bt.data);
    check('返回 14 类 bizTypes', bt.data.bizTypes && bt.data.bizTypes.length === 14, bt.data.bizTypes && bt.data.bizTypes.length);
    check('每类含 detailFormat + detailFields', bt.data.bizTypes.every((t) => t.detailFormat && Array.isArray(t.detailFields)));
    check('返回 allocationKinds（inspect/sales）', bt.data.allocationKinds && bt.data.allocationKinds.length === 2, bt.data.allocationKinds);
    check('说明 inspect/sales 属 allocationKind 非 bizType', /不是 bizType/.test(bt.data.note || ''), bt.data.note);
    let incItems = [];
    for (const ph of ['13800000003', '13800000002', '13800000004', '13800000006']) {
      const tk = await loginParent(ph);
      const r = await req('GET', `/income/entries?contextId=partner:${ph === '13800000003' ? 'p3' : ph === '13800000002' ? 'p2' : ph === '13800000004' ? 'p4' : 'p6'}`, { token: tk });
      if (r.status === 200 && r.data.items && r.data.items.length) { incItems = r.data.items; break; }
    }
    check('收益明细带 bizType/bizTypeLabel/bizDetail', incItems.length > 0
      && incItems.every((x) => x.bizType && x.bizTypeLabel && x.bizDetail), incItems[0]);
    if (incItems.length) {
      const tk2 = await loginParent('13800000003');
      const incDetail = await req('GET', `/income/entries/${incItems[0].id}?contextId=partner:p3`, { token: tk2 });
      check('收益详情带 bizType + allocationKind（区分两套概念）', incDetail.status === 200
        && !!incDetail.data.bizType && incDetail.data.allocationKind !== undefined, incDetail.data);
    }

    // ═══ 问题 7：晋升领取 ═══
    console.log('  -- 问题7：晋升领取接口 --');
    const claims = await req('GET', '/partner/promotion-claims?contextId=partner:p1', { token: P1 });
    check('GET /partner/promotion-claims 200', claims.status === 200, claims.data);
    check('返回 status/claimable/claimed', !!claims.data.status && claims.data.claimable !== undefined && claims.data.claimed !== undefined, claims.data);
    const claim = await req('POST', '/partner/promotion-claims', { token: P1, body: { contextId: 'partner:p1' } });
    check('POST /partner/promotion-claims 有明确响应（达标授级 / 未达标 400）',
      claim.status === 200 || (claim.status === 400 && /未达标|尚未开通/.test(claim.data.error || '')), claim.data);
    if (claim.status === 200) {
      check('领取响应含 fromTier/toTier', !!claim.data.fromTier || !!claim.data.toTier, claim.data);
      check('领取响应含 status=CLAIMED', claim.data.status === 'CLAIMED', claim.data.status);
      const claim2 = await req('POST', '/partner/promotion-claims', { token: P1, body: { contextId: 'partner:p1' } });
      check('重复领取幂等（alreadyClaimed）', claim2.status === 200 && claim2.data.alreadyClaimed === true, claim2.data);
    }

    // ═══ 问题 8：核销与幂等边界 ═══
    console.log('  -- 问题8：核销与幂等 --');
    // 同幂等键不同参数 → 409（用反馈端点，无金额/余额前置校验干扰）
    const fb1 = await req('POST', '/support/feedback', { token: P1, body: { content: '幂等测试内容 A', idempotencyKey: 'IDEM-FB-1' } });
    check('反馈首次提交 200', fb1.status === 200 && !!fb1.data.feedbackId, fb1.data);
    const fbSame = await req('POST', '/support/feedback', { token: P1, body: { content: '幂等测试内容 A', idempotencyKey: 'IDEM-FB-1' } });
    check('同幂等键同参数 → 幂等返回同一记录', fbSame.status === 200 && fbSame.data.feedbackId === fb1.data.feedbackId, fbSame.data);
    const fbDiff = await req('POST', '/support/feedback', { token: P1, body: { content: '幂等测试内容 B', idempotencyKey: 'IDEM-FB-1' } });
    check('同幂等键不同内容 → 409 冲突', fbDiff.status === 409 && /幂等键/.test(fbDiff.data.error || ''), fbDiff.data);
    // 提现端点同样适用（金额需 ≥100）
    const payee = await req('POST', '/wallet/payees', { token: P1, body: { accountType: 'PERSONAL', name: '张三', bankName: '测试银行', bankNumber: '6222021234567890123' } });
    check('创建收款账户 200', payee.status === 200 && !!payee.data.payeeToken, payee.data);
    const payeeToken = payee.data.payeeToken;
    const w1 = await req('POST', '/wallet/withdrawals', { token: P1, body: { quoteId: 'q1', idempotencyKey: 'IDEM-W-1', payeeToken, amount: 200 } });
    const w2 = await req('POST', '/wallet/withdrawals', { token: P1, body: { quoteId: 'q1', idempotencyKey: 'IDEM-W-1', payeeToken, amount: 300 } });
    check('提现同幂等键不同金额 → 409 冲突', w2.status === 409 && /幂等键/.test(w2.data.error || ''), { w1: w1.status, w2: w2.data });
    // 支付单幂等
    const p1 = await req('POST', '/payments/attempts', { token: P1, body: { orderId: orderId, channel: 'wechat', idempotencyKey: 'PAY-IDEM-1' } });
    const p2 = await req('POST', '/payments/attempts', { token: P1, body: { orderId: orderId, channel: 'wechat', idempotencyKey: 'PAY-IDEM-1' } });
    check('支付同幂等键同参数 → 幂等返回同一支付单', p1.status === 200 && p2.status === 200 && p1.data.id === p2.data.id, { p1: p1.data, p2: p2.data });
    const p3 = await req('POST', '/payments/attempts', { token: P1, body: { orderId: orderId, channel: 'alipay', idempotencyKey: 'PAY-IDEM-1' } });
    check('支付同幂等键仅换渠道 → 幂等返回原单（渠道不变，重试场景）', p3.status === 200 && p3.data.id === p1.data.id && p3.data.channel === 'wechat', p3.data);
    // 不同订单 + 同幂等键 → 业务参数（bizId/金额）不同 → 409
    const orderId2 = (await req('POST', '/orders', { token: P1, body: { productKey: 'pad', quantity: 2 } })).data.id;
    const p4 = await req('POST', '/payments/attempts', { token: P1, body: { orderId: orderId2, channel: 'wechat', idempotencyKey: 'PAY-IDEM-1' } });
    check('支付同幂等键改订单（金额不同）→ 409 冲突', p4.status === 409 && /幂等键/.test(p4.data.error || ''), p4.data);

    // 核销：未付款订单不可核销
    const pending = await req('POST', '/orders', { token: P1, body: { productKey: 'pad', quantity: 1 } });
    const ver1 = await req('POST', `/stores/S1/orders/${pending.data.id}/verify`, { token: admin, body: { code: '123456' } });
    check('核销权限：非门店账号被拒或未付款被拒', ver1.status === 400 || ver1.status === 403, ver1.data);
  } finally {
    try { srv.kill(); } catch (e) { /* ignore */ }
  }
}

unitTests().then(() => httpTests()).then(() => {
  console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
  process.exit(failed ? 1 : 0);
}).catch((e) => {
  console.error('脚本异常：', e);
  process.exit(1);
});

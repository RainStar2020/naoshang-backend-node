/**
 * 支付模块 + 激活码发放核销 联合验证（2026-10-24 用户拍板）
 *
 * 支付（src/payment.js）：
 *   - 渠道：wechat/alipay/bank_card → 200 权益/年度权益；unionpay → 联创向总部购买名额（仅银联）
 *   - sandbox（默认）免支付直通；live 模式（进程内单测）CREATED + 验签 + 通知入账 + 幂等
 * 激活码发放（src/routes/h5codes.js）：
 *   - admin 批量发码/查询/作废；门店（agency）收款发码（fs/jy）；上级（upline）赠码（cj/xn/ys，绑直属下级）；
 *   - 绑定码仅被绑家长可激活（preview/activate 双校验）；核销台账记 channel/issuedBy。
 *
 * 运行：node scripts/verify_pay_and_codes.js
 */
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

// ── live 模式进程内单测（须在 require payment 前设置 env） ──
process.env.PAYMENT_MODE = 'live';
process.env.PAYMENT_NOTIFY_SECRET = 'test-secret';
const PAY = require('../src/payment');
const S = require('../src/store');
const IZ = require('../src/identity');
const Q = require('../src/quotaLedger');

const ROOT = path.join(__dirname, '..');
const PORT = 3293;
const BASE = `http://127.0.0.1:${PORT}`;
const { parentLogin } = require('./loginKit.cjs');
const req = (m, p, { token, body } = {}) => fetch(BASE + p, {
  method: m,
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
}).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }));

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  ok  ' + name); } else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' → ' + JSON.stringify(extra) : '')); } };

// ───────────── 1. live 模式进程内单测 ─────────────
console.log('\n[1] 支付模块 · live 模式（进程内）');
ok('PAYMENT_MODE=live 且非 sandbox', PAY.PAYMENT_MODE === 'live' && PAY.IS_SANDBOX === false);
ok('渠道表：微信/支付宝/银行卡/银联', ['wechat', 'alipay', 'bank_card', 'unionpay'].every((c) => PAY.CHANNELS[c]));
ok('权益业务渠道 = 微信/支付宝/银行卡', JSON.stringify(PAY.channelsFor('entitlement')) === JSON.stringify(['wechat', 'alipay', 'bank_card']));
ok('名额购买渠道 = 仅银联', JSON.stringify(PAY.channelsFor('quota_purchase')) === JSON.stringify(['unionpay']));
{
  const db = S.createDb();
  S.addUser(db, { id: 'u1', tier: 'vip', entitlement_state: 'never_paid' });
  // 不支持渠道 → 抛错
  let threw = false;
  try { PAY.createPayment(db, { bizType: 'entitlement', userId: 'u1', amount: 200, channel: 'unionpay', idempotencyKey: 'x1' }); } catch (e) { threw = true; }
  ok('权益单选银联 → 抛错（渠道不匹配）', threw);
  // live 创建 → CREATED + payParams
  const c1 = PAY.createPayment(db, { bizType: 'entitlement', userId: 'u1', amount: 200, channel: 'wechat', idempotencyKey: 'x2' });
  ok('live 创建 → CREATED（不自动入账）', c1.payment.status === 'CREATED' && c1.paid === false);
  ok('payParams 带 sandbox:false 与微信字段', c1.payParams.sandbox === false && c1.payParams.appId !== undefined);
  ok('未入账前权益仍未开通', IZ.entitlementState(db.users.u1) === 'never_paid');
  // 验签：错签拒收
  const bad = PAY.handleNotify(db, 'wechat', { paymentId: c1.payment.id, sign: 'deadbeef' });
  ok('错误签名通知 → 拒收', bad.ok === false);
  ok('拒收后仍未入账', c1.payment.status === 'CREATED');
  // 正确签名 → 入账 + 业务效果
  const payload = Object.keys({ paymentId: c1.payment.id, transactionId: 'tx_1' }).sort().map((k) => k + '=' + ({ paymentId: c1.payment.id, transactionId: 'tx_1' })[k]).join('&');
  const sign = crypto.createHmac('sha256', 'test-secret').update(payload).digest('hex');
  const good = PAY.handleNotify(db, 'wechat', { paymentId: c1.payment.id, transactionId: 'tx_1', sign });
  ok('正确签名通知 → 入账成功', good.ok === true && good.newlyPaid === true);
  ok('业务效果：权益开通 active', IZ.entitlementState(db.users.u1) === 'active');
  ok('编号重算（vip 档 → VIP）', /^VIP\d{4,}$/.test(db.users.u1.display_id));
  // 重复通知幂等
  const again = PAY.handleNotify(db, 'wechat', { paymentId: c1.payment.id, transactionId: 'tx_1', sign });
  ok('重复通知 → 幂等（不二次入账）', again.ok === true && again.newlyPaid === false);
  // 名额购买（银联）入账
  const before = Q.getBalance(db.quotaLedger, 'u1');
  const c2 = PAY.createPayment(db, { bizType: 'quota_purchase', userId: 'u1', amount: 350, channel: 'unionpay', idempotencyKey: 'x3', meta: { quantity: 1 } });
  const p2payload = 'paymentId=' + c2.payment.id;
  const sign2 = crypto.createHmac('sha256', 'test-secret').update(p2payload).digest('hex');
  const n2 = PAY.handleNotify(db, 'unionpay', { paymentId: c2.payment.id, sign: sign2 });
  ok('银联名额单通知入账', n2.ok === true && n2.effect && n2.effect.kind === 'quota_purchase');
  ok('名额余额 +1', Q.getBalance(db.quotaLedger, 'u1') === before + 1);
  // 年度权益
  const c3 = PAY.createPayment(db, { bizType: 'annual_fee', userId: 'u1', amount: 1980, channel: 'alipay', idempotencyKey: 'x4' });
  const sign3 = crypto.createHmac('sha256', 'test-secret').update('paymentId=' + c3.payment.id).digest('hex');
  const n3 = PAY.handleNotify(db, 'alipay', { paymentId: c3.payment.id, sign: sign3 });
  ok('年度权益通知入账', n3.ok === true && n3.effect && n3.effect.kind === 'annual_fee' && db.users.u1.annual_fee_paid === true);
  // 公开视图
  const v = PAY.publicPayment(c1.payment);
  ok('publicPayment 脱敏（无 payParams/notifyRaw）', v.channelName === '微信支付' && v.payParams === undefined && v.status === 'PAID');
}

// ───────────── 2. HTTP 端到端（sandbox 默认模式） ─────────────
async function httpTests() {
  const srv = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT, env: { ...process.env, PORT: String(PORT), PAYMENT_MODE: 'sandbox', EXPOSE_DEV_CODE: '1' }, stdio: 'ignore',
  });
  const boot = Date.now();
  while (Date.now() - boot < 15000) {
    try { const r = await fetch(BASE + '/'); if (r.ok) break; } catch (e) { /* retry */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  try {
    const admin = (await req('POST', '/auth/sessions', { body: { channel: 'admin', password: 'admin888' } })).data.token;
    await req('POST', '/api/seed/reset', { token: admin });
    const P1 = (await parentLogin(req, '13800000001')).data.token;
    const P2 = (await parentLogin(req, '13800000002')).data.token;
    const P3 = (await parentLogin(req, '13800000003')).data.token;
    const P4 = (await parentLogin(req, '13800000004')).data.token;
    const P5 = (await parentLogin(req, '13800000005')).data.token;
    console.log('\n[2] HTTP · sandbox 模式（' + PORT + '）');

    // ── 支付：200 权益（默认微信） ──
    const phone = '139' + String(Math.floor(10000000 + Math.random() * 89999999));
    const _code = (await req('POST', '/auth/sms-challenges', { body: { phone, purpose: 'register' } })).data.devCode;
    const reg = await req('POST', '/auth/registrations', { body: { phone, code: _code, password: 'abc123', name: '支付自测', inviteCode: '13800000001' } });
    const T = reg.data.token;
    ok('注册 → QZ（未开通）', /^QZ\d{4,}$/.test(reg.data.user.displayId));
    const e1 = await req('POST', '/me/entitlement-orders', { token: T, body: { idempotencyKey: 'pay-ent-1' } });
    ok('sandbox 权益单 → SUCCEEDED（默认微信）', e1.data.status === 'SUCCEEDED' && e1.data.channel === 'wechat', e1.data);
    ok('支付单 id 即 operationId', !!e1.data.paymentId && e1.data.operationId === e1.data.paymentId);
    ok('开通后编号 → VIP（注册默认 vip 档）', /^VIP\d{4,}$/.test(e1.data.displayId));
    const e1b = await req('POST', '/me/entitlement-orders', { token: T, body: { idempotencyKey: 'pay-ent-1', channel: 'alipay' } });
    ok('同 key 重下 → 幂等（同 paymentId，不换渠道）', e1b.data.paymentId === e1.data.paymentId && e1b.data.channel === 'wechat');
    const e2 = await req('POST', '/me/entitlement-orders', { token: T, body: { idempotencyKey: 'pay-ent-2', channel: 'unionpay' } });
    ok('权益单选银联 → 400（渠道不支持）', e2.status === 400);
    const e3 = await req('POST', '/me/entitlement-orders', { token: T, body: { idempotencyKey: 'pay-ent-3', channel: 'alipay' } });
    ok('权益单选支付宝 → SUCCEEDED', e3.data.status === 'SUCCEEDED' && e3.data.channel === 'alipay');
    // 支付单查询
    const plist = await req('GET', '/me/payments', { token: T });
    ok('我的支付单列表（2 笔）', plist.data.items.length === 2 && plist.data.paymentMode === 'sandbox');
    const pget = await req('GET', '/me/payments/' + e1.data.paymentId, { token: T });
    ok('支付单详情 → PAID + 渠道名', pget.data.payment.status === 'PAID' && pget.data.payment.channelName === '微信支付');
    // 通知端点幂等（已支付单）
    const n1 = await req('POST', '/payments/notify/wechat', { body: { paymentId: e1.data.paymentId, transactionId: 'tx_dup' } });
    ok('已支付单重复通知 → ok 且 newlyPaid=false', n1.data.ok === true && n1.data.newlyPaid === false);

    // ── 支付：年度权益 ──
    const an = await req('POST', '/partner/entitlement-orders', { token: P1, body: { contextId: 'partner:p1', idempotencyKey: 'pay-annual-1' } });
    ok('年度权益单 → SUCCEEDED', an.data.status === 'SUCCEEDED' && !!an.data.orderId && !!an.data.validUntil);

    // ── 支付：联创向总部购买名额（银联） ──
    const qo = await req('POST', '/partner/quota-orders', { token: P1, body: { contextId: 'partner:p1', quantity: 3, idempotencyKey: 'pay-qo-1' } });
    ok('名额购买（默认银联）→ SUCCEEDED，余额 503', qo.data.status === 'SUCCEEDED' && qo.data.channel === 'unionpay' && qo.data.balances.standardRemaining === 503, qo.data);
    const qo2 = await req('POST', '/partner/quota-orders', { token: P1, body: { contextId: 'partner:p1', quantity: 1, idempotencyKey: 'pay-qo-2', channel: 'wechat' } });
    ok('名额购买选微信 → 400（仅银联）', qo2.status === 400);
    const opt = await req('GET', '/partner/quota-purchase-options?contextId=partner:p1', { token: P1 });
    ok('购买选项渠道 = [unionpay]', JSON.stringify(opt.data.allowedPaymentChannelIds) === JSON.stringify(['unionpay']));

    // ── 激活码：总部批量发码 ──
    const a1 = await req('POST', '/admin/activation-codes', { token: admin, body: { targetType: 'fs', count: 2, note: '总部补货' } });
    ok('admin 批量发 2 个粉丝码', a1.status === 200 && a1.data.codes.length === 2 && a1.data.codes.every((c) => /^NS-FS-[0-9A-Z]{6}$/.test(c)), a1.data.codes);
    ok('发码记录 channel=admin', a1.data.records.every((r) => r.channel === 'admin'));

    // p2 加孩子，用总部码激活
    const mk = await req('POST', '/members', { token: P2, body: { name: '乙娃', gradeCode: 'G1', genderCode: 'male', idempotencyKey: 'pc-mb-1' } });
    const kid2 = mk.data.member.id;
    const act1 = await req('POST', '/activations', { token: P2, body: { code: a1.data.codes[0], targetType: 'fs', memberId: kid2, idempotencyKey: 'pc-act-1' } });
    ok('总部码激活成功', act1.status === 200 && act1.data.unlocked === true);
    const b2 = await req('GET', '/me/bootstrap', { token: P2 });
    ok('p2 编号跟着孩子 → FS0002', b2.data.displayId === 'FS0002', b2.data.displayId);

    // ── 绑定码：仅被绑家长可用 ──
    const a2 = await req('POST', '/admin/activation-codes', { token: admin, body: { targetType: 'fs', count: 1, issuedTo: 'p4' } });
    const bound = a2.data.codes[0];
    const mk4 = await req('POST', '/members', { token: P4, body: { name: '丁娃', gradeCode: 'K1', genderCode: 'female', idempotencyKey: 'pc-mb-4' } });
    const kid4 = mk4.data.member.id;
    const actWrong = await req('POST', '/activations', { token: P2, body: { code: bound, targetType: 'fs', memberId: kid2, idempotencyKey: 'pc-act-wrong' } });
    ok('别人用绑定码 → 403', actWrong.status === 403);
    const prevWrong = await req('POST', '/activations/preview', { token: P2, body: { code: bound, memberId: kid2 } });
    ok('绑定码预览也被拦 → 403', prevWrong.status === 403);
    const actRight = await req('POST', '/activations', { token: P4, body: { code: bound, targetType: 'fs', memberId: kid4, idempotencyKey: 'pc-act-right' } });
    ok('被绑家长激活 → 200', actRight.status === 200);
    const mine = await req('GET', '/me/activation-codes', { token: P4 });
    ok('家长可查绑定自己的码', mine.data.items.some((r) => r.code === bound && r.uses === 1));

    // ── 门店收款发码（p5 区县代） ──
    const s1 = await req('POST', '/agency/activation-codes', { token: P5, body: { contextId: 'agency:p5', targetType: 'fs', count: 1, note: '门店收款 19.9' } });
    ok('区县代门店发粉丝码成功', s1.status === 200 && /^NS-FS-/.test(s1.data.codes[0]) && s1.data.storeId === '330110', s1.data);
    const s2bad = await req('POST', '/agency/activation-codes', { token: P5, body: { contextId: 'agency:p5', targetType: 'cj', count: 1 } });
    ok('门店发超级码 → 400（仅 fs/jy）', s2bad.status === 400);
    const s3bad = await req('POST', '/agency/activation-codes', { token: P4, body: { contextId: 'partner:p4', targetType: 'fs', count: 1 } });
    ok('非代理身份发码 → 403', s3bad.status === 403);
    const mk5 = await req('POST', '/members', { token: P5, body: { name: '戊娃', gradeCode: 'G2', genderCode: 'male', idempotencyKey: 'pc-mb-5' } });
    const kid5 = mk5.data.member.id;
    const act5 = await req('POST', '/activations', { token: P5, body: { code: s1.data.codes[0], targetType: 'fs', memberId: kid5, idempotencyKey: 'pc-act-5' } });
    ok('门店码激活成功（散客）', act5.status === 200);
    const aglist = await req('GET', '/agency/activation-codes?contextId=agency:p5', { token: P5 });
    ok('门店已发码列表可查', aglist.data.items.length === 1 && aglist.data.items[0].channel === 'store');

    // ── 上级赠码（p1 → p2 赠 cj；p3 → p4 赠 xn 被档位拦） ──
    const g1 = await req('POST', '/partner/gift-codes', { token: P1, body: { contextId: 'partner:p1', targetType: 'cj', toUserId: 'p2' } });
    ok('p1 给直属下级 p2 赠超级码', g1.status === 200 && g1.data.issuedTo === 'p2', g1.data);
    const actCj = await req('POST', '/activations', { token: P2, body: { code: g1.data.codes[0], targetType: 'cj', memberId: kid2, idempotencyKey: 'pc-act-cj' } });
    ok('p2 用赠码激活超级会员', actCj.status === 200);
    const b2b = await req('GET', '/me/bootstrap', { token: P2 });
    ok('p2 编号 → CJ0002（跟着最高孩子）', b2b.data.displayId === 'CJ0002', b2b.data.displayId);
    const g2 = await req('POST', '/partner/gift-codes', { token: P3, body: { contextId: 'partner:p3', targetType: 'xn', toUserId: 'p4' } });
    ok('赠行能码给 VIP 家长 → 403（需天使）', g2.status === 403);
    const g3 = await req('POST', '/partner/gift-codes', { token: P1, body: { contextId: 'partner:p1', targetType: 'cj', toUserId: 'p4' } });
    ok('给非直属下级赠码 → 403', g3.status === 403);
    const g4 = await req('POST', '/partner/gift-codes', { token: P1, body: { contextId: 'partner:p1', targetType: 'fs', toUserId: 'p2' } });
    ok('上级赠粉丝码 → 400（粉丝/菁英走门店）', g4.status === 400);
    const glist = await req('GET', '/partner/gift-codes?contextId=partner:p1', { token: P1 });
    ok('上级赠码记录可查', glist.data.items.length === 1 && glist.data.items[0].channel === 'upline');

    // ── 作废 + 统计 ──
    const a3 = await req('POST', '/admin/activation-codes', { token: admin, body: { targetType: 'jy', count: 1 } });
    const v1 = await req('POST', '/admin/activation-codes/' + a3.data.codes[0] + '/void', { token: admin, body: {} });
    ok('作废激活码成功', v1.data.status === 'void');
    const actVoid = await req('POST', '/activations', { token: P2, body: { code: a3.data.codes[0], targetType: 'jy', memberId: kid2, idempotencyKey: 'pc-act-void' } });
    ok('已作废码激活 → 400', actVoid.status === 400);
    const st = await req('GET', '/admin/activation-codes', { token: admin });
    ok('总部激活码统计（total/used/void）', st.data.stats.total >= 5 && st.data.stats.used >= 4 && st.data.stats.void === 1, st.data.stats);
    // 收尾：先重置种子（服务还活着，重置才生效），再杀服务——避免把测试残留留给下一个脚本
    await req('POST', '/api/seed/reset', { token: admin }).catch(() => {});
  } finally {
    srv.kill();
  }
}

(async () => {
  await httpTests();
  console.log(`\n支付+激活码验证: PASS=${pass} FAIL=${fail}`);
  process.exit(fail ? 1 : 0);
})();

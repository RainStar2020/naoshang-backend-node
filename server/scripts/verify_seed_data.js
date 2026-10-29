#!/usr/bin/env node
/**
 * 脑商AI · 种子数据可用性验证
 *
 * 用真实 HTTP 接口逐个登录种子账号，验证：
 *   ① 能登录并拿到 token
 *   ② 商城目录返回「你的价」，且价格与身份一致（代理 > 合伙人 > 原价）
 *   ③ 孩子编号前缀跟随孩子等级（家长 display_id 前缀 = 孩子最高等级前缀）
 *   ④ 权益门禁：never_paid 账号被锁，active 账号正常
 *   ⑤ 报价金额 = 目录「你的价」= 下单实付
 */
const BASE = process.env.SEED_BASE || 'http://127.0.0.1:3000';

/** 期望矩阵：手机号 → { 身份标签, 实付价, 孩子前缀|null } */
const EXPECT = [
  { phone: '13900001001', label: '联创合伙人', paid: 4537, childPrefix: 'YS' },
  { phone: '13900001002', label: '省代', paid: 2094, childPrefix: 'FS' },
  { phone: '13900001003', label: '单店代理', paid: 3490, childPrefix: 'JY' },
  { phone: '13900001004', label: '私董合伙人', paid: 4886, childPrefix: 'CJ' },
  { phone: '13900001005', label: '天使合伙人', paid: 5235, childPrefix: 'XN' },
  // 孩子是「普通会员」（score=0）→ 家长编号前缀**不跟随**，仍是 VIP0035
  { phone: '13900001006', label: 'VIP合伙人(孩子普通·前缀不跟随)', paid: 5584, childPrefix: 'VIP' },
  { phone: '13900001007', label: '普通家长+超级孩子', paid: 6980, childPrefix: 'CJ' },
  { phone: '13900001008', label: '普通家长(未开通权益)', paid: null, childPrefix: 'QZ', locked: true },
  { phone: '13900001009', label: '普通家长(无孩子)', paid: 6980, childPrefix: null },
  { phone: '13900001010', label: '区县代理', paid: 2792, childPrefix: 'CJ' },
  { phone: '13900001011', label: '地市代理', paid: 2443, childPrefix: 'FS' },
];

const { parentLogin, TEST_LOGIN_PASSWORD } = require('./loginKit.cjs');
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.log('  ✗ ' + msg); } };

async function call(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(BASE + path, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await res.text();
  let json = null;
  try { json = JSON.parse(txt); } catch (e) { json = null; }
  return { status: res.status, body: json, raw: txt };
}

(async () => {
  console.log('════ 种子数据可用性验证（' + BASE + '）════');
  console.log('');

  for (const exp of EXPECT) {
    console.log('【' + exp.label + '】' + exp.phone);
    // ① 登录
    const _r1 = await parentLogin((m, p, o) => call(m, p, o && o.body, o && o.token).then(r => ({ status: r.status, data: r.body })), exp.phone, TEST_LOGIN_PASSWORD);
    const r1 = { status: _r1.status, body: _r1.data, raw: JSON.stringify(_r1.data) };
    if (r1.status !== 200) { ok(false, '登录失败 status=' + r1.status + ' ' + r1.raw.slice(0, 80)); console.log(''); continue; }
    const token = r1.body.token;
    ok(!!token, '登录成功');

    // ② 编号前缀
    const displayId = r1.body.user?.displayId || '';
    if (exp.childPrefix) {
      ok(displayId.startsWith(exp.childPrefix), `家长编号 ${displayId} 前缀应跟孩子走 ${exp.childPrefix}`);
    } else {
      ok(!exp.childPrefix && displayId.length > 0, `家长编号 ${displayId}（无孩子，不应跟孩子走）`);
    }

    // ③ 商城目录 + 你的价
    const r2 = await call('GET', '/catalog', null, token);
    if (exp.locked) {
      ok(r2.body?.locked === true, '权益门禁生效 locked=true');
      console.log('');
      continue;
    }
    ok(r2.status === 200 && Array.isArray(r2.body?.items), '商城目录返回 ' + ((r2.body?.items || []).length) + ' 项');
    const pad = (r2.body?.items || []).find((i) => i.id === 'pad');
    ok(!!pad?.viewerPrice, '商品带 viewerPrice');
    const unit = pad?.viewerPrice?.unitAmount / 100;
    ok(unit === exp.paid, `你的价 = ${unit}（期望 ${exp.paid}）标注：${pad?.viewerPrice?.identityLabel || '-'} ${pad?.viewerPrice?.discountLabel || ''}`);

    // ④ 报价 = 你的价
    const r3 = await call('POST', '/checkout/quotes', { productKey: 'pad', quantity: 1 }, token);
    const payable = r3.body?.payableAmount;
    ok(payable === unit, `报价 ${payable} = 你的价 ${unit}`);

    // ⑤ 下单 = 报价
    if (r3.body?.id) {
      const r4 = await call('POST', '/orders', {
        quoteId: r3.body.id, idempotencyKey: 'seedcheck-' + Date.now() + '-' + exp.phone,
        productKey: 'pad', quantity: 1,
      }, token);
      const order = r4.body?.order || r4.body;
      ok(order?.paid === payable, `下单实付 ${order?.paid} = 报价 ${payable}`);
    }

    // ⑥ 孩子列表
    const r5 = await call('GET', '/members', null, token);
    const members = r5.body?.members || r5.body || [];
    if (Array.isArray(members) && members.length) {
      const m = members[0];
      ok(!!m.memberLevel, `孩子 ${m.name || m.displayId || ''} 会员等级 = ${m.memberLevel}`);
    }
    console.log('');
  }

  console.log('════════════════════════════════════');
  console.log(`结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('验证脚本异常：', e); process.exit(1); });

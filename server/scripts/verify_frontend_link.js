/**
 * 前后端连通性端到端自测（2026-10-27）
 *
 * 用**前端实际使用的地址**（.env 的 VITE_API_BASE_URL，默认 http://192.168.0.44:3000）
 * 跑通商城全链路：注册 → 登录 → 开通 200 权益 → 目录 → 详情 → 结算选项 → 报价 → 下单，
 * 并校验「目录 viewerPrice（你的价）= 报价金额 = 下单实付」三者一致。
 *
 * 运行：node scripts/verify_frontend_link.js            （需先启动后端）
 *      BASE=http://127.0.0.1:3000 node scripts/verify_frontend_link.js
 */
const BASE = process.env.BASE || 'http://192.168.0.44:3000';
const H = { 'Content-Type': 'application/json' };
const PHONE = process.env.PHONE || ('139' + String(Date.now()).slice(-8));
const PASSWORD = 'test123456';

const { parentLogin } = require('./loginKit.cjs');
let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log(`  ✓ ${label}${extra ? ' ' + extra : ''}`); }
  else { fail++; console.log(`  ✗ ${label}${extra ? ' ' + extra : ''}`); }
}
function head(t) { console.log(`\n===== ${t} =====`); }

async function call(method, path, data, token) {
  const opt = { method, headers: { ...H }, body: data ? JSON.stringify(data) : undefined };
  // ⚠️ 必须带 Content-Length：否则 Node 用 chunked 传输，后端 readBody 读不到 body
  //    → 400「需 phone 与 purpose」→ 联调用例全挂。
  if (data) opt.headers['Content-Length'] = Buffer.byteLength(opt.body);
  if (token) opt.headers.Authorization = 'Bearer ' + token;
  const res = await fetch(BASE + path, opt);
  const txt = await res.text();
  let j = null; try { j = JSON.parse(txt); } catch (e) {}
  return { status: res.status, body: j, raw: txt };
}

(async () => {
  head(`前后端连通性（BASE=${BASE}）`);
  // ① 注册（先取短信验证码；开发环境用 EXPOSE_DEV_CODE=1 从响应取 devCode）
  let r = await call('POST', '/auth/sms-challenges', { phone: PHONE, purpose: 'register' });
  const devCode = r.body && r.body.devCode;
  ok('① 发短信验证码', r.status === 200 && !!devCode, devCode ? 'devCode=' + devCode : '未返回 devCode（需 EXPOSE_DEV_CODE=1）');
  r = await call('POST', '/auth/registrations', { phone: PHONE, code: devCode, password: PASSWORD, channel: 'parent' });
  ok('② 注册（带验证码）', r.status === 200, r.status === 200 ? '' : JSON.stringify(r.body));

  // ② 登录（账号密码登录：手机号 + 密码）
  r = await parentLogin((m, p, o) => call(m, p, o && o.body, o && o.token).then(r => ({ status: r.status, data: r.body })), PHONE, PASSWORD);
  const token = r.data && r.data.token;
  ok('③ 登录拿 token', !!token, token ? `user=${JSON.stringify(r.data.user)}` : JSON.stringify(r.data).slice(0, 100));
  if (!token) { console.log('\n无法继续：登录失败'); process.exit(1); }

  // ③ 开通 200 权益（沙箱自动成功）—— 否则全站门禁 locked:true，商城看不到
  r = await call('POST', '/me/entitlement-orders', { idempotencyKey: 'ent-' + Date.now(), channel: 'wechat' }, token);
  const st = r.body.status;
  ok('④ 开通 200 权益', st === 'SUCCEEDED', `status=${st}`);

  // ④ 商城目录 + viewerPrice（注意：后端响应体直出顶层，无 data 包装层）
  r = await call('GET', '/catalog', null, token);
  const items = r.body.items;
  ok('⑤ 商城目录', r.status === 200 && Array.isArray(items) && items.length > 0,
    items ? `items=${items.length}` : `locked=${r.body.locked}`);
  const pad = items && items.find((i) => i.id === 'pad');
  ok('   脑商Pad 返回 viewerPrice（你的价）', !!(pad && pad.viewerPrice),
    pad && pad.viewerPrice ? `${pad.viewerPrice.unitAmount / 100} / ${pad.viewerPrice.identityLabel} ${pad.viewerPrice.discountLabel || ''}` : '');

  // ⑤ 商品详情
  r = await call('GET', '/products/pad', null, token);
  ok('⑥ 商品详情', r.status === 200 && !!r.body.title, r.body.title || r.raw.slice(0, 60));

  // ⑥ 结算选项
  r = await call('GET', '/checkout/options', null, token);
  const opt = r.body;
  ok('⑦ 结算选项', r.status === 200 && Array.isArray(opt.members), `members=${(opt.members || []).length} stores=${(opt.stores || []).length}`);

  // ⑦ 报价
  r = await call('POST', '/checkout/quotes', { productKey: 'pad', quantity: 1 }, token);
  const q = r.body;
  ok('⑧ 报价', r.status === 200 && q.payableAmount != null, `应付=${q.payableAmount}`);
  ok('   报价金额 = 目录「你的价」', pad && pad.viewerPrice && Math.abs(q.payableAmount - pad.viewerPrice.unitAmount / 100) < 0.01,
    `报价 ${q.payableAmount} vs 你的价 ${pad && pad.viewerPrice ? pad.viewerPrice.unitAmount / 100 : '—'}`);

  // ⑧ 下单
  if (q && q.id) {
    r = await call('POST', '/orders', { quoteId: q.id, idempotencyKey: 'link-' + Date.now(), productKey: 'pad', quantity: 1 }, token);
    const o = r.body.order;
    ok('⑨ 下单', r.status === 200 && !!(o && o.id), o ? `订单 ${o.id} 实付=${o.paid} 状态=${o.status}` : r.raw.slice(0, 120));
    ok('   下单实付 = 报价金额', o && Math.abs(o.paid - q.payableAmount) < 0.01, `下单 ${o && o.paid} vs 报价 ${q.payableAmount}`);
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`通过 ${pass} / 失败 ${fail}`);
  console.log('='.repeat(50));
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.log(`\n❌ 连通性异常：${e.message}${e.cause ? ' (' + e.cause.code + ')' : ''}`);
  console.log('提示：后端未启动？执行 cd server && node server.js');
  process.exit(1);
});

/**
 * 阶段七 HTTP 冒烟：多身份切换体系（2026-10-23）
 * 覆盖：admin 代下单（双折扣）→ admin 块身份端点代查（本次 404 修复回归）→
 *       分身份收益过滤不重不漏 → 任命第三身份 → 结算后三身份各有收益 →
 *       登录态自查 → 身份×折扣联动（任命代理后按代理价成交）。
 * 运行：node scripts/smoke_identities_http.js
 *   —— 2026-10-26 起脚本**自带服务自启/自收尾**（未检测到已在运行的实例时，
 *      用独立端口拉起一个临时 server.js，结束前 kill），可直接纳入全量回归。
 * 脚本自带 /api/seed/reset，可重复运行；跑完 db.json 即干净种子+本脚本测试数据。
 */
const { spawn } = require('child_process');
const path = require('path');

const SELF_PORT = Number(process.env.SMOKE_PORT || 3323);
const DEFAULT_BASE = 'http://127.0.0.1:' + (process.env.PORT || 3000);
let base = DEFAULT_BASE;
const ROOT = path.join(__dirname, '..');

/** 探测 BASE 是否已有服务；没有则自启一个临时实例 */
async function ensureServer() {
  try { const r = await fetch(DEFAULT_BASE + '/'); if (r.ok) return null; } catch (e) { /* 继续 */ }
  const srv = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT, env: { ...process.env, PORT: String(SELF_PORT) }, stdio: 'ignore',
  });
  const target = 'http://127.0.0.1:' + SELF_PORT;
  const t0 = Date.now();
  while (Date.now() - t0 < 15000) {
    try { const r = await fetch(target + '/'); if (r.ok) break; } catch (e) { /* retry */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  return { srv, base: target };
}
let pass = 0, fail = 0;
function chk(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓', name, extra !== undefined ? JSON.stringify(extra) : ''); }
  else { fail++; console.log('  ✗ FAIL:', name, extra !== undefined ? JSON.stringify(extra) : ''); }
}
async function api(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (e) { data = { _raw: 'non-json' }; }
  return { status: res.status, data };
}
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const AGENT_TYPES = ['agent', 'region_vip', 'region_goods_diff', 'region_signing', 'region_admin_delivery', 'region_costore'];
const PARTNER_TYPES = ['supply', 'parity', 'global', 'founding'];

(async () => {
  console.log('== 阶段七 HTTP 冒烟：多身份切换体系 ==\n');
  const auto = await ensureServer();
  if (auto) {
    base = auto.base;
    console.log('（未检测到运行中的服务，已自启临时实例 ' + base + '）\n');
  }
  const finish = () => { if (auto && auto.srv) { try { auto.srv.kill(); } catch (e) {} } };

  // ── 0. admin 登录 + 重置种子（保证可重复运行） ──
  const login = await api('/api/auth/login', { method: 'POST', body: { role: 'admin', password: 'admin888' } });
  chk('admin 登录', login.status === 200 && login.data.role === 'admin', login.data.name || login.data.error);
  const AT = login.data.token;
  const reset = await api('/api/seed/reset', { method: 'POST', token: AT });
  chk('重置干净种子', reset.status === 200 && reset.data.ok, reset.data.message || reset.data.error);

  // ── 1. admin 代下单：双身份买家按代理折扣 ──
  const po = await api('/api/order/product', { method: 'POST', token: AT, body: { buyerId: 'p6', productKey: 'pad', qty: 1 } });
  chk('admin 代下单 p6 Pad = 3490（天使+单店代理 → agent 5 折）',
    po.status === 200 && po.data.paid === 3490 && po.data.discount_kind === 'agent',
    { paid: po.data.paid, kind: po.data.discount_kind, err: po.data.error });
  const po2 = await api('/api/order/product', { method: 'POST', token: AT, body: { buyerId: 'p7', productKey: 'pad', qty: 1 } });
  chk('admin 代下单 p7 Pad = 5235（纯合伙人 → partner 7.5 折）',
    po2.status === 200 && po2.data.paid === 5235 && po2.data.discount_kind === 'partner',
    { paid: po2.data.paid, kind: po2.data.discount_kind, err: po2.data.error });

  // ── 2. admin 块身份端点代查（本次修复的 404 回归） ──
  const i6 = await api('/api/identities?userId=p6', { token: AT });
  chk('admin 代查 p6 身份 = 2（合伙人+代理）',
    i6.status === 200 && i6.data.identities.length === 2 && i6.data.identities.every((x) => ['partner', 'agent'].includes(x.key)),
    i6.data.identities ? i6.data.identities.map((x) => x.key) : i6.data.error);
  const i7 = await api('/api/identities?userId=p7', { token: AT });
  chk('admin 代查 p7 身份 = 2（合伙人+合店老板）',
    i7.status === 200 && i7.data.identities.length === 2 && i7.data.identities.every((x) => ['partner', 'costore'].includes(x.key)),
    i7.data.identities ? i7.data.identities.map((x) => x.key) : i7.data.error);
  const bad = await api('/api/identities', { token: AT });
  chk('admin 缺 userId 代查返回 400', bad.status === 400 && !!bad.data.error, bad.data.error);

  // ── 3. 造收入场景：p8（VIP）挂到 p7 名下；p7 任命为 D2 单店代理；p8 在 D2 下单 ──
  const addP8 = await api('/api/partner', { method: 'POST', token: AT, body: { name: 'VIP-辛', phone: '13800000008', tier: 'vip', upline_id: 'p7', quota: 0 } });
  chk('新增 p8（VIP，上级 p7）', addP8.status === 200 && addP8.data.user && addP8.data.user.upline_id === 'p7',
    addP8.data.user ? addP8.data.user.id : addP8.data.error);
  const p8id = addP8.data.user ? addP8.data.user.id : 'p8';
  const app = await api('/api/agent/appoint', { method: 'POST', token: AT, body: { partnerId: 'p7', regionType: 'store', regionCode: 'D2' } });
  chk('任命 p7 为 D2 单店代理（第三身份）', app.status === 200 && app.data.ok !== false && app.data.agent && app.data.agent.region_code === 'D2',
    app.data.agent || app.data.error);
  const o8 = await api('/api/order', { method: 'POST', token: AT, body: { buyerId: p8id, packageTier: 'vip', oldTier: null, rawQuota: 1, regionCode: 'D2', buyerIsNew: true } });
  chk('p8 在 D2 购买 VIP 套餐（实付 7980）', o8.status === 200 && o8.data.order_id, o8.data.error || { order_id: o8.data.order_id, paid: o8.data.actual_paid });

  // ── 4. 月度结算（幂等）：p6 门店费 / p7 合店分红+门店费+合伙人收益 ──
  const st = await api('/api/settle', { method: 'POST', token: AT, body: {} });
  chk('月度结算执行', st.status === 200 && st.data.ok !== false, { settleCount: st.data.summary && st.data.summary.settleCount });

  // ── 5. 结算后身份收益分离断言 ──
  const i6b = await api('/api/identities?userId=p6', { token: AT });
  const p6ag = (i6b.data.identities || []).find((x) => x.key === 'agent');
  const p6pt = (i6b.data.identities || []).find((x) => x.key === 'partner');
  // 门店服务费只在「门店老板」身份售出时计提（用户 2026-10-23 16:56）：
  // 种子三单 T1/T2/T3 的卖方分别是 p3（天使）、p5（私董/区县代）、p3（天使）——都不是门店老板
  // ⇒ 全部走合伙人售卖通道，p6（D1 门店老板）拿不到门店服务费。
  chk('p6 代理身份收益 = 0（D1 三单均非门店老板售出，无门店服务费）', p6ag && p6ag.month_income === 0, p6ag && p6ag.by_type);
  chk('p6 合伙人身份收益 = 0（无人挂其名下）', p6pt && p6pt.month_income === 0, p6pt && p6pt.by_type);
  chk('p6 身份收益合计 = 0', round2(i6b.data.total_month_income) === 0, i6b.data.total_month_income);

  const i7b = await api('/api/identities?userId=p7', { token: AT });
  chk('p7 任命后三身份齐全', i7b.status === 200 && i7b.data.identities.length === 3
    && ['partner', 'agent', 'costore'].every((k) => i7b.data.identities.some((x) => x.key === k)),
    i7b.data.identities ? i7b.data.identities.map((x) => x.key) : i7b.data.error);
  const p7pt = (i7b.data.identities || []).find((x) => x.key === 'partner');
  const p7ag = (i7b.data.identities || []).find((x) => x.key === 'agent');
  const p7cs = (i7b.data.identities || []).find((x) => x.key === 'costore');
  chk('p7 合伙人身份收益 > 0（p8 套餐：仅供货差价，无直推奖）', p7pt && p7pt.month_income > 0, p7pt && p7pt.by_type);
  chk('p7 代理身份收益 = 2400（D2 门店服务费）', p7ag && p7ag.month_income === 2400, p7ag && p7ag.by_type);
  // 合店费一次性入池（2026-10-26 口径）：698×6=4188 一次性进入分红池 → 分红池 10% = 418.8
  chk('p7 合店身份收益 = 418.8（合店费 4188 一次性入池 × 10%）', p7cs && p7cs.month_income === 418.8, p7cs && p7cs.by_type);
  chk('p7 三身份收益合计 = 全量', round2(i7b.data.identities.reduce((s, x) => s + x.month_income, 0)) === i7b.data.total_month_income,
    { per: i7b.data.identities.map((x) => [x.key, x.month_income]), total: i7b.data.total_month_income });

  // ── 6. 分身份收益过滤：不重不漏、类型纯净 ──
  const c7all = await api('/api/commissions?userId=p7', { token: AT });
  const c7ag = await api('/api/commissions?userId=p7&identity=agent', { token: AT });
  const c7pt = await api('/api/commissions?userId=p7&identity=partner', { token: AT });
  const c7cs = await api('/api/commissions?userId=p7&identity=costore', { token: AT });
  chk('p7 代理身份明细仅含代理类佣金',
    c7ag.status === 200 && c7ag.data.list.length > 0 && c7ag.data.list.every((c) => AGENT_TYPES.includes(c.type) || (c.type === 'product' && c.subtype !== 'partner_product')),
    { n: c7ag.data.list.length, total: c7ag.data.total, types: Object.keys(c7ag.data.byType) });
  chk('p7 合伙人身份明细仅含合伙人类佣金',
    c7pt.status === 200 && c7pt.data.list.length > 0 && c7pt.data.list.every((c) => PARTNER_TYPES.includes(c.type) || (c.type === 'product' && c.subtype === 'partner_product')),
    { n: c7pt.data.list.length, total: c7pt.data.total, types: Object.keys(c7pt.data.byType) });
  chk('p7 合店身份明细仅含合店佣金',
    c7cs.status === 200 && c7cs.data.list.length > 0 && c7cs.data.list.every((c) => c.type === 'costore'),
    { n: c7cs.data.list.length, total: c7cs.data.total });
  chk('p7 三身份明细之和 = 全量（不重不漏）',
    round2(c7ag.data.total + c7pt.data.total + c7cs.data.total) === c7all.data.total
      && (c7ag.data.list.length + c7pt.data.list.length + c7cs.data.list.length) === c7all.data.list.length,
    { agent: c7ag.data.total, partner: c7pt.data.total, costore: c7cs.data.total, all: c7all.data.total });

  // ── 7. p7 登录态自查三身份 ──
  const ul = await api('/api/auth/login', { method: 'POST', body: { role: 'user', phone: '13800000007' } });
  chk('p7 用户登录', ul.status === 200 && ul.data.userId === 'p7', ul.data.name || ul.data.error);
  const UT = ul.data.token;
  const me7 = await api('/api/identities', { token: UT });
  chk('p7 登录态自查三身份', me7.status === 200 && me7.data.identities.length === 3,
    me7.data.identities ? me7.data.identities.map((x) => x.key) : me7.data.error);
  const selfAg = await api('/api/commissions?identity=agent', { token: UT });
  chk('p7 登录态分身份收益（agent = 2400）', selfAg.status === 200 && selfAg.data.total === 2400, selfAg.data.total);

  // ── 8. 身份×折扣联动：p7 任命代理后再买 Pad → 代理 5 折 3490 ──
  const po3 = await api('/api/order/product', { method: 'POST', token: UT, body: { productKey: 'pad', qty: 1 } });
  chk('p7 三身份买家下单 Pad = 3490（代理折扣优先于合伙人 7.5 折）',
    po3.status === 200 && po3.data.paid === 3490 && po3.data.discount_kind === 'agent',
    { paid: po3.data.paid, kind: po3.data.discount_kind, err: po3.data.error });

  // ── 9. 产品分润笔带 subtype（前端身份归属展示依赖） ──
  const c5 = await api('/api/commissions?userId=p5', { token: AT });
  const poC = (c5.data.list || []).filter((c) => c.type === 'product');
  chk('p5 产品分润笔带 subtype（p6 Pad 单 → partner_product 523.5）',
    poC.length > 0 && poC.every((c) => !!c.subtype) && poC.some((c) => c.subtype === 'partner_product' && c.amount === 523.5),
    poC.map((c) => [c.subtype, c.amount]));

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  finish();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('冒烟异常：', e); process.exit(1); });

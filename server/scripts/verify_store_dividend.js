/**
 * 门店分润归属回归（2026-10-27 拍板规则）
 *
 * 验证：商城下单时「收银台选中的门店」驱动分润归属——
 *   · 门店即单店，拿单店份额（特色产品 = 65%）
 *   · 门店 region_code 对应的省/市/区县代理拿各自份额（省2%/市8%/区县10%）
 *   · 门店老板同时兼任区域代理时，省/市/区县份额仍记入该代理账户（区域代理模块），
 *     与门店收益【分两笔、不合并】
 *   · 全部 100% 闭环（落账合计 = 实付）
 *
 * 与旧用例不同：本用例用「层级 region_code」（省11 / 市1101 / 区县110101 / 单店110101），
 * 且仅传 storeId、不传 regionCode（模拟前端收银台只选门店）。
 */
const S = require('../src/store');
const R = require('../src/routes');

let pass = 0, fail = 0;
function eq(label, actual, expected) {
  const ok = typeof expected === 'number' ? Math.abs(actual - expected) < 0.01 : actual === expected;
  if (ok) { pass++; console.log(`  ✓ ${label} = ${actual}`); }
  else { fail++; console.log(`  ✗ ${label} 实际=${actual} 期望=${expected}`); }
}
function ok(label, cond, extra) {
  if (cond) { pass++; console.log(`  ✓ ${label}${extra ? ' ' + extra : ''}`); }
  else { fail++; console.log(`  ✗ ${label}${extra ? ' ' + extra : ''}`); }
}
function head(t) { console.log(`\n===== ${t} =====`); }

function buildDb() {
  const db = S.createDb();
  S.addUser(db, { id: 'p1', tier: 'cofounder', phone: '1' });            // 联创（买家上级）
  S.addUser(db, { id: 'buyer', tier: 'vip', phone: '2', upline_id: 'p1' });

  // 层级区域：省 11 / 市 1101 / 区县 110101 / 单店 110101
  S.addUser(db, { id: 'prov', tier: 'angel', phone: '3' });
  S.appointAgent(db, { partnerId: 'prov', regionType: 'province', regionCode: '11' });
  S.addUser(db, { id: 'city', tier: 'angel', phone: '4' });
  S.appointAgent(db, { partnerId: 'city', regionType: 'city', regionCode: '1101' });
  S.addUser(db, { id: 'dist', tier: 'private', phone: '5' });
  S.appointAgent(db, { partnerId: 'dist', regionType: 'district', regionCode: '110101' });
  S.addUser(db, { id: 'store', tier: 'angel', phone: '6' });
  S.appointAgent(db, { partnerId: 'store', regionType: 'store', regionCode: '110101' });
  return db;
}
// 模拟前端：/checkout/options 返回的门店 id 即 region_code，下单时把它作为 storeId 传回
const storeAgentId = (db) => db.regionalAgents.find((a) => a.region_type === 'store' && a.partner_id === 'store').region_code;

head('A. 选中门店驱动分润：门店拿单店65%，省/市/区县归对应代理');
{
  const db = buildDb();
  const sid = storeAgentId(db);
  // 仅传 storeId，不传 regionCode（模拟前端收银台只选门店）
  const r = R.createProductOrder(db, { buyerId: 'buyer', productKey: 'featured', qty: 1, storeId: sid });
  const net = r.paid - r.rows.find((x) => x.role === 'partner_product').amount; // 884
  eq('成交价 = 1300×0.8 = 1040', r.paid, 1040);
  eq('净可分池 = 884', net, 884);
  eq('总部 15% = 132.6 → HQ', r.rows.find((x) => x.role === 'featured_hq').amount, 132.6);
  eq('省代 2% = 17.68 → prov（层级前缀匹配命中）', r.rows.find((x) => x.role === 'featured_province').amount, 17.68);
  eq('省代收款方 = prov', r.rows.find((x) => x.role === 'featured_province').owner_id, 'prov');
  eq('市代 8% = 70.72 → city', r.rows.find((x) => x.role === 'featured_city').amount, 70.72);
  eq('市代收款方 = city', r.rows.find((x) => x.role === 'featured_city').owner_id, 'city');
  eq('区县管理 5% = 44.2 → dist', r.rows.find((x) => x.role === 'featured_district_mgmt').amount, 44.2);
  eq('区县巡查 5% = 44.2 → dist', r.rows.find((x) => x.role === 'featured_district_inspect').amount, 44.2);
  eq('门店交付 30% = 265.2 → store', r.rows.find((x) => x.role === 'featured_store_delivery').amount, 265.2);
  eq('门店流量 30% = 265.2 → store', r.rows.find((x) => x.role === 'featured_store_traffic').amount, 265.2);
  eq('店长销售 5% = 44.2 → store', r.rows.find((x) => x.role === 'featured_store_sales').amount, 44.2);
  eq('门店合计 65% = 574.6 → store', r.byRecipient.store, 574.6);
  ok('100% 闭环（落账=实付）', r.closure === true, `total=${r.total}`);
  // 验证佣金已按 owner 落库
  const storeComms = db.commissions.filter((c) => c.owner_id === 'store');
  ok('门店佣金已落库（单店65% 部分）', storeComms.length === 3 && Math.abs(storeComms.reduce((s, c) => s + c.amount, 0) - 574.6) < 0.01);
  const provComms = db.commissions.filter((c) => c.owner_id === 'prov');
  ok('省代佣金已落库（2%）', provComms.length === 1 && Math.abs(provComms[0].amount - 17.68) < 0.01);
}

head('B. 门店老板兼任省代：省/市/区县份额仍归代理账户，与门店收益分两笔不合并');
{
  const db = buildDb();
  // 让 store 用户同时兼任省代（同一人两个区域身份）
  S.appointAgent(db, { partnerId: 'store', regionType: 'province', regionCode: '11' });
  const sid = storeAgentId(db);
  const r = R.createProductOrder(db, { buyerId: 'buyer', productKey: 'featured', qty: 1, storeId: sid });
  const storeComms = db.commissions.filter((c) => c.owner_id === 'store');
  const total = storeComms.reduce((s, c) => s + c.amount, 0);
  // 门店收益（单店65%）+ 省代收益（2%）都归同一人，但必须是【分开的记录】
  const storeOnly = storeComms.filter((c) => ['featured_store_delivery', 'featured_store_traffic', 'featured_store_sales'].includes(c.subtype));
  const provinceCut = storeComms.filter((c) => c.subtype === 'featured_province');
  eq('同一人收到：门店收益 574.6 + 省代 17.68 = 592.28', total, 574.6 + 17.68);
  ok('门店收益与省代收益是【两笔独立佣金】（不合并为一笔）', storeOnly.length === 3 && provinceCut.length === 1);
  ok('省代份额 sub_type = featured_province（归属区域代理模块）', provinceCut.length === 1 && provinceCut[0].subtype === 'featured_province');
  ok('闭环', r.closure === true);
}

head('C. 仅选门店、无省/市代理时：缺位部分归总部（不报错）');
{
  const db = buildDb();
  // 删掉省/市代理，仅留区县 + 单店
  db.regionalAgents = db.regionalAgents.filter((a) => !['province', 'city'].includes(a.region_type));
  const sid = storeAgentId(db);
  const r = R.createProductOrder(db, { buyerId: 'buyer', productKey: 'featured', qty: 1, storeId: sid });
  eq('省代 2% 份额 → HQ（无省代）', r.rows.find((x) => x.role === 'featured_province').owner_id, 'HQ');
  eq('市代 8% 份额 → HQ（无市代）', r.rows.find((x) => x.role === 'featured_city').owner_id, 'HQ');
  ok('闭环', r.closure === true);
}

head('D. 门店 region_code 带门店序号后缀（如 330110-S1）：层级匹配必须剥离后缀');
{
  const db = buildDb();
  // 模拟真实种子：门店码带 -S1 后缀
  db.regionalAgents.find((a) => a.region_type === 'store').region_code = '110101-S1';
  const sid = db.regionalAgents.find((a) => a.region_type === 'store').region_code;
  const r = R.createProductOrder(db, { buyerId: 'buyer', productKey: 'featured', qty: 1, storeId: sid });
  eq('门店仍拿到单店 65%（未被后缀影响）', r.byRecipient.store, 574.6);
  eq('省代 2% 正确归 prov（后缀剥离后前缀匹配命中）', r.rows.find((x) => x.role === 'featured_province').owner_id, 'prov');
  eq('市代 8% 正确归 city', r.rows.find((x) => x.role === 'featured_city').owner_id, 'city');
  eq('区县 10% 正确归 dist', r.rows.find((x) => x.role === 'featured_district_mgmt').owner_id, 'dist');
  ok('闭环', r.closure === true);
  eq('订单 regionCode 落区县级码（无后缀）', db.orders.find((o) => o.id === r.order_id).regionCode, '110101');
  eq('订单 store_code 保留门店自身码（带后缀，供交付定位）', db.orders.find((o) => o.id === r.order_id).store_code, '110101-S1');
}

head('E. 不传 storeId（旧行为）：门店/区域份额归总部，不改原语义');
{
  const db = buildDb();
  const r = R.createProductOrder(db, { buyerId: 'buyer', productKey: 'featured', qty: 1 /* 无 storeId */ });
  eq('无门店：单店份额 → HQ', r.rows.find((x) => x.role === 'featured_store_delivery').owner_id, 'HQ');
  eq('无门店：省代份额 → HQ', r.rows.find((x) => x.role === 'featured_province').owner_id, 'HQ');
  ok('闭环', r.closure === true);
}

console.log(`\n${'='.repeat(50)}`);
console.log(`通过 ${pass} / 失败 ${fail}`);
console.log('='.repeat(50));
process.exit(fail > 0 ? 1 : 0);

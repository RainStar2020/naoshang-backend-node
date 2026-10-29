/**
 * 产品订单链路校验（2026-10-23 新规格，routes.createProductOrder）
 *
 * 覆盖：实物固定链级差 + 产品提成（链底扣/溢出归总部）、特色产品两交付模式、
 *       AI软件卡（记忆卡）固定拿货价拿货差价、行政费 5/5/90、幂等重放、无上级、代理本人固定拿货价进货。
 * 全部断言 100% 闭环（落账合计 = 实付）。
 */
const S = require('../src/store');
const R = require('../src/routes');
const PS = require('../src/productSplit');
const RA = require('../src/regionAgent');
const IZ = require('../src/identity');
const CAT = require('../src/catalogDisplay');

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
  S.addUser(db, { id: 'p1', tier: 'cofounder', phone: '1' });                 // 联创（上级合伙人）
  S.addUser(db, { id: 'p4', tier: 'vip', phone: '4', upline_id: 'p1' });      // VIP 买家
  S.addUser(db, { id: 'p5', tier: 'private', phone: '5' });                   // 区县代 D1（开通赠私董，已是私董）
  S.appointAgent(db, { partnerId: 'p5', regionType: 'district', regionCode: 'D1' });
  S.addUser(db, { id: 'p6', tier: 'angel', phone: '6', upline_id: 'p5' });    // 单店代理 D1（天使门槛）
  S.appointAgent(db, { partnerId: 'p6', regionType: 'store', regionCode: 'D1' });
  return db;
}

head('① 实物：VIP 买家 + 联创上级 + D1 区域链（单店/区县代在场）');
{
  const db = buildDb();
  const r = R.createProductOrder(db, { buyerId: 'p4', productKey: 'pad', qty: 1, regionCode: 'D1' });
  eq('成交价 = 6980×0.8 = 5584', r.paid, 5584);
  eq('可分池 = 5584（无固定成本）', r.pool, 5584);
  eq('产品提成 = 5584×15%（联创上级） = 837.6', r.rows.find((x) => x.role === 'partner_product').amount, 837.6);
  eq('链底门店级差 = 2094 − 837.6 = 1256.4 → p6', r.rows.find((x) => x.role === 'chain_store').amount, 1256.4);
  eq('门店级差收款方 = p6（单店代理）', r.rows.find((x) => x.role === 'chain_store').owner_id, 'p6');
  eq('区县级差 = 698 → p5', r.rows.find((x) => x.role === 'chain_district').amount, 698);
  eq('区县收款方 = p5', r.rows.find((x) => x.role === 'chain_district').owner_id, 'p5');
  eq('市级差 = 349 → HQ（无市代）', r.rows.find((x) => x.role === 'chain_city').amount, 349);
  eq('省级差 = 349 → HQ（无省代）', r.rows.find((x) => x.role === 'chain_province').amount, 349);
  eq('总部行 = 0.3×6980 = 2094', r.rows.find((x) => x.role === 'chain_hq').amount, 2094);
  eq('收款方汇总：HQ = 2792', r.byRecipient.HQ, 2792);
  ok('100% 闭环（落账=实付）', r.closure === true, `total=${r.total}`);
  ok('订单已落库', db.orders.some((o) => o.id === r.order_id && o.type === 'product'));
  ok('佣金 6 笔且 id 确定性', db.commissions.filter((c) => c.ref_order_id === r.order_id).length === 6
    && db.commissions.some((c) => c.id === `po-${r.order_id}-partner_product`));
}

head('② 实物：无区域代理（全部归总部直供链）');
{
  const db = buildDb();
  const r = R.createProductOrder(db, { buyerId: 'p4', productKey: 'pad', qty: 1, regionCode: 'D9' });
  eq('实付 5584', r.paid, 5584);
  eq('HQ 得 5584 − 837.6 = 4746.4', r.byRecipient.HQ, 4746.4);
  eq('产品提成 837.6 → p1', r.byRecipient.p1, 837.6);
  ok('闭环', r.closure === true);
}

head('③ 实物：无上级合伙人 → 无产品提成');
{
  const db = buildDb();
  S.addUser(db, { id: 'p9', tier: 'vip', phone: '9' }); // 无 upline
  const r = R.createProductOrder(db, { buyerId: 'p9', productKey: 'pad', qty: 1, regionCode: 'D1' });
  ok('无 partner_product 行', !r.rows.some((x) => x.role === 'partner_product'));
  eq('门店级差全额 2094 → p6', r.rows.find((x) => x.role === 'chain_store').amount, 2094);
  ok('闭环', r.closure === true);
}

head('④ 实物：代理本人购买按代理折扣 + 提成溢出归总部');
{
  const db = buildDb();
  // p6 是单店代理（5折）+ 天使，上级 p5（私董）→ 应按代理折扣 0.5 购买
  const r1 = R.createProductOrder(db, { buyerId: 'p6', productKey: 'pad', qty: 1, regionCode: 'D1' });
  eq('单店代理自购价 = 6980×0.5 = 3490', r1.paid, 3490);
  eq('卖方=区县代（固定链上级）：市级差 = (0.4−0.35)×6980 = 349', r1.rows.find((x) => x.role === 'chain_city').amount, 349);
  eq('产品提成 = 3490×15%（私董上级 p5） = 523.5', r1.rows.find((x) => x.role === 'partner_product').amount, 523.5);
  eq('区县行（链底）扣提成后 = 698 − 523.5 = 174.5', r1.rows.find((x) => x.role === 'chain_district').amount, 174.5);
  ok('闭环', r1.closure === true, `total=${r1.total}`);

  // 溢出场景：区县代自购（4折），卖方=市代（空位归HQ），底部行 349 < 提成 418.8 → 溢出归总部行
  S.addUser(db, { id: 'p8', tier: 'private', phone: '8', upline_id: 'p1' });
  S.appointAgent(db, { partnerId: 'p8', regionType: 'district', regionCode: 'D2' });
  const r2 = R.createProductOrder(db, { buyerId: 'p8', productKey: 'pad', qty: 1, regionCode: 'D2' });
  eq('区县代自购价 = 6980×0.4 = 2792', r2.paid, 2792);
  eq('产品提成 = 2792×15% = 418.8', r2.rows.find((x) => x.role === 'partner_product').amount, 418.8);
  eq('链底（市代空位→HQ）行 = 349 − 418.8 → 0', r2.rows.find((x) => x.role === 'chain_city').amount, 0);
  eq('总部行 = 2094 − 69.8（溢出） = 2024.2', r2.rows.find((x) => x.role === 'chain_hq').amount, 2024.2);
  ok('溢出后仍闭环', r2.closure === true, `total=${r2.total}`);
}

head('⑤ 特色产品：门店交付（15/2/8/(5+5)/(30+30+5)）');
{
  const db = buildDb();
  const r = R.createProductOrder(db, { buyerId: 'p4', productKey: 'featured', qty: 1, regionCode: 'D1', deliveryType: 'store' });
  eq('成交价 = 1300×0.8 = 1040', r.paid, 1040);
  eq('产品提成 = 1040×15% = 156 → p1', r.rows.find((x) => x.role === 'partner_product').amount, 156);
  const net = 1040 - 156;
  eq('净池 = 884', net, 884);
  eq('总部 15% = 132.6', r.rows.find((x) => x.role === 'featured_hq').amount, 132.6);
  eq('省代 2% = 17.68 → HQ（无省代）', r.rows.find((x) => x.role === 'featured_province').amount, 17.68);
  eq('市代 8% = 70.72 → HQ', r.rows.find((x) => x.role === 'featured_city').amount, 70.72);
  eq('区县管理 5% = 44.2 → p5', r.rows.find((x) => x.role === 'featured_district_mgmt').amount, 44.2);
  eq('区县巡查 5% = 44.2 → p5（待分配）', r.rows.find((x) => x.role === 'featured_district_inspect').amount, 44.2);
  eq('门店交付 30% = 265.2 → p6', r.rows.find((x) => x.role === 'featured_store_delivery').amount, 265.2);
  eq('门店流量 30% = 265.2 → p6', r.rows.find((x) => x.role === 'featured_store_traffic').amount, 265.2);
  eq('店长销售 5% = 44.2 → p6', r.rows.find((x) => x.role === 'featured_store_sales').amount, 44.2);
  eq('收款方：p5 = 88.4', r.byRecipient.p5, 88.4);
  eq('收款方：p6 = 574.6', r.byRecipient.p6, 574.6);
  ok('闭环', r.closure === true, `total=${r.total}`);
  ok('巡查佣金为待分配状态', db.commissions.some((c) => c.id === `po-${r.order_id}-featured_district_inspect` && c.status === 'pending_allocation'));
}

head('⑥ 特色营：总部交付（固定成本 8000 + 交付/巡查收归总部）');
{
  const db = buildDb();
  const r = R.createProductOrder(db, { buyerId: 'p4', productKey: 'featuredCamp', qty: 1, regionCode: 'D1', deliveryType: 'hq' });
  eq('成交价 = 8000 + 2000×0.8 = 9600', r.paid, 9600);
  eq('固定成本回收 8000 → HQ', r.rows.find((x) => x.role === 'fixed_cost').amount, 8000);
  eq('产品提成 = 1600×15% = 240 → p1', r.rows.find((x) => x.role === 'partner_product').amount, 240);
  eq('净池 = 1600 − 240 = 1360', r.pool - r.rows.find((x) => x.role === 'partner_product').amount, 1360);
  eq('总部交付：总部行合计 = (15+30+5)%×1360 = 680', r.rows.find((x) => x.role === 'featured_hq').amount, 204);
  eq('门店交付 30% 收归总部 = 408', r.rows.find((x) => x.role === 'featured_store_delivery').amount, 408);
  eq('巡查 5% 收归总部 = 68', r.rows.find((x) => x.role === 'featured_district_inspect').amount, 68);
  eq('门店流量 30% = 408 → p6', r.rows.find((x) => x.role === 'featured_store_traffic').amount, 408);
  eq('店长销售 5% = 68 → p6', r.rows.find((x) => x.role === 'featured_store_sales').amount, 68);
  eq('区县管理 5% = 68 → p5', r.rows.find((x) => x.role === 'featured_district_mgmt').amount, 68);
  eq('收款方：HQ = 8000+204+27.2+108.8+68+408 = 8816', r.byRecipient.HQ, 8816);
  ok('闭环', r.closure === true, `total=${r.total}`);
  ok('总部交付：巡查佣金归 HQ 且非待分配状态', db.commissions.some((c) => c.id === `po-${r.order_id}-featured_district_inspect` && c.owner_id === 'HQ' && c.status === 'pending'));
}

head('⑦ AI软件卡（记忆卡）：固定拿货价拿货差价（沿固定链 + 提成从链底扣）');
{
  const db = buildDb();
  // p4=VIP(0.8) 在 D1 单店买 998 卡
  const r = R.createProductOrder(db, { buyerId: 'p4', productKey: 'memoryCard', qty: 1, regionCode: 'D1' });
  eq('成交价 = 998×0.8 = 798.4', r.paid, 798.4);
  eq('产品提成 = 798.4×15%（联创上级 p1） = 119.76', r.rows.find((x) => x.role === 'partner_product').amount, 119.76);
  // 固定拿货价链：单店350 / 区县250 / 市170 / 省150
  eq('链底门店差价 = 798.4 − 350 = 448.4，扣提成后 328.64 → p6', r.rows.find((x) => x.role === 'card_store').amount, 328.64);
  eq('门店级差收款方 = p6', r.rows.find((x) => x.role === 'card_store').owner_id, 'p6');
  eq('区县级差 = 350 − 250 = 100 → p5', r.rows.find((x) => x.role === 'card_district').amount, 100);
  eq('区县收款方 = p5', r.rows.find((x) => x.role === 'card_district').owner_id, 'p5');
  eq('市级差 = 250 − 170 = 80 → HQ（无市代）', r.rows.find((x) => x.role === 'card_city').amount, 80);
  eq('省级差 = 170 − 150 = 20 → HQ（无省代）', r.rows.find((x) => x.role === 'card_province').amount, 20);
  eq('总部收省级拿货价 = 150', r.rows.find((x) => x.role === 'card_hq').amount, 150);
  eq('收款方：p6 = 328.64', r.byRecipient.p6, 328.64);
  eq('收款方：p5 = 100', r.byRecipient.p5, 100);
  eq('收款方：HQ = 250', r.byRecipient.HQ, 250);
  eq('收款方：p1 = 119.76（提成）', r.byRecipient.p1, 119.76);
  ok('100% 闭环（落账=实付）', r.closure === true, `total=${r.total}`);
  ok('订单 kind = software', db.orders.find((o) => o.id === r.order_id).kind === 'software');
}

head('⑦b AI软件卡：代理本人按固定拿货价进货（不打折）');
{
  const db = buildDb();
  // p6 = 单店代理(5折) + 天使，买记忆卡→按固定拿货价 350（非折扣价），卖方=区县代(固定链上级)
  const r = R.createProductOrder(db, { buyerId: 'p6', productKey: 'memoryCard', qty: 1, regionCode: 'D1' });
  eq('单店代理自购价 = 固定拿货价 350（不按 5折）', r.paid, 350);
  eq('产品提成 = 350×15%（私董上级 p5） = 52.5', r.rows.find((x) => x.role === 'partner_product').amount, 52.5);
  eq('链底区县差价 = 350 − 250 = 100，扣提成后 47.5 → p5', r.rows.find((x) => x.role === 'card_district').amount, 47.5);
  eq('市级差 = 250 − 170 = 80 → HQ', r.rows.find((x) => x.role === 'card_city').amount, 80);
  eq('省级差 = 170 − 150 = 20 → HQ', r.rows.find((x) => x.role === 'card_province').amount, 20);
  eq('总部收省级拿货价 = 150', r.rows.find((x) => x.role === 'card_hq').amount, 150);
  eq('收款方：p5 = 100（区县 47.5 + 提成 52.5）', r.byRecipient.p5, 100);
  ok('闭环', r.closure === true, `total=${r.total}`);
}

head('⑦c 陪练卡（coachCard）：归特色产品，走 featuredSplit（15/2/8/(5+5)/(30+30+5)）');
{
  const db = buildDb();
  // p4=VIP(0.8) 在 D1 单店买 2000 陪练卡 → 实付 1600，联创上级提成 15%=240
  const r = R.createProductOrder(db, { buyerId: 'p4', productKey: 'coachCard', qty: 1, regionCode: 'D1', deliveryType: 'store' });
  eq('成交价 = 2000×0.8 = 1600', r.paid, 1600);
  eq('产品提成 = 1600×15% = 240 → p1', r.rows.find((x) => x.role === 'partner_product').amount, 240);
  eq('净池 = 1600 − 240 = 1360', r.pool - 240, 1360);
  eq('总部 15% = 204', r.rows.find((x) => x.role === 'featured_hq').amount, 204);
  eq('省代 2% = 27.2 → HQ（无省代）', r.rows.find((x) => x.role === 'featured_province').amount, 27.2);
  eq('市代 8% = 108.8 → HQ', r.rows.find((x) => x.role === 'featured_city').amount, 108.8);
  eq('区县管理 5% = 68 → p5', r.rows.find((x) => x.role === 'featured_district_mgmt').amount, 68);
  eq('区县巡查 5% = 68 → p5（待分配）', r.rows.find((x) => x.role === 'featured_district_inspect').amount, 68);
  eq('门店交付 30% = 408 → p6', r.rows.find((x) => x.role === 'featured_store_delivery').amount, 408);
  eq('门店流量 30% = 408 → p6', r.rows.find((x) => x.role === 'featured_store_traffic').amount, 408);
  eq('店长销售 5% = 68 → p6', r.rows.find((x) => x.role === 'featured_store_sales').amount, 68);
  eq('收款方：HQ = 340', r.byRecipient.HQ, 340);
  eq('收款方：p5 = 136', r.byRecipient.p5, 136);
  eq('收款方：p6 = 884', r.byRecipient.p6, 884);
  eq('收款方：p1 = 240（提成）', r.byRecipient.p1, 240);
  ok('100% 闭环（落账=实付）', r.closure === true, `total=${r.total}`);
  ok('订单 kind = featured（陪练卡归特色产品）', db.orders.find((o) => o.id === r.order_id).kind === 'featured');
  ok('巡查佣金为待分配状态', db.commissions.some((c) => c.id === `po-${r.order_id}-featured_district_inspect` && c.status === 'pending_allocation'));
}

head('⑦d 特色产品：代理买家按「对应合伙人档位」计价（省代→联创/市代→私董/区县代→天使/单店→VIP）');
{
  const db = buildDb();
  // p6 = 单店代理（自身代理折扣 5折）买 特色营：应映射为 VIP(8折) → 8000 + 2000×0.8 = 9600（而非 5折 9000）
  const r6 = R.createProductOrder(db, { buyerId: 'p6', productKey: 'featuredCamp', qty: 1, regionCode: 'D1', deliveryType: 'store' });
  eq('单店代理买特色营 = 8000 + 2000×0.8 = 9600（映射 VIP）', r6.paid, 9600);
  eq('可分池 = 9600 − 8000 = 1600', r6.pool, 1600);
  ok('未用代理 5 折（实付 > 9000）', r6.paid > 9000);
  ok('闭环', r6.closure === true, `total=${r6.total}`);

  // p5 = 区县代理（自身代理折扣 4折）买 特色营：映射为 天使(7.5折) → 8000 + 2000×0.75 = 9500
  const r5 = R.createProductOrder(db, { buyerId: 'p5', productKey: 'featuredCamp', qty: 1, regionCode: 'D1', deliveryType: 'store' });
  eq('区县代理买特色营 = 8000 + 2000×0.75 = 9500（映射 天使）', r5.paid, 9500);
  ok('闭环', r5.closure === true);

  // 陪练卡同理：单店代理买 → 映射 VIP(8折) = 1600（与 VIP 合伙人同价）
  const rc = R.createProductOrder(db, { buyerId: 'p6', productKey: 'coachCard', qty: 1, regionCode: 'D1', deliveryType: 'store' });
  eq('单店代理买陪练卡 = 2000×0.8 = 1600（映射 VIP）', rc.paid, 1600);
  ok('闭环', rc.closure === true);

  // 省代（在场）买特色营：映射联创(6.5折) → 8000 + 2000×0.65 = 9300
  S.addUser(db, { id: 'p7', tier: 'cofounder', phone: '7', upline_id: 'p1' });
  S.appointAgent(db, { partnerId: 'p7', regionType: 'province', regionCode: 'D1' });
  const r7 = R.createProductOrder(db, { buyerId: 'p7', productKey: 'featuredCamp', qty: 1, regionCode: 'D1', deliveryType: 'store' });
  eq('省代买特色营 = 8000 + 2000×0.65 = 9300（映射 联创）', r7.paid, 9300);
  ok('闭环', r7.closure === true);
}

head('⑧ 行政费 5/5/90（金额下单指定）');
{
  const db = buildDb();
  const r = R.createProductOrder(db, { buyerId: 'p4', productKey: 'adminFee', qty: 1, regionCode: 'D1', amount: 10000 });
  eq('行政费 10000', r.paid, 10000);
  eq('总部 5% = 500', r.rows.find((x) => x.role === 'admin_hq').amount, 500);
  eq('销售门店 5% = 500 → p6（单店代理）', r.rows.find((x) => x.role === 'admin_ownStore').amount, 500);
  eq('销售门店收款方 = p6', r.rows.find((x) => x.role === 'admin_ownStore').owner_id, 'p6');
  eq('上课团队 90% = 9000', r.rows.find((x) => x.role === 'admin_delivery').amount, 9000);
  ok('无产品提成（行政费特殊）', !r.rows.some((x) => x.role === 'partner_product'));
  ok('闭环', r.closure === true);
}

head('⑨ 幂等：同 orderId 重放不双发');
{
  const db = buildDb();
  const r1 = R.createProductOrder(db, { buyerId: 'p4', productKey: 'featured', qty: 1, regionCode: 'D1', orderId: 'po-test-1' });
  const n1 = db.commissions.filter((c) => c.ref_order_id === 'po-test-1').length;
  const r2 = R.createProductOrder(db, { buyerId: 'p4', productKey: 'featured', qty: 1, regionCode: 'D1', orderId: 'po-test-1' });
  const n2 = db.commissions.filter((c) => c.ref_order_id === 'po-test-1').length;
  eq('重放后佣金笔数不变', n2, n1);
  eq('重放后金额一致', r2.total, r1.total);
  eq('订单表不重复', db.orders.filter((o) => o.id === 'po-test-1').length, 1);
}

head('⑩ 数量与档位边界');
{
  const db = buildDb();
  const r = R.createProductOrder(db, { buyerId: 'p4', productKey: 'pad', qty: 2, regionCode: 'D1' });
  eq('数量 2：实付 = 5584×2 = 11168', r.paid, 11168);
  eq('数量 2：产品提成 = 1675.2', r.rows.find((x) => x.role === 'partner_product').amount, 1675.2);
  ok('闭环', r.closure === true);
  // 非合伙人档位按原价
  S.addUser(db, { id: 'u1', tier: 'user', phone: '10' });
  const r2 = R.createProductOrder(db, { buyerId: 'u1', productKey: 'featured', qty: 1, regionCode: 'D1' });
  eq('普通用户按原价：特色产品 1300', r2.paid, 1300);
  ok('闭环', r2.closure === true);
}

head('⑪ 身份折扣体系：代理折扣与合伙人折扣分开计算（商城预留）');
{
  // 单一解析入口 resolveBuyerLevel：代理身份 > 合伙人档位 > 原价
  eq('resolveBuyerLevel：纯 VIP → partner', PS.resolveBuyerLevel({ tier: 'vip' }, null).discountKind, 'partner');
  eq('resolveBuyerLevel：纯 VIP 档位', PS.resolveBuyerLevel({ tier: 'vip' }, null).level, 'vip');
  eq('resolveBuyerLevel：无身份 → list', PS.resolveBuyerLevel({ tier: 'user' }, null).discountKind, 'list');
  eq('resolveBuyerLevel：代理记录 → agent', PS.resolveBuyerLevel({ tier: 'vip' }, { region_type: 'store' }).discountKind, 'agent');
  eq('resolveBuyerLevel：代理记录优先于合伙人档位', PS.resolveBuyerLevel({ tier: 'cofounder' }, { region_type: 'store' }).level, 'store');

  // 两套折扣表互相独立、力度不同
  eq('合伙人折扣表：vip 0.8 / cofounder 0.65', RA.PARTNER_DISCOUNT.vip === 0.8 && RA.PARTNER_DISCOUNT.cofounder === 0.65, true);
  eq('代理折扣表：store 0.5 / province 0.3', RA.AGENT_DISCOUNT.store === 0.5 && RA.AGENT_DISCOUNT.province === 0.3, true);
  ok('两套表无交集键（代理键不出现在合伙人表）', !('store' in RA.PARTNER_DISCOUNT) && !('vip' in RA.AGENT_DISCOUNT));

  // 双身份买家（联创 + 单店代理）：按代理折扣成交，订单显式记录折扣身份
  const db = buildDb();
  S.addUser(db, { id: 'pd', tier: 'cofounder', phone: '77', upline_id: 'p1' });
  S.appointAgent(db, { partnerId: 'pd', regionType: 'store', regionCode: 'D1' });
  const r = R.createProductOrder(db, { buyerId: 'pd', productKey: 'pad', qty: 1, regionCode: 'D1' });
  eq('双身份：联创+单店代理 → 按代理折扣 6980×0.5 = 3490', r.paid, 3490);
  eq('折扣身份 = agent', r.discount_kind, 'agent');
  eq('档位 = store', r.level, 'store');
  ok('订单落库带 discount_kind', db.orders.find((o) => o.id === r.order_id).discount_kind === 'agent');
  // 对照：同一产品若按联创合伙人价应为 6980×0.65 = 4537（两套折扣不混用）
  eq('对照：合伙人价（联创）= 4537（未被误用）', PS.productPrice('pad', 'cofounder', 1).unitPrice, 4537);
  eq('对照：代理拿货价（单店）= 3490', PS.productPrice('pad', 'store', 1).unitPrice, 3490);
  ok('闭环', r.closure === true);

  // buyerProductPrices：商城报价同时给出三套价格
  const bp = PS.buyerProductPrices(db.users.pd, db.regionalAgents.find((a) => a.partner_id === 'pd'), 1);
  eq('商城报价：成交档位 store', bp.level, 'store');
  eq('商城报价：Pad 代理拿货价 3490', bp.prices.pad.agentUnitPrice, 3490);
  eq('商城报价：Pad 合伙人价（联创）4537', bp.prices.pad.partnerUnitPrice, 4537);
  eq('商城报价：成交价取代理价 3490', bp.prices.pad.unitPrice, 3490);
}

head('⑫ 孩子没有折扣：商城只按购买者本人身份打折（2026-10-27 用户明确）');
{
  const db = buildDb();
  S.addUser(db, { id: 'pp', tier: 'user', phone: '88' });
  db.members.push({ id: 'm1', userId: 'pp', name: '孩子甲', memberLevel: 'cj' });  // 超级会员
  db.members.push({ id: 'm2', userId: 'pp', name: '孩子乙', memberLevel: 'ys' });  // 羿烁会员
  const buyer = db.users.pp;

  // ① 普通家长（无任何身份）+ 孩子是超级/羿烁会员 → 仍按原价（孩子没有折扣）
  const r0 = R.createProductOrder(db, { buyerId: 'pp', productKey: 'pad', qty: 1, regionCode: 'D9', memberId: 'm1' });
  eq('普通家长+超级会员孩子：按原价 6980（孩子无折扣）', r0.paid, 6980);
  eq('折扣身份 = list', r0.discount_kind, 'list');
  const r0b = R.createProductOrder(db, { buyerId: 'pp', productKey: 'pad', qty: 1, regionCode: 'D9', memberId: 'm2' });
  eq('普通家长+羿烁会员孩子：同样按原价 6980', r0b.paid, 6980);
  ok('闭环', r0.closure === true, `total=${r0.total}`);

  // ② memberId 只作为「服务对象」记录，不影响计价
  eq('订单记录服务对象 member_id = m1', r0.member_id, 'm1');
  ok('订单不再落 member_level（孩子等级不参与计价）', db.orders.find((o) => o.id === r0.order_id).member_level == null);

  // ③ 核心护栏：家长加孩子后 display_id 前缀会跟着孩子走（联创+粉丝孩子 → FS0001），
  //    但**前缀只是展示字符串，u.tier 档位字段不变** → 商城必须继续按真实身份给价。
  const db2 = buildDb();
  S.addUser(db2, { id: 'plc', tier: 'cofounder', phone: '90' });
  db2.members.push({ id: 'm3', userId: 'plc', name: '孩子丙', memberLevel: 'fs' });
  IZ.recomputeDisplayId(db2, 'plc');
  eq('联创家长加粉丝孩子：tier 档位字段不变', db2.users.plc.tier, 'cofounder');
  eq('联创家长加粉丝孩子：display_id 前缀跟孩子走 = FS（序号随注册序）', /^FS\d{4}$/.test(db2.users.plc.display_id) ? 'FS' : db2.users.plc.display_id, 'FS');
  const r4 = R.createProductOrder(db2, { buyerId: 'plc', productKey: 'pad', qty: 1, regionCode: 'D9', memberId: 'm3' });
  eq('联创家长买 Pad：仍按联创 6.5 折 = 4537（不被孩子前缀/等级影响）', r4.paid, 4537);
  eq('订单折扣身份 = partner', r4.discount_kind, 'partner');

  // ④ 省代 + 粉丝孩子：代理身份同样不丢
  S.addUser(db2, { id: 'pag', tier: 'cofounder', phone: '91' });
  S.appointAgent(db2, { partnerId: 'pag', regionType: 'province', regionCode: 'D9' });
  db2.members.push({ id: 'm4', userId: 'pag', name: '孩子丁', memberLevel: 'fs' });
  IZ.recomputeDisplayId(db2, 'pag');
  const r5 = R.createProductOrder(db2, { buyerId: 'pag', productKey: 'pad', qty: 1, regionCode: 'D9', memberId: 'm4' });
  eq('省代+粉丝孩子：仍按省代 3 折 = 2094（代理价不丢）', r5.paid, 2094);
  eq('订单折扣身份 = agent', r5.discount_kind, 'agent');

  // ⑤ 单店代理 + 孩子：代理拿货价 3490（孩子等级不参与）
  S.addUser(db2, { id: 'pst', tier: 'angel', phone: '92' });
  S.appointAgent(db2, { partnerId: 'pst', regionType: 'store', regionCode: 'D9' });
  db2.members.push({ id: 'm5', userId: 'pst', name: '孩子戊', memberLevel: 'ys' });
  const r6 = R.createProductOrder(db2, { buyerId: 'pst', productKey: 'pad', qty: 1, regionCode: 'D9', memberId: 'm5' });
  eq('单店代理+羿烁孩子：仍按单店 5 折 = 3490', r6.paid, 3490);
}

head('⑬ 报价金额与下单金额必须一致（商城身份打折的核心护栏）');
{
  const db = buildDb();
  S.addUser(db, { id: 'pp', tier: 'user', phone: '88' });
  db.members.push({ id: 'm1', userId: 'pp', name: '孩子甲', memberLevel: 'cj' });
  const buyer = db.users.pp;
  const KEYS = ['pad', 'memoryCard', 'coachCard', 'featured', 'featuredCamp'];
  let bad = 0;
  for (const key of KEYS) {
    for (const mid of [null, 'm1']) {
      const fp = PS.finalPrice(key, buyer, null, 1, {});
      const r = R.createProductOrder(db, { buyerId: 'pp', productKey: key, qty: 1, regionCode: 'D9', memberId: mid });
      if (Math.abs(fp.unitPrice - r.paid) >= 0.01) { bad++; console.log(`  ✗ ${key}/${mid} 报价 ${fp.unitPrice} ≠ 下单 ${r.paid}`); }
      if (r.closure !== true) { bad++; console.log(`  ✗ ${key}/${mid} 未闭环`); }
    }
  }
  eq('报价 = 下单 金额（5 商品 × 2 服务对象场景 = 10 组）', bad, 0);

  // 目录浏览态的「你的价」= 普通家长原价（无身份）
  const items = CAT.buildCatalogItems(db, { buyer, agentRec: null });
  const padItem = items.find((i) => i.id === 'pad');
  eq('目录 viewerPrice：普通家长 Pad 你的价 = 6980（原价）', padItem.viewerPrice.unitAmount, 698000);
  eq('目录 viewerPrice：身份标注 = 无身份', padItem.viewerPrice.identityLabel, '无身份');

  // 联创家长：目录「你的价」= 联创 6.5 折
  const db3 = buildDb();
  S.addUser(db3, { id: 'plc', tier: 'cofounder', phone: '90' });
  db3.members.push({ id: 'm3', userId: 'plc', name: '孩子丙', memberLevel: 'fs' });
  const items3 = CAT.buildCatalogItems(db3, { buyer: db3.users.plc, agentRec: null });
  const pad3 = items3.find((i) => i.id === 'pad');
  eq('目录 viewerPrice：联创家长（加粉丝孩子后）仍 = 4537', pad3.viewerPrice.unitAmount, 453700);
  eq('目录 viewerPrice：身份标注 = 联创合伙人', pad3.viewerPrice.identityLabel, '联创合伙人');
  eq('目录 viewerPrice：折扣标注 = 6.5折', pad3.viewerPrice.discountLabel, '6.5折');
}

console.log(`\n${'='.repeat(50)}`);
console.log(`通过 ${pass} / 失败 ${fail}`);
console.log('='.repeat(50));
process.exit(fail > 0 ? 1 : 0);

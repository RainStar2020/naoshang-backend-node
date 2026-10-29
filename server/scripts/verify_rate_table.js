/**
 * 拨比表逐行核对（2026-10-27 用户拨比表截图）
 *
 * 把用户拨比表的每一格变成断言，确保引擎输出永远与表一致：
 *
 *   ① 实物产品 脑商Pad 6980
 *      折扣价 天使75% = 5235；区县拿货 40% → 拿货价 2792；利润 2443
 *      校验：5235 − 2792 = 2443 ✓
 *   ② AI软件卡 记忆卡 998
 *      折扣价 私董70% = 698.6；**固定拿货价（按月）省150/市170/区县250/单店350**
 *      拨比表「地市拿货 170」对应市代固定拿货价；引擎按固定拿货价沿代理链结算拿货差价 ✓
 *   ③ 特色产品 陪练卡 2000（联创 65% → 1300）
 *      总部 系统15%=195 / 省级 管理2%=26 / 市级 管理8%=104 /
 *      区县 管理5%=65 + 巡查5%=65 / 单店 交付30%=390 + 流量30%=390 + 销售5%=65
 *      校验：合计 = 1300 ✓
 *   ④ 特色产品 特色营 10000（固定成本 8000，拨比价 2000，私董70% → 9400）
 *      同一套比例，池 = 2000 → 300/40/160/100/100/600/600/100，合计 2000 ✓
 *   ⑤ 行政费用 2000：总部 5%=100 / 销售 5%=100 / 交付 90%=1800，合计 2000 ✓
 *
 * 另含：
 *   · 门店收益规则表（storeIncome.js）自洽性校验
 *   · **门店收益 vs 合店老板收益 分离**：两条独立账，type 不同、身份栏不同、bizType 不同
 */
const S = require('../src/store');
const R = require('../src/routes');
const PS = require('../src/productSplit');
const SI = require('../src/storeIncome');
const BIZ = require('../src/bizType');
const { round2 } = require('../src/commission');

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

// ───────────── ① 实物产品 脑商Pad ─────────────
head('① 实物产品 脑商Pad 6980：折扣价 5235 / 区县拿货 40%=2792 / 利润 2443');
{
  const pad = PS.getProduct('pad');
  eq('目录价 6980', pad.listPrice, 6980);
  eq('天使价 75% = 5235', PS.productPrice('pad', 'angel').unitPrice, 5235);
  eq('私董价 70% = 4886', PS.productPrice('pad', 'private').unitPrice, 4886);
  eq('联创价 65% = 4537', PS.productPrice('pad', 'cofounder').unitPrice, 4537);
  // 区县拿货 40% → 拿货价 2792
  const pick = 6980 * 0.40;
  eq('区县拿货价 = 6980×40% = 2792', pick, 2792);
  eq('利润 = 卖价 5235 − 拿货价 2792 = 2443', 5235 - pick, 2443);
  // 引擎：拿货级差（区县赚级差）
  const chain = PS.agentChainTierDiff({ buyerLevel: 'angel', sellerLevel: 'store', basePrice: 6980 });
  eq('引擎级差闭环 = 天使价 5235', chain.total, 5235);
  ok('引擎级差闭环', chain.closure === true);
}

// ───────────── ② AI软件卡 记忆卡（固定拿货价拿货差价） ─────────────
head('② AI软件卡 记忆卡 998：折扣价 698.6 + 固定拿货价（省150/市170/区县250/单店350）沿链结算');
{
  const mc = PS.getProduct('memoryCard');
  eq('目录价 998', mc.listPrice, 998);
  eq('私董价 70% = 698.6', PS.productPrice('memoryCard', 'private').unitPrice, 698.6);
  // 固定拿货价（按月）：省150/市170/区县250/单店350
  eq('固定拿货价 = 省150/市170/区县250/单店350',
    PS.MEMORY_CARD_PICK_PRICE.province === 150 && PS.MEMORY_CARD_PICK_PRICE.city === 170
    && PS.MEMORY_CARD_PICK_PRICE.district === 250 && PS.MEMORY_CARD_PICK_PRICE.store === 350, true);
  // 引擎：VIP(0.8) 在单店买 → 固定拿货价链（单店350/区县250/市170/省150）
  const card = PS.cardTierDiff({ paid: 798.4, buyerLevel: 'vip', sellerLevel: 'store', listPrice: 998, qty: 1 });
  eq('链底门店差价 = 798.4 − 350 = 448.4', card.rows.find((r) => r.level === 'store').amount, 448.4);
  eq('区县级差 = 350 − 250 = 100', card.rows.find((r) => r.level === 'district').amount, 100);
  eq('市级差 = 250 − 170 = 80', card.rows.find((r) => r.level === 'city').amount, 80);
  eq('省级差 = 170 − 150 = 20', card.rows.find((r) => r.level === 'province').amount, 20);
  eq('总部收省级拿货价 = 150', card.rows.find((r) => r.level === 'hq').amount, 150);
  eq('闭环合计 = 798.4', card.total, 798.4);
  ok('闭环', card.closure === true);
}

// ───────────── ③ 特色产品 陪练卡（拨比价联创65% → 1300） ─────────────
head('③ 特色产品 陪练卡 2000 → 联创 65% = 1300，按 15/2/8/(5+5)/(30+30+5) 分成');
{
  // 拨比表：陪练卡目录价 2000（200元/节 × 10节），联创 65% 成交 1300
  eq('陪练卡目录价 2000', PS.getProduct('coachCard').listPrice, 2000);
  eq('陪练卡归「特色产品」类型（kind=featured）', PS.getProduct('coachCard').kind, 'featured');
  eq('联创 65% → 1300', 2000 * 0.65, 1300);
  // 比例分成：池 1300
  const f = PS.featuredSplit(1300);
  eq('总部 15% = 195', f.rows.find((r) => r.role === 'featured_hq' || r.role === 'hq').amount, 195);
  eq('省代 2% = 26', f.rows.find((r) => r.role === 'province').amount, 26);
  eq('市代 8% = 104', f.rows.find((r) => r.role === 'city').amount, 104);
  eq('区县管理 5% = 65', f.rows.find((r) => r.role === 'district_mgmt').amount, 65);
  eq('区县巡查 5% = 65', f.rows.find((r) => r.role === 'district_inspect').amount, 65);
  eq('单店交付 30% = 390', f.rows.find((r) => r.role === 'store_delivery').amount, 390);
  eq('单店流量 30% = 390', f.rows.find((r) => r.role === 'store_traffic').amount, 390);
  eq('单店销售 5% = 65', f.rows.find((r) => r.role === 'store_sales').amount, 65);
  eq('合计 = 1300（100% 闭环）', f.total, 1300);
  ok('比例合计 = 100%', f.rateClosure === true);
  eq('门店合计 65% = 845', round2(390 + 390 + 65), 845);
  ok('巡查 5% 为待分配项', f.pending.length === 1 && f.pending[0].role === 'district_inspect');
}

// ───────────── ④ 特色产品 特色营 ─────────────
head('④ 特色产品 特色营 10000：固定成本 8000 / 拨比价 2000 / 私董 70% → 9400');
{
  const camp = PS.getProduct('featuredCamp');
  eq('目录价 10000', camp.listPrice, 10000);
  eq('固定成本 8000', camp.fixedCost, 8000);
  eq('拨比价（变动成本）2000', camp.variableCost, 2000);
  eq('私董 70% = 8000 + 2000×0.7 = 9400', PS.productPrice('featuredCamp', 'private').unitPrice, 9400);
  // 池 = 10000 − 8000 = 2000（拨比价）
  const f = PS.featuredSplit(10000, { fixedCost: 8000 });
  eq('可分池 = 2000', f.pool, 2000);
  eq('总部 15% = 300', f.rows.find((r) => r.role === 'hq').amount, 300);
  eq('省代 2% = 40', f.rows.find((r) => r.role === 'province').amount, 40);
  eq('市代 8% = 160', f.rows.find((r) => r.role === 'city').amount, 160);
  eq('区县管理 5% = 100', f.rows.find((r) => r.role === 'district_mgmt').amount, 100);
  eq('区县巡查 5% = 100', f.rows.find((r) => r.role === 'district_inspect').amount, 100);
  eq('单店交付 30% = 600', f.rows.find((r) => r.role === 'store_delivery').amount, 600);
  eq('单店流量 30% = 600', f.rows.find((r) => r.role === 'store_traffic').amount, 600);
  eq('单店销售 5% = 100', f.rows.find((r) => r.role === 'store_sales').amount, 100);
  eq('合计 = 2000（100% 闭环）', f.total, 2000);
}

// ───────────── ④b 特色产品：代理买家映射为对应合伙人档位 ─────────────
head('④b 特色产品：代理买家映射为对应合伙人档位（省代→联创/市代→私董/区县→天使/单店→VIP）');
{
  // 映射表（productSplit.AGENT_TO_PARTNER）
  eq('省代 → 联创', PS.AGENT_TO_PARTNER.province, 'cofounder');
  eq('市代 → 私董', PS.AGENT_TO_PARTNER.city, 'private');
  eq('区县代 → 天使', PS.AGENT_TO_PARTNER.district, 'angel');
  eq('单店 → VIP', PS.AGENT_TO_PARTNER.store, 'vip');
  // featuredLevelFor：代理身份 → 映射后档位；合伙人/普通用户 → 原样
  const agent = { partner_id: 'A', region_type: 'district' };
  eq('区县代理买特色 → 映射 天使', PS.featuredLevelFor({ tier: 'vip' }, agent), 'angel');
  eq('省代买特色 → 映射 联创', PS.featuredLevelFor({ tier: 'vip' }, { partner_id: 'A', region_type: 'province' }), 'cofounder');
  // 合伙人 / 普通用户不映射
  eq('VIP 合伙人买特色 → vip', PS.featuredLevelFor({ tier: 'vip' }, null), 'vip');
  eq('普通用户买特色 → list（原价）', PS.featuredLevelFor({ tier: null }, null), 'list');
  // 特色营代理买家的成交价
  eq('区县代理买特色营 = 8000 + 2000×0.75 = 9500', PS.productPrice('featuredCamp', PS.featuredLevelFor({ tier: 'vip' }, agent)).unitPrice, 9500);
  eq('省代买特色营 = 8000 + 2000×0.65 = 9300', PS.productPrice('featuredCamp', PS.featuredLevelFor({ tier: 'vip' }, { partner_id: 'A', region_type: 'province' })).unitPrice, 9300);
  // 陪练卡代理买家
  eq('单店代理买陪练卡 = 2000×0.8 = 1600', PS.productPrice('coachCard', PS.featuredLevelFor({ tier: 'vip' }, { partner_id: 'A', region_type: 'store' })).unitPrice, 1600);
  // dualPrice 渠道价（特色产品 = 代理映射单店→VIP）
  eq('特色营渠道价（单店代理映射VIP）= 9600', PS.dualPrice('featuredCamp').channel, 9600);
  eq('陪练卡渠道价（映射VIP）= 1600', PS.dualPrice('coachCard').channel, 1600);
  // 实物渠道价不受影响（仍按 store 代理折扣 5折）
  eq('脑商Pad 渠道价 = 6980×0.5 = 3490', PS.dualPrice('pad').channel, 3490);
}

// ───────────── ⑤ 行政费用 ─────────────
head('⑤ 行政费用 2000：总部 5% / 销售 5% / 交付 90%');
{
  const af = PS.adminFeeSplitDetail(2000);
  eq('总部 5% = 100', af.rows.find((r) => r.role === 'hq').amount, 100);
  eq('销售门店 5% = 100', af.rows.find((r) => r.role === 'ownStore').amount, 100);
  eq('交付（上课团队）90% = 1800', af.rows.find((r) => r.role === 'delivery').amount, 1800);
  eq('合计 = 2000', af.total, 2000);
  ok('闭环', af.closure === true);
}

// ───────────── ⑥ 门店收益规则表自洽性 ─────────────
head('⑥ 门店收益规则表（storeIncome.js）：门店收益随商品类型不同');
{
  const table = SI.storeIncomeRuleTable();
  eq('规则表覆盖 4 类商品（实物/软件卡/特色/行政费）', table.length, 4);
  const byKind = {};
  for (const r of table) byKind[r.kind] = r;
  ok('实物 = 拿货差价模式', byKind.physical.mode === 'tierDiff');
  ok('AI软件卡 = 拿货差价模式', byKind.software.mode === 'tierDiff');
  ok('特色产品 = 比例分成模式', byKind.featured.mode === 'poolRatio');
  ok('行政费 = 5/5/90 模式', byKind.admin.mode === 'adminFee');
  // 特色产品：区县巡查5% + 单店销售5% 均可再分配
  const pools = SI.assignablePoolsOf('featured');
  eq('特色产品有 2 个可分配池', pools.length, 2);
  eq('巡查 5%（区县代）', pools[0].kind, 'inspection');
  eq('销售 5%（单店店长）', pools[1].kind, 'sales');
  ok('实物无巡查/销售可分配提点', SI.assignablePoolsOf('physical').length === 0);
  ok('软件卡无巡查/销售可分配提点', SI.assignablePoolsOf('software').length === 0);
  // 规则表自算闭环
  const m1 = SI.verifyRuleMath('featured', 1300);
  eq('特色产品池 1300 合计 = 1300', m1.total, 1300);
  ok('特色产品比例合计 100%', m1.rateTotal === 1, String(m1.rateTotal));
  const m2 = SI.verifyRuleMath('featured', 2000);
  eq('特色营池 2000 合计 = 2000', m2.total, 2000);
  const m3 = SI.verifyRuleMath('admin', 2000);
  eq('行政费 2000 合计 = 2000', m3.total, 2000);
  ok('行政费比例合计 100%', m3.rateTotal === 1, String(m3.rateTotal));
}

// ───────────── ⑦ 门店收益 vs 合店老板收益 分离 ─────────────
head('⑦ 门店收益 ≠ 合店老板收益：两条独立账');
{
  // 构造一笔商城订单（门店卖货）→ 门店收益
  const db = S.createDb();
  S.addUser(db, { id: 'p1', tier: 'cofounder', phone: '1' });
  S.addUser(db, { id: 'buyer', tier: 'vip', phone: '2', upline_id: 'p1' });
  S.addUser(db, { id: 'store', tier: 'angel', phone: '6' });
  S.appointAgent(db, { partnerId: 'store', regionType: 'store', regionCode: '110101' });
  const r = R.createProductOrder(db, { buyerId: 'buyer', productKey: 'featured', qty: 1, storeId: '110101' });

  const storeComms = db.commissions.filter((c) => c.owner_id === 'store');
  ok('门店因卖货获得收益（≥1 笔）', storeComms.length >= 1, String(storeComms.length));
  ok('门店收益全部归「门店收益」这条线', storeComms.every((c) => SI.incomeChannelOf(c) === 'storeIncome'));
  ok('门店收益全部 type=product（卖货）', storeComms.every((c) => c.type === 'product'));
  ok('门店收益不混入合店费（type=costore）', storeComms.every((c) => c.type !== 'costore'));

  // 合店老板收益：type=costore，subtype 与门店卖货完全不同
  const costoreLike = { type: 'costore', subtype: 'costore_store_service' };
  eq('合店费收益归「合店老板收益」这条线', SI.incomeChannelOf(costoreLike), 'costoreOwnerIncome');
  ok('两条线 key 不同', SI.incomeChannelOf(storeComms[0]) !== SI.incomeChannelOf(costoreLike));
  ok('bizType 也不同：门店卖货=featured，合店费=costore',
    BIZ.bizTypeOf(storeComms[0], db.orders.find((o) => o.id === storeComms[0].ref_order_id)) === 'featured'
    && BIZ.bizTypeOf(costoreLike, null) === 'costore');
  // 门店收益与合店老板收益的金额不可合并统计
  const storeSum = storeComms.reduce((s, c) => s + c.amount, 0);
  ok('门店收益独立求和（不与合店费混算）', storeSum > 0 && storeComms.every((c) => c.type === 'product'), String(round2(storeSum)));
}

console.log(`\n${'='.repeat(50)}`);
console.log(`通过 ${pass} / 失败 ${fail}`);
console.log('='.repeat(50));
process.exit(fail > 0 ? 1 : 0);

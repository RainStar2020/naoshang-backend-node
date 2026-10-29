/**
 * 产品分成 + 代理新规格校验（用户 2026-10-23，依据图1/图2/图3/图4/图5 + 口述）
 *
 * 覆盖：
 *  ① 产品目录（图5）
 *  ② 成交价 = 固定成本 + 变动 × 档位折扣
 *  ③ 合伙人产品提成 5/10/15/15%（替代旧 2% 复购奖，可回滚 flat2）
 *  ④ 特色产品分成 15/2/8/(5+5)/(30+30+5)（巡查归区县负责人、销售归店长、两交付模式）
 *  ⑤ 代理固定上级链（无跨级）实物级差
 *  ⑥ 新价格表（图1）+ 技术费
 *  ⑦ 直推代理奖 = 新技术费 × 合伙人直推比例
 *  ⑧ 业务提成 = 新技术费 × 开发代理业务提点
 *  ⑨ 两笔提成组合
 *  ⑩ 行政费 5/5/90 角色标注 + 股东固定 1 人
 *  ⑪ appointAgent 落账集成（幂等）
 */
const RA = require('../src/regionAgent');
const PS = require('../src/productSplit');
const S = require('../src/store');

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
function throws(label, fn) {
  try { fn(); fail++; console.log(`  ✗ ${label}（未抛错）`); }
  catch (e) { pass++; console.log(`  ✓ ${label} → ${e.message}`); }
}
function head(t) { console.log(`\n===== ${t} =====`); }

head('① 产品目录（图5）');
eq('脑商Pad 6980', PS.getProduct('pad').listPrice, 6980);
eq('记忆卡 998', PS.getProduct('memoryCard').listPrice, 998);
eq('陪练卡 2000', PS.getProduct('coachCard').listPrice, 2000);
eq('特色产品 1300', PS.getProduct('featured').listPrice, 1300);
eq('特色营 10000', PS.getProduct('featuredCamp').listPrice, 10000);
eq('特色营 固定成本 8000', PS.getProduct('featuredCamp').fixedCost, 8000);
eq('特色营 变动成本 2000', PS.getProduct('featuredCamp').variableCost, 2000);
ok('脑商Pad 为实物', PS.getProduct('pad').kind === 'physical');
ok('特色营为特色产品', PS.getProduct('featuredCamp').kind === 'featured');
throws('未知产品抛错', () => PS.getProduct('xxx'));

head('② 成交价 = 固定成本 + 变动 × 档位折扣');
eq('脑商Pad 原价 6980', PS.productPrice('pad', 'list').unitPrice, 6980);
eq('脑商Pad VIP 8折 = 5584', PS.productPrice('pad', 'vip').unitPrice, 5584);
eq('脑商Pad 天使 7.5折 = 5235（官方算例）', PS.productPrice('pad', 'angel').unitPrice, 5235);
eq('脑商Pad 私董 7折 = 4886', PS.productPrice('pad', 'private').unitPrice, 4886);
eq('脑商Pad 联创 6.5折 = 4537', PS.productPrice('pad', 'cofounder').unitPrice, 4537);
eq('脑商Pad 单店代理 5折 = 3490', PS.productPrice('pad', 'store').unitPrice, 3490);
eq('特色营 VIP = 8000 + 2000×0.8 = 9600', PS.productPrice('featuredCamp', 'vip').unitPrice, 9600);
eq('特色营 联创 = 8000 + 2000×0.65 = 9300', PS.productPrice('featuredCamp', 'cofounder').unitPrice, 9300);
eq('特色营 原价 = 10000', PS.productPrice('featuredCamp', 'list').unitPrice, 10000);
eq('记忆卡 私董 7折 = 698.6', PS.productPrice('memoryCard', 'private').unitPrice, 698.6);
eq('数量 2：天使 Pad ×2 = 10470', PS.productPrice('pad', 'angel', 2).total, 10470);
throws('未知档位抛错', () => PS.productPrice('pad', 'king'));

head('③ 合伙人产品提成（VIP5/天使10/私董15/联创15，替代旧2%复购奖）');
eq('VIP 上级：5235×5% = 261.75', PS.partnerProductCommission({ paid: 5235, uplineTier: 'vip' }).amount, 261.75);
eq('天使上级：5235×10% = 523.5', PS.partnerProductCommission({ paid: 5235, uplineTier: 'angel' }).amount, 523.5);
eq('私董上级：5235×15% = 785.25', PS.partnerProductCommission({ paid: 5235, uplineTier: 'private' }).amount, 785.25);
eq('联创上级：5235×15% = 785.25', PS.partnerProductCommission({ paid: 5235, uplineTier: 'cofounder' }).amount, 785.25);
eq('回滚 flat2：5235×2% = 104.7', PS.partnerProductCommission({ paid: 5235, uplineTier: 'angel', mode: 'flat2' }).amount, 104.7);
eq('默认模式为 tier', PS.PRODUCT_COMMISSION_MODE, 'tier');
eq('无上级 → 0', PS.partnerProductCommission({ paid: 5235, uplineTier: null }).amount, 0);
eq('特色产品 1300 全价 · 天使上级 = 130', PS.partnerProductCommission({ paid: 1300, uplineTier: 'angel' }).amount, 130);
ok('公式含档位与比例', /10%/.test(PS.partnerProductCommission({ paid: 5235, uplineTier: 'angel' }).formula));
throws('未知档位抛错', () => PS.partnerProductCommission({ paid: 100, uplineTier: 'diamond' }));

head('④ 特色产品分成 15/2/8/(5+5)/(30+30+5) = 100%');
const f1 = PS.featuredSplit(1300);
eq('特色产品全价：总部 15% = 195', f1.byRecipient.hq, 195);
eq('省代 2% = 26', f1.byRecipient.province, 26);
eq('市代 8% = 104', f1.byRecipient.city, 104);
eq('区县代(管理) 5% = 65', f1.rows.find(r => r.role === 'district_mgmt').amount, 65);
eq('区县代(巡查) 5% = 65', f1.rows.find(r => r.role === 'district_inspect').amount, 65);
eq('单店(交付) 30% = 390', f1.rows.find(r => r.role === 'store_delivery').amount, 390);
eq('单店(流量) 30% = 390', f1.rows.find(r => r.role === 'store_traffic').amount, 390);
eq('店长(销售) 5% = 65', f1.rows.find(r => r.role === 'store_sales').amount, 65);
eq('合计 = 1300', f1.total, 1300);
ok('100% 闭环', f1.closure === true);
ok('比例合计 = 1', f1.rateClosure === true);
ok('巡查 5% 为待分配项（权归区县负责人）', f1.pending.length === 1 && f1.pending[0].role === 'district_inspect');
ok('销售 5% 固定归店长/单店负责人', /店长\/单店负责人/.test(f1.rows.find(r => r.role === 'store_sales').note));
// 特色营：实付 10000 − 固定成本 8000 → 池 2000
const f2 = PS.featuredSplit(10000, { fixedCost: 8000 });
eq('特色营：分成池 = 10000 − 8000 = 2000', f2.pool, 2000);
eq('总部 15% = 300', f2.byRecipient.hq, 300);
eq('省代 2% = 40', f2.byRecipient.province, 40);
eq('市代 8% = 160', f2.byRecipient.city, 160);
eq('合计 = 2000', f2.total, 2000);
ok('闭环', f2.closure === true);
// 总部交付模式：门店 30% 交付 + 区县 5% 巡查 收归总部
const f3 = PS.featuredSplit(1300, { deliveryType: 'hq' });
eq('总部交付：总部 = 15%+30%+5% = 650', f3.byRecipient.hq, 650);
eq('总部交付：省代 2% = 26', f3.byRecipient.province, 26);
eq('总部交付：市代 8% = 104', f3.byRecipient.city, 104);
eq('总部交付：区县仅留管理 5% = 65', f3.byRecipient.district, 65);
eq('总部交付：门店留 流量30%+销售5% = 455', f3.byRecipient.store, 455);
eq('总部交付：合计 = 1300', f3.total, 1300);
ok('总部交付闭环', f3.closure === true);
// 特色营 VIP 价 9600 → 池 1600
const f4 = PS.featuredSplit(9600, { fixedCost: 8000 });
eq('特色营 VIP 价 9600 → 池 1600', f4.pool, 1600);
eq('总部 15% = 240', f4.byRecipient.hq, 240);
eq('合计 = 1600', f4.total, 1600);
ok('闭环', f4.closure === true);
// 巡查分配
const f5 = PS.featuredSplit(1300, { inspectionAssignee: 'upperCity' });
ok('区县负责人已分配巡查 → upperCity', /upperCity/.test(f5.rows.find(r => r.role === 'district_inspect').note));
throws('非法交付类型抛错', () => PS.featuredSplit(1300, { deliveryType: 'xxx' }));

head('⑤ 代理固定上级链（无跨级）实物级差');
eq('单店上级 = 区县', PS.AGENT_UPLINE.store, 'district');
eq('区县上级 = 市代', PS.AGENT_UPLINE.district, 'city');
eq('市代上级 = 省代', PS.AGENT_UPLINE.city, 'province');
eq('省代上级 = 总部', PS.AGENT_UPLINE.province, 'hq');
eq('固定链 store → [district,city,province,hq]', PS.agentUplineChain('store').join(','), 'district,city,province,hq');
const ch1 = PS.agentChainTierDiff({ buyerLevel: 'vip', sellerLevel: 'store', basePrice: 6980 });
eq('门店赚 (0.8−0.5)×6980 = 2094', ch1.rows.find(r => r.level === 'store').amount, 2094);
eq('区县赚 (0.5−0.4)×6980 = 698', ch1.rows.find(r => r.level === 'district').amount, 698);
eq('市代赚 (0.4−0.35)×6980 = 349', ch1.rows.find(r => r.level === 'city').amount, 349);
eq('省代赚 (0.35−0.3)×6980 = 349', ch1.rows.find(r => r.level === 'province').amount, 349);
eq('总部收 0.3×6980 = 2094', ch1.rows.find(r => r.level === 'hq').amount, 2094);
eq('合计 = 6980×0.8 = 5584', ch1.total, 5584);
ok('闭环（实付=合计）', ch1.closure === true);
const ch2 = PS.agentChainTierDiff({ buyerLevel: 'angel', sellerLevel: 'store', basePrice: 6980 });
eq('天使买方：合计 = 6980×0.75 = 5235', ch2.total, 5235);
ok('闭环', ch2.closure === true);
throws('卖方不能是总部', () => PS.agentChainTierDiff({ buyerLevel: 'vip', sellerLevel: 'hq' }));
throws('买方折扣须大于卖方', () => PS.agentChainTierDiff({ buyerLevel: 'store', sellerLevel: 'store' }));

head('⑤b AI软件卡（记忆卡）固定拿货价拿货差价（省150/市170/区县250/单店350）');
eq('固定拿货价导出 = 省150/市170/区县250/单店350',
  PS.MEMORY_CARD_PICK_PRICE.province === 150 && PS.MEMORY_CARD_PICK_PRICE.city === 170
  && PS.MEMORY_CARD_PICK_PRICE.district === 250 && PS.MEMORY_CARD_PICK_PRICE.store === 350, true);
const mc1 = PS.cardTierDiff({ paid: 798.4, buyerLevel: 'vip', sellerLevel: 'store', listPrice: 998 });
eq('VIP 在单店买：链底 = 798.4 − 350 = 448.4', mc1.rows.find(r => r.level === 'store').amount, 448.4);
eq('区县 = 350 − 250 = 100', mc1.rows.find(r => r.level === 'district').amount, 100);
eq('市代 = 250 − 170 = 80', mc1.rows.find(r => r.level === 'city').amount, 80);
eq('省代 = 170 − 150 = 20', mc1.rows.find(r => r.level === 'province').amount, 20);
eq('总部收省级拿货价 = 150', mc1.rows.find(r => r.level === 'hq').amount, 150);
eq('闭环 = 798.4', mc1.total, 798.4);
ok('闭环', mc1.closure === true);
// 代理本人进货（无卖方上级）→ 总部直供
const mc2 = PS.cardTierDiff({ paid: 150, buyerLevel: 'province', sellerLevel: null, listPrice: 998 });
eq('省代本人进货：总部直供 = 150', mc2.rows.find(r => r.level === 'hq').amount, 150);
ok('省代自购闭环', mc2.closure === true);
throws('卖方必须是代理级别', () => PS.cardTierDiff({ paid: 1, buyerLevel: 'vip', sellerLevel: 'hq', listPrice: 998 }));

head('⑥ 新价格表（图1，按人数分档）+ 技术费');
eq('省代 合计 260w', RA.agentPrice('province').total, 2600000);
eq('省代 技术费 200w（品牌费）', RA.agentTechFee('province'), 2000000);
eq('市代 档0 合计 35w', RA.agentPrice('city', 0).total, 350000);
eq('市代 档1 合计 30w', RA.agentPrice('city', 1).total, 300000);
eq('市代 档2 合计 20w', RA.agentPrice('city', 2).total, 200000);
eq('区县代 档0 合计 30w', RA.agentPrice('district', 0).total, 300000);
eq('区县代 档2 合计 10w', RA.agentPrice('district', 2).total, 100000);
eq('单店代理 合计 8w', RA.agentPrice('store').total, 80000);
eq('单店代理 技术费 4w（用户确认口径）', RA.agentTechFee('store'), 40000);
eq('档位越界取最高档：city,99 → 35w', RA.agentPrice('city', 99).total, 350000);
throws('未知代理级别抛错', () => RA.agentPrice('kingdom'));

head('⑦ 直推代理奖 = 新技术费 × 推荐人合伙人直推比例');
eq('联创直推单店代理：40000×15% = 6000（非 80000×15%）', RA.agentDirectReferralBonus({ developerTier: 'cofounder', newRegionType: 'store' }).amount, 6000);
eq('天使直推单店代理：40000×10% = 4000', RA.agentDirectReferralBonus({ developerTier: 'angel', newRegionType: 'store' }).amount, 4000);
eq('VIP 直推单店代理：40000×5% = 2000', RA.agentDirectReferralBonus({ developerTier: 'vip', newRegionType: 'store' }).amount, 2000);
eq('私董直推单店代理：40000×15% = 6000', RA.agentDirectReferralBonus({ developerTier: 'private', newRegionType: 'store' }).amount, 6000);
eq('联创直推市代(35w档)：350000×15% = 52500', RA.agentDirectReferralBonus({ developerTier: 'cofounder', newRegionType: 'city', newTier: 0 }).amount, 52500);
ok('备注「只算技术费」', /只算技术费/.test(RA.agentDirectReferralBonus({ developerTier: 'angel', newRegionType: 'store' }).note));

head('⑧ 业务提成 = 新技术费 × 开发代理业务提点');
eq('市代开发单店代理：40000×18% = 7200', RA.agentBusinessCommission({ developerRegionType: 'city', newRegionType: 'store' }).amount, 7200);
eq('区县代开发单店代理：40000×15% = 6000', RA.agentBusinessCommission({ developerRegionType: 'district', newRegionType: 'store' }).amount, 6000);
eq('省代开发单店代理：40000×20% = 8000', RA.agentBusinessCommission({ developerRegionType: 'province', newRegionType: 'store' }).amount, 8000);
eq('单店代理开发单店代理：40000×15% = 6000', RA.agentBusinessCommission({ developerRegionType: 'store', newRegionType: 'store' }).amount, 6000);
eq('市代开发区县代(10w档)：100000×18% = 18000', RA.agentBusinessCommission({ developerRegionType: 'city', newRegionType: 'district', newTier: 2 }).amount, 18000);

head('⑨ 两笔提成组合（直推奖 + 业务提成）');
const combo = RA.agentAppointmentCommissions(
  { id: 'dev1', tier: 'angel', regionType: 'city' },
  { regionType: 'store', tier: 0 },
);
eq('天使+市代 开发单店代理：直推奖 = 4000', combo.direct.amount, 4000);
eq('天使+市代 开发单店代理：业务提成 = 7200', combo.business.amount, 7200);
const combo2 = RA.agentAppointmentCommissions({ id: 'dev2', tier: 'cofounder', regionType: null }, { regionType: 'store', tier: 0 });
eq('仅合伙人身份：直推奖 6000', combo2.direct.amount, 6000);
ok('仅合伙人身份：无业务提成', combo2.business === null);
const combo3 = RA.agentAppointmentCommissions({ id: 'dev3', tier: 'user', regionType: 'district' }, { regionType: 'store', tier: 0 });
ok('仅代理身份：无直推奖', combo3.direct === null);
eq('仅代理身份：业务提成 6000', combo3.business.amount, 6000);
const combo4 = RA.agentAppointmentCommissions(null, { regionType: 'store', tier: 0 });
ok('无开发人：两笔都为 null', combo4.direct === null && combo4.business === null);

head('⑩ 行政费 5/5/90 角色标注 + 股东固定 1 人');
const af = PS.adminFeeSplitDetail(10000);
eq('总部 5% = 500', af.rows.find(r => r.role === 'hq').amount, 500);
eq('销售门店 5% = 500', af.rows.find(r => r.role === 'ownStore').amount, 500);
eq('上课团队 90% = 9000', af.rows.find(r => r.role === 'delivery').amount, 9000);
ok('角色标注：总部/销售门店/上课团队', af.rows.map(r => r.label).join('/') === '总部/销售门店/上课团队');
ok('闭环', af.closure === true);
eq('门店股东固定 1 人', PS.STORE_OWNER_COUNT, 1);
const sd1 = RA.storeDeliveryAllocation(1600, undefined, { regionType: 'store' });
eq('默认股东 1 人：门店池 65% = 1040', sd1.storePool, 1040);
eq('默认股东 1 人：每股东净额 = 1040 − 32 = 1008', sd1.perOwnerNet, 1008);

head('⑪ appointAgent 落账集成（store.js，幂等）');
const db = S.createDb();
S.addUser(db, { id: 'cof1', tier: 'cofounder', phone: '1' });
S.addUser(db, { id: 'ang1', tier: 'angel', phone: '2' });
S.addUser(db, { id: 'new1', tier: 'angel', phone: '3' });
S.addUser(db, { id: 'new2', tier: 'cofounder', phone: '4' });
// 开发人1：天使合伙人（无代理身份）→ 只发直推奖
const r1 = S.appointAgent(db, { partnerId: 'new1', regionType: 'store', referrerId: 'ang1' });
eq('任命后落账 1 笔（直推奖）', r1.commissions.length, 1);
eq('直推代理奖 = 40000×10% = 4000', r1.commissions[0].amount, 4000);
eq('佣金 id 确定性', r1.commissions[0].id, `agdirect-${r1.agent.id}`);
eq('owner = 开发人', r1.commissions[0].owner_id, 'ang1');
// 开发人2：联创 + 市代 → 两笔都发
S.appointAgent(db, { partnerId: 'cof1', regionType: 'city' });
const r2 = S.appointAgent(db, { partnerId: 'new2', regionType: 'store', referrerId: 'cof1' });
eq('联创+市代开发：两笔都发', r2.commissions.length, 2);
eq('直推奖 = 40000×15% = 6000', r2.commissions.find(c => c.subtype === 'agent_direct').amount, 6000);
eq('业务提成 = 40000×18% = 7200', r2.commissions.find(c => c.subtype === 'agent_biz').amount, 7200);
// 无开发人 → 不落账
S.addUser(db, { id: 'new3', tier: 'angel', phone: '5' });
const r3 = S.appointAgent(db, { partnerId: 'new3', regionType: 'store' });
eq('无开发人：不落账', r3.commissions.length, 0);
// 幂等：同 id 重放不翻倍
S.upsertCommission(db, { ...r1.commissions[0], amount: 9999 });
eq('同 id 覆盖不翻倍', db.commissions.filter(c => c.id === r1.commissions[0].id).length, 1);
eq('覆盖后金额生效', db.commissions.find(c => c.id === r1.commissions[0].id).amount, 9999);
// 非法开发人
S.addUser(db, { id: 'new4', tier: 'angel', phone: '6' });
throws('开发人=本人抛错', () => S.appointAgent(db, { partnerId: 'new4', regionType: 'store', referrerId: 'new4' }));
throws('开发人不存在抛错', () => S.appointAgent(db, { partnerId: 'new4', regionType: 'store', referrerId: 'ghost' }));

console.log(`\n${'='.repeat(50)}`);
console.log(`通过 ${pass} / 失败 ${fail}`);
console.log('='.repeat(50));
process.exit(fail > 0 ? 1 : 0);

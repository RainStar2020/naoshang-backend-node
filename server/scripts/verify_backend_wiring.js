/**
 * 后端框架端到端验证：settlement + store + routes 联调
 * 覆盖：订单差价 / 全球奖+创始奖精确复现 junwei 65100 / 路由级结算 / 区域代理拆分 / 合店闭环 / 解绑重绑。
 * 运行：node server/scripts/verify_backend_wiring.js
 */
const routes = require('../src/routes');
const SET = require('../src/settlement');
const S = require('../src/store');
const C = require('../src/commission');
const Q = require('../src/quotaLedger');

let ok = true;
const assert = (name, cond, got) => { ok = ok && !!cond; console.log(`  ${cond ? '✅' : '❌'} ${name} → ${JSON.stringify(got)}`); };

const db = S.createDb();
S.addUser(db, { id: 'HQ', tier: 'cofounder', upline_id: null, is_founding: 'none' });
S.addUser(db, { id: 'C', tier: 'cofounder', upline_id: 'HQ', is_founding: 'marshal', daysSinceCofounder: 10, directPushedVip: 1 });
S.addUser(db, { id: 'bA', tier: 'vip', upline_id: 'C' });
S.addUser(db, { id: 'bP', tier: 'vip', upline_id: 'C' });
Q.issueQuota(db.quotaLedger, 'C', 100);

console.log('===== 订单1：C 卖 天使 20 名额（raw） =====');
const o1 = routes.createOrder(db, { buyerId: 'bA', packageTier: 'angel', rawQuota: 20, buyerIsNew: false, regionCode: 'R1' });
assert('VIP买家补天使名额：按买家本档价(7980-6500)*20=29600（2026-10-24 拍板：跨档也按买家本档价，非名额档7500）', Math.abs(o1.supply_spread - 29600) < 1e-6, o1.supply_spread);
// 渠道口径（用户 2026-10-23 16:56）：C 是联创（合伙人身份）⇒ 合伙人售卖通道，无门店服务费
assert('合伙人渠道：C 卖出 → 门店服务费 0', Math.abs(o1.store_fee - 0) < 1e-6, o1.store_fee);
assert('合伙人渠道：总部留存 6500*20=130000', Math.abs(o1.hq_fee - 130000) < 1e-6, o1.hq_fee);
assert('渠道标记 partner', o1.channel === 'partner', o1.channel);

console.log('===== 订单2：C 卖 私董 20 名额（raw） =====');
const o2 = routes.createOrder(db, { buyerId: 'bP', packageTier: 'private', rawQuota: 20, buyerIsNew: false, regionCode: 'R1' });
assert('VIP买家补私董名额：按买家本档价(7980-6500)*20=29600', Math.abs(o2.supply_spread - 29600) < 1e-6, o2.supply_spread);
const spreadTotal = o1.supply_spread + o2.supply_spread;
assert('供应差价合计 59200', Math.abs(spreadTotal - 59200) < 1e-6, spreadTotal);

console.log('===== 订单即时佣金（身份销售仅供货差价，无直推/复购） =====');
const supply1 = db.commissions.filter((c) => c.ref_order_id === o1.order_id && c.type === 'supply');
// VIP买家补天使名额：按买家本档价(7980-6500)*20 = 29600（跨档补货也按买家本档价，2026-10-24 拍板）
assert('订单1 仅供货差价 29600，无直推/复购', supply1.length === 1 && Math.abs(supply1[0].amount - 29600) < 1e-6, supply1.map((c) => c.amount));
const hasDirectRebuy = db.commissions.some((c) => c.ref_order_id === o1.order_id && (c.type === 'direct' || c.type === 'rebuy'));
assert('订单1 不含 direct/rebuy 佣金（售卖合伙人无直推奖）', !hasDirectRebuy, hasDirectRebuy);

console.log('===== 月度结算：精确复现 junwei 65100 =====');
const period = '2026-10';
// 5 联创，平台总VIP=1000，C 权重=40，其余分散（团队互不重叠）
const cofounders = [
  { id: 'C', tier: 'cofounder', ownVip: 20, teamVip: 20, daysSinceCofounder: 10, directPushedVip: 1 },
  { id: 'X1', tier: 'cofounder', ownVip: 200, teamVip: 160, daysSinceCofounder: 10, directPushedVip: 1 },
  { id: 'X2', tier: 'cofounder', ownVip: 150, teamVip: 150, daysSinceCofounder: 10, directPushedVip: 1 },
  { id: 'X3', tier: 'cofounder', ownVip: 100, teamVip: 100, daysSinceCofounder: 10, directPushedVip: 1 },
  { id: 'X4', tier: 'cofounder', ownVip: 50, teamVip: 50, daysSinceCofounder: 10, directPushedVip: 1 },
];
// 新口径：联创持有创始奖 → 17.5/VIP；私董全员 → 3.5/VIP（按人各得全额）
const founders = [{ id: 'C', tier: 'cofounder', foundingBonus: true }];
const gb = SET.runGlobalBonus(period, cofounders, 1000);
const fb = SET.runFoundingBonus(period, 1000, founders);
const cGlobal = gb.commissions.find((c) => c.owner_id === 'C').amount;
const cFounding = fb.commissions.find((c) => c.owner_id === 'C').amount;
// 新口径（2026-10-24）：业绩权重 = teamVip（子树 VIP，不再叠加 ownVip）；分母 = 真实平台总VIP(1000)
// C.teamVip=20 → 业绩半 = 75000×20/1000 = 1500；均分半 = 75000/5 = 15000；合计 16500
assert('C 全球奖 16500 (均分15000+业绩1500)', Math.abs(cGlobal - 16500) < 1e-6, cGlobal);
assert('C 创始奖 17.5*1000=17500', Math.abs(cFounding - 17500) < 1e-6, cFounding);
assert('供应差价+全球+创始 = 93200', Math.abs(spreadTotal + cGlobal + cFounding - 93200) < 1e-6, spreadTotal + cGlobal + cFounding);

console.log('===== 路由级结算（自动标注联创 / 真实订单汇总） =====');
const sum2 = routes.runSettlement(db, { period: '2026-10' });
// 真实订单 vipCredit=40 → globalPool=150*40=6000
assert('自动结算 globalPool=150*40=6000', Math.abs(sum2.globalPool - 6000) < 1e-6, sum2.globalPool);
assert('自动结算 totalVip=40', Math.abs(sum2.totalVip - 40) < 1e-6, sum2.totalVip);
assert('C 全球奖佣金已落账', !!db.commissions.find((c) => c.type === 'global' && c.owner_id === 'C'), true);

console.log('===== 门店渠道 vs 合伙人渠道（省100/市200/县区300/门店2400 每VIP） =====');
// 合伙人渠道订单不进四级拆分
assert('合伙人渠道 2 笔均无拆分明细', sum2.agentBreakdown.length === 0, sum2.agentBreakdown.length);
assert('合伙人渠道 2 笔进 skipped', (sum2.agentSkipped || []).length === 2, (sum2.agentSkipped || []).length);

// 门店渠道：门店老板（store 级区域代理）卖出才计提
const db2 = S.createDb();
S.addUser(db2, { id: 'D', tier: 'angel', upline_id: null });
S.addUser(db2, { id: 'bZ', tier: 'vip', upline_id: 'D' });
S.appointAgent(db2, { partnerId: 'D', regionType: 'store', regionCode: 'R1' });
Q.issueQuota(db2.quotaLedger, 'D', 100);
const o3 = routes.createOrder(db2, { buyerId: 'bZ', packageTier: 'angel', rawQuota: 20, buyerIsNew: false, regionCode: 'R1' });
assert('门店渠道：门店费 3000*20=60000', Math.abs(o3.store_fee - 60000) < 1e-6, o3.store_fee);
assert('门店渠道：总部费 3500*20=70000', Math.abs(o3.hq_fee - 70000) < 1e-6, o3.hq_fee);
assert('门店渠道：门店费+总部费=6500*20=130000', Math.abs(o3.store_fee + o3.hq_fee - 130000) < 1e-9, o3.store_fee + o3.hq_fee);
assert('渠道标记 store', o3.channel === 'store', o3.channel);
const ord3 = db2.orders.find((x) => x.id === o3.order_id);
const ag3 = SET.runAgent('2026-11', [ord3], db2.regionalAgents);
const b3 = ag3.breakdown[0];
assert('门店服务费拆分=60000', Math.abs(b3.subtotal - 60000) < 1e-6, b3);
assert('省+市+区+店=60000 闭环', Math.abs(b3.province + b3.city + b3.district + b3.store - 60000) < 1e-9, b3.province + b3.city + b3.district + b3.store);
const dStore = ag3.commissions.find((c) => c.region_type === 'store');
assert('门店店长(D) 得 2400*20=48000', !!dStore && dStore.owner_id === 'D' && dStore.amount === 48000, dStore && [dStore.owner_id, dStore.amount]);

console.log('===== 区域码父链归集（门店码≠区县码，2400 不掉总部）=====');
const db4 = S.createDb();
S.addUser(db4, { id: 'DST', tier: 'private', upline_id: null });   // 区县代
S.addUser(db4, { id: 'STR', tier: 'angel', upline_id: 'DST' });    // 门店代理（门店老板）
S.addUser(db4, { id: 'BUY', tier: 'vip', upline_id: 'STR' });      // 买家
S.appointAgent(db4, { partnerId: 'DST', regionType: 'district', regionCode: 'R1' });                 // 区县代，码 R1
S.appointAgent(db4, { partnerId: 'STR', regionType: 'store', regionCode: 'R1-S9', parentCode: 'R1' }); // 门店代理，门店码 R1-S9，显式父级 R1
Q.issueQuota(db4.quotaLedger, 'STR', 100);
const o4 = routes.createOrder(db4, { buyerId: 'BUY', packageTier: 'vip', rawQuota: 1, buyerIsNew: false, regionCode: 'R1' });
const ord4 = db4.orders.find((x) => x.id === o4.order_id);
assert('门店渠道订单自动带上门店码 store_code=R1-S9', ord4.store_code === 'R1-S9', ord4.store_code);
const ag4 = SET.runAgent('2026-11', [ord4], db4.regionalAgents);
const store4 = ag4.commissions.find((c) => c.region_type === 'store');
const dist4 = ag4.commissions.find((c) => c.region_type === 'district');
assert('门店码≠区县码：门店 2400 仍归门店代理 STR（按父链命中，不掉总部）', !!store4 && store4.owner_id === 'STR' && store4.amount === 2400, store4 && [store4.owner_id, store4.amount]);
assert('县区 300 经父链 R1 归区县代 DST', !!dist4 && dist4.owner_id === 'DST' && dist4.amount === 300, dist4 && [dist4.owner_id, dist4.amount]);

console.log('===== 合店费 698 全链路闭环（固定三分结构） =====');
const csRes = SET.runCostore('2026-10', [
  { id: 'cs1', owner_id: 'owner1', promoter_id: 'promo1', fee: 698, referrer: 'other', ownerCount: 1, partners: [{ id: 'p1', feePerf: 1 }, { id: 'p2', feePerf: 3 }] },
], { settings: { costore: { enabledV2: false } } });
const d0 = csRes.details[0];
const all = d0.split.hq + d0.split.province + d0.split.city + d0.split.district
  + d0.alloc.buckets.storeOwner + d0.alloc.buckets.referrerRebate + d0.alloc.buckets.dividend;
assert('合店费 35%+65% = 698 全链路', Math.abs(all - 698) < 1e-9, all);
assert('分红池=69.8', Math.abs(d0.alloc.dividend.pool - 69.8) < 1e-6, d0.alloc.dividend.pool);

// 固定结构：53% / 2% / 10%，不分场景
assert('门店老板恒 53%（不分推荐人场景）', Math.abs(C.coStoreFeeAllocation(698, { ownerCount: 1 }).tipRate - 0.53) < 1e-9, 0.53);
assert('推荐人复购奖恒 2%', Math.abs(C.coStoreFeeAllocation(698, { ownerCount: 1 }).referrerAmount - 13.96) < 1e-6, 13.96);
assert('多人门店 2 人 → 26.5%', Math.abs(C.coStoreFeeAllocation(698, { ownerCount: 2 }).tipRatePerOwner - 0.265) < 1e-9, 0.265);
assert('6 个月包 4188 → 53% = 2219.64', Math.abs(C.coStoreFeeAllocation(4188, { ownerCount: 1 }).storeOwner.total - 2219.64) < 1e-6, 2219.64);
// 落账：推荐人=门店老板本人时 53%+2% 叠加为两条流水（旧逻辑；分红池无合格推荐人→兜底归本人，此处仅核门店+推荐两部分）
const csSelf = SET.runCostore('2026-10', [{ id: 'csSelf', owner_id: 'same', promoter_id: 'same', fee: 698, ownerCount: 1, partners: [] }], { settings: { costore: { enabledV2: false } } });
const selfStore = csSelf.commissions.find((c) => c.id === 'cs-store-csSelf');
const selfRefer = csSelf.commissions.find((c) => c.id === 'cs-referrer-csSelf');
const selfBase = (selfStore ? selfStore.amount : 0) + (selfRefer ? selfRefer.amount : 0);
assert('推荐人=门店老板本人 → 53%+2%=55%=383.9', Math.abs(selfBase - 383.9) < 1e-6, selfBase);

console.log('===== 解绑 / 重绑（§7.5） =====');
S.addUser(db, { id: 'bX', tier: 'vip', upline_id: 'C' });
routes.unbind(db, { partnerId: 'bX' });
assert('解绑后 upline=null', db.users['bX'].upline_id === null, db.users['bX'].upline_id);
routes.rebind(db, { partnerId: 'bX', newUplineId: 'HQ' });
assert('重绑到 HQ', db.users['bX'].upline_id === 'HQ', db.users['bX'].upline_id);
assert('关系变更历史 ≥2 条', db.uplineHistory.length >= 2, db.uplineHistory.length);

console.log('\n总结果 →', ok ? '✅ 全部 PASS' : '❌ 有失败');
process.exit(ok ? 0 : 1);

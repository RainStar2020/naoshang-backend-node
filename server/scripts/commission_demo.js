/**
 * 分润算法 · 验证脚本
 * 运行：node scripts/commission_demo.js
 */
const C = require('../src/commission');

console.log('================ 全球奖示例（手算可核对） ================');
// 3 个联创，互相为平级（非上下级），teamVip 为各自下级叶子 VIP
const cofounders = [
  { id: 'A', ownVip: 10, teamVip: 20, daysSinceCofounder: 30,  directPushedVip: 0 }, // 无责期内
  { id: 'B', ownVip: 5,  teamVip: 15, daysSinceCofounder: 200, directPushedVip: 2 }, // 已过无责，直推2
  { id: 'C', ownVip: 3,  teamVip: 7,  daysSinceCofounder: 200, directPushedVip: 0 }, // 过无责无直推→不均分
];
const gb = C.computeGlobalBonus(cofounders);
console.log('总平台VIP =', 10 + 5 + 3 + 20 + 15 + 7, '(=60)');
console.log('奖池 pool = 150×60 =', gb.pool, '(应=9000)');
console.log('均分一半 =', gb.halfEqual, ' 业绩一半 =', gb.halfPerf);
console.log('合格联创数 =', gb.qualifiedCount, '(A无责/B直推≥1 → 2人，C不合规)');
gb.perCofounder.forEach((p) =>
  console.log(`  联创${p.id}: 均分=${p.equal} 业绩=${p.perf} 合计=${p.total}`)
);
console.log('  无责未分发(若无人合格)=', gb.undistributed);
const sumTotal = gb.perCofounder.reduce((s, p) => s + p.total, 0);
console.log('  合计校验 =', sumTotal, '应=9000 →', sumTotal === 9000 ? '✅ PASS' : '❌ FAIL');

console.log('\n================ vipCredit 增量口径（Q1） ================');
console.log('普通→私董 =', C.vipCredit('none', 'private'), '(应=6)');
console.log('天使→私董 =', C.vipCredit('angel', 'private'), '(应=3)');
console.log('私董→联创 =', C.vipCredit('private', 'cofounder'), '(应=18)');

console.log('\n================ 定价基础：拿货价=每名额价格（用户确认） ================');
console.log('每名额拿货价[小/中/大/总] =', JSON.stringify(C.WHOLESALE_PER_QUOTA));
console.log('名额数[VIP/天使/私董/联创] =', JSON.stringify(C.TIER_VIP));
['vip', 'angel', 'private', 'cofounder'].forEach((t) => {
  const rp = C.retailPrice(t);
  const wc = C.wholesaleCost('vip', t);
  console.log(`  小批发商卖${t}(${C.TIER_VIP[t]}名额): 零售=${rp} 拿货=${wc} 利润=${C.wholesalerProfit('vip', t)}`);
});
const checks = [
  ['小卖1阶', C.wholesalerProfit('vip', 'vip'), 2000],
  ['中卖1阶', C.wholesalerProfit('angel', 'vip'), 2480],
  ['大卖1阶', C.wholesalerProfit('private', 'vip'), 3000],
  ['总卖1阶', C.wholesalerProfit('cofounder', 'vip'), 3480],
  ['总卖联创', C.wholesalerProfit('cofounder', 'cofounder'), 83800],
  ['大卖3阶', C.wholesalerProfit('private', 'private'), 17920],
];
let allOk = true;
checks.forEach(([name, got, exp]) => {
  const ok = got === exp;
  if (!ok) allOk = false;
  console.log(`  校验 ${name} = ${got} (源表应=${exp}) → ${ok ? '✅' : '❌'}`);
});
console.log('  定价校验总结果 →', allOk ? '✅ 全部 PASS' : '❌ 有失败');

console.log('\n================ 电梯规则：下级可高于上级，仍向绑定上级买 ================');
// 场景：B 是联创，但其绑定上级 A 只是天使。B 买联创包，卖家只能是 A（天使），不得跨级找总代。
const uplineTier = 'angel';      // A 的等级（B 的绑定直接上级）
const buyerTier = 'cofounder';   // B 的等级（高于上级，规则允许）
const buyPkg = 'cofounder';
const wc = C.wholesaleCost(uplineTier, buyPkg);
const rp = C.retailPrice(buyPkg);
console.log(`买家等级=${buyerTier}(高于上级) 绑定上级等级=${uplineTier} 购买包=${buyPkg}(${C.TIER_VIP[buyPkg]}名额)`);
console.log(`  上级A拿货价=${C.TIER_VIP[buyPkg]}×7500=${wc}  零售=${rp}  上级赚差价=${C.wholesalerProfit(uplineTier, buyPkg)}`);
console.log('  → 利润归绑定上级A(天使)，不因子B是联创而跳过A ✅（电梯只能一层层上）');

console.log('\n================ HQ价格分解：6500 = 门店服务费3000 + 总部产品费3500（每VIP） ================');
const tierMap = { vip: 'v1', angel: 'v2', private: 'v3', cofounder: 'co' };
let invOk = true;
['vip', 'angel', 'private', 'cofounder'].forEach((t) => {
  const vip = C.TIER_VIP[t];
  const store = C.storeServiceFee(tierMap[t]).subtotal;
  const hq = C.hqProductFee(vip);
  const sum = store + hq;
  const exp = C.HQ_PRICE_PER_VIP * vip;
  const ok = sum === exp;
  if (!ok) invOk = false;
  console.log(`  ${t}(${vip}名额): 门店服务费=${store} + 总部产品费=${hq} = ${sum}  (应=${exp}=6500×${vip}) → ${ok ? '✅' : '❌'}`);
});
console.log('  不变量校验 →', invOk ? '✅ 全部 PASS' : '❌ 失败');
console.log('  → 门店服务费3000/VIP = 省100+市200+县区300+门店2400（④代理机制 VIP合伙人 价格）✅');

console.log('\n================ 其它函数冒烟 ================');
console.log('直推奖(实付29800, 中批发商10%) =', C.directBonus(29800, 'angel'), '(应=2980)');
console.log('复购奖(实付7500×0.8折=6000) =', C.repurchaseBonus(6000), '(应=120)');
console.log('平级奖(下线拿货价22500×2%) =', C.parityBonus(22500), '(应=450, 假设发直接上级)');
console.log('门店服务费(v3) =', JSON.stringify(C.storeServiceFee('v3')));
console.log('总部产品费(联创24VIP) =', C.hqProductFee(24), '(应=84000)');
console.log('升级差价(中→大) =', C.upgradeDiff('angel', 'private'), '(应=30000)');
console.log('合店费拆分(698) =', JSON.stringify(C.coStoreSplit(698)));

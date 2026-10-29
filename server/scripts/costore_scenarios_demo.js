/**
 * 合店（门店）分红 · 固定三分结构复现脚本
 * 数据来源：用户 2026-10-22 逐字口径
 *   「总部拿 15，省拿 2，市拿 8，区/县拿 10，剩下的 65：
 *     53 是门店老板，
 *     2 是给推荐人的，也就是复购奖，
 *     剩下 10 是分给合店店长的，按照一半均分、一半按照每个合店店长的业绩占比分」
 *
 * 闭环：15 + 2 + 8 + 10 + 53 + 2 + 10 = 100%
 * 多人门店：53% 按门店老板人数均分（均分余数并入主门店老板）
 */
const C = require('../src/commission');

const FEE6 = 4188;   // 698 × 6（开通合店老板 6 个月）
const FEE1 = C.COSTORE_FEE_MONTHLY; // 698

let ok = true;
const assert = (name, cond, got) => { ok = ok && !!cond; console.log(`  ${cond ? '✅' : '❌'} ${name} → ${JSON.stringify(got)}`); };
const line = (t) => console.log('\n' + '='.repeat(64) + '\n' + t + '\n' + '='.repeat(64));

line('① 合店费分配总表（698 元/月）');
console.log(JSON.stringify(C.coStoreSplit(FEE1), null, 2));
console.log('门店侧 65% 三分明细：', JSON.stringify(C.coStoreOwnerDetail(FEE1), null, 2));
console.log('三分分解：', JSON.stringify(C.coStoreProfitBreakdown(FEE1), null, 2));
const s1 = C.coStoreSplit(FEE1);
assert('总部体系 35% = 244.3', Math.abs(s1.hqSystem - 244.3) < 1e-6, s1.hqSystem);
assert('门店侧 65% = 453.7（53+2+10）', Math.abs(s1.storeShareholders - 453.7) < 1e-6, s1.storeShareholders);
assert('闭环 = 100%', s1.closure === true, s1.closure);

line('② 固定结构复现：不分推荐人身份场景（合店费 = 4188，即 698×6）');
const scenarios = [
  { key: '单人', biz: '门店老板 1 人',        ownerCount: 1, expect: 0.53 },
  { key: '双人', biz: '门店老板 2 人',        ownerCount: 2, expect: 0.265 },
  { key: '三人', biz: '门店老板 3 人',        ownerCount: 3, expect: 0.1767 },
];
for (const s of scenarios) {
  const r = C.coStoreFeeAllocation(FEE6, {
    ownerCount: s.ownerCount,
    owners: s.ownerCount === 1
      ? [{ id: 'bossA', feePerf: 100 }]
      : s.ownerCount === 2
        ? [{ id: 'bossA', feePerf: 60 }, { id: 'bossB', feePerf: 40 }]
        : [{ id: 'bossA', feePerf: 50 }, { id: 'bossB', feePerf: 30 }, { id: 'bossC', feePerf: 20 }],
  });
  console.log(`\n── ${s.key}「${s.biz}」 ──`);
  console.log('   业务提点（每人）: ' + (r.tipRatePerOwner * 100).toFixed(4) + '%'
    + '   门店老板整体提点: ' + (r.tipRate * 100).toFixed(1) + '%');
  console.log('   各桶金额: ' + JSON.stringify(r.buckets));
  console.log('   门店老板每人所得: ' + r.storeOwner.perOwner + ' 元'
    + (r.storeOwner.perOwnerRemainder ? `（+余数 ${r.storeOwner.perOwnerRemainder} 并入主门店老板）` : ''));
  console.log('   推荐人复购奖 2%: ' + r.referrerAmount + ' 元');
  console.log('   分红池 10% = ' + r.dividend.pool + ' 元 → '
    + r.dividend.partners.map((p) => `${p.id}:${p.total}${p.eligible ? '' : '(未推荐,0)'}`).join('  '));
  assert(`${s.key} 每人提点 ≈ ${(s.expect * 100).toFixed(2)}%`,
    Math.abs(r.tipRatePerOwner - s.expect) < 1e-4, r.tipRatePerOwner);
  assert(`${s.key} 全链路闭环 = ${FEE6}`,
    Math.abs(r.storeOwner.total + r.referrerAmount + r.dividend.pool
      + r.buckets.hq + r.buckets.province + r.buckets.city + r.buckets.district - FEE6) < 1e-6,
    r.storeOwner.total + r.referrerAmount + r.dividend.pool + r.buckets.hq + r.buckets.province + r.buckets.city + r.buckets.district);
}

line('③ 推荐人 = 门店老板本人 → 53% + 2% 叠加 = 55%');
const SELF = C.coStoreFeeAllocation(FEE1, { ownerCount: 1, owners: [{ id: 'me', feePerf: 1 }] });
console.log(`   门店老板 53% = ${SELF.storeOwner.total} + 推荐人 2% = ${SELF.referrerAmount} → 合计 ${(SELF.storeOwner.total + SELF.referrerAmount).toFixed(2)} 元（55%）`);
assert('53%+2% = 55% = 383.9', Math.abs(SELF.storeOwner.total + SELF.referrerAmount - 383.9) < 1e-6,
  SELF.storeOwner.total + SELF.referrerAmount);

line('④ 区域代理视角（省 2% / 市 8% / 区县 10%，总部另得 15%）');
for (const rt of ['province', 'city', 'district']) {
  const a = C.coStoreAgentCommission(rt, FEE6);
  console.log(`   ${rt.padEnd(9)} ${(a.rate * 100).toFixed(0)}% → ${a.amount} 元`);
}
console.log('   总部      15% → ' + C.coStoreSplit(FEE6).hq + ' 元');
assert('省+市+区县+总部 = 35% = 1465.8', Math.abs(C.coStoreSplit(FEE6).hqSystem - 1465.8) < 1e-6, C.coStoreSplit(FEE6).hqSystem);

line('⑤ 单月 698 口径汇总');
for (const s of scenarios) {
  const r = C.coStoreFeeAllocation(FEE1, { ownerCount: s.ownerCount, owners: [{ id: 'b', feePerf: 1 }] });
  console.log(`   ${s.biz}：每名门店老板 ${r.storeOwner.perOwner} 元（${(r.tipRatePerOwner * 100).toFixed(2)}%）`
    + `，推荐人 ${r.referrerAmount} 元，分红池 ${r.dividend.pool} 元`);
}

console.log('\n总结果 →', ok ? '✅ 全部 PASS（与用户逐字口径一致）' : '❌ 有失败');
process.exit(ok ? 0 : 1);
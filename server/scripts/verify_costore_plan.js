'use strict';

/**
 * 合店老板收益逻辑 · 逐条复现用户 2026-10-23 口述（含二次澄清）
 * 运行：node scripts/verify_costore_plan.js
 */

const C = require('../src/costorePlan');

let pass = 0, fail = 0;
const ok = (name, cond, got, expect) => {
  if (cond) { pass++; console.log(`  ✅ ${name} → ${JSON.stringify(got)}`); }
  else { fail++; console.log(`  ❌ ${name} → 实际 ${JSON.stringify(got)}，期望 ${JSON.stringify(expect)}`); }
};
const near = (a, b, t = 0.02) => Math.abs(a - b) <= t;
const line = (t) => console.log('\n' + '='.repeat(78) + '\n' + t + '\n' + '='.repeat(78));

// 单测专用：放宽起付月数到 1，便于用「1 个月 = 698」直观验证百分比。
// 真实「不得少于 6 个月」约束已在 §1 用默认配置单独验证。
const TEST_CFG = { ...C.DEFAULT_CONFIG, minMonths: 1 };

// ═══════════════════ 0. 费率表 & 100% 闭环 ═══════════════════
line('0. 合店费分配比例（应合计 100%）');
console.log('  项目                        比例');
for (const row of C.costorePlanTable()) {
  console.log(`  ${row.name.padEnd(24)} ${(row.rate * 100).toFixed(0).padStart(4)}%`);
}
ok('费率合计 = 100%', C.rateSum() === 1, C.rateSum(), 1);
ok('总部体系 = 15+2+8+10 = 35%', near(C.rateSum() - 0.65, 0.35), 0.35, 0.35);

// ═══════════════════ 1. 合店费总额（可配置、6 个月起） ═══════════════════
line('1. 合店费总额（698 元/月，6 个月起，可自定义）');
const fee6 = C.costoreFeeTotal({ months: 6 });
const fee12 = C.costoreFeeTotal({ months: 12 });
console.log(`   默认：698 × 6 = ${fee6.total}`);
console.log(`   自定义 12 个月：698 × 12 = ${fee12.total}`);
ok('698 × 6 = 4188', near(fee6.total, 4188), fee6.total, 4188);
ok('698 × 12 = 8376', near(fee12.total, 8376), fee12.total, 8376);
ok('默认起付 6 个月', fee6.months === 6, fee6.months, 6);

let threw = false;
try { C.costoreFeeTotal({ months: 5 }); } catch (e) { threw = true; }
ok('少于 6 个月抛错（5 个月）', threw === true, threw, true);

const feeCustom = C.costoreFeeTotal({ monthlyFee: 899, months: 6 });
ok('自定义月费 899 × 6 = 5394（不写死）', near(feeCustom.total, 5394), feeCustom.total, 5394);

// ═══════════════════ 2. 成为合店老板的资格 ═══════════════════
line('2. 资格：必须是 VIP 及以上合伙人');
ok('VIP 可成为合店老板', C.canBeCostoreOwner('vip') === true, C.canBeCostoreOwner('vip'), true);
ok('天使可成为合店老板', C.canBeCostoreOwner('angel') === true, C.canBeCostoreOwner('angel'), true);
ok('普通用户不可成为合店老板', C.canBeCostoreOwner('user') === false, C.canBeCostoreOwner('user'), false);

// ═══════════════════ 3. 四场景整笔分配（1 个月 698） ═══════════════════
line('3. 业务 15% 四场景（以 1 个月 = 698 元为例）');

const show = (res) => {
  console.log(`   ── 场景${res.scenario.code}：${res.scenario.label}`);
  console.log(`      总额 ${res.total}，按人汇总：`);
  for (const p of res.byRecipient) {
    console.log(`        ${p.id.padEnd(6)} 得 ${String(p.amount).padStart(7)}  [${p.roles.join('+')}]`);
  }
  console.log(`        DIVIDEND(分红池) 得 ${res.dividendPool}`);
  console.log(`      闭环：${res.sumAllocated} / ${res.total} → ${res.closure ? 'OK' : 'ERR'}`);
};

// ══ 2026-10-24 新口径：13% 直推奖以「新合店老板的上级是否为合店老板」判定（不再以推荐人为准） ══
// 场景 D：无上级 → 门店店长 15%（40%+13%+2%）
const D = C.costoreDistribution({
  months: 1, config: TEST_CFG, storeManagerId: 'M', referrer: null, upline: null,
});
show(D);
const byD = Object.fromEntries(D.byRecipient.map((x) => [x.id, x.amount]));
ok('D(无上级)场景识别正确', D.scenario.code === 'D', D.scenario.code, 'D');
ok('D 门店店长 得 40%+13%+2% = 55% = 383.90', near(byD.M, 698 * 0.55), byD.M, 383.9);
ok('D 闭环 100%', D.closure === true && near(D.sumAllocated, 698), D.sumAllocated, 698);

// 场景 C：有上级 且 上级非合店老板 → 门店店长 13% + 上级 2%
const Cc = C.costoreDistribution({
  months: 1, config: TEST_CFG, storeManagerId: 'M', referrer: null, upline: { id: 'U' }, uplineIsCostoreOwner: false,
});
show(Cc);
const byC = Object.fromEntries(Cc.byRecipient.map((x) => [x.id, x.amount]));
ok('C(上级非合店老板)场景识别正确', Cc.scenario.code === 'C', Cc.scenario.code, 'C');
ok('C 门店店长 得 40%+13% = 53% = 369.94', near(byC.M, 698 * 0.53), byC.M, 369.94);
ok('C 上级 得 2% = 13.96', near(byC.U, 698 * 0.02), byC.U, 13.96);
ok('C 闭环 100%', Cc.closure === true && near(Cc.sumAllocated, 698), Cc.sumAllocated, 698);
console.log('   ↳ 场景C：上级非合店老板 → 门店老板53% + 上级2% + 分红10%');

// 场景 B：上级是合店老板 → 上级拿 13%直推 + 2%复购 = 15%
const B = C.costoreDistribution({
  months: 1, config: TEST_CFG, storeManagerId: 'M', upline: { id: 'U' }, uplineIsCostoreOwner: true,
});
show(B);
const byB = Object.fromEntries(B.byRecipient.map((x) => [x.id, x.amount]));
ok('B(上级是合店老板)场景识别正确', B.scenario.code === 'B', B.scenario.code, 'B');
ok('B 上级(合店老板) 得 13%+2% = 15% = 104.70', near(byB.U, 698 * 0.15), byB.U, 104.7);
ok('B 门店店长 得 40% = 279.20', near(byB.M, 698 * 0.40), byB.M, 279.2);
ok('B 闭环 100%', B.closure === true && near(B.sumAllocated, 698), B.sumAllocated, 698);
console.log('   ↳ 场景B：上级即合店老板 → 业务15%全归该合店店长，门店店长只拿40%服务');

// 3b. 无上级 且 推荐人是合店老板 → 仍按「无上级」处理（13%归门店店长，推荐人不得13%）
const C2 = C.costoreDistribution({
  months: 1, config: TEST_CFG, storeManagerId: 'M', referrer: { id: 'R', isCostoreOwner: true }, upline: null,
});
ok('有推荐人但无上级 → 归入场景D（13%归门店店长，推荐人R不得13%）',
  C2.scenario.code === 'D' && near(Object.fromEntries(C2.byRecipient.map((x) => [x.id, x.amount])).M, 698 * 0.55),
  C2.scenario.code, 'D');

// 3c. 上级=推荐人 且 该人不是合店老板 → 上级拿 2%，13% 归门店店长
const E = C.costoreDistribution({
  months: 1, config: TEST_CFG, storeManagerId: 'M',
  referrer: { id: 'X', isCostoreOwner: false }, upline: { id: 'X' }, uplineIsCostoreOwner: false,
});
const byE = Object.fromEntries(E.byRecipient.map((x) => [x.id, x.amount]));
ok('上级=推荐人且非合店老板 → 该上级只拿 2% = 13.96', near(byE.X, 698 * 0.02), byE.X, 13.96);
ok('   → 13% 归门店店长（M 得 53% = 369.94）', near(byE.M, 698 * 0.53), byE.M, 369.94);

// 3d. 上级=推荐人 且 该人是合店老板 → 上级拿 15%（13%+2%），门店店长只拿 40%
const F = C.costoreDistribution({
  months: 1, config: TEST_CFG, storeManagerId: 'M',
  referrer: { id: 'X', isCostoreOwner: true }, upline: { id: 'X' }, uplineIsCostoreOwner: true,
});
const byF = Object.fromEntries(F.byRecipient.map((x) => [x.id, x.amount]));
ok('上级=推荐人且是合店老板 → 该人拿 15% = 104.70', near(byF.X, 698 * 0.15), byF.X, 104.7);
ok('   → 门店店长只拿 40% = 279.20', near(byF.M, 698 * 0.40), byF.M, 279.2);

// 3e. 用户实例：A 推荐 B 成为合店老板，但 B 有自己的上级 C（C 非合店老板）
//     语义（2026-10-24）：13% 按「B(被推荐人)的上级 C 是否为合店老板」判定 → C 非老板 → 13% 归门店店长 M；2% 复购奖给 C
const G = C.costoreDistribution({
  months: 1, config: TEST_CFG, storeManagerId: 'M',
  referrer: { id: 'A', isCostoreOwner: true },  // A 是推荐人（合店老板）
  upline: { id: 'C' }, uplineIsCostoreOwner: false, // C 是 B（被推荐人）的上级，非合店老板
});
const byG = Object.fromEntries(G.byRecipient.map((x) => [x.id, x.amount]));
console.log('   3e. 用户实例 A 推荐 B、B 的上级 C（C 非合店老板）：');
console.log(`       A(推荐人/合店老板) 得 ${byG.A || 0}  C(B的上级) 得 ${byG.C}  M 得 ${byG.M}`);
ok('3e 场景识别 = C（被推荐人有上级且上级非合店老板）', G.scenario.code === 'C', G.scenario.code, 'C');
ok('3e 13% 归门店店长 M（得 53% = 369.94）', near(byG.M, 698 * 0.53), byG.M, 369.94);
ok('3e C(B 的上级) 得 2% = 13.96', near(byG.C, 698 * 0.02), byG.C, 13.96);
ok('3e 推荐人 A 不得 13%（按「上级」判定，A 非上级）', Math.abs((byG.A || 0)) <= 0.02, byG.A || 0, 0);
ok('3e 闭环 100%', G.closure === true && near(G.sumAllocated, 698), G.sumAllocated, 698);

// 场景 D 6 个月总额校验
const A6 = C.costoreDistribution({
  months: 6, storeManagerId: 'M', upline: null,
});
ok('场景D 6 个月总额 4188，分配仍闭环', near(A6.total, 4188) && A6.closure === true,
  { total: A6.total, sum: A6.sumAllocated }, { total: 4188 });

// ═══════════════════ 4. 区域/总部四项固定 ═══════════════════
line('4. 总部体系 35%（15/2/8/10）');
const byA2 = Object.fromEntries(D.items.map((i) => [i.role, i.amount]));
ok('总部 15% = 104.70', near(byA2.hq, 104.7), byA2.hq, 104.7);
ok('省 2% = 13.96', near(byA2.province, 13.96), byA2.province, 13.96);
ok('市 8% = 55.84', near(byA2.city, 55.84), byA2.city, 55.84);
ok('区/县 10% = 69.80', near(byA2.district, 69.8), byA2.district, 69.8);

// ═══════════════════ 5. 分红池分配（单店独立 + 无责分红按入股首月 + 业绩不含合店费） ═══════════════════
line('5. 分红：单店独立；一半人数 + 一半业绩；无责分红按入股首月；业绩不含合店费');
const owners = [
  { id: 'o1', performance: 100, joinedMonthsAgo: 3, salesMet: true },               // 合格（达标）
  { id: 'o2', performance: 300, joinedMonthsAgo: 3, salesMet: true },               // 合格
  { id: 'o3', performance: 500, joinedMonthsAgo: 3, salesMet: false },              // 不合格（无直推、非首月）
  { id: 'o4', performance: 100, joinedMonthsAgo: 0, salesMet: false },              // 入股首月 → 无责合格
];
const dv = C.dividendSplit({ pool: 1000, owners });
console.log(`   池 ${dv.pool}：人数均分部分 ${dv.countPart}（每人均 ${dv.perHead}），业绩部分 ${dv.perfPart}`);
for (const r of dv.rows) {
  console.log(`   ${r.id}  ${r.eligible ? '合格(' + r.reason + ')' : '不合格(' + r.reason + ')'}  count ${String(r.fromCount).padStart(7)}  perf ${String(r.fromPerf).padStart(7)}  合计 ${String(r.total).padStart(7)}`);
}
const rmap = Object.fromEntries(dv.rows.map((r) => [r.id, r]));
ok('合格人数 = 3（o1,o2,o4）', dv.eligibleCount === 3, dv.eligibleCount, 3);
ok('o3 不合格 → 分 0', rmap.o3.total === 0, rmap.o3.total, 0);
ok('入股首月 o4 无责 → 有分红（>0）', rmap.o4.total > 0, rmap.o4.total, '>0');
ok('人数均分 500 / 3 ≈ 166.67', near(dv.perHead, 500 / 3, 0.01), dv.perHead, 166.67);
ok('业绩按占比：o2(300/500) 应最高', rmap.o2.fromPerf > rmap.o1.fromPerf && rmap.o2.fromPerf > rmap.o4.fromPerf,
  { o1: rmap.o1.fromPerf, o2: rmap.o2.fromPerf, o4: rmap.o4.fromPerf }, 'o2 最高');
ok('分红池全额分完（1000）', near(dv.totalDistributed, 1000, 0.02), dv.totalDistributed, 1000);

// 5b. 单店独立：两店各自分自己的池，互不串
const sx = C.dividendSplit({ pool: 200, owners: [
  { id: 'a1', performance: 100, joinedMonthsAgo: 0, salesMet: false }, // 首月无责
  { id: 'a2', performance: 100, joinedMonthsAgo: 3, salesMet: true },
] });
const sy = C.dividendSplit({ pool: 400, owners: [
  { id: 'b1', performance: 0, joinedMonthsAgo: 3, salesMet: false },   // 不合格
] });
ok('单店X：池 200 全部分给本店 2 人', near(sx.totalDistributed, 200, 0.02) && sx.ineligible.length === 0, sx.totalDistributed, 200);
ok('单店Y：池 400 无人合格 → 留存 0 分配', sy.totalDistributed === 0 && sy.ineligible.includes('b1'), sy.totalDistributed, 0);
ok('两店互不影响（X 不分到 Y 的池）', sx.rows.every((r) => ['a1', 'a2'].includes(r.id)) && sy.rows.every((r) => r.id === 'b1'),
  { sx: sx.rows.map((r) => r.id), sy: sy.rows.map((r) => r.id) }, 'no-cross');

// 5c. 业绩不含合店费：performance 为本人售出的产品/会员/VIP，不并入其合店费 698
const dp = C.dividendSplit({ pool: 1000, owners: [
  { id: 'p1', performance: 200, joinedMonthsAgo: 0, salesMet: false }, // 唯一合格（首月）
] });
ok('业绩只认本人销售（performance=200，不混入合店费 698）',
  dp.rows[0].performance === 200 && near(dp.rows[0].fromPerf, 500, 0.02),
  { perf: dp.rows[0].performance, fromPerf: dp.rows[0].fromPerf }, { perf: 200 });

// 合店费分红池 = 698 × 10% = 69.8（单店，每个月）
const divPool1 = C.costoreDistribution({ months: 1, storeManagerId: 'M', config: TEST_CFG }).dividendPool;
ok('单店 1 个月合店费分红池 = 69.80', near(divPool1, 69.8), divPool1, 69.8);

// ═══════════════════ 6. 软件卡/VIP 分红池 & 单店池聚合 ═══════════════════
line('6. 软件卡/VIP 分红 = 100 元/月/单位；单店池聚合（合店费10% + 软件）');
ok('10 张卡/VIP → 池 1000', near(C.softwareDividendPool({ units: 10 }), 1000), C.softwareDividendPool({ units: 10 }), 1000);
ok('可自定义单价 120 × 5 = 600', near(C.softwareDividendPool({ units: 5, perUnit: 120 }), 600), C.softwareDividendPool({ units: 5, perUnit: 120 }), 600);

const sp = C.storeDividendPool({ ownerCount: 3, feeMonths: 1, softwareUnits: 10 });
console.log(`   单店 3 人 × 1 月：合店费池 ${sp.feePool} + 软件池 ${sp.softwarePool} = ${sp.total}`);
ok('单店合店费池 = 698×3×10% = 209.40', near(sp.feePool, 209.4), sp.feePool, 209.4);
ok('单店软件池 = 100×10 = 1000（不乘 10%）', near(sp.softwarePool, 1000), sp.softwarePool, 1000);
ok('单店池合计 = 1209.40', near(sp.total, 1209.4), sp.total, 1209.4);

// 软件卡池沿用同一分配规则
const dv2 = C.dividendSplit({ pool: C.softwareDividendPool({ units: 10 }), owners });
ok('软件卡池 1000 也一半人数一半业绩分完', near(dv2.totalDistributed, 1000, 0.02), dv2.totalDistributed, 1000);

// ═══════════════════ 7. 无责分红月数可后台配置 ═══════════════════
line('7. 无责分红月数（graceMonths）后台可调');
const g0 = C.qualifyForDividend({ joinedMonthsAgo: 1, salesMet: false, graceMonths: 1 });
ok('graceMonths=1：入股第 2 月未达标 → 不合格', g0.qualified === false, g0, '不合格');
const g1 = C.qualifyForDividend({ joinedMonthsAgo: 1, salesMet: false, graceMonths: 3 });
ok('graceMonths=3：入股前 3 月无责 → 合格（总部可调长窗口）', g1.qualified === true, g1, '合格');
const g2 = C.qualifyForDividend({ joinedMonthsAgo: 0, salesMet: true, graceMonths: 1 });
ok('首月无论是否达标 → 无责合格', g2.qualified === true, g2, '合格');

// ═══════════════════ 汇总 ═══════════════════
line('总结果');
console.log(`  PASS ${pass} 条 / FAIL ${fail} 条 → ${fail === 0 ? '✅ 全部通过' : '❌ 有失败'}`);
process.exit(fail === 0 ? 0 : 1);

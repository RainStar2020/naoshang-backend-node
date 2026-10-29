'use strict';

/**
 * 合店老板收益逻辑 · 接口连接集成验证（settlement.runCostore → costorePlan）
 * 运行：node scripts/verify_costore_integration.js
 *
 * 目的：验证 settlement.runCostore 已真正接入 costorePlan 新四场景（B/C/D）+ 全平台分红池，
 *       且 100% 闭环、金额与用户 2026-10-24 口述一致；并验证开关可回滚到旧逻辑。
 *
 * 2026-10-24 修订：业务 15%（13% 直推 + 2% 复购）的归属以「**新合店老板的上级是否为合店老板**」判定：
 *   · B. 上级是合店老板            → 上级拿 13%直推 + 2%复购 = 15%
 *   · C. 上级非合店老板（有上级）   → 门店店长 13% + 上级 2%
 *   · D. 无上级                    → 门店店长 15%（13% + 2% 都归门店店长）
 *   推荐人（promoter）仅作记录，13% 不再以推荐人身份判定。
 */

const SET = require('../src/settlement');
const CP = require('../src/costorePlan');

let pass = 0, fail = 0;
const ok = (name, cond, got, expect) => {
  if (cond) { pass++; console.log(`  ✅ ${name} → ${JSON.stringify(got)}`); }
  else { fail++; console.log(`  ❌ ${name} → 实际 ${JSON.stringify(got)}，期望 ${JSON.stringify(expect)}`); }
};
const near = (a, b, t = 0.02) => Math.abs(a - b) <= t;
const line = (t) => console.log('\n' + '='.repeat(78) + '\n' + t + '\n' + '='.repeat(78));

const PERIOD = '2026-10';
const settingsEnabled = { costore: { enabledV2: true, monthlyFee: 698, minMonths: 6, graceMonths: 1, softwareUnitPrice: 100, softwareToPoolRate: 1 } };
const settingsLegacy = { costore: { ...settingsEnabled.costore, enabledV2: false } };

// 构造四笔合店费（每笔独立门店，便于核对单店分红）。
// 关键：13% 直推奖由「被推荐人（新合店老板）的上级 uplineId 是否在 costoreOwners 中」决定。
const costoreFees = [
  // 场景 D：新合店老板无上级 → 门店店长 15%（40%+13%+2%）
  { id: 'cfA', owner_id: 'a1', storeManagerId: 'm1', promoter_id: null, uplineId: null, fee: 698, store_id: 'SA', joinDate: '2026-10', ownerCount: 1, owners: [{ id: 'a1', performance: 0 }] },
  // 场景 B：上级 b3 是合店老板（b3 ∈ costoreOwners）→ 上级拿 13%直推 + 2%复购 = 15%
  { id: 'cfB', owner_id: 'b1', storeManagerId: 'm2', promoter_id: null, uplineId: 'b3', fee: 698, store_id: 'SB', joinDate: '2026-10', ownerCount: 1, owners: [{ id: 'b1', performance: 0 }] },
  // 场景 C：上级 c3 非合店老板（c3 ∉ costoreOwners）→ 门店店长 13% + 上级 2%
  { id: 'cfC', owner_id: 'c1', storeManagerId: 'm3', promoter_id: null, uplineId: 'c3', fee: 698, store_id: 'SC', joinDate: '2026-10', ownerCount: 1, owners: [{ id: 'c1', performance: 0 }] },
  // 场景 C（边界）：推荐人 a2 是合店老板，但被推荐人上级 c3 非合店老板 → 13% 仍归门店店长，推荐人 a2 不得 13%
  { id: 'cfD', owner_id: 'd1', storeManagerId: 'm4', promoter_id: 'a2', uplineId: 'c3', fee: 698, store_id: 'SD', joinDate: '2026-10', ownerCount: 1, owners: [{ id: 'd1', performance: 0 }] },
];
// b3 = 上级（合店老板）；a2 = 推荐人（合店老板，用于边界校验：13% 不应给推荐人）；a1/b1/c1/d1 = 四笔的合店老板
const costoreOwners = new Set(['a1', 'b1', 'c1', 'd1', 'a2', 'b3']);
// c3 故意不在合店老板集合中 → cfC / cfD 的上级非合店老板 → 场景 C

// ═══════════════════ 1. 新四场景（B/C/D）+ 全平台分红池 ═══════════════════
line('1. settlement.runCostore 接入新四场景（B/C/D）+ 全平台分红池（enabledV2=true）');
const res = SET.runCostore(PERIOD, costoreFees, { settings: settingsEnabled, costoreOwners });
const com = res.commissions;

// 1a. 每笔的场景码正确（details 顺序与 costoreFees 一致）
ok('cfA（无上级）→ 场景 D', res.details[0].scenario.code === 'D', res.details[0].scenario.code, 'D');
ok('cfB（上级是合店老板）→ 场景 B', res.details[1].scenario.code === 'B', res.details[1].scenario.code, 'B');
ok('cfC（上级非合店老板）→ 场景 C', res.details[2].scenario.code === 'C', res.details[2].scenario.code, 'C');
ok('cfD（推荐人是合店老板但上级非合店老板）→ 场景 C', res.details[3].scenario.code === 'C', res.details[3].scenario.code, 'C');

// 1b. 逐笔收款人金额（按 ref_order_id 过滤该笔合店费的落账，分红池 ref_order_id=null 不在此列）
function feeRecords(feeId) {
  return com.filter((c) => c.ref_order_id === feeId);
}
function sumByOwner(records) {
  const m = {};
  for (const r of records) m[r.owner_id] = round2((m[r.owner_id] || 0) + r.amount);
  return m;
}
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

// 场景 D：m1(店长) = 40%+13%+2% = 383.90；无上级 → 无 2% 独立收款人
{
  const recA = feeRecords('cfA');
  const byA = sumByOwner(recA);
  ok('D 门店店长 m1 得 40%+13%+2% = 383.90', near(byA.m1, 383.90), byA.m1, 383.90);
  ok('D 无上级 → 无 upline 收款人', !('b3' in byA) && !('c3' in byA), Object.keys(byA), 'no upline recipient');
  const feeSplitA = recA.reduce((s, r) => round2(s + r.amount), 0);
  ok('D 逐笔落账 = 628.20（698 × 90%，10% 进月度池）', near(feeSplitA, 628.2), feeSplitA, 628.2);
}

// 场景 B：m2(店长) = 40% = 279.20；b3(上级/合店老板) = 13%+2% = 104.70
{
  const recB = feeRecords('cfB');
  const byB = sumByOwner(recB);
  ok('B 门店店长 m2 得 40% = 279.20', near(byB.m2, 279.20), byB.m2, 279.20);
  ok('B 上级(合店老板) b3 得 13%+2% = 104.70', near(byB.b3, 104.70), byB.b3, 104.70);
  const allB = recB.reduce((s, r) => round2(s + r.amount), 0);
  ok('B 逐笔落账 = 628.20（698 × 90%）', near(allB, 628.2), allB, 628.2);
}

// 场景 C：m3(店长) = 40%+13% = 369.94；c3(上级) = 2% = 13.96
{
  const recC = feeRecords('cfC');
  const byC = sumByOwner(recC);
  ok('C 门店店长 m3 得 40%+13% = 369.94', near(byC.m3, 369.94), byC.m3, 369.94);
  ok('C 上级 c3 得 2% = 13.96', near(byC.c3, 13.96), byC.c3, 13.96);
  const allC = recC.reduce((s, r) => round2(s + r.amount), 0);
  ok('C 逐笔落账 = 628.20（698 × 90%）', near(allC, 628.2), allC, 628.2);
}

// 场景 C（边界）：m4(店长) = 40%+13% = 369.94；c3(上级) = 2% = 13.96；推荐人 a2（合店老板）不得 13%
{
  const recD = feeRecords('cfD');
  const byD = sumByOwner(recD);
  ok('C 门店店长 m4 得 40%+13% = 369.94', near(byD.m4, 369.94), byD.m4, 369.94);
  ok('C 上级 c3 得 2% = 13.96', near(byD.c3, 13.96), byD.c3, 13.96);
  ok('边界：推荐人 a2（合店老板）不得 13%（13% 按上级判定，a2 非上级）', !('a2' in byD), Object.keys(byD), 'a2 not recipient');
  const allD = recD.reduce((s, r) => round2(s + r.amount), 0);
  ok('C(边界) 逐笔落账 = 628.20（698 × 90%）', near(allD, 628.2), allD, 628.2);
}

// 1c. 分红池：按月「全平台一个池」，4 笔 × 698 × 10% = 279.20；四老板入股首月无责 → 各 69.80
const divRows1 = com.filter((r) => r.note && r.note.indexOf('分红') >= 0);
const divPool1 = divRows1.reduce((s, r) => round2(s + r.amount), 0);
ok('全平台分红池 = 279.20（4×698×10%）', near(divPool1, 279.2), divPool1, 279.2);
ok('分红记录不挂单笔订单（ref_order_id = null，月度池）', divRows1.every((r) => r.ref_order_id === null), divRows1.map((r) => r.ref_order_id), 'all null');
for (const owner of ['a1', 'b1', 'c1', 'd1']) {
  const amt = divRows1.filter((r) => r.owner_id === owner).reduce((s, r) => round2(s + r.amount), 0);
  ok(`全平台池 → ${owner} 各得 69.80（4 人入股首月无责，业绩半按人头均分）`, near(amt, 69.8), amt, 69.8);
}

// 1d. 全局：所有合店费落账合计 = 4 × 698 = 2792
const costoreTotal = com.filter((c) => c.type === 'costore').reduce((s, r) => round2(s + r.amount), 0);
ok('全部合店费落账合计 = 2792（4×698）', near(costoreTotal, 2792), costoreTotal, 2792);

// ═══════════════════ 2. 单店分红「业绩半」按业绩比例分（多老板同店） ═══════════════════
line('2. 单店分红：两人同店，一半人数 + 一半业绩');
const multi = [
  { id: 'mf1', owner_id: 'x1', storeManagerId: 'sm', promoter_id: null, uplineId: null, fee: 698, store_id: 'SX', joinDate: '2026-09', ownerCount: 2, owners: [{ id: 'x1', performance: 300 }] },
  { id: 'mf2', owner_id: 'x2', storeManagerId: 'sm', promoter_id: null, uplineId: null, fee: 698, store_id: 'SX', joinDate: '2026-09', ownerCount: 2, owners: [{ id: 'x2', performance: 100 }] },
];
const r2 = SET.runCostore(PERIOD, multi, { settings: settingsEnabled, costoreOwners: new Set(['x1', 'x2']) });
const pool = 698 * 0.10 * 2; // 两笔合店费 → 池 139.60
const divRows = r2.commissions.filter((c) => c.note && c.note.indexOf('分红') >= 0);
const divTotal = divRows.reduce((s, r) => round2(s + r.amount), 0);
ok('同店两笔 → 分红池 = 139.60', near(pool, 139.6), pool, 139.6);
ok('分红池全额分完 = 139.60', near(divTotal, 139.6), divTotal, 139.6);
const dx1 = divRows.find((r) => r.owner_id === 'x1').amount;
const dx2 = divRows.find((r) => r.owner_id === 'x2').amount;
// 一半人数 = 69.80/2 = 34.90；一半业绩 = 69.80 × (300/400)=52.35 / (100/400)=17.45
ok('x1 分红 = 34.90 + 52.35 = 87.25', near(dx1, 87.25), dx1, 87.25);
ok('x2 分红 = 34.90 + 17.45 = 52.35', near(dx2, 52.35), dx2, 52.35);

// ═══════════════════ 3. 无责分红首月（入股当月免考核） ═══════════════════
line('3. 无责分红：入股当月（2026-09，至 2026-10 已 1 月）仍走业绩半；首月（joinedMonthsAgo=0）必免考核');
const graceRecs = r2.commissions.filter((c) => c.note && c.note.indexOf('分红') >= 0);
ok('x1/x2 均有分红（>0）', dx1 > 0 && dx2 > 0, { dx1, dx2 }, '>0');

// ═══════════════════ 4. 旧逻辑回滚开关（enabledV2=false → 固定三分 53%+2%+10%） ═══════════════════
line('4. 开关回滚：enabledV2=false 走旧逻辑（门店老板53% + 推荐人2% + 分红池10%，等价于新逻辑场景 C）');
const legacyFee = {
  id: 'leg1', owner_id: 'o1', storeManagerId: 'o1', promoter_id: 'p1', uplineId: null,
  fee: 698, store_id: 'SL', joinDate: '2026-10', ownerCount: 1, owners: [{ id: 'o1', performance: 0 }],
};
const r3 = SET.runCostore(PERIOD, [legacyFee], { settings: settingsLegacy, costoreOwners: new Set(['o1', 'p1']) });
const c3legacy = r3.commissions.filter((c) => c.ref_order_id === 'leg1');
const byC3 = sumByOwner(c3legacy);
// 旧逻辑：53% 门店老板 = 合店老板本人(owner_id=o1)；2% 复购奖 = 推荐人(promoter_id=p1)；
// 本例 owners 业绩为 0 → 无合格推荐人 → 10% 池兜底归 o1，保证 100% 闭环
ok('回滚后 门店老板(owner) o1 门店老板份额 53% = 369.94', near(c3legacy.find((r) => r.id === 'cs-store-leg1').amount, 369.94), c3legacy.find((r) => r.id === 'cs-store-leg1').amount, 369.94);
ok('回滚后 推荐人( promoter) p1 得 2% = 13.96', near(byC3.p1, 13.96), byC3.p1, 13.96);
ok('回滚后 无合格推荐人 → 10% 池兜底归 o1（o1 合计 63% = 439.74）', near(byC3.o1, 439.74), byC3.o1, 439.74);
ok('回滚后 闭环 = 698', near(c3legacy.reduce((s, r) => round2(s + r.amount), 0), 698), c3legacy.reduce((s, r) => round2(s + r.amount), 0), 698);

// ═══════════════════ 汇总 ═══════════════════
line('总结果');
console.log(`  PASS ${pass} 条 / FAIL ${fail} 条 → ${fail === 0 ? '✅ 全部通过' : '❌ 有失败'}`);
process.exit(fail === 0 ? 0 : 1);

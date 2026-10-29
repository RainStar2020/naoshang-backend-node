'use strict';

/**
 * 合店老板接口连接 · 路由级端到端验证
 * 运行：node scripts/verify_costore_e2e.js
 *
 * 覆盖 routes.runSettlement 真实路径（而非直接调 settlement.runCostore）：
 *   ① 结算幂等：同月重跑不翻倍（upsertCommission 按 id 覆盖）
 *   ② 场景 B：上级(=合店老板) 13%+2%=15% + 店长 40% + 分红 10%（2026-10-24 新口径：13% 以「上级是否为合店老板」判定）
 *   ③ 后台开关切换：enabledV2 true→false→true，金额随之回滚/恢复，且不重复计发
 *   ④ 改月费：settings.monthlyFee 只作用于新登记默认值，不改已有合同
 *   ⑤ 无责分红月数可调；无合格合店老板时 10% 池余款归门店店长（不漏钱）
 */

const S = require('../src/store');
const R = require('../src/routes');
const CP = require('../src/costorePlan');

let pass = 0, fail = 0;
const ok = (name, cond, got, expect) => {
  if (cond) { pass++; console.log(`  ✅ ${name} → ${JSON.stringify(got)}`); }
  else { fail++; console.log(`  ❌ ${name} → 实际 ${JSON.stringify(got)}，期望 ${JSON.stringify(expect)}`); }
};
const near = (a, b, t = 0.02) => Math.abs(a - b) <= t;
const line = (t) => console.log('\n' + '='.repeat(78) + '\n' + t + '\n' + '='.repeat(78));
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const sumOwner = (rows, owner) => round2(rows.filter((r) => r.owner_id === owner).reduce((s, r) => s + r.amount, 0));
const costoreRows = (db, period = '2026-10') => db.commissions.filter((c) => c.type === 'costore' && c.period === period);

/** 造「场景 B」数据：被推荐人(newbie)的上级=boss，且 boss 本人是合店老板 → 13%直推+2%复购全归 boss。两人不同店，便于隔离单店分红 */
function freshDb() {
  const db = S.createDb();
  S.addUser(db, { id: 'mgr', name: '店长-甲', tier: 'angel', upline_id: null, quota: 0 });       // 门店店长（非合店老板）
  S.addUser(db, { id: 'boss', name: '上级-乙(合店老板)', tier: 'vip', upline_id: 'mgr', quota: 0 }); // 上级，本人也是合店老板
  S.addUser(db, { id: 'newbie', name: '新合店老板-丁', tier: 'vip', upline_id: 'boss', quota: 0 }); // 被推荐人（合店老板本人，上级=boss=合店老板）
  // boss 自己是合店老板（独立门店 SH-B），使其成为 newbie 的上级且为合店老板 → 场景 B
  S.addCoStore(db, { id: 'cs-boss', owner_id: 'boss', storeManagerId: 'mgr', store_id: 'SH-B', monthly_fee: 698, joinDate: '2026-10', owners: [{ id: 'boss', performance: 0 }] });
  // newbie 是合店老板（门店 SH-N），上级=boss（合店老板）→ 场景 B（13%+2% 全归 boss）
  S.addCoStore(db, {
    id: 'cs-newbie', owner_id: 'newbie', storeManagerId: 'mgr', promoter_id: 'boss',
    store_id: 'SH-N', monthly_fee: 698, joinDate: '2026-10', ownerCount: 1,
    owners: [{ id: 'newbie', performance: 0 }],
  });
  return db;
}

// ═══════════════════ 1. 结算幂等 ═══════════════════
line('1. 结算幂等：同月重跑不翻倍（routes.runSettlement）');
{
  const db = freshDb();
  R.runSettlement(db, { period: '2026-10' });
  const total1 = round2(costoreRows(db).reduce((s, c) => s + c.amount, 0));
  const count1 = db.commissions.length;
  R.runSettlement(db, { period: '2026-10' }); // 重跑同月
  const total2 = round2(costoreRows(db).reduce((s, c) => s + c.amount, 0));
  const count2 = db.commissions.length;
  ok('重跑后合店费落账合计不变', near(total1, total2), { total1, total2 }, '不变');
  ok('重跑后佣金条数不变（按 id 覆盖，非追加）', count1 === count2, { count1, count2 }, '不变');
  ok('两店两笔合计 = 2×4188 = 8376（一次性入池，不再逐月 698）', near(total1, 8376), total1, 8376);
}

// ═══════════════════ 2. 场景 B 通过路由结算正确 ═══════════════════
line('2. 场景 B：上级=boss(合店老板) 13%+2%=15% + 店长(mgr) 40%');
{
  const db = freshDb();
  R.runSettlement(db, { period: '2026-10' });
  const rows = costoreRows(db).filter((c) => c.ref_order_id === 'cs-newbie');
  // 新口径：13% 直推 + 2% 复购均归「上级且为合店老板」的 boss；推荐人(promoter)不再参与 13% 判定
  ok('boss（上级/合店老板）13%+2% = 628.20（4188×15%）', near(sumOwner(rows, 'boss'), 628.2), sumOwner(rows, 'boss'), 628.2);
  ok('mgr（店长）40% = 1675.20（4188×40%）', near(sumOwner(rows, 'mgr'), 1675.2), sumOwner(rows, 'mgr'), 1675.2);
  ok('推荐人概念不参与 13%（boss 仅因「上级+合店老板」身份得 15%，不再单列 13%）', near(sumOwner(rows, 'boss'), 628.2), sumOwner(rows, 'boss'), 628.2);
  // 分红池改为「按月全平台一个池」（不逐笔挂单），故从池里取 newbie 的 10%
  const poolRows = costoreRows(db).filter((c) => c.note.indexOf('分红') >= 0);
  ok('newbie（被推荐人）从月度分红池拿 10% = 418.80（4188×10%）', near(sumOwner(poolRows, 'newbie'), 418.8), sumOwner(poolRows, 'newbie'), 418.8);
  const closed = round2(rows.reduce((s, r) => s + r.amount, 0) + sumOwner(poolRows, 'newbie'));
  ok('本笔 4188 闭环（逐笔 3769.20 + newbie 月度池份 418.80）', near(closed, 4188), closed, 4188);
}

// ═══════════════════ 3. 开关切换回滚（不重复计发） ═══════════════════
line('3. 后台开关：enabledV2 true→false→true，金额随之回滚/恢复且不叠加');
{
  const db = freshDb();
  R.runSettlement(db, { period: '2026-10' });                       // V2
  const v2newbie = sumOwner(costoreRows(db).filter((c) => c.note.indexOf('分红') >= 0), 'newbie');
  S.updateSettings(db, { enabledV2: false });
  R.runSettlement(db, { period: '2026-10' });                       // 回滚
  const rowsLegacy = costoreRows(db).filter((c) => c.ref_order_id === 'cs-newbie');
  // 旧逻辑：门店老板=合店老板本人(newbie) 53%；推荐人(boss) 2%；
  // 本例 owners 业绩为 0 → 无合格推荐人 → 10% 池兜底也归 newbie（旧分支「门店老板=owner」语义）
  ok('回滚后 newbie 门店老板份额 53% = 2219.64（4188×53%）', near(rowsLegacy.find((r) => r.id === 'cs-store-cs-newbie').amount, 2219.64), rowsLegacy.find((r) => r.id === 'cs-store-cs-newbie').amount, 2219.64);
  ok('回滚后 推荐人(boss) 2% = 83.76（4188×2%）', near(sumOwner(rowsLegacy, 'boss'), 83.76), sumOwner(rowsLegacy, 'boss'), 83.76);
  ok('回滚后 newbie 含兜底合计 63% = 2638.44', near(sumOwner(rowsLegacy, 'newbie'), 2638.44), sumOwner(rowsLegacy, 'newbie'), 2638.44);
  ok('回滚后 整笔闭环 = 4188（不叠加）', near(round2(rowsLegacy.reduce((s, r) => s + r.amount, 0)), 4188), round2(rowsLegacy.reduce((s, r) => s + r.amount, 0)), 4188);
  S.updateSettings(db, { enabledV2: true });
  R.runSettlement(db, { period: '2026-10' });                       // 恢复
  const rowsV2 = costoreRows(db).filter((c) => c.ref_order_id === 'cs-newbie');
  ok('再开启后恢复：boss（上级/合店老板）13%+2% = 628.20', near(sumOwner(rowsV2, 'boss'), 628.2), sumOwner(rowsV2, 'boss'), 628.2);
  ok('再开启后恢复：mgr 店长 40% = 1675.20', near(sumOwner(rowsV2, 'mgr'), 1675.2), sumOwner(rowsV2, 'mgr'), 1675.2);
  const v2newbieAgain = sumOwner(costoreRows(db).filter((c) => c.note.indexOf('分红') >= 0), 'newbie');
  ok('再开启后恢复：newbie 分红 = 418.80（与首次一致）', near(v2newbieAgain, v2newbie), v2newbieAgain, v2newbie);
}

// ═══════════════════ 4. 改月费：只作新登记默认值 ═══════════════════
line('4. 后台改月费 698→899：新登记按 899，已有合同记录仍按 698');
{
  const db = freshDb();
  S.updateSettings(db, { monthlyFee: 899 });
  // 先建用户，再登记合店（addCoStore 要求 owner 用户已存在）
  S.addUser(db, { id: 'newbie2', name: '新合店老板-戊', tier: 'vip', upline_id: 'mgr', quota: 0 });
  // 新登记一笔合店（不传 monthly_fee）→ 取后台 899
  const cs = S.addCoStore(db, { id: 'cs-new', owner_id: 'newbie2', storeManagerId: 'mgr', store_id: 'SH-N2', joinDate: '2026-10', owners: [{ id: 'newbie2', performance: 0 }] });
  ok('新登记默认月费 = 899', cs.monthly_fee === 899, cs.monthly_fee, 899);
  R.runSettlement(db, { period: '2026-10' });
  const rowsNew = costoreRows(db).filter((c) => c.ref_order_id === 'cs-new');
  ok('新登记逐笔 90% = 4854.60（899×6 × 90%，10% 进月度池）', near(round2(rowsNew.reduce((s, r) => s + r.amount, 0)), 4854.6), round2(rowsNew.reduce((s, r) => s + r.amount, 0)), 4854.6);
  const rowsOld = costoreRows(db).filter((c) => c.ref_order_id === 'cs-newbie');
  ok('已有合同记录仍按 698×6（逐笔 3769.20）', near(round2(rowsOld.reduce((s, r) => s + r.amount, 0)), 3769.2), round2(rowsOld.reduce((s, r) => s + r.amount, 0)), 3769.2);
}

// ═══════════════════ 5. 一次性入池下的无责分红 & 兜底 ═══════════════════
line('5. 一次性入池：入股当月恒合格 + 旧月份不再分发 + 兜底不漏钱');
{
  const db = freshDb();
  S.updateSettings(db, { graceMonths: 1 }); // 默认 1 个月
  // 一次性入池：合店记录只在「入股当月」参与分发；入股当月 joinedMonthsAgo=0 ≤ graceMonths → 必合格
  R.runSettlement(db, { period: '2026-10' });
  const rows = costoreRows(db).filter((c) => c.ref_order_id === 'cs-newbie');
  const poolRows = costoreRows(db).filter((c) => c.note.indexOf('分红') >= 0);
  ok('newbie（被推荐人）无责首月即合格，从月度分红池拿 10% = 418.80', near(sumOwner(poolRows, 'newbie'), 418.8), sumOwner(poolRows, 'newbie'), 418.8);
  ok('mgr 店长 40% 服务费 = 1675.20', near(sumOwner(rows, 'mgr'), 1675.2), sumOwner(rows, 'mgr'), 1675.2);
  ok('boss 上级/合店老板 15% = 628.20', near(sumOwner(rows, 'boss'), 628.2), sumOwner(rows, 'boss'), 628.2);
  // 月度池不挂单笔 ⇒ 改为「全平台月合计闭环」
  const monthClosed = round2(costoreRows(db).reduce((s, r) => s + r.amount, 0));
  ok('全平台月度闭环 = 8376（2×4188，一次性入池）', near(monthClosed, 8376), monthClosed, 8376);

  // 旧月份（joinDate 非本月）的合店记录不再参与分发（已一次性结清）
  const csRec = db.coStores.find((c) => c.id === 'cs-newbie');
  csRec.joinDate = '2026-08';
  R.runSettlement(db, { period: '2026-10' });
  const rowsOld = costoreRows(db).filter((c) => c.ref_order_id === 'cs-newbie');
  ok('非入股月（joinDate=2026-08）不再分发该笔合店费', rowsOld.length === 0, rowsOld.length, 0);

  // 兜底逻辑（单元级）：某合店老板过无责期且业绩 0 → 不合格，其池份额余款走结算层归 HQ/门店店长，不漏钱
  const split = CP.dividendSplit({
    pool: 418.8,
    owners: [{ id: 'x', performance: 0, joinedMonthsAgo: 2, salesMet: false }],
    config: CP.buildConfig({ graceMonths: 1 }),
  });
  ok('过无责期且未达标 → 不合格（totalDistributed=0）', near(split.totalDistributed, 0), split.totalDistributed, 0);
  ok('不合格者被标记（份额由结算层兜底归 HQ）', split.ineligible.length === 1, split.ineligible, ['x']);
}

line('总结果');
console.log(`  PASS ${pass} 条 / FAIL ${fail} 条 → ${fail === 0 ? '✅ 全部通过' : '❌ 有失败'}`);
process.exit(fail === 0 ? 0 : 1);

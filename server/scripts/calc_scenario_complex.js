/**
 * 复杂角色拓扑 · 四问实算脚本（使用后端真实代码）
 * ⚠️ 2026-10-23 更新：已由 `scripts/month_full_sim.js` + `docs/全月实算报告.md` 取代
 *    （新脚本含供货链级差级联、全球奖、创始奖、分红池与资金闭环核对，口径与用户手算 11/11 对齐）。
 *    本脚本保留作单问视角的补充参考。
 * 数据来源：用户 2026-10-23 口述拓扑
 *   联创 A（下级：私董 B、天使 C；无上级=顶层）
 *   省代 S / 市代 S1 / 县区代 X / 门店代理 D（均挂总部，区域码统一 'D1'；D 为天使档）
 *   用户 E（C 下级）/ F（A 下级）/ L（F 下级）/ G（F 下级）
 *
 * 四个问题（用代码实算，并与业务预期对照）：
 *   Q1  E 经 C 邀请码绑为 C 下级，向 C 购买「私董」身份 → C / A / 总部 各获益多少？
 *   Q2  F 成为 A 下级，向 A 购买「天使」身份；并最低档 6 个月（4188）成为合店老板进 D 门店
 *        → 总部 / A / 省 / 市 / 区 / 门店代理 各获益多少？
 *   Q3  L 经 F 成为合店老板（进 D 门店） → F / 总部 / S / S1 / X / D 各获益多少？A 是否有收益？
 *   Q4  F 发展一个 VIP 用户 G：F 向 A 还是向 D 购买 VIP 名额？
 *        若 A：A / F 各获益多少？  若 D：D / F 各获益多少？
 *
 * 口径说明（与代码严格一致）：
 *   · 套餐订单双模式：rawQuota=原始名额售卖（按下级档价付费）；整包=零售价付费。
 *     【2026-10-23 规则】身份/合伙人/VIP 名额销售：仅即时落账 supply(供货差价)+parity(平级奖)，
 *     没有直推奖、没有复购奖（售卖合伙人无直推奖，只赚差价）。直推奖仅存在于产品提成与代理技术费。
 *     store_fee/hq_fee 仅记账，月度结算才落账。
 *   · 差价口径：零售整包 = 实付(零售价) − 卖家拿货成本（恒正）；rawQuota 模式 = (下级档价 − 上级档价) × 名额。
 *   · 合店入场费：698×6 = 4188（minMonths=6 硬约束），走 costoreDistribution 整笔分配（V2 四场景）。
 *   · 月度结算：runAgent（门店费 3000/VIP 拆分）/ runGlobalBonus（150×总VIP）/ runFoundingBonus
 *     （联创持创始奖 17.5/VIP、私董 3.5/VIP）/ runCostore（合店四场景 + 单店分红池）。
 *   · 全球奖无责期：daysSinceCofounder ≤ 90 或 当月直推≥1 才合格；否则奖池无主。
 *     本脚本把 A、B 设为 daysSinceCofounder=10（视为活跃联创/私董），使全球奖可分配。
 */

const S = require('../src/store');
const R = require('../src/routes');
const CP = require('../src/costorePlan');
const SET = require('../src/settlement');
const C = require('../src/commission');
const Q = require('../src/quotaLedger');

const PERIOD = '2026-10';
const COSTORE_ENTRY = C.COSTORE_FEE_MONTHLY * 6; // 698 × 6 = 4188

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const line = (t) => console.log('\n' + '─'.repeat(78) + '\n' + t + '\n' + '─'.repeat(78));
const pad = (s, n) => String(s).padEnd(n);

/** 构建一套完整世界（角色 + 代理任命 + 名额下发），每个问题用独立副本隔离 */
function buildWorld() {
  const db = S.createDb();
  const add = (id, tier, upline_id, extra = {}) =>
    S.addUser(db, { id, name: id, tier, upline_id, ...extra });

  add('A', 'cofounder', null, { is_founding: true, daysSinceCofounder: 10 });
  add('B', 'private', 'A', { daysSinceCofounder: 10 });
  add('C', 'angel', 'A');
  add('S', 'none', null);   // 省代 → 赠联创
  add('S1', 'none', null);  // 市代 → 赠联创
  add('X', 'none', null);   // 县区代 → 赠私董
  add('D', 'angel', null);  // 门店代理（前置需天使，不赠身份）
  add('E', 'none', 'C');
  add('F', 'none', 'A');
  add('L', 'vip', 'F');     // 合店老板须 ≥ VIP（2026-10-23 规则）
  add('G', 'none', 'F');

  // 区域代理任命（统一区域码 D1）
  S.appointAgent(db, { partnerId: 'S', regionType: 'province', regionCode: 'D1' });
  S.appointAgent(db, { partnerId: 'S1', regionType: 'city', regionCode: 'D1' });
  S.appointAgent(db, { partnerId: 'X', regionType: 'district', regionCode: 'D1' });
  S.appointAgent(db, { partnerId: 'D', regionType: 'store', regionCode: 'D1' });

  // 名额下发（上级要能卖）
  Q.issueQuota(db.quotaLedger, 'C', 50);
  Q.issueQuota(db.quotaLedger, 'A', 200);
  Q.issueQuota(db.quotaLedger, 'D', 50);
  return db;
}

/** 收集即时 + 月度佣金，按人/来源/类型聚合 */
function collect(db, settled) {
  const rows = [];
  for (const c of db.commissions) rows.push({ ...c, src: 'instant' });
  for (const c of (settled ? settled.commissions : [])) rows.push({ ...c, src: 'settle' });
  return rows;
}
function sumByOwner(rows) {
  const m = {};
  for (const r of rows) {
    m[r.owner_id] = m[r.owner_id] || { instant: {}, settle: {} };
    const b = r.src === 'instant' ? 'instant' : 'settle';
    m[r.owner_id][b][r.type] = r2((m[r.owner_id][b][r.type] || 0) + r.amount);
  }
  return m;
}
const TYPE_NAMES = {
  supply: '供货差价', direct: '直推奖', rebuy: '复购奖', parity: '平级奖',
  agent: '区域门店费', global: '全球奖', founding: '创始奖', costore: '合店收益',
};
function ownerTotal(bucket) {
  return Object.values(bucket).reduce((s, v) => s + v, 0);
}
function printOwner(m, id, label) {
  const e = m[id];
  if (!e) { console.log(`  ${pad(label + ' (' + id + ')', 22)} 无收益`); return; }
  const inst = ownerTotal(e.instant), stl = ownerTotal(e.settle);
  const parts = [];
  for (const [t, v] of Object.entries(e.instant)) if (v) parts.push(`${TYPE_NAMES[t] || t}+${v}`);
  for (const [t, v] of Object.entries(e.settle)) if (v) parts.push(`${TYPE_NAMES[t] || t}(月)+${v}`);
  console.log(`  ${pad(label + ' (' + id + ')', 22)} 即时 ${pad(r2(inst), 10)} + 月度 ${pad(r2(stl), 10)} = ${r2(inst + stl)}`);
  if (parts.length) console.log(`        └ ${parts.join('  ')}`);
}

/**
 * 资金闭环核对：把客户实付 + 合店费，拆成「已记账佣金 / 总部留存 / 未分配零售溢价」。
 *   · 已记账佣金：所有即时 + 月度佣金（发给各合伙人/代理/门店）。
 *   · 总部留存 = Σ门店费 + Σ总部费 − 全球奖 − 创始奖（HQ 自己的那块，不算合伙人佣金）。
 *   · 未分配零售溢价 = 实收 − 门店费 − 总部费 − (供货差价+平级)。
 *     身份销售无直推/复购，故「已记账佣金」中不含这两项。
 */
function reconcile(db, settled, collected) {
  let booked = 0;
  for (const c of db.commissions) booked += c.amount;
  for (const c of (settled ? settled.commissions : [])) booked += c.amount;
  booked = r2(booked);
  const hqNet = r2(collected - booked);
  // 总部费（hq_fee）+ 门店费（store_fee）拆分，便于区分「HQ 留存」与「上游供货链毛利」
  const hqFee = r2(db.orders.reduce((s, o) => s + (o.hq_fee || 0), 0));
  const storeFee = r2(db.orders.reduce((s, o) => s + (o.store_fee || 0), 0));
  // 全球/创始奖（HQ 池里发出去的部分）
  let poolPaid = 0;
  for (const c of (settled ? settled.commissions : [])) if (c.type === 'global' || c.type === 'founding') poolPaid += c.amount;
  poolPaid = r2(poolPaid);
  console.log(`  资金核对：实收合计 ${r2(collected)} = 已发佣金 ${booked} + 未分配余额 ${hqNet}`);
  if (hqFee || storeFee) {
    console.log(`       ※ 其中：门店服务费 ${storeFee}（全额分发省/市/区县/门店）、总部费 ${hqFee}（扣除全球奖+创始奖 ${poolPaid} 后净留 ${r2(hqFee - poolPaid)}）；`);
    console.log(`         未分配余额 ${hqNet} = 总部净留 ${r2(hqFee - poolPaid)} + 上游供货链毛利 ${r2(hqNet - (hqFee - poolPaid))}`);
  } else {
    console.log(`       ※ 未分配余额 = 实收 − 全部已发佣金；合店费四场景 100% 闭环时该项应为 0。`);
  }
}

/** 跑月度结算（订单 + 合店费 + 联创/私董标注 + 区域代理） */
function runSettle(db, costoreFees = [], costoreOwners = new Set()) {
  const cofounders = S.annotateCofounders(db, ['A', 'B']);
  const founders = [
    { id: 'A', tier: 'cofounder', foundingBonus: true },
    { id: 'B', tier: 'private' },
  ];
  const agents = S.listRegionalAgents(db).map((a) => ({
    region_type: a.region_type, region_code: a.region_code, partner_id: a.partner_id,
  }));
  return SET.settleAll({
    period: PERIOD,
    orders: db.orders,
    cofounders, founders, agents,
    costoreFees, settings: S.getSettings(db), costoreOwners,
  });
}

// ════════════════════════ Q1：E 向 C 购买私董 ════════════════════════
function q1() {
  line('Q1：E 经 C 邀请码绑为 C 下级，向 C 购买「私董」身份');
  const db = buildWorld();
  console.log('  下单：buyer=E, packageTier=private, oldTier=none（整包升级）, regionCode=D1');
  const o = R.createOrder(db, { buyerId: 'E', packageTier: 'private', oldTier: 'none', buyerIsNew: true, regionCode: 'D1' });
  console.log('  订单回执：', JSON.stringify({ actual_paid: o.actual_paid, supply_spread: o.supply_spread, store_fee: o.store_fee, hq_fee: o.hq_fee }));
  console.log(`  ※ 供货差价已修正为 实付−卖家拿货成本 = 59800 − 6×7500(天使拿货价) = ${o.supply_spread}（旧公式用下级档价算会得 −3120 被拦截，已修复）`);

  const settled = runSettle(db, [], new Set());
  const m = sumByOwner(collect(db, settled));
  reconcile(db, settled, o.actual_paid);

  printOwner(m, 'C', '天使 C（卖方）');
  console.log('    ※ 新规则：售卖合伙人/VIP 名额【无直推奖】，C 仅赚供货差价，不再叠加直推奖。');
  printOwner(m, 'A', '联创 A（C 的上级）');
  console.log(`  总部（结算口径）：hq_fee=${o.hq_fee} = 全球奖池 150×6=${C.GLOBAL_UNIT * 6}（归联创 A/B，若合格）+ 创始奖 3500×(0.005×6[A]+0.001×6[B])=${r2(3500 * (0.005 * 6 + 0.001 * 6))} + 总部留存 ${r2(o.hq_fee - C.GLOBAL_UNIT * 6 - 3500 * (0.005 * 6 + 0.001 * 6))}`);
  printOwner(m, 'S', '省代 S'); printOwner(m, 'S1', '市代 S1'); printOwner(m, 'X', '县区代 X'); printOwner(m, 'D', '门店代理 D');
}

// ════════════════════════ Q2：F 向 A 购买天使 + 合店入场 ════════════════════════
function q2() {
  line('Q2：F 成为 A 下级，向 A 购买「天使」身份；并 6 个月(4188) 成为合店老板进 D 门店');
  const db = buildWorld();
  console.log('  (1) 下单：buyer=F, packageTier=angel, oldTier=none（整包升级）');
  const o = R.createOrder(db, { buyerId: 'F', packageTier: 'angel', oldTier: 'none', buyerIsNew: true, regionCode: 'D1' });
  console.log('      订单回执：', JSON.stringify({ actual_paid: o.actual_paid, supply_spread: o.supply_spread, store_fee: o.store_fee, hq_fee: o.hq_fee }));

  console.log(`  (2) 合店入场：fee=${COSTORE_ENTRY}（698×6），storeManager=D，promoter=A，upline=A`);
  console.log(`      → 上级(A)非合店老板、被推荐人(F)有上级(A) ⇒ 四场景【C】（13%归门店店长D，2%归上级A）`);
  const dist = CP.costoreDistribution({
    fee: COSTORE_ENTRY, storeManagerId: 'D',
    referrer: { id: 'A', isCostoreOwner: false }, upline: { id: 'A' }, uplineIsCostoreOwner: false,
    provinceId: 'S', cityId: 'S1', districtId: 'X',
  });
  console.log('      场景判定：', dist.scenario.code, '—', dist.scenario.label);
  console.log('      分配明细：', JSON.stringify(dist.byRecipient));

  S.addCoStore(db, { id: 'cs_F', owner_id: 'F', storeManagerId: 'D', promoter_id: 'A', uplineId: 'A', fee: COSTORE_ENTRY, store_id: 'D', joinDate: PERIOD, owners: [{ id: 'F', performance: 0 }] });

  const settled = runSettle(db, db.coStores, new Set(['F']));
  const m = sumByOwner(collect(db, settled));

  printOwner(m, 'A', '联创 A');
  console.log('    ※ 新规则：A 卖天使身份【无直推奖】，仅赚供货差价 10300；月结另有全球/创始奖（联创共享）。');
  printOwner(m, 'F', '天使 F（买方/合店老板）');
  console.log(`  总部（结算口径）：hq_fee=${o.hq_fee}（天使 3 名额）+ 合店费总部 15% = ${r2(COSTORE_ENTRY * 0.15)}`);
  printOwner(m, 'S', '省代 S'); printOwner(m, 'S1', '市代 S1'); printOwner(m, 'X', '县区代 X'); printOwner(m, 'D', '门店代理 D');

  reconcile(db, settled, o.actual_paid + COSTORE_ENTRY);
}

// ════════════════════════ Q3：L 经 F 成为合店老板 ════════════════════════
function q3() {
  line('Q3：L 经 F 成为合店老板（进 D 门店）');
  const db = buildWorld();
  // F 先成为合店老板（承接 Q2 状态：F 已是天使及以上身份），再 L 经 F 入场
  S.updatePartner(db, 'F', { tier: 'angel' }); // 合店老板须 ≥ VIP；Q2 中 F 购天使即天使，Q3 直接对齐该状态
  S.addCoStore(db, { id: 'cs_F', owner_id: 'F', storeManagerId: 'D', promoter_id: 'A', uplineId: 'A', fee: COSTORE_ENTRY, store_id: 'D', joinDate: PERIOD, owners: [{ id: 'F', performance: 0 }] });

  console.log(`  (1) 合店入场：fee=${COSTORE_ENTRY}，storeManager=D，promoter=F，upline=F`);
  console.log(`      → 上级(F)是合店老板、被推荐人(L)有上级(F) ⇒ 四场景【B】（13%+2%共15%归合店店长F）`);
  const dist = CP.costoreDistribution({
    fee: COSTORE_ENTRY, storeManagerId: 'D',
    referrer: { id: 'F', isCostoreOwner: true }, upline: { id: 'F' }, uplineIsCostoreOwner: true,
    provinceId: 'S', cityId: 'S1', districtId: 'X',
  });
  console.log('      场景判定：', dist.scenario.code, '—', dist.scenario.label);
  console.log('      分配明细：', JSON.stringify(dist.byRecipient));

  S.addCoStore(db, { id: 'cs_L', owner_id: 'L', storeManagerId: 'D', promoter_id: 'F', uplineId: 'F', fee: COSTORE_ENTRY, store_id: 'D', joinDate: PERIOD, owners: [{ id: 'L', performance: 0 }] });

  const settled = runSettle(db, db.coStores, new Set(['F', 'L']));
  const m = sumByOwner(collect(db, settled));

  printOwner(m, 'F', '天使 F（推荐人/合店老板/被推荐人上级）');
  printOwner(m, 'L', '用户 L（新合店老板）');
  printOwner(m, 'A', '联创 A');
  console.log(`  总部：合店费总部 15%×2笔 = ${r2(COSTORE_ENTRY * 0.15 * 2)}（无 VIP 订单，无全球/创始奖）`);
  printOwner(m, 'S', '省代 S'); printOwner(m, 'S1', '市代 S1'); printOwner(m, 'X', '县区代 X'); printOwner(m, 'D', '门店代理 D');

  // 分红池拆分核对（D 门店两笔 10% 池合计 = 837.6，F/L 各无责首月）
  const pool = COSTORE_ENTRY * 0.10 * 2;
  const div = CP.dividendSplit({ pool, owners: [
    { id: 'F', performance: 0, joinedMonthsAgo: 0, salesMet: false },
    { id: 'L', performance: 0, joinedMonthsAgo: 0, salesMet: false },
  ] });
  console.log(`  单店分红池合计 ${r2(pool)} 拆分：`, JSON.stringify(div.rows.map((r) => ({ id: r.id, total: r.total, reason: r.reason }))));

  reconcile(db, settled, COSTORE_ENTRY * 2);
}

// ════════════════════════ Q4：F 发展 VIP 用户 G ════════════════════════
function q4() {
  line('Q4：F 发展一个 VIP 用户 G —— F 向 A 还是向 D 购买 VIP 名额？');
  console.log('  前置：F 已是天使（有转售资格），向谁补 1 个 VIP 名额，再转售给 G（G.upline=F，整包购买 VIP）。');

  // —— 分支 A：F 向 A 补货 ——
  console.log('\n  ┌─ 分支 A：F 向 A 购买 1 个 VIP 名额（rawQuota=1，F.upline=A）');
  {
    const db = buildWorld();
    S.getUser(db, 'F').tier = 'angel'; // F 已是天使
    console.log('    (a) F 补货：buyer=F, rawQuota=1, seller=A（身份补货仅供货差价，无复购奖）');
    const o1 = R.createOrder(db, { buyerId: 'F', packageTier: 'vip', rawQuota: 1, buyerIsNew: false, regionCode: 'D1' });
    console.log('        回执：', JSON.stringify({ actual_paid: o1.actual_paid, supply_spread: o1.supply_spread }));
    console.log('        补货入账：F 名额 =', Q.getBalance(db.quotaLedger, 'F'), '（rawQuota 补货买方自动入账，2026-10-24 起）');
    console.log('    (b) G 购买 VIP：buyer=G, packageTier=vip, oldTier=none, seller=F');
    const o2 = R.createOrder(db, { buyerId: 'G', packageTier: 'vip', oldTier: 'none', buyerIsNew: true, regionCode: 'D1' });
    console.log('        回执：', JSON.stringify({ actual_paid: o2.actual_paid, supply_spread: o2.supply_spread }));
    const settled = runSettle(db, [], new Set());
    const m = sumByOwner(collect(db, settled));
    printOwner(m, 'A', '联创 A（F 的补货上级）');
    printOwner(m, 'F', '天使 F（G 的卖方）');
    printOwner(m, 'D', '门店代理 D');
  }

  // —— 分支 B：F 向 D 补货 ——
  console.log('\n  ┌─ 分支 B：F 向 D 购买 1 个 VIP 名额（rawQuota=1，F 与 D 交易，seller=D）');
  {
    const db = buildWorld();
    S.getUser(db, 'F').tier = 'angel';
    S.getUser(db, 'F').upline_id = 'D'; // 在本分支 F 向 D 门店补货
    console.log('    (a) F 补货：buyer=F, rawQuota=1, seller=D（身份补货仅供货差价，无复购奖）');
    const o1 = R.createOrder(db, { buyerId: 'F', packageTier: 'vip', rawQuota: 1, buyerIsNew: false, regionCode: 'D1' });
    console.log('        回执：', JSON.stringify({ actual_paid: o1.actual_paid, supply_spread: o1.supply_spread }));
    console.log('        补货入账：F 名额 =', Q.getBalance(db.quotaLedger, 'F'), '（rawQuota 补货买方自动入账，2026-10-24 起）');
    console.log('    (b) G 购买 VIP：buyer=G, packageTier=vip, oldTier=none, seller=F（G.upline=F）');
    const o2 = R.createOrder(db, { buyerId: 'G', packageTier: 'vip', oldTier: 'none', buyerIsNew: true, regionCode: 'D1' });
    console.log('        回执：', JSON.stringify({ actual_paid: o2.actual_paid, supply_spread: o2.supply_spread }));
    const settled = runSettle(db, [], new Set());
    const m = sumByOwner(collect(db, settled));
    printOwner(m, 'D', '门店代理 D（F 的补货上级）');
    printOwner(m, 'F', '天使 F（G 的卖方）');
    printOwner(m, 'A', '联创 A');
  }

  console.log('\n  └─ 结论：G 这笔 VIP 转售，F 不论向 A 还是 D 补货，F 卖 G 的即时收益都是 2480（仅供货差价，无直推奖）。');
  console.log('     差异仅在「补货渠道的供货差价」：向 A 补货 → A 赚 1480（vip 差价）；向 D 补货 → D 赚 480（vip 差价）。');
  console.log('     ※ 身份补货/转售均【无复购奖、无直推奖】，只剩供货差价（与售卖合伙人无直推奖规则一致）。');
  console.log('     ※ A 在分支 B 仍有全球/创始奖（基于「平台 2 笔 VIP」的联创共享奖，与补货渠道无关）；');
  console.log('       但「补货笔的供货差价」在分支 B 归 D，A 在该笔不直接抽成。');
  console.log('     ※ 结论性建议：F 应「向上补货给 A」（维持合伙人链），而非向 D 门店补货——否则 A（顶层联创）断链、');
  console.log('       且 D 作为门店代理截走本应归合伙人链的供货差价（480 vs A 的 1480）。');
}

// ════════════════════════ 主入口 ════════════════════════
function main() {
  console.log('═'.repeat(78));
  console.log('脑商AI · 复杂角色拓扑四问实算（后端代码真实跑批）');
  console.log('═'.repeat(78));
  q1();
  q2();
  q3();
  q4();

  line('⚠️ 代码口径 vs 业务预期的差异（请重点关注）');
  console.log('  1) 零售整包 spread 公式【已修复】：原代码零售模式也用 supplySpread=(下级档价−上级档价)×名额，');
  console.log('     私董<天使时算得 −3120 被拦截，卖家差价被吞。现零售模式改为 实付(零售价)−卖家拿货成本');
  console.log('     （与代码第76行注释、wholesalerProfit 函数口径一致）；rawQuota 补货模式维持 supplySpread 不变。');
  console.log('  2) oldTier 为空不升买家档：新用户整包购买必须显式传 oldTier:"none" 才会升档（本脚本已传）。');
  console.log('  3) 补货无自动充值：createOrder 只扣上级名额、不给宝宝买家充值，F 转售前须先补货（Q4 显式建模）。');
  console.log('  4) 全球奖无责期：默认 daysSinceCofounder=999/直推0 → 联创未达标时全球奖池无主；本脚本置 10 天使其合格。');
  console.log('  5) 即时 vs 结算分离：身份销售 supply/parity 下单即时落账（无 direct/rebuy）；门店费/总部费/合店费走月度结算。');
  console.log('  6) 【2026-10-23 新规则】售卖合伙人/VIP 名额无直推奖、无复购奖，只赚供货差价；直推奖仅产品提成与代理技术费。');
  console.log('  7) 【2026-10-24 已拍板】补货按「买家本档价」计价：F(天使) 向 A 补 1 个 VIP 名额按 WHOLESALE[angel]=7500 付费');
  console.log('     （非名额档 WHOLESALE[vip]=7980）；A 赚 (7500-6500)×1=1000。上级赚「下级本档价 − 自己本档价」差价，与买的名额档位无关。');
  console.log('     ⇒ 代码见 routes.createOrder：rawQuota 分支 actual_paid 用 WHOLESALE[buyer.tier]、spread 用 supplySpread(seller.tier, buyer.tier, need)。');
}

main();

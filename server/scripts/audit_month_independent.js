/**
 * 全月实算 · 独立复核（纯公式 手算 vs 业务代码）
 * ─────────────────────────────────────────────────────────────
 * 目的：用「另写一套纯算术」的方式重算本月每一笔收益，与 src/ 的实际输出逐项比对，
 *      抓出代码里的算错、漏算、重复计、归类错。
 *
 * 原则：
 *   1. 本脚本 **不 require 任何业务常量**（价格/档价/费率全部手写），避免「同一份常量算两遍」的假验证；
 *   2. 业务侧只调 store/routes/costorePlan/settlement 产生台账，然后按「接收人 + 类型」取数；
 *   3. 每一项都给出「算式字符串」，方便人工二次核对。
 *
 * 本月拓扑（与 month_full_sim.js 一致）：
 *   A 联创(持创始奖,顶层)｜B 私董(挂A)｜C 天使(挂A)
 *   S 省代｜S1 市代｜X 县区代｜D 门店代理(天使)，四人 region_code 均 D1
 *   E 普通(挂C)｜F 普通(挂A)｜L(挂F)｜G(挂F)
 *
 * 本月业务：T1 E→C 私董 6 名额｜T2 F→A 天使 3 名额｜T3 F 合店入场｜T4 L 合店入场｜T5 G→F VIP 1 名额
 */
const S = require('../src/store');
const R = require('../src/routes');
const Q = require('../src/quotaLedger');

const PERIOD = '2026-10';
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const money = (n) => r2(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pad = (s, n) => {
  let t = String(s);
  let w = 0;
  for (const ch of t) w += ch.charCodeAt(0) > 255 ? 2 : 1;
  while (w < n) { t += ' '; w++; }
  return t;
};

// ═══════════════ 一、手写参数（不引用 src，独立来源）═══════════════
const P = { vip: 9980, angel: 29800, private: 59800 };            // 零售价
const NV = { vip: 1, angel: 3, private: 6 };                      // 套餐含 VIP 名额数
const WH = { vip: 7980, angel: 7500, private: 6980, cofounder: 6500 }; // 每 VIP 拿货价
const STORE_UNIT = 3000;   // 门店服务费 / VIP
const HQ_UNIT = 3500;      // 总部产品费 / VIP
const SS = { store: 2400, district: 300, city: 200, province: 100 }; // 3000 的四级拆分
const GLOBAL_UNIT = 150;   // 全球奖池 / VIP
const FR = { cofounder: 0.005, private: 0.001 };  // 创始奖费率（基 = 3500/VIP）
const CR = { hq: 0.15, province: 0.02, city: 0.08, district: 0.10, svc: 0.40, direct: 0.13, upline: 0.02, div: 0.10 };
const ENTRY = 698 * 6;     // 4188 合店一次性入场（6 个月）

// ═══════════════ 二、手算预期值 ═══════════════
const EXP = { orders: {}, supply: {}, costore: {}, global: {}, founding: {}, storeFee: {}, dividend: {}, people: {}, meta: {} };
const TRACE = [];  // 算式留痕

const trace = (item, formula, value) => { TRACE.push({ item, formula, value: r2(value) }); return r2(value); };

// ── 2.1 三笔身份订单 ──
// T1  E 向 C(天使) 买私董
const t1_paid = P.private;                                   // 59800 零售
const t1_cCost = NV.private * WH.angel;                      // C 拿货成本 6×7500
const t1_cSpread = t1_paid - t1_cCost;                       // 14800
const t1_aSpread = (WH.angel - WH.cofounder) * NV.private;   // A 级差 (7500−6500)×6
const t1_store = 0;                                          // 卖方 C 是天使（合伙人身份）→ 合伙人渠道，无门店服务费
const t1_hq = (HQ_UNIT + STORE_UNIT) * NV.private;           // 合伙人渠道：总部留存 6500 × 6 = 39000
trace('T1 C 差价', `59800 − 6×7500 = 59800 − 45000`, t1_cSpread);
trace('T1 A 级差', `(7500 − 6500) × 6`, t1_aSpread);
trace('T1 门店费', `合伙人渠道 ⇒ 0`, t1_store);
trace('T1 总部留存', `6500 × 6`, t1_hq);
trace('T1 恒等式', `14800 + 6000 + 0 + 39000 = 59800`, t1_cSpread + t1_aSpread + t1_store + t1_hq);

// T2  F 向 A(联创) 买天使
const t2_paid = P.angel;                                     // 29800
const t2_aCost = NV.angel * WH.cofounder;                    // 19500
const t2_aSpread = t2_paid - t2_aCost;                       // 10300
const t2_store = 0;                                          // 卖方 A 是联创（合伙人身份）→ 合伙人渠道
const t2_hq = (HQ_UNIT + STORE_UNIT) * NV.angel;             // 6500 × 3 = 19500
trace('T2 A 差价', `29800 − 3×6500 = 29800 − 19500`, t2_aSpread);
trace('T2 恒等式', `10300 + 0 + 19500 = 29800`, t2_aSpread + t2_store + t2_hq);

// T5  G 向 F(天使) 买 VIP
const t5_paid = P.vip;                                       // 9980
const t5_fCost = NV.vip * WH.angel;                          // 7500
const t5_fSpread = t5_paid - t5_fCost;                       // 2480
const t5_aSpread = (WH.angel - WH.cofounder) * NV.vip;       // 1000
const t5_store = 0;                                          // 卖方 F 是合店老板（非门店老板）→ 合伙人渠道
const t5_hq = (HQ_UNIT + STORE_UNIT) * NV.vip;               // 6500 × 1 = 6500
trace('T5 F 差价', `9980 − 1×7500`, t5_fSpread);
trace('T5 A 级差', `(7500 − 6500) × 1`, t5_aSpread);
trace('T5 恒等式', `2480 + 1000 + 0 + 6500 = 9980`, t5_fSpread + t5_aSpread + t5_store + t5_hq);

EXP.supply.C = r2(t1_cSpread);                               // 14800
EXP.supply.A = r2(t1_aSpread + t2_aSpread + t5_aSpread);     // 6000+10300+1000 = 17300
EXP.supply.F = r2(t5_fSpread);                               // 2480

const totalVip = NV.private + NV.angel + NV.vip;             // 10
trace('总 VIP', `6 + 3 + 1`, totalVip);

// ── 2.2 合店两笔 ──
function costoreManual(fee, scenario) {
  const o = {
    hq: fee * CR.hq, province: fee * CR.province, city: fee * CR.city, district: fee * CR.district,
    svc: fee * CR.svc, direct: fee * CR.direct, upline: fee * CR.upline, div: fee * CR.div,
  };
  for (const k of Object.keys(o)) o[k] = r2(o[k]);
  o.sum = r2(Object.values(o).reduce((s, v) => s + v, 0));
  o.scenario = scenario;
  return o;
}
// cs_F：推荐人 A 非合店老板 ⇒ 13% 归门店店长 D；2% 归上级 A
const cf = costoreManual(ENTRY, 'C');
trace('cs_F 总部15%', `4188 × 15%`, cf.hq);
trace('cs_F 省2%', `4188 × 2%`, cf.province);
trace('cs_F 市8%', `4188 × 8%`, cf.city);
trace('cs_F 区县10%', `4188 × 10%`, cf.district);
trace('cs_F 门店服务40%', `4188 × 40%`, cf.svc);
trace('cs_F 业务直推13%→D(推荐人非合店老板)', `4188 × 13%`, cf.direct);
trace('cs_F 上级2%→A', `4188 × 2%`, cf.upline);
trace('cs_F 分红池10%', `4188 × 10%`, cf.div);
trace('cs_F 合计', `628.20+83.76+335.04+418.80+1675.20+544.44+83.76+418.80`, cf.sum);

// cs_L：上级 F 是合店老板 ⇒ 13%直推 + 2%复购共 15% 全归合店店长 F；门店店长 D 只拿 40% 服务（2026-10-24 新口径：场景 B）
const cl = costoreManual(ENTRY, 'B');
trace('cs_L 合计', `628.20+83.76+335.04+418.80+1675.20+544.44+83.76+418.80`, cl.sum);

EXP.costore = {
  // D：cs_F 40%+13%，cs_L 40%（cs_L 上级F是合店老板→13%+2%全归F，D只拿服务40%）
  D: r2(cf.svc + cf.direct + cl.svc),
  A: r2(cf.upline),                       // cs_F 上级（非合店老板）→ 2%
  F: r2(cl.direct + cl.upline),           // 场景B：上级F是合店老板 → 13%+2% = 628.20 全归 F
  HQ: r2(cf.hq + cl.hq),
  S: r2(cf.province + cl.province),
  S1: r2(cf.city + cl.city),
  X: r2(cf.district + cl.district),
};
trace('D 合店合计', `(1675.20+544.44) + 1675.20`, EXP.costore.D);
trace('A 合店合计', `4188×2%（cs_F 上级，非合店老板）`, EXP.costore.A);
trace('F 合店合计', `4188×(13%+2%)（cs_L 上级F是合店老板→场景B全归F）`, EXP.costore.F);

// ── 2.3 分红池（按月全平台一个池）──
const pool = r2(cf.div + cl.div);                            // 837.60
trace('分红池', `4188×10% × 2 笔`, pool);
// F、L 均入股首月 ⇒ 无责考核；业绩全 0 ⇒ 业绩半也按人头均分
const divPer = r2(pool / 2);
trace('分红 F/L 各', `837.60 ÷ 2（一半人数均分 418.80/2 + 一半业绩因全 0 也按人头）`, divPer);
EXP.dividend = { F: divPer, L: divPer };

// ── 2.4 全球奖 ──
const gPool = GLOBAL_UNIT * totalVip;                        // 1500
const gHalf = r2(gPool / 2);                                  // 750 均分半
const gPerf = r2(gPool - gHalf);                              // 750 业绩半
// 参与人：tier=cofounder ⇒ A、S(赠)、S1(赠)。X 是私董、D 是天使，均不参与
const gPeople = ['A', 'S', 'S1'];
const gShare = r2(gHalf / gPeople.length);                    // 250
// 业绩权重（2026-10-24 口径）：权重 = teamVip（子树 VIP，不再叠加 ownVip）；分母 = 真实平台总 VIP(10)
const gWeight = { A: 10, S: 0, S1: 0 };
const gWeightSum = 10;
EXP.global = {};
for (const id of gPeople) {
  const perfPart = gWeightSum > 0 ? r2(gPerf * gWeight[id] / gWeightSum) : 0;
  EXP.global[id] = r2(gShare + perfPart);
}
trace('全球奖池', `150 × 10`, gPool);
trace('全球奖均分半', `1500 ÷ 2 = 750 → 3 人各 250`, gHalf);
trace('全球奖业绩半', `750 × 10/10 → A 750`, gPerf);
trace('A 全球奖', `250 + 750`, EXP.global.A);
trace('S 全球奖', `250 + 0`, EXP.global.S);
trace('S1 全球奖', `250 + 0`, EXP.global.S1);

// ── 2.5 创始奖（基 = 3500 × 总VIP）──
const fBase = HQ_UNIT * totalVip;                             // 35000
EXP.founding = {
  A: r2(fBase * FR.cofounder),    // 联创且持创始奖
  B: r2(fBase * FR.private),      // 私董全员
  X: r2(fBase * FR.private),      // 区县代被赠私董
  E: r2(fBase * FR.private),      // T1 后升私董
  S: r2(fBase * FR.cofounder),    // 省代被赠联创（2026-10-24 起带创始奖）
  S1: r2(fBase * FR.cofounder),   // 市代被赠联创
};
trace('创始奖基数', `3500 × 10`, fBase);
trace('A 创始奖', `35000 × 0.5%`, EXP.founding.A);
trace('B/X/E 各', `35000 × 0.1%`, EXP.founding.B);
trace('S/S1 各（赠联创）', `35000 × 0.5%`, EXP.founding.S);
trace('创始奖合计', `175 + 35×3 + 175×2`, EXP.founding.A + EXP.founding.B * 3 + EXP.founding.S + EXP.founding.S1);

// ── 2.6 门店服务费（仅门店老板渠道才计提；本月 3 笔皆为合伙人渠道 ⇒ 0）──
EXP.storeFee = { D: 0, X: 0, S1: 0, S: 0 };
trace('门店服务费 D', `无门店售出订单 ⇒ 0`, EXP.storeFee.D);
trace('门店服务费 X', `无门店售出订单 ⇒ 0`, EXP.storeFee.X);
trace('门店服务费 S1', `无门店售出订单 ⇒ 0`, EXP.storeFee.S1);
trace('门店服务费 S', `无门店售出订单 ⇒ 0`, EXP.storeFee.S);

// ── 2.7 每人合计 ──
const g = (m, k) => r2(m[k] || 0);
EXP.people = {
  A: r2(EXP.supply.A + g(EXP.global, 'A') + g(EXP.founding, 'A') + g(EXP.costore, 'A')),
  B: r2(g(EXP.founding, 'B')),
  C: r2(EXP.supply.C),
  S: r2(g(EXP.global, 'S') + EXP.storeFee.S + g(EXP.costore, 'S') + g(EXP.founding, 'S')),
  S1: r2(g(EXP.global, 'S1') + EXP.storeFee.S1 + g(EXP.costore, 'S1') + g(EXP.founding, 'S1')),
  X: r2(g(EXP.founding, 'X') + EXP.storeFee.X + g(EXP.costore, 'X')),
  D: r2(EXP.storeFee.D + g(EXP.costore, 'D')),
  E: r2(g(EXP.founding, 'E')),
  F: r2(EXP.supply.F + g(EXP.costore, 'F') + g(EXP.dividend, 'F')),
  L: r2(g(EXP.dividend, 'L')),
  G: 0,
};

// ── 2.8 总部 & 闭环 ──
EXP.meta.hqFee = r2(t1_hq + t2_hq + t5_hq);                  // 65000（合伙人渠道，总部全额留存）
EXP.meta.storeFee = r2(t1_store + t2_store + t5_store);      // 0
EXP.meta.poolPaid = r2(gPool + EXP.founding.A + EXP.founding.B + EXP.founding.X + EXP.founding.E + EXP.founding.S + EXP.founding.S1); // 1500+630 = 2130
EXP.meta.hqNet = r2(EXP.meta.hqFee - EXP.meta.poolPaid + EXP.costore.HQ);
EXP.meta.collected = r2(t1_paid + t2_paid + t5_paid + ENTRY * 2);
EXP.meta.peopleTotal = r2(Object.values(EXP.people).reduce((s, v) => s + v, 0));
EXP.meta.gap = r2(EXP.meta.collected - EXP.meta.peopleTotal - EXP.meta.hqNet);

trace('总部留存合计', `6500 × 10（合伙人渠道全额）`, EXP.meta.hqFee);
trace('总部净留存', `65000 − 2130 + 1256.40`, EXP.meta.hqNet);
trace('本月实收', `59800 + 29800 + 9980 + 4188×2`, EXP.meta.collected);
trace('11 人合计', `Σ 每人`, EXP.meta.peopleTotal);
trace('闭环差额', `107956 − 43829.60 − 64126.40`, EXP.meta.gap);

// ═══════════════ 三、跑业务代码，取实际值 ═══════════════
const db = S.createDb();
const add = (id, tier, upline_id, extra = {}) => S.addUser(db, { id, name: id, tier, upline_id, ...extra });
add('A', 'cofounder', null, { is_founding: true, daysSinceCofounder: 0 });
add('B', 'private', 'A');
add('C', 'angel', 'A');
add('S', 'none', null);
add('S1', 'none', null);
add('X', 'none', null);
add('D', 'angel', null);
add('E', 'none', 'C');
add('F', 'none', 'A');
add('L', 'vip', 'F');     // 合店老板须 ≥ VIP（2026-10-23 规则）
add('G', 'none', 'F');
S.appointAgent(db, { partnerId: 'S', regionType: 'province', regionCode: 'D1' });
S.appointAgent(db, { partnerId: 'S1', regionType: 'city', regionCode: 'D1' });
S.appointAgent(db, { partnerId: 'X', regionType: 'district', regionCode: 'D1' });
S.appointAgent(db, { partnerId: 'D', regionType: 'store', regionCode: 'D1' });
Q.issueQuota(db.quotaLedger, 'A', 200);
Q.issueQuota(db.quotaLedger, 'C', 50);
Q.issueQuota(db.quotaLedger, 'F', 50);
Q.issueQuota(db.quotaLedger, 'D', 50);

const o1 = R.createOrder(db, { buyerId: 'E', packageTier: 'private', oldTier: 'none', buyerIsNew: true, regionCode: 'D1' });
const o2 = R.createOrder(db, { buyerId: 'F', packageTier: 'angel', oldTier: 'none', buyerIsNew: true, regionCode: 'D1' });
S.addCoStore(db, { id: 'cs_F', owner_id: 'F', storeManagerId: 'D', promoter_id: 'A', uplineId: 'A', fee: ENTRY, store_id: 'D', joinDate: PERIOD, owners: [{ id: 'F', performance: 0 }] });
S.addCoStore(db, { id: 'cs_L', owner_id: 'L', storeManagerId: 'D', promoter_id: 'F', uplineId: 'F', fee: ENTRY, store_id: 'D', joinDate: PERIOD, owners: [{ id: 'L', performance: 0 }] });
const o5 = R.createOrder(db, { buyerId: 'G', packageTier: 'vip', oldTier: 'none', buyerIsNew: true, regionCode: 'D1' });

const cofounderIds = Object.values(db.users).filter((u) => u.tier === 'cofounder').map((u) => u.id);
const cofounders = S.annotateCofounders(db, cofounderIds);
// 2026-10-24 口径：联创全员（含省/市代理赠予联创）发创始奖，私董全员发；凡 tier=cofounder/private 即纳入
const founders = Object.values(db.users)
  .filter((u) => u.tier === 'cofounder' || u.tier === 'private')
  .map((u) => ({ id: u.id, tier: u.tier, foundingBonus: u.tier === 'cofounder' }));
const costoreFees = db.coStores.map((cs) => ({
  id: cs.id, owner_id: cs.owner_id,
  storeManagerId: cs.storeManagerId || cs.owner_id,
  promoter_id: cs.promoter_id || null,
  uplineId: cs.upline_id || (db.users[cs.owner_id] && db.users[cs.owner_id].upline_id) || null,
  fee: ENTRY, store_id: cs.store_id, joinDate: cs.joinDate,
  ownerCount: cs.ownerCount || 1, owners: cs.owners || [],
}));
const { settleAll } = require('../src/settlement');
const res = settleAll({
  period: PERIOD, orders: db.orders.filter((o) => o.packageTier), cofounders, founders,
  costoreFees, agents: db.regionalAgents, settings: S.getSettings(db),
  costoreOwners: new Set(db.coStores.map((x) => x.owner_id)),
});

// ── 按「人 + 类型」汇总实际值 ──
const ACT = { supply: {}, costore: {}, global: {}, founding: {}, agent: {}, people: {}, meta: {} };
const bump = (bag, k, v) => { bag[k] = r2((bag[k] || 0) + v); };
for (const c of db.commissions) {
  if (c.type === 'supply') bump(ACT.supply, c.owner_id, c.amount);
  bump(ACT.people, c.owner_id, c.amount);
}
ACT.dividend = {};
for (const c of res.commissions) {
  if (c.type === 'agent') bump(ACT.agent, c.owner_id, c.amount);   // 门店服务费走结算
  if (c.type === 'costore') {
    if (c.owner_id === 'HQ') bump(ACT.costore, 'HQ', c.amount);
    else if (c.note && c.note.indexOf('分红') >= 0) bump(ACT.dividend, c.owner_id, c.amount);
    else bump(ACT.costore, c.owner_id, c.amount);
  }
  if (c.type === 'global') bump(ACT.global, c.owner_id, c.amount);
  if (c.type === 'founding') bump(ACT.founding, c.owner_id, c.amount);
  if (c.owner_id !== 'HQ') bump(ACT.people, c.owner_id, c.amount);   // HQ 不计入 11 人
}
ACT.meta.hqFee = r2(db.orders.reduce((s, o) => s + (o.hq_fee || 0), 0));
ACT.meta.storeFee = r2(db.orders.reduce((s, o) => s + (o.store_fee || 0), 0));
ACT.meta.poolPaid = r2(res.commissions.filter((c) => c.type === 'global' || c.type === 'founding').reduce((s, c) => s + c.amount, 0));
ACT.meta.hqNet = r2(ACT.meta.hqFee - ACT.meta.poolPaid + (ACT.costore.HQ || 0));
const paidOf = (o) => (o.actual_paid != null ? o.actual_paid : (o.actual_paid != null ? o.actual_paid : 0));
ACT.meta.collected = r2(db.orders.reduce((s, o) => s + paidOf(o), 0) + db.coStores.length * ENTRY);
ACT.meta.peopleTotal = r2(Object.values(ACT.people).reduce((s, v) => s + v, 0));
ACT.meta.gap = r2(ACT.meta.collected - ACT.meta.peopleTotal - ACT.meta.hqNet);
ACT.orders = { t1: o1, t2: o2, t5: o5 };

// ═══════════════ 四、比对 ═══════════════
let pass = 0, fail = 0;
const rows = [];
function cmp(scope, key, exp, act, note = '') {
  const ok = Math.abs(r2(exp) - r2(act)) < 0.01;
  ok ? pass++ : fail++;
  rows.push({ scope, key, exp: r2(exp), act: r2(act), diff: r2((act || 0) - (exp || 0)), ok, note });
}

// 4.1 订单字段
cmp('订单', 'T1 实付', t1_paid, o1.actual_paid);
cmp('订单', 'T1 卖方差价', t1_cSpread, o1.supply_spread);
cmp('订单', 'T1 门店费', t1_store, o1.store_fee);
cmp('订单', 'T1 总部费', t1_hq, o1.hq_fee);
cmp('订单', 'T2 实付', t2_paid, o2.actual_paid);
cmp('订单', 'T2 卖方差价', t2_aSpread, o2.supply_spread);
cmp('订单', 'T2 门店费', t2_store, o2.store_fee);
cmp('订单', 'T2 总部费', t2_hq, o2.hq_fee);
cmp('订单', 'T5 实付', t5_paid, o5.actual_paid);
cmp('订单', 'T5 卖方差价', t5_fSpread, o5.supply_spread);
cmp('订单', 'T5 门店费', t5_store, o5.store_fee);
cmp('订单', 'T5 总部费', t5_hq, o5.hq_fee);

// 4.2 供货差价
for (const id of ['A', 'C', 'F']) cmp('供货差价', id, EXP.supply[id] || 0, ACT.supply[id] || 0);

// 4.3 合店
for (const id of ['A', 'D', 'F', 'HQ', 'S', 'S1', 'X']) cmp('合店分成', id, EXP.costore[id] || 0, ACT.costore[id] || 0);

// 4.4 分红
for (const id of ['F', 'L']) cmp('月度分红池', id, EXP.dividend[id] || 0, (ACT.dividend || {})[id] || 0);

// 4.5 全球奖
for (const id of ['A', 'S', 'S1']) cmp('全球奖', id, EXP.global[id] || 0, ACT.global[id] || 0);
cmp('全球奖', '池', GLOBAL_UNIT * totalVip, r2(Object.values(ACT.global).reduce((s, v) => s + v, 0)));

// 4.6 创始奖
for (const id of ['A', 'B', 'X', 'E', 'S', 'S1']) cmp('创始奖', id, EXP.founding[id] || 0, ACT.founding[id] || 0);

// 4.7 门店服务费
for (const id of ['D', 'X', 'S1', 'S']) cmp('门店服务费', id, EXP.storeFee[id] || 0, ACT.agent[id] || 0);

// 4.8 每人合计
for (const id of ['A', 'B', 'C', 'S', 'S1', 'X', 'D', 'E', 'F', 'L', 'G']) cmp('每人合计', id, EXP.people[id] || 0, ACT.people[id] || 0);

// 4.9 总部 / 闭环
cmp('总部', '总部产品费', EXP.meta.hqFee, ACT.meta.hqFee);
cmp('总部', '净留存', EXP.meta.hqNet, ACT.meta.hqNet);
cmp('闭环', '本月实收', EXP.meta.collected, ACT.meta.collected);
cmp('闭环', '11 人合计', EXP.meta.peopleTotal, ACT.meta.peopleTotal);
cmp('闭环', '差额', 0, ACT.meta.gap);

// ═══════════════ 五、输出 ═══════════════
console.log('\n' + '═'.repeat(96));
console.log('全月实算 · 独立复核报告（纯公式 vs 业务代码）');
console.log('═'.repeat(96));
console.log(`\n复核项：${pass + fail}　通过 ${pass}　不符 ${fail}\n`);

let cur = '';
for (const r of rows) {
  if (r.scope !== cur) { cur = r.scope; console.log(`\n【${cur}】`); }
  const mark = r.ok ? '✅' : '❌';
  const diff = r.ok ? '' : `  差 ${r.diff > 0 ? '+' : ''}${money(r.diff)}`;
  console.log(`  ${mark} ${pad(r.key, 16)}手算 ${pad(money(r.exp), 12)}代码 ${pad(money(r.act), 12)}${diff}`);
}

if (fail) {
  console.log('\n【不符项明细】');
  for (const r of rows.filter((x) => !x.ok)) console.log(`  ❌ ${r.scope}/${r.key}：手算 ${money(r.exp)}，代码 ${money(r.act)}，差 ${money(r.diff)}`);
}

// ── 算式留痕（供人工二次核对）──
console.log('\n' + '═'.repeat(96));
console.log('逐项算式留痕（每一笔收益的来源）');
console.log('═'.repeat(96));
let lastItem = '';
for (const t of TRACE) {
  if (t.item !== lastItem) { console.log(); lastItem = t.item; }
  console.log(`  ${pad(t.item, 34)}${pad(t.formula, 46)}= ${money(t.value)}`);
}

// ── 结构性风险扫描（不影响本月金额，但口径需确认）──
console.log('\n' + '═'.repeat(96));
console.log('结构性口径扫描（本月金额不受影响，但换月可能失真）');
console.log('═'.repeat(96));
const aAnno = cofounders.find((c) => c.id === 'A');
console.log(`  1) 全球奖业绩权重（2026-10-24 已落地）：权重 = teamVip（卖出 VIP 名额占比），不再叠加 ownVip；分母 = 真实平台总 VIP。`);
console.log(`     A ownVip=${aAnno.ownVip}、teamVip=${aAnno.teamVip}；本月 S/S1 权重 0，故 A 拿满业绩半；多联创有业绩时按 teamVip 占比分配，不再失真。`);
const sAnno = cofounders.find((c) => c.id === 'S');
console.log(`\n  2) 代理被赠联创已带创始奖（2026-10-24 已确认并落地）：S/S1 tier=cofounder 现已全额发放创始奖 17.5/VIP，各 +${money(FR.cofounder * fBase)}，总部净留存已相应扣减。`);
if (EXP.global.S > 0) console.log(`     实算：S/S1 创始奖各 ${money(FR.cofounder * fBase)} 已计入（详见结算明细）。`);
console.log(`\n  3) E 本月才买私董即享整月创始奖 ${money(EXP.founding.E)}：创始奖按「当月全平台 VIP × 费率」给，不按在册天数折算。`);
console.log(`\n  4) 合店 2% 上级奖的身份归类：A 拿 ${money(EXP.costore.A)} 现已按「上级复购奖」单独记 subtype=costore_upline_repurchase，`);
console.log(`     并归「合伙人（上级）」栏（审计建议已于 2026-10-26 落地）：A 实为「F 的上级合伙人」，并非合店老板/店长。`);
console.log(`     报表可按 subtype 清晰分离该笔；门店/合店店长合计（D+F）= ${money(EXP.costore.D + EXP.costore.F)}，A 合伙人合计不变（总额仍为 ${money(EXP.people.A)}）。`);

console.log('\n' + '═'.repeat(96));
console.log(fail === 0 ? '结论：手算与代码 100% 一致，本月无算错。' : `结论：发现 ${fail} 项不符，见上方明细。`);
console.log('═'.repeat(96) + '\n');
process.exit(fail === 0 ? 0 : 1);

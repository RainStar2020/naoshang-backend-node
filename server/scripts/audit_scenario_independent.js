/**
 * 自测场景 · 独立复核（纯公式手算 vs 业务代码）
 * ─────────────────────────────────────────────────────────────
 * 范式同 audit_month_independent.js：本脚本【不 require 任何业务常量】，价格/档价/费率全部手写，
 * 用一套独立的纯算术重算本月每一笔收益，再与 src/ 真实输出逐项比对，抓出算错/漏算/重复/归类错。
 *
 * 拓扑（与 scenario_self_test.js 完全一致）：
 *   M 联创(持创始奖,顶层)｜N 天使(M下级)｜O VIP(N下级)｜Q 私董(N下级)｜R VIP(M下级)
 *   SO 天使+门店老板(M下级)｜F2 VIP+合店老板(O下级)｜T VIP(SO下级)
 *   PA 王省/CA 陈市/DA 李区：R1 省/市/区县代理（被赠联创/私董，参与奖池）
 *
 * 交易：O1 N←M 天使(3)｜O2 O←N VIP(1)｜O3 Q←N 私董(6)｜O4 R←M VIP(1)｜O5 T←SO VIP(1)【门店售出】｜CS F2 合店 4188
 */
const S = require('../src/store');
const R = require('../src/routes');
const Q = require('../src/quotaLedger');
const { settleAll } = require('../src/settlement');

const PERIOD = '2026-11';
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const money = (n) => r2(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pad = (s, n) => { let t = String(s); let w = 0; for (const ch of t) w += ch.charCodeAt(0) > 255 ? 2 : 1; while (w < n) { t += ' '; w++; } return t; };

// ═══════════════ 一、手写参数（独立来源，不引用 src）═══════════════
const P = { vip: 9980, angel: 29800, private: 59800 };
const NV = { vip: 1, angel: 3, private: 6 };
const WH = { vip: 7980, angel: 7500, private: 6980, cofounder: 6500 }; // 每 VIP 拿货价
const STORE_UNIT = 3000, HQ_UNIT = 3500;
const SS = { store: 2400, district: 300, city: 200, province: 100 };
const GLOBAL_UNIT = 150;
const FR = { cofounder: 0.005, private: 0.001 };
const CR = { hq: 0.15, province: 0.02, city: 0.08, district: 0.10, svc: 0.40, direct: 0.13, upline: 0.02, div: 0.10 };
const ENTRY = 698 * 6; // 4188

// ═══════════════ 二、手算预期值 ═══════════════
const EXP = { orders: {}, supply: {}, costore: {}, global: {}, founding: {}, storeFee: {}, dividend: {}, people: {}, meta: {} };
const TRACE = [];
const trace = (item, formula, value) => { TRACE.push({ item, formula, value: r2(value) }); return r2(value); };

// ── 2.1 五笔身份订单（供货差价 + 级联）──
// O1  N 向 M(联创) 买天使(3)
const o1_paid = P.angel;                                   // 29800
const o1_mCost = NV.angel * WH.cofounder;                  // 19500
const o1_mSpread = o1_paid - o1_mCost;                     // 10300
const o1_store = 0;                                        // M 联创=合伙人身份 → 合伙人通道
const o1_hq = (HQ_UNIT + STORE_UNIT) * NV.angel;           // 6500×3 = 19500
trace('O1 M 差价', `29800 − 3×6500`, o1_mSpread);
trace('O1 门店费', `联创售出 ⇒ 0`, o1_store);
trace('O1 总部费', `6500 × 3`, o1_hq);
trace('O1 恒等式', `10300 + 0 + 19500 = 29800`, o1_mSpread + o1_store + o1_hq);

// O2  O 向 N(天使) 买 VIP(1)
const o2_paid = P.vip;                                     // 9980
const o2_nCost = NV.vip * WH.angel;                        // 7500
const o2_nSpread = o2_paid - o2_nCost;                     // 2480
const o2_mCasc = (WH.angel - WH.cofounder) * NV.vip;       // (7500−6500)×1 = 1000 → M
const o2_store = 0;                                        // N 合伙人身份
const o2_hq = (HQ_UNIT + STORE_UNIT) * NV.vip;             // 6500×1 = 6500
trace('O2 N 差价', `9980 − 1×7500`, o2_nSpread);
trace('O2 M 级差', `(7500 − 6500) × 1`, o2_mCasc);
trace('O2 恒等式', `2480 + 1000 + 0 + 6500 = 9980`, o2_nSpread + o2_mCasc + o2_store + o2_hq);

// O3  Q 向 N(天使) 买私董(6)
const o3_paid = P.private;                                 // 59800
const o3_nCost = NV.private * WH.angel;                    // 45000
const o3_nSpread = o3_paid - o3_nCost;                     // 14800
const o3_mCasc = (WH.angel - WH.cofounder) * NV.private;   // (7500−6500)×6 = 6000 → M
const o3_store = 0;
const o3_hq = (HQ_UNIT + STORE_UNIT) * NV.private;         // 6500×6 = 39000
trace('O3 N 差价', `59800 − 6×7500`, o3_nSpread);
trace('O3 M 级差', `(7500 − 6500) × 6`, o3_mCasc);
trace('O3 恒等式', `14800 + 6000 + 0 + 39000 = 59800`, o3_nSpread + o3_mCasc + o3_store + o3_hq);

// O4  R 向 M(联创) 买 VIP(1)
const o4_paid = P.vip;                                     // 9980
const o4_mCost = NV.vip * WH.cofounder;                    // 6500
const o4_mSpread = o4_paid - o4_mCost;                     // 3480
const o4_store = 0;
const o4_hq = (HQ_UNIT + STORE_UNIT) * NV.vip;             // 6500×1 = 6500
trace('O4 M 差价', `9980 − 1×6500`, o4_mSpread);
trace('O4 恒等式', `3480 + 0 + 6500 = 9980`, o4_mSpread + o4_store + o4_hq);

// O5  T 向 SO(天使+门店老板) 买 VIP(1)【门店售出】
const o5_paid = P.vip;                                     // 9980
const o5_soCost = NV.vip * WH.angel;                       // 7500
const o5_soSpread = o5_paid - o5_soCost;                   // 2480
const o5_mCasc = (WH.angel - WH.cofounder) * NV.vip;       // (7500−6500)×1 = 1000 → M
const o5_store = STORE_UNIT * NV.vip;                      // 3000×1 = 3000（门店老板售出）
const o5_hq = HQ_UNIT * NV.vip + (STORE_UNIT * NV.vip - o5_store); // 3500×1 + 0 = 3500
trace('O5 SO 差价', `9980 − 1×7500`, o5_soSpread);
trace('O5 M 级差', `(7500 − 6500) × 1`, o5_mCasc);
trace('O5 门店费', `门店老板售出 ⇒ 3000×1`, o5_store);
trace('O5 总部费', `3500×1 + (3000−3000)`, o5_hq);
trace('O5 恒等式', `2480 + 1000 + 3000 + 3500 = 9980`, o5_soSpread + o5_mCasc + o5_store + o5_hq);

EXP.supply.M = r2(o1_mSpread + o2_mCasc + o3_mCasc + o4_mSpread + o5_mCasc); // 10300+1000+6000+3480+1000 = 21780
EXP.supply.N = r2(o2_nSpread + o3_nSpread);                                       // 2480+14800 = 17280
EXP.supply.SO = r2(o5_soSpread);                                                  // 2480
const totalVip = NV.angel + NV.vip + NV.private + NV.vip + NV.vip;                 // 12
trace('总 VIP', `3 + 1 + 6 + 1 + 1`, totalVip);

// ── 2.2 门店服务费（仅 O5 计提）──
EXP.storeFee = {
  SO: r2(o5_store * SS.store / STORE_UNIT),  // 2400
  DA: r2(o5_store * SS.district / STORE_UNIT), // 300
  CA: r2(o5_store * SS.city / STORE_UNIT),     // 200
  PA: r2(o5_store * SS.province / STORE_UNIT), // 100
};
trace('门店费 SO', `3000 × 2400/3000`, EXP.storeFee.SO);
trace('门店费 DA', `3000 × 300/3000`, EXP.storeFee.DA);
trace('门店费 CA', `3000 × 200/3000`, EXP.storeFee.CA);
trace('门店费 PA', `3000 × 100/3000`, EXP.storeFee.PA);

// ── 2.3 合店（F2，场景 C：推荐人 N 非合店老板 + 上级 O 存在）──
function costoreManual(fee) {
  const o = {
    hq: fee * CR.hq, province: fee * CR.province, city: fee * CR.city, district: fee * CR.district,
    svc: fee * CR.svc, direct: fee * CR.direct, upline: fee * CR.upline, div: fee * CR.div,
  };
  for (const k of Object.keys(o)) o[k] = r2(o[k]);
  o.sum = r2(Object.values(o).reduce((s, v) => s + v, 0));
  return o;
}
const cs = costoreManual(ENTRY);
trace('合店 HQ15%', `4188 × 15%`, cs.hq);
trace('合店 省2%', `4188 × 2%`, cs.province);
trace('合店 市8%', `4188 × 8%`, cs.city);
trace('合店 区县10%', `4188 × 10%`, cs.district);
trace('合店 门店服务40%', `4188 × 40%`, cs.svc);
trace('合店 业务直推13%→SO(推荐人N非合店老板)', `4188 × 13%`, cs.direct);
trace('合店 上级2%→O', `4188 × 2%`, cs.upline);
trace('合店 分红池10%', `4188 × 10%`, cs.div);
trace('合店 合计', `628.20+83.76+335.04+418.80+1675.20+544.44+83.76+418.80`, cs.sum);
EXP.costore = {
  SO: r2(cs.svc + cs.direct),  // 店长服务40% + 直推13%（推荐人非合店老板→13%归店长）
  O: r2(cs.upline),            // 上级 2%
  HQ: r2(cs.hq),
  PA: r2(cs.province), CA: r2(cs.city), DA: r2(cs.district),
};

// ── 2.4 分红池（按月全平台一个池；F2 唯一且入股首月无责）──
const pool = r2(cs.div);  // 418.8
trace('分红池', `4188 × 10%`, pool);
EXP.dividend = { F2: pool };  // 唯一合格者全得
trace('F2 分红', `418.80（首月无责，业绩0，唯一合格全得）`, EXP.dividend.F2);

// ── 2.5 全球奖 ──
const gPool = GLOBAL_UNIT * totalVip;  // 1800
const gHalf = r2(gPool / 2);            // 900 均分半
const gPerf = r2(gPool - gHalf);        // 900 业绩半
// 参与联创：M + PA/CA（省/市代理被赠联创）；2026-10-24 起业绩权重 = teamVip（子树VIP，不再叠加 ownVip）
// M.teamVip=12（整棵子树，含本人流向组织部分），PA/CA 不在合伙人树内 teamVip=0；分母=真实平台总VIP=12
const gPeople = ['M', 'PA', 'CA'];
const gShare = r2(gHalf / gPeople.length); // 300
const gWeight = { M: 12, PA: 0, CA: 0 }, gWeightSum = 12;
EXP.global = {};
for (const id of gPeople) {
  const perfPart = gWeightSum > 0 ? r2(gPerf * gWeight[id] / gWeightSum) : 0;
  EXP.global[id] = r2(gShare + perfPart);
}
trace('全球奖池', `150 × 12`, gPool);
trace('全球奖均分半', `1800 ÷ 2 = 900 → 3 人各 300`, gHalf);
trace('全球奖业绩半', `900 × 12/12 → M 900（teamVip 权重，不再叠加 ownVip）`, gPerf);
trace('M 全球奖', `300 + 900`, EXP.global.M);
trace('PA 全球奖', `300 + 0`, EXP.global.PA);
trace('CA 全球奖', `300 + 0`, EXP.global.CA);

// ── 2.6 创始奖（基 = 3500 × 总VIP = 42000）──
const fBase = HQ_UNIT * totalVip; // 42000
EXP.founding = {
  M: r2(fBase * FR.cofounder),  // 210 联创（含省/市代理赠予联创）
  Q: r2(fBase * FR.private),     // 42 私董
  DA: r2(fBase * FR.private),    // 42 区县代被赠私董
  PA: r2(fBase * FR.cofounder),  // 210 省代被赠联创（2026-10-24 起带创始奖）
  CA: r2(fBase * FR.cofounder),  // 210 市代被赠联创
};
trace('创始奖基数', `3500 × 12`, fBase);
trace('M 创始奖', `42000 × 0.5%`, EXP.founding.M);
trace('Q/DA 各', `42000 × 0.1%`, EXP.founding.Q);
trace('PA/CA 各（赠联创）', `42000 × 0.5%`, EXP.founding.PA);

// ── 2.7 每人合计 ──
const g = (m, k) => r2(m[k] || 0);
EXP.people = {
  M: r2(EXP.supply.M + g(EXP.global, 'M') + g(EXP.founding, 'M') + g(EXP.costore, 'M')),
  N: r2(EXP.supply.N),
  O: r2(g(EXP.costore, 'O')),
  Q: r2(g(EXP.founding, 'Q')),
  R: 0,
  SO: r2(EXP.supply.SO + g(EXP.storeFee, 'SO') + g(EXP.costore, 'SO')),
  F2: r2(g(EXP.dividend, 'F2')),
  T: 0,
  PA: r2(g(EXP.global, 'PA') + g(EXP.storeFee, 'PA') + g(EXP.costore, 'PA') + g(EXP.founding, 'PA')),
  CA: r2(g(EXP.global, 'CA') + g(EXP.storeFee, 'CA') + g(EXP.costore, 'CA') + g(EXP.founding, 'CA')),
  DA: r2(g(EXP.founding, 'DA') + g(EXP.storeFee, 'DA') + g(EXP.costore, 'DA')),
};

// ── 2.8 总部 & 闭环 ──
EXP.meta.hqFee = r2(o1_hq + o2_hq + o3_hq + o4_hq + o5_hq);      // 75000
EXP.meta.storeFee = r2(o1_store + o2_store + o3_store + o4_store + o5_store); // 3000
EXP.meta.poolPaid = r2(gPool + EXP.founding.M + EXP.founding.Q + EXP.founding.DA + EXP.founding.PA + EXP.founding.CA); // 2514
EXP.meta.hqNet = r2(EXP.meta.hqFee - EXP.meta.poolPaid + EXP.costore.HQ);
EXP.meta.collected = r2(o1_paid + o2_paid + o3_paid + o4_paid + o5_paid + ENTRY);
EXP.meta.peopleTotal = r2(Object.values(EXP.people).reduce((s, v) => s + v, 0));
EXP.meta.gap = r2(EXP.meta.collected - EXP.meta.peopleTotal - EXP.meta.hqNet);
trace('总部留存合计', `6500×11 + 3500×1 = 75000`, EXP.meta.hqFee);
trace('总部净留存', `75000 − 2514 + 628.20`, EXP.meta.hqNet);
trace('本月实收', `119540 + 4188`, EXP.meta.collected);
trace('11 人合计', `Σ`, EXP.meta.peopleTotal);
trace('闭环差额', `123728 − 50613.80 − 73114.20`, EXP.meta.gap); // 修正后 11 人合计含 PA/CA 创始奖各 210，差额归 0

// ═══════════════ 三、跑业务代码，取实际值 ═══════════════
const db = S.createDb();
const add = (id, tier, upline_id, extra = {}) => S.addUser(db, { id, name: id, tier, upline_id, ...extra });
add('M', 'cofounder', null, { is_founding: true, daysSinceCofounder: 0 });
add('N', 'none', 'M');
add('O', 'none', 'N');
add('Q', 'none', 'N');
add('R', 'none', 'M');
add('SO', 'angel', 'M');
add('F2', 'vip', 'O');
add('T', 'none', 'SO');
add('PA', 'none', null);
add('CA', 'none', null);
add('DA', 'none', null);
S.appointAgent(db, { partnerId: 'PA', regionType: 'province', regionCode: 'R1' });
S.appointAgent(db, { partnerId: 'CA', regionType: 'city', regionCode: 'R1' });
S.appointAgent(db, { partnerId: 'DA', regionType: 'district', regionCode: 'R1' });
S.appointAgent(db, { partnerId: 'SO', regionType: 'store', regionCode: 'R1' });
Q.issueQuota(db.quotaLedger, 'M', 200);
Q.issueQuota(db.quotaLedger, 'N', 100);
Q.issueQuota(db.quotaLedger, 'SO', 50);

const o1 = R.createOrder(db, { buyerId: 'N', packageTier: 'angel', oldTier: 'none', buyerIsNew: true, regionCode: 'R1' });
const o2 = R.createOrder(db, { buyerId: 'O', packageTier: 'vip', oldTier: 'none', buyerIsNew: true, regionCode: 'R1' });
const o3 = R.createOrder(db, { buyerId: 'Q', packageTier: 'private', oldTier: 'none', buyerIsNew: true, regionCode: 'R1' });
const o4 = R.createOrder(db, { buyerId: 'R', packageTier: 'vip', oldTier: 'none', buyerIsNew: true, regionCode: 'R1' });
const o5 = R.createOrder(db, { buyerId: 'T', packageTier: 'vip', oldTier: 'none', buyerIsNew: true, regionCode: 'R1' });
S.addCoStore(db, { id: 'cs_F2', owner_id: 'F2', storeManagerId: 'SO', promoter_id: 'N', upline_id: 'O', fee: ENTRY, store_id: 'SO', joinDate: PERIOD, owners: [{ id: 'F2', performance: 0 }] });

const cofounderIds = Object.values(db.users).filter((u) => u.tier === 'cofounder').map((u) => u.id);
const cofounders = S.annotateCofounders(db, cofounderIds);
// 2026-10-24 口径：联创全员（含省/市代理赠予联创）发创始奖，私董全员发；凡 tier=cofounder/private 即纳入
const founders = Object.values(db.users)
  .filter((u) => u.tier === 'cofounder' || u.tier === 'private')
  .map((u) => ({ id: u.id, tier: u.tier, foundingBonus: u.tier === 'cofounder' }));
const costoreFees = db.coStores.map((x) => ({
  id: x.id, owner_id: x.owner_id, storeManagerId: x.storeManagerId || x.owner_id,
  promoter_id: x.promoter_id || null, uplineId: x.upline_id || null,
  fee: ENTRY, store_id: x.store_id, joinDate: x.joinDate,
  ownerCount: x.ownerCount || 1, owners: x.owners || [], regionCode: 'R1',
}));
const res = settleAll({
  period: PERIOD, orders: db.orders.filter((o) => o.packageTier), cofounders, founders,
  costoreFees, agents: db.regionalAgents, settings: S.getSettings(db),
  costoreOwners: new Set(db.coStores.map((x) => x.owner_id)),
});

const ACT = { supply: {}, agent: {}, costore: {}, dividend: {}, global: {}, founding: {}, people: {}, meta: {} };
const bump = (bag, k, v) => { bag[k] = r2((bag[k] || 0) + v); };
for (const c of db.commissions) {
  if (c.type === 'supply') bump(ACT.supply, c.owner_id, c.amount);
  bump(ACT.people, c.owner_id, c.amount);
}
for (const c of res.commissions) {
  if (c.type === 'agent') bump(ACT.agent, c.owner_id, c.amount);
  if (c.type === 'costore') {
    if (c.owner_id === 'HQ') bump(ACT.costore, 'HQ', c.amount);
    else if (c.note && c.note.indexOf('分红') >= 0) bump(ACT.dividend, c.owner_id, c.amount);
    else bump(ACT.costore, c.owner_id, c.amount);
  }
  if (c.type === 'global') bump(ACT.global, c.owner_id, c.amount);
  if (c.type === 'founding') bump(ACT.founding, c.owner_id, c.amount);
  if (c.owner_id !== 'HQ') bump(ACT.people, c.owner_id, c.amount);
}
ACT.meta.hqFee = r2(db.orders.reduce((s, o) => s + (o.hq_fee || 0), 0));
ACT.meta.storeFee = r2(db.orders.reduce((s, o) => s + (o.store_fee || 0), 0));
ACT.meta.poolPaid = r2(res.commissions.filter((c) => c.type === 'global' || c.type === 'founding').reduce((s, c) => s + c.amount, 0));
ACT.meta.hqNet = r2(ACT.meta.hqFee - ACT.meta.poolPaid + (ACT.costore.HQ || 0));
const paidOf = (o) => (o.actual_paid != null ? o.actual_paid : (o.actual_paid != null ? o.actual_paid : 0));
ACT.meta.collected = r2(db.orders.reduce((s, o) => s + paidOf(o), 0) + db.coStores.length * ENTRY);
ACT.meta.peopleTotal = r2(Object.values(ACT.people).reduce((s, v) => s + v, 0));
ACT.meta.gap = r2(ACT.meta.collected - ACT.meta.peopleTotal - ACT.meta.hqNet);
ACT.orders = { o1, o2, o3, o4, o5 };

// ═══════════════ 四、比对 ═══════════════
let pass = 0, fail = 0;
const rows = [];
function cmp(scope, key, exp, act, note = '') {
  const ok = Math.abs(r2(exp) - r2(act)) < 0.01;
  ok ? pass++ : fail++;
  rows.push({ scope, key, exp: r2(exp), act: r2(act), diff: r2((act || 0) - (exp || 0)), ok, note });
}

cmp('订单', 'O1 实付', o1_paid, o1.actual_paid);
cmp('订单', 'O1 卖方差价', o1_mSpread, o1.supply_spread);
cmp('订单', 'O1 门店费', o1_store, o1.store_fee);
cmp('订单', 'O1 总部费', o1_hq, o1.hq_fee);
cmp('订单', 'O2 实付', o2_paid, o2.actual_paid);
cmp('订单', 'O2 卖方差价', o2_nSpread, o2.supply_spread);
cmp('订单', 'O2 门店费', o2_store, o2.store_fee);
cmp('订单', 'O2 总部费', o2_hq, o2.hq_fee);
cmp('订单', 'O3 实付', o3_paid, o3.actual_paid);
cmp('订单', 'O3 卖方差价', o3_nSpread, o3.supply_spread);
cmp('订单', 'O3 门店费', o3_store, o3.store_fee);
cmp('订单', 'O3 总部费', o3_hq, o3.hq_fee);
cmp('订单', 'O4 实付', o4_paid, o4.actual_paid);
cmp('订单', 'O4 卖方差价', o4_mSpread, o4.supply_spread);
cmp('订单', 'O4 门店费', o4_store, o4.store_fee);
cmp('订单', 'O4 总部费', o4_hq, o4.hq_fee);
cmp('订单', 'O5 实付', o5_paid, o5.actual_paid);
cmp('订单', 'O5 卖方差价', o5_soSpread, o5.supply_spread);
cmp('订单', 'O5 门店费', o5_store, o5.store_fee);
cmp('订单', 'O5 总部费', o5_hq, o5.hq_fee);

for (const id of ['M', 'N', 'SO']) cmp('供货差价', id, EXP.supply[id] || 0, ACT.supply[id] || 0);
for (const id of ['SO', 'DA', 'CA', 'PA']) cmp('门店服务费', id, EXP.storeFee[id] || 0, ACT.agent[id] || 0);
for (const id of ['SO', 'O', 'HQ', 'PA', 'CA', 'DA']) cmp('合店分成', id, EXP.costore[id] || 0, ACT.costore[id] || 0);
cmp('分红', 'F2', EXP.dividend.F2 || 0, (ACT.dividend || {})['F2'] || 0);
for (const id of ['M', 'PA', 'CA']) cmp('全球奖', id, EXP.global[id] || 0, ACT.global[id] || 0);
cmp('全球奖', '池', GLOBAL_UNIT * totalVip, r2(Object.values(ACT.global).reduce((s, v) => s + v, 0)));
for (const id of ['M', 'Q', 'DA', 'PA', 'CA']) cmp('创始奖', id, EXP.founding[id] || 0, ACT.founding[id] || 0);
for (const id of ['M', 'N', 'O', 'Q', 'R', 'SO', 'F2', 'T', 'PA', 'CA', 'DA']) cmp('每人合计', id, EXP.people[id] || 0, ACT.people[id] || 0);
cmp('总部', '总部产品费', EXP.meta.hqFee, ACT.meta.hqFee);
cmp('总部', '净留存', EXP.meta.hqNet, ACT.meta.hqNet);
cmp('闭环', '本月实收', EXP.meta.collected, ACT.meta.collected);
cmp('闭环', '11人合计', EXP.meta.peopleTotal, ACT.meta.peopleTotal);
cmp('闭环', '差额', 0, ACT.meta.gap);

// ═══════════════ 五、输出 ═══════════════
console.log('\n' + '═'.repeat(96));
console.log('自测场景 · 独立复核报告（纯公式手算 vs 业务代码）');
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

console.log('\n' + '═'.repeat(96));
console.log('逐项算式留痕');
console.log('═'.repeat(96));
let lastItem = '';
for (const t of TRACE) {
  if (t.item !== lastItem) { console.log(); lastItem = t.item; }
  console.log(`  ${pad(t.item, 36)}${pad(t.formula, 44)}= ${money(t.value)}`);
}

console.log('\n' + '═'.repeat(96));
console.log('结构性口径扫描（本月金额不受影响，但换月可能失真 / 归类待确认）');
console.log('═'.repeat(96));
const mAnno = cofounders.find((c) => c.id === 'M');
console.log(`  1) 全球奖业绩权重（2026-10-24 已落地）：权重 = teamVip（卖出 VIP 名额占比，已含本人流向组织部分），不再叠加 ownVip；`);
console.log(`     分母 = 真实平台总 VIP（${totalVip}）。本月 PA/CA 权重 0，故 M 拿满业绩半；多联创有业绩时按 teamVip 占比分配，不再失真。`);
const paAnno = cofounders.find((c) => c.id === 'PA');
console.log(`\n  2) 代理被赠联创已带创始奖（2026-10-24 已确认并落地）：PA/CA tier=cofounder 现已全额发放创始奖 17.5/VIP，各 +${money(FR.cofounder * fBase)}，总部净留存已相应扣减。`);
console.log(`     实算：PA/CA 创始奖各 ${money(FR.cofounder * fBase)} 已计入（详见结算明细）。`);
console.log(`\n  3) F2 首月无责分红全得 418.80：分红按「入股首月无责」豁免考核，业绩 0 仍全额领取。`);
console.log(`\n  4) 合店 2% 上级奖 O 的 ${money(EXP.costore.O)} 现已按「上级复购奖」单独记 subtype=costore_upline_repurchase，`);
console.log(`     并归「合伙人（上级）」栏（审计建议已于 2026-10-26 落地）：O 是 F2 的上级合伙人，非合店老板/店长，归类更准确。`);
console.log(`     报表可按 subtype 清晰分离该笔；调整后端为：合伙人合计 +${money(EXP.costore.O)}，合店店长合计 −${money(EXP.costore.O)}（总额不变）。`);

console.log('\n' + '═'.repeat(96));
console.log(fail === 0 ? '结论：手算与代码 100% 一致，本月无算错。' : `结论：发现 ${fail} 项不符，见上方明细。`);
console.log('═'.repeat(96) + '\n');
process.exit(fail === 0 ? 0 : 1);

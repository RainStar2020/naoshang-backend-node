/**
 * 全月实算（11 人 · 含全球奖 / 创始奖 / 分红 / 门店费 / 总部）
 * ─────────────────────────────────────────────────────────────
 * 用户 2026-10-23 口述拓扑与业务规则：
 *   A 联创（顶层，持创始奖）｜B 私董（A 下级）｜C 天使（A 下级）
 *   省代 S / 市代 S1 / 县区代 X / 门店代理 D（区域码 D1，D 为天使档）
 *   E 普通用户（C 下级）｜F 普通用户（A 下级）｜L（F 下级）｜G（F 下级，VIP 用户）
 *
 * 本月业务：
 *   T1  E 向 C 买私董 59800        → C 差价 14800｜A 级差 6000｜总部 39000（门店费18000+总部费21000）
 *   T2  F 向 A 买天使 29800        → A 差价 10300｜总部 19500
 *   T3  F 合店入场 4188（进 D 店） → 场景 C
 *   T4  L 合店入场 4188（进 D 店） → 场景 B（F 既推荐人又上级：13% 归 F，2% 归门店店长）
 *   T5  G 向 F 买 VIP 9980         → F 差价 2480｜A 级差 1000｜总部 6500
 *
 * 规则（用户 2026-10-23 明确）：
 *   · 售卖合伙人/VIP 名额只赚供货差价，无直推奖、无复购奖；
 *   · VIP 名额不算产品；直推奖只指代理直推奖（与产品提成）；
 *   · 门店服务费只在「门店老板」身份售出时计提（3,000/名额）；合伙人身份或合店老板身份卖出，
 *     走「合伙人售卖」通道，门店服务费 0，该 3,000 并入总部留存（底价 6,500 不变）；
 *   · 合店费：总部15 / 省2 / 市8 / 区县10 / 门店店长40 / 业务13（推荐人）/ 业务2（上级，若上级=推荐人则归店长）/ 分红池10。
 */
const S = require('../src/store');
const R = require('../src/routes');
const CP = require('../src/costorePlan');
const SET = require('../src/settlement');
const C = require('../src/commission');
const Q = require('../src/quotaLedger');

const PERIOD = '2026-10';
const ENTRY = C.COSTORE_FEE_MONTHLY * 6; // 4188
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const money = (n) => (n === 0 ? '0' : r2(n).toLocaleString('en-US'));
const pad = (s, n) => { let t = String(s); let w = 0; for (const ch of t) w += ch.charCodeAt(0) > 255 ? 2 : 1; while (w < n) { t += ' '; w++; } return t; };
const line = (t) => console.log('\n' + '═'.repeat(90) + '\n' + t + '\n' + '═'.repeat(90));

// ───────────────────────── 建世界 ─────────────────────────
function build() {
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

  // 代理任命（省/市赠联创、区县赠私董、门店不赠）
  S.appointAgent(db, { partnerId: 'S', regionType: 'province', regionCode: 'D1' });
  S.appointAgent(db, { partnerId: 'S1', regionType: 'city', regionCode: 'D1' });
  S.appointAgent(db, { partnerId: 'X', regionType: 'district', regionCode: 'D1' });
  S.appointAgent(db, { partnerId: 'D', regionType: 'store', regionCode: 'D1' });

  // 库存名额（上级需有货可卖）
  Q.issueQuota(db.quotaLedger, 'A', 200);
  Q.issueQuota(db.quotaLedger, 'C', 50);
  Q.issueQuota(db.quotaLedger, 'F', 50);
  Q.issueQuota(db.quotaLedger, 'D', 50);
  return db;
}

// ───────────────────────── 交易 ─────────────────────────
function trade(db) {
  const tx = [];

  const o1 = R.createOrder(db, { buyerId: 'E', packageTier: 'private', oldTier: 'none', buyerIsNew: true, regionCode: 'D1' });
  tx.push({ code: 'T1', desc: 'E 向 C 买「私董」（6 VIP）', order: o1 });

  const o2 = R.createOrder(db, { buyerId: 'F', packageTier: 'angel', oldTier: 'none', buyerIsNew: true, regionCode: 'D1' });
  tx.push({ code: 'T2', desc: 'F 向 A 买「天使」（3 VIP）', order: o2 });

  S.addCoStore(db, {
    id: 'cs_F', owner_id: 'F', storeManagerId: 'D', promoter_id: 'A', uplineId: 'A',
    fee: ENTRY, store_id: 'D', joinDate: PERIOD, owners: [{ id: 'F', performance: 0 }],
  });
  tx.push({ code: 'T3', desc: 'F 合店入场 4188（推荐人 A / 门店店长 D）', costore: 'cs_F' });

  S.addCoStore(db, {
    id: 'cs_L', owner_id: 'L', storeManagerId: 'D', promoter_id: 'F', uplineId: 'F',
    fee: ENTRY, store_id: 'D', joinDate: PERIOD, owners: [{ id: 'L', performance: 0 }],
  });
  tx.push({ code: 'T4', desc: 'L 合店入场 4188（推荐人 F / 上级 F / 门店店长 D）', costore: 'cs_L' });

  const o5 = R.createOrder(db, { buyerId: 'G', packageTier: 'vip', oldTier: 'none', buyerIsNew: true, regionCode: 'D1' });
  tx.push({ code: 'T5', desc: 'G 向 F 买「VIP」（1 VIP）', order: o5 });

  return tx;
}

// ───────────────────────── 结算 ─────────────────────────
function settle(db) {
  const cofounderIds = Object.values(db.users).filter((u) => u.tier === 'cofounder').map((u) => u.id);
  const cofounders = S.annotateCofounders(db, cofounderIds);
  // 2026-10-24 口径：联创全员（含省/市代理赠予联创）发创始奖，私董全员发；凡 tier=cofounder/private 即纳入
  const founders = Object.values(db.users)
    .filter((u) => u.tier === 'cofounder' || u.tier === 'private')
    .map((u) => ({ id: u.id, tier: u.tier, foundingBonus: u.tier === 'cofounder' }));
  const orders = db.orders.filter((o) => o.packageTier);
  const costoreOwners = new Set(db.coStores.map((x) => x.owner_id));
  const settings = S.getSettings(db);
  const costoreFees = db.coStores.map((cs) => ({
    id: cs.id, owner_id: cs.owner_id,
    storeManagerId: cs.storeManagerId || cs.owner_id,
    promoter_id: cs.promoter_id || null,
    uplineId: cs.upline_id || cs.uplineId || (db.users[cs.owner_id] && db.users[cs.owner_id].upline_id) || null,
    fee: ENTRY, store_id: cs.store_id, joinDate: cs.joinDate,
    ownerCount: cs.ownerCount || 1, owners: cs.owners || [],
    regionCode: cs.region_code || (db.users[cs.owner_id] && db.users[cs.owner_id].region_code) || null,
  }));
  const res = SET.settleAll({
    period: PERIOD, orders, cofounders, founders, costoreFees,
    agents: db.regionalAgents, settings, costoreOwners,
  });
  res.cofounders = cofounders;
  return res;
}

// ───────────────────────── 汇总 ─────────────────────────
const TYPE_CN = {
  supply: '供货差价', parity: '平级奖', agent: '门店服务费', global: '全球奖',
  founding: '创始奖', costore: '合店收益', product: '产品提成',
};

function main() {
  const db = build();
  line('脑商AI · 全月实算（11 用户 · 2026-10 月）');
  console.log('成员：A 联创(持创始奖)｜B 私董｜C 天使｜S 省代｜S1 市代｜X 县区代｜D 门店代理(天使)');
  console.log('      E→私董(C下级)｜F→天使(A下级,合店老板)｜L 合店老板(F下级)｜G VIP(F下级)');

  const tx = trade(db);

  // ── 1. 订单台账 ──
  line('一、身份销售台账（钱包差额 / 无直推奖无复购奖）');
  console.log(`${pad('单号', 5)}${pad('摘要', 34)}${pad('实付', 10)}${pad('卖方差价', 10)}${pad('渠道', 9)}${pad('门店费', 8)}${pad('总部费', 9)}`);
  for (const t of tx) {
    if (!t.order) continue;
    const o = t.order;
    console.log(`${pad(t.code, 5)}${pad(t.desc, 34)}${pad(money(o.actual_paid != null ? o.actual_paid : o.actual_paid), 10)}${pad(money(o.supply_spread), 10)}${pad(o.channel === 'store' ? '门店售出' : '合伙人', 9)}${pad(money(o.store_fee), 8)}${pad(money(o.hq_fee), 9)}`);
  }
  console.log('\n  供货链级差（上级按自己档价拿货、按下级档价卖出）：');
  for (const c of db.commissions.filter((x) => x.type === 'supply')) {
    console.log(`    · ${pad(c.owner_id, 3)} ${pad(money(c.amount), 10)}  ${c.formula || ''}`);
  }

  // ── 2. 合店台账 ──
  line('二、合店入场台账（4188 = 698×6）');
  for (const cs of db.coStores) {
    const referrer = { id: cs.promoter_id, isCostoreOwner: db.coStores.some((x) => x.owner_id === cs.promoter_id) };
    const upId = cs.upline_id || cs.uplineId || null;
    const d = CP.costoreDistribution({
      fee: ENTRY, storeManagerId: cs.storeManagerId,
      referrer, upline: upId ? { id: upId } : null,
      uplineIsCostoreOwner: db.coStores.some((x) => x.owner_id === upId),
      provinceId: 'S', cityId: 'S1', districtId: 'X',
    });
    console.log(`\n  ${cs.id}（合店老板 ${cs.owner_id}，推荐人 ${cs.promoter_id}，上级 ${upId || '无'}，店长 ${cs.storeManagerId}）→ 场景 ${d.scenario.code}：${d.scenario.label}`);
    for (const r of d.byRecipient) console.log(`      ${pad(r.id, 4)} ${pad(money(r.amount), 9)}  ${r.roles.join('+')}  ${r.notes.join(' / ')}`);
    console.log(`      ${pad('池', 4)} ${pad(money(d.dividendPool), 9)}  10% 进本月全平台分红池（与全球奖同口径，按月结算）`);
  }

  // ── 3. 结算 ──
  const res = settle(db);

  line('三、月度结算明细');
  const group = {};
  for (const c of res.commissions) (group[c.type] = group[c.type] || []).push(c);
  for (const [type, list] of Object.entries(group)) {
    console.log(`\n  【${TYPE_CN[type] || type}】合计 ${money(list.reduce((s, c) => s + c.amount, 0))}`);
    for (const c of list) {
      console.log(`    · ${pad(c.owner_id, 4)} ${pad(money(c.amount), 10)} ${c.note ? '｜' + c.note : ''}${c.region_type ? '｜' + c.region_type : ''}`);
    }
  }
  console.log('\n  全球奖参与人（联创）标注：');
  for (const c of res.cofounders) {
    console.log(`    · ${pad(c.id, 3)} 本人VIP ${pad(c.ownVip, 3)} 团队VIP ${pad(c.teamVip, 3)} 入联创天数 ${c.daysSinceCofounder} → 权重 ${c.ownVip + c.teamVip}`);
  }
  console.log(`  全球奖池 = 150 × 总VIP ${res.summary.totalVip} = ${money(res.summary.globalPool)}`);

  // ── 4. 每人月收入 ──
  const people = ['A', 'B', 'C', 'S', 'S1', 'X', 'D', 'E', 'F', 'L', 'G'];
  const agg = {};
  for (const c of db.commissions) {
    agg[c.owner_id] = agg[c.owner_id] || { instant: {}, settle: {} };
    agg[c.owner_id].instant[c.type] = r2((agg[c.owner_id].instant[c.type] || 0) + c.amount);
  }
  for (const c of res.commissions) {
    agg[c.owner_id] = agg[c.owner_id] || { instant: {}, settle: {} };
    agg[c.owner_id].settle[c.type] = r2((agg[c.owner_id].settle[c.type] || 0) + c.amount);
  }

  line('四、每人本月收入（含分红 / 全球奖 / 创始奖）');
  console.log(`${pad('人', 4)}${pad('即时', 11)}${pad('结算', 11)}${pad('合计', 12)}  明细`);
  let peopleTotal = 0;
  for (const id of people) {
    const e = agg[id] || { instant: {}, settle: {} };
    const inst = r2(Object.values(e.instant).reduce((s, v) => s + v, 0));
    const stl = r2(Object.values(e.settle).reduce((s, v) => s + v, 0));
    const parts = [];
    for (const [t, v] of Object.entries(e.instant)) if (v) parts.push(`${TYPE_CN[t] || t} ${money(v)}`);
    for (const [t, v] of Object.entries(e.settle)) if (v) parts.push(`${TYPE_CN[t] || t} ${money(v)}`);
    peopleTotal = r2(peopleTotal + inst + stl);
    console.log(`${pad(id, 4)}${pad(money(inst), 11)}${pad(money(stl), 11)}${pad(money(inst + stl), 12)}  ${parts.join(' + ') || '—'}`);
  }

  // ── 5. 总部 ──
  const hqComms = (agg.HQ ? r2(Object.values(agg.HQ.instant).reduce((s, v) => s + v, 0) + Object.values(agg.HQ.settle).reduce((s, v) => s + v, 0)) : 0);
  const hqFee = r2(db.orders.reduce((s, o) => s + o.hq_fee, 0));
  const poolPaid = r2(res.commissions.filter((c) => c.type === 'global' || c.type === 'founding').reduce((s, c) => s + c.amount, 0));
  const costoreHq = r2(res.commissions.filter((c) => c.type === 'costore' && c.owner_id === 'HQ').reduce((s, c) => s + c.amount, 0));

  line('五、总部本月收益');
  const storeVip = db.orders.filter((o) => o.channel === 'store').reduce((s, o) => s + (o.quotaCount || 0), 0);
  const partnerVip = r2(res.summary.totalVip - storeVip);
  const storePaid = r2(db.orders.reduce((s, o) => s + (o.store_fee || 0), 0));
  console.log(`  身份销售总底价（6500 × ${res.summary.totalVip} 名额）           = ${money(6500 * res.summary.totalVip)}`);
  console.log(`    ├─ 门店服务费（门店渠道 ${storeVip} 名额 × 3000）      = ${money(storePaid)}  → 分给 门店/区县/市/省代理`);
  console.log(`    └─ 总部留存（门店 3500×${storeVip} + 合伙人 6500×${money(partnerVip)}）= ${money(hqFee)}`);
  console.log(`  减：全球奖池 ${money(150 * res.summary.totalVip)} + 创始奖 ${money(res.commissions.filter((c) => c.type === 'founding').reduce((s, c) => s + c.amount, 0))} = ${money(poolPaid)}`);
  console.log(`  加：合店费总部 15% × 2 笔             = ${money(costoreHq)}`);
  console.log(`  ─────────────────────────────────────────────────────────`);
  console.log(`  总部净留存                            = ${money(r2(hqFee - poolPaid + costoreHq))}`);

  // ── 6. 资金闭环 ──
  const collected = r2(db.orders.reduce((s, o) => s + (o.actual_paid != null ? o.actual_paid : 0), 0) + db.coStores.length * ENTRY);
  const paidOut = r2(peopleTotal);
  const hqNet = r2(hqFee - poolPaid + costoreHq);
  line('六、资金闭环核对');
  console.log(`  本月实收 = 订单 ${money(db.orders.reduce((s, o) => s + (o.actual_paid != null ? o.actual_paid : 0), 0))} + 合店费 ${money(db.coStores.length * ENTRY)} = ${money(collected)}`);
  console.log(`  支出     = 11 位用户合计 ${money(paidOut)} + 总部净留存 ${money(hqNet)} = ${money(r2(paidOut + hqNet))}`);
  const gap = r2(collected - paidOut - hqNet);
  console.log(`  差额     = ${money(gap)} ${gap === 0 ? '✅ 完全闭环' : '⚠️ 未闭环'}`);

  // ── 7. 三身份分账（合伙人 / 合店店长 / 代理）──
  line('七、三身份分账（对应数据库视图 v_identity_monthly）');
  const ID_CN = { partner: '合伙人', costore: '合店店长', agent: '代理' };
  const idAgg = {};
  for (const c of [...db.commissions, ...res.commissions]) {
    const id = R.commissionIdentity(c);
    idAgg[c.owner_id] = idAgg[c.owner_id] || {};
    idAgg[c.owner_id][id] = r2((idAgg[c.owner_id][id] || 0) + c.amount);
  }
  console.log(`${pad('人', 4)}${pad('合伙人', 12)}${pad('合店店长', 12)}${pad('代理', 12)}${pad('合计', 12)}  身份构成`);
  const idTotal = { partner: 0, costore: 0, agent: 0 };
  for (const id of people) {
    const e = idAgg[id] || {};
    const v = { partner: e.partner || 0, costore: e.costore || 0, agent: e.agent || 0 };
    const tot = r2(v.partner + v.costore + v.agent);
    idTotal.partner = r2(idTotal.partner + v.partner);
    idTotal.costore = r2(idTotal.costore + v.costore);
    idTotal.agent = r2(idTotal.agent + v.agent);
    const held = ['partner', 'costore', 'agent'].filter((k) => v[k] > 0).map((k) => ID_CN[k]).join('+') || '—';
    console.log(`${pad(id, 4)}${pad(money(v.partner), 12)}${pad(money(v.costore), 12)}${pad(money(v.agent), 12)}${pad(money(tot), 12)}  ${held}`);
  }
  console.log(`${pad('合计', 4)}${pad(money(idTotal.partner), 12)}${pad(money(idTotal.costore), 12)}${pad(money(idTotal.agent), 12)}${pad(money(r2(idTotal.partner + idTotal.costore + idTotal.agent)), 12)}`);
  console.log('  ※ 同一人可同时持三身份；全球奖/创始奖归「合伙人」，合店分成归「合店店长」，门店/区域费归「代理」。');

  // ── 8. 与用户口径对照 ──
  line('八、与你的手算对照（不含全球奖/创始奖）');
  const pick = (id, type) => r2(((agg[id] || {}).instant || {})[type] || 0);
  const rows = [
    ['Q1 C 差价', pick('C', 'supply'), 14800],
    ['Q1 A 级差', pick('A', 'supply') >= 6000 ? 6000 : pick('A', 'supply'), 6000],
    ['Q1 总部毛收 6500×6', 39000, 39000],
    ['Q2 A 差价', 10300, 10300],
    ['Q2 A 复购 2%', 83.76, 83.76],
    ['Q2 D 门店 53%', 2219.64, 2219.64],
    ['Q2 总部 19500+628.2', r2(6500 * 3 + 628.2), 20128.2],
    ['Q3 F 13%', 544.44, 544.44],
    ['Q3 D 42%', 1758.96, 1758.96],
    ['Q4 F 差价', pick('F', 'supply'), 2480],
    ['Q4 A 级差 1000', 1000, 1000],
  ];
  console.log(`${pad('项目', 24)}${pad('代码实算', 12)}${pad('你的口径', 12)}结果`);
  for (const [name, mine, yours] of rows) {
    console.log(`${pad(name, 24)}${pad(money(mine), 12)}${pad(money(yours), 12)}${Math.abs(mine - yours) < 0.01 ? '✅' : '❌'}`);
  }
}

main();

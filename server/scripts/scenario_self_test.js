/**
 * 自测场景（用户要求：自己编角色、自己算、与用户对照）
 * 区域 R1；全部规则同 2026-10-23 最终口径（门店老板售出才计提门店费 / 合店费按月全平台池 / 三身份分账）
 *
 * 角色与关系：
 *   M  联创（顶层，持创始奖，区域 R1）   ── 卖：天使→N(29800)、VIP→R(9980)
 *   N  天使（M 下级）                    ── 卖：VIP→O(9980)、私董→Q(59800)；F2 的合店推荐人
 *   O  VIP（N 下级）                     ── 无售卖；F2 的合伙人上级
 *   Q  私董（N 下级）                    ── 无售卖
 *   R  VIP（M 下级）                     ── 无售卖
 *   SO 天使 + 门店老板（R1 门店代理，M 下级）── 卖：VIP→T(9980)【门店售出通道】
 *   F2 VIP + 合店老板（O 下级）          ── 缴合店费 4188 入赵店（推荐人 N / 上级 O）
 *   T  VIP（SO 下级）                    ── 无售卖
 *   王省/陈市/李区：R1 省/市/区县代理（被动收取门店服务费 + 合店区域分成）
 *
 * 本月交易（5 笔身份订单 + 1 笔合店）：
 *   O1 N 向 M 买天使 29800（3 VIP）
 *   O2 O 向 N 买 VIP  9980（1 VIP）
 *   O3 Q 向 N 买私董 59800（6 VIP）
 *   O4 R 向 M 买 VIP  9980（1 VIP）
 *   O5 T 向 SO 买 VIP 9980（1 VIP）【门店售出】
 *   CS F2 合店入场 4188（店长 SO / 推荐人 N / 上级 O）
 */
const S = require('../src/store');
const R = require('../src/routes');
const CP = require('../src/costorePlan');
const SET = require('../src/settlement');
const C = require('../src/commission');
const Q = require('../src/quotaLedger');

const PERIOD = '2026-11';
const ENTRY = C.COSTORE_FEE_MONTHLY * 6; // 4188
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const money = (n) => (n === 0 ? '0' : r2(n).toLocaleString('en-US'));
const pad = (s, n) => { let t = String(s); let w = 0; for (const ch of t) w += ch.charCodeAt(0) > 255 ? 2 : 1; while (w < n) { t += ' '; w++; } return t; };
const line = (t) => console.log('\n' + '═'.repeat(96) + '\n' + t + '\n' + '═'.repeat(96));

function build() {
  const db = S.createDb();
  const add = (id, tier, upline_id, extra = {}) => S.addUser(db, { id, name: id, tier, upline_id, ...extra });

  add('M', 'cofounder', null, { is_founding: true, daysSinceCofounder: 0 });
  add('N', 'none', 'M');
  add('O', 'none', 'N');
  add('Q', 'none', 'N');
  add('R', 'none', 'M');
  add('SO', 'angel', 'M');   // 门店代理前置须 ≥ 天使
  add('F2', 'vip', 'O');     // 合店老板须 ≥ VIP
  add('T', 'none', 'SO');
  // 区域代理（被动收取，不在合伙人树内；需先建用户，任命时按规则授予身份）
  add('PA', 'none', null);
  add('CA', 'none', null);
  add('DA', 'none', null);
  S.appointAgent(db, { partnerId: 'PA', regionType: 'province', regionCode: 'R1' });
  S.appointAgent(db, { partnerId: 'CA', regionType: 'city', regionCode: 'R1' });
  S.appointAgent(db, { partnerId: 'DA', regionType: 'district', regionCode: 'R1' });
  S.appointAgent(db, { partnerId: 'SO', regionType: 'store', regionCode: 'R1' });

  // 库存名额
  Q.issueQuota(db.quotaLedger, 'M', 200);
  Q.issueQuota(db.quotaLedger, 'N', 100);
  Q.issueQuota(db.quotaLedger, 'SO', 50);
  return db;
}

function trade(db) {
  const tx = [];
  tx.push({ code: 'O1', desc: 'N 向 M 买「天使」（3 VIP）', order: R.createOrder(db, { buyerId: 'N', packageTier: 'angel', oldTier: 'none', buyerIsNew: true, regionCode: 'R1' }) });
  tx.push({ code: 'O2', desc: 'O 向 N 买「VIP」（1 VIP）', order: R.createOrder(db, { buyerId: 'O', packageTier: 'vip', oldTier: 'none', buyerIsNew: true, regionCode: 'R1' }) });
  tx.push({ code: 'O3', desc: 'Q 向 N 买「私董」（6 VIP）', order: R.createOrder(db, { buyerId: 'Q', packageTier: 'private', oldTier: 'none', buyerIsNew: true, regionCode: 'R1' }) });
  tx.push({ code: 'O4', desc: 'R 向 M 买「VIP」（1 VIP）', order: R.createOrder(db, { buyerId: 'R', packageTier: 'vip', oldTier: 'none', buyerIsNew: true, regionCode: 'R1' }) });
  tx.push({ code: 'O5', desc: 'T 向 SO 买「VIP」（1 VIP）【门店售出】', order: R.createOrder(db, { buyerId: 'T', packageTier: 'vip', oldTier: 'none', buyerIsNew: true, regionCode: 'R1' }) });
  S.addCoStore(db, { id: 'cs_F2', owner_id: 'F2', storeManagerId: 'SO', promoter_id: 'N', upline_id: 'O', fee: ENTRY, store_id: 'SO', joinDate: PERIOD, owners: [{ id: 'F2', performance: 0 }] });
  tx.push({ code: 'CS', desc: 'F2 合店入场 4188（店长 SO / 推荐人 N / 上级 O）', costore: 'cs_F2' });
  return tx;
}

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
    id: cs.id, owner_id: cs.owner_id, storeManagerId: cs.storeManagerId || cs.owner_id,
    promoter_id: cs.promoter_id || null, uplineId: cs.upline_id || null,
    fee: ENTRY, store_id: cs.store_id, joinDate: cs.joinDate,
    ownerCount: cs.ownerCount || 1, owners: cs.owners || [], regionCode: 'R1',
  }));
  const res = SET.settleAll({ period: PERIOD, orders, cofounders, founders, costoreFees, agents: db.regionalAgents, settings, costoreOwners });
  res.cofounders = cofounders;
  return res;
}

const TYPE_CN = { supply: '供货差价', parity: '平级奖', agent: '门店服务费', global: '全球奖', founding: '创始奖', costore: '合店收益' };

function main() {
  const db = build();
  line('自测场景 · 全月实算（2026-11 · 区域 R1）');
  console.log('角色：M 联创(持创始奖)｜N 天使(M下级)｜O VIP(N下级)｜Q 私董(N下级)｜R VIP(M下级)');
  console.log('      SO 天使+门店老板(M下级)｜F2 VIP+合店老板(O下级)｜T VIP(SO下级)');
  console.log('      区域代理：王省(PA省) / 陈市(CA市) / 李区(DA区县) —— 被动收取');

  const tx = trade(db);

  line('一、身份销售台账');
  console.log(`${pad('单', 4)}${pad('摘要', 34)}${pad('实付', 10)}${pad('卖方差价', 10)}${pad('渠道', 9)}${pad('门店费', 8)}${pad('总部费', 9)}`);
  for (const t of tx) {
    if (!t.order) continue;
    const o = t.order;
    console.log(`${pad(t.code, 4)}${pad(t.desc, 34)}${pad(money(o.actual_paid), 10)}${pad(money(o.supply_spread), 10)}${pad(o.channel === 'store' ? '门店售出' : '合伙人', 9)}${pad(money(o.store_fee), 8)}${pad(money(o.hq_fee), 9)}`);
  }
  console.log('\n供货链级差（上级按自己档价拿货、按下级档价卖出）：');
  for (const c of db.commissions.filter((x) => x.type === 'supply')) {
    console.log(`  · ${pad(c.owner_id, 3)} ${pad(money(c.amount), 10)}  ${c.formula || ''}`);
  }

  line('二、合店入场台账（4188 = 698×6）');
  for (const cs of db.coStores) {
    const referrer = { id: cs.promoter_id, isCostoreOwner: db.coStores.some((x) => x.owner_id === cs.promoter_id) };
    const upId = cs.upline_id || null;
    const d = CP.costoreDistribution({ fee: ENTRY, storeManagerId: cs.storeManagerId, referrer, upline: upId ? { id: upId } : null, uplineIsCostoreOwner: db.coStores.some((x) => x.owner_id === upId), provinceId: 'PA', cityId: 'CA', districtId: 'DA' });
    console.log(`\n  ${cs.id}（老板 ${cs.owner_id}，推荐人 ${cs.promoter_id}，上级 ${upId || '无'}，店长 ${cs.storeManagerId}）→ 场景 ${d.scenario.code}`);
    for (const rr of d.byRecipient) console.log(`      ${pad(rr.id, 4)} ${pad(money(rr.amount), 9)}  ${rr.roles.join('+')}`);
  }

  const res = settle(db);

  line('三、月度结算明细');
  const group = {};
  for (const c of res.commissions) (group[c.type] = group[c.type] || []).push(c);
  for (const [type, list] of Object.entries(group)) {
    console.log(`\n  【${TYPE_CN[type] || type}】合计 ${money(list.reduce((s, c) => s + c.amount, 0))}`);
    for (const c of list) console.log(`    · ${pad(c.owner_id, 4)} ${pad(money(c.amount), 10)} ${c.note ? '｜' + c.note : ''}${c.region_type ? '｜' + c.region_type : ''}`);
  }
  console.log('\n  联创标注：');
  for (const c of res.cofounders) console.log(`    · ${pad(c.id, 3)} 本人VIP ${pad(c.ownVip, 3)} 团队VIP ${pad(c.teamVip, 3)} 入联创天数 ${c.daysSinceCofounder} 权重 ${c.ownVip + c.teamVip}`);
  console.log(`  全球奖池 = 150 × 总VIP ${res.summary.totalVip} = ${money(res.summary.globalPool)}`);

  const people = ['M', 'N', 'O', 'Q', 'R', 'SO', 'F2', 'T', 'PA', 'CA', 'DA'];
  const agg = {};
  for (const c of db.commissions) { agg[c.owner_id] = agg[c.owner_id] || { instant: {}, settle: {} }; agg[c.owner_id].instant[c.type] = r2((agg[c.owner_id].instant[c.type] || 0) + c.amount); }
  for (const c of res.commissions) { agg[c.owner_id] = agg[c.owner_id] || { instant: {}, settle: {} }; agg[c.owner_id].settle[c.type] = r2((agg[c.owner_id].settle[c.type] || 0) + c.amount); }

  line('四、每人本月收入');
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

  const hqFee = r2(db.orders.reduce((s, o) => s + o.hq_fee, 0));
  const storePaid = r2(db.orders.reduce((s, o) => s + (o.store_fee || 0), 0));
  const poolPaid = r2(res.commissions.filter((c) => c.type === 'global' || c.type === 'founding').reduce((s, c) => s + c.amount, 0));
  const costoreHq = r2(res.commissions.filter((c) => c.type === 'costore' && c.owner_id === 'HQ').reduce((s, c) => s + c.amount, 0));
  const storeVip = db.orders.filter((o) => o.channel === 'store').reduce((s, o) => s + (o.quotaCount || 0), 0);
  const partnerVip = r2(res.summary.totalVip - storeVip);

  line('五、总部本月收益');
  console.log(`  身份销售总底价（6500 × ${res.summary.totalVip}）          = ${money(6500 * res.summary.totalVip)}`);
  console.log(`    ├─ 门店服务费（门店渠道 ${storeVip} 名额 × 3000）     = ${money(storePaid)}`);
  console.log(`    └─ 总部留存（门店 3500×${storeVip} + 合伙人 6500×${money(partnerVip)}）= ${money(hqFee)}`);
  console.log(`  减：全球奖 ${money(150 * res.summary.totalVip)} + 创始奖 ${money(res.commissions.filter((c) => c.type === 'founding').reduce((s, c) => s + c.amount, 0))} = ${money(poolPaid)}`);
  console.log(`  加：合店费总部 15%                    = ${money(costoreHq)}`);
  const hqNet = r2(hqFee - poolPaid + costoreHq);
  console.log(`  总部净留存                              = ${money(hqNet)}`);

  const collected = r2(db.orders.reduce((s, o) => s + (o.actual_paid != null ? o.actual_paid : 0), 0) + db.coStores.length * ENTRY);
  line('六、资金闭环');
  console.log(`  本月实收 = 订单 ${money(db.orders.reduce((s, o) => s + (o.actual_paid != null ? o.actual_paid : 0), 0))} + 合店 ${money(db.coStores.length * ENTRY)} = ${money(collected)}`);
  console.log(`  支出     = 用户合计 ${money(peopleTotal)} + 总部净留存 ${money(hqNet)} = ${money(r2(peopleTotal + hqNet))}`);
  const gap = r2(collected - peopleTotal - hqNet);
  console.log(`  差额     = ${money(gap)} ${gap === 0 ? '✅ 完全闭环' : '⚠️ 未闭环'}`);

  line('七、三身份分账');
  const ID_CN = { partner: '合伙人', costore: '合店店长', agent: '代理' };
  const idAgg = {};
  for (const c of [...db.commissions, ...res.commissions]) { const id = R.commissionIdentity(c); idAgg[c.owner_id] = idAgg[c.owner_id] || {}; idAgg[c.owner_id][id] = r2((idAgg[c.owner_id][id] || 0) + c.amount); }
  console.log(`${pad('人', 4)}${pad('合伙人', 12)}${pad('合店店长', 12)}${pad('代理', 12)}${pad('合计', 12)}`);
  const idTotal = { partner: 0, costore: 0, agent: 0 };
  for (const id of people) {
    const e = idAgg[id] || {};
    const v = { partner: e.partner || 0, costore: e.costore || 0, agent: e.agent || 0 };
    idTotal.partner = r2(idTotal.partner + v.partner); idTotal.costore = r2(idTotal.costore + v.costore); idTotal.agent = r2(idTotal.agent + v.agent);
    console.log(`${pad(id, 4)}${pad(money(v.partner), 12)}${pad(money(v.costore), 12)}${pad(money(v.agent), 12)}${pad(money(r2(v.partner + v.costore + v.agent)), 12)}`);
  }
  console.log(`${pad('合计', 4)}${pad(money(idTotal.partner), 12)}${pad(money(idTotal.costore), 12)}${pad(money(idTotal.agent), 12)}${pad(money(r2(idTotal.partner + idTotal.costore + idTotal.agent)), 12)}`);
}

main();

/**
 * 身份体系校验（2026-10-23：合伙人/区域代理/合店老板可同时持有，收益分离）
 *
 * 覆盖：
 *   ① commissionIdentity 映射（product 按 subtype 细分：partner_product→合伙人，链级差→代理）
 *   ② getIdentities：单身份/双身份/三身份用户的身份列表与各身份当月收益
 *   ③ getCommissions?identity=：按身份过滤，各身份收益之和 = 总收益（不重不漏）
 *   ④ 身份切换的兜底：代理被撤后身份列表不含 agent
 */
const S = require('../src/store');
const R = require('../src/routes');

let pass = 0, fail = 0;
function eq(label, actual, expected) {
  const ok = typeof expected === 'number' ? Math.abs(actual - expected) < 0.01 : actual === expected;
  if (ok) { pass++; console.log(`  ✓ ${label} = ${actual}`); }
  else { fail++; console.log(`  ✗ ${label} 实际=${actual} 期望=${expected}`); }
}
function ok(label, cond, extra) {
  if (cond) { pass++; console.log(`  ✓ ${label}${extra ? ' ' + extra : ''}`); }
  else { fail++; console.log(`  ✗ ${label}${extra ? ' ' + extra : ''}`); }
}
function head(t) { console.log(`\n===== ${t} =====`); }

/** 三身份用户：联创合伙人 + 单店代理(D1) + 合店老板(D1-S1) */
function buildDb() {
  const db = S.createDb();
  S.addUser(db, { id: 'p1', tier: 'cofounder', phone: '1' });              // 上级合伙人
  S.addUser(db, { id: 'pa', tier: 'cofounder', phone: '2', upline_id: 'p1' }); // 三身份用户
  S.addUser(db, { id: 'p4', tier: 'vip', phone: '4', upline_id: 'pa' });   // pa 的下级（购买产品）
  S.addUser(db, { id: 'p5', tier: 'private', phone: '5' });
  S.appointAgent(db, { partnerId: 'p5', regionType: 'district', regionCode: 'D1' });
  S.appointAgent(db, { partnerId: 'pa', regionType: 'store', regionCode: 'D1' });
  S.addCoStore(db, { owner_id: 'pa', promoter_id: 'p1', storeManagerId: 'pa', store_id: 'D1-S1', monthly_fee: 698, ownerCount: 1, joinDate: '2026-10', owners: [{ id: 'pa', performance: 500 }] });
  return db;
}

head('① commissionIdentity：单笔佣金归属身份');
{
  eq('供应差价 → partner', R.commissionIdentity({ type: 'supply' }), 'partner');
  eq('平级奖 → partner', R.commissionIdentity({ type: 'parity' }), 'partner');
  // 注：直推奖(direct)/复购奖(rebuy) 不再由身份销售产生（2026-10-23 规则；仅产品提成/代理技术费含直推），
  //     历史 direct 佣金经默认兜底仍归入 partner，避免旧库数据丢失。
  eq('全球奖 → partner', R.commissionIdentity({ type: 'global' }), 'partner');
  eq('产品提成 partner_product → partner', R.commissionIdentity({ type: 'product', subtype: 'partner_product' }), 'partner');
  eq('固定链级差 chain_store → agent', R.commissionIdentity({ type: 'product', subtype: 'chain_store' }), 'agent');
  eq('特色分成 featured_hq → agent', R.commissionIdentity({ type: 'product', subtype: 'featured_hq' }), 'agent');
  eq('行政费 admin_ownStore → agent', R.commissionIdentity({ type: 'product', subtype: 'admin_ownStore' }), 'agent');
  eq('任命提成 type=agent → agent', R.commissionIdentity({ type: 'agent', subtype: 'agbiz' }), 'agent');
  eq('区域奖 region_vip → agent', R.commissionIdentity({ type: 'region_vip' }), 'agent');
  eq('合店费 → costore', R.commissionIdentity({ type: 'costore' }), 'costore');
  eq('合店·区域分成 region_costore → agent', R.commissionIdentity({ type: 'costore', subtype: 'region_costore' }), 'agent');
  eq('合店·上级直推奖 costore_upline_direct → partner', R.commissionIdentity({ type: 'costore', subtype: 'costore_upline_direct' }), 'partner');
  eq('合店·上级复购奖 costore_upline_repurchase → partner', R.commissionIdentity({ type: 'costore', subtype: 'costore_upline_repurchase' }), 'partner');
  eq('合店·门店服务 costore_store_service → costore', R.commissionIdentity({ type: 'costore', subtype: 'costore_store_service' }), 'costore');
  eq('合店·店长兜底直推 costore_store_direct → costore', R.commissionIdentity({ type: 'costore', subtype: 'costore_store_direct' }), 'costore');
  eq('合店·店长兜底复购 costore_store_repurchase → costore', R.commissionIdentity({ type: 'costore', subtype: 'costore_store_repurchase' }), 'costore');
}

head('② 三身份用户：身份列表齐全');
{
  const db = buildDb();
  // 造三笔收益：合伙人产品提成（p4 买 Pad，上级 pa 联创 15%）、代理链级差（chain_store 归 pa）、合店分红
  R.createProductOrder(db, { buyerId: 'p4', productKey: 'pad', qty: 1, regionCode: 'D1' });
  S.pushCommission(db, { owner_id: 'pa', type: 'costore', amount: 69.8, period: R.periodOf(), status: 'pending' });
  const r = R.getIdentities(db, 'pa');
  const keys = r.identities.map((x) => x.key);
  eq('身份数 = 3', keys.length, 3);
  ok('含 partner', keys.includes('partner'));
  ok('含 agent', keys.includes('agent'));
  ok('含 costore', keys.includes('costore'));
  eq('agent 详情 = 单店代理 · D1', r.identities.find((x) => x.key === 'agent').detail, '单店代理 · D1');
  ok('costore 详情含门店', r.identities.find((x) => x.key === 'costore').detail.includes('D1-S1'));

  // 收益分离：合伙人身份只有 partner_product；代理身份只有 chain_*；合店身份只有 costore
  const p = r.identities.find((x) => x.key === 'partner');
  const a = r.identities.find((x) => x.key === 'agent');
  const c = r.identities.find((x) => x.key === 'costore');
  eq('合伙人收益 = 产品提成 837.6', p.month_income, 837.6);
  ok('合伙人 by_type 只有 product', Object.keys(p.by_type).length === 1 && p.by_type.product === 837.6);
  eq('代理收益 = 门店级差 1256.4', a.month_income, 1256.4);
  ok('代理 by_type 只有 product', Object.keys(a.by_type).length === 1 && a.by_type.product === 1256.4);
  eq('合店老板收益 = 69.8', c.month_income, 69.8);
  ok('合店 by_type 只有 costore', Object.keys(c.by_type).length === 1 && c.by_type.costore === 69.8);
  eq('三身份合计 = 837.6+1256.4+69.8 = 2163.8', r.total_month_income, 2163.8);
}

head('③ getCommissions?identity=：过滤不重不漏');
{
  const db = buildDb();
  R.createProductOrder(db, { buyerId: 'p4', productKey: 'pad', qty: 1, regionCode: 'D1' });
  S.pushCommission(db, { owner_id: 'pa', type: 'costore', amount: 69.8, period: R.periodOf(), status: 'pending' });
  const all = R.getCommissions(db, 'pa', {});
  const p = R.getCommissions(db, 'pa', { identity: 'partner' });
  const a = R.getCommissions(db, 'pa', { identity: 'agent' });
  const c = R.getCommissions(db, 'pa', { identity: 'costore' });
  eq('全量笔数 = 3（产品提成+门店级差+合店）', all.list.length, 3);
  eq('合伙人身份笔数 = 1（产品提成；售卖合伙人无直推奖）', p.list.length, 1);
  eq('代理身份笔数 = 1（门店级差）', a.list.length, 1);
  eq('合店身份笔数 = 1', c.list.length, 1);
  eq('三身份金额之和 = 全量合计', p.total + a.total + c.total, all.total);
  eq('全量合计 = 837.6+1256.4+69.8 = 2163.8（不含直推奖）', all.total, 2163.8);
}

head('④ 单/双身份用户');
{
  const db = S.createDb();
  S.addUser(db, { id: 'q1', tier: 'vip', phone: '11' });                       // 纯合伙人
  S.addUser(db, { id: 'q2', tier: 'angel', phone: '12' });                     // 合伙人+代理
  S.appointAgent(db, { partnerId: 'q2', regionType: 'district', regionCode: 'D2' });
  S.addUser(db, { id: 'q3', tier: 'angel', phone: '13' });                     // 合伙人+合店老板
  S.addCoStore(db, { owner_id: 'q3', promoter_id: null, storeManagerId: 'q3', store_id: 'D3-S1', monthly_fee: 698, ownerCount: 1, joinDate: '2026-10', owners: [{ id: 'q3', performance: 100 }] });
  eq('纯合伙人：1 个身份', R.getIdentities(db, 'q1').identities.length, 1);
  const q2 = R.getIdentities(db, 'q2').identities.map((x) => x.key);
  eq('合伙人+代理：2 个身份', q2.length, 2);
  ok('含 partner+agent', q2.includes('partner') && q2.includes('agent'));
  const q3 = R.getIdentities(db, 'q3').identities.map((x) => x.key);
  ok('合伙人+合店：含 partner+costore', q3.includes('partner') && q3.includes('costore'));
  eq('普通用户也有合伙人身份（基础账户）', R.getIdentities(db, 'q1').identities[0].key, 'partner');
}

head('⑤ 兜底：代理身份被撤后不再出现');
{
  const db = buildDb();
  const before = R.getIdentities(db, 'pa').identities.map((x) => x.key);
  ok('撤代理前含 agent', before.includes('agent'));
  db.regionalAgents = db.regionalAgents.filter((x) => x.partner_id !== 'pa');
  const after = R.getIdentities(db, 'pa').identities.map((x) => x.key);
  ok('撤代理后不含 agent', !after.includes('agent'));
  eq('撤代理后剩 2 个身份', after.length, 2);
}

console.log(`\n${'='.repeat(50)}`);
console.log(`通过 ${pass} / 失败 ${fail}`);
console.log('='.repeat(50));
process.exit(fail > 0 ? 1 : 0);

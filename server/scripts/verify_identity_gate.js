/**
 * 身份编号 + 权益门禁专项验证（2026-10-24）
 * 覆盖：编号派生（前缀/四位起步/变宽/不截断）、惰性过期、
 *       pushCommission/upsertCommission 收口门禁（过期停算/未开通照算）、
 *       runSettlement 集成（过期联创全球奖+创始奖停算、过期上级直推奖停算）、
 *       升级/任命后编号重算、开通后续号。
 * 运行：node scripts/verify_identity_gate.js
 */
const assert = require('assert');
const S = require('../src/store');
const R = require('../src/routes');
const IZ = require('../src/identity');

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('  ok  ' + name); } else { fail++; console.log('  FAIL ' + name); } };

// ───────────── 1. 编号派生 ─────────────
console.log('\n[1] 编号派生');
ok('普通用户 → YH', IZ.prefixOf({ tier: 'none' }) === 'YH');
ok('VIP → VIP', IZ.prefixOf({ tier: 'vip' }) === 'VIP');
ok('天使 → TS', IZ.prefixOf({ tier: 'angel' }) === 'TS');
ok('私董 → SD', IZ.prefixOf({ tier: 'private' }) === 'SD');
ok('联创 → LC', IZ.prefixOf({ tier: 'cofounder' }) === 'LC');
ok('未开通覆盖一切等级 → QZ', IZ.prefixOf({ tier: 'cofounder', entitlement_state: 'never_paid' }) === 'QZ');
ok('过期覆盖一切等级 → QZ', IZ.prefixOf({ tier: 'vip', entitlement_state: 'expired' }) === 'QZ');
ok('四位起步 0001', IZ.displayIdOf({ tier: 'angel', seq: 1 }) === 'TS0001');
ok('第 10000 名不截断（前缀+10000）', IZ.displayIdOf({ tier: 'cofounder', seq: 10000 }) === 'LC10000');
ok('第 9999 名仍四位', IZ.displayIdOf({ tier: 'private', seq: 9999 }) === 'SD9999');
ok('存量无权益字段 → active（向后兼容）', IZ.entitlementState({ tier: 'vip' }) === 'active');

// ───────────── 2. 惰性过期 ─────────────
console.log('\n[2] 惰性过期');
ok('active 未到期 → active', IZ.entitlementState({ entitlement_state: 'active', entitlement_expires_at: Date.now() + 86400000 }) === 'active');
ok('active 已过期 → expired', IZ.entitlementState({ entitlement_state: 'active', entitlement_expires_at: Date.now() - 1000 }) === 'expired');
ok('gatePayload：过期 → frozen+可导出', (() => { const g = IZ.gatePayload({ entitlement_state: 'expired' }); return g && g.frozen === true && g.canExportBills === true && g.entitlementAmount === 200; })());
ok('gatePayload：未开通 → 不冻结不可导出', (() => { const g = IZ.gatePayload({ entitlement_state: 'never_paid' }); return g && g.frozen === false && g.canExportBills === false; })());
ok('gatePayload：active → null（无门禁）', IZ.gatePayload({ entitlement_state: 'active' }) === null);

// ───────────── 3. 佣金收口门禁 ─────────────
console.log('\n[3] pushCommission / upsertCommission 门禁');
{
  const db = S.createDb();
  S.addUser(db, { id: 'expired_u', tier: 'cofounder', entitlement_state: 'expired' });
  S.addUser(db, { id: 'never_u', tier: 'cofounder', entitlement_state: 'never_paid' });
  S.addUser(db, { id: 'active_u', tier: 'vip', entitlement_state: 'active' });
  const r1 = S.pushCommission(db, { id: 'c1', owner_id: 'expired_u', type: 'global', amount: 100 });
  const r2 = S.pushCommission(db, { id: 'c2', owner_id: 'never_u', type: 'global', amount: 50 });
  const r3 = S.pushCommission(db, { id: 'c3', owner_id: 'active_u', type: 'global', amount: 30 });
  ok('过期用户 → 不入账（返回 null）', r1 === null && !db.commissions.some((c) => c.owner_id === 'expired_u'));
  ok('未开通用户 → 照常入账（挂着）', r2 && db.commissions.some((c) => c.id === 'c2'));
  ok('正常用户 → 照常入账', r3 && db.commissions.some((c) => c.id === 'c3'));
  const u1 = S.upsertCommission(db, { id: 'c4', owner_id: 'expired_u', type: 'founding', amount: 17.5 });
  ok('upsertCommission 同样拦截过期', u1 === null && !db.commissions.some((c) => c.id === 'c4'));
  // 过期前的既有记录保留（可导出）
  S.pushCommission(db, { id: 'c5', owner_id: 'active_u', type: 'direct', amount: 20 });
  db.users.active_u.entitlement_state = 'expired';
  S.pushCommission(db, { id: 'c6', owner_id: 'active_u', type: 'direct', amount: 99 });
  ok('过期前已入账记录保留', db.commissions.some((c) => c.id === 'c5') && !db.commissions.some((c) => c.id === 'c6'));
}

// ───────────── 4. runSettlement 集成 ─────────────
console.log('\n[4] runSettlement 集成（过期停算）');
function buildDb() {
  const db = S.createDb();
  S.addUser(db, { id: 'boss', tier: 'cofounder', teamVip: 2, daysSinceCofounder: 0, entitlement_state: 'active' });
  S.addUser(db, { id: 'newbie', tier: 'vip', upline_id: 'boss' });
  db.quotaLedger.boss = 100; // 上级备货（下单扣上级名额）
  return db;
}
{
  const db = buildDb();
  R.createOrder(db, { buyerId: 'newbie', packageTier: 'vip', rawQuota: 1, buyerIsNew: true });
  const before = db.commissions.filter((c) => c.owner_id === 'boss');
  ok('正常态：上级有直推奖入账', before.length > 0);
  const res = R.runSettlement(db, { period: '2026-10' });
  const bossAll = db.commissions.filter((c) => c.owner_id === 'boss');
  ok('正常态：联创有全球奖/创始奖', bossAll.some((c) => c.type === 'global' || c.type === 'founding'));
}
{
  const db = buildDb();
  db.users.boss.entitlement_state = 'expired'; // 权益过期
  R.createOrder(db, { buyerId: 'newbie', packageTier: 'vip', rawQuota: 1, buyerIsNew: true });
  R.runSettlement(db, { period: '2026-10' });
  const bossAll = db.commissions.filter((c) => c.owner_id === 'boss');
  ok('过期态：直推奖+全球奖+创始奖全部停算', bossAll.length === 0);
}
{
  // 惰性过期：active 但 expires_at 已过 → 同样停算
  const db = buildDb();
  db.users.boss.entitlement_expires_at = Date.now() - 86400000;
  R.createOrder(db, { buyerId: 'newbie', packageTier: 'vip', rawQuota: 1, buyerIsNew: true });
  R.runSettlement(db, { period: '2026-10' });
  ok('惰性过期同样停算', db.commissions.filter((c) => c.owner_id === 'boss').length === 0);
}
{
  // 从未开通：收益照算（挂着不可见）
  const db = buildDb();
  db.users.boss.entitlement_state = 'never_paid';
  R.createOrder(db, { buyerId: 'newbie', packageTier: 'vip', rawQuota: 1, buyerIsNew: true });
  R.runSettlement(db, { period: '2026-10' });
  ok('从未开通：收益照常入账', db.commissions.filter((c) => c.owner_id === 'boss').length > 0);
}

// ───────────── 5. 编号随状态重算 ─────────────
console.log('\n[5] 升级/任命/开通后编号重算');
{
  const db = S.createDb();
  const u = S.addUser(db, { id: 'g1', tier: 'none', entitlement_state: 'never_paid' });
  ok('注册未开通 → QZ0001', u.display_id === 'QZ0001');
  IZ.grantEntitlement(db, 'g1');
  ok('开通后 → YH0001', db.users.g1.display_id === 'YH0001');
  S.updatePartner(db, 'g1', { tier: 'angel' });
  ok('升级天使 → TS0001', db.users.g1.display_id === 'TS0001');
  db.users.g1.entitlement_expires_at = Date.now() - 1000; // 惰性过期
  ok('过期 → 重算回落 QZ0001', IZ.recomputeDisplayId(db, 'g1') === 'QZ0001');
  IZ.grantEntitlement(db, 'g1'); // 续费
  ok('续费 → TS0001', db.users.g1.display_id === 'TS0001');
  S.appointAgent(db, { partnerId: 'g1', regionType: 'district', regionCode: 'D1' }); // 区县代 → 私董
  ok('任命区县代（升私董）→ SD0001', db.users.g1.display_id === 'SD0001');
}
{
  // 序号连续分配（第二位 = 0002）
  const db = S.createDb();
  S.addUser(db, { id: 'a', tier: 'none' });
  S.addUser(db, { id: 'b', tier: 'none' });
  ok('序号连续：0001 / 0002', db.users.a.display_id === 'YH0001' && db.users.b.display_id === 'YH0002');
}

console.log(`\n身份编号与权益门禁: PASS=${pass} FAIL=${fail}`);
process.exit(fail ? 1 : 0);

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildWholesaleBootstrap } = require('../src/routes/h5');

function fixture() {
  const now = Date.now();
  return {
    users: {
      root: { id: 'root', display_id: 'LC0001', name: '联创', phone: '13800000001', tier: 'cofounder', daysSinceCofounder: 30, directPushedVip: 1, upline_id: null },
      direct: { id: 'direct', display_id: 'VIP0002', name: '直推会员', phone: '13900000002', tier: 'vip', upline_id: 'root' },
      indirect: { id: 'indirect', display_id: 'TS0003', name: '团队成员', phone: '13700000003', tier: 'angel', upline_id: 'direct' },
      member: { id: 'member', display_id: 'YH0004', name: '普通成员', phone: '13600000004', tier: 'none', upline_id: 'root' },
    },
    orders: [{ buyer_id: 'direct', seller_id: 'root', oldTier: 'none', packageTier: 'vip', vipCredit: 1, status: 'PAID' }],
    quotaLedger: { root: { standard: 2, activity: [{ qty: 3, obtainedAt: now - 1000, expireAt: now + 86400000 }] } },
  };
}

test('bootstrap aggregates global award, superior/team and VIP details with authorized full phone fields', () => {
  const data = buildWholesaleBootstrap(fixture(), 'root', 'active');
  assert.equal(data.globalAwardEligibility.eligible, true);
  assert.equal(data.globalAwardEligibility.tierEligible, true);
  assert.equal(data.globalAwardEligibility.directPushedVipCount, 1);
  assert.equal(data.superior, null);
  assert.deepEqual(data.team.summary, { memberCount: 3, directMemberCount: 2, teamVipCount: 1 });
  assert.deepEqual(data.team.members.map((member) => member.depth), [1, 2, 1]);
  assert.equal(data.team.members[0].phone, '13900000002');
  assert.equal(data.team.members[0].phoneMasked, '139****0002');
  assert.equal(JSON.stringify(data).includes('13900000002'), true);
  assert.equal(data.vipDetails.remainingCount, 5);
  assert.equal(data.vipDetails.standardRemaining, 2);
  assert.equal(data.vipDetails.activityRemaining, 3);
  assert.equal(data.vipDetails.activityBatches.length, 1);
  assert.deepEqual(data.vipDetails.teamVipMembers.map((member) => member.id), ['direct', 'indirect']);
});

test('bootstrap explains ineligible global award states and resolves the direct superior', () => {
  const db = fixture();
  db.users.direct.daysSinceCofounder = 91;
  db.users.direct.directPushedVip = 0;
  const data = buildWholesaleBootstrap(db, 'direct', 'active');
  assert.equal(data.superior.id, 'root');
  assert.equal(data.superior.phone, '13800000001');
  assert.equal(data.superior.phoneMasked, '138****0001');
  assert.equal(data.globalAwardEligibility.eligible, false);
  assert.equal(data.globalAwardEligibility.tierEligible, false);
  assert.equal(data.globalAwardEligibility.reason, '当前非联创合伙人');
});


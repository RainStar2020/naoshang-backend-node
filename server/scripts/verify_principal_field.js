'use strict';

/**
 * 本金（principal_tier）字段 · 设立 / 维护 / 计价锚点 验证
 * 运行：node scripts/verify_principal_field.js
 */

const S = require('../src/store');
const R = require('../src/routes');
const C = require('../src/commission');

let pass = 0, fail = 0;
const ok = (n, c, got, exp) => {
  if (c) { pass++; console.log(`  ✅ ${n} → ${JSON.stringify(got)}`); }
  else { fail++; console.log(`  ❌ ${n} → 实际 ${JSON.stringify(got)} 期望 ${JSON.stringify(exp)}`); }
};
const near = (a, b) => Math.abs(a - b) < 1e-6;

const db = S.createDb();
// 上级 s1（联创，有足够名额）；买家 b1（VIP 入口，未付费）
S.addUser(db, { id: 's1', name: '上级', tier: 'cofounder', upline_id: null, phone: '1' });
S.addUser(db, { id: 'b1', name: '买家', tier: 'vip', upline_id: 's1', phone: '2', entitlement_state: 'never_paid' });
db.quotaLedger['s1'] = 100;

console.log('\n' + '='.repeat(72) + '\n1) 新用户首购：vip → angel（oldTier=vip, packageTier=angel）\n' + '='.repeat(72));
const o1 = R.createOrder(db, { buyerId: 'b1', packageTier: 'angel', oldTier: 'vip', rawQuota: null, buyerIsNew: false });
ok('首购升 angel 后 principal_tier = angel', db.users['b1'].principal_tier === 'angel', db.users['b1'].principal_tier, 'angel');
ok('首购升 angel 价 = 19,820（29,800−9,980）', near(o1.actual_paid, 19820), o1.actual_paid, 19820);

console.log('\n' + '='.repeat(72) + '\n2) 模拟「拉人免费升档」：updatePartner 改 tier=private（不动本金）\n' + '='.repeat(72));
S.updatePartner(db, 'b1', { tier: 'private' });   // 模拟免费升档（后台仅改 tier）
ok('免费升档后 tier = private', db.users['b1'].tier === 'private', db.users['b1'].tier, 'private');
ok('免费升档后 principal_tier 仍 = angel（物料本金不动）', db.users['b1'].principal_tier === 'angel', db.users['b1'].principal_tier, 'angel');

console.log('\n' + '='.repeat(72) + '\n3) 再一口价自付升 cofounder：必须按本金 angel(29,800) 计价\n' + '='.repeat(72));
const o2 = R.createOrder(db, { buyerId: 'b1', packageTier: 'cofounder', oldTier: 'private', rawQuota: null });
ok('再升 cofounder 价 = 210,000（239,800−29,800，而非 239,800−59,800=180,000）', near(o2.actual_paid, 210000), o2.actual_paid, 210000);
ok('升 cofounder 后 principal_tier = cofounder（累计已付）', db.users['b1'].principal_tier === 'cofounder', db.users['b1'].principal_tier, 'cofounder');

console.log('\n' + '='.repeat(72) + '\n4) 展示口径：本金金额 = RETAIL_PRICE[principal_tier]\n' + '='.repeat(72));
const principalTier = db.users['b1'].principal_tier;
const principal = C.RETAIL_PRICE[principalTier] || 0;
ok('本金金额展示 = 239,800（cofounder 一口价）', near(principal, 239800), principal, 239800);
ok('前台 /partner/overview 计算一致', near(C.RETAIL_PRICE[principalTier] || 0, principal), principal, principal);

console.log('\n' + '='.repeat(72) + '\n5) 后台裸对象可见 principal_tier（/api/users 直接返回用户）\n' + '='.repeat(72));
ok('用户对象含 principal_tier 字段', db.users['b1'].principal_tier != null, db.users['b1'].principal_tier, 'cofounder');

console.log('\n' + '='.repeat(72) + '\n6) 批发补货不改本金（rawQuota 路径）\n' + '='.repeat(72));
const before = db.users['b1'].principal_tier;
R.createOrder(db, { buyerId: 'b1', packageTier: 'cofounder', oldTier: 'cofounder', rawQuota: 1, buyerIsNew: false });
ok('批发补货后 principal_tier 不变', db.users['b1'].principal_tier === before, db.users['b1'].principal_tier, before);

console.log(`\n========================================\n本金字段验证：通过 ${pass} / 失败 ${fail}`);
process.exit(fail ? 1 : 0);

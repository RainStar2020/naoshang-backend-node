/**
 * 用户 2026-10-24 平级奖口径验证：平级奖从「供货上级」级差中扣（非额外出账）。
 * 场景（用户原话）：天使 A 下级为天使 B，B 找 A 买名额；A 与 B 拿货价都是 7500 → A 不赚钱；
 *   A 的上级为联创 C（A 找 C 买，A 7500 买、C 6500 买、卖给 A 按 A 拿货价 7500 → C 赚 1000）；
 *   平级奖 = C 的拿货价 6500 × 2% × 名额个数，从 C 的 1000 级差里扣，发给 A。
 *
 * 运行：node scripts/verify_parity_user_example.js
 */
const S = require('../src/store');
const R = require('../src/routes');
const C = require('../src/commission');
const Q = require('../src/quotaLedger');
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function buildDb() {
  const db = S.createDb();
  // C 联创（链顶，向总部进货），A 天使（上级 C），B 天使（上级 A）
  S.addUser(db, { id: 'C', name: 'C联创', phone: '1', tier: 'cofounder', upline_id: null });
  S.addUser(db, { id: 'A', name: 'A天使', phone: '2', tier: 'angel', upline_id: 'C' });
  S.addUser(db, { id: 'B', name: 'B天使', phone: '3', tier: 'angel', upline_id: 'A' });
  // 上级需有足够名额
  db.quotaLedger['C'] = 999;
  db.quotaLedger['A'] = 999;
  return db;
}

let ok = true;
const assert = (name, cond, got, expect) => {
  if (cond) console.log(`  ✅ ${name} → ${JSON.stringify(got)}`);
  else { ok = false; console.log(`  ❌ ${name} → 实际 ${JSON.stringify(got)}，期望 ${JSON.stringify(expect)}`); }
};

for (const need of [1, 3]) {
  console.log(`\n════════ 名额数 need=${need} ════════`);
  const db = buildDb();
  const before = db.commissions.length;
  const r = R.createOrder(db, { buyerId: 'B', packageTier: 'angel', oldTier: 'angel', rawQuota: need });
  const fresh = db.commissions.slice(before);

  console.log(`  实付 ${r.actual_paid}（= 天使拿货价 7500 × ${need}）`);
  for (const c of fresh) {
    const nm = db.users[c.owner_id].name;
    console.log(`    ${c.owner_id} ${nm.padEnd(6)} [${c.type}] ${String(c.amount).padStart(8)}  ${c.formula || ''}`);
  }

  const supply = (id) => fresh.filter((c) => c.owner_id === id && c.type === 'supply').reduce((s, c) => s + c.amount, 0);
  const parity = (id) => fresh.filter((c) => c.owner_id === id && c.type === 'parity').reduce((s, c) => s + c.amount, 0);

  const expectParity = round2(6500 * 0.02 * need);          // 130 × need
  const expectCgross = round2((7500 - 6500) * need);         // 1000 × need（C 原始级差）
  const expectCnet = round2(expectCgross - expectParity);     // 870 × need

  assert('A 平级奖 = 6500×2%×need', Math.abs(parity('A') - expectParity) < 1e-9, parity('A'), expectParity);
  assert('A 供货差价 = 0（与 B 同级不赚钱）', Math.abs(supply('A') - 0) < 1e-9, supply('A'), 0);
  assert(`C 供货差价净额 = 1000×need − 平级奖 = ${expectCnet}`, Math.abs(supply('C') - expectCnet) < 1e-9, supply('C'), expectCnet);
  assert('C 原始级差 1000×need 全部分配', Math.abs(supply('C') + parity('A') - expectCgross) < 1e-9, supply('C') + parity('A'), expectCgross);
  // 闭环：买家实付 = A平级奖 + C级差净额 + 总部底价(6500×need，落在 hq_fee)
  assert('闭环：A平级奖 + C级差净额 + 总部费 = 实付',
    Math.abs(supply('A') + supply('C') + parity('A') + r.hq_fee - r.actual_paid) < 1e-9,
    supply('A') + supply('C') + parity('A') + r.hq_fee, r.actual_paid);
}

console.log(`\n总结果 → ${ok ? '✅ 全部 PASS（平级奖已从供货上级 C 级差中扣，非额外出账）' : '❌ 有失败'}`);
process.exit(ok ? 0 : 1);

/**
 * quotaLedger 冒烟：模拟 总部→联创→下级 的名额流转（电梯逐级）
 */
const { issueQuota, consumeQuota, getBalance, sellQuota } = require('../src/quotaLedger');

let ok = true;
function assert(name, cond, got) {
  const pass = !!cond;
  ok = ok && pass;
  console.log(`  ${pass ? '✅' : '❌'} ${name} → ${got}`);
}

console.log('===== VIP 名额账本冒烟 =====');
const ledger = {};

// 1) 总部向联创 A 下发 100 个名额
issueQuota(ledger, 'A', 100);
assert('总部下发后 A 余额', getBalance(ledger, 'A') === 100, getBalance(ledger, 'A'));

// 2) A 向下级卖出 20 个天使档名额（原始名额售卖）
const r1 = sellQuota({ ledger, sellerId: 'A', downlineTier: 'angel', rawQuota: 20 });
assert('A 卖 20 名额后余额', getBalance(ledger, 'A') === 80, getBalance(ledger, 'A'));
assert('本次扣减名额', r1.need === 20, r1.need);

// 3) A 再卖 20 个私董档名额
const r2 = sellQuota({ ledger, sellerId: 'A', downlineTier: 'private', rawQuota: 20 });
assert('A 再卖 20 后余额', getBalance(ledger, 'A') === 60, getBalance(ledger, 'A'));

// 4) 整包升级：下级从 普通 升 私董，需消耗 vipCredit(none,private)=6
const r3 = sellQuota({ ledger, sellerId: 'A', downlineTier: 'private', oldTier: 'none', rawQuota: null });
assert('普通→私董 扣 6 名额', r3.need === 6, r3.need);
assert('A 余额', getBalance(ledger, 'A') === 54, getBalance(ledger, 'A'));

// 5) 余额不足：A 只剩 54，试图卖 100 → 应抛错
let threw = false;
try { sellQuota({ ledger, sellerId: 'A', downlineTier: 'vip', rawQuota: 100 }); }
catch (e) { threw = true; }
assert('余额不足正确拒绝', threw === true, threw);

// 6) A 向上级(总部)补货 50，再卖
issueQuota(ledger, 'A', 50);
assert('补货后 A 余额', getBalance(ledger, 'A') === 104, getBalance(ledger, 'A'));

console.log('\n配额账本总结果 →', ok ? '✅ 全部 PASS' : '❌ 有失败');
process.exit(ok ? 0 : 1);

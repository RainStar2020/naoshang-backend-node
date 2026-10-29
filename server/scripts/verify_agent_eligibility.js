/**
 * 代理资格与身份授予规则校验（2026-10-22 用户澄清）
 * 两种语义：
 *  ① 门店代理(store) = 前置门槛：tier ≥ angel；不赠身份
 *  ② 区县/市/省(district/city/province) = 身份授予：开通即赠 私董/联创；仅升不降
 */
const S = require('../src/store');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  ✅', name); }
  else { fail++; console.log('  ❌', name); }
}

const db = S.createDb();
S.addUser(db, { id: 'vip1',  tier: 'vip',  phone: '1' });
S.addUser(db, { id: 'ang1',  tier: 'angel', phone: '2' });
S.addUser(db, { id: 'priv1', tier: 'private', phone: '3' });
S.addUser(db, { id: 'cof1',  tier: 'cofounder', phone: '4' });
S.addUser(db, { id: 'vip2',  tier: 'vip',  phone: '5' }); // 未被升档，专测门店门槛

console.log('\n=== 1. validateAgentEligibility 门槛校验 ===');
check('VIP 申请门店代理 → 拒绝（需天使）',
  S.validateAgentEligibility('vip', 'store').ok === false);
check('天使 申请门店代理 → 通过，不赠身份',
  S.validateAgentEligibility('angel', 'store').ok === true &&
  S.validateAgentEligibility('angel', 'store').grantTier === null);
check('私董 申请门店代理 → 通过（≥angel）',
  S.validateAgentEligibility('private', 'store').ok === true);
check('VIP 申请区县代理 → 通过（开通即赠）',
  S.validateAgentEligibility('vip', 'district').ok === true &&
  S.validateAgentEligibility('vip', 'district').grantTier === 'private');
check('天使 申请省代理 → 通过，赠联创',
  S.validateAgentEligibility('angel', 'province').grantTier === 'cofounder');
check('非法代理类型 → 拒绝',
  S.validateAgentEligibility('angel', 'xyz').ok === false);

console.log('\n=== 2. appointAgent 身份升档（仅升不降） ===');
// VIP → 区县代理：身份升私董
let r1 = S.appointAgent(db, { partnerId: 'vip1', regionType: 'district' });
check('VIP 开区县代理 → tier 升为 private',
  r1.user.tier === 'private' && r1.granted === 'private');
check('区县代理 granted_tier = private', r1.agent.granted_tier === 'private');

// 天使 → 省代理：身份升联创
let r2 = S.appointAgent(db, { partnerId: 'ang1', regionType: 'province' });
check('天使 开省代理 → tier 升为 cofounder',
  r2.user.tier === 'cofounder' && r2.granted === 'cofounder');

// 联创 → 市代理：保持联创（不降级）
let r3 = S.appointAgent(db, { partnerId: 'cof1', regionType: 'city' });
check('联创 开市代理 → tier 保持 cofounder（不降级）',
  r3.user.tier === 'cofounder' && r3.granted === null);

// 门店代理：天使先升，再开门店（门槛）
let r4 = S.appointAgent(db, { partnerId: 'ang1', regionType: 'store' });
check('天使 开门店代理 → 通过，tier 不变（不赠身份）',
  r4.user.tier === 'cofounder' && r4.granted === null && r4.agent.granted_tier === null);

// 门店代理门槛：从未升档的 VIP 直接开门店 → 抛错
let threw = false;
try { S.appointAgent(db, { partnerId: 'vip2', regionType: 'store' }); }
catch (e) { threw = true; }
check('VIP（未升档）直接开门店代理 → 抛错（需先天使）', threw === true);

console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===`);
process.exit(fail === 0 ? 0 : 1);

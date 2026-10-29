/**
 * 校验用户 2026-10-22 确认的「名额↔身份 / 升级名额」规则：
 * - 各档每名额拿货价：联创6500 私董6980 天使7500 vip7980
 * - 1名额=1VIP，3名额=1天使，6名额=1私董，24名额=1联创
 * - 升级名额：被升人=普通用户→用目标档全额；被升人=合伙人→目标档名额−现身份名额
 */
const C = require('../src/commission');
let ok = true;
function check(name, got, exp) {
  const pass = got === exp;
  if (!pass) ok = false;
  console.log(`${pass ? '✅' : '❌'} ${name}: 得 ${got} (期望 ${exp})`);
}

console.log('— 各档每名额拿货价 —');
check('联创', C.WHOLESALE_PER_QUOTA.cofounder, 6500);
check('私董', C.WHOLESALE_PER_QUOTA.private, 6980);
check('天使', C.WHOLESALE_PER_QUOTA.angel, 7500);
check('vip', C.WHOLESALE_PER_QUOTA.vip, 7980);

console.log('\n— 名额↔身份 —');
check('1名额=1VIP', C.TIER_VIP.vip, 1);
check('3名额=1天使', C.TIER_VIP.angel, 3);
check('6名额=1私董', C.TIER_VIP.private, 6);
check('24名额=1联创', C.TIER_VIP.cofounder, 24);

console.log('\n— 升级名额(增量=vipCredit) —');
check('普通→VIP', C.vipCredit('none', 'vip'), 1);
check('普通→天使', C.vipCredit('none', 'angel'), 3);
check('普通→私董', C.vipCredit('none', 'private'), 6);
check('普通→联创', C.vipCredit('none', 'cofounder'), 24);
check('天使→私董(合伙人升级)', C.vipCredit('angel', 'private'), 3);   // 6-3
check('天使→联创(合伙人升级)', C.vipCredit('angel', 'cofounder'), 21); // 24-3
check('私董→联创(合伙人升级)', C.vipCredit('private', 'cofounder'), 18); // 24-6

console.log('\n— 供货差价(梯队转移价, supplySpread) —');
check('联创供1名额天使档', C.supplySpread('cofounder', 'angel', 1), 7500 - 6500);     // 1000
check('联创供1名额私董档', C.supplySpread('cofounder', 'private', 1), 6980 - 6500);   // 480
check('联创供1名额VIP档', C.supplySpread('cofounder', 'vip', 1), 7980 - 6500);       // 1480
check('天使升私董(联创供3名额)', C.supplySpread('cofounder', 'private', C.vipCredit('angel','private')), (6980-6500)*3); // 1440

console.log('\n' + (ok ? '🎉 全部规则校验通过' : '⚠️ 有失败项'));

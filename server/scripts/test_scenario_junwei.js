/**
 * 测试场景（用户确认口径，2026-10-22）：
 * 我是「联创 + 十大元帅」，平台共 5 个联创。
 * 本月我向绑定下级供货：天使档 20 个 VIP 名额 + 私董档 20 个 VIP 名额
 * （注：名额=原始 VIP 配额单位，不是 20 个天使包=60 名额）。
 * 本月全平台 VIP 名额共 1000 个。
 * 求：我本月可获利多少。
 *
 * 确认规则：
 * 1) 差价 = 梯队转移价：下级档拿货价 − 我的档拿货价，× 名额数。
 * 2) 全球奖业绩权重 = 原始名额数（20+20=40），不做天使=3/私董=6 折算。
 * 3) 5 个联创本月均合格（无责期或直推≥1），平分全球奖均分那一半。
 * 4) 十大元帅创始奖 = 3500 × 0.5% × 全平台当月 VIP 数。
 * 5) 直推奖不计入（卖的是合伙人供货，非普通用户/线下店）。
 */
const C = require('../src/commission');

const me = 'cofounder';
const angelQuotas = 20, privateQuotas = 20;   // 原始 VIP 名额单位
const totalPlatformVip = 1000;
const totalCofounders = 5;

// ── 1) 合伙人供货差价（梯队转移价）──
const angelSpread = C.supplySpread(me, 'angel', angelQuotas);     // (7500-6500)*20
const privateSpread = C.supplySpread(me, 'private', privateQuotas); // (6980-6500)*20
const spreadProfit = angelSpread + privateSpread;

// ── 2) 全球奖（业绩权重 = 原始名额数）──
const myWeight = angelQuotas + privateQuotas; // 40
const othersVip = totalPlatformVip - myWeight; // 960
const perOther = othersVip / (totalCofounders - 1);
const cofounders = [{ id: 'ME', ownVip: myWeight, teamVip: 0, daysSinceCofounder: 999, directPushedVip: 1 }];
for (let i = 1; i < totalCofounders; i++) {
  cofounders.push({ id: 'C' + i, ownVip: perOther, teamVip: 0, daysSinceCofounder: 999, directPushedVip: 1 });
}
const gb = C.computeGlobalBonus(cofounders, { vipUnit: 150, wuzheDays: 90 });
const myGlobal = gb.perCofounder.find(p => p.id === 'ME').total;

// ── 3) 十大元帅创始奖 ──
const founderAward = C.HQ_PRODUCT_FEE_PER_VIP * 0.005 * totalPlatformVip; // 17.5*1000

const total = spreadProfit + myGlobal + founderAward;

console.log('================ 测试场景结果（确认口径） ================');
console.log('【口径】名额=原始VIP单位；差价=梯队转移价；权重=40');
console.log('');
console.log('① 合伙人供货差价（我是联创拿货价6500/名额）');
console.log('   天使档 20 名额 = (7500-6500)×20 =', angelSpread);
console.log('   私董档 20 名额 = (6980-6500)×20 =', privateSpread);
console.log('   → 小计 =', spreadProfit);
console.log('');
console.log('② 全球奖（池=150×1000=', gb.pool, '）');
console.log('   均分一半', gb.halfEqual, '÷ 合格联创', gb.qualifiedCount, '=', gb.perCofounder[0].equal, '(我)');
console.log('   业绩一半', gb.halfPerf, '× 我的权重', myWeight, '/总', totalPlatformVip, '=', gb.perCofounder[0].perf, '(我)');
console.log('   → 我的全球奖 =', myGlobal);
console.log('');
console.log('③ 十大元帅创始奖 = 3500×0.5%×1000 =', founderAward);
console.log('');
console.log('══════════════════════════════════════════');
console.log('📊 本月我可获利总计 =', total, '元');
console.log('   组成：差价', spreadProfit, ' + 全球奖', myGlobal, ' + 创始奖', founderAward);
console.log('');
console.log('【校验】全球奖池拆分闭环：', gb.halfEqual, '+', gb.halfPerf, '=', gb.halfEqual + gb.halfPerf, '= 池', gb.pool);
console.log('【校验】5 联创全球奖之和 =', gb.perCofounder.reduce((s,p)=>s+p.total,0), '(应=', gb.pool, ')');

/**
 * 测试场景（用户 2026-10-22 提问）：
 *   身份 = 联创（拿货价 6500/VIP）
 *   排名 = 前十名（十大元帅 / marshal，创始奖 0.5%）
 *   联创总数 = 5
 *   本月卖 50 个 VIP 名额：20 卖给天使下级（7500/VIP），30 卖给私董下级（6980/VIP）
 *   全平台当月总 VIP = 500
 *
 * 目标：用 commission.js / settlement.js 真实函数算出「我（该联创）本月获利」。
 */
const C = require('../src/commission');
const SET = require('../src/settlement');

const SELLER = 'cofounder';        // 卖方的档（联创）
const TOTAL_VIP = 500;             // 全平台当月总 VIP
const COFOUNDER_COUNT = 5;         // 联创个数
const PERIOD = '2026-10';

// ───────── 1. 供应差价（电梯规则下的梯队转移价，确定） ─────────
const spreadAngel = C.supplySpread(SELLER, 'angel', 20);     // (7500-6500)*20
const spreadPrivate = C.supplySpread(SELLER, 'private', 30); // (6980-6500)*30
const supply = C.round2(spreadAngel + spreadPrivate);

// ───────── 2. 创始奖（永久，按人各得全额；2026-10-22 15:18 修正） ─────────
// 规则：总部每卖 1 个 VIP：
//   拥有创始奖的联创 → 3500 × 0.5% = 17.5 / VIP
//   每位私董         → 3500 × 0.1% = 3.5  / VIP
// 每人 = 费率 × 3500 × 全平台VIP（按人各得，不拆分）
const COFOUNDER_FOUNDING_RATE = C.FOUNDING_RATE.cofounder; // 0.005
const PRIVATE_FOUNDING_RATE = C.FOUNDING_RATE.private;     // 0.001
const foundingMe = C.round2(C.HQ_PRODUCT_FEE_PER_VIP * COFOUNDER_FOUNDING_RATE * TOTAL_VIP); // 联创本人 8750
const foundingPerPrivate = C.round2(C.HQ_PRODUCT_FEE_PER_VIP * PRIVATE_FOUNDING_RATE * TOTAL_VIP); // 每位私董 1750

// ───────── 3. 全球奖（一半均分 + 一半按团队权重） ─────────
// 3a. 均分那一半（仅合格联创）：
//     合格条件 = 无责期(≤90天) 或 当月直推VIP≥1。本人直推50 → 合格。
//     假设：5 名联创均合格 → 均分 = (150*500)/2 / 5 = 37500/5 = 7500
const pool = C.GLOBAL_UNIT * TOTAL_VIP;           // 75000
const halfEqual = pool / 2;                        // 37500
const equalPerCofounder = halfEqual / COFOUNDER_COUNT; // 7500（假设5人均合格）

// 3b. 业绩那一半（需其他联创的团队权重）—— 给出「典型假设」估算 + 公式
// 假设：全平台 500 名额全部归属这 5 条联创子树（权重和=500）；
//       本人权重 = ownVip 50（仅直推，teamVip 暂按 0 计）。
//       → 本人业绩 = (150*500)/2 × (50/500) = 37500 × 0.1 = 3750
const userWeightTypical = 50;
const weightSumTypical = 500;
const perfMeTypical = C.round2((pool / 2) * (userWeightTypical / weightSumTypical)); // 3750

// 用真实函数跑一遍（把本人 + 其余4人按典型假设补全，仅为演示本人结果）
// 其余4名联创权重合计补到 450，使全部联创权重和=500（与「本人 50 / 总 500」假设一致）
const cofoundersTypical = [
  { id: 'ME', ownVip: 50, teamVip: 0, daysSinceCofounder: 10, directPushedVip: 50 },
  { id: 'C2', ownVip: 200, teamVip: 0, daysSinceCofounder: 10, directPushedVip: 200 },
  { id: 'C3', ownVip: 120, teamVip: 0, daysSinceCofounder: 10, directPushedVip: 120 },
  { id: 'C4', ownVip: 90, teamVip: 0, daysSinceCofounder: 10, directPushedVip: 90 },
  { id: 'C5', ownVip: 40, teamVip: 0, daysSinceCofounder: 10, directPushedVip: 40 },
];
const gb = SET.runGlobalBonus(PERIOD, cofoundersTypical, TOTAL_VIP);
const gbMe = gb.perCofounder.find((p) => p.id === 'ME');

// ───────── 汇总 ─────────
console.log('================ 测试场景：联创 / 十大元帅 / 卖50名额 ================');
console.log('【1】供应差价（确定）');
console.log('   天使20名额: (7500-6500)*20 =', spreadAngel);
console.log('   私董30名额: (6980-6500)*30 =', spreadPrivate);
console.log('   → 供应差价合计 =', supply);
console.log('');
console.log('【2】创始奖（永久·按人各得全额，2026-10-22 修正）');
console.log('   联创本人(持有创始奖): 3500 × 0.5% × 500 =', foundingMe);
console.log('   每位私董(全员):       3500 × 0.1% × 500 =', foundingPerPrivate, '（算法已修正：此前漏算私董档）');
console.log('');
console.log('【3】全球奖');
console.log('   奖池 = 150×500 =', pool, '（均分半', halfEqual, '+ 业绩半', halfEqual, '）');
console.log('   均分半/人（假设5人均合格）=', C.round2(equalPerCofounder));
console.log('   业绩半本人（典型假设 权重50/500）=', perfMeTypical);
console.log('   → 真实函数跑（其余4人按典型假设补全）：');
console.log('      本人 global.equal =', gbMe.equal, ' perf =', gbMe.perf, ' total =', gbMe.total);
console.log('');
console.log('================ 本人本月获利（典型假设下） ================');
const totalTypical = C.round2(supply + foundingMe + gbMe.total);
console.log('   供应差价', supply, '+ 创始奖', foundingMe, '+ 全球奖', gbMe.total, '=');
console.log('   → 合计 ≈', totalTypical, '元');
console.log('');
console.log('⚠️ 确定项：供应差价 + 创始奖 =', C.round2(supply + foundingMe), '元（不依赖他人数据）');
console.log('⚠️ 条件项：全球奖业绩半需其他4名联创的团队权重；上表按「全平台500名额归属5条联创子树、本人权重=50」估算。');

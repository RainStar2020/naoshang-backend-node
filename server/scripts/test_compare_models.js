/**
 * 对照：我的模型（commission.js 当前） vs 用户手算模型
 * 场景：联创+十大元帅，平台5联创，本月卖天使20单位+私董20单位，全平台VIP=1000
 */
const C = require('../src/commission');

const totalVip = 1000, cofCount = 5;

// ── 模型A：我当前 commission.js（零售口径差价 + VIP折算权重）──
const aAngel = C.wholesalerProfit('cofounder', 'angel') * 20;     // 10300*20
const aPrivate = C.wholesalerProfit('cofounder', 'private') * 20; // 20800*20
const aSpread = aAngel + aPrivate;
const aWeight = C.vipCredit('none','angel')*20 + C.vipCredit('none','private')*20; // 3*20+6*20=180
const aGb = C.computeGlobalBonus(
  [{id:'ME',ownVip:aWeight,teamVip:0,daysSinceCofounder:999,directPushedVip:1},
   ...[1,2,3,4].map(i=>({id:'C'+i,ownVip:(totalVip-aWeight)/4,teamVip:0,daysSinceCofounder:999,directPushedVip:1}))],
  {vipUnit:150,wuzheDays:90});
const aGlobal = aGb.perCofounder[0].total;
const aFounder = C.HQ_PRODUCT_FEE_PER_VIP * 0.005 * totalVip;
const aTotal = aSpread + aGlobal + aFounder;

// ── 模型B：用户手算（梯队转移价差价 + 原始名额权重）──
// 差价：天使 (7500-6500)*20；私董 (6980-6500)*20
const bSpread = (7500-6500)*20 + (6980-6500)*20; // 29600
// 全球奖：均分 1000*150/2/5；业绩 1000*150/2 * 40/1000
const bEqual = 1000*150/2/5;        // 15000
const bPerf  = 1000*150/2 * 40/1000; // 3000
const bGlobal = bEqual + bPerf;     // 18000
const bFounder = 17.5 * 1000;       // 17500
const bTotal = bSpread + bGlobal + bFounder;

console.log('──────── 模型A（我当前 commission.js）────────');
console.log('差价利润：天使', aAngel, '+ 私董', aPrivate, '=', aSpread);
console.log('全球奖  ：均分', aGb.perCofounder[0].equal, '+ 业绩', aGb.perCofounder[0].perf, '(权重', aWeight, ')=', aGlobal);
console.log('创始奖  ：', aFounder);
console.log('合计    ：', aTotal);

console.log('──────── 模型B（你手算）────────');
console.log('差价利润：天使', (7500-6500)*20, '+ 私董', (6980-6500)*20, '=', bSpread);
console.log('全球奖  ：均分', bEqual, '+ 业绩', bPerf, '(权重 40)=', bGlobal);
console.log('创始奖  ：', bFounder);
console.log('合计    ：', bTotal);

console.log('──────── 差异拆解 ────────');
console.log('差价利润差：', aSpread - bSpread, '（零售口径 vs 梯队转移价）');
console.log('全球奖差  ：', aGlobal - bGlobal, '（权重 180 vs 40）');
console.log('总差      ：', aTotal - bTotal);

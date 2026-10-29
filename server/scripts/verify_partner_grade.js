'use strict';

/**
 * 合伙人收益逻辑 · 逐条复现用户口述算例
 * 数据来源：用户 2026-10-23 微信口述 + 批发商业绩表截图
 *
 * 运行：node scripts/verify_partner_grade.js
 */

const G = require('../src/partnerGrade');

let pass = 0, fail = 0;
const ok = (name, cond, got, expect) => {
  if (cond) { pass++; console.log(`  ✅ ${name} → ${JSON.stringify(got)}`); }
  else { fail++; console.log(`  ❌ ${name} → 实际 ${JSON.stringify(got)}，期望 ${JSON.stringify(expect)}`); }
};
const near = (a, b) => Math.abs(a - b) < 1e-6;
const line = (t) => console.log('\n' + '='.repeat(76) + '\n' + t + '\n' + '='.repeat(76));

// ═══════════════════ 0. 档位表校验（对齐图1） ═══════════════════
line('0. 四档等级表（对齐图1 批发商业绩表）');
console.log('  档位      名额   标价        拿货单价     拿货合计     利润         比例');
for (const r of G.gradeTable()) {
  console.log(`  ${r.tier.padEnd(10)} ${String(r.quota).padStart(2)}  ${String(r.price).padStart(9)}  ${String(r.costUnit).padStart(9)}  ${String(r.costTotal).padStart(10)}  ${String(r.profit).padStart(9)}  ${(r.ratio * 100).toFixed(1)}%`);
}
const T = G.gradeTable();
ok('VIP 拿货 7980×1 = 7980，利润 2000', near(T[0].costTotal, 7980) && near(T[0].profit, 2000), T[0].profit, 2000);
ok('天使 拿货 7500×3 = 22500，利润 7300', near(T[1].costTotal, 22500) && near(T[1].profit, 7300), T[1].profit, 7300);
ok('私董 拿货 6980×6 = 41880，利润 17920', near(T[2].costTotal, 41880) && near(T[2].profit, 17920), T[2].profit, 17920);
ok('联创 拿货 6500×24 = 156000，利润 83800', near(T[3].costTotal, 156000) && near(T[3].profit, 83800), T[3].profit, 83800);
ok('比例 20% / 24.5% / 30% / 35%',
  near(T[0].ratio, 0.2004) && near(T[1].ratio, 0.2450) && near(T[2].ratio, 0.2997) && near(T[3].ratio, 0.3495),
  T.map((x) => (x.ratio * 100).toFixed(1) + '%'), null);

// ═══════════════════ 1. 用户算例①：普通用户买 VIP，上级联创 ═══════════════════
line('1. 算例① 普通用户买 VIP（1 名额），直接上级 = 联创');
const c1 = G.distributeTrade({
  buyerTier: 'user', targetTier: 'vip', quota: 1, payAmount: 9980,
  uplineChain: [{ id: 'Z', tier: 'cofounder' }],
});
console.log('   链: 普通用户 → Z(联创) → 总部');
for (const l of c1.layers) console.log(`   ${l.sellerName.padEnd(18)} 收入 ${String(l.income).padStart(7)}  成本 ${String(l.cost).padStart(7)}  利润 ${String(l.profit).padStart(7)}  | ${l.formula}`);
ok('联创收益 = 9980 − 6500 = 3480', near(c1.layers[0].profit, 3480), c1.layers[0].profit, 3480);
ok('总部收益 = 6500 − 6500 = 0', near(c1.layers[1].profit, 0), c1.layers[1].profit, 0);
ok('无平级奖（普通用户无拿货价）', c1.parity.awards.length === 0, c1.parity.total, 0);

// ═══════════════════ 2. 用户算例②：VIP 升天使，上级联创（升级付全款） ═══════════════════
line('2. 算例② VIP 升天使（补 2 名额，付全款），直接上级 = 联创');
{
  const pay = G.upgradePayable({ fromTier: 'vip', toTier: 'angel' });
  const r = G.distributeTrade({
    buyerTier: 'vip', targetTier: 'angel', quota: pay.quota, payAmount: pay.amount,
    uplineChain: [{ id: 'Z', tier: 'cofounder' }],
  });
  console.log(`   名额 ${pay.quota}  买家付全款 ${pay.amount}  → 联创收益 ${r.layers[0].profit}`);
  console.log(`   公式：${r.layers[0].formula}`);
  ok('升级付全款 29800 − 6500×2 = 16800', near(r.layers[0].profit, 16800), r.layers[0].profit, 16800);
  ok('升级身份无平级奖（卖方必吃差价）', r.parity.awards.length === 0, r.parity.total, 0);
}

// ═══════════════════ 3. 用户算例③：VIP 升天使，上级私董，再上级联创（升级付全款） ═══════════════════
line('3. 算例③ VIP 升天使（补 2 名额，付全款），上级 = 私董 → 联创');
{
  const pay = G.upgradePayable({ fromTier: 'vip', toTier: 'angel' });
  const r = G.distributeTrade({
    buyerTier: 'vip', targetTier: 'angel', quota: pay.quota, payAmount: pay.amount,
    uplineChain: [{ id: 'C', tier: 'private' }, { id: 'D', tier: 'cofounder' }],
  });
  console.log(`   名额 ${pay.quota}  买家付全款 ${pay.amount}`);
  for (const l of r.layers) console.log(`      ${l.sellerName.padEnd(18)} 收入 ${String(l.income).padStart(7)}  成本 ${String(l.cost).padStart(7)}  利润 ${String(l.profit).padStart(7)}  | ${l.formula}`);
  ok('私董 = 29800 − 6980×2 = 15840', near(r.layers[0].profit, 15840), r.layers[0].profit, 15840);
  ok('联创 = 6980×2 − 6500×2 = 960', near(r.layers[1].profit, 960), r.layers[1].profit, 960);
  ok('升级身份无平级奖', r.parity.awards.length === 0, r.parity.total, 0);
}

// ═══════════════════ 4. 平级奖三场景（只发一份给 A，由其供货上级从级差中扣） ═══════════════════
line('4. 平级奖（用户三个算例，各 1 份给 A；出资方 = A 的供货上级）');
const REPOST = (title, chain, expectAwards, expectEach) => {
  const r = G.parityAwards({ buyerTier: 'angel', uplineChain: chain, quota: 1 });
  console.log(`\n   ── ${title} ──`);
  console.log(`   链: 天使(买家) → ${chain.map((x) => `${x.id}(${x.tier})`).join(' → ')} → 总部`);
  console.log(`   基数 = 出资上级(供货上级) ${r.baseTier} 的拿货价 ${r.baseUnit}，每名额 2% = ${r.perQuota}`);
  if (!r.awards.length) console.log('   （无平级奖）');
  for (const a of r.awards) console.log(`   → ${a.recipientId}(${a.recipientName}) 得 ${a.amount}  | ${a.pair} | ${a.formula}`);
  ok(`${title}：平级奖 ${expectAwards} 份，每份 ${expectEach} 元`,
    r.awards.length === expectAwards && r.awards.every((a) => near(a.amount, expectEach)),
    { 份数: r.awards.length, 金额: r.awards.map((a) => a.amount), 合计: r.total },
    { 份数: expectAwards, 每份: expectEach });
  return r;
};

const p1 = REPOST('场景1 B(天使)←A(天使)←C(私董)←D(联创)',
  [{ id: 'A', tier: 'angel' }, { id: 'C', tier: 'private' }, { id: 'D', tier: 'cofounder' }], 1, 139.6);
ok('  场景1 收款人 = A（天使）', p1.awards[0].recipientId === 'A', p1.awards[0].recipientId, 'A');
ok('  场景1 出资方 = A 的供货上级 C（私董 6980）', p1.awards[0].supplierId === 'C' && near(p1.deductions['C'], 139.6),
  { supplierId: p1.awards[0].supplierId, 扣除: p1.deductions['C'] }, { supplierId: 'C', 扣除: 139.6 });

const p2 = REPOST('场景2 B(天使)←A(天使)←Z(联创)',
  [{ id: 'A', tier: 'angel' }, { id: 'Z', tier: 'cofounder' }], 1, 130);
ok('  场景2 收款人 = A（天使）', p2.awards[0].recipientId === 'A', p2.awards[0].recipientId, 'A');
ok('  场景2 出资方 = A 的供货上级 Z（联创 6500，非总部吸收）', p2.awards[0].supplierId === 'Z' && near(p2.deductions['Z'], 130),
  { supplierId: p2.awards[0].supplierId, 扣除: p2.deductions['Z'] }, { supplierId: 'Z', 扣除: 130 });

const p3 = REPOST('场景3 B(天使)←A(天使)←F(联创)←E(联创)',
  [{ id: 'A', tier: 'angel' }, { id: 'F', tier: 'cofounder' }, { id: 'E', tier: 'cofounder' }], 1, 130);
ok('  场景3 收款人 = 仅 A（F/E 同级不再发奖）', p3.awards.map((a) => a.recipientId).join(',') === 'A', p3.awards.map((a) => a.recipientId), ['A']);
ok('  场景3 合计 130（修正前误算 260）', near(p3.total, 130), p3.total, 130);
ok('  场景3 出资方 = F（E 同级但为链顶无供货上级→不发）', p3.awards[0].supplierId === 'F' && near(p3.deductions['F'], 130),
  { supplierId: p3.awards[0].supplierId, 扣除: p3.deductions['F'] }, { supplierId: 'F', 扣除: 130 });
ok('  场景3 E 无扣款（无资金来源）', !p3.deductions['E'], p3.deductions['E'], undefined);

// 平级奖与级差合并看：场景3 完整分配（B 补 1 个名额，价 7500，不算升级）
line('5. 场景3 完整分配（B 补 1 个名额，价 7500，不算升级）');
const c5 = G.distributeTrade({
  buyerTier: 'angel', targetTier: 'angel', quota: 1, payAmount: 7500,
  uplineChain: [{ id: 'A', tier: 'angel' }, { id: 'F', tier: 'cofounder' }, { id: 'E', tier: 'cofounder' }],
});
console.log(`   买家付 ${c5.payAmount}，名额 ${c5.quota}`);
for (const l of c5.layers) console.log(`   ${l.sellerName.padEnd(18)} 收入 ${String(l.income).padStart(7)}  成本 ${String(l.cost).padStart(7)}  利润 ${String(l.profit).padStart(7)}  ${l.formula}`);
console.log(`   平级奖：${c5.parity.awards.map((a) => `${a.recipientId} ${a.amount}（从 ${a.supplierId} 级差扣）`).join(' / ')}，合计 ${c5.parity.total}`);
ok('A 级差 0（7500−7500）', near(c5.layers[0].profit, 0), c5.layers[0].profit, 0);
ok('F 级差 870（原始 1000 − 平级奖 130，从 F 级差扣）', near(c5.layers[1].profit, 870), c5.layers[1].profit, 870);
ok('E 级差 0（6500−6500）', near(c5.layers[2].profit, 0), c5.layers[2].profit, 0);
ok('平级奖 仅 A 130（修正前误算 260）', near(c5.parity.total, 130), c5.parity.total, 130);
ok('平级奖预算中性：级差合计 + 平级奖 = 原始级差 1000', near(c5.totals.sellerProfit + c5.totals.parityTotal, 1000),
  { 级差合计: c5.totals.sellerProfit, 平级奖: c5.totals.parityTotal, 合计: c5.totals.sellerProfit + c5.totals.parityTotal }, 1000);
ok('闭环成立：实付 7500 = 总部成本 6500 + 级差合计 870 + 平级奖 130', c5.totals.closure === true, c5.totals.closure, true);

// ═══════════════════ 6. 升级方式换算 ═══════════════════
line('6. 升级方式（截图3 补差价 + 图2 拉人达标）');

const byPay = G.upgradeByPay({ fromTier: 'private', toTier: 'cofounder', paidTotal: 79800 });
console.log(`   A. 补差价直升：已缴 ${byPay.paidTotal}，联创标准价 ${byPay.targetPrice} → 需补 ${byPay.needPay}`);
ok('截图3 算例：239800 − 79800 = 160000', near(byPay.needPay, 160000), byPay.needPay, 160000);
ok('补差价后初始金额 = 239800', byPay.initialAmountAfter === 239800, byPay.initialAmountAfter, 239800);

const vip2Private = G.upgradeByPay({ fromTier: 'vip', toTier: 'private' });
console.log(`   A. VIP 升私董：已缴 ${vip2Private.paidTotal} → 需补 ${vip2Private.needPay}`);
// ⚠️ 用户口算为 50000，实际 59800 − 9980 = 49820（差 180，疑似把 9980 记成 9800）
ok('用户第3段口径：59800 − 9980 = 49820', near(vip2Private.needPay, 49820), vip2Private.needPay, 49820);
console.log(`      ↳ 你口算的 50000 与系统值 49820 差 180：59800−9980=49820，若按 9800 算才是 50000`);

console.log('\n   B. 拉人达标（1联创=4私董=8天使=24VIP，需 3 个本级）');
for (const [from, to] of [['vip', 'angel'], ['angel', 'private'], ['private', 'cofounder']]) {
  const base = G.upgradeByReferral({ fromTier: from, toTier: to, referrals: [] });
  console.log(`      ${from} → ${to}：需直推 ${base.needQuota} 名额`);
}
ok('VIP→天使 需 3 名额', G.upgradeByReferral({ fromTier: 'vip', toTier: 'angel' }).needQuota === 3, 3, 3);
ok('天使→私董 需 9 名额', G.upgradeByReferral({ fromTier: 'angel', toTier: 'private' }).needQuota === 9, 9, 9);
ok('私董→联创 需 18 名额', G.upgradeByReferral({ fromTier: 'private', toTier: 'cofounder' }).needQuota === 18, 18, 18);

const r18vip = G.upgradeByReferral({ fromTier: 'private', toTier: 'cofounder', referrals: [{ tier: 'vip', count: 18 }] });
console.log(`      私董拉 18 个 VIP → ${r18vip.note}，初始金额仍为 ${r18vip.initialAmountAfter}`);
ok('私董升联创：拉 18 VIP 达标', r18vip.ok === true, r18vip.gotQuota, 18);

const r6angel = G.upgradeByReferral({ fromTier: 'private', toTier: 'cofounder', referrals: [{ tier: 'angel', count: 6 }] });
ok('私董升联创：拉 6 天使 = 18 名额 达标', r6angel.ok === true, r6angel.gotQuota, 18);

const r3private = G.upgradeByReferral({ fromTier: 'private', toTier: 'cofounder', referrals: [{ tier: 'private', count: 3 }] });
ok('私董升联创：拉 3 个私董 = 18 名额 达标（图2「3 个本级」）', r3private.ok === true, r3private.gotQuota, 18);

const rNotOk = G.upgradeByReferral({ fromTier: 'private', toTier: 'cofounder', referrals: [{ tier: 'angel', count: 4 }] });
ok('私董拉 4 天使 = 12 名额 未达标（差 6）', rNotOk.ok === false && rNotOk.gapQuota === 6, { got: rNotOk.gotQuota, gap: rNotOk.gapQuota }, { got: 12, gap: 6 });
ok('拉人升级不改初始金额（仍 59800）', rNotOk.initialAmountAfter === 59800, rNotOk.initialAmountAfter, 59800);

// ═══════════════════ 7. 复购奖（下级购任意产品，直接上级按实付 2%） ═══════════════════
line('7. 复购奖 2%');
const rb = G.repurchaseBonus({ paid: 7800, downlineId: 'B', uplineId: 'A' });
console.log(`   下级 B 购产品实付 ${rb.paid} → 直接上级 A 得 ${rb.amount}  | ${rb.formula}`);
ok('实付 7800 × 2% = 156（发给直接上级 A）', near(rb.amount, 156), rb.amount, 156);
ok('收款人 = 直接上级 A', rb.uplineId === 'A', rb.uplineId, 'A');

const rb2 = G.repurchaseBonus({ paid: 5000, downlineId: 'C', uplineId: 'Z' });
ok('下级购任意产品 实付 5000 × 2% = 100', near(rb2.amount, 100), rb2.amount, 100);

// ═══════════════════ 汇总 ═══════════════════
line('总结果');
console.log(`  PASS ${pass} 条 / FAIL ${fail} 条 → ${fail === 0 ? '✅ 全部通过' : '❌ 有失败'}`);
process.exit(fail === 0 ? 0 : 1);

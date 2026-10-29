/**
 * 用户 2026-10-22 规则校验（v3 修正版 —— 按方案图「合店费分配」重写合店部分）：
 *  1) 平级奖：逐层按"该上级自己的供货上级拿货价 × 2% × 名额数"
 *  2) 区域代理提成（销售额 / 利润额 可配）
 *  3) 合店费：总部35%(总部15+省2+市8+区县10) + 门店股东65%(①服务40% + ②利润25%)
 *     ②利润25% = A、(13%个人部分+2%合伙人奖) 个人所属 + B、10% 分红池
 *     三场景：S1 推荐人=门店老板本人→55%；S2 推荐人=其他合伙人→门店老板53%+推荐人2%；
 *             S3 推荐人=合店老板→门店老板40%+推荐人15%
 *     多人门店：提点按老板人数均分（55%/2=27.5%）
 */
const {
  parityBonusCascade, regionAgentCommission,
  coStoreOwnerDetail, coStoreProfitBreakdown, coStorePartnerDividend, coStorePartnerBonus,
  coStoreFeeAllocation, coStoreAgentCommission, COSTORE_FEE_MONTHLY,
} = require('../src/commission');

let ok = true;
const assert = (name, cond, got) => { ok = ok && !!cond; console.log(`  ${cond ? '✅' : '❌'} ${name} → ${JSON.stringify(got)}`); };

console.log('===== 1) 平级奖：上级的上级拿货价 × 2% × 名额数 =====');
// B 升天使(3名额)，直接上级 A=天使(平级)，A 的上级 U1=私董
let r = parityBonusCascade({
  buyerTier: 'angel',
  uplineChain: [{ id: 'A', tier: 'angel' }, { id: 'U1', tier: 'private' }],
  quotaCount: 3,
});
// A 与 B 同级 → A 的平级奖 = U1(私董6980) × 2% × 3 = 139.6 × 3 = 418.8
assert('A 的供货上级=U1(私董)', r.recipients[0]?.supplierTier === 'private', r.recipients[0]?.supplierTier);
assert('每名额 139.6', Math.abs(r.recipients[0]?.perQuota - 139.6) < 1e-6, r.recipients[0]?.perQuota);
assert('A 得 418.8', Math.abs(r.recipients[0]?.amount - 418.8) < 1e-6, r.recipients[0]?.amount);

// 多级同级：B(天使) ← A1(天使) ← A2(天使) ← U1(私董)
// A1 的供货上级=A2(天使7500) → 150×3=450；A2 的供货上级=U1(私董6980) → 139.6×3=418.8
let r2 = parityBonusCascade({
  buyerTier: 'angel',
  uplineChain: [{ id: 'A1', tier: 'angel' }, { id: 'A2', tier: 'angel' }, { id: 'U1', tier: 'private' }],
  quotaCount: 3, cascade: true,
});
assert('A1 按 A2(天使) 得 450', Math.abs(r2.recipients[0]?.amount - 450) < 1e-6, r2.recipients[0]);
assert('A2 按 U1(私董) 得 418.8', Math.abs(r2.recipients[1]?.amount - 418.8) < 1e-6, r2.recipients[1]);
assert('级联合计 868.8', Math.abs(r2.total - 868.8) < 1e-6, r2.total);

// 非级联：只发直接上级 A1 → 450
let r3 = parityBonusCascade({
  buyerTier: 'angel',
  uplineChain: [{ id: 'A1', tier: 'angel' }, { id: 'A2', tier: 'angel' }, { id: 'U1', tier: 'private' }],
  quotaCount: 3, cascade: false,
});
assert('非级联只 A1=450', r3.recipients.length === 1 && Math.abs(r3.total - 450) < 1e-6, r3.total);

// 只有 A 一个上级（无供货来源）→ 0
let r4 = parityBonusCascade({ buyerTier: 'angel', uplineChain: [{ id: 'A', tier: 'angel' }], quotaCount: 3 });
assert('无供货上级 → 0', r4.total === 0, r4.total);

console.log('\n===== 2) 区域代理提成（销售额 / 利润额） =====');
assert('销售额 9980×15%=1497', Math.abs(regionAgentCommission({ amount: 9980, rate: 0.15 }) - 1497) < 1e-6,
  regionAgentCommission({ amount: 9980, rate: 0.15 }));
assert('利润额 (9980-7980)×15%=300', Math.abs(regionAgentCommission({ amount: 9980, rate: 0.15, mode: 'profit', cost: 7980 }) - 300) < 1e-6,
  regionAgentCommission({ amount: 9980, rate: 0.15, mode: 'profit', cost: 7980 }));

console.log('\n===== 3) 合店费 698：固定三分结构 & 闭环 =====');
const FEE = COSTORE_FEE_MONTHLY; // 698
const d = coStoreOwnerDetail(FEE);
assert('总部15%=104.7', Math.abs(d.hq - 104.7) < 1e-6, d.hq);
assert('省2%=13.96 / 市8%=55.84 / 区县10%=69.8',
  Math.abs(d.province - 13.96) < 1e-6 && Math.abs(d.city - 55.84) < 1e-6 && Math.abs(d.district - 69.8) < 1e-6,
  { province: d.province, city: d.city, district: d.district });
assert('总部体系 35% = 244.3', Math.abs(d.hq + d.province + d.city + d.district - 244.3) < 1e-6,
  d.hq + d.province + d.city + d.district);
assert('门店老板 53% = 369.94', Math.abs(d.storeOwner - 369.94) < 1e-6, d.storeOwner);
assert('推荐人复购奖 2% = 13.96', Math.abs(d.referrerRebate - 13.96) < 1e-6, d.referrerRebate);
assert('分红池 10% = 69.8', Math.abs(d.dividendPool - 69.8) < 1e-6, d.dividendPool);
assert('门店侧 65% = 453.7', Math.abs(d.storeShareholders - 453.7) < 1e-6, d.storeShareholders);

const p = coStoreProfitBreakdown(FEE);
assert('门店侧65% = 53% + 2% + 10% 闭环', p.closure === true && Math.abs(p.storeSide - 453.7) < 1e-6, p);

const div = coStorePartnerDividend(FEE, [{ id: 'p1', feePerf: 1 }, { id: 'p2', feePerf: 3 }]);
assert('分红池10%=69.8', Math.abs(div.pool - 69.8) < 1e-6, div.pool);
assert('p1=26.17 / p2=43.63', Math.abs(div.partners[0].total - 26.17) < 1e-6 && Math.abs(div.partners[1].total - 43.63) < 1e-6,
  div.partners.map(x => x.total));
assert('分红严格闭环 69.8', Math.abs(div.partners.reduce((s, x) => s + x.total, 0) - div.pool) < 1e-9,
  div.partners.reduce((s, x) => s + x.total, 0));

// 未推荐者不参与：p1(推荐1)、p2(推荐3)、p3(未推荐0) → p3 归零
const div2 = coStorePartnerDividend(FEE, [{ id: 'p1', feePerf: 1 }, { id: 'p2', feePerf: 3 }, { id: 'p3', feePerf: 0 }]);
assert('未推荐者 p3=0', div2.partners.find(x => x.id === 'p3').total === 0, div2.partners.find(x => x.id === 'p3'));
assert('推荐者 p1/p2 不变', Math.abs(div2.partners.find(x => x.id === 'p1').total - 26.17) < 1e-6 && Math.abs(div2.partners.find(x => x.id === 'p2').total - 43.63) < 1e-6,
  div2.partners.filter(x => x.eligible).map(x => x.total));
assert('仅推荐者参与 → 仍闭环 69.8', Math.abs(div2.partners.reduce((s, x) => s + x.total, 0) - 69.8) < 1e-9,
  div2.partners.reduce((s, x) => s + x.total, 0));

const pb = coStorePartnerBonus(FEE);
assert('复购奖 2% = 13.96', Math.abs(pb.referrerRebate - 13.96) < 1e-6, pb.referrerRebate);

// ── 固定结构：不分推荐人场景，恒为 53% / 2% / 10% ──
for (const rf of ['storeOwner', 'other', 'coStoreBoss']) {
  const A = coStoreFeeAllocation(FEE, { referrer: rf, ownerCount: 1 });
  assert(`referrer=${rf} → 门店老板恒 53%`, Math.abs(A.tipRate - 0.53) < 1e-9, A.tipRate);
  assert(`referrer=${rf} → 推荐人恒 2%`, Math.abs(A.referrerAmount - 13.96) < 1e-6, A.referrerAmount);
  assert(`referrer=${rf} → 分红池恒 10%`, Math.abs(A.dividend.pool - 69.8) < 1e-6, A.dividend.pool);
}

// ── 多人门店：53% 按老板人数均分（弹窗实例 2 人 → 26.5%） ──
const M2 = coStoreFeeAllocation(FEE, { ownerCount: 2 });
assert('2 名老板 → 每人提点 26.5%', Math.abs(M2.tipRatePerOwner - 0.265) < 1e-9, M2.tipRatePerOwner);
assert('2 名老板 → 每人金额 184.97', Math.abs(M2.storeOwner.perOwner - 184.97) < 1e-6, M2.storeOwner.perOwner);
assert('2 名老板 → 两人合计仍 = 369.94',
  Math.abs(M2.storeOwner.perOwner * 2 + M2.storeOwner.perOwnerRemainder - 369.94) < 1e-6,
  M2.storeOwner.perOwner * 2 + M2.storeOwner.perOwnerRemainder);

// ── 6 个月合店包 4188 ──
const FEE6 = 4188; // 698*6
const A6 = coStoreFeeAllocation(FEE6, { ownerCount: 1 });
assert('6 个月包 → 门店老板 53% = 2219.64', Math.abs(A6.storeOwner.total - 2219.64) < 1e-6, A6.storeOwner.total);
assert('6 个月包 → 推荐人 2% = 83.76', Math.abs(A6.referrerAmount - 83.76) < 1e-6, A6.referrerAmount);
assert('6 个月包 → 分红池 10% = 418.8', Math.abs(A6.dividend.pool - 418.8) < 1e-6, A6.dividend.pool);

// ── 区域代理视角：省 2% / 市 8% / 区县 10% ──
assert('省代 2% = 83.76', Math.abs(coStoreAgentCommission('province', FEE6).amount - 83.76) < 1e-6, coStoreAgentCommission('province', FEE6).amount);
assert('市代 8% = 335.04', Math.abs(coStoreAgentCommission('city', FEE6).amount - 335.04) < 1e-6, coStoreAgentCommission('city', FEE6).amount);
assert('区县代 10% = 418.8', Math.abs(coStoreAgentCommission('district', FEE6).amount - 418.8) < 1e-6, coStoreAgentCommission('district', FEE6).amount);

// 全链路闭环：15+2+8+10+53+2+10 = 100%
const total = d.hq + d.province + d.city + d.district + d.storeOwner + d.referrerRebate + d.dividendPool;
assert('合店费全链路闭环 = 698', Math.abs(total - 698) < 1e-9, total);

console.log('\n总结果 →', ok ? '✅ 全部 PASS' : '❌ 有失败');
process.exit(ok ? 0 : 1);

/**
 * 区域代理 / 门店算法校验
 * 依据：桌面 tp123 蓝湖原型截图官方算例（2026-10-22 读取）
 */
const R = require('../src/regionAgent');

let pass = 0, fail = 0;
function eq(label, actual, expected) {
  const ok = typeof expected === 'number' ? Math.abs(actual - expected) < 0.01 : actual === expected;
  if (ok) { pass++; console.log(`  ✓ ${label} = ${actual}`); }
  else { fail++; console.log(`  ✗ ${label} 实际=${actual} 期望=${expected}`); }
}
function ok(label, cond, extra) {
  if (cond) { pass++; console.log(`  ✓ ${label}${extra ? ' ' + extra : ''}`); }
  else { fail++; console.log(`  ✗ ${label}${extra ? ' ' + extra : ''}`); }
}
function head(t) { console.log(`\n===== ${t} =====`); }

head('① 代理级别分成表（tp123 note 01）');
eq('省代 B端业务 20%', R.AGENT_SHARE.province.bBiz, 0.20);
eq('省代 B端服务 10%', R.AGENT_SHARE.province.bService, 0.10);
eq('省代 C端门店交付 10%', R.AGENT_SHARE.province.cStore, 0.10);
eq('省代 C端总部交付 10%', R.AGENT_SHARE.province.cHq, 0.10);
eq('省代 VIP合伙人 200元', R.AGENT_SHARE.province.vipPartner, 200);
eq('省代 供应链 3折', R.AGENT_SHARE.province.supply, 0.30);
eq('市代 B端业务 18%', R.AGENT_SHARE.city.bBiz, 0.18);
eq('市代 C端交付 8%', R.AGENT_SHARE.city.cStore, 0.08);
eq('市代 VIP合伙人 165元', R.AGENT_SHARE.city.vipPartner, 165);
eq('市代 供应链 3.5折', R.AGENT_SHARE.city.supply, 0.35);
eq('区县代 C端门店交付 75%', R.AGENT_SHARE.district.cStore, 0.75);
eq('区县代 C端总部交付 35%', R.AGENT_SHARE.district.cHq, 0.35);
eq('区县代 VIP合伙人 100元', R.AGENT_SHARE.district.vipPartner, 100);
eq('区县代 供应链 4折', R.AGENT_SHARE.district.supply, 0.40);
eq('单店 C端门店交付 65%', R.AGENT_SHARE.store.cStore, 0.65);
eq('单店 C端总部交付 30%', R.AGENT_SHARE.store.cHq, 0.30);
eq('单店 供应链 5折', R.AGENT_SHARE.store.supply, 0.50);

head('② 代理门槛费');
eq('省代合计 260w', R.agentThresholdFee('province').total, 2600000);
eq('市代 >1000w 合计 45w', R.agentThresholdFee('city', 0).total, 450000);
eq('市代 500~1000w 合计 40w', R.agentThresholdFee('city', 1).total, 400000);
eq('市代 <500w 合计 35w', R.agentThresholdFee('city', 2).total, 350000);
eq('区县代合计 12w', R.agentThresholdFee('district').total, 120000);
eq('单店合计 8w', R.agentThresholdFee('store').total, 80000);

head('③ 区域奖 3000 门店服务费拆分');
eq('省代每VIP 100', R.regionVipBonus('province', 1).amount, 100);
eq('市代每VIP 200', R.regionVipBonus('city', 1).amount, 200);
eq('区县代每VIP 300', R.regionVipBonus('district', 1).amount, 300);
eq('区县代 30 VIP', R.regionVipBonus('district', 30).amount, 9000);
const ss = R.storeServiceSplit();
eq('门店余额 2400', ss.store, 2400);
ok('3000 闭环', ss.closure === true, `总计=${ss.total}`);

head('④ 实物产品折扣（tp123 note 00）');
eq('VIP 8折', R.PARTNER_DISCOUNT.vip, 0.80);
eq('天使 7.5折', R.PARTNER_DISCOUNT.angel, 0.75);
eq('私董 7折', R.PARTNER_DISCOUNT.private, 0.70);
eq('联创 6.5折', R.PARTNER_DISCOUNT.cofounder, 0.65);
eq('单店 5折', R.AGENT_DISCOUNT.store, 0.50);
eq('区县 4折', R.AGENT_DISCOUNT.district, 0.40);
eq('市代 3.5折', R.AGENT_DISCOUNT.city, 0.35);
eq('省代 3折', R.AGENT_DISCOUNT.province, 0.30);

head('⑤ 实物级差 —— 官方算例（平板 6980，成本 0）');
const c1 = R.physicalTierDiff('city', 'angel', 1, 6980);
eq('市代进价 = 2443', c1.buyPrice, 2443);
eq('天使售价 = 5235', c1.sellPrice, 5235);
eq('市代收益 = 2792', c1.amount, 2792);
// 旧口径复购奖 2%（保留作回滚路径；2026-10-23 新规格改为按上级身份 5/10/15/15%
// 产品提成，见 verify_product_split.js §3 —— goodsRepurchase 仍供 flat2 回退使用）
eq('上级合伙人复购奖（旧2%口径） 5235×2% = 104.7', R.goodsRepurchase(5235), 104.7);
eq('总部收益 = 2443 − 104.7 = 2338.3', Math.round((2443 - 104.7) * 10) / 10, 2338.3);
const c2 = R.physicalTierDiff('store', 'vip', 1, 6980);
eq('门店赚 6980×(0.8−0.5) = 2094', c2.amount, 2094);
const c3 = R.physicalTierDiff('district', 'store', 1, 6980);
eq('区县赚 6980×(0.5−0.4) = 698', c3.amount, 698);

head('⑥ 虚拟产品按比例分成 —— 官方算例（私董购月卡 700）');
const v = R.virtualDeliverySplit(700, 'store');
// 顶层：总部 15%（25% 含省2%+市8%）/ 省 2% / 市 8% / 单店 75% = 100%
eq('总部 15% = 105', v.hq, 105);
eq('省代 2% = 14', v.province, 14);
eq('市代 8% = 56', v.city, 56);
eq('单店 75% = 525', v.store, 525);
eq('合计 = 700', v.total, 700);
ok('闭环', v.closure === true);
eq('总部侧合计 25% = 175', v.breakdown.hq + v.breakdown.province + v.breakdown.city, 175);
eq('门店交付内部：总部 15% = 105', v.breakdown.hq, 105);
eq('门店交付内部：省代 2% = 14', v.breakdown.province, 14);
eq('门店交付内部：市代 8% = 56', v.breakdown.city, 56);
eq('门店交付内部：单店 75% = 525', v.breakdown.store, 525);
eq('单店内部：门店股东 0.5 = 350', v.storeInner.storeOwner, 350);
eq('单店内部：推荐人 0.05 = 35', v.storeInner.referrerMin, 35);
eq('单店内部：推荐人 0.15 = 105', v.storeInner.referrerMax, 105);
eq('单店内部：合店老板分红 0.1 = 70', v.storeInner.dividend, 70);
const vh = R.virtualDeliverySplit(700, 'hq');
eq('总部交付：总部 55% = 385', vh.hq, 385);
eq('总部交付：单店 35% = 245', vh.store, 245);
eq('总部交付：合计 700', vh.total, 700);

head('⑦ 门店交付（按代理级别 C 端门店交付比例；股东固定 1 人）');
const sd = R.storeDeliveryAllocation(1600, 2, { regionType: 'store' });
eq('单店 门店池 65% = 1040', sd.storePool, 1040);
// 复购奖 2% 为旧口径（2026-10-23 新规格：产品提成按上级身份 5/10/15/15%，见 verify_product_split.js）
eq('复购奖（旧2%口径） = 32', sd.referrerRepurchase, 32);
eq('每股东毛额 = 520', sd.perOwnerGross, 520);
eq('每股东承担复购 = 16', sd.perOwnerRepurchaseShare, 16);
eq('每股东净额 = 504', sd.perOwnerNet, 504);
eq('业务提点 32.5%', Math.round(sd.perOwnerGross / 1600 * 1000) / 10, 32.5);
const sdD = R.storeDeliveryAllocation(1600, 2, { regionType: 'district' });
eq('区县代 门店池 75% = 1200', sdD.storePool, 1200);
// 新规格：股东固定 1 人（默认入参）
const sd1 = R.storeDeliveryAllocation(1600, undefined, { regionType: 'store' });
eq('股东固定 1 人：默认 ownerCount = 1', sd1.ownerCount, 1);
eq('股东固定 1 人：门店池 65% = 1040', sd1.storePool, 1040);
eq('股东固定 1 人：每股东净额 = 1008', sd1.perOwnerNet, 1008);

head('⑧ 行政费 5/5/90');
const af = R.adminFeeSplit(10000);
eq('总部 5% = 500', af.hq, 500);
eq('销售门店股东 5% = 500', af.ownStore, 500);
eq('交付方 90% = 9000', af.delivery, 9000);
eq('合计 10000', af.total, 10000);

head('⑨ 直推代理奖 15% + 合伙人成交奖');
eq('直推代理 基数40000 × 15% = 6000', R.agentDirectBonus(40000).amount, 6000);
eq('省代 成交 1 个 VIP合伙人 = 200', R.agentVipPartnerBonus('province', 1).amount, 200);
eq('市代 = 165', R.agentVipPartnerBonus('city', 1).amount, 165);
eq('区县代 = 100', R.agentVipPartnerBonus('district', 1).amount, 100);
eq('单店无此项 = 0', R.agentVipPartnerBonus('store', 1).amount, 0);

head('⑩ 月度汇总（区县代理）');
const A = R.monthlyRegionAgent({
  regionType: 'district', vipCount: 30,
  goods: [
    { kind: 'physical', sellerLevel: 'store', buyerLevel: 'vip', qty: 10, basePrice: 6980 },
    { kind: 'physical', sellerLevel: 'city', buyerLevel: 'angel', qty: 5, basePrice: 6980 },
  ],
  signingBase: 40000, adminFeeAsDelivery: 10000, coStoreFees: [698, 698], vipPartnerCount: 5,
});
eq('区域奖 30×300 = 9000', A.vip.amount, 9000);
eq('实物级差合计', A.goodsTotal, 10 * 2094 + 5 * 2792);
eq('直推代理奖 6000', A.signing.amount, 6000);
eq('行政费交付方 9000', A.admin.delivery, 9000);
eq('合伙人成交奖 5×100 = 500', A.vipPartner.amount, 500);
eq('合店提成 2×698×10% = 139.6', A.coStoreTotal, 139.6);
eq('合计', A.total, 9000 + (10 * 2094 + 5 * 2792) + 6000 + 9000 + 500 + 139.6);

head('⑪ 月度汇总（单店）');
const B = R.monthlyRegionAgent({
  regionType: 'store', vipCount: 6,
  goods: [], signingBase: 0, adminFeeAsDelivery: 0, coStoreFees: [],
});
eq('单店区域奖为 0（无此项）', B.vip.amount || 0, 0);
eq('单店合计 0', B.total, 0);

console.log(`\n${'='.repeat(50)}`);
console.log(`通过 ${pass} / 失败 ${fail}`);
console.log('='.repeat(50));
process.exit(fail > 0 ? 1 : 0);

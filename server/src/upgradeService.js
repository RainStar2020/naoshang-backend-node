/**
 * 脑商AI合伙人 · 升级（合伙人升档）服务
 *
 * ════════════════════════════════════════════════════════════════
 * 一、为什么抽出来（前端反馈问题 3：升级费用支付流程不清）
 * ════════════════════════════════════════════════════════════════
 * 旧实现：POST /partner/upgrades 直接调 R.createOrder() 落账，
 *   → 不管 PAYMENT_MODE 是 sandbox 还是 live，升级都是「提交即 SUCCEEDED」，
 *   → live 模式下**没有支付单**，钱收了、等级给了，但没有任何可对账、可退款、可回调的凭据。
 *
 * 新实现（两个模式共用同一套计价与落账逻辑，只是「何时落账」不同）：
 *   sandbox：提交即支付成功 → 立即落账（维持原行为，回归脚本不受影响）
 *   live   ：提交只创建**一个**支付单（差价 + 升级服务费合并为 totalPayable）
 *            → 渠道通知 / sandbox-confirm 触发 settlePayment → applyBizEffect('upgrade')
 *            → **此时才**扣上级名额 + 授予买方等级 + 落分润台账
 *
 * 二、关键口径（前端文档需明确）
 * ════════════════════════════════════════════════════════════════
 *   · 升级是**一个支付单**（不是差价、服务费两个单）：
 *       totalPayable = 合伙人费(目标档一口价 − 本金档一口价) + 升级服务费(活动名额 × 单价)
 *     两项在订单与支付单上是**同一笔金额**，只是台账上分开记账（supply_spread / service_fee）。
 *   · 扣名额与授级的时点：**支付成功之后**。
 *     live → 渠道异步通知验签通过后；sandbox → 下单直通即成功。
 *   · 计价基准是**本金档 principal_tier**（不是当前档），避免免费升档抬高当前档后被少算。
 *   · 名额消耗按**增量**（目标档名额 − 当前档名额），升级整包不给买方入账名额（仅升档）。
 */

const C = require('./commission');
const Q = require('./quotaLedger');
const S = require('./store');
const EXP = require('./experience');

const nowMs = () => Date.now();
const round2 = (n) => C.round2(n);

/**
 * 升级报价（与服务端落账同口径，避免报价与实收不一致）
 * @returns {object} { targetLevel, targetAccountId, oldTier, principalTier, principal,
 *                     amount, quotaCount, usedActivityQuota, usedStandardQuota,
 *                     serviceFeePerActivity, serviceFeeEstimate, totalPayable, label }
 */
function quoteUpgrade(db, { targetAccountId, targetLevel }) {
  const tu = db.users[targetAccountId];
  if (!tu) throw new Error('目标用户不存在');
  const base = tu.principal_tier || tu.tier || 'none';
  const basePrice = C.RETAIL_PRICE[base] || 0;
  const amount = Math.max(0, (C.RETAIL_PRICE[targetLevel] || 0) - basePrice);
  const quotaCount = Math.max(0, (C.TIER_VIP[targetLevel] || 0) - (C.TIER_VIP[tu.tier] || 0));
  const qCfg = Q.resolveConfig((S.getSettings(db) || {}).quota || {});
  const seller = tu.upline_id ? db.users[tu.upline_id] : null;
  const activityAvail = seller ? Q.getActivity(db.quotaLedger, seller.id) : 0;
  const usedActivity = Math.min(quotaCount, qCfg.activityValidForUpgrade ? activityAvail : 0);
  const usedStandard = quotaCount - usedActivity;
  const serviceFeeEstimate = usedActivity * qCfg.serviceFeePerActivity;
  return {
    targetLevel,
    targetAccountId,
    oldTier: tu.tier,
    principalTier: base,
    principal: basePrice,
    amount: round2(amount),
    quotaCount,
    usedActivityQuota: usedActivity,
    usedStandardQuota: usedStandard,
    serviceFeePerActivity: qCfg.serviceFeePerActivity,
    serviceFeeEstimate: round2(serviceFeeEstimate),
    totalPayable: round2(amount + serviceFeeEstimate),
    label: `${EXP.TIER_CN[tu.tier] || tu.tier} → ${EXP.TIER_CN[targetLevel] || targetLevel}`,
  };
}

/**
 * 执行升级落账（扣上级名额 + 授买方等级 + 落分润台账）
 * 幂等：同一笔支付单只会进来一次（settlePayment 只在 newlyPaid 时触发）。
 * @returns {object} { mode, oldTier, targetLevel, orderId, settlement }
 */
function applyUpgrade(db, { targetAccountId, targetLevel }, { now = nowMs() } = {}) {
  // 惰性 require，避免与 routes.js 形成加载期循环依赖
  const R = require('./routes');
  const tu = db.users[targetAccountId];
  if (!tu) throw new Error('目标用户不存在');
  const oldTier = tu.tier;
  const curRank = C.TIER_VIP[oldTier] ?? 0;
  const tgtRank = C.TIER_VIP[targetLevel] ?? 0;

  // 非升档请求（同级 / 降档 / 未知档）：保留原授级行为（仅变更档位并留单，不产生分润台账）
  if (tgtRank <= curRank) {
    S.updatePartner(db, targetAccountId, { tier: targetLevel });
    const order = S.addOrder(db, {
      id: S.nextId(db, 'o'), type: 'upgrade', buyer_id: targetAccountId,
      packageTier: targetLevel, oldTier, created_at: now,
    });
    return {
      mode: 'grant-only', oldTier, targetLevel, orderId: order.id,
      settlement: { mode: 'grant-only', oldTier, targetLevel, note: '非相邻档位升级：仅变更档位，不产生分润台账' },
    };
  }

  // 升档：走真实下单通道（createOrder 的「升级差价」分支）
  const r = R.createOrder(db, {
    buyerId: targetAccountId, packageTier: targetLevel, oldTier,
    rawQuota: null, buyerIsNew: false,
  });
  const rows = (db.commissions || []).filter((c) => c.ref_order_id === r.order_id);
  return {
    mode: 'upgrade', oldTier, targetLevel, orderId: r.order_id,
    settlement: {
      mode: 'upgrade', oldTier, targetLevel,
      quotaCount: C.vipCredit(oldTier, targetLevel),
      actual_paid: r.actual_paid, supplySpread: r.supply_spread,
      serviceFee: r.service_fee, serviceFeePerActivity: r.service_fee_per_activity,
      totalPayable: r.total_payable,
      quotaUsedStandard: r.quota_used_standard, quotaUsedActivity: r.quota_used_activity,
      storeFee: r.store_fee, hqFee: r.hq_fee, channel: r.channel,
      items: rows.map((c) => ({ owner_id: c.owner_id, type: c.type, amount: c.amount, formula: c.formula })),
    },
  };
}

module.exports = { quoteUpgrade, applyUpgrade };

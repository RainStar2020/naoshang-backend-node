'use strict';

/**
 * 合伙人（批发商）等级 · 名额 · 级差 · 平级奖 —— 计算模块
 *
 * 规则来源：用户 2026-10-23 口述 + 《脑商VIP会员·批发商说明》截图 + 批发商业绩表
 *
 * ── 一、四档等级（图1 权威数据）────────────────────────────
 *   档位     名额   标价        每名额拿货价   单档利润    比例
 *   VIP      1     9,980       7,980         2,000      20.0%
 *   天使     3     29,800      7,500         7,300      24.5%
 *   私董     6     59,800      6,980         17,920     30.0%
 *   联创     24    239,800     6,500         83,800     35.0%
 *   总部     —     —           6,500（= 联创价）
 *
 * ── 二、名额流转规则（用户口述核心）─────────────────────
 *   1. 只有联创能向总部买名额；其余档位只能向「自己绑定的上级」买，逐级向上。
 *   2. 每卖出一个名额，卖出人若存在上级，就要按「价格 − 拿货价」结算级差。
 *   3. 下级向上级买名额，付的是「下级自己档位的拿货单价 × 名额数」。
 *      例：私董从联创买 2 个名额 → 付 6980×2 = 13,960；联创成本 6500×2 = 13,000 → 联创赚 960。
 *   4. 升级只能由上级分配名额完成，不能自己买名额给自己升级。
 *
 * ── 三、平级奖（2%，从供货上级级差中扣）────────────────────
 *   触发：买家 B 向同级上级 A 补名额（不算升级身份）→ A 拿货价=B 拿货价 → A 利润 0。
 *   收款人：链中第一个与买家同级的卖方 A（唯一一份）。
 *   出资方（用户 2026-10-24 拍板，与实时下单 parityPlan 口径一致）：
 *           由 A 的【供货上级】（链中 A 的上一级）从其供货级差中扣除该笔平级奖；
 *           金额 = 该供货上级拿货单价 × 2% × 名额数。
 *           预算中性：平级奖是级差的内部转移，非额外出账、非总部吸收。
 *           若 A 已是链顶（无供货上级）→ 无资金来源 → 不发平级奖。
 *   升级身份（targetTier> buyerTier）不触发平级奖（卖方必吃差价）。
 *
 *   用户三个算例（买家均天使，唯一同级卖方均 A，各 1 份）：
 *   ① B(天使)←A(天使)←C(私董)←D(联创)      → A 得 6980×2%×n（从 C 级差扣，1 份）
 *   ② B(天使)←A(天使)←Z(联创)←总部          → A 得 6500×2%×n（从 Z 级差扣，1 份）
 *   ③ B(天使)←A(天使)←F(联创)←E(联创)←总部  → A 得 6500×2%×n（从 F 级差扣，1 份；E 同级但无供货上级→不发）
 *
 * ── 四、升级方式（用户 2026-10-23 最终口径：升级付全款）────────
 *   · 升级付【目标档位标价全款】；每个上级再按自身级差（下级拿货单价 − 自己拿货单价）赚钱。
 *   · 升级身份无平级奖（卖方必吃差价）。
 *   另有两条补充路径：
 *   A. 补差价直升（截图3 弹窗）：应补 = 目标档位标价 − 已缴累计（如 239800−79800=160000）
 *   B. 推广达标免费升：1 年内直推 3 个「本级」，名额换算 1联创=24私董=6天使=1VIP
 *      · 达标后身份变更，但「初始金额」不变（不产生资金流）
 */

// ───────────────────────── 常量 ─────────────────────────
/** 总部拿货单价（= 联创拿货价 6500） */
const HQ_COST_UNIT = 6500;
const PARITY_RATE = 0.02;      // 平级奖 2%
const REPURCHASE_RATE = 0.02;  // 复购奖 2%（图1 备注「管理奖」）

/**
 * 四档等级定义。costUnit = 该档位的「每名额拿货价」，
 * 同时也是「该档位者卖给下级的名额单价」。
 */
const GRADES = {
  user: {
    key: 'user', name: '普通用户', level: 0, quota: 0, price: 0,
    costUnit: null, directRate: null, rebuyDiscount: null,
  },
  vip: {
    key: 'vip', name: 'VIP（1阶·小批发商）', level: 1, quota: 1, price: 9980,
    costUnit: 7980, directRate: 0.05, rebuyDiscount: 0.80,
  },
  angel: {
    key: 'angel', name: '天使（2阶·中批发商）', level: 2, quota: 3, price: 29800,
    costUnit: 7500, directRate: 0.10, rebuyDiscount: 0.75,
  },
  private: {
    key: 'private', name: '私董（3阶·大批发商）', level: 3, quota: 6, price: 59800,
    costUnit: 6980, directRate: 0.15, rebuyDiscount: 0.70,
  },
  cofounder: {
    key: 'cofounder', name: '联创（4阶·总批发商）', level: 4, quota: 24, price: 239800,
    costUnit: 6500, directRate: 0.15, rebuyDiscount: 0.65,
  },
};

/** 低 → 高 */
const GRADE_ORDER = ['user', 'vip', 'angel', 'private', 'cofounder'];
/** 可花钱购买的档位（不含 user） */
const PAID_GRADES = ['vip', 'angel', 'private', 'cofounder'];

// ───────────────────────── 工具 ─────────────────────────
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const round4 = (n) => Math.round((Number(n) || 0) * 10000) / 10000;

function gradeOf(tier) {
  const g = GRADES[tier];
  if (!g) throw new Error('未知档位: ' + tier);
  return g;
}
const quotaOf = (tier) => gradeOf(tier).quota;
const priceOf = (tier) => gradeOf(tier).price;
/** 该档位每名额拿货价；普通用户无拿货价返回 null */
const costUnitOf = (tier) => gradeOf(tier).costUnit;
const levelOf = (tier) => gradeOf(tier).level;

/** 名额差（升级需要的名额数） */
function quotaDelta(fromTier, toTier) {
  const d = quotaOf(toTier) - quotaOf(fromTier);
  if (d < 0) throw new Error(`不能降级: ${fromTier} → ${toTier}`);
  return d;
}

/** 档位是否严格更高 */
const isHigher = (a, b) => levelOf(a) > levelOf(b);

// ───────────────────────── 一、升级应付金额 ─────────────────────────
/**
 * 升级时买家应付给上级的金额（用户 2026-10-23 最终口径：付全款）。
 *   买家付【目标档位标价全额】；每个上级再按自身级差（下级拿货单价 − 自己拿货单价）赚钱。
 *   ⚠️ 「联创标准价」用户口述为 2398000，实际应为 239800（图1 + 截图3 均为 239800）。
 *   ⚠️ 若买家已持有低档位且存在「已缴累计」抵扣场景（截图3 弹窗：已缴79800→补160000），
 *      另有 upgradeByPay() 处理；本函数对应「无抵扣、直接升级/开卡」付全款。
 */
function upgradePayable({ fromTier, toTier }) {
  const to = gradeOf(toTier), from = gradeOf(fromTier);
  if (to.level <= from.level) throw new Error(`非法升级: ${fromTier} → ${toTier}`);
  const quota = quotaDelta(fromTier, toTier);
  return { fromTier, toTier, quota, amount: round2(to.price) };
}

/** 补名额（不升级）：买家按自己档位单价买 n 个名额 */
function buyQuotaPayable({ tier, quota }) {
  const g = gradeOf(tier);
  if (!g.costUnit) throw new Error('普通用户无拿货价，请走下单流程: ' + tier);
  return { tier, quota, amount: round2(g.costUnit * quota) };
}

// ───────────────────────── 二、级差链分配 ─────────────────────────
/**
 * 一次「名额交易」的整链条分配。
 *
 * 链：buyer → L0 → L1 → … → Ln → 总部
 *   · L0 收入 = 买家实付 payAmount，成本 = costUnit[L0] × quota
 *   · Li (i≥1) 收入 = costUnit[L(i-1)] × quota，成本 = costUnit[Li] × quota
 *     （下级向上级买名额，付的是下级自己的档位单价）
 *   · 总部收入 = costUnit[Ln] × quota，成本 = HQ_COST_UNIT × quota
 *
 * @param {Object} p
 *   buyerTier   买家当前档位
 *   targetTier  目标档位（升级时高于 buyerTier；补名额时与 buyerTier 相同）
 *   quota       本次名额数（缺省取 quotaDelta）
 *   payAmount   买家实付（缺省按 diff 口径算）
 *   uplineChain [{id, tier}] 从直接上级向上排列，index 0 = 直接上级
 * @returns {Object} { quota, payAmount, layers[], parity[], totals }
 */
function distributeTrade({
  buyerTier,
  targetTier = buyerTier,
  quota,
  payAmount,
  uplineChain = [],
}) {
  const q = quota != null ? quota : quotaDelta(buyerTier, targetTier);
  const amount = payAmount != null ? payAmount : upgradePayable({ fromTier: buyerTier, toTier: targetTier }).amount;
  if (q <= 0) throw new Error('名额数必须 > 0');
  if (!uplineChain.length) throw new Error('缺少上级链（至少需要 1 个上级）');

  // 整条链（含买方，便于逐对判定平级）
  const chain = [{ id: '<buyer>', tier: buyerTier, isBuyer: true }, ...uplineChain];

  // 1) 逐层级差
  const layers = [];
  for (let i = 1; i < chain.length; i++) {
    const seller = chain[i];
    const down = chain[i - 1];
    const income = i === 1
      ? amount                                   // 第一层：买家实付
      : round2(costUnitOf(down.tier) * q);       // 其余层：下级按自己档位单价付款
    const cost = round2(costUnitOf(seller.tier) * q);
    layers.push({
      index: i - 1,
      sellerId: seller.id,
      sellerTier: seller.tier,
      sellerName: gradeOf(seller.tier).name,
      buysFrom: i === 1 ? `${buyerTier} 买家` : chain[i - 1].tier,
      income: round2(income),
      cost,
      profit: round2(income - cost),
      isParity: round2(income - cost) === 0 && costUnitOf(down.tier) === costUnitOf(seller.tier),
      formula: `${round2(income)} − ${round2(costUnitOf(seller.tier))} × ${q} = ${round2(income - cost)}`,
    });
  }

  // 2) 总部（链条顶端向总部进货）
  const top = chain[chain.length - 1];
  const hqIncome = round2(costUnitOf(top.tier) * q);
  const hqCost = round2(HQ_COST_UNIT * q);
  layers.push({
    index: layers.length,
    sellerId: 'HQ',
    sellerTier: 'hq',
    sellerName: '总部',
    buysFrom: `${top.tier} 顶层级`,
    income: hqIncome,
    cost: hqCost,
    profit: round2(hqIncome - hqCost),
    isParity: false,
    formula: `${hqIncome} − ${HQ_COST_UNIT} × ${q} = ${round2(hqIncome - hqCost)}`,
  });

  // 3) 平级奖（2026-10-24 口径：从供货上级级差中扣）
  const parity = parityAwards({ buyerTier, uplineChain, quota: q });

  // 4) 把平级奖从「供货上级」的级差中扣除（预算中性：平级奖是级差的内部转移，不是额外支出）
  const hqLayer = layers[layers.length - 1];              // 末位为总部层
  for (const l of layers) {
    const deduct = (parity.deductions && parity.deductions[l.sellerId]) || 0;
    if (!deduct) continue;
    l.profit = round2(l.profit - deduct);
    l.parityDeducted = deduct;
    l.formula += ` − 平级奖 ${deduct}`;
  }

  // 5) 汇总
  const sellerProfit = round2(layers.reduce((s, l) => s + l.profit, 0));
  const parityTotal = parity.total;

  return {
    buyerTier, targetTier, quota: q, payAmount: round2(amount),
    layers,
    parity,
    totals: {
      sellerProfit,            // 级差合计（各层 profit 之和，含总部；已扣除被转出的平级奖）
      parityTotal,             // 平级奖合计（从供货上级级差中转出，预算中性）
      grandProfit: round2(sellerProfit + parityTotal),
      // 闭环：买家实付 = 总部成本 + 各层利润（含被转出的平级奖）→ 平级奖为级差内部转移，不破坏闭环
      closure: round2(amount) === round2(hqLayer.cost + sellerProfit + parityTotal),
    },
  };
}

// ───────────────────────── 三、平级奖 ─────────────────────────
/**
 * 平级奖（用户 2026-10-24 最终口径：从供货上级级差中扣，取代旧「链顶/总部额外出账」）。
 *
 * 触发条件（沿链逐跳判定）：
 *   买家 B 向其「直接上级 A」补名额（targetTier === buyerTier，即不算升级身份），
 *   且 A 与 B 同级 → A 的拿货价 = B 的拿货价 → A 这笔转手利润为 0（不赚钱）。
 *   「升级身份」不产生平级奖（升级时下级向上级付的是更高档位价，卖方必吃差价）。
 *
 * 收款人：链中第一个「与买家同级」的卖方，即不赚钱的那位 A（一份，唯一）。
 *
 * 出资方（与实时下单 commission.parityPlan 同口径）：
 *   由 A 的【供货上级】（链中 A 的上一级）从其供货级差中扣除该笔平级奖；
 *   金额 = 该供货上级拿货单价 × 2% × 名额数。
 *   · 预算中性：平级奖是级差的内部转移，非额外出账、非总部吸收。
 *   · 若 A 已是链顶（无供货上级）→ 无资金来源 → 不发平级奖。
 *
 * 用户三个算例（买家均为天使，唯一同级卖方均为 A）：
 *   ① B(天使)←A(天使)←C(私董)←D(联创)      → A 得 6980×2%×n（从 C 级差扣，1 份）
 *   ② B(天使)←A(天使)←Z(联创)←总部          → A 得 6500×2%×n（从 Z 级差扣，1 份）
 *   ③ B(天使)←A(天使)←F(联创)←E(联创)←总部  → A 得 6500×2%×n（从 F 级差扣，1 份；E 同级但无供货上级→不发）
 *
 * @param {string} buyerTier 买家档位
 * @param {Array}  uplineChain [{id, tier}] 从直接上级向上排列（index 0 = 直接上级）
 * @param {number} quota 名额数
 * @returns {{baseTier, baseUnit, perQuota, quota, awards, deductions, total}}
 *   awards     : [{ recipientId, recipientTier, supplierId, supplierTier, baseUnit, perQuota, amount, ... }]
 *   deductions : { [供货上级id]: amount }  各供货上级需从其级差中扣除的金额（与 awards 联动）
 */
function parityAwards({ buyerTier, uplineChain = [], quota }) {
  const q = Math.max(1, quota || 1);
  const chain = [{ id: '<buyer>', tier: buyerTier }, ...uplineChain];
  if (chain.length < 2) {
    return { baseTier: null, baseUnit: null, perQuota: 0, quota: q, awards: [], deductions: {}, total: 0 };
  }

  // 链顶（信息用）：无平级奖时 baseTier/baseUnit 回退为链顶档位
  const top = chain[chain.length - 1];
  let baseTier = top.tier;
  let baseUnit = costUnitOf(top.tier) ?? HQ_COST_UNIT;
  let perQuota = round2(baseUnit * PARITY_RATE);

  const awards = [];
  const deductions = {};          // { [供货上级id]: 需从其级差中扣除的金额 }

  // 沿链逐跳判定：转手方与其下级同级 → 吃不到差价 → 由其供货上级出资
  for (let i = 1; i < chain.length; i++) {
    const me = chain[i];
    const down = chain[i - 1];
    if (me.tier !== down.tier) continue;              // 非同级 → 正常吃差价
    const supplier = chain[i + 1];                     // 该同级转手方的供货上级
    if (!supplier) continue;                           // 链顶无供货上级 → 无资金来源，不发
    const sUnit = costUnitOf(supplier.tier) ?? HQ_COST_UNIT;
    const sPerQuota = round2(sUnit * PARITY_RATE);
    const amount = round2(sPerQuota * q);
    if (awards.length === 0) { baseTier = supplier.tier; baseUnit = sUnit; perQuota = sPerQuota; }
    awards.push({
      recipientId: me.id,
      recipientTier: me.tier,
      recipientName: gradeOf(me.tier).name,
      pair: `${down.tier} 下级 → ${me.id}(${me.tier}) 同级（卖方不赚钱）`,
      supplierId: supplier.id,
      supplierTier: supplier.tier,
      baseTier: supplier.tier,
      baseUnit: sUnit,
      rate: PARITY_RATE,
      quota: q,
      perQuota: sPerQuota,
      amount,
      formula: `${sUnit} × 2% × ${q} = ${amount}（${me.id} 得，从 ${supplier.id} 级差扣）`,
    });
    deductions[supplier.id] = round2((deductions[supplier.id] || 0) + amount);
  }

  return {
    baseTier, baseUnit, perQuota, quota: q,
    awards, deductions,
    total: round2(awards.reduce((s, a) => s + a.amount, 0)),
  };
}

// ───────────────────────── 四、复购奖 2%（用户 2026-10-23 明确口径） ─────────────────────────
/**
 * 复购奖（直推管理奖）：
 *   触发：自己的【下级】购买【任意产品】（任何一笔产品消费，不限是否首次）。
 *   收款人：该下级的【直接上级】（绑定上级），唯一一份。
 *   金额 = 下级本次【实付金额】 × 2%。
 *
 * 与「名额级差」的区别：级差只发生在「名额/批发」流转（§二）；
 * 复购奖发生在「产品购买」场景，是上级对下级日常消费的分润，互不替代。
 */
function repurchaseBonus({ paid, downlineId, uplineId }) {
  return {
    downlineId,
    uplineId,
    paid: round2(paid),
    rate: REPURCHASE_RATE,
    amount: round2(paid * REPURCHASE_RATE),
    formula: `${round2(paid)} × 2% = ${round2(paid * REPURCHASE_RATE)}（发给直接上级 ${uplineId}）`,
  };
}

// ───────────────────────── 五、升级两种方式 ─────────────────────────
/**
 * 方式 A：补差价直升（截图3 弹窗）
 *   应补 = 目标档位标价 − 已缴累计
 */
function upgradeByPay({ fromTier, toTier, paidTotal }) {
  const to = gradeOf(toTier);
  const already = round2(paidTotal != null ? paidTotal : gradeOf(fromTier).price);
  return {
    mode: 'pay', fromTier, toTier,
    targetPrice: to.price,
    paidTotal: already,
    needPay: round2(Math.max(0, to.price - already)),
    // 升级后「初始金额」按新档位标价走
    initialAmountAfter: to.price,
  };
}

/**
 * 方式 B：推广达标免费升（1 年内直推 3 个本级）
 *   名额换算：1 联创=24、1 私董=6、1 天使=3、1 VIP=1
 *   达标名额 = 3 × 当前档位名额数
 *   达标后身份变更，但「初始金额」不变（无资金流）
 */
function upgradeByReferral({ fromTier, toTier, referrals = [] }) {
  const from = gradeOf(fromTier);
  const to = gradeOf(toTier);
  if (to.level <= from.level) throw new Error(`非法升级: ${fromTier} → ${toTier}`);

  const needQuota = 3 * from.quota;
  const detail = referrals.map((r) => {
    const g = gradeOf(r.tier);
    return { tier: r.tier, count: r.count, quotaEach: g.quota, quotaTotal: g.quota * r.count };
  });
  const gotQuota = detail.reduce((s, d) => s + d.quotaTotal, 0);

  return {
    mode: 'referral', fromTier, toTier,
    needQuota, gotQuota,
    ok: gotQuota >= needQuota,
    gapQuota: Math.max(0, needQuota - gotQuota),
    detail,
    // 拉人升级不改「初始金额」
    initialAmountAfter: from.price,
    note: gotQuota >= needQuota
      ? `达标：直推 ${gotQuota} 名额 ≥ 需 ${needQuota} 名额`
      : `未达标：直推 ${gotQuota} 名额 < 需 ${needQuota} 名额（差 ${needQuota - gotQuota}）`,
  };
}

// ───────────────────────── 六、档位速查表 ─────────────────────────
/** 生成四档对照表（可直接给前端/文档用） */
function gradeTable() {
  return PAID_GRADES.map((t) => {
    const g = GRADES[t];
    return {
      tier: t, name: g.name, level: g.level, quota: g.quota,
      price: g.price, costUnit: g.costUnit,
      costTotal: round2(g.costUnit * g.quota),
      profit: round2(g.price - g.costUnit * g.quota),
      ratio: round4((g.price - g.costUnit * g.quota) / g.price),
      directRate: g.directRate, rebuyDiscount: g.rebuyDiscount,
    };
  });
}

module.exports = {
  HQ_COST_UNIT, PARITY_RATE, REPURCHASE_RATE,
  GRADES, GRADE_ORDER, PAID_GRADES,
  gradeOf, quotaOf, priceOf, costUnitOf, levelOf, isHigher, quotaDelta,
  upgradePayable, buyQuotaPayable,
  distributeTrade, parityAwards, repurchaseBonus,
  upgradeByPay, upgradeByReferral,
  gradeTable, round2, round4,
};

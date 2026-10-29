/**
 * 脑商AI合伙人 · 分润算法模块（纯函数，无 DB 依赖，便于单元测试与验证）
 * 规则来源：桌面《2.2、脑商合伙人方案简版261015.xlsx》+ 用户 Q1~Q6 确认
 */

// ───────────────────────── 基础常量 ─────────────────────────
// 各产品包零售价（客户付费 / 批发商买阶加入费，二者同价）
// 用户确认：定价以「VIP 名额」为单位 —— 1VIP=1名额、天使=3名额、私董=6名额、联创=24名额
const RETAIL_PRICE = { vip: 9980, angel: 29800, private: 59800, cofounder: 239800 };
// 各等级对应的 VIP 名额数（拿货价 = 每名额价格 × 名额数）
const TIER_VIP = { none: 0, vip: 1, angel: 3, private: 6, cofounder: 24 };
// 各卖方等级的「每名额拿货价」（总部进货单价，恒定；与卖方等级挂钩）
const WHOLESALE_PER_QUOTA = { vip: 7980, angel: 7500, private: 6980, cofounder: 6500 };
// ⚠️ 购买/升级路由规则（电梯规则，用户 2026-10-22 确认）：
// 下级购买/升级任何产品包，必须向其「绑定的直接上级」购买，不得跨级找更高级别购买。
// 即使下级的 VIP 等级高于其上级，仍只能向绑定的上级购买（上级按自身等级拿货价赚取差价）。
// 因此本模块的 sellerTier 永远传「购买者的直接上级等级」，而非更高等级。
// 直推奖比例（按推荐人身份）
const DIRECT_RATIO = { vip: 0.05, angel: 0.10, private: 0.15, cofounder: 0.15 };
// 直推奖比例（按业务类型分档）——P1-3 原型（屏 50）口径：
//   供应链 / 合店费复购 / 升级奖 → 2%；软件卡 / 代理费 / 权益费 → 5%
// ⚠️ 与上面的「按推荐人身份分档」是**两套不同维度**，由 settings.directBonus.mode 切换：
//   mode='byUplineTier'（默认）→ 用 DIRECT_RATIO，既有金额行为完全不变
//   mode='byBizType'          → 用 DIRECT_BIZ_RATIO
const DIRECT_BIZ_RATIO = {
  supply_chain: 0.02,   // 供应链
  costore: 0.02,        // 合店费复购
  upgrade: 0.02,        // 升级奖
  software_fee: 0.05,   // 软件卡
  agent_fee: 0.05,      // 代理费
  entitlement: 0.05,    // 权益费
};
// 全球奖单价（从总部产品费 3500/VIP 中切出）
const GLOBAL_UNIT = 150;
const HQ_PRODUCT_FEE_PER_VIP = 3500;
// 总部价格（HQ 给最高级联创的拿货价，即 VIP 名额的总部基准价）= 6500/VIP（=WHOLESALE_PER_QUOTA.cofounder）
// 该 6500 在总部侧每 VIP 拆为两块：门店服务费 3000（分给省/市/县区/门店代理）+ 总部产品费 3500（含全球奖/创始奖等）
const HQ_PRICE_PER_VIP = WHOLESALE_PER_QUOTA.cofounder; // 6500
// 创始奖（永久，按人各得全额，不按人数分摊）：总部每卖出一个 VIP，按身份定额发放
//   联创（持有创始奖）= 3500 × 0.5% = 17.5 / VIP
//   私董             = 3500 × 0.1% = 3.5  / VIP
// 每人所得 = FOUNDING_RATE[tier] × 总部产品费(3500) × 当月全平台 VIP 总数（按人各得，不拆分）
const FOUNDING_RATE = { cofounder: 0.005, private: 0.001 };
// 管理奖
const PARITY_RATE = 0.02;   // 平级奖
const REBUY_RATE = 0.02;    // 复购奖

// 门店服务费：按产品包固定小计 + 固定分配比例；该小计即 ④代理机制「VIP合伙人」分配（省100/市200/县区300/门店2400 每VIP，合计3000）
const STORE_FEE = {
  v1:  { subtotal: 3000,  store: 2400, district: 300,  city: 200, province: 100 },
  v2:  { subtotal: 9000,  store: 7200, district: 900,  city: 600, province: 300 },
  v3:  { subtotal: 18000, store: 14400, district: 1800, city: 1200, province: 600 },
  co:  { subtotal: 72000, store: 57600, district: 7200, city: 4800, province: 2400 },
};
const STORE_RATIO = { store: 0.80, district: 0.10, city: 0.0667, province: 0.0333 };

// 升级差价（买阶相邻差 = 升级多出的名额 × 零售单价，含取整）
const UPGRADE_DIFF = {
  vip_to_angel: RETAIL_PRICE.angel - RETAIL_PRICE.vip,                   // 19800（多2名额）
  angel_to_private: RETAIL_PRICE.private - RETAIL_PRICE.angel,           // 30000（多3名额）
  private_to_cofounder: RETAIL_PRICE.cofounder - RETAIL_PRICE.private,   // 180000（多18名额）
};

// ───────────────────────── 工具函数 ─────────────────────────
/** 会员交易计入奖池的增量 VIP 数（Q1 增量口径） */
function vipCredit(oldTier, newTier) {
  const o = TIER_VIP[oldTier] ?? 0;
  const n = TIER_VIP[newTier] ?? 0;
  return Math.max(0, n - o);
}

// ───────────────────────── 全球奖（Q1/Q2） ─────────────────────────
/**
 * 计算全球奖月度分红
 * @param {Array} cofounders 联创列表，每项：
 *   { id, ownVip(本人直接卖的VIP), teamVip(下级团队叶子VIP，不含本人),
 *     daysSinceCofounder(成为联创天数), directPushedVip(当月直推VIP数) }
 *   说明：总平台VIP = Σ(ownVip)+Σ(teamVip)（均为叶子，不重叠）；
 *        本人业绩权重 = teamVip（子树，不再叠加 ownVip，避免本人直卖重复计入）。
 * @param {Object} opt { vipUnit=150, wuzheDays=90 }
 * @returns {Object} { pool, halfEqual, halfPerf, perCofounder:[{id, equal, perf, total}], undistributed }
 */
function computeGlobalBonus(cofounders, opt = {}) {
  const vipUnit = opt.vipUnit ?? GLOBAL_UNIT;
  const wuzheDays = opt.wuzheDays ?? 90;

  // 全平台 VIP：优先用调用方传入的真实平台总量（避免联创嵌套时重复计数）；
  // 未传时回退为 Σ(ownVip+teamVip)（兼容旧调用/单树场景）。
  const totalVip = opt.totalVip != null
    ? opt.totalVip
    : cofounders.reduce((s, c) => s + (c.ownVip || 0) + (c.teamVip || 0), 0);
  const pool = vipUnit * totalVip;
  const halfEqual = pool / 2;   // 均分那一半
  const halfPerf = pool / 2;    // 业绩那一半

  // 合格联创（无责期 或 当月直推≥1）
  const qualified = cofounders.filter(
    (c) => (c.daysSinceCofounder ?? 0) <= wuzheDays || (c.directPushedVip || 0) >= 1
  );
  const equalShare = qualified.length > 0 ? halfEqual / qualified.length : 0;
  const undistributed = qualified.length > 0 ? 0 : halfEqual;

  // 业绩权重（用户 2026-10-24 口径：业绩 = 卖出 VIP 名额占比）
  //   权重 = 该联创「子树总 VIP（teamVip）」——已包含其本人直卖流向组织的部分，
  //   不再叠加 ownVip（否则本人直卖会被重复计入，导致权重 > 真实占比）。
  //   分母优先用真实平台总 VIP（totalVip，由订单汇总传入，避免联创嵌套重复计数）；
  //   未传时回退为 Σ teamVip（兼容旧调用/单树场景）。
  const weightSum = cofounders.reduce((s, c) => s + (c.teamVip || 0), 0);
  const denom = (opt.totalVip != null && opt.totalVip > 0) ? opt.totalVip : weightSum;

  const per = cofounders.map((c) => {
    const w = (c.teamVip || 0);
    const isQualified = qualified.includes(c);
    const equal = isQualified ? equalShare : 0;
    const perf = denom > 0 ? (halfPerf * w) / denom : 0;
    return { id: c.id, equal: round2(equal), perf: round2(perf), total: round2(equal + perf) };
  });

  return {
    pool: round2(pool),
    halfEqual: round2(halfEqual),
    halfPerf: round2(halfPerf),
    qualifiedCount: qualified.length,
    undistributed: round2(undistributed),
    perCofounder: per,
  };
}

// ───────────────────────── 直推奖（Q5） ─────────────────────────
/**
 * 解析直推奖比例（P1-3 双口径）。
 * @param {string} [bizType] 业务类型（supply_chain/costore/upgrade/software_fee/agent_fee/entitlement）
 * @param {string} referrerLevel 推荐人身份（vip/angel/private/cofounder）
 * @param {object} [cfg] settings.directBonus 配置组
 *   { mode: 'byUplineTier'|'byBizType', byBizType: {...}, byUplineTier: {...} }
 * @returns {number} 比例
 */
function resolveDirectRate(bizType, referrerLevel, cfg = null) {
  const c = cfg && typeof cfg === 'object' ? cfg : {};
  const mode = c.mode || 'byUplineTier';
  const byBiz = c.byBizType && typeof c.byBizType === 'object' ? c.byBizType : {};
  const byTier = c.byUplineTier && typeof c.byUplineTier === 'object' ? c.byUplineTier : {};
  if (mode === 'byBizType') {
    const rb = byBiz[bizType];
    if (rb != null) return rb;
    // 未覆盖的业务类型 → 回落到「按推荐人身份」表（并最终落到内置默认）
  }
  const rt = byTier[referrerLevel];
  if (rt != null) return rt;
  const r = DIRECT_RATIO[referrerLevel];
  if (r == null) throw new Error('未知推荐人身份: ' + referrerLevel);
  return r;
}

/** 直推奖 = 实付金额 × 比例；前提由调用方校验（被推荐=新用户/线下店）
 *  @param {number} actual_paid 实付金额
 *  @param {string} referrerLevel 推荐人身份
 *  @param {object} [opts] { bizType, cfg } —— cfg 为 settings.directBonus
 */
function directBonus(actual_paid, referrerLevel, opts = {}) {
  const r = resolveDirectRate(opts.bizType, referrerLevel, opts.cfg);
  return round2(actual_paid * r);
}

/** 直推奖明细（带比例与命中口径，便于后台展示与对账） */
function directBonusDetail(actual_paid, referrerLevel, opts = {}) {
  const c = opts.cfg && typeof opts.cfg === 'object' ? opts.cfg : {};
  const mode = c.mode || 'byUplineTier';
  const rate = resolveDirectRate(opts.bizType, referrerLevel, c);
  return {
    amount: round2(actual_paid * rate),
    rate,
    mode,
    basis: mode === 'byBizType' ? '业务类型' : '推荐人身份',
    referrerLevel,
    bizType: opts.bizType || null,
    formula: `实付 ${round2(actual_paid)} × ${Math.round(rate * 10000) / 100}% = ${round2(actual_paid * rate)}`,
  };
}

// ───────────────────────── 复购奖（Q3） ─────────────────────────
/** 复购奖 = 下级实付金额 × 2%，发给直接上级 */
function repurchaseBonus(actual_paid) {
  return round2(actual_paid * REBUY_RATE);
}

// ───────────────────────── 平级奖（Q3） ─────────────────────────
/**
 * 平级奖（单笔）= 计提基数 × 2%。
 * ⚠️ 旧接口保留；升级链路请用 parityBonusCascade（按上级拿货价 × 2% × 名额数级联）。
 */
function parityBonus(downlineCostPriceAtUpgrade) {
  return round2(downlineCostPriceAtUpgrade * PARITY_RATE);
}

/**
 * 平级奖（升级链路，用户 2026-10-22 澄清）：
 * 升级采用「每层按买家档价转手」——买家 B 升级，B 的直接上级 A 若与 B 同级，
 * A 转手价 = 进货价，A 不赚差价。于是沿 A 的上级链向上找第一个「等级严格高于 B」
 * 的供货上级 S（实际吃差价者，拿货价最低），
 *   平级奖 = WHOLESALE_PER_QUOTA[S.tier] × 2% × 名额数。
 * 链上所有与 B 同级的上级（A 及其同级上级）各拿一份。
 * @param {string} buyerTier 买家升级后的档（vip/angel/private/cofounder）
 * @param {Array} uplineChain [{id, tier}] 从直接上级向上排列（index 0=直接上级）
 * @param {number} quotaCount 本次名额数
 * @param {boolean} cascade true=链上所有同级上级各拿一份；false=只发直接上级
 * @returns {Object} { sponsorId, sponsorTier, sponsorPrice, perQuota, recipients:[{id,amount}], total }
 */
function parityBonusCascade({ buyerTier, uplineChain = [], quotaCount, cascade = true }) {
  if (uplineChain.length === 0) return { recipients: [], total: 0 };

  // 逐跳（hop）判定：uplineChain[i] 是否与其"下级"同级；
  // 若同级 → 它本层转手不赚钱 → 平级奖 = 它自己的供货上级(uplineChain[i+1])的拿货价 × 2% × 名额数。
  const hops = cascade ? uplineChain.length : 1;
  const recipients = [];
  for (let i = 0; i < hops && i < uplineChain.length; i++) {
    const downlineTier = i === 0 ? buyerTier : uplineChain[i - 1].tier;
    const u = uplineChain[i];
    if (u.tier !== downlineTier) continue;        // 非同级 → 它正常吃差价，不吃平级奖
    const supplier = uplineChain[i + 1];          // 该上级自己的供货来源
    if (!supplier) continue;                      // 它没有上级 → 无资金来源
    const supplierPrice = WHOLESALE_PER_QUOTA[supplier.tier] ?? 0;
    const perQuota = round2(supplierPrice * PARITY_RATE);
    recipients.push({
      id: u.id, tier: u.tier,
      supplierId: supplier.id, supplierTier: supplier.tier, supplierPrice,
      perQuota, amount: round2(perQuota * quotaCount),
    });
  }
  const total = round2(recipients.reduce((s, r) => s + r.amount, 0));
  return { recipients, total };
}

// ───────────────────────── 平级奖（2026-10-24 拍板：从供货上级级差中扣） ─────────────────────────
/**
 * 平级奖（用户 2026-10-24 拍板口径，取代「额外出账/总部吸收」）：
 * 沿「买家 → 卖家 → 卖家上级链」整条链路逐跳判定：
 *   - 第 i 跳转手方( levels[i], i>=1 ) 与其下级( levels[i-1] ) 同级（拿货价相同）
 *     → 该转手方本跳吃不到差价（卖价=自身拿货价）→ 触发平级奖，由该转手方的「供货上级」( levels[i+1] ) 出资。
 *   - 平级奖 = WHOLESALE_PER_QUOTA[供货上级.tier] × 2% × 名额数（以供货上级拿货价为计提基数）。
 *   - 该笔平级奖从供货上级的供货级差中扣除（余额才归供货上级），非额外出账、非总部吸收。
 *   - 若转手方已是链顶（供货上级=总部，无真实级差），则无资金来源 → 不发平级奖。
 *   - checkSeller=false（升级/新客零售）时跳过「卖家本级」(i=1)：卖家按零售差价赚，不触发平级；
 *     仅批发补货(checkSeller=true)时卖家可能与买家同级。
 *
 * @param {Array}  levels     [{id, tier}] 从买家向上：index0=买家, index1=卖家, 之后为卖家上级链（不含总部）
 * @param {number} quotaCount 名额数
 * @param {boolean} checkSeller 是否检查卖家本级(i=1)
 * @returns {{awards:Array, deductions:Object, total:number}}
 *   awards     : [{ recipientId, recipientTier, supplierId, supplierTier, basePrice, perQuota, amount }]
 *   deductions : { [supplierId]: amount }  各供货上级需从其级差中扣除的金额（与 awards 联动）
 */
function parityPlan({ levels = [], quotaCount = 0, checkSeller = true }) {
  const awards = [];
  const deductions = {};
  if (!levels || levels.length < 2) return { awards, deductions, total: 0 };
 for (let i = 1; i < levels.length; i++) {
    if (i === 1 && !checkSeller) continue;            // 升级/新客零售：卖家按零售差价赚，不触发平级
    const me = levels[i];
    const down = levels[i - 1];
    if (me.tier === down.tier) {                       // 同级转手 → 平级奖
      const supplier = levels[i + 1];                   // 供货上级（可能指向总部）
      if (!supplier) continue;                          // 链顶无供货上级 → 无资金来源，不发
      const basePrice = WHOLESALE_PER_QUOTA[supplier.tier] ?? HQ_PRICE_PER_VIP;
      const perQuota = round2(basePrice * PARITY_RATE);
      const amount = round2(perQuota * quotaCount);
      awards.push({
        recipientId: me.id, recipientTier: me.tier,
        supplierId: supplier.id, supplierTier: supplier.tier,
        basePrice, perQuota, amount,
      });
      deductions[supplier.id] = round2((deductions[supplier.id] || 0) + amount);
    }
  }
  const total = round2(awards.reduce((s, a) => s + a.amount, 0));
  return { awards, deductions, total };
}

// ───────────────────────── 区域代理提成（用户 2026-10-22 澄清） ─────────────────────────
/**
 * 区域代理提成。基数默认 = 销售额；特殊产品可切「利润额」（后台可配成本价/售价）。
 * @param {number} amount 实付/销售额
 * @param {number} rate 提成比例（省/市/区/店各自的业务提成率）
 * @param {'sales'|'profit'} mode 提成基数类型
 * @param {number} cost 成本额（mode='profit' 时用，含成本价×数量）
 */
function regionAgentCommission({ amount, rate, mode = 'sales', cost = 0 }) {
  const base = mode === 'profit' ? Math.max(0, amount - cost) : amount;
  return round2(base * rate);
}

// ───────────────────────── 合店（门店）分红（2026-10-22 用户口径最终确认） ─────────────────────────
/**
 * 合店费 = 698 元/月；「开通合店老板 6 个月」= 698 × 6 = 4188 元。
 *
 * 固定三分结构（用户 2026-10-22 逐字口径，不再分 S1/S2/S3 场景）：
 *   1) 总部体系 35% = 总部 15% + 省 2% + 市 8% + 区/县 10%
 *   2) 门店侧  65% = 门店老板 53% + 推荐人 2%（复购奖）+ 合店店长分红池 10%
 *   3) 分红池 10%：一半按合店店长人数均分 + 一半按各合店店长的合店费业绩占比分
 *
 *   闭环校验：15 + 2 + 8 + 10 + 53 + 2 + 10 = 100%
 *
 *   「推荐人 2%」即用户所说的**复购奖**：归本单推荐人（cs.promoter_id）。
 *     · 推荐人与门店老板为同一人时，两笔叠加（53% + 2%），但分两条流水记录，便于核对。
 *     · 多人门店时，53% 按门店老板人数均分；2% 不均分（属于推荐人个人）。
 *
 *   「合店店长」名单 = coStores[].owners / partners 中 feePerf > 0 者（实际做过推荐）。
 */
const COSTORE_FEE_MONTHLY = 698;
const COSTORE_RATE = {
  hq: 0.15, province: 0.02, city: 0.08, district: 0.10,
  storeOwner: 0.53,   // 门店老板（多人门店按人数均分）
  referrerRebate: 0.02, // 本单推荐人 = 复购奖
  dividend: 0.10,     // 合店店长分红池（一半均分 + 一半业绩占比）
};
/** 兼容旧字段名（历史 API 返回体 / 前端展示用） */
const COSTORE_REFERRER = { STORE_OWNER: 'storeOwner', CO_STORE_BOSS: 'coStoreBoss', OTHER: 'other' };
// 区域代理在合店费中的提点率（省/市/区县）；总部另得 15%
const COSTORE_AGENT_RATE = { province: 0.02, city: 0.08, district: 0.10 };

/** 元 → 分（整数），规避浮点漂移 */
function toCents(n) { return Math.round(n * 100); }
/** 分 → 元 */
function toYuan(c) { return Math.round(c) / 100; }

/**
 * 合店费完整分配（分单位整数）。余数并入「分红池」，保证 100% 闭环。
 * @param {number} fee 合店费
 * @returns {Object} { hq, province, city, district, storeOwner, referrerRebate, dividend, total }（分）
 */
function coStoreAllocateCents(fee) {
  const c = toCents(fee);
  const a = {
    hq: Math.round(c * COSTORE_RATE.hq),
    province: Math.round(c * COSTORE_RATE.province),
    city: Math.round(c * COSTORE_RATE.city),
    district: Math.round(c * COSTORE_RATE.district),
    storeOwner: Math.round(c * COSTORE_RATE.storeOwner),
    referrerRebate: Math.round(c * COSTORE_RATE.referrerRebate),
  };
  a.dividend = c - (a.hq + a.province + a.city + a.district + a.storeOwner + a.referrerRebate);
  a.total = c;
  return a;
}

/** 合店费拆分：总部体系 35%（15+2+8+10），门店侧 65%（53+2+10） */
function coStoreSplit(fee) {
  const a = coStoreAllocateCents(fee);
  return {
    hq: toYuan(a.hq),
    province: toYuan(a.province),
    city: toYuan(a.city),
    district: toYuan(a.district),
    hqSystem: toYuan(a.hq + a.province + a.city + a.district),   // 35%
    storeOwner: toYuan(a.storeOwner),                             // 53%
    referrerRebate: toYuan(a.referrerRebate),                     // 2% 复购奖
    dividend: toYuan(a.dividend),                                 // 10% 分红池
    storeShareholders: toYuan(a.storeOwner + a.referrerRebate + a.dividend), // 65%（兼容旧字段）
    closure: toYuan(a.hq + a.province + a.city + a.district + a.storeOwner + a.referrerRebate + a.dividend) === toYuan(a.total),
  };
}

/** 门店侧 65% 明细：门店老板 53% / 推荐人复购奖 2% / 合店店长分红池 10% */
function coStoreOwnerDetail(fee) {
  const s = coStoreSplit(fee);
  return {
    hq: s.hq, province: s.province, city: s.city, district: s.district,
    storeService: s.storeOwner,   // 兼容旧字段名：门店老板 53%
    storeOwner: s.storeOwner,
    referrerRebate: s.referrerRebate,   // 复购奖 2%
    dividendPool: s.dividend,           // 分红池 10%
    storeOwnerTotal: s.storeOwner,
    storeProfit: round2(s.dividend),    // 兼容旧字段名
    storeShareholders: s.storeShareholders,
    closure: s.closure,
  };
}

/**
 * 门店侧 65% 三分分解（替代旧「服务40% + 利润25%」口径）
 * @returns {{storeOwner:number, referrerRebate:number, dividend:number, storeSide:number, closure:boolean}}
 */
function coStoreProfitBreakdown(fee) {
  const a = coStoreAllocateCents(fee);
  const storeOwner = toYuan(a.storeOwner);
  const referrerRebate = toYuan(a.referrerRebate);
  const dividend = toYuan(a.dividend);
  return {
    storeOwner, referrerRebate, dividend,
    storeSide: round2(storeOwner + referrerRebate + dividend),   // 65%
    personal: storeOwner,        // 兼容旧字段名（旧 13%+40% 合并为 53%）
    partnerBonus: referrerRebate,// 兼容旧字段名（复购奖）
    personalGroup: round2(storeOwner + referrerRebate),
    closure: round2(storeOwner + referrerRebate + dividend) === toYuan(a.storeOwner + a.referrerRebate + a.dividend),
  };
}

/**
 * 复购奖：合店费的 2%，归本单推荐人。
 * 说明：这里返回的是「2% 复购奖」本身；实物产品的复购奖另按 2% 级差走（physicalTierDiff / repurchaseBonus）。
 */
function coStorePartnerBonus(fee) {
  const a = coStoreAllocateCents(fee);
  return {
    referrerRebate: toYuan(a.referrerRebate),
    partnerBonus: toYuan(a.referrerRebate), // 兼容旧字段名
    total: toYuan(a.referrerRebate),
  };
}

/**
 * 合店费分配（固定三分结构 + 多人门店均分）→ 产出「业务提点」。
 *
 * @param {number} fee 合店费（如 4188 = 698×6）
 * @param {Object} opt
 *   ownerCount : 门店老板人数（默认 1；多人时 53% 按人数均分）
 *   owners     : [{ id, feePerf }]  合店店长名单，feePerf = 该店长贡献的合店费推广业绩
 *   referrer   : 兼容字段，当前不参与分配（固定结构），仅回显
 * @returns {Object} { fee, referrer, ownerCount, tipRate, tipRatePerOwner, buckets, storeOwner, referrerAmount, dividend, closure }
 */
function coStoreFeeAllocation(fee, opt = {}) {
  const valid = Object.values(COSTORE_REFERRER);
  const referrer = valid.includes(opt.referrer) ? opt.referrer : COSTORE_REFERRER.OTHER;
  const ownerCount = Math.max(1, opt.ownerCount || 1);
  const a = coStoreAllocateCents(fee);

  // 固定结构：门店老板 53%（多人按人数均分），推荐人 2%（复购奖，不均分）
  const storeOwnerCents = a.storeOwner;
  const referrerCents = a.referrerRebate;

  const perOwner = Math.floor(storeOwnerCents / ownerCount);
  const storeOwnerRemainder = storeOwnerCents - perOwner * ownerCount;

  const dividend = coStorePartnerDividend(fee, opt.owners || []);
  const tipRate = storeOwnerCents / a.total;   // 恒为 0.53

  return {
    fee: toYuan(a.total),
    referrer, ownerCount,
    tipRate: round4(tipRate),                       // 恒为 53%
    tipRatePerOwner: round4(perOwner / a.total),    // 均分后每名门店老板提点率
    buckets: {
      hq: toYuan(a.hq), province: toYuan(a.province), city: toYuan(a.city), district: toYuan(a.district),
      storeOwner: toYuan(a.storeOwner), referrerRebate: toYuan(a.referrerRebate), dividend: toYuan(a.dividend),
      storeService: toYuan(a.storeOwner),           // 兼容旧字段名
      personal: toYuan(a.storeOwner),               // 兼容旧字段名
      partnerBonus: toYuan(a.referrerRebate),       // 兼容旧字段名
    },
    storeOwner: {
      storeService: toYuan(a.storeOwner),           // 兼容旧字段名
      storeOwner: toYuan(a.storeOwner),
      personalShare: toYuan(a.storeOwner),          // 兼容旧字段名
      total: toYuan(storeOwnerCents),
      perOwner: toYuan(perOwner),
      perOwnerRemainder: toYuan(storeOwnerRemainder),
    },
    referrerAmount: toYuan(referrerCents),           // 恒为 2% 复购奖
    referrerRebateRate: round4(referrerCents / a.total),
    dividend,
    closure: toYuan(storeOwnerCents + referrerCents + a.dividend + a.hq + a.province + a.city + a.district) === toYuan(a.total),
  };
}

/**
 * 合店店长（推广）分红：合店费 10%，一半按人数均分、一半按合店费业绩占比。
 * 资格：仅「实际做过推荐（feePerf>0）」的合店店长参与；未推荐者不分配（用户 2026-10-22 澄清）。
 * @param {number} fee 合店费
 * @param {Array} partners [{id, feePerf}] feePerf=该合店店长贡献的合店费业绩
 */
function coStorePartnerDividend(fee, partners = []) {
  // 以「分」为单位整数分摊，避免浮点/三位小数取整漂移；余数归位保证合计严格等于池
  const poolC = Math.round(fee * 100 * COSTORE_RATE.dividend);
  const halfEqualC = Math.floor(poolC / 2);
  const halfPerfC = poolC - halfEqualC;
  const pool = round2(poolC / 100);

  // 仅实际推荐者（feePerf>0）有资格；未推荐者不分配
  const eligible = (partners || []).filter((p) => (p.feePerf || 0) > 0);
  const skipped = (partners || []).filter((p) => (p.feePerf || 0) <= 0).map((p) => ({ id: p.id, eligible: false, total: 0 }));
  if (eligible.length === 0) {
    return { pool, halfEqual: round2(halfEqualC / 100), halfPerf: round2(halfPerfC / 100), partners: skipped, undistributed: pool };
  }

  const n = eligible.length;
  const totalPerf = eligible.reduce((s, p) => s + (p.feePerf || 0), 0);
  const eqBase = Math.floor(halfEqualC / n);
  const eqRem = halfEqualC - eqBase * n;

  const perfC = eligible.map((p) => Math.floor((halfPerfC * (p.feePerf || 0)) / totalPerf));
  const perfRem = halfPerfC - perfC.reduce((a, b) => a + b, 0);
  perfC[perfC.length - 1] += perfRem;   // 业绩余数归最后一人

  const out = eligible.map((p, i) => {
    const equalC = eqBase + (i === n - 1 ? eqRem : 0); // 均分余数归最后一人
    return { id: p.id, eligible: true, equal: round2(equalC / 100), perf: round2(perfC[i] / 100), total: round2((equalC + perfC[i]) / 100) };
  });
  return { pool, halfEqual: round2(halfEqualC / 100), halfPerf: round2(halfPerfC / 100), partners: [...out, ...skipped], undistributed: 0 };
}

// ───────────────────────── 区域代理在合店费中的提成 ─────────────────────────
/**
 * 区域代理视角：合店费提成率 省 2% / 市 8% / 区县 10%（总部另得 15%）。
 * @param {'province'|'city'|'district'} regionType
 * @param {number} fee 合店费
 */
function coStoreAgentCommission(regionType, fee) {
  const rate = COSTORE_AGENT_RATE[regionType];
  if (rate == null) throw new Error('未知代理层级: ' + regionType);
  return { regionType, rate, amount: round2(fee * rate) };
}


// ───────────────────────── 门店服务费（§二） ─────────────────────────
/** 门店服务费拆分；tier: 'v1'|'v2'|'v3'|'co' */
function storeServiceFee(tier) {
  const s = STORE_FEE[tier];
  if (!s) throw new Error('未知门店产品包: ' + tier);
  return {
    subtotal: s.subtotal,
    store: s.store, district: s.district, city: s.city, province: s.province,
  };
}

// ───────────────────────── 总部产品费（§二） ─────────────────────────
function hqProductFee(vipCount) {
  return HQ_PRODUCT_FEE_PER_VIP * vipCount;
}

// ───────────────────────── 升级差价（Q4） ─────────────────────────
function upgradeDiff(fromTier, toTier) {
  const key = `${fromTier}_to_${toTier}`;
  const v = UPGRADE_DIFF[key];
  if (v == null) throw new Error('无此升级路径: ' + key);
  return v;
}

// ───────────────────────── 定价基础（用户确认：拿货价 = 每名额价格） ─────────────────────────
/** 某产品包零售价（客户付费 / 批发商买阶加入费） */
function retailPrice(packageTier) {
  const p = RETAIL_PRICE[packageTier];
  if (p == null) throw new Error('未知产品包: ' + packageTier);
  return p;
}
/** 某卖方卖给下线的某产品包「拿货价」= 名额数 × 该卖方每名额拿货价（恒定） */
function wholesaleCost(sellerTier, packageTier) {
  const q = TIER_VIP[packageTier];
  const per = WHOLESALE_PER_QUOTA[sellerTier];
  if (q == null || per == null) throw new Error('未知等级: ' + sellerTier + '/' + packageTier);
  return q * per;
}
/** 单笔批发商利润 = 零售价 − 拿货价（适用于「向上级卖给终端用户/下级整包」场景） */
function wholesalerProfit(sellerTier, packageTier) {
  return round2(retailPrice(packageTier) - wholesaleCost(sellerTier, packageTier));
}

/**
 * 合伙人供货差价（电梯规则下的「梯队转移价」，用户 2026-10-22 确认口径）：
 * 上级(sellerTier) 向绑定下级(downlineTier) 提供 quotaCount 个 VIP 名额时，
 * 下级按其「档拿货价」付费，上级按自身「档拿货价」成本，
 * 差价 = (下级档价 − 上级档价) × 名额数。
 * 例：联创(6500) 供天使(7500) 20 名额 → (7500−6500)×20 = 20000。
 * 注意：名额按「原始 VIP 配额单位」计，不做 天使=3/私董=6 的折算（那仅用于整包定义）。
 */
function supplySpread(sellerTier, downlineTier, quotaCount) {
  const up = WHOLESALE_PER_QUOTA[sellerTier];
  const down = WHOLESALE_PER_QUOTA[downlineTier];
  if (up == null || down == null) throw new Error('未知等级: ' + sellerTier + '/' + downlineTier);
  return round2((down - up) * quotaCount);
}

function round2(n) { return Math.round(n * 100) / 100; }
/** 比例保留 4 位小数（如 27.5% → 0.275） */
function round4(n) { return Math.round(n * 10000) / 10000; }

module.exports = {
  RETAIL_PRICE, TIER_VIP, WHOLESALE_PER_QUOTA, DIRECT_RATIO, DIRECT_BIZ_RATIO, GLOBAL_UNIT, HQ_PRODUCT_FEE_PER_VIP,
  HQ_PRICE_PER_VIP, FOUNDING_RATE, STORE_FEE, STORE_RATIO, UPGRADE_DIFF, PARITY_RATE, REBUY_RATE,
  vipCredit, computeGlobalBonus, directBonus, directBonusDetail, resolveDirectRate, repurchaseBonus, parityBonus, parityBonusCascade, parityPlan,
  storeServiceFee, hqProductFee, upgradeDiff, coStoreSplit,
  regionAgentCommission, coStoreOwnerDetail, coStoreProfitBreakdown, coStorePartnerDividend, coStorePartnerBonus,
  coStoreFeeAllocation, coStoreAllocateCents, coStoreAgentCommission,
  COSTORE_FEE_MONTHLY, COSTORE_RATE, COSTORE_REFERRER, COSTORE_AGENT_RATE,
  retailPrice, wholesaleCost, wholesalerProfit, supplySpread, round2, round4,
};

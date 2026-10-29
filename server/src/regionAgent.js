/**
 * 区域代理 / 门店老板 计算逻辑
 *
 * 权威依据：桌面 `tp123` 蓝湖原型截图（99 张，2026-10-22 读取） + 用户 2026-10-22 16:17 口述澄清
 * + 用户 2026-10-23 新规格（图1 价格表 / 图2+图3 特色产品分成 / 图4 股东1人 / 图5 产品表，
 *   产品域规则见 productSplit.js；新价格表与技术费见 AGENT_PRICE_TABLE）
 *
 * ════════════════════════════════════════════════════════════════════
 * 一、代理级别与门槛（tp123 note 01「区域代理/代理费」）
 * ════════════════════════════════════════════════════════════════════
 *  省代（10 联创）：品牌费 200w+60w、设备费 30w、保证金 30w，合计 260w
 *  市代（联创）  ：>1000w→45w / 500~1000w→40w / <500w→35w
 *  区县代（私董）：品牌费 10w + 设备费 1w + 保证金 1w = 12w
 *  单店（高级）  ：品牌费 4w + 设备费 2w + 保证金 2w = 8w（申请单店代理页 ¥80000）
 *
 * ════════════════════════════════════════════════════════════════════
 * 二、分成表（tp123 note 01）
 * ════════════════════════════════════════════════════════════════════
 *  级别   B端业务  B端服务  C端门店交付  C端总部交付  VIP合伙人  供应链
 *  省代     20%     10%(2%)   10%(2%)     10%(2%)    200元(35元)  3折
 *  市代     18%      8%        8%          8%        165元(65元)  3.5折
 *  区县代   15%      —        75%         35%        100元        4折
 *  单店     15%      —        65%         30%          —         5折
 *
 * ════════════════════════════════════════════════════════════════════
 * 三、实物产品分润（tp123 note 00「商品分类·一、实物产品」）
 * ════════════════════════════════════════════════════════════════════
 *  1. 合伙人购买价 = 基准价（去成本，成本可为 0）× 折扣
 *     VIP 8折 / 天使 7.5折 / 私董 7折 / 联创 6.5折
 *     上级合伙人另拿 2% 复购奖
 *  2. 区域代理赚中间折扣差价（折扣越低拿货越便宜）
 *     单店代理 5折 / 区县代 4折 / 市代 3.5折 / 省代 3折
 *
 *  【官方算例】平板 6980、成本 0
 *    天使合伙人购买价 = 6980×0.75 = 5235；天使的上级合伙人得 5235×0.02 = 104.7 复购奖
 *    洛阳市代拿货价  = 6980×0.35 = 2443；洛阳市代收益 = 5235 − 2443 = 2792
 *    总部收益         = 2443 − 104.7 = 2338.3
 *    VIP 用户买平板，绑定人是二七区某门店单店店长（拿 8 折后 2% 复购奖），
 *    注册进来绑定的门店是管城区某门店：门店赚 6980×(0.8−0.5)，区县赚 6980×(0.5−0.4)
 *
 * ════════════════════════════════════════════════════════════════════
 * 四、虚拟产品分润（tp123 note 00「二、虚拟产品」：课程 / 会员卡 / 合店费）
 * ════════════════════════════════════════════════════════════════════
 *  合伙人折扣同实物：VIP 8折 / 天使 7.5折 / 私董 7折 / 联创 6.5折
 *  区域代理按【剩余比例】分成（不是折扣价差！）：
 *    (1) 总部交付：总部 55%、省代 2%、市代 8%、单店 35%（业务提成）
 *    (2) 门店交付：总部 25%（包含省代 2%、市代 8%、总部 15%）、单店 75%
 *        → 顶层等价于：总部 15% + 省代 2% + 市代 8% + 单店 75% = 100%
 *
 *  【官方算例】会员卡 1000 一个月，私董购买月卡 700 元
 *    总部拿 700×0.15 = 105；省代拿 700×0.02 = 14；市代拿 700×0.08 = 56；
 *    单店拿 700×0.75 = 525
 *    （单店 525 内部：0.5 给门店股东、0.05~0.15 给推荐人、0.1 给合店老板分红）
 *
 * ════════════════════════════════════════════════════════════════════
 * 五、行政费（tp123 note 00「三、行政费」）
 * ════════════════════════════════════════════════════════════════════
 *  集训营基础费用：总部 5% + 销售门店股东 5% + 交付方 90%（上课的团队）
 */
const { round2 } = require('./commission');

// ───────────── 代理级别（tp123 note 01） ─────────────
const AGENT_LEVELS = ['province', 'city', 'district', 'store'];
const LEVEL_CN = {
  province: '省代', city: '市代', district: '区县代', store: '单店',
  cofounder: '联创', private: '私董', angel: '天使', vip: 'VIP',
};
const AGENT_TIER = { province: 'cofounder', city: 'cofounder', district: 'private', store: 'angel' };

/**
 * 代理级别门槛费（tp123 note 01 + 申请单店代理页）
 * 单位：元。city 按规模分三档。
 */
const AGENT_THRESHOLD_FEE = {
  province: { brand: 2000000, extra: 600000, device: 300000, deposit: 300000, total: 2600000 },
  city: [
    { range: '>1000w', brand: 350000, device: 100000, deposit: 0, total: 450000 },
    { range: '500w~1000w', brand: 300000, device: 50000, deposit: 50000, total: 400000 },
    { range: '<500w', brand: 250000, device: 0, deposit: 0, total: 350000 },
  ],
  district: { brand: 100000, device: 10000, deposit: 10000, total: 120000 },
  store: { brand: 40000, device: 20000, deposit: 20000, total: 80000 },
};

/**
 * 分成表（tp123 note 01）
 *  bBiz      B端（代理）业务提点
 *  bService  B端（代理）服务提点（括号内数字为其中归属部分）
 *  cStore    C端（会员）门店交付
 *  cHq       C端（会员）总部交付
 *  vipPartnerVIP 合伙人时给本级代理的奖励
 *  supply    产品（供应链）折扣
 */
const AGENT_SHARE = {
  province: { bBiz: 0.20, bService: 0.10, bServiceSub: 0.02, cStore: 0.10, cStoreSub: 0.02, cHq: 0.10, cHqSub: 0.02, vipPartner: 200, vipPartnerSub: 35, supply: 0.30 },
  city:     { bBiz: 0.18, bService: 0.08, bServiceSub: null, cStore: 0.08, cStoreSub: null, cHq: 0.08, cHqSub: null, vipPartner: 165, vipPartnerSub: 65, supply: 0.35 },
  district: { bBiz: 0.15, bService: null, bServiceSub: null, cStore: 0.75, cStoreSub: null, cHq: 0.35, cHqSub: null, vipPartner: 100, vipPartnerSub: null, supply: 0.40 },
  store:    { bBiz: 0.15, bService: null, bServiceSub: null, cStore: 0.65, cStoreSub: null, cHq: 0.30, cHqSub: null, vipPartner: null, vipPartnerSub: null, supply: 0.50 },
};

/** 门槛费（城市代按规模三档，取默认档） */
function agentThresholdFee(regionType, cityTier = 1) {
  const f = AGENT_THRESHOLD_FEE[regionType];
  if (Array.isArray(f)) return { regionType, ...f[cityTier] };
  return { regionType, ...f };
}

// ───────────── 新价格表（用户 2026-10-23 图1，按人数分档） ─────────────
/**
 * 代理价格表（图1读法，2026-10-23 用户新规格，取代 tp123 旧门槛费）：
 *   省代      260w（技术费=品牌费 200w）
 *   市代      按人数：≥1000人 35w / 500~1000人 30w / <500人 20w
 *   区县代    按人数：≥300人 30w / 100~300人 20w / <100人 10w
 *   单店代理  8w（技术费=品牌费 4w，用户明确口径：直推奖按 4w 计而非 8w）
 *
 * ⚠ 技术费说明：用户明确「直推提成只算技术费、交的费用算合计」。
 *   单店代理 8w = 品牌费4w + 设备费2w + 保证金2w → 技术费 4w（已确认）。
 *   省代 260w 中品牌费 200w（tp123 分项）→ 技术费 200w。
 *   市代/区县代图1未给出分项明细 → 技术费暂按合计全额计（假设项，待用户确认后改此表即可）。
 */
const AGENT_PRICE_TABLE = {
  province: {
    label: '省代', tiers: [
      { range: '全部', total: 2600000, techFee: 2000000, note: '品牌费200w+60w+设备30w+保证金30w' },
    ],
  },
  city: {
    label: '市代', tiers: [
      { range: '≥1000人', total: 350000, techFee: 350000 },
      { range: '500~1000人', total: 300000, techFee: 300000 },
      { range: '<500人', total: 200000, techFee: 200000 },
    ],
  },
  district: {
    label: '区县代', tiers: [
      { range: '≥300人', total: 300000, techFee: 300000 },
      { range: '100~300人', total: 200000, techFee: 200000 },
      { range: '<100人', total: 100000, techFee: 100000 },
    ],
  },
  store: {
    label: '单店代理', tiers: [
      { range: '全部', total: 80000, techFee: 40000, note: '品牌费4w+设备费2w+保证金2w；技术费=品牌费4w（用户确认）' },
    ],
  },
};

/** 取新价格表某一档（tier 越界时取最高价档，避免少收费） */
function agentPrice(regionType, tier = 0) {
  const t = AGENT_PRICE_TABLE[regionType];
  if (!t) throw new Error(`未知代理级别：${regionType}`);
  const idx = Number.isInteger(tier) && tier >= 0 && tier < t.tiers.length ? tier : 0;
  const row = t.tiers[idx];
  return { regionType, label: t.label, tierIndex: idx, ...row };
}

/** 技术费（直推代理奖 / 业务提成的计费基数；交的费用是合计，提成只算技术费） */
function agentTechFee(regionType, tier = 0) {
  return agentPrice(regionType, tier).techFee;
}

/** 合伙人直推奖比例（与 commission.DIRECT_RATIO 一致：VIP5%/天使10%/私董15%/联创15%） */
const PARTNER_DIRECT_RATIO = { vip: 0.05, angel: 0.10, private: 0.15, cofounder: 0.15 };

/**
 * 直推代理奖（用户 2026-10-23）：合伙人直推一人成为代理，
 *   按「新代理技术费 × 推荐人合伙人身份的直推奖比例」发放。
 *   算例：联创直推单店代理 → 40000 × 15% = 6000（不是 80000×15%）
 * @param {object} opt { developerTier, newRegionType, newTier }
 */
function agentDirectReferralBonus({ developerTier, newRegionType, newTier = 0 }) {
  const rate = PARTNER_DIRECT_RATIO[developerTier];
  if (rate == null) throw new Error(`未知合伙人档位：${developerTier}`);
  const techFee = agentTechFee(newRegionType, newTier);
  const amount = round2(techFee * rate);
  return {
    kind: 'agent_direct', developerTier, newRegionType, newTier,
    techFee, totalFee: agentPrice(newRegionType, newTier).total, rate, amount,
    formula: `新技术费 ${techFee} × ${Math.round(rate * 100)}%（${developerTier} 直推奖） = ${amount}`,
    note: '直推奖只算技术费，不算合计',
  };
}

/**
 * 业务提成（用户 2026-10-23）：开发新代理时，按「新代理技术费 × 开发代理身份的业务提点」发放。
 *   算例：市代开发单店代理 → 40000 × 18% = 7200；区县代开发 → 40000 × 15% = 6000
 * @param {object} opt { developerRegionType, newRegionType, newTier }
 */
function agentBusinessCommission({ developerRegionType, newRegionType, newTier = 0 }) {
  const share = AGENT_SHARE[developerRegionType];
  if (!share) throw new Error(`未知代理级别：${developerRegionType}`);
  const techFee = agentTechFee(newRegionType, newTier);
  const rate = share.bBiz;
  const amount = round2(techFee * rate);
  return {
    kind: 'agent_biz', developerRegionType, newRegionType, newTier,
    techFee, totalFee: agentPrice(newRegionType, newTier).total, rate, amount,
    formula: `新技术费 ${techFee} × ${Math.round(rate * 100)}%（${AGENT_PRICE_TABLE[developerRegionType].label} 业务提点） = ${amount}`,
  };
}

/**
 * 任命代理时的两笔提成（直推代理奖 + 业务提成），供 store.appointAgent 落账。
 * 两笔都发、分别按「合伙人身份」与「开发代理身份」计算；推荐人无对应身份时该项为 null。
 * @param {object} referrer { id, tier, regionType }  tier=合伙人档位；regionType=代理级别（无则 null）
 * @param {object} newAgent { regionType, tier }
 */
function agentAppointmentCommissions(referrer, newAgent) {
  const out = { direct: null, business: null };
  if (!referrer || !referrer.id) return out;
  const { regionType: newRegionType, tier: newTier = 0 } = newAgent;
  if (referrer.tier && PARTNER_DIRECT_RATIO[referrer.tier] != null) {
    out.direct = agentDirectReferralBonus({ developerTier: referrer.tier, newRegionType, newTier });
  }
  if (referrer.regionType && AGENT_SHARE[referrer.regionType]) {
    out.business = agentBusinessCommission({ developerRegionType: referrer.regionType, newRegionType, newTier });
  }
  return out;
}

// ───────────── 商品折扣（tp123 note 00） ─────────────
/**
 * 实物产品折扣（相对基准价）
 *  合伙人侧：VIP 8折 / 天使 7.5折 / 私董 7折 / 联创 6.5折
 *  代理侧  ：单店 5折 / 区县 4折 / 市 3.5折 / 省 3折
 */
const PHYSICAL_DISCOUNT = {
  partner: { vip: 0.80, angel: 0.75, private: 0.70, cofounder: 0.65 },
  agent:   { store: 0.50, district: 0.40, city: 0.35, province: 0.30 },
};
/** 合伙人侧折扣（实物与虚拟通用） */
const PARTNER_DISCOUNT = PHYSICAL_DISCOUNT.partner;
/** 代理侧折扣（仅实物） */
const AGENT_DISCOUNT = PHYSICAL_DISCOUNT.agent;

/** 兼容旧字段：1000 基准价下的绝对价格表（由折扣换算，数值等价） */
const GOODS_PRICE = {
  physical: { province: 300, city: 350, district: 400, store: 500, cofounder: 650, private: 700, angel: 750, vip: 800 },
  card:     { province: 150, city: 170, district: 250, store: 350, cofounder: 650, private: 700, angel: 750, vip: 800 },
};
GOODS_PRICE.course = GOODS_PRICE.card;

/** 复购奖 2%（实物上级合伙人 / 虚拟推荐人） */
const GOODS_REPURCHASE_RATE = 0.02;

// ───────────── ① 区域奖（VIP 成交，3000 门店服务费拆分） ─────────────
// 用户口述（2026-10-22 16:17）：每卖 1 个 VIP，总部从 6500 中拿出 3000「门店服务费」
// 额外奖励给 门店店长 / 区县代 / 市代 / 省代。
// 拆分（每 VIP）：门店店长 2400 / 区县代 300 / 市代 200 / 省代 100，合计 3000 闭环。
const STORE_SERVICE_PER_VIP = 3000;
const REGION_VIP_BONUS = { province: 100, city: 200, district: 300 };

function regionVipBonus(regionType, vipCount = 1) {
  const per = REGION_VIP_BONUS[regionType];
  if (per == null) return null;
  return { region_type: regionType, perVip: per, vipCount, amount: round2(per * vipCount) };
}

/** 门店服务费 3000/VIP 拆分（省/市/区县 区域奖 + 门店余额） */
function storeServiceSplit() {
  const p = REGION_VIP_BONUS.province;
  const c = REGION_VIP_BONUS.city;
  const d = REGION_VIP_BONUS.district;
  const store = STORE_SERVICE_PER_VIP - p - c - d;
  return {
    province: p, city: c, district: d, store,
    total: p + c + d + store,
    closure: p + c + d + store === STORE_SERVICE_PER_VIP,
  };
}

// ───────────── ② 实物产品级差（按折扣率差） ─────────────
/** 取某档位的实物折扣率（0.80 = 8折） */
function physicalDiscount(level) {
  if (PARTNER_DISCOUNT[level] != null) return PARTNER_DISCOUNT[level];
  if (AGENT_DISCOUNT[level] != null) return AGENT_DISCOUNT[level];
  throw new Error(`未知档位：${level}`);
}

/**
 * 实物级差：卖方按自身折扣进货、按买方折扣卖出，赚「折扣率差 × 基准价」。
 *
 * 【官方算例 1】平板 6980，天使（0.75）向市代（0.35）进货
 *   进价 = 6980×0.35 = 2443，卖价 = 6980×0.75 = 5235，市代收益 = 2792
 * 【官方算例 2】VIP（0.8）向单店（0.5）进货
 *   门店赚 6980×(0.8−0.5) = 2094；区县再赚 6980×(0.5−0.4) = 698
 *
 * @param {string} sellerLevel 卖方档位（合伙人档 vip/angel/private/cofounder 或代理档 province/city/district/store）
 * @param {string} buyerLevel  买方档位
 * @param {number} qty         数量
 * @param {number} basePrice   基准价（成本可视为 0）
 */
function physicalTierDiff(sellerLevel, buyerLevel, qty = 1, basePrice = 6980) {
  const s = physicalDiscount(sellerLevel);
  const b = physicalDiscount(buyerLevel);
  const unitDiff = round2((b - s) * basePrice);
  return {
    kind: 'physical', sellerLevel, buyerLevel,
    sellerDiscount: s, buyerDiscount: b,
    basePrice, qty, unitDiff,
    buyPrice: round2(s * basePrice), sellPrice: round2(b * basePrice),
    amount: round2(unitDiff * qty),
    // 方向说明：amount 为「卖方」的级差收益（卖方按自身折扣进货、按买方折扣卖出）
    // 例：官方算例「VIP 向单店进货」→ sellerLevel='store', buyerLevel='vip'，门店赚 2094
    note: 'sellerLevel=供货方档位，buyerLevel=收货方档位；amount 为供货方的级差收益（正数=供货方赚钱）',
  };
}

/** 兼容旧签名：goodsTierDiff(kind, sellerLevel, buyerLevel, qty, salePrice) */
function goodsTierDiff(kind, sellerLevel, buyerLevel, qty = 1, salePrice = 1000) {
  if (kind === 'physical') {
    const r = physicalTierDiff(sellerLevel, buyerLevel, qty, salePrice * 6.98);
    // 旧口径以 1000 为基准，等价换算回 1000 基准
    const perUnit1000 = round2((r.buyerDiscount - r.sellerDiscount) * 1000);
    return { kind, sellerLevel, buyerLevel, perUnit: perUnit1000, qty, amount: round2(perUnit1000 * qty) };
  }
  const table = GOODS_PRICE[kind];
  if (!table) throw new Error(`未知商品类型：${kind}`);
  const unitBase = table[buyerLevel] - table[sellerLevel];
  const perUnit = round2(unitBase * salePrice / 1000);
  return { kind, sellerLevel, buyerLevel, perUnit, qty, amount: round2(perUnit * qty) };
}

/** 复购奖：按成交金额 × 2%（tp123：私董 700 买平板，上级联创拿 700×0.02 = 14） */
function goodsRepurchase(paidAmount) {
  return round2(paidAmount * GOODS_REPURCHASE_RATE);
}

// ───────────── ③ 虚拟产品：按剩余比例分成（tp123 note 00） ─────────────
/**
 * 虚拟产品（课程/会员卡/合店费）区域代理分配。
 * 合伙人按折扣买（VIP8/天使7.5/私董7/联创6.5），代理层按【剩余比例】分成：
 *   总部交付：总部 55%、省代 2%、市代 8%、单店 35%
 *   门店交付：总部 25%（含省代 2%、市代 8%、总部 15%）、单店 75%
 *
 * 【官方算例】私董购买月卡 700 元 → 总部 105 / 省 14 / 市 56 / 单店 525
 *
 * @param {number} paidAmount 合伙人实付金额（进入分配池的基数）
 * @param {string} deliveryType 'hq' 总部交付 | 'store' 门店交付
 */
const VIRTUAL_DELIVERY_SPLIT = {
  hq:    { hq: 0.55, province: 0.02, city: 0.08, store: 0.35 },
  store: { hq: 0.15, province: 0.02, city: 0.08, store: 0.75 },
};
/** 门店交付场景中，总部 25% 的内部构成（tp123 note 00） */
const VIRTUAL_STORE_DELIVERY_BREAKDOWN = { hq: 0.15, province: 0.02, city: 0.08 };
/** 单店 75% 内部：门店股东 0.5 / 推荐人 0.05~0.15 / 合店老板分红 0.1（相对分配池） */
const VIRTUAL_STORE_INNER = { storeOwner: 0.50, referrerMin: 0.05, referrerMax: 0.15, dividend: 0.10 };

function virtualDeliverySplit(paidAmount, deliveryType = 'store') {
  const t = VIRTUAL_DELIVERY_SPLIT[deliveryType];
  if (!t) throw new Error(`非法交付类型：${deliveryType}（应为 hq | store）`);
  const pool = round2(paidAmount);
  const out = {
    deliveryType, pool,
    hq: round2(pool * t.hq),
    province: round2(pool * t.province),
    city: round2(pool * t.city),
    store: round2(pool * t.store),
  };
  out.total = round2(out.hq + out.province + out.city + out.store);
  out.closure = Math.abs(out.total - pool) < 0.01;
  if (deliveryType === 'store') {
    out.breakdown = {
      hq: round2(pool * VIRTUAL_STORE_DELIVERY_BREAKDOWN.hq),
      province: round2(pool * VIRTUAL_STORE_DELIVERY_BREAKDOWN.province),
      city: round2(pool * VIRTUAL_STORE_DELIVERY_BREAKDOWN.city),
      store: round2(pool * t.store),
    };
    out.storeInner = {
      storeOwner: round2(pool * VIRTUAL_STORE_INNER.storeOwner),
      referrerMin: round2(pool * VIRTUAL_STORE_INNER.referrerMin),
      referrerMax: round2(pool * VIRTUAL_STORE_INNER.referrerMax),
      dividend: round2(pool * VIRTUAL_STORE_INNER.dividend),
    };
  }
  return out;
}

// ───────────── ④ 门店交付（按代理级别的 C 端门店交付比例） ─────────────
/** 门店股东固定 1 人（用户 2026-10-23 图4：排除多股东；保留入参仅为旧数据兼容） */
const STORE_OWNER_COUNT = 1;

/**
 * 门店交付分配（tp123 分成表 C端门店交付 + 收益详情 87.png）
 *  区县代门店交付 75%、单店门店交付 65%（多股东均分，收益详情显示业务提点 32.5% = 65%/2）
 *  推荐人复购奖 2% 由各股东按人数均摊（87.png：复购奖支出 16 元）
 *  注：2026-10-23 新规格「股东固定 1 人」→ ownerCount 默认 1；多股东均分逻辑仅旧数据兼容保留。
 */
function storeDeliveryAllocation(discountAmount, ownerCount = STORE_OWNER_COUNT, opts = {}) {
  const regionType = opts.regionType || 'store';
  const share = AGENT_SHARE[regionType] || AGENT_SHARE.store;
  const storeRate = opts.storeRate != null ? opts.storeRate : share.cStore;
  const repRate = opts.repurchaseRate != null ? opts.repurchaseRate : GOODS_REPURCHASE_RATE;
  if (ownerCount < 1) throw new Error('门店老板人数必须 ≥1');
  const storePool = round2(discountAmount * storeRate);
  const referrerRepurchase = round2(discountAmount * repRate);
  const perOwnerGross = round2(storePool / ownerCount);
  const perOwnerRepurchaseShare = round2(referrerRepurchase / ownerCount);
  const perOwnerNet = round2(perOwnerGross - perOwnerRepurchaseShare);
  return {
    regionType, discountAmount, ownerCount, storeRate, repurchaseRate: repRate,
    storePool, referrerRepurchase,
    perOwnerGross, perOwnerRepurchaseShare, perOwnerNet,
    ownersNetTotal: round2(perOwnerNet * ownerCount),
    remainderToOther: round2(discountAmount - storePool - referrerRepurchase),
  };
}

// ───────────── ⑤ 行政费（统一价无折扣） ─────────────
// tp123 note 00「三、行政费」：总部 5% + 销售门店股东 5% + 交付方 90%（上课的团队）
const ADMIN_FEE_RATE = { hq: 0.05, ownStore: 0.05, delivery: 0.90 };
function adminFeeSplit(amount) {
  return {
    hq: round2(amount * ADMIN_FEE_RATE.hq),
    ownStore: round2(amount * ADMIN_FEE_RATE.ownStore),
    delivery: round2(amount * ADMIN_FEE_RATE.delivery),
    total: round2(amount),
  };
}

// ───────────── ⑥ 可分配提点（巡查 / 销售） ─────────────
const INSPECTION_RATE = 0.05;
const ASSIGN_TARGETS = ['self', 'upperCity', 'upperProvince', 'hq', 'other'];

function pendingCommission({ baseAmount, rate = INSPECTION_RATE, kind = 'inspection', orderId = null }) {
  return {
    kind, orderId, baseAmount, rate,
    amount: round2(baseAmount * rate),
    status: 'pending_allocation',
    assignableTo: ASSIGN_TARGETS.slice(),
    assignee: null,
  };
}
function allocateCommission(pending, assignee, assigneeId = null) {
  if (!ASSIGN_TARGETS.includes(assignee)) throw new Error(`非法收益方：${assignee}`);
  return { ...pending, status: 'allocated', assignee, assigneeId };
}

// ───────────── ⑦ 直推代理奖（tp123 收益详情 47.png） ─────────────
/**
 * 直推代理奖：直系下级成为异地代理，本级代理按业务提点 15% 获奖。
 *  算例：用户成为西工区单店代理 +6000，业务提点 15% → 基数 40000
 */
const AGENT_DIRECT_RATE = 0.15;

/**
 * P1-3 直推提点分档
 * 默认沿用固定 15%（与 tp123 口径、官方算例 40000×15%=6000 一致，行为不变）。
 * 后台可通过 settings.agentDirectBonus 打开分档：
 *   · tiers:        [{ minReferrals: 1, rate: 0.15 }, { minReferrals: 3, rate: 0.18 }]（按直推代理数量，取满足的最高档）
 *   · byRegionType: { province: 0.10, city: 0.08, district: 0.15, store: 0.15 }（按推荐人代理级别，优先级高于 tiers）
 *   · enabled:false 时强制回到固定 15%。
 */
function resolveAgentDirectRate({ referralCount = 0, developerRegionType = null, cfg = null } = {}) {
  if (cfg && cfg.enabled === false) return AGENT_DIRECT_RATE;
  const byRegion = (cfg && cfg.byRegionType) || {};
  if (developerRegionType && byRegion[developerRegionType] != null) {
    const r = Number(byRegion[developerRegionType]);
    if (Number.isFinite(r)) return r;
  }
  const tiers = cfg && Array.isArray(cfg.tiers) ? cfg.tiers : [];
  if (tiers.length) {
    let rate = AGENT_DIRECT_RATE;
    for (const t of tiers) {
      if (referralCount >= (Number(t.minReferrals) || 0)) rate = Number(t.rate);
    }
    return Number.isFinite(rate) ? rate : AGENT_DIRECT_RATE;
  }
  return AGENT_DIRECT_RATE;
}

/** 直推代理奖：基数 × 提点率（提点率可由分档规则解析得出） */
function agentDirectBonus(baseAmount, rate, opts = {}) {
  const finalRate = rate != null ? rate : resolveAgentDirectRate(opts);
  return { baseAmount, rate: finalRate, amount: round2(baseAmount * finalRate) };
}
/** 兼容旧名 agentSigningBonus（区域开发奖 = 技术费 × 8%） */
function agentSigningBonus(techFee, rate = 0.08) {
  return { techFee, rate, amount: round2(techFee * rate) };
}

/** 合伙人成交奖：本级代理每成交 1 个 VIP 合伙人所得（tp123 分成表「VIP（合伙人）」） */
function agentVipPartnerBonus(regionType, qty = 1) {
  const share = AGENT_SHARE[regionType];
  if (!share) throw new Error(`未知代理级别：${regionType}`);
  if (share.vipPartner == null) return { regionType, qty, perHead: 0, amount: 0, note: '本级别无此项' };
  return { regionType, qty, perHead: share.vipPartner, sub: share.vipPartnerSub, amount: round2(share.vipPartner * qty) };
}

// ───────────── 汇总：区域代理一个月 ─────────────
/**
 * @param {object} input
 * @param {string} input.regionType        province|city|district|store
 * @param {number} [input.vipCount]        本月区域内成交 VIP 名额数
 * @param {Array}  [input.goods]           [{kind:'physical',sellerLevel,buyerLevel,qty,basePrice}] 实物级差
 * @param {number} [input.signingBase]     直推代理奖基数（业务提点 15%）
 * @param {number} [input.adminFeeAsDelivery] 行政费总额（按 5/5/90 拆分）
 * @param {Array}  [input.coStoreFees]     合店费基数数组（省2%/市8%/区县10%）
 * @param {number} [input.vipPartnerCount] 成交 VIP 合伙人数
 */
function monthlyRegionAgent(input = {}) {
  const {
    regionType = 'district', vipCount = 0, goods = [], signingBase = 0,
    adminFeeAsDelivery = 0, coStoreFees = [], vipPartnerCount = 0,
  } = input;

  const vip = regionVipBonus(regionType, vipCount) || { amount: 0 };
  const goodsItems = goods.map((g) => (g.kind === 'physical'
    ? physicalTierDiff(g.sellerLevel, g.buyerLevel, g.qty || 1, g.basePrice || 6980)
    : goodsTierDiff(g.kind, g.sellerLevel, g.buyerLevel, g.qty || 1, g.salePrice || 1000)));
  const goodsTotal = round2(goodsItems.reduce((s, x) => s + x.amount, 0));
  const signing = signingBase ? agentDirectBonus(signingBase, input.directRate, { cfg: input.directTierCfg, referralCount: input.referralCount, developerRegionType: input.developerRegionType }) : { amount: 0 };
  const admin = adminFeeAsDelivery ? adminFeeSplit(adminFeeAsDelivery) : { hq: 0, ownStore: 0, delivery: 0, total: 0 };
  const vipPartner = agentVipPartnerBonus(regionType, vipPartnerCount);

  const coStoreRate = { province: 0.02, city: 0.08, district: 0.10 }[regionType] || 0;
  const coStoreTotal = round2(coStoreFees.reduce((s, f) => s + f * coStoreRate, 0));

  const total = round2((vip.amount || 0) + goodsTotal + (signing.amount || 0)
    + (admin.delivery || 0) + vipPartner.amount + coStoreTotal);
  return {
    regionType, vip, goodsItems, goodsTotal,
    signing, admin, vipPartner, coStoreRate, coStoreTotal, total,
  };
}

module.exports = {
  AGENT_LEVELS, LEVEL_CN, AGENT_TIER, AGENT_THRESHOLD_FEE, AGENT_SHARE,
  agentThresholdFee, agentVipPartnerBonus,
  AGENT_PRICE_TABLE, agentPrice, agentTechFee,
  PARTNER_DIRECT_RATIO, agentDirectReferralBonus, agentBusinessCommission, agentAppointmentCommissions,
  PHYSICAL_DISCOUNT, PARTNER_DISCOUNT, AGENT_DISCOUNT, GOODS_PRICE,
  STORE_SERVICE_PER_VIP, REGION_VIP_BONUS, regionVipBonus, storeServiceSplit,
  physicalDiscount, physicalTierDiff, goodsTierDiff, GOODS_REPURCHASE_RATE, goodsRepurchase,
  VIRTUAL_DELIVERY_SPLIT, VIRTUAL_STORE_DELIVERY_BREAKDOWN, VIRTUAL_STORE_INNER, virtualDeliverySplit,
  STORE_DELIVERY_RATE: 0.65, STORE_OWNER_COUNT, storeDeliveryAllocation,
  ADMIN_FEE_RATE, adminFeeSplit,
  INSPECTION_RATE, ASSIGN_TARGETS, pendingCommission, allocateCommission,
  AGENT_DIRECT_RATE, agentDirectBonus, agentSigningBonus, resolveAgentDirectRate,
  monthlyRegionAgent,
};

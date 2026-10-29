/**
 * 脑商AI合伙人 · 产品目录与产品分成（2026-10-23 用户新规格）
 *
 * 权威依据：用户 2026-10-23 口述 + 图2/图3（特色产品分成）+ 图5（产品表）+ 图4（股东1人）
 * 本文档只放「产品」域规则；代理价格表/两笔提成在 regionAgent.js，合店费在 costorePlan.js。
 *
 * ════════════════════════════════════════════════════════════════
 * 一、产品目录（图5）
 * ════════════════════════════════════════════════════════════════
 *  key          名称      目录价  类型    固定成本  变动成本
 *  pad          脑商Pad   6980   实物        0      6980
 *  memoryCard   记忆卡     998   软件卡      0       998
 *  coachCard    陪练卡    2000   特色        0      2000
 *  featured     特色产品  1300   特色        0      1300
 *  featuredCamp 特色营   10000   特色     8000      2000
 *
 * ════════════════════════════════════════════════════════════════
 * 二、成交价 = 固定成本 + 变动成本 × 档位折扣（图5 口径）
 * ════════════════════════════════════════════════════════════════
 *  合伙人折扣：VIP 8折 / 天使 7.5折 / 私董 7折 / 联创 6.5折
 *  代理折扣  ：单店 5折 / 区县 4折 / 市代 3.5折 / 省代 3折
 *  原价(list)：1.0（不折扣，用于「总部挂牌价」对照）
 *  算例：脑商Pad 天使价 = 0 + 6980×0.75 = 5235（与 tp123 官方算例一致）
 *        特色营 VIP 价 = 8000 + 2000×0.8 = 9600
 *
 * ════════════════════════════════════════════════════════════════
 * 三、合伙人产品提成（用户 2026-10-23：替代原 2% 复购奖，覆盖首购+复购）
 * ════════════════════════════════════════════════════════════════
 *  合伙人下级购买任意产品 → 该下级的直接上级（合伙人）按身份拿产品提成：
 *    VIP 5% / 天使 10% / 私董 15% / 联创 15%（基数=客户实付金额）
 *  回滚开关：PRODUCT_COMMISSION_MODE='flat2' → 恢复旧的「实付×2%」复购奖口径。
 *
 * ════════════════════════════════════════════════════════════════
 * 四、特色产品分成（图2/图3）：15 / 2 / 8 / (5+5) / (30+30+5) = 100%
 * ════════════════════════════════════════════════════════════════
 *  总部 15% / 省代 2% / 市代 8% / 区县代 5%管理+5%巡查 / 单店 30%交付+30%流量+5%销售
 *   • 巡查 5%：分配权归区县负责人（pending_allocation，由区县负责人直接写进价格+描述）
 *   • 销售 5%：固定归店长/单店负责人（不参与分配）
 *   • 总部交付(deliveryType='hq')：门店 30%交付 与 区县 5%巡查 收归总部
 *   • 门店交付(deliveryType='store')：全部按上表落地
 *  分成池 = 客户实付 − 固定成本（特色营 私董价 9400 → 池 1400；联创价 9300 → 池 1300；原价 10000 → 池 2000）
 *
 *  【特色产品成交价 / 代理映射（用户 2026-10-27 明确）】
 *   成交价 = 固定成本 + 变动成本 × 合伙人折扣（合伙人与普通用户按自身档位；普通用户=list 原价）。
 *   代理买家不享受其更深的代理折扣，而是「按对应合伙人档位」成交：
 *     省代 → 联创(6.5折) / 市代 → 私董(7折) / 区县代 → 天使(7.5折) / 单店 → VIP(8折)
 *   例：特色营 私董(7折) 拿货价 = 8000 + 2000×0.7 = 9400；省代(映射联创) = 8000 + 2000×0.65 = 9300。
 *   陪练卡同理：私董 = 2000×0.7 = 1400；省代(映射联创) = 2000×0.65 = 1300；原价 2000。
 *   分成池 = 成交价 − 固定成本 = 变动成本(2000) × 合伙人折扣（即「盈利全部从 2000 拨比中获得」）。
 *
 * ════════════════════════════════════════════════════════════════
 * 五、代理固定上级链（无跨级，用户 2026-10-23 明确）
 * ════════════════════════════════════════════════════════════════
 *  单店代理 → 区县代 → 市代 → 省代 → 总部（逐级固定，不存在跨级）
 *  实物拿货差价沿该固定链结算：每级赚「下一级折扣 − 本级折扣」× 基准价，
 *  链底（直接卖方）赚「买方折扣 − 卖方折扣」× 基准价，总部收 省代折扣 × 基准价。
 *
 * ════════════════════════════════════════════════════════════════
 * 六、行政费（统一价无折扣）：总部 5% + 销售门店 5% + 上课团队 90%
 * ════════════════════════════════════════════════════════════════
 *  销售门店 = 线下完成销售的门店；上课团队 = 交付方。
 */
const RA = require('./regionAgent');
const { round2, resolveDirectRate } = require('./commission');

// ───────────── 产品目录（图5） ─────────────
const PRODUCT_KIND = { physical: '实物', software: '软件卡', virtual: '虚拟', featured: '特色', admin: '行政费' };

const PRODUCT_CATALOG = {
  pad:          { key: 'pad',          name: '脑商Pad',  listPrice: 6980,  kind: 'physical', fixedCost: 0,    variableCost: 6980,  note: '实物，走折扣级差（成本 0；所谓「平板奖」= 平板按拿货折扣与卖价之间的级差分润，不是独立奖项目）' },
  memoryCard:   { key: 'memoryCard',   name: '记忆卡',   listPrice: 998,   kind: 'software', fixedCost: 0,    variableCost: 998,   note: '软件卡' },
  coachCard:    { key: 'coachCard',    name: '陪练卡',   listPrice: 2000,  kind: 'featured', fixedCost: 0,    variableCost: 2000,  note: '特色产品（陪练卡）：联创 65% 成交 1300，按 15/2/8/(5+5)/(30+30+5) 分成' },
  featured:     { key: 'featured',     name: '特色产品', listPrice: 1300,  kind: 'featured', fixedCost: 0,    variableCost: 1300,  note: '特色产品，按 15/2/8/(5+5)/(30+30+5) 分成' },
  featuredCamp: { key: 'featuredCamp', name: '特色营',   listPrice: 10000, kind: 'featured', fixedCost: 8000, variableCost: 2000,  note: '特色产品，固定成本 8000' },
  adminFee:     { key: 'adminFee',     name: '行政费/集训营', listPrice: 0, kind: 'admin',   fixedCost: 0,    variableCost: 0,     note: '行政费：总部5% + 销售门店5% + 上课团队90%（金额下单时指定，无折扣无产品提成）' },
};

function getProduct(key) {
  const p = PRODUCT_CATALOG[key];
  if (!p) throw new Error(`未知产品：${key}（可选：${Object.keys(PRODUCT_CATALOG).join('/')}）`);
  return p;
}

/** 档位折扣（合伙人/代理/list 原价） */
function productDiscount(level) {
  if (level === 'list') return 1;
  if (RA.PARTNER_DISCOUNT[level] != null) return RA.PARTNER_DISCOUNT[level];
  if (RA.AGENT_DISCOUNT[level] != null) return RA.AGENT_DISCOUNT[level];
  throw new Error(`未知档位：${level}`);
}

/* ════════════════════════════════════════════════════════════════
   商城系统预留 · 身份折扣体系（2026-10-23 用户强调）
   ────────────────────────────────────────────────────────────────
   两套折扣表分开维护、力度不同，严禁混用：
     · 合伙人折扣 PARTNER_DISCOUNT：VIP 8 / 天使 7.5 / 私董 7 / 联创 6.5
     · 代理折扣   AGENT_DISCOUNT  ：单店 5 / 区县 4 / 市 3.5 / 省 3
   买家档位解析的唯一入口（订单创建 / 用户端商城 / 后台代下单共用）：
     优先级 代理身份 > 合伙人档位 > 原价(list)
   代理折扣整体深于合伙人折扣，代理身份优先 = 买家最优价（默认口径，见 A10）。
   ════════════════════════════════════════════════════════════════ */
const PARTNER_TIERS = ['vip', 'angel', 'private', 'cofounder'];
const AGENT_LEVELS = ['store', 'district', 'city', 'province'];

/**
 * 买家档位解析（单一价格入口）
 * @param {object} buyer 用户记录（含 tier）
 * @param {object|null} agentRecord 代理记录（含 region_type），无代理身份传 null
 * @returns {{ level: string, discountKind: 'agent'|'partner'|'list' }}
 */
function resolveBuyerLevel(buyer, agentRecord) {
  if (agentRecord && AGENT_LEVELS.includes(agentRecord.region_type)) {
    return { level: agentRecord.region_type, discountKind: 'agent' };
  }
  if (buyer && PARTNER_TIERS.includes(buyer.tier)) {
    return { level: buyer.tier, discountKind: 'partner' };
  }
  return { level: 'list', discountKind: 'list' };
}

/**
 * 特色产品：代理按「对应合伙人档位」计价（用户 2026-10-27 明确）
 *   陪练卡 / 特色营 统一用合伙人折扣；代理身份 → 映射为对应合伙人档位：
 *     省代 → 联创 / 市代 → 私董 / 区县代 → 天使 / 单店 → VIP
 *   （即：代理买特色产品，不享受其更深的代理折扣，而是按对应合伙人折扣成交）
 *   · 合伙人 / 普通用户 → 直接取对应档位（普通用户 = list 原价 10000 / 2000）
 * @returns {string} 用于 productPrice / skuPrice 的计价档位
 */
const AGENT_TO_PARTNER = { province: 'cofounder', city: 'private', district: 'angel', store: 'vip' };

/**
 * 解析有效计价档位（2026-10-27 用户明确：孩子没有折扣）
 *
 * 商城折扣**只看购买者本人的身份**，与孩子的会员等级无关：
 *   ① 代理身份（regionalAgents.region_type）→ 单店5 / 区县4 / 市3.5 / 省3 折
 *   ② 合伙人档位（users.tier）→ VIP8 / 天使7.5 / 私董7 / 联创6.5 折
 *   ③ 无身份 → 原价 list
 *
 * ⚠️ 家长加孩子后 `display_id` 前缀会跟着孩子走（联创+粉丝孩子 → FS0001），
 *    但**前缀只是展示字符串**，`users.tier` 与代理记录都不变 —— 因此
 *    绝不能用前缀反推身份算价，必须读 tier / regionalAgents 这两个真实数据源。
 */
function resolvePriceLevel(buyer, agentRecord) {
  return resolveBuyerLevel(buyer, agentRecord);
}

function featuredLevelFor(buyer, agentRecord) {
  const { level, discountKind } = resolveBuyerLevel(buyer, agentRecord);
  if (discountKind === 'agent') return AGENT_TO_PARTNER[level] || 'list';
  return level;
}

/**
 * 某买家的全产品报价（商城商品列表用）
 * 同时给出三套价格：成交价（按解析档位）、合伙人价、代理拿货价（双身份买家可对照）。
 */
function buyerProductPrices(buyer, agentRecord, qty = 1) {
  const { level, discountKind } = resolveBuyerLevel(buyer, agentRecord);
  const partnerLevel = buyer && PARTNER_TIERS.includes(buyer.tier) ? buyer.tier : 'list';
  const agentLevel = agentRecord && AGENT_LEVELS.includes(agentRecord.region_type) ? agentRecord.region_type : null;
  // 特色产品：代理报价按对应合伙人档位映射（见 featuredLevelFor）
  const agentLevelForPrice = (key) => {
    if (agentLevel == null) return null;
    if (getProduct(key).kind === 'featured') return AGENT_TO_PARTNER[agentLevel] || 'list';
    return agentLevel;
  };
  const prices = {};
  for (const p of Object.values(PRODUCT_CATALOG)) {
    const pr = p.kind === 'featured' ? productPrice(p.key, featuredLevelFor(buyer, agentRecord), qty) : productPrice(p.key, level, qty);
    const aLvl = agentLevelForPrice(p.key);
    prices[p.key] = {
      key: p.key, name: p.name, kind: p.kind, level, discountKind,
      unitPrice: pr.unitPrice, total: pr.total, formula: pr.formula,
      partnerUnitPrice: productPrice(p.key, partnerLevel, qty).unitPrice,
      agentUnitPrice: aLvl ? productPrice(p.key, aLvl, qty).unitPrice : null,
    };
  }
  return { level, discountKind, partnerLevel, agentLevel, prices };
}

/**
 * 产品成交价 = 固定成本 + 变动成本 × 档位折扣
 * @param {string} key 产品 key
 * @param {string} level 档位（vip/angel/private/cofounder/store/district/city/province/list）
 * @param {number} qty 数量
 */
function productPrice(key, level, qty = 1) {
  const p = getProduct(key);
  const discount = productDiscount(level);
  const unitPrice = round2(p.fixedCost + p.variableCost * discount);
  return {
    key: p.key, name: p.name, kind: p.kind, level, discount,
    fixedCost: p.fixedCost, variableCost: p.variableCost,
    unitPrice, qty, total: round2(unitPrice * qty),
    formula: `${p.fixedCost} + ${p.variableCost}×${discount} = ${unitPrice}`,
  };
}

/**
 * 单规格成交价（2026-10-27 SKU 库存台账）
 *
 * 与商品级 productPrice 同构：unitPrice = fixedCost + variableCost × 档位折扣。
 * 差别只在 variableCost 由「该 SKU 的单价」反推：
 *   variable = sku.listPrice − product.fixedCost
 * 这样标价档（list）下单价恰好等于 sku.listPrice，折扣档按同一比例下探，
 * 固定成本（特色营 8000）不打折，与商品级口径完全一致。
 *
 * @param {string} key 商品 key
 * @param {object} sku  { id, label, listPrice }（listPrice 单位：元）
 * @param {string} level 档位
 * @param {number} qty 数量
 */
function skuPrice(key, sku, level, qty = 1) {
  const p = getProduct(key);
  const discount = productDiscount(level);
  const listPrice = Number(sku && sku.listPrice) || 0;
  const variable = Math.max(0, round2(listPrice - p.fixedCost));
  const unitPrice = round2(p.fixedCost + variable * discount);
  return {
    key: p.key, name: p.name, kind: p.kind, level, discount,
    skuId: sku ? sku.id : null, skuLabel: sku ? (sku.label || null) : null,
    fixedCost: p.fixedCost, variableCost: variable, listPrice,
    unitPrice, qty, total: round2(unitPrice * qty),
    formula: `${p.fixedCost} + ${variable}×${discount} = ${unitPrice}`,
  };
}

/** 由档位推导折扣种类（agent / partner / list） */
function discountKindOfLevel(level) {
  if (AGENT_LEVELS.includes(level)) return 'agent';
  if (PARTNER_TIERS.includes(level)) return 'partner';
  return 'list';
}

/**
 * P1-9 · 会员价 / 渠道价 双折扣
 * 每个产品可声明 memberPrice（会员价，面向会员）与 channelPrice（渠道价，面向渠道/代理拿货）。
 * 未声明时，按档位折扣自动推导：会员价 = VIP 档成交价，渠道价 = 门店(store)代理拿货价。
 * 双折扣口径（settings.pricing.dualDiscountEnabled 开启时生效）：
 *   渠道买家优先取 channelPrice；否则会员取 memberPrice；否则回退 listPrice。
 * 关闭时沿用原有「按买家档位单一折扣」逻辑（向后兼容）。
 * 无论是否开启，报价接口都会同时返回 list/member/channel 三套价，便于前端展示「会员价 ¥X / 渠道价 ¥Y」。
 */
function dualPrice(key, qty = 1) {
  const p = getProduct(key);
  const list = productPrice(key, 'list', qty).unitPrice;
  const member = p.memberPrice != null ? round2(p.memberPrice) : productPrice(key, 'vip', qty).unitPrice;
  // 特色产品：渠道价 = 代理映射的对应合伙人档位（单店→VIP），不以代理折扣计价
  const channel = p.channelPrice != null ? round2(p.channelPrice)
    : p.kind === 'featured' ? productPrice(key, AGENT_TO_PARTNER.store, qty).unitPrice
    : productPrice(key, 'store', qty).unitPrice;
  return { key: p.key, name: p.name, list, member, channel };
}

/** 按买家上下文决定最终成交价（应用双折扣规则） */
function finalPrice(key, buyer, agentRecord, qty = 1, opts = {}) {
  const dual = !!opts.dualDiscountEnabled;
  const dp = dualPrice(key, qty);
  // ① 客户端显式指定档位（兼容旧行为，最高优先级）
  if (opts.level) {
    const pr = productPrice(key, opts.level, qty);
    return { ...pr, applied: discountKindOfLevel(opts.level), member: dp.member, channel: dp.channel, list: dp.list };
  }
  // ② 身份解析（代理身份 > 合伙人档位 > 原价；与孩子的会员等级无关）
  const eff = resolvePriceLevel(buyer, agentRecord);
  if (dual) {
    const isChannel = agentRecord && AGENT_LEVELS.includes(agentRecord.region_type);
    const isMember = buyer && (PARTNER_TIERS.includes(buyer.tier) || buyer.entitlement_state === 'active');
    if (isChannel) return { ...dp, applied: 'channel', unitPrice: dp.channel };
    if (isMember) return { ...dp, applied: 'member', unitPrice: dp.member };
    return { ...dp, applied: 'list', unitPrice: dp.list };
  }
  // ③ 单一价格入口 —— 必须与 routes.createProductOrder 的 priceLevel **完全同口径**，
  //    否则会出现「报价金额 ≠ 下单金额」→ 报价校验失败。
  //    特色产品按「对应合伙人档位」计价；其余商品按买家档位（代理=拿货价 / 合伙人档位 / 原价）。
  const priceLevel = getProduct(key).kind === 'featured'
    ? featuredLevelFor(buyer, agentRecord)
    : eff.level;
  const pr = productPrice(key, priceLevel, qty);
  const kind = discountKindOfLevel(priceLevel);
  const applied = kind === 'agent' ? 'partner' : kind;
  return { ...pr, applied, member: dp.member, channel: dp.channel, list: dp.list };
}

/**
 * 按买家上下文决定最终成交价（SKU 版，2026-10-27）
 * 与 finalPrice **完全同一套双折扣规则**，只是把计价对象换成单个规格。
 * ⚠️ 不要在业务层另写一份折扣判断，统一走这里，避免两套口径分叉。
 */
function finalSkuPrice(key, sku, buyer, agentRecord, qty = 1, opts = {}) {
  const dual = !!opts.dualDiscountEnabled;
  const at = (lvl) => skuPrice(key, sku, lvl, qty);
  if (opts.level) {
    const pr = at(opts.level);
    return { ...pr, applied: discountKindOfLevel(opts.level), member: at('vip').unitPrice, channel: at('store').unitPrice, list: sku.listPrice };
  }
  if (dual) {
    const isChannel = agentRecord && AGENT_LEVELS.includes(agentRecord.region_type);
    const isMember = buyer && (PARTNER_TIERS.includes(buyer.tier) || buyer.entitlement_state === 'active');
    if (isChannel) return { ...at('store'), applied: 'channel' };
    if (isMember) return { ...at('vip'), applied: 'member' };
    return { ...at('list'), applied: 'list' };
  }
  const eff = resolvePriceLevel(buyer, agentRecord);
  // 与 finalPrice / createProductOrder 同口径：特色产品按「对应合伙人档位」，其余按买家档位
  const priceLevel = getProduct(key).kind === 'featured'
    ? featuredLevelFor(buyer, agentRecord)
    : eff.level;
  const kind = discountKindOfLevel(priceLevel);
  const applied = kind === 'agent' ? 'partner' : kind;
  return { ...at(priceLevel), applied, member: at('vip').unitPrice, channel: at(AGENT_TO_PARTNER.store).unitPrice, list: sku.listPrice };
}

// ───────────── 合伙人产品提成（5/10/15/15%，可回滚 flat2） ─────────────
/** 合伙人产品提成率（按上级身份）：VIP 5% / 天使 10% / 私董 15% / 联创 15% */
const PARTNER_PRODUCT_RATE = { vip: 0.05, angel: 0.10, private: 0.15, cofounder: 0.15 };
/** 旧口径：复购奖 2%（回滚用） */
const LEGACY_REPURCHASE_RATE = 0.02;
/** 提成模式：'tier' 新规格档位制（默认） | 'flat2' 旧 2% 复购奖 */
const PRODUCT_COMMISSION_MODE = 'tier';

/**
 * 产品类型 → 原型（屏 50）业务类型映射，用于 P1-3「按业务类型分档」直推口径。
 *   实物（脑商Pad 等）→ 供应链 2%
 *   软件卡 / 虚拟 / 特色 → 软件卡 5%
 *   行政费 → 代理费 5%
 */
const PRODUCT_BIZ_TYPE = {
  physical: 'supply_chain',
  software: 'software_fee',
  virtual: 'software_fee',
  featured: 'software_fee',
  admin: 'agent_fee',
};

/**
 * 合伙人产品提成：下级购买产品 → 直接上级按身份拿提成（覆盖首购+复购）
 * @param {object} opt { paid, uplineTier, mode, kind, directBonusCfg }
 *   directBonusCfg = settings.directBonus（P1-3 双口径开关）
 *     mode='byUplineTier'（默认）→ 按上级档位 5/10/15/15%，既有金额行为不变
 *     mode='byBizType'          → 按业务类型分档（供应链/合店费复购/升级奖 2%；软件卡/代理费/权益费 5%）
 * @returns {{mode, uplineTier, rate, amount, formula, legacyAmount, basis}}
 */
function partnerProductCommission({ paid, uplineTier, mode = PRODUCT_COMMISSION_MODE, kind = null, directBonusCfg = null }) {
  const base = round2(paid || 0);
  if (!uplineTier || uplineTier === 'user' || uplineTier === 'none') {
    return { mode, uplineTier, rate: null, amount: 0, formula: '无上级合伙人→不提成', legacyAmount: 0, basis: 'none' };
  }
  if (mode === 'flat2') {
    const amount = round2(base * LEGACY_REPURCHASE_RATE);
    return { mode, uplineTier, rate: LEGACY_REPURCHASE_RATE, amount, formula: `实付 ${base} × 2%（旧复购奖口径） = ${amount}`, legacyAmount: amount, basis: 'flat2' };
  }
  // P1-3：优先按业务类型分档（仅当显式开启 byBizType）
  const cfg = directBonusCfg && typeof directBonusCfg === 'object' ? directBonusCfg : null;
  if (cfg && cfg.mode === 'byBizType') {
    const bizType = PRODUCT_BIZ_TYPE[kind] || 'supply_chain';
    const rate = resolveDirectRate(bizType, uplineTier, cfg);
    const amount = round2(base * rate);
    return {
      mode, uplineTier, rate, amount, basis: 'bizType', bizType,
      formula: `实付 ${base} × ${Math.round(rate * 100)}%（${bizType} 业务类型提成） = ${amount}`,
      legacyAmount: round2(base * LEGACY_REPURCHASE_RATE),
    };
  }
  const rate = PARTNER_PRODUCT_RATE[uplineTier];
  if (rate == null) throw new Error(`未知合伙人档位：${uplineTier}`);
  const amount = round2(base * rate);
  return {
    mode, uplineTier, rate, amount, basis: 'uplineTier',
    formula: `实付 ${base} × ${Math.round(rate * 100)}%（${uplineTier} 产品提成） = ${amount}`,
    legacyAmount: round2(base * LEGACY_REPURCHASE_RATE),
  };
}

// ───────────── 特色产品分成 15/2/8/(5+5)/(30+30+5) ─────────────
const FEATURED_SPLIT_ROWS = [
  { role: 'hq',               label: '总部',            rate: 0.15 },
  { role: 'province',         label: '省代',            rate: 0.02 },
  { role: 'city',             label: '市代',            rate: 0.08 },
  { role: 'district_mgmt',    label: '区县代(管理)',     rate: 0.05 },
  { role: 'district_inspect', label: '区县代(巡查)',     rate: 0.05, pending: true },  // 分配权归区县负责人
  { role: 'store_delivery',   label: '单店(交付)',       rate: 0.30 },
  { role: 'store_traffic',    label: '单店(流量)',       rate: 0.30 },
  { role: 'store_sales',      label: '店长(销售)',       rate: 0.05 },                 // 固定归店长/单店负责人
];
const FEATURED_SPLIT_TOTAL_RATE = FEATURED_SPLIT_ROWS.reduce((s, r) => s + r.rate, 0); // 1.0

/**
 * 特色产品分成（图2/图3）
 * @param {number} paid 客户实付
 * @param {object} opt { fixedCost, deliveryType:'store'|'hq', inspectionAssignee }
 *   - deliveryType='hq' 总部交付：门店 30%交付 + 区县 5%巡查 收归总部
 *   - inspectionAssignee：区县负责人对巡查 5% 的分配对象（'self'|'upperCity'|'upperProvince'|'hq'|'other'）
 * @returns {{paid, fixedCost, pool, deliveryType, rows, byRecipient, total, closure, pending}}
 */
function featuredSplit(paid, opt = {}) {
  const { fixedCost = 0, deliveryType = 'store', inspectionAssignee = null } = opt;
  if (!['store', 'hq'].includes(deliveryType)) throw new Error(`非法交付类型：${deliveryType}（应为 store|hq）`);
  const pool = round2(Math.max(0, round2(paid || 0) - round2(fixedCost || 0)));
  // 角色分组：区县代(管理/巡查)→district；单店(交付/流量/销售)→store
  const groupOf = (role) => ({
    hq: 'hq', province: 'province', city: 'city',
    district_mgmt: 'district', district_inspect: 'district',
    store_delivery: 'store', store_traffic: 'store', store_sales: 'store',
  }[role]);
  const rows = FEATURED_SPLIT_ROWS.map((r) => {
    let owner = groupOf(r.role);
    let note = r.label;
    if (deliveryType === 'hq' && (r.role === 'store_delivery' || r.role === 'district_inspect')) {
      owner = 'hq';
      note = `${r.label}→总部交付收归总部`;
    }
    if (r.role === 'district_inspect') {
      note = inspectionAssignee ? `${r.label}→区县负责人已分配(${inspectionAssignee})` : `${r.label}→待区县负责人分配`;
    }
    if (r.role === 'store_sales') note = '店长/单店负责人（固定）';
    return { ...r, owner, amount: round2(pool * r.rate), note };
  });
  const byRecipient = {};
  for (const r of rows) byRecipient[r.owner] = round2((byRecipient[r.owner] || 0) + r.amount);
  const total = round2(rows.reduce((s, r) => s + r.amount, 0));
  return {
    paid: round2(paid || 0), fixedCost: round2(fixedCost || 0), pool, deliveryType,
    rows, byRecipient,
    total,
    closure: Math.abs(total - pool) < 0.01,
    rateClosure: FEATURED_SPLIT_TOTAL_RATE === 1,
    pending: rows.filter((r) => r.pending).map((r) => ({ role: r.role, amount: r.amount, assignee: inspectionAssignee, note: '巡查 5% 分配权归区县负责人' })),
  };
}

// ───────────── AI软件卡（记忆卡）拿货差价 ─────────────
/**
 * AI软件卡（记忆卡）拿货差价（2026-10-27 用户拨比表 + 截图，替代原虚拟分成）
 *
 * 模型（与 storeIncome.js「② AI软件卡 = 拿货差价」一致，且对齐实物固定链级差）：
 *   · 顾客付款 = 目录价(998) × 买家折扣（合伙人/代理/list）；代理本人进货按固定拿货价。
 *   · 卖方（选中的门店，即单店）按「固定拿货价」进货、按「顾客付款」卖出，赚差价；
 *   · 沿固定代理链（单店→区县→市→省→总部）逐级结算拿货价差；总部收「省级拿货价」。
 *   · 拿货价按身份固定（与实物不同：实物=变动成本×折扣，AI软件卡=固定绝对值）：
 *       省代 150 / 市代 170 / 区县代 250 / 单店 350（单位：元/张，按月）
 *   · 合伙人产品提成（VIP5/天使10/私董15/联创15%）从链底（单店）级差中扣。
 *
 * 算例（与 storeIncome.js 拨比表一致）：VIP(0.8) 在单店买 998 卡
 *   顾客付款 = 998×0.8 = 798.4
 *   单店(链底)=798.4−350=448.4；区县=350−250=100；市代=250−170=80；省代=170−150=20；总部=150
 *   合计 = 798.4（闭环）；扣联创上级提成 15%=119.76（从单店行扣）→ 单店实得 328.64
 */
const MEMORY_CARD_PICK_PRICE = { store: 350, district: 250, city: 170, province: 150 };
const CARD_AGENT_CHAIN = ['store', 'district', 'city', 'province', 'hq'];

/**
 * 商城统一实付金额口径（2026-10-28 修：报价与下单金额不一致）
 *
 * 背景：AI软件卡（记忆卡，kind='software'）在「代理本人进货」时应按**固定拿货价**
 *   （省150/市170/区县250/单店350）成交，而不是目录价×折扣。
 *   此前只有 routes.createProductOrder 实现了这条规则，报价接口 /checkout/quotes
 *   仍走 finalSkuPrice 折扣口径 → 报价显示 598.8、实际扣款 300（前端展示与实付不符）。
 *
 * 现在把规则收敛到本函数：**报价与下单必须调用同一个函数**，杜绝两套口径分叉。
 *
 * @param {object} product   产品定义（需含 kind）
 * @param {object} agentRec  买家的区域代理记录（非代理为 null/undefined）
 * @param {number} unitPrice 折扣口径算出的单价（未命中拿货价规则时使用）
 * @param {number} qty       数量
 * @returns {{amount:number, applied:string}} amount=实付总额，applied=命中的口径说明
 */
function payableAmountFor(product, agentRec, unitPrice, qty = 1) {
  const r2 = (n) => Math.round(n * 100) / 100;
  if (product && product.kind === 'admin') {
    // 管理端商品：金额由管理员录入，调用方另行传入，此处不处理
    return { amount: r2(unitPrice * qty), applied: 'admin' };
  }
  if (product && product.kind === 'software' && agentRec) {
    // 代理本人进货：按固定拿货价，不按折扣
    const pick = MEMORY_CARD_PICK_PRICE[agentRec.region_type];
    if (pick != null) {
      return { amount: r2(pick * qty), applied: 'agent_pick_price:' + agentRec.region_type };
    }
  }
  return { amount: r2(unitPrice * qty), applied: 'discount' };
}

function cardTierDiff({ paid, buyerLevel, sellerLevel, listPrice = 998, qty = 1 }) {
  if (!sellerLevel) {
    // 总部直供（如省代本人进货，无上级代理）
    return {
      buyerLevel, sellerLevel: null, listPrice, qty,
      rows: [{ level: 'hq', label: '总部直供', amount: round2(paid * qty) }],
      total: round2(paid * qty), buyerPaid: round2(paid * qty), closure: true,
    };
  }
  if (!CARD_AGENT_CHAIN.includes(sellerLevel) || sellerLevel === 'hq') {
    throw new Error(`卖方必须是代理级别（store/district/city/province）：${sellerLevel}`);
  }
  const p = round2(paid * qty);
  const pickSeller = MEMORY_CARD_PICK_PRICE[sellerLevel];
  if (pickSeller == null) throw new Error(`未知拿货价级别：${sellerLevel}`);
  const rows = [];
  // 链底卖方：顾客付款 − 拿货价(卖方)
  rows.push({ level: sellerLevel, label: RA.LEVEL_CN[sellerLevel], amount: round2(p - pickSeller) });
  // 沿固定链向上：每级赚「下级拿货价 − 本级拿货价」
  let below = sellerLevel;
  let cur = AGENT_UPLINE[below];
  while (cur && cur !== 'hq') {
    const belowPick = MEMORY_CARD_PICK_PRICE[below];
    const curPick = MEMORY_CARD_PICK_PRICE[cur];
    rows.push({ level: cur, label: RA.LEVEL_CN[cur], amount: round2(belowPick - curPick) });
    below = cur;
    cur = AGENT_UPLINE[cur];
  }
  // 总部：收省级拿货价
  rows.push({ level: 'hq', label: '总部', amount: round2(MEMORY_CARD_PICK_PRICE.province) });
  const total = round2(rows.reduce((s, r) => s + r.amount, 0));
  return {
    buyerLevel, sellerLevel, listPrice, qty, rows, total,
    buyerPaid: p, closure: Math.abs(total - p) < 0.01,
  };
}

// ───────────── 代理固定上级链（无跨级） ─────────────
/** 固定上级链：单店→区县→市代→省代→总部（逐级固定，无跨级） */
const AGENT_CHAIN = ['store', 'district', 'city', 'province', 'hq'];
const AGENT_UPLINE = { store: 'district', district: 'city', city: 'province', province: 'hq' };

/** 取某代理级别的固定上级（无跨级） */
function agentUpline(regionType) {
  const up = AGENT_UPLINE[regionType];
  if (!up) throw new Error(`未知代理级别：${regionType}（无固定上级）`);
  return up;
}

/** 从某代理级别逐级向上的固定链（含总部），如 store → [district, city, province, hq] */
function agentUplineChain(regionType) {
  const chain = [];
  let cur = regionType;
  while (cur && cur !== 'hq') {
    cur = agentUpline(cur);
    chain.push(cur);
  }
  return chain;
}

/**
 * 实物拿货差价沿固定链结算（无跨级）
 * 每级赚「下一级折扣 − 本级折扣」× 基准价；链底卖方赚「买方折扣 − 卖方折扣」× 基准价；
 * 总部收「省代折扣」× 基准价。
 *
 * 【算例】VIP(0.8) 向单店代理(0.5) 买脑商Pad 6980：
 *   门店 (0.8−0.5)×6980 = 2094；区县 (0.5−0.4) = 698；市代 (0.4−0.35) = 349；
 *   省代 (0.35−0.3) = 349；总部 0.3×6980 = 2094；合计 5584 = 6980×0.8 ✓
 *
 * @param {object} opt { buyerLevel, sellerLevel, basePrice, qty }
 * @returns {{rows, total, closure}} rows=[{level, label, buyDiscount, sellDiscount, amount}]
 */
function agentChainTierDiff({ buyerLevel, sellerLevel, basePrice = 6980, qty = 1 }) {
  if (!AGENT_CHAIN.includes(sellerLevel) || sellerLevel === 'hq') {
    throw new Error(`卖方必须是代理级别（store/district/city/province）：${sellerLevel}`);
  }
  const bd = productDiscount(buyerLevel);
  const sd = productDiscount(sellerLevel);
  if (bd <= sd) throw new Error(`买方折扣(${bd}) 必须大于卖方折扣(${sd})，否则无差价`);
  const rows = [];
  // 链底：直接卖方
  rows.push({ level: sellerLevel, label: RA.LEVEL_CN[sellerLevel], buyDiscount: bd, sellDiscount: sd, amount: round2((bd - sd) * basePrice * qty) });
  // 沿固定链向上：每级卖向下一级、向更上级进货
  let below = sellerLevel;
  let cur = agentUpline(sellerLevel);
  while (cur !== 'hq') {
    const belowD = productDiscount(below);
    const curD = productDiscount(cur);
    rows.push({ level: cur, label: RA.LEVEL_CN[cur], buyDiscount: belowD, sellDiscount: curD, amount: round2((belowD - curD) * basePrice * qty) });
    below = cur;
    cur = agentUpline(cur);
  }
  // 总部：收省代折扣 × 基准价
  const provD = productDiscount('province');
  rows.push({ level: 'hq', label: '总部', buyDiscount: provD, sellDiscount: 0, amount: round2(provD * basePrice * qty) });
  const total = round2(rows.reduce((s, r) => s + r.amount, 0));
  return {
    buyerLevel, sellerLevel, basePrice, qty, rows, total,
    buyerPaid: round2(bd * basePrice * qty),
    closure: Math.abs(total - bd * basePrice * qty) < 0.01,
  };
}

// ───────────── 行政费 5/5/90（角色标注） ─────────────
const ADMIN_FEE_ROLES = { hq: '总部', ownStore: '销售门店', delivery: '上课团队' };
/** 行政费拆分（带角色标注）：总部 5% + 销售门店 5% + 上课团队 90% */
function adminFeeSplitDetail(amount) {
  const base = RA.adminFeeSplit(amount);
  return {
    amount: base.total,
    rows: [
      { role: 'hq', label: ADMIN_FEE_ROLES.hq, rate: RA.ADMIN_FEE_RATE.hq, amount: base.hq },
      { role: 'ownStore', label: ADMIN_FEE_ROLES.ownStore, rate: RA.ADMIN_FEE_RATE.ownStore, amount: base.ownStore },
      { role: 'delivery', label: ADMIN_FEE_ROLES.delivery, rate: RA.ADMIN_FEE_RATE.delivery, amount: base.delivery },
    ],
    total: base.total,
    closure: Math.abs(base.hq + base.ownStore + base.delivery - base.total) < 0.01,
  };
}

/** 门店股东固定 1 人（用户 2026-10-23 图4：排除多股东；单一来源=regionAgent） */
const STORE_OWNER_COUNT = RA.STORE_OWNER_COUNT;

module.exports = {
  PRODUCT_KIND, PRODUCT_CATALOG, getProduct, productDiscount, productPrice, skuPrice,
  PARTNER_TIERS, AGENT_LEVELS, resolveBuyerLevel, resolvePriceLevel, buyerProductPrices,
  AGENT_TO_PARTNER, featuredLevelFor,
  PARTNER_PRODUCT_RATE, LEGACY_REPURCHASE_RATE, PRODUCT_COMMISSION_MODE, PRODUCT_BIZ_TYPE, partnerProductCommission,
  FEATURED_SPLIT_ROWS, FEATURED_SPLIT_TOTAL_RATE, featuredSplit,
  MEMORY_CARD_PICK_PRICE, cardTierDiff, payableAmountFor,
  AGENT_CHAIN, AGENT_UPLINE, agentUpline, agentUplineChain, agentChainTierDiff,
  ADMIN_FEE_ROLES, adminFeeSplitDetail, STORE_OWNER_COUNT,
  dualPrice, finalPrice, finalSkuPrice,
};

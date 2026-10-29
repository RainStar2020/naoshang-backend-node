/**
 * 脑商AI合伙人 · 月度结算编排（纯函数，无 DB 依赖）
 * 输入内存数据（orders / cofounders / founders / events / costoreFees / agents），
 * 调用 commission.js 各项算法，产出佣金记录数组 + 汇总。
 *
 * 职责划分（与原设计 §3.3 / §5.2 对齐）：
 *  - 订单即时类（在 routes.createOrder 中落账）：direct（直推）/ rebuy（复购）/ parity（平级）
 *  - 月度聚合类（本模块 settleAll 计算）：global（全球奖）/ founding（创始奖）/ agent（区域代理）/ costore（合店）
 */

const {
  computeGlobalBonus, coStoreSplit, coStoreFeeAllocation,
  coStorePartnerDividend, storeServiceFee, hqProductFee, parityBonusCascade,
  repurchaseBonus, HQ_PRODUCT_FEE_PER_VIP, FOUNDING_RATE, GLOBAL_UNIT, PARITY_RATE, REBUY_RATE,
  round2,
} = require('./commission');
const CP = require('./costorePlan');

/** 产品包 → 门店服务费档位键 */
function storeFeeKey(packageTier) {
  return { vip: 'v1', angel: 'v2', private: 'v3', cofounder: 'co' }[packageTier];
}

/**
 * 全球奖月度结算
 * @param {string} period 结算月 YYYY-MM
 * @param {Array} cofounders 已标注 { id, tier, ownVip, teamVip, daysSinceCofounder, directPushedVip }
 * @param {number} [totalVip] 全平台当月真实 VIP 总量（建议由订单汇总传入，避免联创嵌套重复计数）
 * @returns {Object} { ...computeGlobalBonus结果, commissions:[...], totalVip }
 */
function runGlobalBonus(period, cofounders = [], totalVip) {
  const r = computeGlobalBonus(cofounders, totalVip != null ? { totalVip } : {});
  const tv = r.pool / GLOBAL_UNIT;                     // pool = 150 × totalVip
  const commissions = r.perCofounder.map((p) => ({
    id: `global-${period}-${p.id}`, owner_id: p.id, type: 'global', period,
    // 基数 = 当月全球奖奖池（150 × 总 VIP）；比例 = 本人实得占奖池比例
    base_amount: round2(r.pool),
    rate: r.pool > 0 ? round2(p.total / r.pool) : null,
    amount: p.total, ref_order_id: null, status: 'pending',
  }));
  return { ...r, commissions, totalVip: round2(tv) };
}

/**
 * 创始奖月度结算（永久，按人各得全额，不按人数分摊）
 * 规则（用户 2026-10-24 确认）：
 *   总部每卖出一个 VIP：
 *     - 每个「联创」           → 3500 × 0.5% = 17.5 / VIP
 *         · 含「省/市代理赠予的联创」——2026-10-24 明确：省市代联创同样带创始奖
 *         · 旧口径曾要求 foundingBonus 真值，已取消该门槛（凡 tier=cofounder 即发）
 *     - 每个「私董」           → 3500 × 0.1% = 3.5  / VIP
 *   每人所得 = 对应费率 × 总部产品费(3500) × 当月全平台 VIP 总数（按人各得，不拆分）
 * @param {string} period
 * @param {number} totalVip 当月全平台 VIP 总数
 * @param {Array} recipients [{ id, tier:'cofounder'|'private' }]
 */
function runFoundingBonus(period, totalVip, recipients = []) {
  const commissions = recipients
    .filter((r) => {
      if (r.tier === 'cofounder') return true;   // 联创全员（含省/市代理赠予联创，2026-10-24）
      if (r.tier === 'private') return true;     // 私董全员
      return false;
    })
    .map((r) => {
      const rate = FOUNDING_RATE[r.tier];
      const amount = round2(HQ_PRODUCT_FEE_PER_VIP * rate * totalVip);
      return {
        id: `founding-${period}-${r.id}`, owner_id: r.id, type: 'founding', period,
        base_amount: round2(HQ_PRODUCT_FEE_PER_VIP * totalVip), rate, amount,
        ref_order_id: null, status: 'pending',
      };
    });
  return { commissions };
}

/**
 * 平级奖 / 复购奖（批量入口，供历史补算；日常由 createOrder 即时落账）
 * @param {string} period
 * @param {Array} events [{ type:'parity', buyerTier, uplineChain, quotaCount, cascade, ref_order_id }
 *                        | { type:'rebuy', actual_paid, uplineId, ref_order_id }]
 */
function runParityRebuy(period, events = []) {
  const commissions = [];
  for (const e of events) {
    if (e.type === 'parity') {
      const r = parityBonusCascade(e);
      r.recipients.forEach((rc) => commissions.push({
        id: `parity-${period}-${e.ref_order_id || 'x'}-${rc.id}`, owner_id: rc.id, type: 'parity', period,
        base_amount: rc.supplierPrice, rate: PARITY_RATE, amount: rc.amount,
        ref_order_id: e.ref_order_id || null, status: 'pending',
      }));
    } else if (e.type === 'rebuy') {
      const amt = repurchaseBonus(e.actual_paid);
      commissions.push({
        id: `rebuy-${period}-${e.ref_order_id || 'x'}`, owner_id: e.uplineId, type: 'rebuy', period,
        base_amount: e.actual_paid, rate: REBUY_RATE, amount: amt,
        ref_order_id: e.ref_order_id || null, status: 'pending',
      });
    }
  }
  return { commissions };
}

/**
 * 区域代理月度结算（来自订单门店服务费拆分：省100/市200/县区300/门店2400 每VIP）
 * 门店服务费按每 VIP 名额 3000 计（与整包固定值等价：天使9000=3000×3 等）。
 *
 * ⚠️ 只在「门店售出」渠道计提（用户 2026-10-23 16:56）：
 *    卖方必须是**门店老板**身份（store 级区域代理）才产生门店服务费；
 *    合伙人身份 / 合店老板身份卖出走「合伙人售卖」通道，订单 store_fee=0 → 本节跳过、不拆四级，
 *    那 3,000 并入总部 hq_fee（底价 6,500 不变）。
 * @param {string} period
 * @param {Array} orders [{ id, packageTier, quotaCount, regionCode, store_fee, channel }]
 * @param {Array} agents [{ region_type:'province'|'city'|'district'|'store', region_code, owner_id }]
 * @returns {Object} { commissions(已映射代理的), breakdown(每单拆分明细), skipped }
 */
const STORE_FEE_PER_VIP = { subtotal: 3000, province: 100, city: 200, district: 300, store: 2400 };
const REGION_TYPES = ['province', 'city', 'district', 'store'];
function runAgent(period, orders = [], agents = []) {
  const commissions = [];
  const breakdown = [];
  const skipped = [];
  // 区域码 → 代理 索引（用于「显式父链」向上归集，2026-10-24 区域码设计）
  const byCode = new Map();
  for (const a of agents) if (a && a.region_code) byCode.set(a.region_code, a);

  // 解析某订单的四级代理：
  //   ① 优先按「显式父链」从叶子（门店码 store_code，缺省用 regionCode）逐级 parent_code 向上归集，
  //      彻底消除「门店码≠订单区县码 → 2400 掉总部」的字符串不匹配 bug；
  //   ② 未覆盖到的级别，回退旧口径「region_type + region_code === 订单 regionCode」精确匹配（向后兼容存量数据）。
  const resolve = (o) => {
    const out = { province: null, city: null, district: null, store: null };
    const leafCode = o.store_code || o.regionCode;
    let node = leafCode ? byCode.get(leafCode) : null;
    const seen = new Set();
    while (node && node.region_code && !seen.has(node.region_code)) {
      seen.add(node.region_code);
      if (REGION_TYPES.includes(node.region_type) && !out[node.region_type]) out[node.region_type] = node;
      node = node.parent_code ? byCode.get(node.parent_code) : null;
    }
    for (const rt of REGION_TYPES) {
      if (!out[rt] && o.regionCode) {
        const a = agents.find((x) => x.region_type === rt && x.region_code === o.regionCode);
        if (a) out[rt] = a;
      }
    }
    return out;
  };

  for (const o of orders) {
    // 非门店渠道：无门店服务费，不进四级拆分
    if (!((o.store_fee || 0) > 0)) {
      skipped.push({ orderId: o.id, channel: o.channel || 'partner', reason: '合伙人售卖渠道 · 不计提门店服务费' });
      continue;
    }
    const q = o.quotaCount || 1;
    const s = {
      subtotal: STORE_FEE_PER_VIP.subtotal * q,
      province: STORE_FEE_PER_VIP.province * q,
      city: STORE_FEE_PER_VIP.city * q,
      district: STORE_FEE_PER_VIP.district * q,
      store: STORE_FEE_PER_VIP.store * q,
    };
    breakdown.push({ orderId: o.id, subtotal: s.subtotal, province: s.province, city: s.city, district: s.district, store: s.store });
    const res = resolve(o);
    const comps = [['province', s.province, res.province], ['city', s.city, res.city], ['district', s.district, res.district], ['store', s.store, res.store]];
    for (const [rt, amt, ag] of comps) {
      commissions.push({
        id: `agent-${o.id}-${rt}`, owner_id: ag ? ag.partner_id : 'HQ', type: 'agent', period,
        base_amount: amt, rate: null, amount: amt, ref_order_id: o.id, status: 'pending', region_type: rt,
      });
    }
  }
  return { commissions, breakdown, skipped };
}

/**
 * 合店费月度结算
 *  ── 新四场景逻辑（默认，enabledV2=true）── 见 costorePlan.costoreDistribution：
 *     总部体系 35%（15/2/8/10）+ 门店侧 65%（门店店长服务 40% + 业务 15%[13 直推+2 复购] + 分红池 10%）
 *     业务 15% 按 A/B/C/D 四场景分流；分红池 10% 按「单店」独立、一半人数均分 + 一半业绩比例分。
 *  ── 旧固定三分（回滚，enabledV2=false）── 门店老板 53% + 推荐人 2% + 分红池 10%，等价于新逻辑场景 C。
 *
 * @param {string} period
 * @param {Array} costoreFees [{ id, owner_id, storeManagerId, promoter_id, uplineId, fee, store_id, joinDate, ownerCount, owners:[{id,performance}] }]
 * @param {Object} opts { settings, costoreOwners:Set }  settings=后台可调配置；costoreOwners=合店老板 id 集合
 */
function runCostore(period, costoreFees = [], opts = {}) {
  const { settings, costoreOwners, agents = [] } = opts;
  const enableV2 = settings ? settings.costore.enabledV2 : true;
  const cfg = CP.buildConfig(settings ? settings.costore : {});
  const commissions = [];
  const details = [];

  if (!enableV2) {
    // ══ 回滚旧逻辑（固定三分，等价于新逻辑场景 C） ══
    for (const cf of costoreFees) {
      const alloc = coStoreFeeAllocation(cf.fee, {
        ownerCount: cf.ownerCount || 1,
        // 旧分红口径按 feePerf（实际推荐业绩）判定资格；合店记录存的是 performance，这里回退
        owners: (cf.owners || cf.partners || []).map((o) => ({ id: o.id, feePerf: o.feePerf != null ? o.feePerf : (o.performance || 0) })),
      });
      const split = coStoreSplit(cf.fee);
      details.push({ fee: cf.fee, split, alloc, scenario: 'C(legacy)' });
      const b = alloc.buckets;
      commissions.push({ id: `cs-hq-${cf.id}`, owner_id: 'HQ', type: 'costore', period, base_amount: cf.fee, rate: 0.15, amount: b.hq, ref_order_id: cf.id, status: 'pending' });
      commissions.push({ id: `cs-prov-${cf.id}`, owner_id: 'HQ', type: 'costore', period, base_amount: cf.fee, rate: 0.02, amount: b.province, ref_order_id: cf.id, status: 'pending' });
      commissions.push({ id: `cs-city-${cf.id}`, owner_id: 'HQ', type: 'costore', period, base_amount: cf.fee, rate: 0.08, amount: b.city, ref_order_id: cf.id, status: 'pending' });
      commissions.push({ id: `cs-dist-${cf.id}`, owner_id: 'HQ', type: 'costore', period, base_amount: cf.fee, rate: 0.10, amount: b.district, ref_order_id: cf.id, status: 'pending' });
      commissions.push({ id: `cs-store-${cf.id}`, owner_id: cf.owner_id, type: 'costore', period, base_amount: cf.fee, rate: alloc.tipRatePerOwner, amount: round2(alloc.storeOwner.perOwner + alloc.storeOwner.perOwnerRemainder), ref_order_id: cf.id, status: 'pending' });
      if (alloc.referrerAmount > 0 && cf.promoter_id) {
        commissions.push({ id: `cs-referrer-${cf.id}`, owner_id: cf.promoter_id, type: 'costore', period, base_amount: cf.fee, rate: alloc.referrerAmount / cf.fee, amount: alloc.referrerAmount, ref_order_id: cf.id, status: 'pending' });
      }
      for (const p of (alloc.dividend.partners || [])) {
        if (p.eligible && p.total > 0) {
          commissions.push({ id: `cs-div-${cf.id}-${p.id}`, owner_id: p.id, type: 'costore', period, base_amount: cf.fee, rate: 0.10, amount: p.total, ref_order_id: cf.id, status: 'pending' });
        }
      }
      // 兜底：旧分红按 feePerf>0 资格，若无合格者则 10% 池易漏分 → 归合店老板(owner_id)，保证 100% 闭环
      const undistributed = alloc.dividend && alloc.dividend.undistributed ? alloc.dividend.undistributed : 0;
      if (undistributed > 0) {
        commissions.push({ id: `cs-div-undist-${cf.id}`, owner_id: cf.owner_id, type: 'costore', period, base_amount: cf.fee, rate: 0.10, amount: round2(undistributed), ref_order_id: cf.id, status: 'pending' });
      }
    }
    return { commissions, details };
  }

  // ════ 新四场景逻辑 ════
  // 1) 逐笔合店费 → 四场景整笔分配（90%，不含分红池）
  for (const cf of costoreFees) {
    const storeManagerId = cf.storeManagerId || cf.owner_id;
    const referrer = cf.promoter_id
      ? { id: cf.promoter_id, isCostoreOwner: !!(costoreOwners && costoreOwners.has(cf.promoter_id)) }
      : null;
    const uplineId = cf.uplineId || null;
    // 省 2% / 市 8% / 区县 10% 必须落到真实区域代理，缺省才归总部（HQ）。
    const rid = CP.resolveRegionOwners(agents, cf.regionCode || null);
    const res = CP.costoreDistribution({
      fee: cf.fee, config: cfg,
      storeManagerId, referrer, upline: uplineId ? { id: uplineId } : null,
      uplineIsCostoreOwner: !!(costoreOwners && uplineId && costoreOwners.has(uplineId)),
      provinceId: rid.provinceId || 'HQ',
      cityId: rid.cityId || 'HQ',
      districtId: rid.districtId || 'HQ',
    });
    details.push({ fee: cf.fee, scenario: res.scenario, byRecipient: res.byRecipient, dividendPool: res.dividendPool });

    // 落账：按 items（逐角色独立一条），subtype 精准归类，便于报表/对账单分离
    //   · 区域角色（hq/province/city/district）→ region_costore，归「代理」身份
    //   · 门店服务 storeService → costore_store_service，归「合店店长」身份
    //   · 业务奖励（13% 直推 / 2% 复购）：
    //       - 收款人为真实上级(uplineId) → costore_upline_direct / costore_upline_repurchase，归「合伙人(上级)」身份
    //       - 收款人为门店店长兜底（无上级）→ costore_store_direct / costore_store_repurchase，归「合店店长」身份
    const UPLINE_SUBTYPE = { businessDirect: 'costore_upline_direct', businessUpline: 'costore_upline_repurchase' };
    const STORE_SUBTYPE = { businessDirect: 'costore_store_direct', businessUpline: 'costore_store_repurchase' };
    const REGION_ROLES = ['hq', 'province', 'city', 'district'];
    for (const it of res.items) {
      if (it.role === 'dividend') continue; // 分红池另行按月归集
      let subtype;
      if (REGION_ROLES.includes(it.role)) subtype = 'region_costore';
      else if (it.role === 'storeService') subtype = 'costore_store_service';
      else if (it.role === 'businessDirect' || it.role === 'businessUpline') {
        subtype = (it.id === uplineId) ? UPLINE_SUBTYPE[it.role] : STORE_SUBTYPE[it.role];
      } else subtype = 'costore_owner';
      commissions.push({
        id: `cs-${cf.id}-${it.role}-${it.id}`, owner_id: it.id, type: 'costore', period,
        subtype,
        base_amount: cf.fee, rate: it.rate, amount: it.amount,
        ref_order_id: cf.id, status: 'pending',
        note: `${res.scenario.code} | ${it.note}`,
      });
    }
  }

  // 2) 分红池：按月「全平台一个池」（与全球奖 / 创始奖同口径）
  //    · 合店费是一次性消费（最低 6 个月起购，起步 4188），当期 10% 全额计入**本月**池，
  //      不做 6 个月摊销、不逐笔各自成池 —— 用户 2026-10-23 明确口径。
  //    · 跨店的自有合店老板合并为同一受益人：业绩累加、入股时间取最早（无责期以最早为准）。
  let totalPool = 0;
  const divFeeIds = [];
  const divOwnerMap = new Map();
  for (const cf of costoreFees) {
    totalPool = round2(totalPool + (cf.fee || 0) * cfg.rates.dividend);
    divFeeIds.push(cf.id);
    const ownerPerf = (cf.owners || []).find((o) => o.id === cf.owner_id);
    const perf = ownerPerf ? (ownerPerf.performance || 0) : 0;
    const joinedMonthsAgo = CP.monthsSince(cf.joinDate || period, period);
    const prev = divOwnerMap.get(cf.owner_id);
    if (prev) {
      prev.performance = round2(prev.performance + perf);                       // 跨店业绩累加
      prev.joinedMonthsAgo = Math.min(prev.joinedMonthsAgo, joinedMonthsAgo);   // 以最早入股计无责期
      prev.salesMet = prev.salesMet || perf > 0;
    } else {
      // 简化：当月有本人销售业绩即视为达标（真实口径以订单为准）
      divOwnerMap.set(cf.owner_id, { id: cf.owner_id, performance: perf, joinedMonthsAgo, salesMet: perf > 0 });
    }
  }
  if (totalPool > 0) {
    const owners = [...divOwnerMap.values()];
    if (!owners.length) {
      // 无任何合店老板 → 池归总部，保证 100% 闭环
      commissions.push({
        id: `cs-div-hq-${period}`, owner_id: 'HQ', type: 'costore', period,
        base_amount: totalPool, rate: cfg.rates.dividend, amount: totalPool,
        ref_order_id: null, status: 'pending',
        note: `全平台分红池(${period}/${divFeeIds.length}笔) 无合店老板→归总部`,
      });
    } else {
      const split = CP.dividendSplit({ pool: totalPool, owners, config: cfg });
      for (const row of split.rows) {
        if (row.total > 0) {
          commissions.push({
            id: `cs-div-${row.id}-${period}`, owner_id: row.id, type: 'costore', period,
            base_amount: totalPool, rate: null, amount: row.total,
            ref_order_id: null, status: 'pending',
            note: `全平台分红池(${period}/${divFeeIds.length}笔) ${row.eligible ? row.reason : '不合格'}`,
          });
        }
      }
      // 闭环兜底：合格者为 0（全员过无责期且未达标）→ 全池归总部，不给不合格者，也不偏向某个店长
      const remainder = round2(totalPool - split.totalDistributed);
      if (remainder > 0) {
        commissions.push({
          id: `cs-div-remain-hq-${period}`, owner_id: 'HQ', type: 'costore', period,
          base_amount: totalPool, rate: cfg.rates.dividend, amount: remainder,
          ref_order_id: null, status: 'pending',
          note: `全平台分红池(${period}/${divFeeIds.length}笔) 无合格合店老板→余款归总部`,
        });
      }
    }
  }

  return { commissions, details };
}

/**
 * 月度结算总编排
 * @param {Object} data { period, orders, cofounders, founders, events, costoreFees, agents }
 */
function settleAll(data = {}) {
  const { period, orders = [], cofounders = [], founders = [], events = [], costoreFees = [], agents = [], settings, costoreOwners } = data;
  const commissions = [];

  // 全平台真实 VIP 总量：所有产品订单的 vipCredit 之和（每个订单只计一次，不随联创嵌套重复）
  const totalVipOrders = orders.reduce((s, o) => s + (o.vipCredit != null ? o.vipCredit : 0), 0);

  const gb = runGlobalBonus(period, cofounders, totalVipOrders);
  gb.commissions.forEach((c) => commissions.push(c));

  const fb = runFoundingBonus(period, totalVipOrders, founders);
  fb.commissions.forEach((c) => commissions.push(c));

  const pr = runParityRebuy(period, events);
  pr.commissions.forEach((c) => commissions.push(c));

  const ag = runAgent(period, orders, agents);
  ag.commissions.forEach((c) => commissions.push(c));

  const cs = runCostore(period, costoreFees, { settings, costoreOwners, agents });
  cs.commissions.forEach((c) => commissions.push(c));

  const byType = {};
  let total = 0;
  for (const c of commissions) { byType[c.type] = round2((byType[c.type] || 0) + c.amount); total += c.amount; }
  return {
    commissions,
    summary: { byType, total: round2(total), globalPool: gb.pool, totalVip: gb.totalVip, agentBreakdown: ag.breakdown, agentSkipped: ag.skipped, costoreDetails: cs.details },
  };
}

/**
 * 区域代理 · 月度综合结算（依据 tp 蓝图 2026-10-22，补全区域奖/商品级差/开发奖/行政费/合店费）
 * 与 runAgent（按门店服务费 3000 拆分）并存；runAgent 保持既有口径，本函数为「区域代理完整收益」口径。
 * @param {string} period
 * @param {object} input 见 regionAgent.monthlyRegionAgent
 * @param {string} ownerId 区域代理合伙人 id
 */
function runRegionAgentMonth(period, ownerId, input = {}, cfg = null) {
  const R = require('./regionAgent');
  // P1-3：直推提点分档配置（settings.agentDirectBonus）；未传时沿用固定 15%
  const r = R.monthlyRegionAgent(cfg ? { ...input, directTierCfg: cfg } : input);
  const mk = (type, amount, extra = {}) => ({
    id: `ra-${period}-${ownerId}-${type}`, owner_id: ownerId, type, period,
    base_amount: extra.base_amount != null ? extra.base_amount : null,
    rate: extra.rate != null ? extra.rate : null,
    amount: round2(amount), ref_order_id: null, status: 'pending', ...extra,
  });
  const commissions = [];
  if (r.vip.amount) commissions.push(mk('region_vip', r.vip.amount, { base_amount: r.vip.vipCount, rate: r.vip.perVip, region_type: r.regionType }));
  if (r.goodsTotal) commissions.push(mk('region_goods_diff', r.goodsTotal, { detail: r.goodsItems }));
  if (r.signing.amount) commissions.push(mk('region_signing', r.signing.amount, { base_amount: r.signing.baseAmount, rate: r.signing.rate }));
  if (r.admin) commissions.push(mk('region_admin_delivery', r.admin, { base_amount: r.admin / 0.90, rate: 0.90 }));
  if (r.coStoreTotal) commissions.push(mk('region_costore', r.coStoreTotal, { rate: r.coStoreRate }));
  return { ...r, commissions, summaryTotal: r.total };
}

module.exports = {
  storeFeeKey, runGlobalBonus, runFoundingBonus, runParityRebuy, runAgent, runCostore,
  runRegionAgentMonth, settleAll,
};

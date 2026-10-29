'use strict';

/**
 * 合店老板（合店费）收益分配 —— 计算模块
 *
 * 规则来源：用户 2026-10-23 口述 + 《脑商俱乐部·合店老板》两张截图
 * 更新：2026-10-23 二次澄清（单店独立 / 无责分红按入股首月 / 业绩不含合店费）
 *
 * ── 一、合店费（可配置，不写死）──────────────────────────
 *   · 月费：暂定 698 元/月（config.monthlyFee，后台可改）
 *   · 起付：默认 6 个月，最少 6 个月，可自定义（如 12 个月）
 *   · 总额 = 月费 × 月数
 *   · 成为合店老板的前提：必须是 VIP 及以上合伙人（config.minTierForOwner）
 *
 * ── 二、合店费分配（合计 100%）──────────────────────────
 *   总部体系 35% = 总部 15% + 省 2% + 市 8% + 区/县 10%
 *   门店侧   65% = 服务 40% + 业务 15% + 分红 10%
 *      · 服务 40%  → 门店股东（即门店店长，仅一人）
 *      · 业务 15%  = 直推奖 13% + 复购奖 2%（按下方四场景分流）
 *      · 分红 10%  → 分红池（单店独立）
 *
 * ── 三、业务 15% 的四场景（用户口述核心，2026-10-24 修订）────────────────
 *   设：上级 upline = **被推荐人（新合店老板，即缴纳这笔合店费的人）自己的直接上级**，
 *             在合伙人批发体系里他进货/拿名额的那个人。
 *       门店店长 storeManager（拿 40% 服务，同时是 13%/2% 的兜底收款人）
 *
 *   2026-10-24 规则修订（用户明确口径）：
 *     13% 直推奖的归属以「**新合店老板的上级是否为合店老板**」判定：
 *       · 上级是合店老板 → 13% 直推奖给该合店店长（上级即合店老板，业务15%全归其本人）
 *       · 上级不是合店老板 → 13% 直推奖给门店店长
 *     2% 复购奖 → 上级（若存在）否则门店店长（不变）
 *
 *   因此实际分三种情况（按 upline / uplineIsCostoreOwner）：
 *   B. 上级是合店老板 → 上级拿 13%直推 + 2%复购 = 15%
 *   C. 上级非合店老板 且 有上级 → 门店店长 13% + 上级 2%
 *   D. 无上级 → 门店店长 15%（13% + 2% 都归门店店长）
 *
 *   统一模型（两槽位，永远刚好 15%）：
 *     13% 直推奖 → 上级(为合店老板时) 否则 门店店长
 *      2% 复购奖 → 上级（若存在）否则门店店长
 *   说明：推荐人 referrer 概念保留用于记录，但 13% 已不再以推荐人身份判定（改以新合店老板的上级）。
 *
 * ── 四、分红（单店独立，两池同一分配规则）──────────────
 *   池1：合店费分红 = 合店费 × 10%（单店，按本店合店老板人数）
 *   池2：软件卡/VIP 分红 = 软件单价 × 单位数（config.softwareUnitPrice，可改）
 *   分配：一半按「本店合店老板人数」均分，一半按「各自业绩比例」分。
 *   业绩口径：只算合店老板**本人卖出的**产品/会员/VIP（不含其缴纳的合店费）。
 *   资格：当月至少直推 1 个合店老板/季卡会员/VIP 合伙人；
 *         入股首 graceMonths 月「无责分红」（免考核，后台可调，默认 1 个月）。
 *   业务规则：入股 6 个月起步，期间**不允许退店**（系统不提供退店/退款操作）。
 */

const { levelOf } = require('./partnerGrade');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// ───────────────────────── 默认配置（全部可覆盖 / 后台可调） ─────────────────────────
const DEFAULT_CONFIG = {
  monthlyFee: 698,          // 元/月（暂定，后台可改）
  defaultMonths: 6,         // 默认起付月数
  minMonths: 6,             // 最少起付月数（不得少于 6）
  minTierForOwner: 'vip',   // 成为合店老板的最低合伙人档位（VIP 及以上）

  softwareUnitPrice: 100,   // 软件卡/VIP 分红基数（元/月/单位），后台可改
  softwareToPoolRate: 1.0,  // 软件卡/VIP 销售额计入分红池比例（后台可调，默认 100%）

  rates: {
    hq: 0.15,               // 总部 15%
    province: 0.02,         // 省 2%
    city: 0.08,             // 市 8%
    district: 0.10,         // 区/县 10%
    storeService: 0.40,     // 门店股东(店长) 服务 40%
    businessDirect: 0.13,   // 业务·直推奖 13%
    businessUpline: 0.02,   // 业务·复购奖 2%
    dividend: 0.10,         // 分红池 10%
  },

  dividend: {
    byCount: 0.5,           // 一半按人数均分
    byPerf: 0.5,            // 一半按业绩比例分
    monthlyReferralQuota: 1,// 每月至少直推 1 个（合店老板/季卡会员/VIP合伙人）
    graceMonths: 1,         // 无责分红月数（入股首月），后台可改
  },
};

// ───────────────────────── 工具 ─────────────────────────
function rateSum(config = DEFAULT_CONFIG) {
  const r = config.rates;
  return round2(
    r.hq + r.province + r.city + r.district +
    r.storeService + r.businessDirect + r.businessUpline + r.dividend
  );
}

/** 校验分配比例合计必须 = 100% */
function assertRates(config = DEFAULT_CONFIG) {
  const s = rateSum(config);
  if (Math.abs(s - 1) > 1e-9) {
    throw new Error(`分配比例合计应为 100%，当前 ${(s * 100).toFixed(2)}%（请检查 config.rates）`);
  }
  return true;
}

/** 是否具备成为合店老板的资格（必须 VIP 及以上合伙人） */
function canBeCostoreOwner(tier, config = DEFAULT_CONFIG) {
  return levelOf(tier) >= levelOf(config.minTierForOwner);
}

// ───────────────────────── 一、合店费总额 ─────────────────────────
/**
 * @returns {{monthlyFee:number, months:number, total:number}}
 * @throws 月数 < config.minMonths 时抛错（6 个月起付硬约束）
 */
function costoreFeeTotal({ monthlyFee, months, config = DEFAULT_CONFIG } = {}) {
  const mf = monthlyFee != null ? Number(monthlyFee) : config.monthlyFee;
  const m = months != null ? Number(months) : config.defaultMonths;
  if (!Number.isFinite(m) || m < config.minMonths) {
    throw new Error(`合店费起付月数不得少于 ${config.minMonths} 个月，当前 ${m}`);
  }
  if (!Number.isFinite(mf) || mf <= 0) {
    throw new Error(`合店费月费必须 > 0，当前 ${mf}`);
  }
  return { monthlyFee: mf, months: m, total: round2(mf * m) };
}

// ───────────────────────── 场景描述（2026-10-24 新口径：13% 以「上级是否为合店老板」判定） ─────────────────────────
function describeScenario({ uplineIsCostoreOwner, hasUpline }) {
  if (uplineIsCostoreOwner && hasUpline) {
    return { code: 'B', label: '上级是合店老板 → 上级拿 13%直推 + 2%复购 = 15%' };
  }
  if (!uplineIsCostoreOwner && hasUpline) {
    return { code: 'C', label: '上级非合店老板 → 门店店长13% + 上级2%' };
  }
  return { code: 'D', label: '无上级 → 门店店长 15%' };
}

// ───────────────────────── 二、合店费一次性分配 ─────────────────────────
/**
 * 对「一笔合店费（月费×月数，或服务端按月 recurring 的整笔总额）」做整笔分配。
 *
 * @param {Object} p
 *   fee             【可选】直接传入整笔合店费总额（如服务端按月 recurring 场景：本月即 698）。
 *                   一旦提供则跳过 costoreFeeTotal 的「起付月数」校验（那是登记/合同约束，
 *                   按月结算时应放行）。优先于 monthlyFee/months。
 *   monthlyFee      月费（缺省 config.monthlyFee）——用于按「月费×月数」推导总额的登记预览/测试
 *   months          月数（缺省 config.defaultMonths，且不得 < config.minMonths）——登记预览/测试用
 *   storeManagerId  门店股东/店长 id（必填，拿 40% 服务，兼任一槽位兜底）
 *   referrer        { id, isCostoreOwner:boolean } | null
 *   upline          { id } | null（**被推荐人（新合店老板）自己的直接上级**；可为推荐人本人。注意：这是被推荐人的上级，不是推荐人的上级——推荐人的上级不拿钱）
 *   provinceId/cityId/districtId   区域收款人 id（仅用于打标）
 *   config          可覆盖默认配置
 * @returns {Object} 明细 items / 按人汇总 byRecipient / 分红池 / 闭环校验
 */
function costoreDistribution({
  fee,
  monthlyFee,
  months,
  config = DEFAULT_CONFIG,
  storeManagerId,
  referrer = null,
  upline = null,
  uplineIsCostoreOwner = false,
  provinceId = 'PROV',
  cityId = 'CITY',
  districtId = 'DIST',
} = {}) {
  assertRates(config);
  if (!storeManagerId) throw new Error('缺少门店店长 storeManagerId');

  // 总额：若直接传入 fee（服务端按月 recurring），则跳过起付月数校验；
  // 否则按「月费×月数」推导（登记预览/单元测试，会校验 minMonths）。
  let total;
  let monthlyFeeOut = monthlyFee != null ? Number(monthlyFee) : config.monthlyFee;
  let monthsOut = months != null ? Number(months) : config.defaultMonths;
  if (fee != null && Number(fee) > 0) {
    total = round2(Number(fee));
    monthlyFeeOut = config.monthlyFee;
    monthsOut = 1; // 按月结算，本笔即 1 个月费
  } else {
    const f = costoreFeeTotal({ monthlyFee, months, config });
    total = f.total;
    monthlyFeeOut = f.monthlyFee;
    monthsOut = f.months;
  }
  const r = config.rates;

  const referrerIsOwner = !!(referrer && referrer.isCostoreOwner && referrer.id);
  const uplineId = upline && upline.id ? upline.id : null;

  // 两个独立槽位（永远刚好 15%）：
  //   13% 直推奖 → 上级若为「合店老板」则给该合店店长，否则给门店店长
  //                （用户 2026-10-24 口径：以「新合店老板的上级是否为合店老板」判定，
  //                  不再是「推荐人是否为合店老板」；上级即合店老板时，13% 直推直接归他）
  //    2% 复购奖 → 上级(若存在) 否则 门店店长
  //   说明：上级本身是合店老板时，13%+2% 合并 15% 归该合店店长（上级=合店老板，业务15%全归其本人）。
  const directRecipient = (uplineIsCostoreOwner && uplineId) ? uplineId : storeManagerId;
  let uplineRecipient = uplineId || storeManagerId;
  let uplineNote = uplineId ? '2% 复购奖 → 上级' : '2% 复购奖 → 门店店长(无上级)';
  const directNote = (uplineIsCostoreOwner && uplineId)
    ? '13% 直推奖 → 合店店长(上级即合店老板)'
    : '13% 直推奖 → 门店店长(上级非合店老板)';

  const items = [];
  const add = (role, id, rate, note) =>
    items.push({ role, id, rate, amount: round2(total * rate), note });

  add('hq', 'HQ', r.hq, '总部 15%');
  add('province', provinceId, r.province, '省 2%');
  add('city', cityId, r.city, '市 8%');
  add('district', districtId, r.district, '区/县 10%');
  add('storeService', storeManagerId, r.storeService, '门店股东(店长) 服务 40%');
  add('businessDirect', directRecipient, r.businessDirect, directNote);
  add('businessUpline', uplineRecipient, r.businessUpline, uplineNote);
  add('dividend', 'DIVIDEND', r.dividend, '分红池 10%（单店）');

  // 分位余数并入分红池，保证 100% 闭环
  const allocated = round2(items.reduce((s, i) => s + i.amount, 0));
  const remainder = round2(total - allocated);
  if (remainder !== 0) {
    const div = items.find((i) => i.role === 'dividend');
    div.amount = round2(div.amount + remainder);
  }

  // 按收款人汇总（分红池单独拎出，不参与个人汇总）
  const map = new Map();
  for (const it of items) {
    if (it.id === 'DIVIDEND') continue;
    if (!map.has(it.id)) map.set(it.id, { id: it.id, amount: 0, roles: [], notes: [] });
    const e = map.get(it.id);
    e.amount = round2(e.amount + it.amount);
    e.roles.push(it.role);
    e.notes.push(it.note);
  }
  const byRecipient = [...map.values()];

  const dividendItem = items.find((i) => i.role === 'dividend');
  const sumAll = round2(items.reduce((s, i) => s + i.amount, 0));

  return {
    scenario: describeScenario({ uplineIsCostoreOwner, hasUpline: !!uplineId }),
    monthlyFee: monthlyFeeOut,
    months: monthsOut,
    total,
    rates: r,
    items,
    byRecipient,
    dividendPool: dividendItem.amount,
    closure: sumAll === total,
    sumAllocated: sumAll,
  };
}

/**
 * 解析某笔合店费应归属的省/市/区县代理。
 * 规则（与 runAgent 一致）：region_code 精确匹配优先；无匹配时若该级只有唯一代理则归其，
 * 否则返回 null（由调用方兜底归总部 HQ，避免落入不存在的 PROV/CITY/DIST 幽灵账户）。
 * @param {Array} agents [{ region_type, region_code, partner_id }]
 * @param {string|null} regionCode
 */
function resolveRegionOwners(agents = [], regionCode = null) {
  const pick = (type) => {
    const list = (agents || []).filter((a) => a && a.region_type === type && a.partner_id);
    if (!list.length) return null;
    if (regionCode) {
      const hit = list.find((a) => a.region_code === regionCode);
      if (hit) return hit.partner_id;
    }
    return list.length === 1 ? list[0].partner_id : null;
  };
  return { provinceId: pick('province'), cityId: pick('city'), districtId: pick('district') };
}

// ───────────────────────── 三、分红资格 & 分红池分配（单店独立） ─────────────────────────
/**
 * 分红资格判定（按月）：
 *   · 入股首 graceMonths 月为「无责分红」（免考核）；
 *   · 之后必须当月达成销售门槛（直推≥1 合店老板/季卡会员/VIP合伙人或售出产品）。
 * @param {Object} o { joinedMonthsAgo, salesMet, graceMonths }
 */
function qualifyForDividend({ joinedMonthsAgo = 0, salesMet = false, graceMonths = DEFAULT_CONFIG.dividend.graceMonths } = {}) {
  const j = Number(joinedMonthsAgo) || 0;
  if (j < graceMonths) {
    return { qualified: true, reason: `入股首 ${graceMonths} 月无责分红` };
  }
  return salesMet
    ? { qualified: true, reason: '达成月度销售门槛' }
    : { qualified: false, reason: '未达成销售门槛' };
}

/**
 * 把一个【单店】分红池按「一半人数均分 + 一半业绩比例」分给本店合店老板。
 *
 * @param {Object} p
 *   pool    本店分红池金额（单店独立，不跨店）
 *   owners  [{ id, performance, joinedMonthsAgo, salesMet }]
 *             - performance：该合店老板**本人卖出的**产品/会员/VIP 业绩（不含合店费）
 *             - joinedMonthsAgo：入股至今月数（用于无责分红判定）
 *             - salesMet：当月是否达成销售门槛
 *   config  可覆盖默认配置
 * 不合格者分 0，其份额自动由合格者按原规则分摊（池子总额固定）。
 */
function dividendSplit({ pool, owners = [], config = DEFAULT_CONFIG } = {}) {
  const d = config.dividend;
  const poolAmt = round2(pool);
  const enriched = owners.map((o) => {
    const q = qualifyForDividend({
      joinedMonthsAgo: o.joinedMonthsAgo,
      salesMet: !!o.salesMet,
      graceMonths: d.graceMonths,
    });
    return {
      id: o.id,
      performance: o.performance || 0,
      joinedMonthsAgo: Number(o.joinedMonthsAgo) || 0,
      qualified: q.qualified,
      reason: q.reason,
    };
  });

  const eligible = enriched.filter((o) => o.qualified);
  const n = eligible.length;
  const countPart = round2(poolAmt * d.byCount);
  const perfPart = round2(poolAmt * d.byPerf);
  const perHead = n ? round2(countPart / n) : 0;
  const totalPerf = eligible.reduce((s, o) => s + o.performance, 0);

  const rows = enriched.map((o) => {
    if (!o.qualified) {
      return { id: o.id, eligible: false, reason: o.reason, fromCount: 0, fromPerf: 0, total: 0 };
    }
    const fromCount = perHead;
    const fromPerf = totalPerf > 0
      ? round2(perfPart * (o.performance / totalPerf))
      : (n ? round2(perfPart / n) : 0);   // 业绩全为 0 时，业绩半也按人数均分，避免漏分
    return {
      id: o.id,
      eligible: true,
      reason: o.reason,
      performance: o.performance,
      fromCount: round2(fromCount),
      fromPerf,
      total: round2(fromCount + fromPerf),
    };
  });

  // 分位余数补给第一个合格者
  const sum = round2(rows.reduce((s, x) => s + x.total, 0));
  const remainder = round2(poolAmt - sum);
  if (remainder !== 0) {
    const first = rows.find((x) => x.eligible);
    if (first) first.total = round2(first.total + remainder);
  }

  return {
    pool: poolAmt,
    graceMonths: d.graceMonths,
    eligibleCount: n,
    countPart,
    perfPart,
    perHead,
    totalPerf: round2(totalPerf),
    rows,
    ineligible: rows.filter((x) => !x.eligible).map((x) => x.id),
    totalDistributed: round2(rows.reduce((s, x) => s + x.total, 0)),
  };
}

/**
 * 单店分红池聚合（合店费部分 + 软件卡/VIP 部分），单店独立。
 * 合店费池 = 698 × 月数 × 本店合店老板人数 × 10%
 * 软件池 = 软件单价 × 单位数 × 计入比例 × 10%
 */
function storeDividendPool({ ownerCount = 0, feeMonths = 1, softwareUnits = 0, config = DEFAULT_CONFIG } = {}) {
  const c = config;
  const feeTotal = round2(c.monthlyFee * Math.max(0, feeMonths) * Math.max(0, ownerCount));
  const feePool = round2(feeTotal * c.rates.dividend); // 合店费的 10% 注入分红池
  // 软件卡/VIP 池：基数 × 单位数 × 计入比例（默认 100%，即全额作池；可调为实际利润率）
  const softwarePool = round2(
    softwareUnits * (c.softwareUnitPrice || 0) * (c.softwareToPoolRate || 1)
  );
  return { feePool, softwarePool, total: round2(feePool + softwarePool) };
}

/** 软件卡/VIP 会员分红池 = 单价 × 单位数（默认 100 元/月/单位） */
function softwareDividendPool({ units = 0, perUnit, config = DEFAULT_CONFIG } = {}) {
  const p = perUnit != null ? perUnit : config.softwareUnitPrice;
  return round2(p * (units || 0));
}

// ───────────────────────── 配置构造 & 时间辅助（供 settlement 调用） ─────────────────────────
/**
 * 由后台 settings.costore 构造 costoreDistribution 可用的 config（只覆盖可调项，其余回退默认）。
 * 可调项：monthlyFee / minMonths / graceMonths / softwareUnitPrice / softwareToPoolRate
 */
function buildConfig(settingsCostore = {}) {
  const d = DEFAULT_CONFIG;
  const s = settingsCostore || {};
  return {
    ...d,
    monthlyFee: s.monthlyFee != null ? Number(s.monthlyFee) : d.monthlyFee,
    minMonths: s.minMonths != null ? Number(s.minMonths) : d.minMonths,
    softwareUnitPrice: s.softwareUnitPrice != null ? Number(s.softwareUnitPrice) : d.softwareUnitPrice,
    softwareToPoolRate: s.softwareToPoolRate != null ? Number(s.softwareToPoolRate) : d.softwareToPoolRate,
    dividend: { ...d.dividend, graceMonths: s.graceMonths != null ? Number(s.graceMonths) : d.dividend.graceMonths },
  };
}

/** 解析 YYYY-MM 或时间戳 → { y, m } */
function parsePeriod(v) {
  if (v == null) return null;
  if (typeof v === 'number') { const d = new Date(v); return { y: d.getFullYear(), m: d.getMonth() + 1 }; }
  const m = String(v).match(/^(\d{4})[-/](\d{1,2})/);
  if (m) return { y: Number(m[1]), m: Number(m[2]) };
  return null;
}

/** joinDate 到 toPeriod(YYYY-MM) 的月数（用于无责分红首月判定） */
function monthsSince(joinDate, toPeriod) {
  const to = parsePeriod(toPeriod);
  const from = parsePeriod(joinDate);
  if (!to || !from) return 999;
  return Math.max(0, (to.y - from.y) * 12 + (to.m - from.m));
}

// ───────────────────────── 四、速查表 ─────────────────────────
function costorePlanTable(config = DEFAULT_CONFIG) {
  const r = config.rates;
  return [
    { key: 'hq', name: '总部', rate: r.hq },
    { key: 'province', name: '省', rate: r.province },
    { key: 'city', name: '市', rate: r.city },
    { key: 'district', name: '区/县', rate: r.district },
    { key: 'storeService', name: '门店股东(店长) 服务', rate: r.storeService },
    { key: 'businessDirect', name: '业务·直推奖', rate: r.businessDirect },
    { key: 'businessUpline', name: '业务·复购奖', rate: r.businessUpline },
    { key: 'dividend', name: '分红池', rate: r.dividend },
  ];
}

module.exports = {
  DEFAULT_CONFIG,
  rateSum, assertRates, canBeCostoreOwner,
  costoreFeeTotal,
  describeScenario, costoreDistribution,
  resolveRegionOwners,
  qualifyForDividend, dividendSplit, storeDividendPool, softwareDividendPool,
  buildConfig, monthsSince, parsePeriod,
  costorePlanTable,
  round2,
};

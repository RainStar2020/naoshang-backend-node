/**
 * 门店收益规则表（2026-10-27 用户拨比表落地）
 *
 * ════════════════════════════════════════════════════════════════
 * 一、为什么单独建表
 * ════════════════════════════════════════════════════════════════
 * 用户拨比表（截图）里，**门店收益按商品类型不同，各不相同**：
 *   ① 实物产品（脑商Pad 6980）：门店赚「拿货差价」——区县拿货 40%(2792)，
 *      按天使价 5235 卖出，利润 2443。**不参与比例分成池**。
 *   ② AI软件卡（记忆卡 998）：走「拿货差价」——地市拿货 170，
 *      按私董价 698.6 卖出，利润 528.6。**不参与比例分成池**。
 *   ③ 特色产品（陪练卡 2000 / 特色营 10000）：走「比例分成池」——
 *      总部15% / 省2% / 市8% / 区县(管理5%+巡查5%) / 单店(交付30%+流量30%+销售5%)。
 *      其中**区县 5% 巡查**可再分配、**单店 5% 销售**可再分配（原型两个弹窗）。
 *   ④ 行政费用（2000）：总部5% / 销售门店5% / 交付(上课团队)90%。
 *
 * ════════════════════════════════════════════════════════════════
 * 二、与既有引擎的关系（重要）
 * ════════════════════════════════════════════════════════════════
 *   · ③ 特色产品的比例分成：productSplit.featuredSplit 已完全实现
 *     （15/2/8/(5+5)/(30+30+5) = 100%），**不改**。
 *   · ④ 行政费 5/5/90：productSplit.adminFeeSplitDetail 已实现，**不改**。
 *   · ①② 实物/软件卡：引擎现状是「代理固定上级链级差」（physicalTierDiff /
 *     agentChainTierDiff），与拨比表的「拿货价 + 利润」是**同一口径的两种表达**
 *     （拿货价 = 该级折扣价，利润 = 卖价 − 拿货价），**不改算法**，
 *     只在本表登记「门店侧收益规则」，供前台/后台查询与对账。
 *
 * ════════════════════════════════════════════════════════════════
 * 三、门店收益 vs 合店老板收益（两套完全不同的账）
 * ════════════════════════════════════════════════════════════════
 *   · **门店收益（storeIncome）**：门店**卖货**赚到的钱，随商品类型按上表规则算。
 *     来源：商城产品订单分润（type='product'）。
 *   · **合店老板收益（costoreOwnerIncome）**：合店老板**交合店费入股**分到的钱，
 *     按 40%服务 / 13%直推 / 2%复购 / 10%分红池 算，**与卖货无关**。
 *     来源：月度结算（type='costore'）。
 *   两者**分属不同台账、不同身份栏、不同 bizType**，不可合并统计。
 */
const { round2 } = require('./commission');

/** 商品类型（= productSplit.PRODUCT_KIND 的取值；virtual 已并入 featured / software，不再单独成类） */
const STORE_INCOME_KINDS = ['physical', 'software', 'featured', 'admin'];

/**
 * 门店收益规则表：每类商品 → 门店侧怎么分钱
 *
 * mode 语义：
 *   'tierDiff'  —— 拿货差价模式：门店赚「卖价 − 拿货价」，不参与比例分成池
 *   'poolRatio' —— 比例分成模式：门店从分成池里按比例取，含可再分配提点
 *   'adminFee'  —— 行政费模式：销售门店固定 5%
 */
const STORE_INCOME_RULES = {
  physical: {
    kind: 'physical',
    label: '实物产品',
    mode: 'tierDiff',
    example: '脑商Pad 6980',
    // 拿货差价：拿货价 = 基准价 × 该级折扣；门店利润 = 卖价 − 拿货价
    basis: '基准价 × 上级代理拿货折扣',
    storeBenefit: '卖价 − 拿货价（拿货差价）',
    storeRole: '单店代理按自身折扣进货、按买方档位卖出，赚折扣率差',
    // 拨比表：区县拿货 40% → 拿货价 2792；天使价 5235 → 利润 2443
    exampleMath: { basePrice: 6980, buyerLevel: 'angel', buyerPrice: 5235, pickLevel: 'district', pickRate: 0.40, pickPrice: 2792, profit: 2443 },
    assignablePools: [],
    note: '实物产品走「拿货差价」，不进入比例分成池；无巡查/销售可分配提点',
  },
  software: {
    kind: 'software',
    label: 'AI软件卡',
    mode: 'tierDiff',
    example: '记忆卡 998',
    // 拿货差价：固定拿货价（与实物不同——实物=变动成本×折扣，AI软件卡=固定绝对值）
    basis: '固定拿货价（省150/市170/区县250/单店350，元/张，按月）',
    storeBenefit: '卖价 − 固定拿货价（拿货差价）',
    storeRole: '单店按固定拿货价 350 进货、按买方档位卖出赚差价；合伙人提成从链底（单店）扣',
    // 算例：VIP(0.8) 在单店买 998 → 顾客付款 798.4；单店差价 = 798.4 − 350 = 448.4（未扣提成）
    exampleMath: { listPrice: 998, buyerLevel: 'vip', buyerPrice: 798.4, pickLevel: 'store', pickPrice: 350, storeBenefit: 448.4 },
    assignablePools: [],
    note: 'AI软件卡走「固定拿货价拿货差价」（省150/市170/区县250/单店350），不进入比例分成池；无巡查/销售可分配提点；合伙人提成从链底扣',
  },
  featured: {
    kind: 'featured',
    label: '特色产品',
    mode: 'poolRatio',
    example: '陪练卡 2000（私董 7折=1400 / 省代映射联创 6.5折=1300）/ 特色营 10000（私董 9400 / 联创 9300 / 原价 10000）',
    basis: '客户实付 − 固定成本（= 可分池 = 变动成本2000 × 合伙人折扣）',
    storeBenefit: '单店 65% = 交付 30% + 流量 30% + 销售 5%',
    storeRole: '单店从比例分成池取 65%（交付30% + 流量30% + 销售5%）',
    // 比例分成池明细（拨比表）：15/2/8/(5+5)/(30+30+5) = 100%
    poolRatio: {
      hq: { rate: 0.15, label: '总部', sub: '系统' },
      province: { rate: 0.02, label: '省代', sub: '管理' },
      city: { rate: 0.08, label: '市代', sub: '管理' },
      districtMgmt: { rate: 0.05, label: '区县代', sub: '管理' },
      districtInspect: { rate: 0.05, label: '区县代', sub: '巡查', allocatable: true, allocationKind: 'inspection' },
      storeDelivery: { rate: 0.30, label: '单店', sub: '交付' },
      storeTraffic: { rate: 0.30, label: '单店', sub: '流量' },
      storeSales: { rate: 0.05, label: '单店', sub: '销售', allocatable: true, allocationKind: 'sales' },
    },
    assignablePools: [
      { kind: 'inspection', label: '巡查 5%', owner: '区县代', note: '分配权归区县负责人，可指定本人/上级市代/上级省代/总部/其他代理' },
      { kind: 'sales', label: '销售 5%', owner: '单店（店长）', note: '可指定本店/上级区代/上级市代/上级省代/总部/其他代理' },
    ],
    // 分成池随买家合伙人折扣变化：联创 1300 / 私董 1400 / 原价 2000（以陪练卡为例）
    exampleMath: { basePrice: 2000, buyerLevel: 'cofounder', buyerPrice: 1300, pool: 1300, hq: 195, province: 26, city: 104, districtMgmt: 65, districtInspect: 65, storeDelivery: 390, storeTraffic: 390, storeSales: 65 },
    note: '特色产品走「比例分成池」；分成池 = 变动成本2000 × 买家合伙人折扣（盈利全部从 2000 拨比中获得）。代理买家按对应合伙人档位映射（省代→联创/市代→私董/区县代→天使/单店→VIP），不享受代理折扣。区县 5% 巡查、单店 5% 销售可在收益页发起再分配',
  },
  admin: {
    kind: 'admin',
    label: '行政费用',
    mode: 'adminFee',
    example: '集训营行政费 2000',
    basis: '下单时指定的行政费金额',
    storeBenefit: '销售门店 5%',
    storeRole: '销售门店拿 5%；总部 5%；上课团队 90%',
    poolRatio: { hq: { rate: 0.05, label: '总部' }, storeSales: { rate: 0.05, label: '销售门店' }, delivery: { rate: 0.90, label: '上课团队' } },
    assignablePools: [],
    exampleMath: { amount: 2000, hq: 100, storeSales: 100, delivery: 1800 },
    note: '行政费不进入分成池，直接按 5/5/90 拆',
  },
};

/**
 * 取某商品类型的门店收益规则
 * @param {string} kind productSplit.PRODUCT_KIND 的取值
 */
function storeIncomeRule(kind) {
  const r = STORE_INCOME_RULES[kind];
  if (!r) throw new Error(`未知商品类型：${kind}（可选 ${STORE_INCOME_KINDS.join('/')}）`);
  return { ...r };
}

/** 门店收益规则表（前端/后台查询用） */
function storeIncomeRuleTable() {
  return STORE_INCOME_KINDS.map((k) => storeIncomeRule(k));
}

/**
 * 该商品类型是否有可再分配的提点（巡查 5% / 销售 5%）
 */
function assignablePoolsOf(kind) {
  const r = STORE_INCOME_RULES[kind];
  return r ? (r.assignablePools || []).map((p) => ({ ...p })) : [];
}

/**
 * 按拨比表算例反算校验（自检用）：比例分成池各行金额 + 闭环
 * @param {string} kind
 * @param {number} pool 可分池
 */
function verifyRuleMath(kind, pool) {
  const r = STORE_INCOME_RULES[kind];
  if (!r) throw new Error(`未知商品类型：${kind}`);
  const p = round2(pool);
  if (r.mode === 'poolRatio' && r.poolRatio) {
    const rows = Object.entries(r.poolRatio).map(([k, v]) => ({ key: k, label: v.label, sub: v.sub || null, rate: v.rate, amount: round2(p * v.rate) }));
    const total = round2(rows.reduce((s, x) => s + x.amount, 0));
    return { kind, pool: p, rows, total, rateTotal: round2(rows.reduce((s, x) => s + x.rate, 0)), closure: Math.abs(total - p) < 0.01 };
  }
  if (r.mode === 'adminFee' && r.poolRatio) {
    const rows = Object.entries(r.poolRatio).map(([k, v]) => ({ key: k, label: v.label, rate: v.rate, amount: round2(p * v.rate) }));
    const total = round2(rows.reduce((s, x) => s + x.amount, 0));
    return { kind, pool: p, rows, total, rateTotal: round2(rows.reduce((s, x) => s + x.rate, 0)), closure: Math.abs(total - p) < 0.01 };
  }
  return { kind, pool: p, rows: [], total: p, closure: true };
}

/**
 * ════════════════════════════════════════════════════════════════
 * 四、门店收益 与 合店老板收益 的分离口径
 * ════════════════════════════════════════════════════════════════
 * 收益台账 type 维度：
 *   'product'  → 门店收益（卖货所得）    —— bizType: featured / supply_chain / software_fee …
 *   'costore'  → 合店老板收益（合店费入股）—— bizType: costore
 * 两者分属不同 type、不同身份栏（IDENTITY_TYPES.agent vs costore），
 * **不可合并统计**；用户同时持有两种身份时，前端分别展示。
 */
const INCOME_CHANNEL = {
  storeIncome: { key: 'storeIncome', label: '门店收益', desc: '门店卖货获得的分润，随商品类型按拨比表规则计算' },
  costoreOwnerIncome: { key: 'costoreOwnerIncome', label: '合店老板收益', desc: '合店老板入股合店费获得的分配（服务40%/直推13%/复购2%/分红池10%）' },
};

/** 某笔佣金属于哪条收益线 */
function incomeChannelOf(commission) {
  if (!commission) return null;
  if (commission.type === 'costore') return 'costoreOwnerIncome';
  if (commission.type === 'product') return 'storeIncome';
  return null;
}

module.exports = {
  STORE_INCOME_KINDS,
  STORE_INCOME_RULES,
  INCOME_CHANNEL,
  storeIncomeRule,
  storeIncomeRuleTable,
  assignablePoolsOf,
  verifyRuleMath,
  incomeChannelOf,
};

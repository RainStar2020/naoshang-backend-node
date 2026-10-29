/**
 * 脑商AI合伙人 · 收益明细「业务类型」多态模型（P0-8，2026-10-26 拍板）
 *
 * ════════════════════════════════════════════════════════════════
 * 原型（屏 68–92 代理端收益详情）
 * ════════════════════════════════════════════════════════════════
 *   每条明细结构不同，共 7 类业务；通用字段：
 *     业务提点 / 业务类型 / 业务详情 / 推荐人信息 / 购买人信息 / 交付门店
 *
 *   | 业务类型     | 提点示例           |
 *   | 代理费       | 15% / 8% / 60%     |
 *   | 服务费       | 4000/VIP           |
 *   | 店员费       | 2%                 |
 *   | 供应链费     | —                  |
 *   | 软件卡抽成费 | 336（含 14 元奖励费）|
 *   | 特色产品     | 160                |
 *   | 专栏课       | 336（含 14 元奖励费）|
 *
 * 实现方式：**读时派生**（不改历史台账），由 commission + order + user 三方 join 出展示模型。
 * 好处：存量数据零迁移，改口径只改映射表。
 */
const { round2 } = require('./commission');

const BIZ_TYPES = {
  agent_fee: { key: 'agent_fee', label: '代理费' },
  service_fee: { key: 'service_fee', label: '服务费' },
  staff_fee: { key: 'staff_fee', label: '店员费' },
  supply_chain: { key: 'supply_chain', label: '供应链费' },
  software_fee: { key: 'software_fee', label: '软件卡抽成费' },
  featured: { key: 'featured', label: '特色产品' },
  column: { key: 'column', label: '专栏课' },
  quota: { key: 'quota', label: '合伙人名额' },
  product_commission: { key: 'product_commission', label: '产品提成' },
  admin_fee: { key: 'admin_fee', label: '行政费' },
  costore: { key: 'costore', label: '合店费' },
  global: { key: 'global', label: '全球奖' },
  founding: { key: 'founding', label: '创始奖' },
  other: { key: 'other', label: '其他收益' },
};

const TIER_CN = { none: '普通用户', vip: 'VIP合伙人', angel: '天使合伙人', private: '私董合伙人', cofounder: '联创合伙人' };
const KIND_CN = { physical: '实物', software: '软件卡', virtual: '虚拟', featured: '特色产品', admin: '行政费' };

/**
 * 各类 bizType 的 bizDetail 结构定义（前端反馈问题 6：只列了 14 类 bizType，没有各类 bizDetail 结构）
 *
 * ⚠️ 重要区分（前端常见混淆点）：
 *   · bizType         = **业务类型**（收益来自哪类业务），共 14 类，见 BIZ_TYPES
 *   · allocationKind  = **分配角色**（这笔收益分给谁：巡查 / 销售），共 2 类，见 allocation.js 的 KINDS
 *   两者是**独立的两套概念**，分配接口里的 inspection/sales 属于 allocationKind，**不是 bizType**。
 *
 * bizDetail 当前是**文案字符串**（由 detailOf 生成），本表说明每类 bizType 的文案里包含哪些信息、
 * 以及对应的结构化数据来源（前端若需结构化，可按 detailFields 自行拼装）。
 */
const BIZ_DETAIL_SCHEMA = {
  agent_fee: {
    label: '代理费',
    detailFormat: '开通{代理级别} · {区域码}（技术费 {金额} 元）',
    detailFields: ['agentLevel', 'regionCode', 'techFee'],
    source: 'db.regionalAgents（按 ref_order_id 关联）',
  },
  service_fee: {
    label: '门店服务费',
    detailFormat: '{区域} 门店服务费 · 名额 {n} 个',
    detailFields: ['regionType', 'quotaCount', 'amount'],
    source: 'commission.region_type + 关联订单 quotaCount',
  },
  staff_fee: {
    label: '店员费',
    detailFormat: '店员费 {金额} 元',
    detailFields: ['amount', 'baseAmount'],
    source: 'commission（amount / base_amount）',
  },
  supply_chain: {
    label: '供应链费',
    detailFormat: '{商品类型}：{商品名} × {数量}（实付 {金额} 元）',
    detailFields: ['productKind', 'productName', 'qty', 'paid'],
    source: '关联订单（kind / productName / qty / paid）',
  },
  software_fee: {
    label: '软件卡抽成费',
    detailFormat: '{商品类型}：{商品名} × {数量}（实付 {金额} 元）',
    detailFields: ['productKind', 'productName', 'qty', 'paid'],
    source: '关联订单',
  },
  featured: {
    label: '特色产品',
    detailFormat: '{商品类型}：{商品名} × {数量}（实付 {金额} 元）',
    detailFields: ['productKind', 'productName', 'qty', 'paid'],
    source: '关联订单',
  },
  column: {
    label: '专栏课',
    detailFormat: '{商品类型}：{商品名} × {数量}（实付 {金额} 元）',
    detailFields: ['productKind', 'productName', 'qty', 'paid'],
    source: '关联订单',
  },
  quota: {
    label: '合伙人名额',
    detailFormat: '{档位A} → {档位B}（名额 {n} 个）｜ 平级奖 · 名额 {n} 个',
    detailFields: ['fromTier', 'toTier', 'quotaCount'],
    source: '关联订单（oldTier / packageTier / quotaCount）',
  },
  product_commission: {
    label: '产品提成',
    detailFormat: '{商品类型}：{商品名} × {数量}（实付 {金额} 元）',
    detailFields: ['productKind', 'productName', 'qty', 'paid'],
    source: '关联订单',
  },
  admin_fee: {
    label: '行政费',
    detailFormat: '{商品类型}：{商品名} × {数量}（实付 {金额} 元）',
    detailFields: ['productKind', 'productName', 'qty', 'paid'],
    source: '关联订单',
  },
  costore: {
    label: '合店费',
    detailFormat: '合店费 {金额} 元{ · 子类}',
    detailFields: ['amount', 'subtype'],
    source: 'commission.base_amount / subtype',
  },
  global: {
    label: '全球奖',
    detailFormat: '全球奖 · {期数} 奖池',
    detailFields: ['period', 'amount'],
    source: 'commission.period / amount',
  },
  founding: {
    label: '创始奖',
    detailFormat: '创始奖 · {期数}',
    detailFields: ['period', 'amount'],
    source: 'commission.period / amount',
  },
  other: {
    label: '其他收益',
    detailFormat: '{等级} · {备注/公式}',
    detailFields: ['levelLabel', 'note', 'formula'],
    source: 'commission.note / formula',
  },
};

/** allocationKind（分配角色）说明 —— 与 bizType 是两套概念 */
const ALLOCATION_KINDS = {
  inspection: { key: 'inspection', label: '巡查', note: '区县负责人巡查分配（默认 5%）' },
  sales: { key: 'sales', label: '销售', note: '销售门店分配（默认 5%）' },
};

function bizTypeOf(commission, order) {
  const t = commission.type;
  const sub = commission.subtype || '';
  if (t === 'agent') {
    if (sub === 'agent_direct' || sub === 'agent_biz') return 'agent_fee';
    return 'service_fee';                     // 门店服务费 3000/VIP 四级拆分
  }
  if (t === 'supply' || t === 'parity') return 'quota';
  if (t === 'global') return 'global';
  if (t === 'founding') return 'founding';
  if (t === 'costore') return 'costore';
  if (t === 'product') {
    if (sub === 'partner_product') return 'product_commission';
    if (sub.includes('admin')) return 'admin_fee';
    if (sub.includes('featured')) return 'featured';
    if (sub.includes('virtual')) {
      const kind = order && order.kind;
      return kind === 'virtual' ? 'column' : 'software_fee';
    }
    if (sub.startsWith('chain_') || sub.startsWith('po-') || sub.startsWith('card_')) {
      const kind = order && order.kind;
      if (kind === 'physical') return 'supply_chain';
      if (kind === 'software') return 'software_fee';
      if (kind === 'virtual') return 'column';
      if (kind === 'featured') return 'featured';
      if (kind === 'admin') return 'admin_fee';
      return 'supply_chain';
    }
    return 'product_commission';
  }
  return 'other';
}

/** 业务提点展示文案（百分比 / 定额 / 公式） */
function rateLabelOf(commission, bizType) {
  if (bizType === 'service_fee') return commission.region_type ? `定额 ${round2(commission.amount)} 元（${commission.region_type} 门店服务费）` : '定额';
  if (commission.rate != null && Math.abs(commission.rate) <= 1) {
    const pct = (commission.rate * 100).toFixed(2).replace(/\.?0+$/, '');
    return `${pct}%`;
  }
  if (commission.rate != null) return String(round2(commission.rate));
  return '定额';
}

/** 业务详情文案（逐类可读化） */
function detailOf(db, commission, order, bizType) {
  const u = db.users[commission.owner_id];
  if (bizType === 'quota') {
    if (commission.type === 'parity') return `平级奖 · 名额 ${order ? order.quotaCount : ''} 个`;
    if (order && order.packageTier) {
      const from = order.oldTier ? (TIER_CN[order.oldTier] || order.oldTier) : '普通用户';
      const to = TIER_CN[order.packageTier] || order.packageTier;
      return order.oldTier ? `${from} → ${to}（名额 ${order.quotaCount || 0} 个）` : `开通 ${to}（名额 ${order.quotaCount || 0} 个）`;
    }
    return '合伙人名额供货差价';
  }
  if (bizType === 'agent_fee') {
    const ag = db.regionalAgents.find((a) => a.id === commission.ref_order_id);
    const t = ag ? ({ province: '省代', city: '市代', district: '区县代', store: '单店代理' })[ag.region_type] || ag.region_type : '代理';
    return `开通${t}${ag && ag.region_code ? ' · ' + ag.region_code : ''}（技术费 ${round2(commission.base_amount || 0)} 元）`;
  }
  if (bizType === 'service_fee') {
    return `${({ province: '省代', city: '市代', district: '区县代', store: '单店' })[commission.region_type] || '区域'} 门店服务费 · 名额 ${order ? (order.quotaCount || 1) : 1} 个`;
  }
  if (bizType === 'costore') {
    return `合店费 ${round2(commission.base_amount || 0)} 元${commission.subtype ? ' · ' + commission.subtype : ''}`;
  }
  if (order && order.productKey) {
    const name = (order.productName || order.productKey);
    const kind = KIND_CN[order.kind] || order.kind || '';
    return `${kind ? kind + '：' : ''}${name}${order.qty > 1 ? ' ×' + order.qty : ''}（实付 ${round2(order.paid != null ? order.paid : commission.base_amount)} 元）`;
  }
  if (bizType === 'global') return `全球奖 · ${commission.period || ''} 奖池`;
  if (bizType === 'founding') return `创始奖 · ${commission.period || ''}`;
  return (u && u.tier ? TIER_CN[u.tier] + ' · ' : '') + (commission.note || commission.formula || '');
}

/**
 * 富化一条佣金记录为「收益明细」展示模型。
 * @param {object} db
 * @param {object} c commission
 */
function enrich(db, c) {
  const order = c.ref_order_id ? db.orders.find((o) => o.id === c.ref_order_id || o.orderNo === c.ref_order_id) : null;
  const bizType = bizTypeOf(c, order);
  const buyer = order && order.buyer_id ? db.users[order.buyer_id] : null;
  const seller = order && order.seller_id ? db.users[order.seller_id] : null;
  const recommender = order
    ? (buyer && buyer.upline_id ? db.users[buyer.upline_id] : seller)
    : (c.recommended_by ? db.users[c.recommended_by] : null);
  const storeCode = order ? (order.delivery_store || order.store_code || order.regionCode || null) : null;
  const storeAgent = storeCode ? db.regionalAgents.find((a) => a.region_code === storeCode && a.region_type === 'store') : null;
  return {
    bizType,
    bizTypeLabel: (BIZ_TYPES[bizType] || BIZ_TYPES.other).label,
    bizDetail: detailOf(db, c, order, bizType),
    rateLabel: rateLabelOf(c, bizType),
    recommendedBy: recommender
      ? { id: recommender.id, name: recommender.name, phone: recommender.phone || null, levelLabel: TIER_CN[recommender.tier] || recommender.tier }
      : null,
    purchaser: buyer
      ? { id: buyer.id, name: buyer.name, phone: buyer.phone || null, levelLabel: TIER_CN[buyer.tier] || buyer.tier }
      : null,
    deliveryStore: storeCode
      ? { code: storeCode, name: storeAgent ? `脑商线下店${db.users[storeAgent.partner_id] ? db.users[storeAgent.partner_id].name : storeAgent.partner_id}店` : `门店 ${storeCode}` }
      : null,
    withdrawable: c.withhold ? false : true,
    withholdLabel: c.withhold ? (c.dividendRightLabel || '当月无分红权') : null,
  };
}

/** 按业务类型聚合（代理端收益页分类汇总） */
function groupByBizType(db, list = []) {
  const map = new Map();
  for (const c of list) {
    const e = enrich(db, c);
    const cur = map.get(e.bizType) || { bizType: e.bizType, bizTypeLabel: e.bizTypeLabel, amount: 0, count: 0 };
    cur.amount = round2(cur.amount + (c.amount || 0));
    cur.count++;
    map.set(e.bizType, cur);
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount);
}

/** 业务类型字典（前端下拉/图例） */
function dictionary() {
  return Object.values(BIZ_TYPES).map((t) => ({
    ...t,
    detailFormat: (BIZ_DETAIL_SCHEMA[t.key] || {}).detailFormat || null,
    detailFields: (BIZ_DETAIL_SCHEMA[t.key] || {}).detailFields || [],
  }));
}

/**
 * 完整字典：bizType 字典 + 各类 bizDetail 结构 + allocationKind 字典
 * （前端反馈问题 6：需要各类 bizDetail 的字段定义，且要明确 inspect/sales 不属于 bizType）
 */
function fullDictionary() {
  return {
    bizTypes: dictionary(),
    bizDetailSchema: BIZ_DETAIL_SCHEMA,
    allocationKinds: Object.values(ALLOCATION_KINDS),
    note: 'bizType（业务类型，14 类）与 allocationKind（分配角色，inspection/sales）是两套独立概念，分配接口中的 inspection/sales 属于 allocationKind，不是 bizType',
  };
}

module.exports = {
  BIZ_TYPES, BIZ_DETAIL_SCHEMA, ALLOCATION_KINDS, TIER_CN, KIND_CN,
  bizTypeOf, rateLabelOf, detailOf, enrich, groupByBizType, dictionary, fullDictionary,
};

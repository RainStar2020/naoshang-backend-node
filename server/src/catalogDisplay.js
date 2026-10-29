/**
 * 商品目录展示层（2026-10-27）
 *
 * 背景：后端 `productSplit.js` 的 PRODUCT_CATALOG 是**计价目录**（key/name/listPrice/kind/cost），
 *       而前端商城页面（甄选页 / 商品详情 / 专栏详情）需要**展示结构**：
 *       id / title / summary / coverUrl / categoryId / 金额(分) / memberPrices / rolePrices /
 *       specGroups / skus / content / pricePresentation …。两者不是一回事。
 *
 * 本模块只做「展示层翻译 + 目录补全」：
 *   - 不改任何计价与分润规则（仍在 productSplit.js / regionAgent.js）
 *   - 金额单位换算：后端 listPrice 为**元**，前端 money() 按**分**渲染，故 ×100
 *   - 专栏作为一类商品接入目录，使 /catalog、/products/{id}、/columns/{id} 共用同一份定义
 *
 * 未定义项一律留空而不臆造：
 *   - activityAmount（活动价）后端商品模型没有该口径 → null，前端显示 '—'
 */
const PS = require('./productSplit');
const RA = require('./regionAgent');
const STK = require('./stock');
const { columnList } = require('./columns');
const { nodes, heading, para } = require('./richContent');

// 前端分类（与 src/services/mock/commerce.js 的 commerceCategories 对齐）
const CATEGORIES = [
  { id: 'all', label: '全部分类' },
  { id: 'physical', label: '脑力核心' },
  { id: 'software', label: '软件卡' },
  { id: 'special', label: '特色产品' },
  { id: 'admin', label: '行政费' },
  { id: 'column', label: '专栏产品' },
];

const MEMBER_TIERS = [
  { label: 'VIP合伙人', key: 'vip' },
  { label: '天使合伙人', key: 'angel' },
  { label: '私董合伙人', key: 'private' },
  { label: '联创合伙人', key: 'cofounder' },
];
const ROLE_TIERS = [
  { label: '单店', key: 'store' },
  { label: '区县', key: 'district' },
  { label: '地市', key: 'city' },
  { label: '省代', key: 'province' },
];

// 2026-10-28：图片资源已由 PNG 优化为 JPEG（product-cover.png → product-cover.jpg）。
// 这里是后端唯一一处商品封面兜底路径，必须与前端 src/static/product/ 实际文件名一致，
// 否则小程序 <image> 会 404 → 渲染层报「Failed to load image」。
// scripts/verify_static_assets_contract.js 会校验后端下发的 /static 路径在产物中真实存在。
const COVER = '/static/product/product-cover.jpg';

/** 每个商品的展示信息（key 与 PRODUCT_CATALOG 的 key 一致） */
const DISPLAY = {
  pad: {
    categoryId: 'physical',
    summary: '脑商AI 学习平板，配套脑商课程与训练营服务。',
    fulfillmentType: 'PHYSICAL',
    requiresMember: false,
    pricePresentation: 'tiered',
    specGroups: [
      { id: 'speed', label: '变速', options: [{ id: 'smart', label: '智能变速' }, { id: 'stepless', label: '无级变速' }, { id: 'fixed', label: '定速，无变速' }] },
      { id: 'gear', label: '档位', options: [{ id: 'g1', label: '一档' }, { id: 'g2', label: '二档' }, { id: 'g3', label: '三档' }] },
    ],
    checkoutNotice: '',
    content: nodes(heading('脑商Pad'), para('学习平板内置脑商AI 课程体系与训练营打卡功能，支持多档位变速调节。')),
  },
  memoryCard: {
    categoryId: 'software',
    summary: '记忆训练软件卡，激活后开通对应时长的记忆课程权限。',
    fulfillmentType: 'ACTIVATION_CODE',
    requiresMember: false,
    pricePresentation: 'tiered',
    specGroups: [{ id: 'spec', label: '规格', options: [{ id: 'month', label: '月卡' }, { id: 'year', label: '年卡' }] }],
    checkoutNotice: '软件卡商品下单后联系门店获取激活码',
    content: nodes(heading('记忆卡'), para('软件卡为虚拟商品，下单后请联系门店获取激活码，在「我的」页输入激活码开通课程。')),
  },
  coachCard: {
    categoryId: 'special',
    summary: '陪练卡，用于预约健脑官一对一陪练服务。',
    fulfillmentType: 'ACTIVATION_CODE',
    requiresMember: false,
    pricePresentation: 'tiered',
    specGroups: [{ id: 'spec', label: '规格', options: [{ id: 'single', label: '单次' }, { id: 'pack10', label: '10 次包' }] }],
    checkoutNotice: '陪练卡下单后联系门店获取激活码',
    content: nodes(heading('陪练卡'), para('陪练卡为虚拟商品，激活后可在门店预约健脑官陪练服务。')),
  },
  featured: {
    categoryId: 'special',
    summary: '特色产品，按平台特色分成规则结算。',
    fulfillmentType: 'OFFLINE_SERVICE',
    requiresMember: true,
    pricePresentation: 'tiered',
    specGroups: [{ id: 'spec', label: '规格', options: [{ id: 'term', label: '10 课时' }] }],
    checkoutNotice: '特色产品下单后联系门店安排服务',
    content: nodes(heading('特色产品'), para('平台特色产品，支持线下服务交付，具体安排以门店通知为准。')),
  },
  featuredCamp: {
    categoryId: 'special',
    summary: '特色集训营，假期集中训练。',
    fulfillmentType: 'OFFLINE_SERVICE',
    requiresMember: true,
    pricePresentation: 'tiered',
    specGroups: [{ id: 'spec', label: '规格', options: [{ id: 'camp', label: '假期营' }] }],
    checkoutNotice: '集训营下单后联系门店安排营期',
    content: nodes(heading('特色营'), para('假期集训营，线下集中训练，营期与课程安排以门店通知为准。')),
  },
  adminFee: {
    categoryId: 'admin',
    summary: '集训营行政费，金额以下单时填写为准。',
    fulfillmentType: 'OFFLINE_SERVICE',
    requiresMember: true,
    pricePresentation: 'standard-only',
    specGroups: [],
    checkoutNotice: '行政费金额以下单页面填写为准',
    content: nodes(heading('行政费 / 集训营'), para('行政费按总部 5%、销售门店 5%、上课团队 90% 的比例拆分，金额以下单时填写为准。')),
  },
};

function discountLabel(d) {
  const v = Number((Number(d) * 10).toFixed(2));
  return `${Number.isInteger(v) ? v : v.toFixed(1)}折`;
}
const toCents = (yuan) => Math.round((Number(yuan) || 0) * 100);

/**
 * SKU 结构定义（由规格组笛卡尔积推导）。
 * 结构在代码里（可随商品规格调整），**库存与单规格单价在 db.skus**（业务可改）。
 */
function skuDefinitions(productId, specGroups, listYuan) {
  const groups = (specGroups || []).filter((g) => Array.isArray(g.options) && g.options.length);
  const base = Number(listYuan) || 0;
  if (!groups.length) {
    return [{ id: `sku-${productId}-1`, productId, label: '默认规格', specs: {}, listPrice: base, stock: 20 }];
  }
  let combos = [[]];
  for (const g of groups) {
    const next = [];
    for (const c of combos) for (const o of g.options) next.push([...c, [g.id, o]]);
    combos = next;
    if (combos.length > 24) break;
  }
  return combos.map((combo, i) => {
    const specs = {}; const labels = [];
    for (const [gid, opt] of combo) { specs[gid] = opt.id; labels.push(opt.label); }
    return { id: `sku-${productId}-${i + 1}`, productId, label: labels.join('，'), specs, listPrice: base, stock: i === 0 ? 20 : 8 };
  });
}

/**
 * 合并库存台账 → 给前端的 skus（amount 为**分**，stock 为实时库存）
 * 台账里额外加的、自定义规格也会一并返回。
 */
function skusFor(db, productId, specGroups, listYuan) {
  const defs = skuDefinitions(productId, specGroups, listYuan);
  const records = db && Array.isArray(db.skus) ? db.skus : [];
  const out = [];
  for (const def of defs) {
    const rec = records.find((r) => r.id === def.id);
    const listPrice = rec && rec.listPrice != null ? Number(rec.listPrice) : def.listPrice;
    const stock = rec ? Math.max(0, Number(rec.stock) || 0) : def.stock;
    out.push({
      id: def.id,
      label: rec && rec.label ? rec.label : def.label,
      specs: def.specs,
      amount: toCents(listPrice),      // 前端按分渲染
      listPrice: listPrice,           // 后端计价用（元）
      stock,
    });
  }
  // 台账中业务手工新增的规格（不在代码定义内）也返回
  for (const rec of records) {
    if (rec.productId !== productId) continue;
    if (out.some((o) => o.id === rec.id)) continue;
    out.push({ id: rec.id, label: rec.label || rec.id, specs: rec.specs || {}, amount: toCents(rec.listPrice), listPrice: Number(rec.listPrice) || 0, stock: Math.max(0, Number(rec.stock) || 0) });
  }
  return out;
}

/**
 * 活动价（可后台配置，单位：元）。
 * 未配置 → null（前端显示 '—'），**不臆造数值**。配置在 db.activityPrices。
 */
function activityAmountOf(db, productId) {
  const list = db && Array.isArray(db.activityPrices) ? db.activityPrices : [];
  const rec = list
    .filter((r) => r && r.productId === productId && r.amount != null)
    .sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0))[0];
  if (!rec) return null;
  return toCents(rec.amount);
}

/**
 * 把 SKU 结构同步进库存台账（只补缺失，不覆盖已有库存）——由 h5biz.ensure() 调用。
 */
function ensureSkuRecords(db) {
  const defs = [];
  for (const key of Object.keys(PS.PRODUCT_CATALOG || {})) {
    const prod = PS.PRODUCT_CATALOG[key];
    const d = DISPLAY[key] || {};
    defs.push(...skuDefinitions(key, d.specGroups, prod.listPrice));
  }
  for (const col of columnList(db)) {
    defs.push(...skuDefinitions(col.id, col.specGroups || [], col.price || 0));
  }
  return STK.syncSkuRecords(db, defs);
}

/** 合伙人档位价 + 代理档位价（折扣表在 regionAgent.js，此处只做展示翻译） */
function priceTiers(listYuan, kind, key) {
  const base = toCents(listYuan);
  if (kind === 'featured') {
    // 特色产品：固定成本 + 变动成本×合伙人折扣（代理映射为对应合伙人档位）
    const memberPrices = MEMBER_TIERS
      .map((t) => ({ label: t.label, discountLabel: discountLabel(RA.PARTNER_DISCOUNT[t.key]), amount: toCents(PS.productPrice(key, t.key).unitPrice), current: false }));
    const rolePrices = ROLE_TIERS
      .map((t) => {
        const mapped = PS.AGENT_TO_PARTNER[t.key] || 'list';
        return { label: t.label, discountLabel: discountLabel(RA.PARTNER_DISCOUNT[mapped]), amount: toCents(PS.productPrice(key, mapped).unitPrice) };
      });
    return { memberPrices, rolePrices };
  }
  // 非特色（实物/软件卡/行政费）：fixedCost=0，base×折扣 等价
  const memberPrices = MEMBER_TIERS
    .filter((t) => RA.PARTNER_DISCOUNT[t.key] != null)
    .map((t) => ({ label: t.label, discountLabel: discountLabel(RA.PARTNER_DISCOUNT[t.key]), amount: Math.round(base * RA.PARTNER_DISCOUNT[t.key]), current: false }));
  const rolePrices = ROLE_TIERS
    .filter((t) => RA.AGENT_DISCOUNT[t.key] != null)
    .map((t) => ({ label: t.label, discountLabel: discountLabel(RA.AGENT_DISCOUNT[t.key]), amount: Math.round(base * RA.AGENT_DISCOUNT[t.key]) }));
  return { memberPrices, rolePrices };
}

/** 三套价（list/member/channel，单位：元）。普通商品走计价引擎；专栏无计价条目，按折扣表折算 */
function pricesFor(key, name, listYuan, fromEngine) {
  if (fromEngine) return fromEngine;
  const base = Number(listYuan) || 0;
  const memberRate = RA.PARTNER_DISCOUNT.vip != null ? RA.PARTNER_DISCOUNT.vip : 1;
  const channelRate = RA.AGENT_DISCOUNT.store != null ? RA.AGENT_DISCOUNT.store : 1;
  const r2 = (n) => Math.round(n * 100) / 100;
  return { key, name, list: r2(base), member: r2(base * memberRate), channel: r2(base * channelRate) };
}

/**
 * 「你的成交价」——按当前登录者身份算出实付单价（单位：分）。
 *
 * 身份识别口径（2026-10-27 用户明确：**孩子没有折扣**）：
 *   代理身份 > 合伙人档位 > 原价
 *   · 代理：单店5 / 区县4 / 地市3.5 / 省代3 折
 *   · 合伙人：VIP8 / 天使7.5 / 私董7 / 联创6.5 折
 * ⚠️ 家长加孩子后 display_id 前缀会跟着孩子走（联创+粉丝孩子 → FS0001），
 *    但 users.tier / regionalAgents 都不变，所以商城仍按家长真实身份给价。
 * viewer = { buyer, agentRec }；不传则不返回该字段（匿名浏览只给三套价）。
 */
const IDENTITY_LABEL = {
  vip: 'VIP合伙人', angel: '天使合伙人', private: '私董合伙人', cofounder: '联创合伙人',
  store: '单店代理', district: '区县代理', city: '地市代理', province: '省代',
  list: '无身份',
};
function viewerPrice(key, viewer) {
  if (!viewer || !PS.PRODUCT_CATALOG[key]) return null;
  const { buyer = null, agentRec = null } = viewer;
  const fp = PS.finalPrice(key, buyer, agentRec, 1, {});
  // 身份标签取**真实身份**（代理级别 / 合伙人档位），不受特色产品「代理按对应合伙人档位计价」映射影响
  const eff = PS.resolvePriceLevel(buyer, agentRec);
  const identityLevel = eff.discountKind === 'list' ? 'list' : eff.level;
  return {
    unitAmount: toCents(fp.unitPrice),
    listAmount: toCents(fp.list),
    applied: fp.applied,                                   // partner | agent | list
    discountLabel: (fp.applied === 'list' || fp.discount == null) ? null : discountLabel(fp.discount),
    identityLabel: IDENTITY_LABEL[identityLevel] || '无身份',
  };
}

/** 组装一个商品展示对象 */
function buildItem(db, { id, title, summary, categoryId, coverUrl, fulfillmentType, requiresMember, pricePresentation, listYuan, specGroups, checkoutNotice, content, prices, viewer }) {
  const standardAmount = toCents(listYuan);
  const prod = PS.PRODUCT_CATALOG && PS.PRODUCT_CATALOG[id];
  const kind = prod ? prod.kind : null;
  const { memberPrices, rolePrices } = priceTiers(listYuan, kind, id);
  const cat = CATEGORIES.find((c) => c.id === categoryId) || null;
  return {
    id,
    categoryId,
    categoryLabel: cat ? cat.label : categoryId,
    title,
    summary: summary || '',
    coverUrl: coverUrl || COVER,
    fulfillmentType: fulfillmentType || 'OFFLINE_SERVICE',
    requiresMember: !!requiresMember,
    pricePresentation: pricePresentation || 'tiered',
    standardAmount,
    activityAmount: activityAmountOf(db, id),   // 未配置活动价 → null（不臆造）
    memberPrices,
    rolePrices: pricePresentation === 'standard-only' ? [] : rolePrices,
    specGroups: specGroups || [],
    skus: skusFor(db, id, specGroups, listYuan),
    checkoutNotice: checkoutNotice || '',
    checkoutDiscountLabel: 'VIP合伙人8折',
    content: content || nodes(heading(title), para(summary || '')),
    prices: prices || pricesFor(id, title, listYuan),
    viewerPrice: viewerPrice(id, viewer),   // 当前登录者的实付单价（按孩子会员等级打折）
  };
}

/** 普通商品（来自 PRODUCT_CATALOG） */
function regularItem(db, key, viewer) {
  const prod = PS.PRODUCT_CATALOG[key];
  if (!prod) return null;
  const d = DISPLAY[key] || {};
  return buildItem(db, {
    id: key,                    // id 与 key 同值：/products/{id} 可直接命中
    title: prod.name,
    summary: d.summary || prod.note || '',
    categoryId: d.categoryId || 'special',
    coverUrl: COVER,
    fulfillmentType: d.fulfillmentType,
    requiresMember: d.requiresMember,
    pricePresentation: d.pricePresentation,
    listYuan: prod.listPrice,
    specGroups: d.specGroups,
    checkoutNotice: d.checkoutNotice,
    content: d.content,
    prices: PS.dualPrice(key),
    viewer,
  });
}

/** 专栏商品（来自 db.columns，与激活码 / 目录三处同 id） */
function columnItem(db, col) {
  return buildItem(db, {
    id: col.id,
    title: col.title,
    summary: col.summary || '',
    categoryId: 'column',
    coverUrl: col.coverUrl || COVER,
    fulfillmentType: col.fulfillmentType || 'ACTIVATION_CODE',
    requiresMember: !!col.requiresMember,
    pricePresentation: col.pricePresentation || 'tiered',
    listYuan: col.price || 0,
    specGroups: col.specGroups || [],
    checkoutNotice: col.checkoutNotice || '专栏课下单后联系门店获取激活码',
    content: col.content,
    prices: pricesFor(col.id, col.title, col.price || 0),
  });
}

/** 完整目录：普通商品 + 专栏 */
function buildCatalogItems(db, viewer) {
  const items = Object.keys(PS.PRODUCT_CATALOG || {}).map((k) => regularItem(db, k, viewer)).filter(Boolean);
  for (const col of columnList(db)) items.push(columnItem(db, col));
  return items;
}

/** 单个商品（按 id / key 查；专栏也走这里，保证 /products/col_1 与 /columns/col_1 一致） */
function buildProductItem(db, id, viewer) {
  const key = String(id || '');
  const direct = regularItem(db, key, viewer);
  if (direct) return direct;
  const col = columnList(db).find((c) => c.id === key);
  return col ? columnItem(db, col) : null;
}

module.exports = { CATEGORIES, DISPLAY, buildItem, buildCatalogItems, buildProductItem, regularItem, columnItem, discountLabel, toCents, skuDefinitions, skusFor, activityAmountOf, ensureSkuRecords, viewerPrice };

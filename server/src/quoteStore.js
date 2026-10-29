/**
 * 脑商AI · 报价存储与校验（前端反馈问题 1 · 「报价是否绑定提交」）
 *
 * 背景：原型文档强调「三段式」（报价 → 提交 → 支付），但后端所有 *-quotes 端点
 *   只把价格算出来返回，**不落库**，导致：
 *     · 前端拿到的 quoteId 无处可查（提交时带不带都一样）
 *     · 提交时无法校验「用户确认的价格」是否仍然有效
 *     · 无法校验报价是否过期
 *     · 无法校验名额/优惠组合是否被篡改
 *
 * 本模块提供统一能力：
 *   · issueQuote(db, {scene, userId, amount, breakdown, items, meta}) → 生成 quoteId 并落库
 *   · requireQuote(db, quoteId, {scene, userId})     → 校验并返回报价（失败抛错）
 *   · 报价含：金额、费用明细、名额组合、规则版本、过期时间、一次性消费标记
 *
 * 校验规则（提交时）：
 *   1. quoteId 必须存在
 *   2. 必须属于当前登录用户（防越权用别人报价）
 *   3. 场景必须匹配（商城报价不能用于升级提交）
 *   4. 未过期（默认 10 分钟，与 quote.expiresAt 一致）
 *   5. 未被消费过（幂等：同一 quoteId 重复提交 → 抛错，避免重复下单）
 *
 * ⚠️ 关键安全约束：**提交时的最终金额一律以服务端重算为准**，
 *    报价里的 amount 只用于「与客户端展示值比对」，
 *    若不一致 → 抛错「价格已变化，请重新报价」，绝不采用客户端传来的金额。
 */

/** 报价有效期（毫秒）—— 与各 quotes 端点返回的 expiresAt 保持一致 */
const QUOTE_TTL_MS = 10 * 60 * 1000;
const MONEY_SHADOW = require('./common/api-standard/money-shadow');

/** 报价场景常量（与各端点一一对应，避免串用） */
const QUOTE_SCENES = {
  CHECKOUT: 'checkout',             // 商城下单
  UPGRADE: 'upgrade',               // 合伙人升级
  QUOTA_PURCHASE: 'quota_purchase', // 购买名额
  ENTITLEMENT: 'entitlement',       // 开通 200 元权益
  STORE_BINDING: 'store_binding',   // 门店绑定
  QUOTA_TRANSFER: 'quota_transfer', // 名额划转
  AGENCY_APPLICATION: 'agency_application', // 代理申请
  COSTORE_APPLICATION: 'costore_application', // 合店申请
};

function nowMs() { return Date.now(); }
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function rid(prefix) {
  return prefix + '_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

/**
 * 生成并落库一份报价
 * @param {object} db
 * @param {object} q {
 *   scene: string,          // 必填，QUOTE_SCENES 之一
 *   userId: string,         // 必填，报价归属人
 *   amount: number,         // 必填，应付总额（元）
 *   breakdown?: object,     // 费用明细（差价/服务费等），原样返回给前端
 *   items?: array,          // 名额/商品组合，用于提交时校验
 *   meta?: object,          // 业务附加信息（如 targetLevel / productKey）
 *   ttlMs?: number,         // 自定义有效期
 * }
 */
function issueQuote(db, q) {
  if (!q || !q.scene) throw new Error('报价缺少 scene');
  if (!q.userId) throw new Error('报价缺少 userId');
  const amount = round2(q.amount);
  if (!(amount >= 0)) throw new Error('报价金额不合法');
  db.quotes = db.quotes || [];
  const now = nowMs();
  const rec = {
    id: rid('q'),
    scene: q.scene,
    userId: q.userId,
    amount,
    breakdown: q.breakdown || null,
    items: Array.isArray(q.items) ? q.items : [],
    meta: q.meta || null,
    ruleVersion: 1,
    issuedAt: now,
    expiresAt: now + (Number(q.ttlMs) > 0 ? Number(q.ttlMs) : QUOTE_TTL_MS),
    consumed: false,
    consumedAt: null,
    consumedRef: null,
  };
  MONEY_SHADOW.writeRecord('quotes', rec);
  db.quotes.push(rec);
  return rec;
}

/**
 * 校验并取出报价（不消费）
 * @param {object} db
 * @param {string} quoteId
 * @param {object} opt { scene, userId, now }
 * @returns {object} 报价记录
 */
function requireQuote(db, quoteId, opt = {}) {
  if (!quoteId) throw new Error('缺少 quoteId（请先调用报价接口）');
  db.quotes = db.quotes || [];
  const rec = db.quotes.find((x) => x.id === quoteId);
  if (!rec) throw new Error('报价不存在或已失效，请重新报价');
  if (opt.userId && rec.userId !== opt.userId) throw new Error('报价不属于当前账号');
  if (opt.scene && rec.scene !== opt.scene) throw new Error('报价场景不匹配，请重新报价');
  if (rec.consumed) throw new Error('该报价已使用，请重新报价');
  if (rec.expiresAt && rec.expiresAt < (opt.now || nowMs())) throw new Error('报价已过期，请重新报价');
  return rec;
}

/**
 * 校验报价 + 比对金额（**不消费**）
 * 用于「先校验、后执行业务、成功再消费」的提交链路，避免业务失败时报价被白白消耗。
 * @param {object} db
 * @param {string} quoteId
 * @param {object} opt { scene, userId, now, serverAmount, items }
 * @returns {object} 报价记录
 */
function checkQuote(db, quoteId, opt = {}) {
  const rec = requireQuote(db, quoteId, opt);
  // 金额一致性：报价是用户确认过的价格，服务端重算不一致说明规则/身份/配置变了
  if (opt.serverAmount != null && round2(opt.serverAmount) !== round2(rec.amount)) {
    throw new Error(
      `价格已变化（报价 ¥${round2(rec.amount)} → 当前 ¥${round2(opt.serverAmount)}），请重新报价`
    );
  }
  // 名额/商品组合一致性
  if (Array.isArray(opt.items) && Array.isArray(rec.items) && rec.items.length) {
    const a = JSON.stringify(opt.items);
    const b = JSON.stringify(rec.items);
    if (a !== b) throw new Error('商品/名额组合与报价不一致，请重新报价');
  }
  return rec;
}

/**
 * 校验报价 + 比对金额 + 消费（提交时调用）
 * @param {object} db
 * @param {string} quoteId
 * @param {object} opt {
 *   scene, userId, now,
 *   serverAmount,     // 服务端重算出的应付总额；与报价不一致 → 抛错
 *   ref,              // 消费后回填的关联单号（订单 id / 升级单 id）
 *   items,            // 服务端重算出的名额/商品组合；与报价不一致 → 抛错
 * }
 */
function consumeQuote(db, quoteId, opt = {}) {
  const rec = checkQuote(db, quoteId, opt);
  rec.consumed = true;
  rec.consumedAt = opt.now || nowMs();
  rec.consumedRef = opt.ref || null;
  return rec;
}

/**
 * 消费已校验过的报价（配合 checkQuote 使用：先校验 → 执行业务 → 成功后再消费）
 */
function markConsumed(db, quoteId, opt = {}) {
  db.quotes = db.quotes || [];
  const rec = db.quotes.find((x) => x.id === quoteId);
  if (!rec) return null;
  rec.consumed = true;
  rec.consumedAt = opt.now || nowMs();
  rec.consumedRef = opt.ref || null;
  return rec;
}

/**
 * 清理过期报价（惰性清理，避免快照无限增长）
 */
function sweepQuotes(db, now = nowMs()) {
  if (!Array.isArray(db.quotes)) return 0;
  const before = db.quotes.length;
  db.quotes = db.quotes.filter((q) => (q.expiresAt || 0) > now - 24 * 3600 * 1000);
  return before - db.quotes.length;
}

module.exports = {
  QUOTE_TTL_MS, QUOTE_SCENES,
  issueQuote, requireQuote, checkQuote, consumeQuote, markConsumed, sweepQuotes,
};

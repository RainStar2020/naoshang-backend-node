/**
 * 脑商AI合伙人 · 经验值 + 晋升任务（P0-1 / P0-2，2026-10-26 拍板）
 *
 * ════════════════════════════════════════════════════════════════
 * 一、经验值口径（用户拍板：标价多少加多少）
 * ════════════════════════════════════════════════════════════════
 *   经验值 = 该笔业务的实际标价（元），1 元 = 1 经验值。
 *   · 升档/购名额：按 actual_paid 记（普通用户升 VIP 合伙人 = 9980 经验，消耗 1 个名额）
 *   · 合店入股：按合店费记（4188 = 698 × 6）
 *   · 代理开通：按技术费记
 *   · 产品订单：按实付记
 *   ⚠️ 经验值**不参与任何分账**，只做展示与任务进度依据；可由后台关闭（settings.experience.enabled）。
 *
 * 两个 Tab（对齐原型屏 46/47）：
 *   promotion 业务推广 —— 本人升档 / 合店费 / 代理费
 *   product   购买产品 —— 本人购买产品订单
 *
 * ════════════════════════════════════════════════════════════════
 * 二、晋升任务（原型屏 21/22：补差价直接晋升 / 推广达标免费晋升）
 * ════════════════════════════════════════════════════════════════
 *   开通合伙人起 N 个月（默认 12）内，「直推 3 位私董」**或**「直推 18 个 VIP」→ 免费晋升。
 *   与已落地的「拉人免费升档（3 名同级付费升档）」是**两条独立通道**：
 *     · 本任务 = 推广达标通道（不要求下级付费升档，看直推人数）
 *     · 拉人升档 = 付费升档通道（看下级是否从同级起步付费升档）
 *   两者互不覆盖，都可累计；免费授级统一走 store.updatePartner 语义（只改 tier，不动 principal_tier）。
 */
const { round2 } = require('./commission');
const S = require('./store');

const TAB_CN = { promotion: '业务推广', product: '购买产品' };
const EVENT_CN = {
  upgrade: '合伙人升级',
  costore: '合店费',
  agent: '代理费',
  product: '购买产品',
};
const TIER_CN = { none: '普通用户', vip: 'VIP合伙人', angel: '天使合伙人', private: '私董合伙人', cofounder: '联创合伙人' };

function ensure(db) {
  if (!Array.isArray(db.experience)) db.experience = [];
  if (!Array.isArray(db.promotionTasks)) db.promotionTasks = [];
}

const nowMs = () => Date.now();

/**
 * 记一笔经验值。
 * @param {object} db
 * @param {object} opt
 *   userId     归因人（= 发生业务的人本人）
 *   event      upgrade | costore | agent | product
 *   price      标价（元）→ 经验值（标价多少加多少）
 *   title      事件标题（如「升为 VIP 合伙人」）
 *   refId      关联订单/合店/代理记录 id
 *   meta       内嵌元信息（如 { fromTier, quotaCount }），前端逐条展开显示
 * @returns {object|null}
 */
function record(db, { userId, event, price, title, refId = null, meta = null } = {}) {
  ensure(db);
  if (!userId || !db.users[userId]) return null;
  const settings = S.getSettings(db);
  if (!settings.experience || settings.experience.enabled === false) return null;
  const per = Number(settings.experience.yuanPerPoint) || 1;
  if (per <= 0) return null;
  const key = EVENT_CN[event] ? event : 'product';
  const tab = key === 'product' ? 'product' : 'promotion';
  const points = Math.round((Number(price) || 0) / per);
  if (points <= 0) return null;
  // 幂等：同一业务单据同一事件只记一次（重试下单不重复加经验）
  if (refId && db.experience.some((x) => x.refId === refId && x.event === key && x.userId === userId)) {
    return db.experience.find((x) => x.refId === refId && x.event === key && x.userId === userId);
  }
  const rec = {
    id: 'exp_' + (db.seq++),
    userId,
    tab,
    tabLabel: TAB_CN[tab],
    event: key,
    eventLabel: EVENT_CN[key],
    title: title || EVENT_CN[key],
    points,
    price: round2(price),
    refId,
    meta: meta || null,
    occurredAt: nowMs(),
  };
  db.experience.push(rec);
  return rec;
}

/** 汇总（两个 Tab 合计 + 逐条明细） */
function summary(db, userId) {
  ensure(db);
  const rows = db.experience.filter((x) => x.userId === userId).sort((a, b) => b.occurredAt - a.occurredAt);
  const promotionExperience = rows.filter((x) => x.tab === 'promotion').reduce((s, x) => s + x.points, 0);
  const productExperience = rows.filter((x) => x.tab === 'product').reduce((s, x) => s + x.points, 0);
  return {
    promotionExperience,
    productExperience,
    total: promotionExperience + productExperience,
    count: rows.length,
    rows,
  };
}

/** 明细（可按 tab 过滤），字段对齐原型屏 46/47 */
function ledger(db, userId, { tab = null } = {}) {
  const s = summary(db, userId);
  const rows = (tab ? s.rows.filter((x) => x.tab === tab) : s.rows).map((x) => ({
    id: x.id,
    tab: x.tab,
    tabLabel: x.tabLabel,
    event: x.event,
    eventLabel: x.eventLabel,
    title: x.title,
    points: x.points,
    price: x.price,
    refId: x.refId,
    meta: x.meta,
    occurredAt: x.occurredAt,
    occurredAtText: new Date(x.occurredAt).toISOString(),
  }));
  return {
    promotionExperience: s.promotionExperience,
    productExperience: s.productExperience,
    total: s.total,
    tabs: [
      { key: 'promotion', label: TAB_CN.promotion, points: s.promotionExperience },
      { key: 'product', label: TAB_CN.product, points: s.productExperience },
    ],
    items: rows,
  };
}

// ─────────────── 晋升任务 ───────────────
function taskOf(db, userId) {
  ensure(db);
  return db.promotionTasks.filter((x) => x.userId === userId).sort((a, b) => b.createdAt - a.createdAt)[0] || null;
}

/** 直推人数统计（按档位）：{ vip, angel, private, cofounder, total } */
function directTierCounts(db, userId) {
  const out = { vip: 0, angel: 0, private: 0, cofounder: 0, total: 0 };
  for (const u of Object.values(db.users)) {
    if (u.upline_id !== userId) continue;
    out.total++;
    if (out[u.tier] != null) out[u.tier]++;
  }
  return out;
}

/**
 * 开通合伙人时创建任务实例（幂等：已有实例直接返回）。
 * 触发点：createOrder 首购升档到 vip 及以上时。
 */
function ensureTask(db, userId, { now = nowMs() } = {}) {
  ensure(db);
  const settings = S.getSettings(db);
  if (!settings.promotionTask || settings.promotionTask.enabled === false) return null;
  const exists = taskOf(db, userId);
  if (exists) return exists;
  const u = db.users[userId];
  if (!u || !['vip', 'angel', 'private', 'cofounder'].includes(u.tier)) return null;
  const months = Number(settings.promotionTask.validMonths) || 12;
  const task = {
    id: 'pt_' + (db.seq++),
    userId,
    startTier: u.tier,
    createdAt: now,
    validUntil: now + months * 30 * 86400000,
    validMonths: months,
    targets: JSON.parse(JSON.stringify(settings.promotionTask.targets || [])),
    status: 'ONGOING',       // ONGOING | ACHIEVED | EXPIRED | DISABLED
    achievedAt: null,
    grantedTier: null,
    claimedAt: null,
  };
  db.promotionTasks.push(task);
  return task;
}

/** 任务进度（含倒计时天数、双指标进度、状态文案） */
function progress(db, userId, { now = nowMs() } = {}) {
  const settings = S.getSettings(db);
  if (!settings.promotionTask || settings.promotionTask.enabled === false) {
    return { enabled: false, statusLabel: '未开启', items: [], achieved: false, daysLeft: 0, validUntil: null };
  }
  const task = taskOf(db, userId) || ensureTask(db, userId, { now });
  if (!task) return { enabled: true, statusLabel: '未开通', items: [], achieved: false, daysLeft: 0, validUntil: null };
  const counts = directTierCounts(db, userId);
  const items = (task.targets || []).map((t) => {
    const current = counts[t.key] || 0;
    return {
      key: t.key, label: t.label, required: t.required, current,
      reached: current >= t.required,
      progressText: `${Math.min(current, t.required)}/${t.required}`,
      percent: t.required > 0 ? Math.min(100, round2((current / t.required) * 100)) : 0,
    };
  });
  const achieved = items.some((x) => x.reached);
  const daysLeft = Math.max(0, Math.ceil((task.validUntil - now) / 86400000));
  const expired = now > task.validUntil && !achieved;
  const statusLabel = task.claimedAt ? '已晋升'
    : achieved ? '已达标（待领取）'
      : expired ? '已过期' : '进行中';
  return {
    enabled: true,
    taskId: task.id,
    statusLabel,
    status: task.claimedAt ? 'CLAIMED' : achieved ? 'ACHIEVED' : expired ? 'EXPIRED' : 'ONGOING',
    achieved,
    items,
    daysLeft,
    validUntil: task.validUntil,
    startTier: task.startTier,
    grantRule: settings.promotionTask.grant === 'next' ? '达标免费升 1 档（封顶联创）' : '达标免费晋升联创合伙人',
    deadlineText: `任务有效期 ${task.validMonths} 个月，将于 ${daysLeft} 天后截止`,
    text: `${task.targets.map((t) => `直推 ${t.required} 位${TIER_CN[t.key] || t.key}`).join(' 或 ')}即可免费晋升（${task.validMonths} 个月内）`,
  };
}

/**
 * 达标自动授级（幂等）：只改 tier、不动 principal_tier。
 * @returns {{granted:boolean, fromTier?:string, toTier?:string, status:string}}
 */
function applyIfAchieved(db, userId, { now = nowMs() } = {}) {
  const p = progress(db, userId, { now });
  if (!p.enabled || !p.taskId) return { granted: false, status: p.status || 'NONE' };
  const task = db.promotionTasks.find((x) => x.id === p.taskId);
  if (!task || task.claimedAt) return { granted: false, status: task && task.claimedAt ? 'CLAIMED' : 'NONE' };
  const settings = S.getSettings(db);
  const next = settings.promotionTask.grant === 'next'
    ? S.FREE_UPGRADE_NEXT[db.users[userId].tier]
    : 'cofounder';
  if (!p.achieved) return { granted: false, status: task.status };
  const u = db.users[userId];
  const fromTier = u.tier;
  const toTier = next || 'cofounder';
  if ((S.TIER_RANK[toTier] || 0) <= (S.TIER_RANK[fromTier] || 0)) {
    // 已封顶（联创）：标记已达标，不再升级
    task.status = 'ACHIEVED'; task.achievedAt = now;
    return { granted: false, status: 'ACHIEVED', fromTier, toTier: fromTier, note: '已达最高档（联创），无需再升' };
  }
  u.tier = toTier;
  if (toTier === 'cofounder' && u.daysSinceCofounder == null) u.daysSinceCofounder = 0;
  task.status = 'ACHIEVED';
  task.achievedAt = now;
  task.claimedAt = now;
  task.grantedTier = toTier;
  require('./identity').recomputeDisplayId(db, userId);
  return { granted: true, status: 'CLAIMED', fromTier, toTier, taskId: task.id };
}

module.exports = {
  TAB_CN, EVENT_CN, TIER_CN,
  ensure, record, summary, ledger,
  directTierCounts, ensureTask, taskOf, progress, applyIfAchieved,
};

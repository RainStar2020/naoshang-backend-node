/**
 * 脑商AI合伙人 · 分红业绩门槛（P0-7，2026-10-26 拍板：门槛做成可调整，不写死 2900）
 *
 * ════════════════════════════════════════════════════════════════
 * 原型口径（屏 112 会员卡分红 / 屏 111 推广分红）
 * ════════════════════════════════════════════════════════════════
 *   「您每月需要业绩达标 **2900 元**才能享有分红权益，当前业绩 0/2900」
 *   明细表「分红名称」列逐月出现「当月有分红权」/「当月无分红权」两种取值
 *   → **无分红权月份：金额照算、照记账，但不可提现**（不是归零、不是不发）
 *
 * 本模块负责：
 *   1. 业绩口径与达标判定（门槛、无责期、直推条件均可配）
 *   2. 结算时给分红类佣金打 withhold / withdrawable 标记（金额不动）
 *   3. 逐月分红权台账（前端「分红名称」列数据源）
 *
 * 业绩口径（与订单口径统一）：
 *   当月业绩 = 本人自购实付 + 直推下级订单实付（不含已取消订单）
 *   · 身份/名额订单取 actual_paid，产品订单取 paid
 *   · 只统计本人和「直推」一层（原型 2900 量级为单店口径，不做整棵子树汇总）
 */
const { round2 } = require('./commission');
const S = require('./store');

const KIND = {
  memberCard: { key: 'memberCard', label: '会员卡分红', thresholdKey: 'memberCardThreshold' },
  promotion: { key: 'promotion', label: '推广分红', thresholdKey: 'promotionThreshold' },
};

function periodOfDate(ts) {
  const d = new Date(ts || Date.now());
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** 单笔订单实付（兼容身份单/产品单） */
function orderAmount(o) {
  return Number(o.actual_paid != null ? o.actual_paid : o.paid) || 0;
}

/** 当月业绩：本人自购 + 直推下级订单 */
function performance(db, userId, period) {
  const downs = new Set(Object.values(db.users).filter((u) => u.upline_id === userId).map((u) => u.id));
  let own = 0; let team = 0;
  for (const o of db.orders) {
    if (!o.created_at) continue;
    if (['CANCELLED', 'cancelled', 'REFUNDED'].includes(o.status)) continue;
    if (periodOfDate(o.created_at) !== period) continue;
    if (o.buyer_id === userId) own += orderAmount(o);
    else if (downs.has(o.buyer_id)) team += orderAmount(o);
  }
  return { own: round2(own), team: round2(team), total: round2(own + team), period };
}

/** 当月是否直推过至少 1 个 VIP（原全球奖资格条件，可按配置叠加） */
function directPushedVip(db, userId, period) {
  const downs = new Set(Object.values(db.users).filter((u) => u.upline_id === userId).map((u) => u.id));
  return db.orders.filter((o) => downs.has(o.buyer_id) && o.created_at
    && periodOfDate(o.created_at) === period
    && ['vip', 'angel', 'private', 'cofounder'].includes(o.packageTier)
    && !['CANCELLED', 'cancelled'].includes(o.status)).length;
}

/** 入股首月无责（合店老板 grace） */
function inGrace(db, userId, period, settings) {
  const g = settings.dividend.graceMonths || 0;
  if (!g) return false;
  const cs = db.coStores.find((c) => c.owner_id === userId);
  if (!cs || !cs.joinDate) return false;
  const joined = String(cs.joinDate).slice(0, 7);
  const idx = (p) => { const [y, m] = p.split('-').map(Number); return y * 12 + m; };
  if (!/^\d{4}-\d{2}$/.test(joined)) return false;
  return idx(period) - idx(joined) < g;
}

/**
 * 分红权判定
 * @param {object} db
 * @param {string} userId
 * @param {string} period YYYY-MM
 * @param {'memberCard'|'promotion'} kind
 */
function rights(db, userId, period, kind = 'memberCard') {
  const settings = S.getSettings(db);
  const k = KIND[kind] || KIND.memberCard;
  const cfg = settings.dividend;
  const perf = performance(db, userId, period);
  const threshold = Number(cfg[k.thresholdKey]) || 0;
  const pushed = directPushedVip(db, userId, period);
  const grace = inGrace(db, userId, period, settings);

  if (!cfg.enabled) {
    return { kind: k.key, kindLabel: k.label, period, threshold, performance: perf, hasRight: true, label: '当月有分红权', reason: '分红门槛已关闭（后台）', grace, directPushedVip: pushed };
  }
  if (grace) {
    return { kind: k.key, kindLabel: k.label, period, threshold, performance: perf, hasRight: true, label: '当月有分红权', reason: '入股首月无责期，不考核业绩', grace, directPushedVip: pushed };
  }
  const perfMet = perf.total >= threshold;
  const pushMet = !cfg.requireDirectPush || pushed >= 1;
  const hasRight = perfMet && pushMet;
  const reason = hasRight ? `业绩 ${perf.total} ≥ 门槛 ${threshold}${cfg.requireDirectPush ? '，且当月已直推' : ''}`
    : !perfMet ? `当月业绩 ${perf.total}/${threshold} 未达标` : '当月未直推 VIP';
  return {
    kind: k.key, kindLabel: k.label, period, threshold,
    performance: perf, hasRight,
    label: hasRight ? '当月有分红权' : '当月无分红权',
    reason, grace, directPushedVip: pushed,
  };
}

/**
 * 给结算产出的分红类佣金打标记（不改变金额）。
 *   · costore 分红池 → memberCard 门槛（会员卡分红）
 *   · global 全球奖  → promotion 门槛（推广分红）
 * @returns {{marked:number, withheld:number}}
 */
function applyToCommissions(db, period) {
  const isDividend = (c) => (c.type === 'costore' && (String(c.id || '').startsWith('cs-div') || String(c.note || '').includes('分红池')))
    || c.type === 'global';
  let marked = 0; let withheld = 0;
  const cache = new Map();
  for (const c of db.commissions) {
    if (c.period !== period || !isDividend(c)) continue;
    if (c.owner_id === 'HQ') { c.withhold = false; c.withdrawable = true; continue; }
    const kind = c.type === 'global' ? 'promotion' : 'memberCard';
    const key = `${c.owner_id}|${period}|${kind}`;
    let r = cache.get(key);
    if (!r) { r = rights(db, c.owner_id, period, kind); cache.set(key, r); }
    c.dividendKind = kind;
    c.dividendRightLabel = r.label;
    c.dividendPerformance = r.performance.total;
    c.dividendThreshold = r.threshold;
    c.withhold = !r.hasRight;
    c.withdrawable = r.hasRight;
    if (!r.hasRight) {
      c.note = [c.note, `当月无分红权（业绩 ${r.performance.total}/${r.threshold}）：金额照记，暂不可提现`].filter(Boolean).join('｜');
      withheld++;
    }
    marked++;
  }
  return { marked, withheld };
}

/** 逐月分红权台账（「分红名称」列数据源） */
function history(db, userId, { months = 6, kind = null } = {}) {
  const rows = [];
  const base = new Date();
  for (let i = 0; i < months; i++) {
    const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
    const period = periodOfDate(d.getTime());
    const kinds = kind ? [kind] : ['memberCard', 'promotion'];
    for (const kk of kinds) {
      const r = rights(db, userId, period, kk);
      const amount = round2(db.commissions
        .filter((c) => c.owner_id === userId && c.period === period
          && (kk === 'promotion' ? c.type === 'global' : (c.type === 'costore' && String(c.id || '').startsWith('cs-div'))))
        .reduce((s, c) => s + (c.amount || 0), 0));
      rows.push({
        period, month: period, kind: r.kind, kindLabel: r.kindLabel,
        amount, hasRight: r.hasRight, label: r.label, reason: r.reason,
        performance: r.performance.total, threshold: r.threshold,
        withdrawable: r.hasRight, grace: r.grace,
      });
    }
  }
  return {
    items: rows,
    summary: {
      totalAmount: round2(rows.reduce((s, x) => s + x.amount, 0)),
      withdrawableAmount: round2(rows.filter((x) => x.withdrawable).reduce((s, x) => s + x.amount, 0)),
      withheldAmount: round2(rows.filter((x) => !x.withdrawable).reduce((s, x) => s + x.amount, 0)),
    },
  };
}

/** 当前月门槛提示（首页卡片：您每月需要业绩达标 X 元，当前业绩 Y/X） */
function currentPrompt(db, userId, kind = 'memberCard') {
  const period = periodOfDate(Date.now());
  const r = rights(db, userId, period, kind);
  return {
    period, kind: r.kind, kindLabel: r.kindLabel,
    threshold: r.threshold, current: r.performance.total,
    text: `您每月需要业绩达标 ${r.threshold} 元才能享有${r.kindLabel}权益，当前业绩 ${r.performance.total}/${r.threshold}`,
    hasRight: r.hasRight, label: r.label, reason: r.reason,
  };
}

module.exports = { KIND, performance, directPushedVip, rights, applyToCommissions, history, currentPrompt, periodOfDate };

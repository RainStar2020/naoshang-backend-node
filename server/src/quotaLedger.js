/**
 * 脑商AI合伙人 · VIP 名额账本（下发 / 消耗）— P0-3 双余额 + P0-4 升级服务费
 *
 * 余额结构（partnerId -> 对象）：
 *   { standard: number, activity: [{ qty, obtainedAt, expireAt }] }
 *   · standard ：标准名额（联创进货获得，无有效期，可长期持有）
 *   · activity ：活动名额（总部活动下发，自 obtainedAt 起 1 年内有效，过期自动清零）
 * 旧数据（partnerId -> number）在首次访问时由 normalize() 自动升级为 { standard:n, activity:[] }，
 *   保证既有脚本 / 种子数据向后兼容。
 *
 * 电梯规则：下级向绑定上级购买，上级余额扣减，逐级上行。
 * 扣减顺序：活动名额先扣（先过期先扣 FIFO），再扣标准名额。
 *   —— P0-4：上级在升级单中每动用 1 个活动名额，向买方加收 SERVICE_FEE_PER_ACTIVITY 元，
 *      与合伙人费（actual_paid）分离收款；标准名额不计服务费。
 */

const { vipCredit } = require('./commission');

const ACTIVITY_VALIDITY_DAYS = 365;
const SERVICE_FEE_PER_ACTIVITY = 2000; // P0-4：每个活动名额收取的升级服务费（元）

/**
 * 运行时配置（后台可调，src/store.js settings.quota 覆盖）：
 *   activityValidityDays      活动名额有效期（天）
 *   serviceFeePerActivity     每个活动名额的升级服务费（元）
 *   activityValidForUpgrade   活动名额是否可用于升级（false → 升级只认标准名额）
 * 取不到配置时回落到上面的默认值。
 */
function resolveConfig(opts = {}) {
  return {
    activityValidityDays: Number(opts.activityValidityDays) > 0 ? Number(opts.activityValidityDays) : ACTIVITY_VALIDITY_DAYS,
    serviceFeePerActivity: Number(opts.serviceFeePerActivity) >= 0 ? Number(opts.serviceFeePerActivity) : SERVICE_FEE_PER_ACTIVITY,
    activityValidForUpgrade: opts.activityValidForUpgrade === false ? false : true,
  };
}

/** 升级服务费单价（按后台配置） */
function serviceFeePerActivity(opts = {}) { return resolveConfig(opts).serviceFeePerActivity; }

// ── 结构归一化：number -> { standard, activity }（过期活动名额顺手清理） ──
function normalize(ledger, partnerId) {
  let v = ledger[partnerId];
  if (v == null) { v = { standard: 0, activity: [] }; ledger[partnerId] = v; return v; }
  if (typeof v === 'number') { v = { standard: v, activity: [] }; ledger[partnerId] = v; return v; }
  if (!Array.isArray(v.activity)) v.activity = [];
  if (typeof v.standard !== 'number') v.standard = 0;
  const now = Date.now();
  v.activity = v.activity.filter((b) => b.expireAt == null || b.expireAt > now);
  return v;
}

function ensureEntry(ledger, partnerId) { return normalize(ledger, partnerId); }

// 仅统计未过期的活动名额批次
function liveBatches(entry) {
  const now = Date.now();
  return (entry.activity || []).filter((b) => b.expireAt == null || b.expireAt > now);
}
function activityTotal(entry) { return liveBatches(entry).reduce((s, b) => s + b.qty, 0); }

/** 总部/上级向 partnerId 下发 qty 个名额（qty>0）。kind: 'standard' | 'activity' */
function issueQuota(ledger, partnerId, qty, kind = 'standard', opts = {}) {
  if (!(qty > 0)) throw new Error('下发名额必须为正数: ' + qty);
  const cfg = resolveConfig(opts);
  const e = normalize(ledger, partnerId);
  let expireAt = null;
  if (kind === 'activity') {
    const obtainedAt = Date.now();
    expireAt = obtainedAt + cfg.activityValidityDays * 86400000;
    e.activity.push({ qty, obtainedAt, expireAt });
  } else {
    e.standard += qty;
  }
  if (opts.tx) {
    opts.tx.push({
      id: 'qt_' + Math.random().toString(36).slice(2, 10),
      type: 'issue', partnerId, kind, qty,
      operatorId: opts.operatorId || null, ref: opts.ref || null, at: Date.now(), expireAt,
    });
  }
  return getBalance(ledger, partnerId);
}

/**
 * 扣减 qty 个名额。默认优先消耗活动名额（先过期先扣 FIFO），不足再扣标准。
 * @param opts.prefer 'activity'(默认) | 'standard'（如名额转让只动标准名额）
 * @returns { usedStandard, usedActivity }
 */
function consumeQuota(ledger, partnerId, qty, opts = {}) {
  const e = normalize(ledger, partnerId);
  const cfg = resolveConfig(opts);
  // activityValidForUpgrade=false 时，活动名额不参与升级通道的扣减（只认标准名额）
  const allowActivity = opts.prefer !== 'activity' || cfg.activityValidForUpgrade;
  const prefer = allowActivity ? (opts.prefer || 'activity') : 'standard';

  // ⚠️ 先校验后扣减（2026-10-26 修复）：余额不足时**不得**先动余额再抛错，
  //   否则一次失败的调用会静默吞掉上级/用户的名额。
  if (!(qty > 0)) throw new Error(`扣减名额必须为正数: ${qty}`);
  const activityAvail = activityTotal(e);
  const standardAvail = e.standard;
  if (standardAvail + activityAvail < qty) {
    throw new Error(`名额不足: partner=${partnerId} 标准=${standardAvail} 活动可用=${activityAvail} 需扣=${qty}（需先补货）`);
  }

  let need = qty, usedStandard = 0, usedActivity = 0;

  if (prefer === 'activity') {
    const batches = liveBatches(e).slice().sort((a, b) => a.expireAt - b.expireAt);
    for (const b of batches) {
      if (need <= 0) break;
      const take = Math.min(b.qty, need);
      b.qty -= take; usedActivity += take; need -= take;
    }
    if (need > 0) {
      const take = Math.min(e.standard, need);
      e.standard -= take; usedStandard += take; need -= take;
    }
  } else {
    const take = Math.min(e.standard, need);
    e.standard -= take; usedStandard += take; need -= take;
    if (need > 0) {
      const batches = liveBatches(e).slice().sort((a, b) => a.expireAt - b.expireAt);
      for (const b of batches) {
        if (need <= 0) break;
        const t = Math.min(b.qty, need);
        b.qty -= t; usedActivity += t; need -= t;
      }
    }
  }
  // 预校验已保证余额充足；此处兜底，防止静默少扣
  if (need > 0) {
    throw new Error(`名额扣减异常: partner=${partnerId} 尚缺 ${need}（预校验通过但扣减未完成）`);
  }
  e.activity = e.activity.filter((b) => b.qty > 0);
  if (opts.tx) {
    opts.tx.push({
      id: 'qt_' + Math.random().toString(36).slice(2, 10),
      type: 'consume', partnerId,
      usedStandard, usedActivity, ref: opts.ref || null,
      operatorId: opts.operatorId || null, at: Date.now(),
    });
  }
  return { usedStandard, usedActivity };
}

/** 总可用余额（标准 + 未过期活动） */
function getBalance(ledger, partnerId) {
  const e = normalize(ledger, partnerId);
  return e.standard + activityTotal(e);
}
function getStandard(ledger, partnerId) { return normalize(ledger, partnerId).standard; }
function getActivity(ledger, partnerId) { return activityTotal(normalize(ledger, partnerId)); }

/** 活动名额明细（用于后台「活动 VIP 明细卡」，原型屏 43） */
function activityBatches(ledger, partnerId) {
  const e = normalize(ledger, partnerId);
  return liveBatches(e).map((b) => ({ qty: b.qty, obtainedAt: b.obtainedAt, expireAt: b.expireAt }));
}

function quotaNeededForSale(oldTier, newTier, rawQuota) {
  if (rawQuota != null) return rawQuota;
  return vipCredit(oldTier, newTier);
}

/** 完整的"上级卖给下级"一笔（电梯路由）：校验余额 → 扣减 → 返回结果。 */
function sellQuota(ctx) {
  const { ledger, sellerId, downlineTier, oldTier, rawQuota, tx, ref } = ctx;
  const need = quotaNeededForSale(oldTier, downlineTier, rawQuota);
  const drawn = consumeQuota(ledger, sellerId, need, { tx, ref });
  return { need, balanceAfter: getBalance(ledger, sellerId), usedStandard: drawn.usedStandard, usedActivity: drawn.usedActivity };
}

module.exports = {
  ACTIVITY_VALIDITY_DAYS, SERVICE_FEE_PER_ACTIVITY,
  resolveConfig, serviceFeePerActivity,
  normalize, ensureEntry, issueQuota, consumeQuota, getBalance, getStandard, getActivity,
  activityBatches, quotaNeededForSale, sellQuota,
};

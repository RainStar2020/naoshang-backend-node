/**
 * 脑商AI合伙人 · 统一身份编号与权益门禁（2026-10-24 设计，见 docs/用户身份与ID编号设计.md）
 *
 * 规则要点：
 *  1. 所有人都是用户；ID 前缀只编码一条主线 = 权益状态 + 合伙人等级
 *     QZ（权益未开通/已过期，覆盖一切）> YH（普通）> VIP > TS（天使）> SD（私董）> LC（联创）
 *  2. 编号 = 前缀 + 全局注册序号；四位起步（0001），超过四位自然变宽（第 10000 名 = 前缀+10000，不截断）
 *  3. 代理（省/市/区县/门店）与合店老板是身份徽章，不进前缀（避免 SD 被私董/市代/省代抢占等碰撞）
 *  4. 200 权益收益费为周期制（默认 12 个月）：
 *     - never_paid（从未开通）：收益照算（挂着），不可查看、不可提现、无功能入口，编号 QZ
 *     - active：全功能
 *     - expired（开通后过期）：全球奖/直推奖/复购奖/创始奖等全部停算，但历史账单可导出，编号 QZ
 *  5. 惰性过期：读取时按 expires_at 判定，不依赖定时任务
 *  6. 家长与孩子（2026-10-24 截图规则，见 §6）：
 *     - 孩子（member）有独立会员等级阶梯：普通(游客)→粉丝→1阶菁英→1阶超级→2阶行能→3阶羿烁
 *     - 孩子编号 = 等级前缀 + 自己的全局添加序号；升级只变前缀、编号不变（FS3000 → CJ3000）
 *     - 家长编号：权益未开通/过期 → QZ；权益正常时「家长跟着孩子走，不在于身份的高低」——
 *       只要有孩子已激活会员等级（fs..ys），家长前缀一律取最高孩子等级前缀（联创+粉丝孩子 → FS）；
 *       无孩子或孩子全是普通会员（游客）时，沿用家长自己的档位前缀
 *  7. 代理撤销（2026-10-24 用户拍板）：撤销后对外编号 seq 不变、前缀改 QZ（回到普通用户）；
 *     已赠予的合伙人档位保留（不降档）。派生优先级：权益门禁 QZ > 孩子等级 > 撤销 QZ > 家长档位
 */

const ENTITLEMENT_AMOUNT = 200;          // 权益收益费金额（元）
const ENTITLEMENT_PERIOD_DAYS = 365;     // 权益周期（天）——一次性 or 年费待业务最终确认，当前按年
const ENTITLEMENT_MS = ENTITLEMENT_PERIOD_DAYS * 86400000;

/** 等级 → ID 前缀（权益正常时的等级主线） */
const TIER_PREFIX = { none: 'YH', vip: 'VIP', angel: 'TS', private: 'SD', cofounder: 'LC' };
/** 合伙人档位分（与孩子会员等级分同尺比高） */
const TIER_SCORE = { none: 0, vip: 1, angel: 2, private: 3, cofounder: 4 };

/**
 * 孩子会员等级阶梯（2026-10-24 产品截图规则）。
 * 获取方式：普通=添加即有；FS=门店缴费19.9激活码；JY=门店缴费3990激活码；
 *           CJ=家长开通VIP合伙人后上级赠码；XN/YS=家长开通天使合伙人后上级赠码。
 * 权益：等级越高解锁的课程板块越多（粉丝→菁英→超级→行能→羿烁，逐级累积）。
 */
const MEMBER_TIERS = {
  normal: { score: 0, prefix: 'QZ', name: '普通会员（游客）', unlocks: [] },
  fs:     { score: 1, prefix: 'FS', name: '粉丝会员',         unlocks: ['fs'] },
  jy:     { score: 2, prefix: 'JY', name: '1阶菁英会员',      unlocks: ['fs', 'jy'] },
  cj:     { score: 3, prefix: 'CJ', name: '1阶超级会员',      unlocks: ['fs', 'jy', 'cj'] },
  xn:     { score: 4, prefix: 'XN', name: '2阶行能会员',      unlocks: ['fs', 'jy', 'cj', 'xn'] },
  ys:     { score: 5, prefix: 'YS', name: '3阶羿烁会员',      unlocks: ['fs', 'jy', 'cj', 'xn', 'ys'] },
};
/** 激活码 targetType → 会员等级 key（兼容旧 'member' 类型 = 粉丝会员） */
const MEMBER_ACTIVATION_TYPES = { fs: 'fs', jy: 'jy', cj: 'cj', xn: 'xn', ys: 'ys', member: 'fs' };

const memberTierScore = (level) => (MEMBER_TIERS[level] ? MEMBER_TIERS[level].score : 0);
const memberPrefix = (level) => (MEMBER_TIERS[level] ? MEMBER_TIERS[level].prefix : 'QZ');
const memberTierName = (level) => (MEMBER_TIERS[level] ? MEMBER_TIERS[level].name : level);
/** 孩子对外编号：等级前缀 + 自己的全局添加序号（升级只变前缀，编号不变） */
function memberDisplayId(level, seq) {
  return memberPrefix(level) + String(seq == null ? 0 : seq).padStart(4, '0');
}
/** 激活某会员等级要求的家长档位分（CJ←VIP合伙人；XN/YS←天使合伙人；FS/JY 门店码无要求） */
const MEMBER_TIER_MIN_TIER_SCORE = { fs: 0, jy: 0, cj: 1, xn: 2, ys: 2 };
function memberTierAllowedForParent(level, tier) {
  const need = MEMBER_TIER_MIN_TIER_SCORE[level];
  if (need == null) return false;
  return (TIER_SCORE[tier] == null ? 0 : TIER_SCORE[tier]) >= need;
}

/** 分配孩子全局添加序号（第几个添加的就第几；db.memberSeq 为独立计数器） */
function assignMemberSeq(db, memberId) {
  const m = (db.members || []).find((x) => x.id === memberId);
  if (!m) throw new Error('会员不存在: ' + memberId);
  if (m.memberSeq == null) {
    db.memberSeq = db.memberSeq || 1;
    m.memberSeq = db.memberSeq++;
  }
  return m.memberSeq;
}

/** 家长全部孩子中的最高会员等级分 */
function bestMemberScore(db, userId) {
  if (!db || !Array.isArray(db.members)) return 0;
  let best = 0;
  for (const m of db.members) {
    if (m.userId !== userId) continue;
    const s = memberTierScore(m.memberLevel || 'normal');
    if (s > best) best = s;
  }
  return best;
}
/** 家长全部孩子中的最高会员等级 key */
function bestMemberLevel(db, userId) {
  if (!db || !Array.isArray(db.members)) return 'normal';
  let best = 'normal';
  for (const m of db.members) {
    if (m.userId !== userId) continue;
    if (memberTierScore(m.memberLevel || 'normal') > memberTierScore(best)) best = m.memberLevel || 'normal';
  }
  return best;
}

/**
 * 有效权益状态（惰性过期）。
 * 存量用户无 entitlement_state 字段 → 默认 'active'（向后兼容，测试脚本不受影响）。
 * @param {Object} u 用户对象
 * @param {number} [now] 当前时间戳（测试可注入）
 * @returns {'never_paid'|'active'|'expired'}
 */
function entitlementState(u, now = Date.now()) {
  if (!u) return 'active';
  const s = u.entitlement_state;
  if (s === 'never_paid') return 'never_paid';
  if (s === 'expired') return 'expired';
  if (s === 'active') {
    if (u.entitlement_expires_at && u.entitlement_expires_at < now) return 'expired'; // 惰性过期
    return 'active';
  }
  return 'active'; // 无字段（存量/种子）→ 视为已开通
}

/** ID 前缀：权益不正常一律 QZ（覆盖一切等级）；否则按等级（不含孩子派生，兼容旧签名） */
function prefixOf(u, now) {
  if (entitlementState(u, now) !== 'active') return 'QZ';
  return TIER_PREFIX[u && u.tier] || 'YH';
}

/**
 * 家长 ID 前缀（含孩子会员等级派生与代理撤销）：
 * 门禁 QZ 绝对优先 → 权益正常时「家长跟着孩子走，不在于身份的高低」：
 * 只要有孩子已激活会员等级（fs..ys），家长前缀即取最高孩子等级前缀，不与家长档位比高低；
 * 无已激活孩子时：代理已撤销（agent_revoked_at）→ QZ（编号不变、回到普通用户）；
 * 否则沿用家长自己的档位前缀。无 db 时退化为 prefixOf。
 */
function userPrefix(db, u, now) {
  if (!u) return 'YH';
  if (entitlementState(u, now) !== 'active') return 'QZ';
  if (!db) return TIER_PREFIX[u.tier] || 'YH';
  if (bestMemberScore(db, u.id) > 0) return memberPrefix(bestMemberLevel(db, u.id)); // 家长跟着孩子走，不比高低
  if (u.agent_revoked_at) return 'QZ';                                                // 代理撤销：前缀改 QZ（编号不变）
  return TIER_PREFIX[u.tier] || 'YH';
}

/** 对外编号：前缀 + 序号（四位起步，超过四位不截断：第 10000 名 → 前缀+10000） */
function displayIdOf(u, now) {
  const seq = u && u.seq != null ? u.seq : 0;
  return prefixOf(u, now) + String(seq).padStart(4, '0');
}

/** 家长对外编号（含孩子会员等级派生，需传 db） */
function displayIdOfUser(db, u, now) {
  const seq = u && u.seq != null ? u.seq : 0;
  return userPrefix(db, u, now) + String(seq).padStart(4, '0');
}

/** 分配全局注册序号（四位起步的编号数字部分；db.userSeq 为独立计数器，勿与 db.seq(id 生成器) 混用） */
function assignSeq(db, userId) {
  const u = db.users[userId];
  if (!u) throw new Error('用户不存在: ' + userId);
  if (u.seq == null) {
    db.userSeq = db.userSeq || 1;
    u.seq = db.userSeq++;
  }
  return u.seq;
}

/** 重算并缓存对外编号（等级/权益/孩子等级变化后调用） */
function recomputeDisplayId(db, userId, now) {
  const u = db.users[userId];
  if (!u) return null;
  u.display_id = displayIdOfUser(db, u, now);
  return u.display_id;
}

/** 重算并缓存某个孩子的对外编号（会员等级变化后调用；只变前缀、编号不变） */
function recomputeMemberDisplayId(db, memberId) {
  const m = (db.members || []).find((x) => x.id === memberId);
  if (!m) return null;
  if (m.memberSeq == null) assignMemberSeq(db, memberId);
  m.display_id = memberDisplayId(m.memberLevel || 'normal', m.memberSeq);
  return m.display_id;
}

/** 孩子等级变化后：重算孩子编号 + 重算家长编号（家长前缀可能随最高孩子等级上浮） */
function applyMemberLevel(db, memberId, level) {
  const m = (db.members || []).find((x) => x.id === memberId);
  if (!m) throw new Error('会员不存在: ' + memberId);
  if (memberTierScore(level) < memberTierScore(m.memberLevel || 'normal')) return m; // 只升不降（引擎层防线）
  m.memberLevel = level;
  recomputeMemberDisplayId(db, memberId);
  if (m.userId) recomputeDisplayId(db, m.userId);
  return m;
}

/** 门禁锁定态（权益不正常时前端据此人件隐藏全部功能入口、只留开通入口） */
function gatePayload(u, now = Date.now()) {
  const state = entitlementState(u, now);
  if (state === 'active') return null;
  return {
    locked: true,
    entitlementState: state,
    entitlementAmount: ENTITLEMENT_AMOUNT,
    frozen: state === 'expired',                 // 过期：收益已停算
    canExportBills: state === 'expired',         // 过期：历史账单可导出
    message: state === 'expired'
      ? '权益已过期，收益已停止计算；可导出历史账单，续费后恢复'
      : '开通 200 元权益收益费后即可查看收益与使用全部功能（未开通期间收益照常计算）',
  };
}

/** 开通/续费：置 active 并刷新到期时间；返回新状态 */
function grantEntitlement(db, userId, now = Date.now()) {
  const u = db.users[userId];
  if (!u) throw new Error('用户不存在: ' + userId);
  u.entitlement_state = 'active';
  u.entitlement_paid_at = now;
  u.entitlement_expires_at = now + ENTITLEMENT_MS;
  return recomputeDisplayId(db, userId, now);
}

module.exports = {
  ENTITLEMENT_AMOUNT, ENTITLEMENT_PERIOD_DAYS, TIER_PREFIX, TIER_SCORE,
  MEMBER_TIERS, MEMBER_ACTIVATION_TYPES, MEMBER_TIER_MIN_TIER_SCORE,
  entitlementState, prefixOf, userPrefix, displayIdOf, displayIdOfUser,
  assignSeq, assignMemberSeq, recomputeDisplayId, recomputeMemberDisplayId, applyMemberLevel,
  memberTierScore, memberPrefix, memberTierName, memberDisplayId,
  memberTierAllowedForParent, bestMemberScore, bestMemberLevel,
  gatePayload, grantEntitlement,
};

/**
 * 脑商AI · 两套邀请码（P1-8）
 *
 * 设计：邀请码分两类，互不混用——
 *   1) register（拉新注册码）：普通用户/合伙人分享，他人凭码注册 → 注册者把邀请人设为自己的 upline（推荐关系）。
 *   2) agent   （代理归属码）：代理分享，他人凭码申请代理 → 申请者把邀请代理设为 referrer（代理归属）。
 *
 * 旧实现只用手机号/uid 当邀请码（无类型、无失效、无次数、无审计）。本模块在保留旧兼容（phone/id 仍可绑定）的
 * 基础上，新增「类型化、可失效、可限次、可审计」的邀请码，并写入 db.inviteCodes 流水。
 *
 * 编码规则：`<TYPE><BASE36>` —— register → R 开头，agent → A 开头，后接 8 位 base36（时间+随机）。
 * 解析时不区分大小写。
 */

const CODE_TTL_DAYS = 30;
const TYPE_PREFIX = { register: 'R', agent: 'A' };
const VALID_TYPES = Object.keys(TYPE_PREFIX);

function nowMs() { return Date.now(); }

function randomBlock() {
  // 8 位 base36，足够避免碰撞（约 2.8e12）
  return Math.random().toString(36).slice(2, 10).padEnd(8, '0').toUpperCase();
}

function normalizeCode(raw) {
  if (!raw) return '';
  return String(raw).trim().toUpperCase().replace(/\s+/g, '');
}

/** 生成邀请码 */
function generateInviteCode(db, { ownerId, type = 'register', maxUse = 0, ttlDays = CODE_TTL_DAYS } = {}) {
  if (!VALID_TYPES.includes(type)) throw new Error(`邀请码类型非法: ${type}（可选 ${VALID_TYPES.join('/')}）`);
  if (!ownerId) throw new Error('ownerId 必填');
  db.inviteCodes = db.inviteCodes || [];
  const code = TYPE_PREFIX[type] + randomBlock();
  const rec = {
    code,
    type,
    ownerId,
    createdAt: nowMs(),
    expiresAt: ttlDays > 0 ? nowMs() + ttlDays * 86400000 : 0,
    maxUse: maxUse > 0 ? maxUse : 0, // 0 = 不限次
    usedBy: [],
    status: 'active',
  };
  db.inviteCodes.push(rec);
  return rec;
}

/** 解析邀请码 → 有效记录（校验类型/失效/限次），无效返回 null */
function resolveInviteCode(db, raw) {
  const code = normalizeCode(raw);
  if (!code) return null;
  const list = db.inviteCodes || [];
  const rec = list.find((x) => x.code === code);
  if (!rec) return null;
  if (rec.status === 'revoked') return null;
  if (rec.expiresAt && rec.expiresAt < nowMs()) { rec.status = 'expired'; return null; }
  if (rec.maxUse > 0 && rec.usedBy.length >= rec.maxUse) return null;
  return rec;
}

/**
 * 凭码绑定关系。
 *   register 码 → 把 inviter(ownerId) 设为 userId 的 upline（仅当 userId 当前无 upline）。
 *   agent    码 → 把 agent(ownerId) 设为 userId 的 referrer（仅当 userId 当前无 referrer）。
 * 返回 { ok, type, ownerId, bound }；重复绑定/已绑定返回 ok:true bound:false（幂等，不报错）。
 */
function bindByInviteCode(db, raw, userId, { setUpline, setReferrer } = {}) {
  const rec = resolveInviteCode(db, raw);
  if (!rec) return { ok: false, reason: '邀请码无效/已失效/已达上限' };
  let bound = false;
  if (rec.type === 'register') {
    const u = db.users[userId];
    if (!u) return { ok: false, reason: '用户不存在' };
    if (!u.upline_id && typeof setUpline === 'function') {
      setUpline(u, rec.ownerId);
      bound = true;
    }
  } else if (rec.type === 'agent') {
    const u = db.users[userId];
    if (!u) return { ok: false, reason: '用户不存在' };
    if (u.referrer_id == null && typeof setReferrer === 'function') {
      setReferrer(u, rec.ownerId);
      bound = true;
    }
  }
  if (bound) rec.usedBy.push({ userId, at: nowMs() });
  return { ok: true, type: rec.type, ownerId: rec.ownerId, bound };
}

/** 我的邀请码列表（按类型过滤） */
function listMyCodes(db, ownerId, type) {
  return (db.inviteCodes || []).filter((x) => x.ownerId === ownerId && (!type || x.type === type));
}

/** 吊销邀请码 */
function revokeInviteCode(db, code, ownerId) {
  const rec = (db.inviteCodes || []).find((x) => x.code === normalizeCode(code));
  if (!rec) return false;
  if (ownerId && rec.ownerId !== ownerId) return false;
  rec.status = 'revoked';
  return true;
}

function publicCode(rec) {
  if (!rec) return null;
  return {
    code: rec.code,
    type: rec.type,
    typeLabel: rec.type === 'register' ? '注册邀请码' : '代理归属码',
    ownerId: rec.ownerId,
    createdAt: rec.createdAt,
    expiresAt: rec.expiresAt || null,
    maxUse: rec.maxUse,
    usedCount: rec.usedBy.length,
    status: rec.status,
  };
}

module.exports = {
  generateInviteCode,
  resolveInviteCode,
  bindByInviteCode,
  listMyCodes,
  revokeInviteCode,
  publicCode,
  VALID_TYPES,
  TYPE_PREFIX,
  normalizeCode,
};

/**
 * 脑商AI合伙人 · 总部后台 · HQ-01 登录与会话（Auth）
 *
 * 契约：《总部后台API需求文档.md》§3
 *
 * 说明：
 *   - 需求文档写的是 `admins` 表 + 独立会话表；当前库无 `admins` 表，
 *     故本实现把管理员账号登记在 db.hqAdmins（首次启动自动播种一个默认 admin）。
 *   - 会话 token 登记在 server.js 的共享 sessions 表中，role='hq_admin'，
 *     与 C 端 / H5 会话隔离（role 不同，互不通用）。
 *   - 密码只存 scrypt 哈希，明文永不入库、不回显、不入日志。
 */

const L = require('../lib');
const PWD = require('../../../utils/password');

const MODULE = 'auth';
const CODE = 'HQ-01';
const TITLE = '登录与会话';

const TOKEN_TTL_MS = 8 * 60 * 60 * 1000; // 8 小时

/** 取管理员口令（环境变量优先） */
function adminPassword() {
  return process.env.HQ_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || 'admin888';
}

/**
 * 确保至少存在一个 HQ 管理员。
 * 默认账号：admin（口令取 HQ_ADMIN_PASSWORD / ADMIN_PASSWORD）。
 */
function ensureAdmins(db) {
  L.ensureCollections(db);
  if (!db.hqAdmins.length) {
    db.hqAdmins.push({
      adminId: 'admin',
      username: 'admin',
      displayName: '总部/后台',
      role: 'admin',
      password: PWD.hashPassword(adminPassword()),
      hqPermissions: [],
      status: 'ACTIVE',
      createdAt: L.nowIso(),
      version: 1,
    });
  }
  return db.hqAdmins;
}

/** 管理员资料 DTO（不含密码） */
function adminDto(a) {
  return {
    adminId: a.adminId,
    username: a.username,
    displayName: a.displayName,
    role: a.role || 'admin',
    hqPermissions: Array.isArray(a.hqPermissions) ? a.hqPermissions : [],
    status: a.status || 'ACTIVE',
    version: Number(a.version || 1),
  };
}

/** 签发 token（登记到 server.js 的 sessions） */
function issueToken(ctx, admin) {
  const token = 'hq-admin-' + Math.random().toString(36).slice(2) + Date.now().toString(36).slice(-6);
  ctx.sess = null;
  const sessions = ctx.__sessions;
  sessions[token] = {
    role: 'hq_admin',
    adminId: admin.adminId,
    name: admin.displayName || admin.username,
    issuedAt: Date.now(),
    expiresAt: Date.now() + TOKEN_TTL_MS,
  };
  return { token, expiresAt: new Date(Date.now() + TOKEN_TTL_MS).toISOString() };
}

/** 当前会话里的管理员 */
function currentAdmin(ctx) {
  const adminId = (ctx.sess && ctx.sess.adminId) || 'admin';
  const list = ensureAdmins(ctx.db);
  return list.find((a) => a.adminId === adminId) || list[0];
}

const routes = [
  // ── 登录 ──
  {
    module: MODULE,
    method: 'POST',
    path: '/auth/login',
    perm: 'public',
    async handler(ctx) {
      const { username, password } = ctx.body || {};
      L.requireFields(ctx.body, ['username', 'password']);
      const list = ensureAdmins(ctx.db);
      const admin = list.find((a) => a.username === username) || list.find((a) => a.adminId === username);
      // 用户名/密码错误不区分文案，避免账号枚举
      if (!admin) throw L.err(L.ERR.UNAUTHORIZED, '用户名或密码错误');
      if (admin.status && admin.status !== 'ACTIVE') throw L.err(L.ERR.FORBIDDEN, '该管理员账号已停用');
      const v = PWD.verifyPassword(admin.password, password);
      if (!v.ok) throw L.err(L.ERR.UNAUTHORIZED, '用户名或密码错误');
      if (v.needsUpgrade) {
        PWD.upgradeIfPlaintext(admin, password);
        ctx.save();
      }
      const { token, expiresAt } = issueToken(ctx, admin);
      L.audit(ctx.db, {
        module: MODULE, action: 'login', targetId: admin.adminId,
        operator: { adminId: admin.adminId, displayName: admin.displayName },
        reason: '后台登录', requestId: ctx.requestId,
      });
      ctx.save();
      return { token, admin: adminDto(admin), expiresAt };
    },
  },

  // ── 登出 ──
  {
    module: MODULE,
    method: 'POST',
    path: '/auth/logout',
    async handler(ctx) {
      const sessions = ctx.__sessions;
      const auth = ctx.req.headers['authorization'] || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
      if (token && sessions[token]) delete sessions[token];
      L.audit(ctx.db, {
        module: MODULE, action: 'logout', targetId: ctx.operator && ctx.operator.adminId,
        operator: ctx.operator, reason: '后台登出', requestId: ctx.requestId,
      });
      ctx.save();
      return { ok: true };
    },
  },

  // ── 当前会话 ──
  {
    module: MODULE,
    method: 'GET',
    path: '/auth/me',
    async handler(ctx) {
      const admin = currentAdmin(ctx);
      return {
        ...adminDto(admin),
        tokenExpiresAt: ctx.sess && ctx.sess.expiresAt ? new Date(ctx.sess.expiresAt).toISOString() : null,
      };
    },
  },

  // ── 修改当前管理员密码 ──
  {
    module: MODULE,
    method: 'POST',
    path: '/auth/password',
    async handler(ctx) {
      const { oldPassword, newPassword } = ctx.body || {};
      L.requireFields(ctx.body, ['oldPassword', 'newPassword']);
      const admin = currentAdmin(ctx);
      const v = PWD.verifyPassword(admin.password, oldPassword);
      if (!v.ok) throw L.err(L.ERR.INVALID_INPUT, '原密码不正确');
      if (!PWD.isStrongEnough(newPassword)) throw L.err(L.ERR.INVALID_INPUT, '新密码长度不足（至少 6 位）');
      if (oldPassword === newPassword) throw L.err(L.ERR.INVALID_INPUT, '新密码不能与原密码相同');
      const reason = L.requireReason(ctx.body, ctx.headerReason);
      const before = { password: '***' };
      PWD.setPassword(admin, newPassword);
      admin.password_changed_at = L.nowIso();
      L.audit(ctx.db, {
        module: MODULE, action: 'change-password', targetId: admin.adminId,
        operator: ctx.operator, reason, before, after: { password: '***' }, requestId: ctx.requestId,
      });
      ctx.save();
      // 改密后强制重新登录：清掉当前 token
      const sessions = ctx.__sessions;
      const auth = ctx.req.headers['authorization'] || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
      if (token && sessions[token]) delete sessions[token];
      return { ok: true, relogin: true };
    },
  },
];

module.exports = { name: MODULE, code: CODE, title: TITLE, routes, ensureAdmins, adminDto };

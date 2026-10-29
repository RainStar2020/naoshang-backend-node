/**
 * 脑商AI · 数据访问抽象层（P2-5）
 *
 * 目标：把「内存快照 db.json」与「PostgreSQL」统一在同一套异步仓储接口后面。
 *   当前默认 kind='memory'：直接委托给 store.js（既有的内存实现），零行为变化。
 *   当配置 DATABASE_URL 且 DB_KIND='pg' 时切换到 PgAdapter（骨架）：用 SQL 实现同一接口，
 *   业务层（h5.js / routes.js）无需改写——只需把 db 操作换成 repository 的异步方法。
 *
 * 本文件只定义接口 + 内存适配 + PG 适配骨架 + SQL（sql/schema.sql 已含建表）。
 * PG 适配未连真实库（require('pg') 懒加载，未安装时方法清晰报错），可用 memory 适配做 mock 验证。
 */

const S = require('./store');

// ───────────────────────── 内存适配（委托 store.js） ─────────────────────────
function memoryAdapter(db) {
  return {
    kind: 'memory',
    async getSettings() { return S.getSettings(db); },
    async updateSettings(patch) { return S.updateSettings(db, patch); },
    async getUser(id) { return S.getUser(db, id); },
    async getUserByPhone(phone) { return S.getUserByPhone(db, phone); },
    async addUser(patch) { return S.addUser(db, patch); },
    async saveUser(u) { db.users[u.id] = u; return u; },
    async listUsers() { return Object.values(db.users); },
    async getOrder(id) { return (db.orders || []).find((o) => o.id === id) || null; },
    async saveOrder(o) {
      db.orders = db.orders || [];
      const i = db.orders.findIndex((x) => x.id === o.id);
      if (i >= 0) db.orders[i] = o; else db.orders.push(o);
      return o;
    },
    async listCommissions(userId) { return (db.commissions || []).filter((c) => c.owner_id === userId); },
    async getQuotaLedger(partnerId) { return require('./quotaLedger').normalize(db.quotaLedger, partnerId); },
    async saveQuotaLedger(partnerId, e) { db.quotaLedger[partnerId] = e; return e; },
    async listInviteCodes(ownerId) { return require('./inviteCode').listMyCodes(db, ownerId); },
    async saveInviteCode(rec) { db.inviteCodes = db.inviteCodes || []; db.inviteCodes.push(rec); return rec; },
    async getMember(id) { return (db.members || []).find((m) => m.id === id) || null; },
    async saveMember(m) {
      db.members = db.members || [];
      const i = db.members.findIndex((x) => x.id === m.id);
      if (i >= 0) db.members[i] = m; else db.members.push(m);
      return m;
    },
  };
}

// ───────────────────────── PostgreSQL 适配（骨架） ─────────────────────────
function pgAdapter(pool) {
  // pool: 一个 pg.Pool 实例（由调用方注入，避免本文件强依赖 pg）
  if (!pool || typeof pool.query !== 'function') {
    throw new Error('PgAdapter 需要一个 pg.Pool 实例（DB_KIND=pg 且 DATABASE_URL 已配置时由 server.js 注入）');
  }
  const q = (text, params) => pool.query(text, params);
  return {
    kind: 'pg',
    async getSettings() { const r = await q('SELECT payload FROM app_settings WHERE id=$1', ['default']); return r.rows[0] ? r.rows[0].payload : {}; },
    async updateSettings(patch) {
      const cur = await this.getSettings();
      const next = Object.assign({}, cur, patch);
      await q('INSERT INTO app_settings(id,payload) VALUES($1,$2) ON CONFLICT (id) DO UPDATE SET payload=$2', ['default', next]);
      return next;
    },
    async getUser(id) { const r = await q('SELECT * FROM users WHERE id=$1', [id]); return r.rows[0] || null; },
    async getUserByPhone(phone) { const r = await q('SELECT * FROM users WHERE phone=$1', [phone]); return r.rows[0] || null; },
    async addUser(patch) { const r = await q('INSERT INTO users(id,name,phone,tier,upline_id,is_founding) VALUES($1,$2,$3,$4,$5,$6) RETURNING *', [patch.id, patch.name, patch.phone, patch.tier || 'vip', patch.upline_id || null, patch.is_founding || 'none']); return r.rows[0]; },
    async saveUser(u) { const r = await q('UPDATE users SET name=$2,phone=$3,tier=$4,upline_id=$5 WHERE id=$1 RETURNING *', [u.id, u.name, u.phone, u.tier, u.upline_id || null]); return r.rows[0]; },
    async listUsers() { const r = await q('SELECT * FROM users'); return r.rows; },
    async getOrder(id) { const r = await q('SELECT * FROM orders WHERE id=$1', [id]); return r.rows[0] || null; },
    async saveOrder(o) { const r = await q('INSERT INTO orders(data) VALUES($1) ON CONFLICT (id) DO UPDATE SET data=$1 RETURNING *', [o.id, o]); return r.rows[0]; },
    async listCommissions(userId) { const r = await q('SELECT * FROM commissions WHERE owner_id=$1', [userId]); return r.rows; },
    async getQuotaLedger(partnerId) { const r = await q('SELECT * FROM quota_ledger WHERE partner_id=$1', [partnerId]); return r.rows[0] || null; },
    async saveQuotaLedger(partnerId, e) { await q('INSERT INTO quota_ledger(partner_id,standard,activity) VALUES($1,$2,$3) ON CONFLICT (partner_id) DO UPDATE SET standard=$2,activity=$3', [partnerId, e.standard, JSON.stringify(e.activity)]); return e; },
    async listInviteCodes(ownerId) { const r = await q('SELECT * FROM invite_codes WHERE owner_id=$1', [ownerId]); return r.rows; },
    async saveInviteCode(rec) { const r = await q('INSERT INTO invite_codes(code,type,owner_id,created_at,expires_at,max_use,used_by,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [rec.code, rec.type, rec.ownerId, new Date(rec.createdAt), rec.expiresAt ? new Date(rec.expiresAt) : null, rec.maxUse, JSON.stringify(rec.usedBy), rec.status]); return rec; },
    async getMember(id) { const r = await q('SELECT * FROM members WHERE id=$1', [id]); return r.rows[0] || null; },
    async saveMember(m) { const r = await q('INSERT INTO members(id,data) VALUES($1,$2) ON CONFLICT (id) DO UPDATE SET data=$2 RETURNING *', [m.id, m]); return r.rows[0]; },
  };
}

/**
 * 工厂：根据环境变量选择适配。
 *   DB_KIND='pg' 且传入 pool → pgAdapter；否则 memoryAdapter。
 * 注意：切换 PG 需要 server.js 把 db 对象替换为 repository（异步），属一次性迁移，详情见 docs。
 */
function createRepository({ db, pool } = {}) {
  const kind = String(process.env.DB_KIND || 'memory').toLowerCase();
  if (kind === 'pg') return pgAdapter(pool);
  return memoryAdapter(db);
}

module.exports = { createRepository, memoryAdapter, pgAdapter };

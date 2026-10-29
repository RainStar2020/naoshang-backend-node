/**
 * 会话持久化存储（2026-10-28）
 *
 * 背景
 *   server.js 原先把 sessions 定义为纯内存对象 `const sessions = {}`：
 *   API 进程一重启，所有登录态立即作废。小程序侧表现为 GET /me 返回 401
 *   （前端收到 401 → logout() 清本地 session 并 reLaunch 登录页），用户被强制掉线。
 *
 * 方案
 *   会话落盘到独立文件 data/sessions.json（AES-256-GCM 加密），进程启动时载入内存。
 *   · **独立于 db.json**：db.json 是业务真源且会被同步器单向镜像到 MySQL，
 *     会话 token 属凭证，绝不能进入业务库与 MySQL 镜像。
 *   · **随实例隔离**：db.debug-<port>.json 对应 sessions.debug-<port>.json，
 *     调试实例不污染正式实例登录态（与既有 db 副本机制保持一致）。
 *   · **透明接入**：对外仍是 `sessions[token] = {...}` / `delete sessions[token]`，
 *     由 Proxy 拦截写入并自动落盘，业务代码零改动。
 *   · **过期即失效**：C 端会话默认 30 天 TTL；HQ 会话沿用其自身 expiresAt（8 小时）。
 *     注：改造前 HQ 的 expiresAt 从未被校验，过期 token 实际长期可用，本次一并修正。
 *   · **原子写**：先写临时文件再 rename，避免进程中断留下半截文件。
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const KEY_FILE = '.session_key';
const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const FLUSH_DELAY_MS = 200; // 写入防抖，避免高频登录打爆磁盘

/** 取 32 字节密钥：环境变量优先，否则在 data/ 下生成并固化（保证重启后可解密） */
function resolveKey(dir) {
  const env = process.env.SESSION_SECRET;
  if (env && env.trim()) {
    const raw = env.trim();
    const buf = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
    if (buf.length === 32) return buf;
    return crypto.createHash('sha256').update(raw, 'utf8').digest(); // 任意口令 → 派生 32 字节
  }
  const kf = path.join(dir, KEY_FILE);
  try {
    const buf = Buffer.from(fs.readFileSync(kf, 'utf8').trim(), 'hex');
    if (buf.length === 32) return buf;
  } catch (e) { /* 首次运行：密钥文件不存在 */ }
  const key = crypto.randomBytes(32);
  try {
    fs.writeFileSync(kf, key.toString('hex'), { mode: 0o600 });
  } catch (e) {
    console.error('[SESSION] 密钥文件写入失败（' + e.message + '），重启后会话将失效');
  }
  return key;
}

function encrypt(key, obj) {
  const iv = crypto.randomBytes(IV_LEN);
  const c = crypto.createCipheriv(ALGO, key, iv);
  const data = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return { v: 1, iv: iv.toString('hex'), tag: c.getAuthTag().toString('hex'), data: data.toString('hex') };
}

function decrypt(key, env) {
  const d = crypto.createDecipheriv(ALGO, key, Buffer.from(env.iv, 'hex'));
  d.setAuthTag(Buffer.from(env.tag, 'hex'));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(env.data, 'hex')), d.final()]).toString('utf8'));
}

/**
 * 创建会话存储。
 * @param {object} opts
 * @param {() => string} opts.resolveFile  会话文件路径（惰性求值，随 db 实例隔离）
 * @param {number} [opts.defaultTtlMs]     C 端会话默认存活时长
 * @returns {{sessions: object, load: Function, flush: Function}}
 */
function createSessionStore(opts) {
  const resolveFile = opts.resolveFile;
  const defaultTtlMs = opts.defaultTtlMs || 30 * 24 * 60 * 60 * 1000;

  const store = new Map(); // token -> session 对象
  const meta = new Map();  // token -> { exp }（过期时间单独存，不污染业务数据结构）
  let key = null;
  let dirty = false;
  let timer = null;

  const file = () => resolveFile();
  const ensureKey = () => (key || (key = resolveKey(path.dirname(file()))));

  function load() {
    const f = file();
    try {
      if (!fs.existsSync(f)) return;
      const env = JSON.parse(fs.readFileSync(f, 'utf8'));
      const obj = decrypt(ensureKey(), env);
      const now = Date.now();
      let alive = 0;
      for (const [t, rec] of Object.entries(obj.items || {})) {
        const exp = rec && rec.e ? rec.e : 0;
        if (exp && exp <= now) continue; // 过期会话不恢复
        store.set(t, rec.s);
        meta.set(t, { exp });
        alive++;
      }
      console.log(`[SESSION] 已从 ${path.basename(f)} 恢复 ${alive} 个会话`);
    } catch (e) {
      console.error('[SESSION] 会话文件读取失败（' + e.message + '），本次启动按「无登录态」处理');
    }
  }

  function snapshot() {
    const items = {};
    for (const [t, s] of store) items[t] = { s, e: (meta.get(t) || {}).exp || 0 };
    return { items };
  }

  /** 同步落盘（原子：临时文件 + rename） */
  function flush() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!dirty) return;
    dirty = false;
    const f = file();
    try {
      fs.mkdirSync(path.dirname(f), { recursive: true });
      const tmp = f + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(encrypt(ensureKey(), snapshot())), 'utf8');
      fs.renameSync(tmp, f);
    } catch (e) {
      console.error('[SESSION] 会话落盘失败：' + e.message);
    }
  }

  function markDirty() {
    dirty = true;
    if (!timer) timer = setTimeout(flush, FLUSH_DELAY_MS);
  }

  /** 解析会话自身的过期时间：优先 expiresAt（数字毫秒或 ISO 串），否则用默认 TTL */
  function resolveExpiry(value) {
    const e = value && typeof value === 'object' ? value.expiresAt : undefined;
    if (typeof e === 'number' && e > 0) return e;
    if (typeof e === 'string' && e) {
      const p = Date.parse(e);
      if (!Number.isNaN(p)) return p;
    }
    return Date.now() + defaultTtlMs;
  }

  const proxy = new Proxy({}, {
    get(_t, key) {
      if (typeof key !== 'string') return undefined;
      if (!store.has(key)) return undefined;
      const m = meta.get(key) || {};
      if (m.exp && m.exp <= Date.now()) { // 过期即拒，并顺手清理
        store.delete(key);
        meta.delete(key);
        markDirty();
        return undefined;
      }
      return store.get(key);
    },
    set(_t, key, value) {
      if (typeof key !== 'string') return true;
      store.set(key, value);
      meta.set(key, { exp: resolveExpiry(value) });
      markDirty();
      return true;
    },
    deleteProperty(_t, key) {
      if (typeof key !== 'string') return true;
      if (store.delete(key)) { meta.delete(key); markDirty(); }
      return true;
    },
    has(_t, key) {
      if (typeof key !== 'string') return false;
      return store.has(key);
    },
  });

  return { sessions: proxy, load, flush };
}

module.exports = { createSessionStore };

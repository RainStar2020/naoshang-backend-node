/**
 * 脑商AI合伙人 · 总部后台（HQ）公共层
 *
 * 契约来源：《总部后台API需求文档.md》v1.0（HQ-01～HQ-26）
 *
 * 本文件提供后台接口共用的横切能力：
 *   - 统一响应信封 { code, message, data }
 *   - 通用错误码（40100/40300/40400/40000/40900/40901/40902/40903/50000）
 *   - admin 会话鉴权（Bearer token）
 *   - 分页（page / pageSize，上限 100）
 *   - 写操作统一约定：reason / idempotencyKey / version 乐观锁 / 审计回执
 *
 * 设计要点：
 *   1. 一切写操作都落在 **db.json（真源）**，由既有同步器单向镜像进 MySQL；
 *      绝不直写 MySQL —— 直写会被同步器整表重建抹掉（见 scripts/managed_tables.js）。
 *   2. 金额统一「元」，保留两位小数（round2）。
 *   3. 幂等键支持 Header `Idempotency-Key` 与 body.idempotencyKey，二者同时存在以 Header 为准。
 */

// ───────────────────────── 错误码 ─────────────────────────
const ERR = {
  OK: 0,
  UNAUTHORIZED: 40100,
  FORBIDDEN: 40300,
  NOT_FOUND: 40400,
  INVALID_INPUT: 40000,
  INVALID_STATE: 40900,
  VERSION_CONFLICT: 40901,
  IDEMPOTENCY_CONFLICT: 40902,
  QUOTA_EXCEEDED: 40903,
  SERVER_ERROR: 50000,
};

/** 错误码 → HTTP 状态码建议 */
const ERR_HTTP = {
  0: 200,
  40100: 401,
  40300: 403,
  40400: 404,
  40000: 400,
  40900: 409,
  40901: 409,
  40902: 409,
  40903: 409,
  50000: 500,
};

/** 业务异常：抛出后由分发器统一转成信封 */
class HqError extends Error {
  constructor(code, message, extra) {
    super(message || '请求失败');
    this.code = code;
    this.extra = extra || null;
  }
}

const err = (code, message, extra) => new HqError(code, message, extra);

// ───────────────────────── 通用工具 ─────────────────────────
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** 金额规范化：单位「元」，两位小数 */
const money = (n) => round2(Number(n) || 0);

const nowIso = () => new Date().toISOString();
const nowMs = () => Date.now();

/** 把可能是毫秒时间戳 / ISO 字符串 / Date 的时间转成 ISO 字符串 */
function toIso(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'number') {
    // 10 位当作秒，13 位当作毫秒
    const ms = v < 1e11 ? v * 1000 : v;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** 手机号脱敏：138****0001 */
function maskPhone(phone) {
  const s = String(phone || '');
  if (!s) return '';
  if (s.length < 8) return s;
  return s.slice(0, 3) + '****' + s.slice(-4);
}

/** 卡号/账号脱敏：保留前 4 后 4 */
function maskTail(s) {
  const v = String(s || '');
  if (!v) return '';
  if (v.length <= 8) return v;
  return v.slice(0, 4) + '****' + v.slice(-4);
}

/** 稳定序列化（用于幂等指纹计算，键顺序无关） */
function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  const keys = Object.keys(v).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
}

/** 幂等指纹：对载荷做稳定哈希 */
function fingerprint(payload) {
  const s = stableStringify(payload || null);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 + c + i, 2246822519) >>> 0;
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

// ───────────────────────── 响应信封 ─────────────────────────
/** 成功信封 */
function ok(data, message) {
  return { code: 0, message: message || 'ok', data: data === undefined ? null : data };
}

/** 失败信封 */
function fail(code, message, extra) {
  const o = { code, message: message || '请求失败', data: null };
  if (extra) Object.assign(o, extra);
  return o;
}

/** 列表型 data 形态 */
function listData(items, total, page, pageSize, summary) {
  const d = { items: items || [], total: total == null ? (items || []).length : total, page: page || 1, pageSize: pageSize || 20 };
  if (summary) d.summary = summary;
  return d;
}

// ───────────────────────── 分页 ─────────────────────────
/**
 * 解析分页参数。page 从 1 起，pageSize 默认 20、上限 100。
 */
function readPaging(query) {
  const page = Math.max(1, parseInt(query.get('page') || '1', 10) || 1);
  const rawSize = parseInt(query.get('pageSize') || '20', 10) || 20;
  const pageSize = Math.min(100, Math.max(1, rawSize));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

/** 从数组切片并组装列表信封 */
function paginate(arr, paging, summary) {
  const total = arr.length;
  const items = arr.slice(paging.offset, paging.offset + paging.pageSize);
  return listData(items, total, paging.page, paging.pageSize, summary);
}

// ───────────────────────── 数据集合初始化 ─────────────────────────
/**
 * 确保 HQ 使用的集合在 db 中存在（首次访问时懒初始化）。
 * 说明：这些集合不参与 db.json → MySQL 同步器的既有映射表，
 *      属于「总部后台专属」数据；需要落 MySQL 时按 docs/后台API.md 附录 D 处理。
 */
const HQ_COLLECTIONS = [
  'hqAdmins',        // 总部管理员
  'hqSessions',      // （会话复用 server.js 的 sessions，此集合仅预留）
  'hqAuditLogs',     // 统一审计日志（HQ-26 追踪溯源）
  'hqIdempotency',   // 幂等键记录
  'hqAnnouncements', // 公告
  'hqColumns',       // 专栏草稿/发布态（CMS）
  'hqMaterials',     // 资料中心
  'hqProducts',      // 商品（HQ-11）
  'hqSkus',          // 商品 SKU
  'hqSoftwareCards', // 软件卡
  'hqSoftwareCardBatches',
  'hqShipments',     // 发货单
  'hqCouponTemplates', // 优惠券模板
  'hqUserCoupons',   // 用户券
  'hqQuotaAccounts', // 配额账户
  'hqRevenueAccounts', // 收益账户
  'hqRevenueLedgers',  // 收益流水
  'hqStaff',         // 门店员工
  'hqStores',        // 门店
  'hqTrainingBalances', // 会员课时余额
  'hqTrainingFeedback', // 培训反馈
  'hqTransfers',     // 转店申请
  'hqPartnerContexts', // 合伙上下文
  'hqPartnerBenefits', // 合伙等级权益内容
  'hqCostorePlans',  // 共创方案
  'hqCostoreApplications', // 共创申请
  'hqSupportTickets',   // 客服工单
  'hqSupportMessages',  // 工单消息
  'hqPaymentsChannels', // 支付渠道配置
  'hqPaymentJobs',      // 支付异步任务
  'hqReconciliation',   // 对账差异
  'hqCourseEntitlements', // 课程权益
];

/** 确保所有 HQ 集合存在（幂等） */
function ensureCollections(db) {
  let changed = false;
  for (const k of HQ_COLLECTIONS) {
    // hqIdempotency 是「键 → 记录」的映射，不是数组，单独处理（见下）
    if (k === 'hqIdempotency') continue;
    if (!Array.isArray(db[k])) { db[k] = []; changed = true; }
  }
  // 幂等存储是对象（键为 scope::idempotencyKey），**绝不能重置**——
  // 否则每次请求都会清空已登记的幂等记录，导致重复提交永远命中不了缓存。
  if (!db.hqIdempotency || typeof db.hqIdempotency !== 'object' || Array.isArray(db.hqIdempotency)) {
    db.hqIdempotency = {};
    changed = true;
  }
  return changed;
}

// ───────────────────────── 鉴权 ─────────────────────────
/**
 * 从请求解析 HQ 会话。
 * token 形如 `hq-admin-<random>`，登记在 server.js 的 sessions 表，role='hq_admin'。
 */
function readSession(req, url, sessions) {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : (url.searchParams.get('token') || '').trim();
  if (!token) return null;
  const s = sessions[token];
  if (!s) return null;
  if (s.role === 'hq_admin' || s.role === 'admin') return s;
  return null;
}

/** 强制 admin 鉴权：未登录 40100，非 admin 40300 */
function requireAdmin(sess) {
  if (!sess) throw err(ERR.UNAUTHORIZED, '未登录或 token 已失效');
  if (sess.role !== 'hq_admin' && sess.role !== 'admin') throw err(ERR.FORBIDDEN, '需要总部后台管理员权限');
  return sess;
}

// ───────────────────────── 审计 ─────────────────────────
/**
 * 记录一条审计日志（HQ-26 追踪溯源的数据源）。
 * @returns 审计记录对象
 */
function audit(db, { module, action, targetId, operator, reason, before, after, requestId, id }) {
  ensureCollections(db);
  const rec = {
    id: id || `hqal_${db.seq++}`,
    module: module || '',
    action: action || '',
    targetId: targetId == null ? null : String(targetId),
    operatorId: (operator && (operator.adminId || operator.id)) || 'admin',
    operatorName: (operator && (operator.displayName || operator.name)) || '总部/后台',
    reason: reason == null ? null : String(reason),
    before: before === undefined ? null : before,
    after: after === undefined ? null : after,
    requestId: requestId || null,
    occurredAt: nowIso(),
  };
  db.hqAuditLogs.unshift(rec);
  // 控制审计表体积：只保留最近 5000 条
  if (db.hqAuditLogs.length > 5000) db.hqAuditLogs.length = 5000;
  return rec;
}

// ───────────────────────── 幂等 ─────────────────────────
/**
 * 幂等校验与登记。
 *
 * 语义（对应需求文档 §统一约定）：
 *   - 相同幂等键 + 相同载荷 → 直接返回上次结果，**不重复执行业务**；
 *   - 相同幂等键 + 不同载荷 → 40902 IDEMPOTENCY_CONFLICT；
 *   - 未提供幂等键 → 直接执行（契约允许，但前端务必传）。
 *
 * 关键设计：**幂等优先于乐观锁**。
 *   典型场景 —— 前端拿到操作结果后重发同一请求（携带的仍是**旧 version**）：
 *     · 若先校验 version → 抛 VERSION_CONFLICT，幂等形同虚设；
 *     · 正确语义是「重复提交返回同一业务结果」。
 *   因此 version 校验被延后到「确认不是重复提交」之后才真正执行
 *   （见 checkVersion 的两种执行时机）。
 *
 * 键空间与指纹均由分发器统一计算（ctx.idemScope / ctx.idemFingerprint），
 * 只包含**客户端可控**的数据：
 *   - scope     = `${METHOD} ${路由模板}`，例如 `POST /users/:accountId/mutate`
 *   - fingerprint = hash(路径参数 + 请求体)
 * 刻意不掺入任何服务端可变状态（如记录当前 version），
 * 否则首次提交后状态一变，重试时指纹就变了，缓存永远命中不了。
 *
 * @param {object} ctx  请求上下文（含 db / idemKey / idemScope / idemFingerprint）
 * @param {Function} fn 真正执行写操作的函数
 */
function withIdempotency(ctx, fn) {
  const db = ctx.db;
  ensureCollections(db);
  const key = ctx.idemKey;

  /** 执行「已登记但尚未执行」的 version 校验 */
  const runPendingVersionChecks = () => {
    const checks = ctx.__versionChecks || [];
    ctx.__versionChecks = [];
    for (const c of checks) c();
  };

  /** 在 fn 执行期间把 version 校验切换为「立即校验」模式 */
  const armed = (run) => {
    const prev = ctx.__versionArmed;
    ctx.__versionArmed = true;
    try { return run(); } finally { ctx.__versionArmed = prev; }
  };

  if (!key) {
    // 未提供幂等键：先执行登记的 version 校验，再执行业务
    runPendingVersionChecks();
    return armed(fn);
  }

  const scope = ctx.idemScope || 'hq';
  const fp = ctx.idemFingerprint || fingerprint(null);
  const full = `${scope}::${key}`;
  const store = db.hqIdempotency;
  const prev = store[full];

  if (prev) {
    if (prev.fingerprint !== fp) {
      throw err(ERR.IDEMPOTENCY_CONFLICT, '幂等键已用于不同的请求载荷', { idempotencyKey: key });
    }
    // 幂等命中：丢弃待校验的 version 校验（不因旧 version 报冲突），直接返回上次结果
    ctx.__versionChecks = [];
    return prev.result;
  }

  runPendingVersionChecks();
  const result = armed(fn);
  store[full] = { fingerprint: fp, result: result === undefined ? null : result, at: nowIso(), scope };
  // 清理过期记录（保留最近 2000 条）
  const keys = Object.keys(store);
  if (keys.length > 2000) {
    for (const k of keys.slice(0, keys.length - 2000)) delete store[k];
  }
  return result;
}

// ───────────────────────── 乐观锁 ─────────────────────────
/**
 * 乐观锁校验（严格版）：立即校验并抛错。
 */
function strictCheckVersion(rec, version, label) {
  const cur = Number(rec.version || 1);
  if (version !== undefined && version !== null && version !== '') {
    const want = Number(version);
    if (!Number.isFinite(want)) throw err(ERR.INVALID_INPUT, 'version 必须是数字');
    if (want !== cur) {
      throw err(ERR.VERSION_CONFLICT, `${label || '资源'}已被其他人修改（当前 version=${cur}）`, {
        currentVersion: cur,
      });
    }
  }
  return cur;
}

/**
 * 乐观锁校验。
 *
 * **为什么不是立即校验**：幂等键必须优先于乐观锁。
 * 典型场景 —— 前端拿到操作结果后重发同一请求（携带的仍是**旧 version**）：
 *   · 若先校验 version → 抛 VERSION_CONFLICT，幂等形同虚设；
 *   · 正确语义是「重复提交返回同一业务结果」。
 *
 * 因此这里区分两种时机：
 *   1. **业务执行中**（ctx.__versionArmed === true）→ 立即严格校验并抛错。
 *      此时已确认不是重复提交（幂等未命中），version 冲突应当如实报出。
 *   2. **业务执行前**（未 armed）→ 先登记，等 withIdempotency 确认
 *      「幂等未命中」后再执行；命中则直接丢弃登记（重复提交返回同一结果）。
 *
 * @param {object} ctx  请求上下文
 * @param {object} rec  资源记录
 * @param {number} [version] 客户端携带的版本
 * @param {string} [label] 资源名称（错误文案用）
 */
function checkVersion(ctx, rec, version, label) {
  if (!ctx) {
    // 无上下文时退化为立即校验
    return strictCheckVersion(rec, version, label);
  }
  if (ctx.__versionArmed) {
    // 业务执行中：立即严格校验
    return strictCheckVersion(rec, version, label);
  }
  // 业务执行前：登记待校验，交由 withIdempotency 决定是否真正执行
  if (!ctx.__versionChecks) ctx.__versionChecks = [];
  ctx.__versionChecks.push(() => strictCheckVersion(rec, version, label));
  return Number(rec.version || 1);
}

/** 递增 version（写操作成功后调用） */
function bumpVersion(rec) {
  rec.version = Number(rec.version || 1) + 1;
  return rec.version;
}

// ───────────────────────── 参数校验 ─────────────────────────
function requireFields(body, fields) {
  const missing = [];
  for (const f of fields) {
    const v = body ? body[f] : undefined;
    if (v === undefined || v === null || v === '') missing.push(f);
  }
  if (missing.length) throw err(ERR.INVALID_INPUT, '缺少必填参数：' + missing.join(', '));
}

function requireReason(body, headerReason) {
  const reason = (body && body.reason) || headerReason || '';
  if (!reason || !String(reason).trim()) {
    throw err(ERR.INVALID_INPUT, 'reason（操作原因）为必填项');
  }
  return String(reason).trim();
}

function ensureEnum(value, allowed, label) {
  if (value === undefined || value === null || value === '') return null;
  if (!allowed.includes(value)) {
    throw err(ERR.INVALID_INPUT, `${label || '参数'}取值非法：${value}（允许：${allowed.join(' / ')}）`);
  }
  return value;
}

/** 关键词模糊匹配（大小写不敏感） */
function matchKeyword(keyword, ...fields) {
  if (!keyword) return true;
  const k = String(keyword).trim().toLowerCase();
  if (!k) return true;
  return fields.some((f) => f != null && String(f).toLowerCase().includes(k));
}

/** 通用 ID 生成（借用 db.seq，保证全局唯一） */
function nextId(db, prefix) {
  return `${prefix}_${db.seq++}`;
}

module.exports = {
  // 错误
  ERR, ERR_HTTP, HqError, err,
  // 工具
  round2, money, nowIso, nowMs, toIso, maskPhone, maskTail,
  stableStringify, fingerprint,
  // 信封
  ok, fail, listData,
  // 分页
  readPaging, paginate,
  // 集合
  HQ_COLLECTIONS, ensureCollections,
  // 鉴权
  readSession, requireAdmin,
  // 审计
  audit,
  // 幂等
  withIdempotency,
  // 乐观锁
  checkVersion, bumpVersion,
  // 校验
  requireFields, requireReason, ensureEnum, matchKeyword, nextId,
};

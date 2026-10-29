/**
 * 脑商AI合伙人 · 总部后台（HQ）路由分发器
 *
 * 契约来源：《总部后台API需求文档.md》v1.0
 * Base Path：`/api/hq`
 *
 * 路由表由各模块文件注册，格式：
 *   { module: 'users', routes: [ { method, path, handler, perm } ] }
 *   path 支持 `:param` 段参数，如 `/users/:accountId/mutate`
 *
 * 分发器职责：
 *   1. 路径匹配（静态段优先于参数段）
 *   2. admin 鉴权（除 login 外全部要求）
 *   3. 读取 body / query / header
 *   4. 统一异常 → 错误信封
 *   5. 幂等键提取（Header 优先，其次 body.idempotencyKey）
 */

const L = require('./lib');
const READONLY_BATCH = require('../../common/api-standard/readonly-batch');

// ───────────────────────── 模块注册表 ─────────────────────────
const MODULES = [
  require('./modules/auth'),
  require('./modules/users'),
  require('./modules/members'),
  require('./modules/course'),
  require('./modules/columns'),
  require('./modules/announcements'),
  require('./modules/materials'),
  require('./modules/activationCodes'),
  require('./modules/softwareCards'),
  require('./modules/quotas'),
  require('./modules/products'),
  require('./modules/delivery'),
  require('./modules/orders'),
  require('./modules/coupons'),
  require('./modules/payments'),
  require('./modules/revenue'),
  require('./modules/withdrawals'),
  require('./modules/staff'),
  require('./modules/stores'),
  require('./modules/training'),
  require('./modules/transfers'),
  require('./modules/partners'),
  require('./modules/invitations'),
  require('./modules/costore'),
  require('./modules/support'),
  require('./modules/trace'),
];

/**
 * 编译路由表：把 '/users/:accountId/mutate' 编译为可匹配的正则与参数名列表。
 * 排序规则：段数多的优先；同段数下静态段优先于参数段。
 */
function compile(routes) {
  const compiled = routes.map((r) => {
    const segs = r.path.split('/').filter((s) => s !== '');
    const names = [];
    const pattern = segs
      .map((s) => {
        if (s.startsWith(':')) {
          names.push(s.slice(1));
          return '([^/]+)';
        }
        return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      })
      .join('/');
    return {
      method: r.method.toUpperCase(),
      path: r.path,
      // 路径以 '/' 开头（Base Path 剥离后仍保留前导斜杠）
      re: new RegExp('^/' + pattern + '$'),
      names,
      handler: r.handler,
      perm: r.perm === undefined ? 'admin' : r.perm,
      module: r.module || '',
      apiStandard: r.apiStandard === true,
      successStatus: r.successStatus,
      segCount: segs.length,
      hasParam: segs.some((s) => s.startsWith(':')),
    };
  });
  // 静态段优先 + 段数多的优先
  compiled.sort((a, b) => {
    if (a.segCount !== b.segCount) return b.segCount - a.segCount;
    if (a.hasParam !== b.hasParam) return a.hasParam ? 1 : -1;
    return 0;
  });
  return compiled;
}

const ROUTES = MODULES.flatMap((m) => compile(m.routes || []));

/** 统计信息（供 /api/hq/_meta 使用） */
const STATS = {
  modules: MODULES.length,
  endpoints: ROUTES.length,
  list: MODULES.map((m) => ({
    module: m.name,
    code: m.code,
    title: m.title,
    endpoints: (m.routes || []).map((r) => `${r.method.toUpperCase()} ${r.path}`),
  })),
};

/**
 * 统一入口。
 * @returns {boolean} true 表示已处理（成功或失败），false 表示路径不属于 HQ 层
 */
async function handle(db, req, res, url, ctx) {
  const { readBody, sendJSON, sessions, persist } = ctx;
  const m = req.method.toUpperCase();
  const pathname = url.pathname;

  // Base Path 剥离：/api/hq/xxx → /xxx
  if (!pathname.startsWith('/api/hq')) return false;

  const rest = pathname.slice('/api/hq'.length) || '/';
  const p = rest === '/' ? '/' : rest.replace(/\/+$/, '');

  L.ensureCollections(db);

  // ── 路径匹配 ──
  let matched = null;
  let params = {};
  for (const r of ROUTES) {
    if (r.method !== m) continue;
    const mm = p.match(r.re);
    if (!mm) continue;
    matched = r;
    params = {};
    r.names.forEach((n, i) => { params[n] = decodeURIComponent(mm[i + 1]); });
    break;
  }

  if (!matched) {
    sendJSON(res, 404, L.fail(L.ERR.NOT_FOUND, `总部后台接口不存在：${m} /api/hq${p}`));
    return true;
  }

  if (matched.apiStandard === true && await READONLY_BATCH.handleNew(matched, db, req, res, url, params, ctx)) return true;
  if (await READONLY_BATCH.handle(matched, db, req, res, url, params, ctx)) return true;

  // ── 鉴权 ──
  const sess = L.readSession(req, url, sessions);
  if (matched.perm !== 'public') {
    try {
      L.requireAdmin(sess);
    } catch (e) {
      sendJSON(res, L.ERR_HTTP[e.code] || 400, L.fail(e.code, e.message, e.extra));
      return true;
    }
  }

  // ── 读取 body ──
  let body = {};
  if (m === 'POST' || m === 'PUT' || m === 'PATCH' || m === 'DELETE') {
    try {
      body = await readBody(req);
    } catch (e) {
      sendJSON(res, 400, L.fail(L.ERR.INVALID_INPUT, e.message || '请求体不是合法 JSON'));
      return true;
    }
  }

  // ── 调用 handler ──
  const q = url.searchParams;
  const idemKey = (req.headers['idempotency-key'] || body.idempotencyKey || '').trim() || null;
  const headerReason = (req.headers['x-reason'] || '').trim() || null;
  const requestId = (req.headers['x-request-id'] || '').trim() || null;

  // ── 幂等键空间与指纹（统一在此计算，只含客户端可控数据）──
  //   scope     = 模块 + 方法 + 路由模板 → 同一端点的所有 action 共用一个键空间，
  //               因此「同键 + 不同 action」能被正确判定为 40902 幂等键冲突。
  //   fingerprint = hash(路径参数 + 请求体去掉幂等键本身)
  //   刻意不掺入服务端可变状态（如记录当前 version），否则首次提交后状态一变，
  //   重试时指纹就变了，缓存永远命中不了 —— 幂等就形同虚设。
  const fpBody = { ...body };
  delete fpBody.idempotencyKey;
  const idemScope = `${matched.module || 'hq'} ${m} ${matched.path}`;
  const idemFingerprint = L.fingerprint({ params, body: fpBody });

  const apiCtx = {
    db,
    req,
    res,
    url,
    query: q,
    body,
    params,
    sess,
    idemKey,
    idemScope,
    idemFingerprint,
    headerReason,
    requestId,
    operator: sess ? { adminId: sess.adminId || 'admin', displayName: sess.name || '总部/后台', role: 'admin' } : null,
    persist: typeof persist === 'function' ? persist : () => {},
    save: typeof persist === 'function' ? persist : () => {},
    // 会话表：HQ 登录/登出需要直接登记与失效 token
    __sessions: sessions,
    // 乐观锁校验登记区：见 lib.checkVersion 的两种执行时机
    __versionChecks: [],
    __versionArmed: false,
  };

  try {
    const result = await matched.handler(apiCtx);
    if (res.headersSent) return true;
    const payload = result && result.__raw ? result : L.ok(result === undefined ? null : result);
    sendJSON(res, 200, payload);
  } catch (e) {
    if (res.headersSent) return true;
    if (e && typeof e.code === 'number') {
      sendJSON(res, L.ERR_HTTP[e.code] || 400, L.fail(e.code, e.message, e.extra));
    } else {
      console.error('[HQ-ERR]', m, pathname, e && e.stack ? e.stack : e);
      sendJSON(res, 500, L.fail(L.ERR.SERVER_ERROR, (e && e.message) || '服务器内部错误'));
    }
  }
  return true;
}

module.exports = { handle, ROUTES, STATS, MODULES };

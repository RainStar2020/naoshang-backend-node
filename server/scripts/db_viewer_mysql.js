/**
 * 脑商AI · MySQL 数据库浏览器（零外部依赖，仅需 mysql2）
 *
 * 直连运行中的 MySQL 实例，读取 information_schema 里的中文注释，
 * 提供表清单 / 字段说明 / 真实数据分页 / 外键关系 / 只读 SQL 查询。
 *
 * 用法：
 *   node scripts/db_viewer_mysql.js                     # 监听 0.0.0.0:7789（局域网可访问），MySQL 127.0.0.1:3307/naoshang
 *   node scripts/db_viewer_mysql.js -p 7790             # 换端口
 *   node scripts/db_viewer_mysql.js -H 127.0.0.1        # 只允许本机访问（默认是 0.0.0.0 开放局域网）
 *   node scripts/db_viewer_mysql.js -t mysecret        # 开启访问令牌，访问时需带 ?t=mysecret
 *   NAOSHANG_VIEWER_HOST=0.0.0.0 NAOSHANG_VIEWER_TOKEN=xxx node scripts/db_viewer_mysql.js
 *
 * 密码来源优先级：
 *   1) 环境变量 NAOSHANG_DB_PASSWORD
 *   2) mysql 配置文件 server/mysql/.env.local
 *   3) 默认值 naoshang@2026
 *
 * 访问令牌来源优先级：
 *   1) 命令行 -t/--token
 *   2) 环境变量 NAOSHANG_VIEWER_TOKEN（未配置则不鉴权，便于内网使用）
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const mysql = require('mysql2/promise');
const { classifyFromDisk } = require('./managed_tables');

const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const argOf = (f) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : null; };

const HOST = argOf('-h') || process.env.NAOSHANG_DB_HOST || '127.0.0.1';
const PORT_DB = Number(argOf('-P') || process.env.NAOSHANG_DB_PORT || 3307);
const DB_NAME = argOf('-d') || process.env.NAOSHANG_DB_NAME || 'naoshang';
const USER = argOf('-u') || process.env.NAOSHANG_DB_USER || 'naoshang';
const PORT_HTTP = Number(argOf('-p') || 7789);

// HTTP 监听地址：默认 0.0.0.0（允许同网段其它主机访问），-H/--http-host 或环境变量可覆盖
const HTTP_HOST = argOf('-H') || argOf('--http-host') || process.env.NAOSHANG_VIEWER_HOST || '0.0.0.0';
// 可选访问令牌：配置后，访问需带 ?t=<token>
const TOKEN = argOf('-t') || argOf('--token') || process.env.NAOSHANG_VIEWER_TOKEN || '';

// 密码读取（环境变量优先，其次本地配置文件）
function resolvePassword() {
  if (process.env.NAOSHANG_DB_PASSWORD) return process.env.NAOSHANG_DB_PASSWORD;
  const envFile = path.join(ROOT, 'mysql', '.env.local');
  if (fs.existsSync(envFile)) {
    const m = fs.readFileSync(envFile, 'utf8').match(/^PASSWORD=(.*)$/m);
    if (m) return m[1].trim();
  }
  return 'naoshang@2026';
}
const PASSWORD = resolvePassword();

// ── 写入模式（同事专用）────────────────────────────────────────
// 用法：node scripts/db_viewer_mysql.js --write
// 环境变量：NAOSHANG_VIEWER_WRITE=1  等价
// 写入账号优先用 colleague（只有 DML）；未配置时回退为主账号。
const WRITE_ENABLED =
  argv.includes('--write') || argv.includes('-w') ||
  ['1', 'true', 'yes', 'on'].includes(String(process.env.NAOSHANG_VIEWER_WRITE || '').toLowerCase());

const WRITE_LOG = [];

/** 读取 colleague 凭据文件（由 scripts/colleague_account.js create 生成） */
function resolveColleagueCred() {
  const f = path.join(ROOT, 'colleague-kit', 'colleague-credentials.txt');
  if (!fs.existsSync(f)) return null;
  const kv = {};
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) kv[m[1]] = m[2].trim();
  }
  if (!kv.USER || !kv.PASSWORD) return null;
  return { user: kv.USER, password: kv.PASSWORD };
}

const COLLEAGUE = resolveColleagueCred();

/**
 * 取本机局域网 IPv4。
 *
 * 为什么要这个：colleague 账号限定 host 为 '192.168.%'（只允许局域网来源）。
 * 若写入连接走 127.0.0.1，MySQL 看到的来源是 localhost → 匹配不到该账号，
 * 直接 1045 拒绝。必须从局域网 IP 发起，才能以 colleague 身份执行。
 * 若本机没有局域网 IPv4（纯离线环境），则回退到主账号（写入仍受 L1/L2 保护，
 * 但少了 L3 的账号级兜底 → 此时会在启动横幅上明确告警）。
 */
function lanIPv4() {
  const os = require('os');
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === 'IPv4' && !ni.internal) return ni.address;
    }
  }
  return null;
}

const WRITE_HOST = (COLLEAGUE && lanIPv4()) ? lanIPv4() : HOST;

const WRITE_CFG = {
  host: WRITE_HOST, port: PORT_DB, database: DB_NAME,
  user: COLLEAGUE ? COLLEAGUE.user : USER,
  password: COLLEAGUE ? COLLEAGUE.password : PASSWORD,
  multipleStatements: false,   // L1：数据库层也禁止多语句
  dateStrings: true,
};

// ── 写入 SQL 校验（L1 + L4）────────────────────────────────────
const DML_OPS = ['INSERT', 'UPDATE', 'DELETE', 'REPLACE'];
const FORBIDDEN = [
  'DROP', 'TRUNCATE', 'ALTER', 'CREATE', 'RENAME', 'GRANT', 'REVOKE',
  'CALL', 'EXECUTE', 'PREPARE', 'DEALLOCATE', 'LOAD', 'OUTFILE', 'DUMPFILE',
  'LOCK', 'UNLOCK', 'USE', 'SHUTDOWN', 'RESET', 'FLUSH', 'HANDLER',
  'INSTALL', 'UNINSTALL', 'OPTIMIZE', 'REPAIR', 'ANALYZE', 'CHECK', 'KILL',
  // 注意：SET 不在黑名单里——UPDATE ... SET ... 是必需语法，
  // 早期版本误将 SET 列入黑名单，导致所有 UPDATE 语句被误杀。
];

/**
 * 解析并校验一条写入语句。
 * 返回 { error } 表示拒绝；否则返回 { op, table }。
 */
function checkWriteSql(sql) {
  // 去掉注释，避免用 /* */ 藏关键字
  const cleaned = sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/#[^\n]*/g, ' ')
    .trim();

  if (!cleaned) return { error: 'SQL 为空' };

  // 分号分隔的多语句 → 拒绝
  const body = cleaned.replace(/;\s*$/, '');
  if (body.includes(';')) return { error: '不允许执行多条语句（分号分隔）' };

  const m = body.match(/^([A-Za-z]+)\s+([\s\S]*)$/);
  if (!m) return { error: '无法解析 SQL' };
  const op = m[1].toUpperCase();
  const rest = m[2];

  if (!DML_OPS.includes(op)) {
    return { error: '只允许 INSERT / UPDATE / DELETE / REPLACE 四种写入操作（当前为 ' + op + '）' };
  }

  // 关键字黑名单（词边界匹配）
  const upper = body.toUpperCase();
  for (const kw of FORBIDDEN) {
    const re = new RegExp('(^|[^A-Z_])' + kw + '([^A-Z_]|$)');
    if (re.test(upper)) return { error: '语句中包含被禁止的关键字：' + kw };
  }
  // SET 的针对性防护：只放行 UPDATE ... SET col = val 的用法，
  // 拦截 SET GLOBAL / SESSION / PASSWORD / @var 这类会话级注入。
  const setHit = upper.match(/(^|[^A-Z_])SET\s+([A-Z_]+)/);
  if (setHit && !/^UPDATE\b/.test(upper)) {
    return { error: '不允许使用 SET ' + setHit[2] + '（会话变量注入）' };
  }
  if (setHit && /^(GLOBAL|SESSION|PASSWORD|@)/.test(setHit[2])) {
    return { error: '不允许使用 SET ' + setHit[2] + '（会话变量注入）' };
  }

  // 提取目标表名
  let table = null;
  if (op === 'INSERT' || op === 'REPLACE') {
    const tm = rest.match(/^INTO\s+`?([A-Za-z0-9_$]+)`?/i);
    if (tm) table = tm[1];
  } else if (op === 'UPDATE') {
    const tm = rest.match(/^`?([A-Za-z0-9_$]+)`?\s+SET\b/i);
    if (tm) table = tm[1];
  } else if (op === 'DELETE') {
    const tm = rest.match(/^FROM\s+`?([A-Za-z0-9_$]+)`?/i);
    if (tm) table = tm[1];
  }
  if (!table) return { error: '无法识别目标表，请使用标准写法：INSERT INTO `表名` ... / UPDATE `表名` SET ... / DELETE FROM `表名` ...' };

  // L4：UPDATE / DELETE 必须带 WHERE
  if (op === 'UPDATE' || op === 'DELETE') {
    if (!/\bWHERE\b/i.test(body)) {
      return { error: op + ' 必须带 WHERE 条件（防止误清空整表）。例如：' + op + ' `表名` ... WHERE `主键` = ?' };
    }
  }

  return { op, table };
}

/** 读取 JSON 请求体 */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 200000) { reject(new Error('请求体过大')); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch (e) { reject(new Error('请求体不是合法 JSON')); }
    });
    req.on('error', reject);
  });
}

let pool = null;

async function q(sql, params) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

// ── 访问令牌（可选）────────────────────────────────────────
// 令牌来源：URL 查询参数 t / Cookie dv_token / 请求头 x-viewer-token / Authorization: Bearer
function readCookie(req, name) {
  const raw = req.headers.cookie;
  if (!raw) return '';
  const hit = raw.split(';').map((s) => s.trim()).find((s) => s.startsWith(name + '='));
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : '';
}

function tokenProvided(req, url) {
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  return (
    url.searchParams.get('t') ||
    req.headers['x-viewer-token'] ||
    bearer ||
    readCookie(req, 'dv_token')
  );
}

function tokenRequired() {
  return !!TOKEN;
}

function tokenOk(req, url) {
  if (!TOKEN) return true;
  const provided = String(tokenProvided(req, url) || '');
  if (!provided) return false;
  // 定长比较，避免时序侧信道
  const a = Buffer.from(provided);
  const b = Buffer.from(TOKEN);
  if (a.length !== b.length) return false;
  return require('crypto').timingSafeEqual(a, b);
}

// ── 元信息采集（含中文注释）──────────────────────────────────
async function collectMeta() {
  const tables = await q(
    `SELECT table_name AS name, table_comment AS comment, table_rows
       FROM information_schema.tables
      WHERE table_schema = ? AND table_type = 'BASE TABLE'
      ORDER BY table_name`, [DB_NAME]
  );

  const cols = await q(
    `SELECT table_name AS tbl, column_name AS name, column_type AS type,
            is_nullable AS nullable, column_key AS ckey, column_default AS dflt,
            column_comment AS comment, extra
       FROM information_schema.columns
      WHERE table_schema = ?
      ORDER BY table_name, ordinal_position`, [DB_NAME]
  );

  const fks = await q(
    `SELECT kcu.TABLE_NAME AS tbl, kcu.COLUMN_NAME AS col,
            kcu.REFERENCED_TABLE_NAME AS refTbl, kcu.REFERENCED_COLUMN_NAME AS refCol,
            rc.UPDATE_RULE AS onUpdate, rc.DELETE_RULE AS onDelete
       FROM information_schema.KEY_COLUMN_USAGE kcu
       JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
         ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
        AND rc.CONSTRAINT_NAME   = kcu.CONSTRAINT_NAME
      WHERE kcu.TABLE_SCHEMA = ? AND kcu.REFERENCED_TABLE_NAME IS NOT NULL`, [DB_NAME]
  );

  const fkByTable = new Map();
  for (const f of fks) {
    if (!fkByTable.has(f.tbl)) fkByTable.set(f.tbl, []);
    fkByTable.get(f.tbl).push({
      from: f.col, toTable: f.refTbl, toCol: f.refCol,
      onUpdate: f.onUpdate, onDelete: f.onDelete,
    });
  }

  const colByTable = new Map();
  for (const c of cols) {
    if (!colByTable.has(c.tbl)) colByTable.set(c.tbl, []);
    colByTable.get(c.tbl).push({
      name: c.name,
      type: c.type,
      notnull: c.nullable === 'NO',
      pk: c.ckey === 'PRI',
      dflt: c.dflt,
      extra: c.extra || '',
      comment: c.comment || '',
    });
  }

  // 精确行数（information_schema.table_rows 是估算值）
  const meta = [];
  for (const t of tables) {
    const c = await q('SELECT COUNT(*) AS c FROM `' + t.name.replace(/`/g, '``') + '`');
    meta.push({
      name: t.name,
      comment: t.comment || '',
      count: c[0].c,
      cols: colByTable.get(t.name) || [],
      fks: fkByTable.get(t.name) || [],
    });
  }

  const fkEdges = [];
  for (const m of meta) for (const f of m.fks) {
    fkEdges.push({ from: m.name, fromCol: f.from, to: f.toTable, toCol: f.toCol });
  }
  return { meta, fkEdges };
}

// 分组（与 SQLite 版保持一致的语义分组）
function buildGroups(meta) {
  const groups = [
    { key: '主体与组织', tables: ['users', 'members', 'co_stores', 'co_store_owners', 'regional_agents', 'upline_history', 'settings', 'app_settings', 'counters'] },
    { key: '交易与收益', tables: ['orders', 'commissions', 'settlements', 'entitlement_orders', 'payments', 'pay_accounts', 'withdrawals', 'store_transfers'] },
    { key: '名额与配额', tables: ['quota_ledger', 'quota_transactions', 'quota_activity_batches'] },
    { key: '商品与内容', tables: ['skus', 'assets', 'material_renders', 'columns', 'activation_codes', 'quotes', 'allocation_quotes', 'activity_prices', 'stock_ledger', 'coupons', 'applications', 'coaches'] },
    { key: '账务与运营', tables: ['experience_ledger', 'promotion_tasks', 'free_upgrade_log', 'wechat_tickets', 'support_feedback', 'training_feedback', 'learning_progress', 'allocations', 'jobs', 'invite_codes', 'addresses', 'sms_codes', 'password_resets'] },
  ];
  const known = new Set(meta.map((m) => m.name));
  const grouped = new Set(groups.flatMap((g) => g.tables).filter((t) => known.has(t)));
  for (const m of meta) if (!grouped.has(m.name)) groups.push({ key: '其他', tables: [m.name] });
  return groups.filter((g) => g.tables.length);
}

// ── HTTP 服务 ───────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const send = (code, type, body, extraHeaders) => {
    const h = { 'Content-Type': type, 'Cache-Control': 'no-store' };
    if (extraHeaders) Object.assign(h, extraHeaders);
    res.writeHead(code, h);
    res.end(body);
  };
  const j = (code, obj, extraHeaders) => send(code, 'application/json; charset=utf-8', JSON.stringify(obj), extraHeaders);

  try {
    // 令牌校验：未配置则放行；配置后所有请求（含页面与 API）都需携带
    if (tokenRequired() && !tokenOk(req, url)) {
      const isApi = url.pathname.startsWith('/api/');
      const body = isApi
        ? JSON.stringify({ error: '需要访问令牌：请通过 ?t=<token> 访问，或在请求头携带 x-viewer-token' })
        : '<!doctype html><meta charset="utf-8"><title>需要令牌</title>' +
          '<body style="font:16px/1.6 system-ui;padding:40px">' +
          '<h2>需要访问令牌</h2>' +
          '<p>请使用 <code>http://&lt;本机IP&gt;:' + PORT_HTTP + '/?t=&lt;令牌&gt;</code> 访问。</p></body>';
      return isApi
        ? j(401, JSON.parse(body))
        : send(401, 'text/html; charset=utf-8', body);
    }

    if (url.pathname === '/api/meta') {
      const { meta, fkEdges } = await collectMeta();
      return j(200, {
        dbFile: `MySQL ${HOST}:${PORT_DB}/${DB_NAME} (user: ${USER})`,
        meta, groups: buildGroups(meta), fkEdges,
      });
    }

    if (url.pathname === '/api/rows') {
      const table = url.searchParams.get('table');
      const page = Math.max(1, Number(url.searchParams.get('page') || 1));
      const size = Math.min(200, Math.max(1, Number(url.searchParams.get('size') || 20)));
      const esc = '`' + String(table).replace(/`/g, '``') + '`';

      const tc = await q('SELECT COUNT(*) AS c FROM ' + esc);
      const total = tc[0].c;
      const offset = (page - 1) * size;
      const rows = await q('SELECT * FROM ' + esc + ' LIMIT ? OFFSET ?', [size, offset]);
      const cols = await q(
        'SELECT column_name AS name, column_comment AS comment FROM information_schema.columns WHERE table_schema=? AND table_name=? ORDER BY ordinal_position',
        [DB_NAME, table]
      );
      return j(200, {
        total, page, size, rows,
        columns: cols.map((c) => c.name),
        columnComments: Object.fromEntries(cols.map((c) => [c.name, c.comment || ''])),
      });
    }

    if (url.pathname === '/api/sql') {
      const sql = url.searchParams.get('q') || '';
      if (!/^\s*select\b/i.test(sql)) return j(400, { error: '只允许 SELECT 查询' });
      const rows = await q(sql);
      return j(200, { rows });
    }

    // ── 受控写入（同事专用）─────────────────────────────────────────
    // 安全设计（多重防线，任一层单独失效都仍然安全）：
    //   L1 SQL 解析：只放行 INSERT / UPDATE / DELETE / REPLACE，拦掉 DDL 与多语句
    //   L2 表白名单：托管表（同步器会 DELETE+重建的表）一律拒绝直写
    //   L3 数据库账号：写入用 colleague 账号（只有 DML，无 DROP/ALTER/CREATE）
    //   L4 WHERE 约束：UPDATE/DELETE 必须带 WHERE，杜绝全表清空
    if (url.pathname === '/api/write') {
      if (req.method !== 'POST') return j(405, { error: '请用 POST' });
      if (!WRITE_ENABLED) return j(403, { error: '写入功能未启用（启动时加 --write 开启）' });
      const body = await readJsonBody(req);
      const sql = String(body.sql || '').trim();
      if (!sql) return j(400, { error: 'SQL 为空' });

      const verdict = checkWriteSql(sql);
      if (verdict.error) return j(400, { error: verdict.error });

      // L2 托管表拦截
      const allTables = (await q('SELECT table_name AS n FROM information_schema.tables WHERE table_schema = ?', [DB_NAME])).map(r => r.n);
      const { managed } = classifyFromDisk(allTables);
      const hit = verdict.table && managed.map((t) => t.toLowerCase()).includes(verdict.table.toLowerCase());
      if (hit) {
        return j(409, {
          error: '「' + verdict.table + '」是托管表（由 db.json 单向镜像生成），直写会被同步器在秒级覆盖。' +
                 '请改用业务 API 写入，或写入非托管表。',
          managedTables: managed,
        });
      }

      // L3：用受限账号执行（DDL 会被数据库直接拒绝）
      const conn = await mysql.createConnection(WRITE_CFG);
      try {
        const [rows] = await conn.query(sql);
        const affected = (rows && rows.affectedRows !== undefined) ? rows.affectedRows : null;
        WRITE_LOG.push({ ts: new Date().toISOString(), sql, affected, client: req.socket.remoteAddress });
        if (WRITE_LOG.length > 200) WRITE_LOG.shift();
        // 写后回读受影响行数（DELETE/UPDATE 的 affectedRows 即已生效）
        let preview = null;
        if (verdict.table && (verdict.op === 'UPDATE' || verdict.op === 'DELETE')) {
          try {
            const [cnt] = await conn.query('SELECT COUNT(*) AS c FROM `' + verdict.table.replace(/`/g, '``') + '`');
            preview = cnt[0].c;
          } catch (_) {}
        }
        return j(200, { ok: true, op: verdict.op, table: verdict.table, affectedRows: affected, totalRows: preview, rows: Array.isArray(rows) && rows.length && typeof rows[0] === 'object' ? rows.slice(0, 50) : null });
      } catch (e) {
        return j(400, { error: e.sqlMessage || e.message });
      } finally {
        await conn.end();
      }
    }

    if (url.pathname === '/api/write-tables') {
      const allTables = (await q('SELECT table_name AS n FROM information_schema.tables WHERE table_schema = ?', [DB_NAME])).map(r => r.n);
      const { managed, safe, degraded } = classifyFromDisk(allTables);
      return j(200, { managed, safe, enabled: WRITE_ENABLED, degraded: !!degraded });
    }

    if (url.pathname === '/' || url.pathname === '/index.html') {
      const html = fs.readFileSync(path.join(__dirname, 'db_viewer_mysql.html'), 'utf8');
      // 前端 fetch 不带参数，这里把令牌落成 Cookie，后续 /api/* 自动携带
      const extra = tokenRequired()
        ? { 'Set-Cookie': `dv_token=${encodeURIComponent(TOKEN)}; Path=/; HttpOnly; SameSite=Lax` }
        : null;
      return send(200, 'text/html; charset=utf-8', html, extra);
    }

    send(404, 'text/plain', 'not found');
  } catch (e) {
    j(500, { error: e.message });
  }
});

(async () => {
  pool = mysql.createPool({
    host: HOST, port: PORT_DB, user: USER, password: PASSWORD,
    database: DB_NAME, waitForConnections: true,
    connectionLimit: 4, charset: 'utf8mb4_general_ci',
    dateStrings: true,
  });

  // 连通性自检
  const [row] = await pool.query('SELECT VERSION() AS v, DATABASE() AS db');
  console.log('MySQL 连接成功:', row[0].v, '→', DB_NAME);

  const { meta, fkEdges } = await collectMeta();
  const filled = meta.filter((m) => m.count > 0).length;
  const rows = meta.reduce((a, m) => a + m.count, 0);

  // 收集本机可用的局域网 IPv4，用于打印访问入口
  const os = require('os');
  const lanIps = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === 'IPv4' && !ni.internal) lanIps.push(ni.address);
    }
  }

  server.listen(PORT_HTTP, HTTP_HOST, () => {
    console.log('');
    console.log('  脑商AI · MySQL 数据库浏览器');
    console.log('  ─────────────────────────────────────────');
    console.log('  本机   : http://localhost:' + PORT_HTTP);
    if (HTTP_HOST === '0.0.0.0' || HTTP_HOST === '::') {
      for (const ip of lanIps) console.log('  局域网 : http://' + ip + ':' + PORT_HTTP);
      if (!lanIps.length) console.log('  局域网 : 未检测到非回环 IPv4 地址');
    } else {
      console.log('  监听   : ' + HTTP_HOST + '（仅本机可访问）');
    }
    console.log('  数据库 : ' + HOST + ':' + PORT_DB + '/' + DB_NAME);
    console.log('  写入   : ' + (WRITE_ENABLED
      ? '已开启（账号 ' + WRITE_CFG.user + '@' + WRITE_CFG.host + '，仅 DML；托管表禁止直写）'
      : '未开启（只读；加 --write 可开启写入）'));
    if (WRITE_ENABLED && !COLLEAGUE) {
      console.log('  ⚠ 警告 : 未找到 colleague 凭据，写入回退为主账号 ' + USER + ' → L3 账号级兜底失效');
    }
    console.log('  内容   : ' + meta.length + ' 张表 / ' + filled + ' 张有数据 / ' + rows + ' 行 / ' + fkEdges.length + ' 个外键');
    console.log('  注释   : 表与字段中文说明已加载（悬停字段名可看）');
    console.log('  鉴权   : ' + (TOKEN ? '已开启令牌访问' : '未开启（内网免密）'));
    console.log('  停止   : Ctrl+C');
    console.log('');
  });
})().catch((e) => {
  console.error('启动失败:', e.message);
  if (e.code === 'ECONNREFUSED') {
    console.error('提示：MySQL 未启动，请先确认 MySQL8Naoshang 服务为 Running。');
  } else if (e.code === 'ER_ACCESS_DENIED_ERROR') {
    console.error('提示：账号或密码不正确。可用环境变量 NAOSHANG_DB_PASSWORD 指定。');
  }
  process.exit(1);
});

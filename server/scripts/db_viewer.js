/**
 * 脑商AI · 数据库结构 & 数据浏览器
 *
 * 零依赖（仅 Node 内置模块），双击即可在浏览器里查看：
 *   - ER 关系图（外键连线）
 *   - 表清单 + 行数 + 列定义
 *   - 真实数据分页浏览
 *
 * 用法：
 *   node scripts/db_viewer.js                    # 默认 data/brain_biz_view.db，端口 7788
 *   node scripts/db_viewer.js -o <db> -p <port>
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const argOf = (f) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : null; };
const DB_FILE = path.resolve(argOf('-o') || path.join(ROOT, 'data', 'brain_biz_view.db'));
const PORT = Number(argOf('-p') || 7788);

if (!fs.existsSync(DB_FILE)) {
  console.error('找不到数据库: ' + DB_FILE);
  console.error('先运行: node scripts/export_view_db.js');
  process.exit(1);
}

const db = new DatabaseSync(DB_FILE, { readOnly: true });

// ── 元信息采集 ──────────────────────────────────────────────
const tables = db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
).all().map((t) => t.name);

const meta = tables.map((name) => {
  const cols = db.prepare('PRAGMA table_info("' + name + '")').all().map((c) => ({
    name: c.name, type: c.type || '', notnull: c.notnull === 1,
    pk: c.pk > 0, dflt: c.dflt_value,
  }));
  const count = db.prepare('SELECT COUNT(*) c FROM "' + name + '"').get().c;
  const fks = db.prepare('PRAGMA foreign_key_list("' + name + '")').all().map((f) => ({
    from: f.from, toTable: f.table, toCol: f.to || 'id', onDelete: f.on_delete,
  }));
  return { name, cols, count, fks };
});

// 按外键目标分组，便于画 ER 图
const fkEdges = [];
for (const t of meta) for (const f of t.fks) fkEdges.push({ from: t.name, fromCol: f.from, to: f.toTable, toCol: f.toCol });

const groups = [
  { key: '主体与组织', tables: ['users', 'members', 'co_stores', 'co_store_owners', 'regional_agents', 'upline_history', 'settings', 'app_settings', 'counters'] },
  { key: '交易与收益', tables: ['orders', 'commissions', 'settlements', 'entitlement_orders', 'payments', 'pay_accounts', 'withdrawals', 'store_transfers'] },
  { key: '名额与配额', tables: ['quota_ledger', 'quota_transactions', 'quota_activity_batches'] },
  { key: '商品与内容', tables: ['skus', 'assets', 'material_renders', 'columns', 'activation_codes', 'quotes', 'allocation_quotes', 'activity_prices', 'stock_ledger', 'coupons', 'applications', 'coaches'] },
  { key: '账务与运营', tables: ['experience_ledger', 'promotion_tasks', 'free_upgrade_log', 'wechat_tickets', 'support_feedback', 'training_feedback', 'learning_progress', 'allocations', 'jobs', 'invite_codes', 'addresses', 'sms_codes', 'password_resets'] },
];
const grouped = new Set(groups.flatMap((g) => g.tables));
for (const t of tables) if (!grouped.has(t)) groups.push({ key: '其他', tables: [t] });

// ── 数据查询接口 ────────────────────────────────────────────
function queryPage(table, page, size) {
  const t = meta.find((m) => m.name === table);
  if (!t) return null;
  const total = t.count;
  const offset = (page - 1) * size;
  const rows = db.prepare(`SELECT * FROM "${table}" LIMIT ? OFFSET ?`).all(size, offset);
  return { total, page, size, rows, columns: t.cols.map((c) => c.name) };
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const send = (code, type, body) => {
    res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(body);
  };

  if (url.pathname === '/api/meta') {
    return send(200, 'application/json; charset=utf-8', JSON.stringify({ dbFile: DB_FILE, meta, groups, fkEdges }));
  }

  if (url.pathname === '/api/rows') {
    const table = url.searchParams.get('table');
    const page = Math.max(1, Number(url.searchParams.get('page') || 1));
    const size = Math.min(200, Math.max(1, Number(url.searchParams.get('size') || 20)));
    const data = queryPage(table, page, size);
    if (!data) return send(404, 'application/json', JSON.stringify({ error: 'unknown table' }));
    return send(200, 'application/json; charset=utf-8', JSON.stringify(data));
  }

  if (url.pathname === '/api/sql') {
    const sql = url.searchParams.get('q') || '';
    if (!/^\s*select\b/i.test(sql)) return send(400, 'application/json', JSON.stringify({ error: '只允许 SELECT' }));
    try {
      const rows = db.prepare(sql).all();
      return send(200, 'application/json; charset=utf-8', JSON.stringify({ rows }));
    } catch (e) {
      return send(400, 'application/json', JSON.stringify({ error: e.message }));
    }
  }

  if (url.pathname === '/' || url.pathname === '/index.html') {
    const html = fs.readFileSync(path.join(__dirname, 'db_viewer.html'), 'utf8');
    return send(200, 'text/html; charset=utf-8', html);
  }

  send(404, 'text/plain', 'not found');
});

server.listen(PORT, () => {
  const filled = meta.filter((m) => m.count > 0).length;
  const totalRows = meta.reduce((a, m) => a + m.count, 0);
  console.log('数据库浏览器已启动');
  console.log('  地址   : http://localhost:' + PORT);
  console.log('  数据库 : ' + DB_FILE);
  console.log('  内容   : ' + meta.length + ' 张表 / ' + filled + ' 张有数据 / ' + totalRows + ' 行');
  console.log('  停止   : Ctrl+C');
});

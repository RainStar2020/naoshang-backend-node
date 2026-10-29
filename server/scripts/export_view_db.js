/**
 * 脑商AI · 数据库可视化导出
 *
 * 用途：把运行时数据（data/db.json）灌进正式 schema（sql/schema.sql），
 *       生成一个**带真实数据**的 SQLite 库，供 DBVisualizer / DBeaver /
 *       Navicat / VSCode SQLite 插件等图形化工具直接打开查看。
 *
 * 为什么需要它：
 *   - data/brain_biz.db 是「正式空表库」（45 张表 0 行），只给 DDL 与外键看；
 *   - 真正的业务数据在 data/db.json（内存快照），图形化工具看不了 JSON；
 *   - 本脚本两者合一：完整 schema + 真实数据 → 一眼看清结构与数据。
 *
 * 用法：
 *   node scripts/export_view_db.js                 # 默认输出 data/brain_biz_view.db
 *   node scripts/export_view_db.js -o D:/out.db   # 指定输出路径
 *   node scripts/export_view_db.js --from db.json  # 指定数据源
 *
 * 产物：<输出路径>（单文件 SQLite，含 45 张表 + 真实行数据）
 */

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const { populateSqlite, SCHEMA, ROOT } = require('./db_health');

const DEFAULT_DATA = path.join(ROOT, 'data', 'db.json');
const DEFAULT_OUT = path.join(ROOT, 'data', 'brain_biz_view.db');

// ── 参数解析 ────────────────────────────────────────────────
const argv = process.argv.slice(2);
const argOf = (flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
};
const DATA_FILE = path.resolve(argOf('--from') || DEFAULT_DATA);
const OUT_FILE = path.resolve(argOf('-o') || DEFAULT_OUT);

// ── 主流程 ──────────────────────────────────────────────────
if (!fs.existsSync(DATA_FILE)) {
  console.error('[跳过] 找不到数据源: ' + DATA_FILE);
  console.error('       先启动后端生成 db.json，或用 --from 指定路径。');
  process.exit(1);
}

if (!fs.existsSync(SCHEMA)) {
  console.error('[失败] 找不到建表脚本: ' + SCHEMA);
  process.exit(1);
}

console.log('数据源 : ' + DATA_FILE);
console.log('建表   : ' + SCHEMA);
console.log('输出   : ' + OUT_FILE);

// 覆盖前先删旧文件（SQLite 要求文件不存在或可覆盖）
if (fs.existsSync(OUT_FILE)) fs.unlinkSync(OUT_FILE);

const db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
console.log('快照集合: ' + Object.keys(db).filter((k) => {
  const v = db[k];
  return v && typeof v === 'object';
}).length + ' 个');

const conn = new DatabaseSync(OUT_FILE);
try {
  // 1) 建表（含全部外键约束）
  conn.exec(fs.readFileSync(SCHEMA, 'utf8'));
  conn.exec('PRAGMA foreign_keys = ON');

  // 2) 灌入真实数据
  populateSqlite(conn, db);

  // 3) 外键自检 —— 灌库后立即验证，保证导出的库不是"看着对其实断了"
  const violations = conn.prepare('PRAGMA foreign_key_check').all();
  if (violations.length) {
    console.warn('[警告] 外键违规 ' + violations.length + ' 处：');
    for (const v of violations.slice(0, 10)) {
      console.warn('  ' + v.table + '.' + v.rowid + ' -> ' + v.parent);
    }
  } else {
    console.log('外键自检: 通过（零违规）');
  }

  // 4) 汇总导出的表与行数
  const tables = conn.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  ).all();
  let filled = 0;
  let totalRows = 0;
  const lines = [];
  for (const t of tables) {
    const n = conn.prepare('SELECT COUNT(*) c FROM "' + t.name + '"').get().c;
    totalRows += n;
    if (n > 0) filled++;
    lines.push('  ' + t.name.padEnd(28) + String(n).padStart(6) + ' 行');
  }
  console.log('\n导出完成：' + tables.length + ' 张表，' + filled + ' 张有数据，共 ' + totalRows + ' 行');
  console.log('\n有数据的表：');
  for (const l of lines) {
    if (!/^\s+\S+\s+0 行$/.test(l)) console.log(l);
  }

  // 5) 附一份结构说明表，方便在图形化工具里直接看文档
  conn.exec(`
    CREATE TABLE IF NOT EXISTS _db_notes (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
  const notes = [
    ['生成时间', new Date().toISOString()],
    ['数据源', DATA_FILE],
    ['建表脚本', SCHEMA],
    ['原始空表库', path.join(ROOT, 'data', 'brain_biz.db')],
    ['说明', '本库 = sql/schema.sql 完整结构 + db.json 真实数据；brain_biz.db 为空表交付物'],
    ['运行时存储', '脑商AI 默认 DB_KIND=memory，真实数据源是 data/db.json（内存快照 + 整份落盘）'],
  ];
  const ins = conn.prepare('INSERT OR REPLACE INTO _db_notes (key, value) VALUES (?, ?)');
  for (const [k, v] of notes) ins.run(k, String(v));
  conn.exec('DROP TABLE IF EXISTS _db_notes_notes');
} finally {
  conn.close();
}

console.log('\n打开方式：');
console.log('  1) DBVisualizer / DBeaver / Navicat → 新建 SQLite 连接 → 选 ' + OUT_FILE);
console.log('  2) VS Code 安装 SQLite Viewer 扩展 → 右键该文件 → Open Database');
console.log('  3) 命令行：node scripts/db_inspect.js ' + OUT_FILE);
console.log('\n提示：db.json 与 *.db 均在 .gitignore 中，本文件不会误提交。');

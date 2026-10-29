/**
 * 脑商AI · SQLite → MySQL 迁移器
 *
 * 用途：把项目的关系库（server/sql/schema.sql + server/data/db.json）
 *       迁移到 MySQL，便于用 IDEA / MySQL Workbench / DBeaver 等工具可视化。
 *
 * 为什么要转：
 *   schema.sql 写的是 SQLite / PostgreSQL 兼容方言，直接灌 MySQL 会报语法错
 *   （REAL / INTEGER / INSERT OR IGNORE / TEXT UNIQUE 等）。
 *
 * 迁移内容：
 *   1) DDL  → MySQL 8 方言（AUTO_INCREMENT 主键、DECIMAL 金额、JSON 字段）
 *   2) 数据 → 从 db.json 导出的 brain_biz_view.db 逐表导出为 INSERT
 *
 * 用法：
 *   node scripts/export_mysql.js                # 生成 mysql/naoshang.sql
 *   node scripts/export_mysql.js -o D:/x.sql
 */

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

// 中文注释字典（45 表 / 418 列）：表注释 + 列注释
const COMMENTS = require(path.join(__dirname, '..', 'sql', 'comments.js'));

const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const argOf = (f) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : null; };

const SRC_DB = path.resolve(argOf('--db') || path.join(ROOT, 'data', 'brain_biz_view.db'));
const OUT_SQL = path.resolve(argOf('-o') || path.join(ROOT, 'mysql', 'naoshang.sql'));
const DB_NAME = argOf('--name') || 'naoshang';

// SQL 字符串字面量转义（用于注释）
const sqlLit = (s) => {
  if (s === null || s === undefined) return 'NULL';
  return "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "''") + "'";
};

if (!fs.existsSync(SRC_DB)) {
  console.error('找不到源库: ' + SRC_DB);
  console.error('先运行: node scripts/export_view_db.js');
  process.exit(1);
}

// ── SQLite 类型 → MySQL 类型 ─────────────────────────────────
function mysqlType(t, colName, notnull) {
  const s = String(t || '').toUpperCase();
  const isJson = /payload|data|json|targets|rows|meta|config/i.test(colName);
  if (s.includes('INT')) return 'BIGINT';
  if (s.includes('REAL') || s.includes('FLOA') || s.includes('DOUB')) return 'DECIMAL(18,2)';
  if (s.includes('BLOB')) return 'LONGBLOB';
  if (s.includes('BOOL')) return 'TINYINT(1)';
  // 日期时间列一律用 VARCHAR(32)：原库实际存的值粒度不统一
  //（既有 '2026-10-27 15:21:30'，也有 '2026-10' 这种月粒度），
  // MySQL 的 DATE/DATETIME 在严格模式下会直接拒绝后者，故统一用字符串承载。
  if (s.includes('DATETIME') || s.includes('TIMESTAMP') || s.includes('DATE') || s.includes('TIME')) {
    return 'VARCHAR(32)';
  }
  if (s.includes('TEXT') || s.includes('CLOB') || s.includes('CHAR')) {
    // MySQL 的 JSON 列同样不能带默认值 / 做主键外键，统一用 TEXT 承载 JSON 字符串
    // （JSON 列在 MySQL 里会校验格式，原库里有 '[]' 这类非严格 JSON 的历史值）
    return 'TEXT';
  }
  if (s.includes('NUMERIC') || s.includes('DECIMAL')) return 'DECIMAL(18,2)';
  return 'TEXT';
}

// ── 读取源库结构 ─────────────────────────────────────────────
const src = new DatabaseSync(SRC_DB, { readOnly: true });
const tables = src.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
).all().map((t) => t.name).filter((n) => !n.startsWith('_db_notes'));

const out = [];
out.push('-- ═══════════════════════════════════════════════════════════════');
out.push('-- 脑商AI · MySQL 迁移脚本（由 scripts/export_mysql.js 自动生成）');
out.push('-- 源库   : ' + SRC_DB);
out.push('-- 生成   : ' + new Date().toISOString());
out.push('-- 用法   : mysql -u root -p < naoshang.sql');
out.push('-- ═══════════════════════════════════════════════════════════════');
out.push('');
out.push('SET NAMES utf8mb4;');
out.push('SET FOREIGN_KEY_CHECKS = 0;');
out.push('');
out.push('CREATE DATABASE IF NOT EXISTS `' + DB_NAME + '` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;');
out.push('USE `' + DB_NAME + '`;');
out.push('');

// ── DDL ──────────────────────────────────────────────────────
// 第一步：全局扫描，收集「被主键 / 唯一键 / 外键引用」的列。
// MySQL 规则：TEXT/BLOB/JSON 列不能做主键、唯一键、被外键引用，也不能带默认值。
// 因此这些列统一降级为 VARCHAR(191)（或 TIMESTAMP/BIGINT，视默认值而定）。
const referenced = new Map();   // "table.col" -> true
for (const name of tables) {
  const cols = src.prepare('PRAGMA table_info("' + name + '")').all();
  const fks = src.prepare('PRAGMA foreign_key_list("' + name + '")').all();
  const createSql = src.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(name).sql || '';
  for (const c of cols) {
    if (c.pk > 0) referenced.set(name + '.' + c.name, true);
    const re = new RegExp('["`]?' + c.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '["`]?\\s+[^,\\n]*UNIQUE', 'i');
    if (re.test(createSql)) referenced.set(name + '.' + c.name, true);
  }
  for (const f of fks) {
    referenced.set(name + '.' + f.from, true);
    referenced.set(f.table + '.' + (f.to || 'id'), true);
  }
  // 显式创建的索引（CREATE INDEX）也会把列纳入索引
  for (const i of src.prepare('PRAGMA index_list("' + name + '")').all()) {
    if (i.origin !== 'c' && i.origin !== 'u') continue;
    for (const ix of src.prepare('PRAGMA index_info("' + i.name + '")').all()) {
      if (ix.name) referenced.set(name + '.' + ix.name, true);
    }
  }
  // 建表 SQL 里出现的 UNIQUE(col, ...) 复合约束也纳入
  for (const m of createSql.matchAll(/UNIQUE\s*\(([^)]+)\)/gi)) {
    for (const raw of m[1].split(',')) {
      const cn = raw.trim().replace(/["`\[\]]/g, '');
      if (cn) referenced.set(name + '.' + cn, true);
    }
  }
}

for (const name of tables) {
  const cols = src.prepare('PRAGMA table_info("' + name + '")').all();
  const fks = src.prepare('PRAGMA foreign_key_list("' + name + '")').all();
  const idx = src.prepare('PRAGMA index_list("' + name + '")').all()
    .filter((i) => i.origin === 'c' || i.origin === 'u');   // 显式创建的索引

  const tblComment = (COMMENTS[name] && COMMENTS[name].table) || '';
  const colComments = (COMMENTS[name] && COMMENTS[name].columns) || {};

  // 给列定义追加中文注释
  const withComment = (line, colName) => {
    const c = colComments[colName];
    return c ? line + ' COMMENT ' + sqlLit(c) : line;
  };

  const defs = [];
  for (const c of cols) {
    const isReferenced = referenced.has(name + '.' + c.name);
    let mt = mysqlType(c.type, c.name, c.notnull);
    let line = '  `' + c.name + '` ' + mt;

    // 被索引/外键引用的 TEXT → 必须用 VARCHAR
    if (mt === 'TEXT' && isReferenced) {
      mt = 'VARCHAR(191)';
      line = '  `' + c.name + '` ' + mt;
    }

    if (c.pk > 0) {
      const pkCols = cols.filter((x) => x.pk > 0);
      if (pkCols.length === 1 && /INT/i.test(c.type || '')) line += ' AUTO_INCREMENT';
    }
    if (c.notnull && !(c.pk > 0)) line += ' NOT NULL';

    if (c.dflt_value !== null && c.dflt_value !== undefined) {
      const dv = String(c.dflt_value).trim();
      const colIsText = /^TEXT$/.test(mysqlType(c.type, c.name, c.notnull));
      // SQLite 函数默认值（datetime('now') 等）MySQL 无对应实现，转为 CURRENT_TIMESTAMP
      if (/^CURRENT_TIMESTAMP/i.test(dv) || /^datetime\s*\(/i.test(dv)) {
        // 日期列已是 VARCHAR(32)，默认值用字符串常量（与原库 datetime('now','localtime') 格式一致）
        if (colIsText) line = '  `' + c.name + '` VARCHAR(32)';
        line += " DEFAULT '1970-01-01 00:00:00'";
      } else if (/^-?\d+(\.\d+)?$/.test(dv)) {
        if (colIsText) line = '  `' + c.name + '` BIGINT';       // TEXT 不能带默认值
        line += ' DEFAULT ' + dv;
      } else {
        // SQLite 里字面量默认值带单引号（'active'），落库后 dflt_value 会变成 '''active'''
        const clean = dv.replace(/^'+/, '').replace(/'+$/, '');
        if (colIsText) {
          // MySQL 不允许 TEXT/BLOB/JSON 列带默认值。
          // 策略：短字符串列 → VARCHAR(255)（足够容纳默认值与实际值）；
          //        JSON 数组类（默认 '[]'/'{}'）→ 保持 TEXT，把默认值从 DDL 移除。
          const isJsonish = /^\s*[\[{]/.test(clean);
          if (isJsonish) {
            line = '  `' + c.name + '` TEXT';
            defs.push(withComment(line, c.name));
            continue;   // 不写 DEFAULT
          }
          line = '  `' + c.name + '` VARCHAR(255)';
        }
        line += " DEFAULT '" + clean.replace(/'/g, "''") + "'";
      }
    }
    defs.push(withComment(line, c.name));
  }

  // 唯一约束（SQLite 的 UNIQUE 在 table_info 里只体现为 notnull+pk，需从建表 SQL 取）
  const createSql = src.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name=?"
  ).get(name).sql || '';
  const uniqCols = [];
  for (const c of cols) {
    const re = new RegExp('["`]?' + c.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '["`]?\\s+[^,\\n]*UNIQUE', 'i');
    if (re.test(createSql)) uniqCols.push(c);
  }
  for (const c of uniqCols) {
    // 被引用的列已在上面统一降级为 VARCHAR(191)，此处无需再指定前缀长度
    defs.push('  UNIQUE KEY `uk_' + name + '_' + c.name + '` (`' + c.name + '`)');
  }
  // 主键
  const pkCols = cols.filter((c) => c.pk > 0);
  if (pkCols.length) {
    defs.push('  PRIMARY KEY (' + pkCols.map((c) => '`' + c.name + '`').join(', ') + ')');
  }

  // 外键
  for (const f of fks) {
    let line = '  FOREIGN KEY (`' + f.from + '`) REFERENCES `' + f.table + '` (`' + (f.to || 'id') + '`)';
    if (f.on_delete && f.on_delete.toUpperCase() !== 'NO ACTION') line += ' ON DELETE ' + f.on_delete.toUpperCase();
    if (f.on_update && f.on_update.toUpperCase() !== 'NO ACTION') line += ' ON UPDATE ' + f.on_update.toUpperCase();
    defs.push(line);
  }

  out.push('DROP TABLE IF EXISTS `' + name + '`;');
  out.push('CREATE TABLE `' + name + '` (');
  out.push(defs.join(',\n'));
  out.push(') ENGINE=InnoDB' +
    (tblComment ? ' COMMENT = ' + sqlLit(tblComment) : '') +
    ' DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;');

  // 索引
  for (const i of idx) {
    const info = src.prepare('PRAGMA index_info("' + i.name + '")').all();
    if (!info.length) continue;
    const colsSql = info.map((x) => '`' + x.name + '`').join(', ');
    out.push('CREATE INDEX `ix_' + name + '_' + i.name + '` ON `' + name + '` (' + colsSql + ');');
  }
  out.push('');
}

// ── 数据 ─────────────────────────────────────────────────────
const lit = (v) => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (Buffer.isBuffer(v)) return 'X' + v.toString('hex').toUpperCase();
  if (typeof v === 'object') {
    const s = JSON.stringify(v);
    return "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
  }
  return "'" + String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r/g, '\\r').replace(/\n/g, '\\n') + "'";
};

let totalRows = 0;
for (const name of tables) {
  const cols = src.prepare('PRAGMA table_info("' + name + '")').all();
  const colNames = cols.map((c) => c.name);
  const rows = src.prepare('SELECT * FROM "' + name + '"').all();
  if (!rows.length) continue;

  const colList = colNames.map((c) => '`' + c + '`').join(', ');
  const tuples = rows.map((r) => {
    const vals = colNames.map((c) => lit(r[c]));
    return '  (' + vals.join(', ') + ')';
  });

  out.push('INSERT INTO `' + name + '` (' + colList + ') VALUES');
  out.push(tuples.join(',\n') + ';');
  out.push('');
  totalRows += rows.length;
}

out.push('SET FOREIGN_KEY_CHECKS = 1;');
out.push('');
out.push('-- 完成：' + tables.length + ' 张表，' + totalRows + ' 行数据');

src.close();

fs.mkdirSync(path.dirname(OUT_SQL), { recursive: true });
fs.writeFileSync(OUT_SQL, out.join('\n'), 'utf8');

console.log('已生成: ' + OUT_SQL);
console.log('表 ' + tables.length + ' 张，数据 ' + totalRows + ' 行');
console.log('目标库名: ' + DB_NAME);

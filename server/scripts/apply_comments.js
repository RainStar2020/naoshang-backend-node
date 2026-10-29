/**
 * 脑商AI · 中文注释应用器
 *
 * 作用：把 sql/comments.js 里的中文说明写进 MySQL 库的表注释与列注释。
 *   · 优先用 ALTER TABLE ... MODIFY COLUMN ... COMMENT / ALTER TABLE ... COMMENT（幂等，可反复执行）
 *   · 同步把注释写回 mysql/naoshang.sql 的建表语句（让脚本重建的库也自带注释）
 *
 * 用法：
 *   node scripts/apply_comments.js              # 校验 + 应用到 MySQL + 更新 naoshang.sql
 *   node scripts/apply_comments.js --check      # 只校验注释覆盖率，不改库
 *   node scripts/apply_comments.js --sql-only   # 只更新 naoshang.sql，不动 MySQL
 *   node scripts/apply_comments.js --host 127.0.0.1 --port 3307 --user naoshang --password xxx --db naoshang
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const COMMENTS = require(path.join(ROOT, 'sql', 'comments.js'));

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const argOf = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const HOST = argOf('--host', '127.0.0.1');
const PORT = argOf('--port', '3307');
const USER = argOf('--user', 'naoshang');
const PASS = argOf('--password', 'naoshang@2026');
const DB = argOf('--db', 'naoshang');

const MYSQL_BIN = process.env.MYSQL_BIN ||
  'C:\\Program Files\\MySQL\\MySQL Server 8.4\\bin\\mysql.exe';

const SQL_FILE = path.join(ROOT, 'mysql', 'naoshang.sql');

/** 运行一条 mysql 命令，返回 stdout 文本 */
function mysql(args, input) {
  const full = [
    '-h' + HOST, '-P' + PORT, '-u' + USER, '-p' + PASS,
    '--default-character-set=utf8mb4', '--batch', '--raw', '--skip-column-names'
  ].concat(args);
  const out = execFileSync(MYSQL_BIN, full, {
    input: input || '',
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return out;
}

/** SQL 字符串字面量转义 */
function lit(s) {
  if (s === null || s === undefined) return 'NULL';
  return "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "''") + "'";
}

// ── 1. 读取 MySQL 现有结构 ───────────────────────────────────
function loadCurrent() {
  const q = `
    SELECT table_name, column_name, column_type, is_nullable, column_default, extra, character_set_name, collation_name
    FROM information_schema.columns
    WHERE table_schema = ${lit(DB)}
    ORDER BY table_name, ordinal_position;`;
  const rows = mysql(['-e', q]).split(/\r?\n/).filter(Boolean);
  const map = new Map();     // "table\u0000col" -> colMeta
  const tables = new Set();
  for (const line of rows) {
    const p = line.split('\t');
    const [table, column, type, nullable, def, extra, cs, coll] = p;
    tables.add(table);
    map.set(table + '\u0000' + column, {
      table, column, type,
      nullable: nullable === 'YES',
      def: def === 'NULL' ? null : def,
      extra: extra || '',
      cs: cs || null,
      coll: coll || null,
    });
  }
  return { map, tables };
}

// ── 2. 覆盖率校验 ────────────────────────────────────────────
function checkCoverage(cur) {
  const problems = [];
  const missingTables = [];
  const missingCols = [];
  let colTotal = 0, colCovered = 0;

  for (const t of cur.tables) {
    const def = COMMENTS[t];
    if (!def) { missingTables.push(t); continue; }
    for (const [key, meta] of cur.map) {
      if (meta.table !== t) continue;
      colTotal++;
      if (def.columns && def.columns[meta.column]) colCovered++;
      else missingCols.push(t + '.' + meta.column);
    }
  }

  // 反向：字典里有、但库里没有的表/列
  const orphanTables = [];
  const orphanCols = [];
  for (const [t, def] of Object.entries(COMMENTS)) {
    if (!cur.tables.has(t)) { orphanTables.push(t); continue; }
    for (const c of Object.keys(def.columns || {})) {
      if (!cur.map.has(t + '\u0000' + c)) orphanCols.push(t + '.' + c);
    }
  }

  return { colTotal, colCovered, missingTables, missingCols, orphanTables, orphanCols, problems };
}

// ── 3. 生成 ALTER 语句 ───────────────────────────────────────
function buildAlters(cur) {
  const stmts = [];
  let count = 0;

  for (const t of cur.tables) {
    const def = COMMENTS[t];
    if (!def) continue;

    if (def.table) {
      stmts.push('ALTER TABLE `' + t + '` COMMENT = ' + lit(def.table) + ';');
      count++;
    }

    // 按表分组改列（一条 ALTER 改多列，避免锁表次数过多）
    const cols = [];
    for (const [key, meta] of cur.map) {
      if (meta.table !== t) continue;
      const cmt = def.columns && def.columns[meta.column];
      if (!cmt) continue;
      // columnDef 返回的是「类型 + 属性 + COMMENT」，列名在此处补齐
      cols.push('  MODIFY COLUMN `' + meta.column + '` ' + columnDef(meta) + ' COMMENT ' + lit(cmt));
      count++;
    }
    if (cols.length) {
      stmts.push('ALTER TABLE `' + t + '`\n' + cols.join(',\n') + ';');
    }
  }
  return { stmts, count };
}

/**
 * 还原列定义（类型 / NULL / 默认值 / AUTO_INCREMENT）
 * 注意：MySQL 的 column_default 读回来是字符串，需要还原成字面量。
 * 属性顺序必须遵循 MySQL 语法：
 *   data_type [CHARACTER SET] [COLLATE] [NOT NULL|NULL] [DEFAULT] [AUTO_INCREMENT] [COMMENT]
 */
function columnDef(meta) {
  let def = meta.type;

  // 字符集与排序规则（TEXT/VARCHAR 显式带上，避免继承差异）
  // 必须紧跟类型，否则 MySQL 报语法错
  if (meta.cs && /^(varchar|char|text|tinytext|mediumtext|longtext)/i.test(meta.type)) {
    def += ' CHARACTER SET ' + meta.cs;
    if (meta.coll) def += ' COLLATE ' + meta.coll;
  }

  if (!meta.nullable) def += ' NOT NULL';

  if (/auto_increment/i.test(meta.extra)) {
    // 自增列不能带 DEFAULT
  } else if (meta.def !== null && meta.def !== undefined) {
    def += ' DEFAULT ' + defaultLiteral(meta);
  }

  if (/auto_increment/i.test(meta.extra)) def += ' AUTO_INCREMENT';

  return def;
}

function defaultLiteral(meta) {
  const d = String(meta.def);
  // 数字型
  if (/^-?\d+(\.\d+)?$/.test(d)) {
    if (/^(bigint|int|smallint|tinyint|mediumint|decimal|float|double|bit)/i.test(meta.type)) return d;
    return lit(d);
  }
  // CURRENT_TIMESTAMP 之类
  if (/^(current_timestamp|now\(\)|current_date|current_time)/i.test(d)) return d.toUpperCase();
  // 字符串
  return lit(d);
}

// ── 4. 更新 naoshang.sql（让重建脚本也带注释） ────────────────
function patchSqlFile() {
  if (!fs.existsSync(SQL_FILE)) {
    console.log('跳过：未找到 ' + SQL_FILE);
    return { patched: 0 };
  }
  let sql = fs.readFileSync(SQL_FILE, 'utf8');
  let patched = 0;

  const lines = sql.split(/\r?\n/);
  const out = [];
  let curTable = null;
  let inCreate = false;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    const cm = line.match(/^CREATE TABLE `([^`]+)` \(/);
    if (cm) {
      curTable = cm[1];
      inCreate = true;
      const def = COMMENTS[curTable];
      if (def && def.table) {
        line = line.replace(/\)\s*ENGINE=InnoDB/, ') ENGINE=InnoDB');
      }
      out.push(line);
      continue;
    }

    if (inCreate) {
      if (/^\) ENGINE=InnoDB/.test(line)) {
        inCreate = false;
        const def = COMMENTS[curTable];
        if (def && def.table) {
          line = line.replace(/\)\s*ENGINE=InnoDB/, ") ENGINE=InnoDB COMMENT = " + lit(def.table));
          patched++;
        }
        out.push(line);
        continue;
      }

      // 列定义行：追加 COMMENT
      const lm = line.match(/^(\s*)`([A-Za-z_][A-Za-z0-9_]*)`\s+(.*?)(,)?$/);
      if (lm) {
        const def = COMMENTS[curTable];
        const cmt = def && def.columns && def.columns[lm[2]];
        if (cmt && !/COMMENT/i.test(lm[3])) {
          const tail = lm[4] || '';
          const body = lm[3].replace(/,\s*$/, '');
          line = lm[1] + '`' + lm[2] + '` ' + body + ' COMMENT ' + lit(cmt) + tail;
          patched++;
        }
      }
    }
    out.push(line);
  }

  fs.writeFileSync(SQL_FILE, out.join('\n'), 'utf8');
  return { patched };
}

// ── 主流程 ───────────────────────────────────────────────────
function main() {
  console.log('═══ 脑商AI · 中文注释应用 ═══');
  console.log('目标: ' + HOST + ':' + PORT + '/' + DB);
  console.log('');

  const cur = loadCurrent();
  console.log('当前库: ' + cur.tables.size + ' 张表 / ' + cur.map.size + ' 个字段');
  console.log('');

  const cov = checkCoverage(cur);
  console.log('── 覆盖率 ──');
  console.log('  字段注释覆盖: ' + cov.colCovered + ' / ' + cov.colTotal +
    ' (' + (cov.colTotal ? (cov.colCovered / cov.colTotal * 100).toFixed(1) : '0') + '%)');
  console.log('  缺表注释: ' + (cov.missingTables.length ? cov.missingTables.join(', ') : '无'));
  console.log('  缺列注释: ' + cov.missingCols.length + ' 个' +
    (cov.missingCols.length ? ' → ' + cov.missingCols.slice(0, 20).join(', ') + (cov.missingCols.length > 20 ? ' …' : '') : ''));
  console.log('  字典中库里没有的表: ' + (cov.orphanTables.length ? cov.orphanTables.join(', ') : '无'));
  console.log('  字典中库里没有的列: ' + (cov.orphanCols.length ? cov.orphanCols.join(', ') : '无'));
  console.log('');

  if (has('--check')) {
    const ok = cov.missingTables.length === 0 && cov.missingCols.length === 0;
    console.log(ok ? '✔ 注释已全覆盖' : '✘ 存在缺口，请补齐 sql/comments.js');
    process.exit(ok ? 0 : 1);
  }

  // 更新 naoshang.sql
  if (!has('--sql-only')) {
    const { stmts, count } = buildAlters(cur);
    if (!stmts.length) {
      console.log('没有需要写入的注释');
    } else {
      console.log('── 应用到 MySQL ──');
      console.log('  待执行语句: ' + stmts.length + ' 条（含 ' + count + ' 处注释）');
      const script = 'SET NAMES utf8mb4;\n' + stmts.join('\n') + '\n';
      mysql([DB], script);
      console.log('  ✔ 已写入');
    }
  }

  if (!has('--no-sql-file')) {
    const r = patchSqlFile();
    console.log('── 更新 ' + path.relative(ROOT, SQL_FILE) + ' ──');
    console.log('  写入注释 ' + r.patched + ' 处');
  }

  // 复核
  if (!has('--sql-only')) {
    console.log('');
    console.log('── 复核 ──');
    const q = `
      SELECT
        (SELECT COUNT(*) FROM information_schema.tables
          WHERE table_schema=${lit(DB)} AND table_type='BASE TABLE' AND table_comment<>''),
        (SELECT COUNT(*) FROM information_schema.columns
          WHERE table_schema=${lit(DB)} AND column_comment<>''),
        (SELECT COUNT(*) FROM information_schema.columns
          WHERE table_schema=${lit(DB)});`;
    const [t, c, all] = mysql(['-e', q]).trim().split('\t');
    console.log('  有表注释的表: ' + t + ' / ' + cur.tables.size);
    console.log('  有列注释的列: ' + c + ' / ' + all);
  }
}

main();

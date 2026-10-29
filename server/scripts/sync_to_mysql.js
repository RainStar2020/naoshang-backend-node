/**
 * 脑商AI · db.json → MySQL 同步器（落地用）
 *
 * 把运行态真源 db.json 全量镜像到 MySQL(naoshang)，供 IDEA / 报表可视化，
 * 并与 db_health.js 共用 scripts/mapping.js 的同一套灌库口径，避免实现漂移。
 *
 * 用法：
 *   node scripts/sync_to_mysql.js            # 一次性全量同步
 *   node scripts/sync_to_mysql.js --watch    # 轮询 db.json，变更即同步（部署时常驻）
 *   node scripts/sync_to_mysql.js --backup    # 同步前先把当前 MySQL 数据备份到 bak_* 表
 *
 * 设计：
 *   · 全量刷新（DELETE + 批量 INSERT），语义清晰、零残留；同步期间 FK 检查关闭。
 *   · 写入时按「实际 MySQL 列」过滤行字段，列名不匹配的字段自动忽略，绝不报错中断。
 *   · 失败安全：单表出错不影响其他表；仅打印告警。
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { forEachInsert } = require('./mapping');
const { GENERIC } = require('./managed_tables');
const { preflight, shadowColumns, destinationDowngrades } = require('../src/common/api-standard/money-sync-preflight');

const ROOT = path.join(__dirname, '..');
const DB_FILE = path.resolve(process.env.DB_FILE || path.join(ROOT, 'data', 'db.json'));
const ENV_FILE = path.join(ROOT, 'mysql', '.env.local');

const argv = process.argv.slice(2);
const WATCH = argv.includes('--watch');
const BACKUP = argv.includes('--backup');

// ── 连接参数 ───────────────────────────────────────────────────────
function loadSecret() {
  try {
    const txt = fs.readFileSync(ENV_FILE, 'utf8');
    const line = txt.split('\n').find((l) => l.trim() && !l.trim().startsWith('#') && l.includes('='));
    if (line) return line.slice(line.indexOf('=') + 1).trim();
  } catch (_) {}
  return process.env.MYSQL_PASSWORD || '';
}
const CFG = {
  host: process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.MYSQL_PORT || 3307),
  user: process.env.MYSQL_USER || 'naoshang',
  password: loadSecret(),
  database: process.env.MYSQL_DATABASE || 'naoshang',
  multipleStatements: false,
};

// 通用映射：db.json 集合 → MySQL 表名（口径与 scripts/managed_tables.js 共用，
// 保证「同步器刷哪些表」与「浏览器禁写哪些表」永不漂移）
const GENERIC_TABLES = GENERIC;

const camelToSnake = (s) =>
  s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/([A-Z])([A-Z][a-z])/g, '$1_$2').toLowerCase();

function serialize(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
}

function buildPlan(db) {
  const plan = {};
  // 1) 显式映射（与 db_health.js 共用口径）
  forEachInsert(db, (table, cols, rows) => {
    const arr = plan[table] || (plan[table] = []);
    for (const r of rows) {
      const o = {};
      for (const c of cols) o[c] = r[c];
      arr.push(o);
    }
  });
  // 2) 通用映射补齐未覆盖集合（按实际 MySQL 列过滤在写入时做）
  //    第 3 段为「db 字段 → MySQL 列名」的改名表；未列出的字段按 camelToSnake 转换。
  for (const [dbKey, table, rename] of GENERIC_TABLES) {
    const coll = db[dbKey];
    if (!Array.isArray(coll) || !coll.length) continue;
    const arr = plan[table] || (plan[table] = []);
    for (const item of coll) {
      if (!item || typeof item !== 'object') continue;
      const o = {};
      for (const k of Object.keys(item)) {
        const snake = camelToSnake(k);
        o[(rename && rename[k]) || snake] = item[k];
      }
      arr.push(o);
    }
  }
  return plan;
}

async function writeTable(conn, table, rows, sourceDb) {
  const tName = table.replace(/^"(.+)"$/, '$1');
  let cols;
  try {
    [cols] = await conn.query('SHOW COLUMNS FROM `' + tName + '`');
  } catch (e) {
    console.warn('  ⚠ 跳过未知表 ' + table + '（' + e.message.split('\n')[0] + '）');
    return 0;
  }
  const colSet = new Set(cols.map((c) => c.Field));
  const gate = preflight(tName, rows, cols, { sourceDb });
  if (!gate.ok) {
    console.warn('[MONEY_SYNC_TABLE_SKIPPED] ' + JSON.stringify({table:tName,issues:gate.issues}));
    return 0; // Crucially: no DELETE on this table. Other tables continue.
  }
  const shadowCols = shadowColumns(tName);
  if (shadowCols.length && shadowCols.every(c => colSet.has(c))) {
    try {
      const [existing] = await conn.query('SELECT ' + shadowCols.map(c => '`' + c + '`').join(',') + ' FROM `' + tName + '`');
      const downgrade = destinationDowngrades(tName, rows, existing);
      if (downgrade.length) { console.warn('[MONEY_SYNC_TABLE_SKIPPED] ' + JSON.stringify({table:tName,issues:downgrade})); return 0; }
    } catch (_) {
      console.warn('[MONEY_SYNC_TABLE_SKIPPED] ' + tName + ' DESTINATION_SHADOW_READ_FAILED'); return 0;
    }
  }
  const valid = rows
    .map((r) => {
      const o = {};
      for (const k of Object.keys(r)) if (colSet.has(k)) o[k] = serialize(r[k]);
      return o;
    })
    .filter((o) => Object.keys(o).length > 0);

  await conn.query('DELETE FROM `' + tName + '`');
  if (!valid.length) return 0;

  // ── 主键去重（2026-10-28）────────────────────────────────────────
  // 业务运行时可能产出**主键相同**的多条记录（如 allocation_quotes 的 aq_28
  // 被两次分配流程各生成一条）。直接批量 INSERT 会触发
  // "Duplicate entry 'aq_28' for key 'PRIMARY'" → 整张表同步失败。
  // 这里按主键分组，**保留最后出现的一条**（即最新状态），并打印警告。
  const pkCols = cols.filter((c) => c.Key === 'PRI').map((c) => c.Field);
  let deduped = valid;
  if (pkCols.length) {
    const byKey = new Map();
    for (const o of valid) {
      const k = pkCols.map((c) => String(o[c] === undefined ? '' : o[c])).join('\u0001');
      byKey.set(k, o);   // 后写覆盖先写 → 保留最后一条
    }
    if (byKey.size !== valid.length) {
      console.warn('  ⚠ ' + tName + '：检测到 ' + (valid.length - byKey.size) +
        ' 条重复主键记录，已保留最新的一条');
      deduped = [...byKey.values()];
    }
  }

  const allKeys = [...new Set(deduped.flatMap((o) => Object.keys(o)))];
  const CHUNK = 200;
  for (let i = 0; i < deduped.length; i += CHUNK) {
    const chunk = deduped.slice(i, i + CHUNK);
    const sql =
      'INSERT INTO `' + tName + '` (' +
      allKeys.map((c) => '`' + c + '`').join(',') +
      ') VALUES ' +
      chunk.map(() => '(' + allKeys.map(() => '?').join(',') + ')').join(',');
    const params = chunk.flatMap((o) => allKeys.map((c) => (c in o ? o[c] : null)));
    try {
      await conn.query(sql, params);
    } catch (e) {
      // 补充表名与列上下文，便于定位「必填列缺失/类型不符」类失败
      const err = new Error('写入表 ' + tName + ' 失败：' + e.message.split('\n')[0]);
      err.table = tName;
      err.columns = allKeys;
      err.sql = sql;
      throw err;
    }
  }
  return deduped.length;
}

async function backupTables(conn, tables) {
  for (const t of tables) {
    const tName = t.replace(/^"(.+)"$/, '$1');
    try {
      await conn.query('CREATE TABLE IF NOT EXISTS `bak_' + tName + '` LIKE `' + tName + '`');
      await conn.query('DELETE FROM `bak_' + tName + '`');
      await conn.query('INSERT INTO `bak_' + tName + '` SELECT * FROM `' + tName + '`');
    } catch (e) {
      console.warn('  ⚠ 备份表 ' + t + ' 失败：' + e.message.split('\n')[0]);
    }
  }
  console.log('  已备份 ' + tables.length + ' 张表到 bak_*');
}

async function syncOnce() {
  const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  const plan = buildPlan(db);
  const conn = await mysql.createConnection(CFG);
  try {
    if (BACKUP) await backupTables(conn, Object.keys(plan));
    await conn.query('SET FOREIGN_KEY_CHECKS=0');
    let total = 0;
    const names = Object.keys(plan).sort();
    for (const t of names) total += await writeTable(conn, t, plan[t], db);
    await conn.query('SET FOREIGN_KEY_CHECKS=1');
    console.log('[' + new Date().toISOString() + '] 同步完成：' + names.length + ' 张表，' + total + ' 行');
    return { tables: names.length, rows: total };
  } finally {
    await conn.end();
  }
}

async function main() {
  console.log('脑商AI · db.json → MySQL 同步器');
  console.log('  源: ' + DB_FILE);
  console.log('  目标: ' + CFG.host + ':' + CFG.port + '/' + CFG.database);
  if (WATCH) {
    console.log('  模式: --watch（每 5s 检查 db.json 变更）');
    let last = -1;
    const tick = async () => {
      try {
        const m = fs.statSync(DB_FILE).mtimeMs;
        if (m !== last) {
          last = m;
          await syncOnce();
        }
      } catch (e) {
        console.error('  同步异常（已忽略，下个周期重试）: ' + e.message.split('\n')[0]);
      }
    };
    await tick();
    setInterval(tick, 5000);
    process.on('SIGINT', () => { console.log('\n已停止 watch'); process.exit(0); });
  } else {
    await syncOnce();
  }
}

main().catch((e) => {
  console.error('同步失败:', e.message);
  process.exit(1);
});

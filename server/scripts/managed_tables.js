/**
 * 脑商AI · 「托管表」判定（唯一口径来源）
 *
 * 背景：
 *   MySQL 是 db.json 的**单向镜像**。scripts/sync_to_mysql.js 在 db.json 变更时
 *   以及每次进程启动首轮，会对被它管理的表执行 `DELETE FROM` + 批量重建。
 *   因此「哪些表会被同步器覆盖」必须有一个**唯一口径**，供以下两处共用：
 *     1) sync_to_mysql.js —— 决定刷新哪些表
 *     2) db_viewer_mysql.js —— 决定浏览器里哪些表禁止直写
 *   若两边口径漂移，会出现「界面放行、但同步器照样覆盖」的数据静默丢失。
 *
 * 口径来源：
 *   · mapping.js 的 forEachInsert —— 显式映射的表（与 db_health.js 共用）
 *   · GENERIC —— db.json 集合名与 MySQL 表名不一致的补充映射
 *
 * 判定结果只依赖 db.json 的**结构**（是否存在该集合），与数据量无关。
 */
const fs = require('fs');
const path = require('path');
const { forEachInsert, declaredTables } = require('./mapping');

const ROOT = path.join(__dirname, '..');
const DB_FILE = path.resolve(process.env.DB_FILE || path.join(ROOT, 'data', 'db.json'));

// dbKey（db.json 集合名）→ MySQL 表名，必要时显式改列名
const GENERIC = [
  ['members', 'members'],
  // partnerId → user_id（关系库列名与 db 字段名不一致，需显式改名）
  ['uplineHistory', 'upline_history', { partnerId: 'user_id' }],
  ['withdrawals', 'withdrawals'],
  ['applications', 'applications'],
  // passwordResets / smsChallenges 已在 mapping.js 显式映射（口径统一），此处不再重复追加
  ['entitlementOrders', 'entitlement_orders'],
  ['storeTransfers', 'store_transfers'],
  ['trainingFeedback', 'training_feedback'],
  ['coaches', 'coaches'],
];

/**
 * 表名归一化。
 *
 * 为什么需要：mapping.js 里对 MySQL 保留字表用了带引号的写法（如 '"columns"'），
 * 而 sync_to_mysql.js 在真正写库时会用 table.replace(/^"(.+)"$/, '$1') 剥掉引号。
 * 若判定口径不剥，同一张表就会在「同步器刷新的表集合」与「浏览器禁写的表集合」
 * 中不一致 —— 表现为：界面允许写入，但同步器照样整表覆盖 → **数据静默丢失**。
 * 两边必须用完全相同的归一化规则。
 */
function normalizeTableName(t) {
  return String(t).replace(/^"(.+)"$/, '$1').replace(/^`(.+)`$/, '$1').toLowerCase();
}

/**
 * 静态提取 mapping.js 里**声明**的全部输出表名。
 *
 * 为什么不用运行时遍历（declaredTables）：
 *   mapping.js 里有条件分支的 insert（如 `if (rows.length) insert('sms_codes', ...)`），
 *   只有分支成立时才会执行到 → 运行时遍历的结果**依赖 db.json 当前数据量**。
 *   这会留下一扇时序窗户：某表此刻为空判为可写，同事写入后业务一旦产生该表数据，
 *   同步器就会 DELETE FROM 整表重建 → 同事数据被抹掉。
 *   因此这里直接扫描**源码**里的 insert('表名', ...) 字面量，与数据量彻底解耦。
 *
 * 同步器运行时行为完全不变（本函数只用于「判定」，不参与写入）。
 */
function staticDeclaredTables(mappingSrc) {
  const src = mappingSrc !== undefined ? mappingSrc : fs.readFileSync(path.join(__dirname, 'mapping.js'), 'utf8');
  const set = new Set();
  // 匹配 insert('表名', ...) 与 insert('"保留字"', ...) 两种写法。
  // 注意：MySQL 保留字表（columns）在 mapping 里写成 '"columns"' —— 外层单引号 +
  // 内层双引号，因此引号部分用 ['"]+ 贪婪匹配，捕获组用 [^'"]+ 停在引号前。
  const re = /insert\(\s*['"]+([^'"]+)['"]+\s*,/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    set.add(normalizeTableName(m[1]));
  }
  return [...set];
}

/**
 * 返回 { managed: string[], safe: string[] }
 *   managed —— 会被同步器 DELETE+重建的表（禁止直写）
 *   safe    —— 同步器不碰的表（可直写）
 *
 * ⚠️ 口径必须是「**声明式**」而非「当前有数据的表」：
 *
 *   同步器的实际行为是「db.json 里某集合一旦有数据 → 该表被 DELETE FROM + 重建」。
 *   如果判定只看**此刻**哪些表有数据，就会出现时序漏洞：
 *     t0  某表此刻为空 → 判定为可写 → 同事写入数据
 *     t1  业务产生该表数据 → 同步器 DELETE FROM + 重建 → **同事的数据被抹掉**
 *   同步器是常驻进程，判定快照与实际刷新之间必然存在时间差。
 *
 *   因此这里取「mapping 声明管辖的全部表」+「GENERIC 声明的全部表」，
 *   与数据量完全解耦。宁可多禁几张表，也不能漏掉会被覆盖的表。
 */
function classifyTables(db, allTableNames) {
  const managed = new Set();
  const add = (t) => managed.add(normalizeTableName(t));

  // ① mapping.js 源码中声明的全部表（含条件分支内的、含保留字加引号的）
  for (const t of staticDeclaredTables()) add(t);
  // ② GENERIC 声明的表 —— 无条件视为托管（集合一旦有数据即被刷新）
  for (const [, table] of GENERIC) add(table);

  const all = (allTableNames || []).map((t) => normalizeTableName(t));
  const managedSet = new Set(managed);
  return {
    managed: all.filter((t) => managedSet.has(t)),
    safe: all.filter((t) => !managedSet.has(t)),
  };
}

// db.json 读盘 + 分类的结果缓存（托管表结构很少变，按 mtime 失效）
let _cache = { key: null, value: null };

/**
 * 从磁盘加载 db.json 并分类（带缓存）。
 * db.json 不可读时返回保守结果：全部视为托管表 → 全部禁止直写（fail-safe）。
 */
function classifyFromDisk(allTableNames) {
  let mtime = 0;
  try { mtime = fs.statSync(DB_FILE).mtimeMs; } catch (_) { mtime = 0; }
  const key = mtime + '|' + (allTableNames || []).length;
  if (_cache.key === key && _cache.value) return _cache.value;

  let value;
  try {
    const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    value = classifyTables(db, allTableNames);
  } catch (e) {
    // fail-safe：无法判定时，一律按托管表处理（宁可禁写，不可静默丢数据）
    value = {
      managed: (allTableNames || []).slice(),
      safe: [],
      degraded: true,
    };
  }
  _cache = { key, value };
  return value;
}

module.exports = { GENERIC, classifyTables, classifyFromDisk, normalizeTableName, staticDeclaredTables, DB_FILE };

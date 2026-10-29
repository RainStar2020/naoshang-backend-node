#!/usr/bin/env node
/**
 * 脑商AI · 数据完整性检查 / 修复工具
 *
 * 用途：db.json 是内存快照 + 整份落盘，删除用户时若关联流水没级联清理，
 *      会残留「孤儿记录」（userId 指向已不存在的用户）。
 *      孤儿记录在本地下不报错，但迁移到 PostgreSQL 时会触发外键约束失败。
 *
 * 用法：
 *   node scripts/db_health.js            # 只检查，报告问题（不改文件）
 *   node scripts/db_health.js --fix      # 检查并修复（就地清理孤儿记录）
 *   node scripts/db_health.js --verify   # 额外把 db.json 灌进临时 SQLite 库做外键校验
 *
 * 退出码：0 = 无问题；1 = 发现问题（--fix 时修复后仍为 0）
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DB_FILE = path.join(ROOT, 'data', 'db.json');
const SCHEMA = path.join(ROOT, 'sql', 'schema.sql');

const args = process.argv.slice(2);
const DO_FIX = args.includes('--fix');
const DO_VERIFY = args.includes('--verify');

/** 各集合中「指向用户」的外键字段 */
const FK_RULES = [
  { coll: 'promotionTasks', fk: 'userId' },
  { coll: 'experience', fk: 'userId' },
  { coll: 'freeUpgradeLog', fk: 'userId' },
  { coll: 'inviteCodes', fk: 'ownerId' },
  { coll: 'wechatTickets', fk: 'userId' },
  { coll: 'orders', fk: 'buyer_id' },
  { coll: 'orders', fk: 'seller_id' },
  { coll: 'commissions', fk: 'owner_id' },
  { coll: 'regionalAgents', fk: 'partner_id' },
  { coll: 'quota_transactions', fk: 'partnerId' },
];

/**
 * 虚拟账号（系统主体，非 users 表中的自然人）
 * · HQ       —— 总部（分成缺位时的兜底收款方）
 * · DIVIDEND —— 分红池（合店费分红池，未分配到人前的归集方）
 * 这些不是「孤儿记录」，但迁移 PostgreSQL 时外键需要能对上，故显式登记。
 */
const VIRTUAL_ACCOUNTS = new Set(['HQ', 'DIVIDEND', 'admin']);

/** 孤儿检测：返回 [{ coll, fk, orphanIds:Set, sample:[{id,userId}] }] */
function detectOrphans(db) {
  const uids = new Set(Object.keys(db.users || {}));
  const out = [];
  for (const { coll, fk } of FK_RULES) {
    const arr = db[coll];
    if (!Array.isArray(arr)) continue;
    // 虚拟账号不算孤儿（但仍需在迁移时映射到系统账号）
    const bad = arr.filter((x) => x && x[fk] && !uids.has(x[fk]) && !VIRTUAL_ACCOUNTS.has(x[fk]));
    if (bad.length) {
      out.push({
        coll, fk,
        orphanIds: new Set(bad.map((x) => x[fk])),
        sample: bad.slice(0, 5).map((x) => ({ id: x.id || x.code || '(no-id)', [fk]: x[fk] })),
        count: bad.length,
      });
    }
  }
  // quotaLedger 是以 userId 为键的对象
  const ledgerOrphans = Object.keys(db.quotaLedger || {}).filter((k) => !uids.has(k) && !VIRTUAL_ACCOUNTS.has(k));
  if (ledgerOrphans.length) {
    out.push({
      coll: 'quotaLedger', fk: '(键)',
      orphanIds: new Set(ledgerOrphans),
      sample: ledgerOrphans.slice(0, 5).map((k) => ({ id: k, '(键)': k })),
      count: ledgerOrphans.length,
      isObject: true,
    });
  }
  return out;
}

/** 修复：删除所有孤儿记录 */
function fixOrphans(db, orphans) {
  let removed = 0;
  for (const o of orphans) {
    if (o.isObject) {
      for (const k of o.orphanIds) { delete db.quotaLedger[k]; removed++; }
      continue;
    }
    const before = db[o.coll].length;
    db[o.coll] = db[o.coll].filter((x) => !(x && x[o.fk] && o.orphanIds.has(x[o.fk])));
    removed += before - db[o.coll].length;
  }
  return removed;
}

/** 用 node:sqlite 把 db.json 灌进临时库跑外键校验 */
/**
 * 把 db.json 快照灌入一个已建好 schema 的 SQLite 连接。
 * 抽出为独立函数，供 db_health.js 与 verify_db_migration.js 共用，
 * 保证「健康检查」与「迁移覆盖回归」使用**同一套灌库口径**（避免实现漂移）。
 */
function populateSqlite(conn, db) {
  const { forEachInsert } = require('./mapping');
  // 委托统一映射模块；SQLite 绑定规范：undefined → null；布尔 → 0/1
  const bind = (v) => {
    if (v === undefined) return null;
    if (typeof v === 'boolean') return v ? 1 : 0;
    return v;
  };
  forEachInsert(db, (table, cols, rows) => {
    if (!rows || !rows.length) return;
    const stmt = conn.prepare(
      'INSERT OR REPLACE INTO ' + table + ' (' + cols.join(',') + ') VALUES (' + cols.map(() => '?').join(',') + ')'
    );
    for (const r of rows) stmt.run(...cols.map((c) => bind(r[c])));
  });
  return conn;
}

/** 灌库 + 外键校验（自带临时库生命周期） */
async function verifyWithSqlite(db) {
  const { DatabaseSync } = require('node:sqlite');
  const tmp = path.join(ROOT, 'data', '_health_verify.db');
  if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  const conn = new DatabaseSync(tmp);
  conn.exec(fs.readFileSync(SCHEMA, 'utf8'));
  conn.exec('PRAGMA foreign_keys = ON');
  populateSqlite(conn, db);
  const violations = conn.prepare('PRAGMA foreign_key_check').all();
  conn.close();
  fs.unlinkSync(tmp);
  return violations;
}

async function main() {
  console.log('═'.repeat(62));
  console.log('脑商AI · 数据完整性检查' + (DO_FIX ? '（--fix 修复模式）' : '') + (DO_VERIFY ? '（--verify 外键校验）' : ''));
  console.log('═'.repeat(62));
  console.log('目标：' + DB_FILE);

  if (!fs.existsSync(DB_FILE)) {
    console.log('\n[跳过] 未找到 db.json（后端尚未运行过）。');
    process.exit(0);
  }

  const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  const uids = Object.keys(db.users || {});
  console.log('用户数：' + uids.length);

  const orphans = detectOrphans(db);
  if (!orphans.length) {
    console.log('\n[检查] ✅ 未发现孤儿记录（所有关联流水都能对上用户）。');
  } else {
    console.log('\n[检查] ⚠️ 发现 ' + orphans.length + ' 类孤儿记录：');
    for (const o of orphans) {
      console.log('   · ' + o.coll + '.' + o.fk + ' → ' + o.count + ' 条指向不存在的用户');
      for (const s of o.sample) console.log('       ' + JSON.stringify(s));
    }
    if (DO_FIX) {
      const removed = fixOrphans(db, orphans);
      fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
      console.log('\n[修复] ✅ 已清理 ' + removed + ' 条孤儿记录并写回 db.json');
    } else {
      console.log('\n[提示] 加 --fix 可自动清理（会写回 db.json）。');
    }
  }

  if (DO_VERIFY) {
    const v = await verifyWithSqlite(db);
    if (!v.length) {
      console.log('\n[外键校验] ✅ PRAGMA foreign_key_check 无任何违规（db.json 可无损迁入 PostgreSQL）。');
    } else {
      console.log('\n[外键校验] ❌ 发现 ' + v.length + ' 处违规：');
      for (const row of v.slice(0, 20)) console.log('   ', JSON.stringify(row));
      process.exit(1);
    }
  }

  console.log('\n' + '─'.repeat(62));
  process.exit(0);
}

module.exports = { populateSqlite, verifyWithSqlite, detectOrphans, fixOrphans, VIRTUAL_ACCOUNTS, SCHEMA, ROOT };

if (require.main === module) {
  main().catch((e) => {
    console.error('[db_health] 失败：', e.message);
    process.exit(1);
  });
}

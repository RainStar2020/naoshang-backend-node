#!/usr/bin/env node
/**
 * 脑商AI · 迁移字段缺口审计
 *
 * 用途：在把 MySQL 变成「权威存储」之前，量化 db.json → 关系表映射的字段级缺口。
 *   背景：db_health.js 的 populateSqlite 是 db.json → 关系表的唯一灌库口径，
 *   但它是「快照导出」用途，只写了部分列。反向读回（MySQL → db.json）时，
 *   凡是没写的列都会丢默认值 —— 已实测 users.password 全为空、counters 未灌。
 *
 * 本脚本做三件事：
 *   1) 采集 db.json 每个集合的运行时字段全集（含各来源模块写入的字段）；
 *   2) 采集 schema.sql 每张表的列清单；
 *   3) 逐表比对，输出「db.json 有字段但表里没有对应列」的缺口清单。
 *
 * 用法：node scripts/audit_field_gaps.js [--json]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DB_FILE = path.join(ROOT, 'data', 'db.json');
const SCHEMA = path.join(ROOT, 'sql', 'schema.sql');
const AS_JSON = process.argv.includes('--json');

// ── 1) schema 表 → 列清单 ─────────────────────────────────────
function parseSchemaTables() {
  const sql = fs.readFileSync(SCHEMA, 'utf8');
  const tables = {};
  // 去掉行内注释，避免注释里的分号/括号干扰解析
  const clean = sql.replace(/--[^\n]*/g, '');
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`\[]?([A-Za-z_][A-Za-z0-9_]*)["`\]]?\s*\(/gi;
  let m;
  while ((m = re.exec(clean)) !== null) {
    const name = m[1];
    // 从 '(' 开始做括号配对，取到表体结束
    let i = m.index + m[0].length - 1;
    let depth = 0;
    let start = i + 1;
    for (; i < clean.length; i++) {
      const ch = clean[i];
      if (ch === '(') depth++;
      else if (ch === ')') { depth--; if (depth === 0) break; }
    }
    const body = clean.slice(start, i);
    const cols = [];
    // 顶层逗号切分（跳过括号内的逗号）
    let d = 0, buf = '';
    for (const ch of body) {
      if (ch === '(') d++;
      else if (ch === ')') d--;
      if (ch === ',' && d === 0) { cols.push(buf); buf = ''; }
      else buf += ch;
    }
    if (buf.trim()) cols.push(buf);
    const list = [];
    for (const c of cols) {
      const t = c.trim();
      if (!t) continue;
      if (/^(PRIMARY|UNIQUE|KEY|CONSTRAINT|FOREIGN|CHECK)\b/i.test(t)) continue;
      const cm = t.match(/^["`\[]?([A-Za-z_][A-Za-z0-9_]*)["`\]]?\s+/);
      if (cm) list.push(cm[1]);
    }
    tables[name] = list;
  }
  return tables;
}

// ── 2) db.json 集合 → 字段全集 ────────────────────────────────
//   字段来源不止 db.json 本身：src/ 下的业务模块会往对象上挂运行时字段
//   （如 principal_tier / referral_tier / free_upgrade_applied），
//   这些字段只有跑过对应业务才会落盘，故再从源码里静态抽取一次赋值。
function collectRuntimeFields() {
  const fields = new Set();
  const srcDir = path.join(ROOT, 'src');
  const files = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js')) files.push(p);
    }
  })(srcDir);

  const userFields = new Set();
  for (const f of files) {
    const code = fs.readFileSync(f, 'utf8');
    // u.principal_tier = ... / buyer.principal_tier = ... / U.free_upgrade_applied = ...
    const re = /\b(?:u|buyer|U|user|target|partner|owner)\.([A-Za-z_][A-Za-z0-9_]*)\s*=/g;
    let m;
    while ((m = re.exec(code)) !== null) userFields.add(m[1]);
  }
  for (const f of userFields) fields.add(f);
  return { userFields: [...userFields].sort() };
}

// ── 3) 采集 db.json 各集合字段 ─────────────────────────────────
function collectJsonFields(db) {
  const out = {};
  for (const [k, v] of Object.entries(db)) {
    if (Array.isArray(v)) {
      const s = new Set();
      for (const it of v) if (it && typeof it === 'object') Object.keys(it).forEach((x) => s.add(x));
      out[k] = [...s].sort();
    } else if (v && typeof v === 'object') {
      const s = new Set();
      for (const it of Object.values(v)) if (it && typeof it === 'object') Object.keys(it).forEach((x) => s.add(x));
      out[k] = [...s].sort();
    }
  }
  return out;
}

// ── 4) 集合 → 表 的对应（与 populateSqlite 的口径对齐）──────────
const COLLECTION_TABLE = {
  users: 'users', orders: 'orders', commissions: 'commissions',
  quotaLedger: 'quota_ledger', quota_transactions: 'quota_transactions',
  regionalAgents: 'regional_agents', coStores: 'co_stores',
  uplineHistory: 'upline_history', members: 'members', settings: 'settings',
  experience: 'experience_ledger', promotionTasks: 'promotion_tasks',
  freeUpgradeLog: 'free_upgrade_log', inviteCodes: 'invite_codes',
  wechatTickets: 'wechat_tickets', allocations: 'allocations', payments: 'payments',
  activationCodes: 'activation_codes', coupons: 'coupons', assets: 'assets',
  jobs: 'jobs', learningProgress: 'learning_progress', skus: 'skus',
  stockLedger: 'stock_ledger', columns: 'columns', activityPrices: 'activity_prices',
  quotes: 'quotes', allocationQuotes: 'allocation_quotes',
};

// 驼峰 → 下划线 的常规映射，用于自动比对
const snake = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();

function main() {
  const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  const tables = parseSchemaTables();
  const jsonFields = collectJsonFields(db);
  const { userFields } = collectRuntimeFields();

  const report = { collections: [], unmappedCollections: [], tables: Object.keys(tables).length };

  for (const [coll, fields] of Object.entries(jsonFields)) {
    const tbl = COLLECTION_TABLE[coll];
    if (!tbl) {
      if (fields.length) report.unmappedCollections.push({ coll, fields });
      continue;
    }
    if (!tables[tbl]) {
      report.collections.push({ coll, table: tbl, status: 'TABLE_MISSING', fields, missing: fields });
      continue;
    }
    const cols = new Set(tables[tbl].map((c) => c.toLowerCase()));
    const missing = fields.filter((f) => {
      const cand = [f, snake(f), f.toLowerCase()];
      return !cand.some((c) => cols.has(c.toLowerCase()));
    });
    report.collections.push({
      coll, table: tbl, rows: Array.isArray(db[coll]) ? db[coll].length : Object.keys(db[coll] || {}).length,
      fields, tableCols: tables[tbl], missing,
    });
  }

  // users 表：合并源码抽取的运行时字段
  const u = report.collections.find((c) => c.coll === 'users');
  if (u) {
    const cols = new Set((u.tableCols || []).map((c) => c.toLowerCase()));
    const srcOnly = userFields.filter((f) => !cols.has(f.toLowerCase()) && !cols.has(snake(f).toLowerCase()));
    u.sourceRuntimeFields = userFields;
    u.missingFromSource = srcOnly;
  }

  // counters 表：db.json 的 seq/userSeq/memberSeq 是顶层标量，不是集合
  report.counters = {
    tableExists: !!tables.counters,
    tableCols: tables.counters || [],
    jsonScalars: { seq: db.seq, userSeq: db.userSeq, memberSeq: db.memberSeq },
    populatedByScript: false,   // populateSqlite 未写 counters
  };

  // 顶层标量集合（db.json 里不是数组/对象的那几项）
  report.scalarCollections = Object.entries(db)
    .filter(([, v]) => typeof v !== 'object' || v === null)
    .map(([k, v]) => ({ key: k, value: v }));

  if (AS_JSON) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log('═'.repeat(70));
  console.log('脑商AI · 迁移字段缺口审计');
  console.log('═'.repeat(70));
  console.log(`schema 表数：${report.tables}　db.json 集合数：${Object.keys(jsonFields).length}\n`);

  let gapTotal = 0;
  for (const c of report.collections) {
    if (!c.missing || !c.missing.length) continue;
    gapTotal += c.missing.length;
    console.log(`⚠️  ${c.coll} → ${c.table}（${c.rows ?? '?'} 行）缺列：`);
    console.log(`   ${c.missing.join(', ')}`);
  }
  if (gapTotal === 0) console.log('✅ 各集合字段均能在表中找到对应列');

  if (u && u.missingFromSource && u.missingFromSource.length) {
    console.log(`\n⚠️  users 表缺少源码运行时字段（业务代码在用）：`);
    console.log(`   ${u.missingFromSource.join(', ')}`);
  }

  console.log('\n── counters（序号计数器）──');
  console.log(`   表存在：${report.counters.tableExists}　populateSqlite 灌了没：${report.counters.populatedByScript ? '是' : '否 ← 会导致序号重启'}`);
  console.log(`   db.json 标量：${JSON.stringify(report.counters.jsonScalars)}`);

  if (report.unmappedCollections.length) {
    console.log('\n⚠️  未映射到任何表的集合：');
    for (const c of report.unmappedCollections) console.log(`   ${c.coll}（${c.fields.length} 字段）：${c.fields.join(', ')}`);
  }

  console.log('\n' + '═'.repeat(70));
}

main();

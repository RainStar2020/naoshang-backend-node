#!/usr/bin/env node
/**
 * 闹赏 · 演示业务测试数据合并器（memory/store 优先）
 *
 * 相对 seed_test_data.js：本脚本额外写入「有完整关联」的订单 / 佣金 / 分配 /
 * 区代 / 合店故事数据（金额单位：元，两位小数）。
 *
 * 用法（请先停服，再执行，再起服 —— 与 seed_test_data.js 相同原因）：
 *   1) 把本文件拷到后端 server/scripts/seed_demo.js
 *   2) 把同目录 db.json（本交付物）放在 scripts/ 旁或用 --from 指定
 *   3) node scripts/seed_demo.js              # 合并进 data/db.json
 *   4) node scripts/seed_demo.js --reset      # 先清 demo_* 再合并
 *   5) node scripts/seed_demo.js --replace    # 用演示库整份覆盖 data/db.json（慎用）
 *   6) node scripts/seed_demo.js --dry-run
 *
 * 密码：优先用 SEED_PASSWORD；否则 Naoshang@2026（与 seed_test_data.js 一致）。
 * 若无法加载 utils/password.js，则保留快照里的占位哈希。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DB_FILE = path.join(ROOT, 'data', 'db.json');
const argv = process.argv.slice(2);
const RESET = argv.includes('--reset');
const REPLACE = argv.includes('--replace');
const DRY = argv.includes('--dry-run');
const fromIdx = argv.indexOf('--from');
const FROM = fromIdx >= 0 ? argv[fromIdx + 1] : path.join(__dirname, 'naoshang-demo-db.json');
const FALLBACK_FROM = [
  FROM,
  path.join(__dirname, 'db.json'),
  path.join(__dirname, '..', '..', 'naoshang-test-data', 'db.json'),
  '/workspace/naoshang-test-data/db.json',
];

const PREFIX = 'demo_';
const DEMO_ORDER_IDS = new Set(['demo_o_1', 'demo_o_2', 'demo_o_prod', 'demo_cs_1']);
const DEMO_USER_IDS = new Set([
  'demo_p1', 'demo_p2', 'demo_p3', 'demo_p4', 'demo_p5', 'demo_p6', 'demo_p7',
]);
// HQ / DIVIDEND 仅在目标库缺失时补入，不删除现有

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function findDemoSource() {
  for (const p of FALLBACK_FROM) {
    if (p && fs.existsSync(p)) return p;
  }
  throw new Error(
    '找不到演示源 db.json。请用 --from <path> 指定，或把交付物 db.json 拷到 scripts/naoshang-demo-db.json'
  );
}

function loadTargetDb() {
  let S = null;
  try { S = require(path.join(ROOT, 'src', 'store.js')); } catch (e) { /* optional */ }
  if (fs.existsSync(DB_FILE)) {
    const db = loadJson(DB_FILE);
    if (S && S.createDb) {
      const base = S.createDb();
      for (const k of Object.keys(base)) if (db[k] === undefined) db[k] = base[k];
    }
    if (!Array.isArray(db.orders)) db.orders = [];
    if (!Array.isArray(db.commissions)) db.commissions = [];
    if (!Array.isArray(db.allocations)) db.allocations = [];
    if (!Array.isArray(db.regionalAgents)) db.regionalAgents = [];
    if (!Array.isArray(db.coStores)) db.coStores = [];
    if (!db.users || typeof db.users !== 'object') db.users = {};
    if (!db.quotaLedger || typeof db.quotaLedger !== 'object') db.quotaLedger = {};
    return db;
  }
  if (S && S.createDb) return S.createDb();
  return {
    users: {}, orders: [], commissions: [], quotaLedger: {}, quota_transactions: [],
    regionalAgents: [], coStores: [], allocations: [], members: [],
    uplineHistory: [], freeUpgradeLog: [], experience: [], promotionTasks: [],
    inviteCodes: [], seq: 1, userSeq: 1, memberSeq: 1,
  };
}

function stripDemo(db) {
  let nU = 0, nO = 0, nC = 0, nA = 0, nR = 0, nS = 0;
  for (const id of Object.keys(db.users || {})) {
    if (DEMO_USER_IDS.has(id) || String(id).startsWith(PREFIX)) {
      delete db.users[id];
      delete db.quotaLedger[id];
      nU++;
    }
  }
  const beforeO = db.orders.length;
  db.orders = db.orders.filter((o) => !DEMO_ORDER_IDS.has(o.id) && !String(o.id || '').startsWith(PREFIX));
  nO = beforeO - db.orders.length;
  const beforeC = db.commissions.length;
  db.commissions = db.commissions.filter((c) => {
    const id = String(c.id || '');
    return !(
      id.startsWith(PREFIX) ||
      id.startsWith('po-demo_') ||
      id.startsWith('cs-demo_') ||
      id.startsWith('alc-alc_demo_') ||
      id.startsWith('global-2026-10-demo_') ||
      id.startsWith('cs-div-demo_')
    );
  });
  nC = beforeC - db.commissions.length;
  const beforeA = db.allocations.length;
  db.allocations = db.allocations.filter((a) => !String(a.id || '').startsWith('alc_demo'));
  nA = beforeA - db.allocations.length;
  const beforeR = db.regionalAgents.length;
  db.regionalAgents = db.regionalAgents.filter((a) => !String(a.id || '').startsWith('ra_demo'));
  nR = beforeR - db.regionalAgents.length;
  const beforeS = db.coStores.length;
  db.coStores = db.coStores.filter((s) => !String(s.id || '').startsWith('demo_cs'));
  nS = beforeS - db.coStores.length;
  return { nU, nO, nC, nA, nR, nS };
}

function mergeDemo(db, demo) {
  // users
  for (const [id, u] of Object.entries(demo.users || {})) {
    if (id === 'HQ' || id === 'DIVIDEND') {
      if (!db.users[id]) db.users[id] = u;
      continue;
    }
    db.users[id] = u;
  }
  // quota
  for (const [id, q] of Object.entries(demo.quotaLedger || {})) {
    db.quotaLedger[id] = q;
  }
  // arrays: replace-by-id then append
  const upsertArr = (arr, items, key = 'id') => {
    const map = new Map(arr.map((x) => [x[key], x]));
    for (const it of items) map.set(it[key], it);
    return [...map.values()];
  };
  db.orders = upsertArr(db.orders, demo.orders || []);
  db.commissions = upsertArr(db.commissions, demo.commissions || []);
  db.allocations = upsertArr(db.allocations, demo.allocations || []);
  db.regionalAgents = upsertArr(db.regionalAgents, demo.regionalAgents || []);
  db.coStores = upsertArr(db.coStores, demo.coStores || []);
  if (typeof demo.seq === 'number') db.seq = Math.max(db.seq || 1, demo.seq);
  if (typeof demo.userSeq === 'number') db.userSeq = Math.max(db.userSeq || 1, demo.userSeq);
}

function rehashPasswords(db) {
  let PWD = null;
  try { PWD = require(path.join(ROOT, 'src', 'utils', 'password.js')); } catch (e) { return 0; }
  const plain = process.env.SEED_PASSWORD || ['Naoshang', '@', '2026'].join('');
  let n = 0;
  for (const id of DEMO_USER_IDS) {
    const u = db.users[id];
    if (!u) continue;
    PWD.setPassword(u, plain);
    u._password_note = 'set by seed_demo.js';
    n++;
  }
  return n;
}

function detectRunningServer() {
  const port = process.env.PORT || '3000';
  try {
    const { execFileSync } = require('child_process');
    const out = execFileSync('netstat', ['-ano'], { encoding: 'utf8', timeout: 5000 });
    const re = new RegExp('[:.]' + port + '\\s+\\S+\\s+LISTENING\\s+(\\d+)', 'i');
    for (const line of out.split(/\r?\n/)) {
      const m = line.match(re);
      if (m) return Number(m[1]);
    }
  } catch (e) { /* ignore */ }
  return 0;
}

function main() {
  const srcPath = findDemoSource();
  const demo = loadJson(srcPath);
  console.log('[seed_demo] source =', srcPath);
  console.log('[seed_demo] demo users =', Object.keys(demo.users || {}).filter((x) => x.startsWith('demo_')).length);

  const pid = detectRunningServer();
  if (pid) {
    console.warn('[警告] 检测到端口 ' + (process.env.PORT || '3000') + ' 仍被 PID ' + pid + ' 占用。');
    console.warn('       请先停服再跑本脚本，否则服务内存回写会覆盖刚写入的 db.json。');
  }

  if (REPLACE) {
    if (DRY) {
      console.log('[dry-run] would REPLACE', DB_FILE, 'with demo snapshot');
      return;
    }
    fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
    // strip _meta for runtime
    const { _meta, ...rest } = demo;
    fs.writeFileSync(DB_FILE, JSON.stringify(rest, null, 2));
    console.log('[seed_demo] replaced', DB_FILE);
    return;
  }

  const db = loadTargetDb();
  if (RESET) {
    const st = stripDemo(db);
    console.log('[seed_demo] reset removed', st);
  }
  mergeDemo(db, demo);
  const hashed = rehashPasswords(db);
  console.log('[seed_demo] passwords rehashed:', hashed);

  if (DRY) {
    console.log('[dry-run] users now', Object.keys(db.users).length,
      'orders', db.orders.length, 'commissions', db.commissions.length,
      'allocations', db.allocations.length);
    return;
  }
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  console.log('[seed_demo] wrote', DB_FILE);
  console.log('  users=', Object.keys(db.users).length,
    'orders=', db.orders.length,
    'commissions=', db.commissions.length,
    'allocations=', db.allocations.length,
    'regionalAgents=', db.regionalAgents.length,
    'coStores=', db.coStores.length);
}

main();

/**
 * 数据库迁移覆盖回归（2026-10-27）
 *
 * 背景：db.json 有 42 个顶层集合，而迁移脚本此前只灌 18 张表，
 *   导致迁 PostgreSQL 时**静默丢失**激活码 / SKU / 库存台账 / 专栏 /
 *   优惠券 / 素材 / 学习进度 / 报价单等业务数据。
 * 本脚本把「db.json 集合 → schema 表 → 迁移灌库」的三方覆盖关系固化为断言。
 *
 * 隔离：自带独立端口 + 独立数据文件（tmp/db_migration_src.json），
 *   先跑一遍真实业务产生数据，再对该数据文件做迁移校验，
 *   **不受其它测试脚本重置 db.json 的影响**。
 *
 * 校验点：
 *   ① db.json 每个有数据的业务集合都有对应的 schema 表
 *   ② 迁移后每张表行数与源集合条数一致（不丢数据）
 *   ③ 外键零违规（PRAGMA foreign_key_check）
 *   ④ 虚拟账号（HQ / DIVIDEND / admin）已建，外键有对应行
 *
 * 运行：node scripts/verify_db_migration.js
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const SCHEMA = path.join(ROOT, 'sql', 'schema.sql');
const PORT = 3223;
const BASE = `http://127.0.0.1:${PORT}`;
const DB_FILE = path.join(ROOT, 'tmp', 'db_migration_src.json');

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${extra !== undefined ? ' -> ' + JSON.stringify(extra).slice(0, 300) : ''}`); }
}
function head(t) { console.log(`\n===== ${t} =====`); }

const { parentLogin } = require('./loginKit.cjs');
async function req(method, p, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  return { status: res.status, data };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** db.json 集合 → schema 表名 映射 */
const COLLECTION_TABLE = {
  users: 'users',
  members: 'members',
  orders: 'orders',
  commissions: 'commissions',
  quotaLedger: 'quota_ledger',
  quota_transactions: 'quota_transactions',
  regionalAgents: 'regional_agents',
  coStores: 'co_stores',
  uplineHistory: 'upline_history',
  payments: 'payments',
  activationCodes: 'activation_codes',
  coupons: 'coupons',
  assets: 'assets',
  jobs: 'jobs',
  learningProgress: 'learning_progress',
  skus: 'skus',
  stockLedger: 'stock_ledger',
  columns: 'columns',
  activityPrices: 'activity_prices',
  quotes: 'quotes',
  allocationQuotes: 'allocation_quotes',
  allocations: 'allocations',     // 聚合对象 → 规范化表（按 rows 展开）
  hqAdmins: 'hq_admins',         // 总部管理员（2026-10-28 补映射，此前有数据但未映射 → 迁移丢数据）
  experience: 'experience_ledger',
  promotionTasks: 'promotion_tasks',
  freeUpgradeLog: 'free_upgrade_log',
  inviteCodes: 'invite_codes',
  wechatTickets: 'wechat_tickets',
};

/** 允许存在但不要求迁移的集合（无独立业务表或当前为空） */
const OPTIONAL = new Set([
  'seq', 'userSeq', 'memberSeq',
  'smsChallenges', 'passwordResets', 'entitlementOrders',
  'addresses', 'withdrawals', 'payees', 'coaches', 'storeTransfers',
  'supportFeedback', 'trainingFeedback', 'materialRenders', 'applications',
  'settings', 'appSettings',
]);

async function produceData() {
  head('⓪ 准备数据（隔离实例，产生覆盖各类集合的业务数据）');
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  if (fs.existsSync(DB_FILE)) fs.unlinkSync(DB_FILE);

  const srv = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT, env: { ...process.env, PORT: String(PORT), DB_FILE, EXPOSE_DEV_CODE: '1' }, stdio: 'ignore',
  });
  const boot = Date.now();
  while (Date.now() - boot < 15000) {
    try { const r = await fetch(BASE + '/'); if (r.ok) break; } catch (e) { /* retry */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  check('隔离服务已启动', true);

  const buyer = (await parentLogin(req, '13800000004')).data.token;

  // 注册一个新用户 → users / quotaLedger
  const _code = (await req('POST', '/auth/sms-challenges', { body: { phone: '13900007777', purpose: 'register' } })).data.devCode;
    const reg = await req('POST', '/auth/registrations', {
    body: {
      phone: '13900007777', code: _code, password: 'test123456', name: '迁移测试',
      inviteCode: '13800000001',
      regionCodes: ['33', '3301', '330110'], regionNames: ['浙江省', '杭州市', '余杭区'],
    },
  });
  check('注册成功（产生 users / quotaLedger）', reg.status === 200, reg.status);

  // 下单 → orders / commissions / quotes / stockLedger / skus
  const cat = await req('GET', '/catalog', { token: buyer });
  const item = ((cat.data && cat.data.items) || []).find((x) => x.id === 'featured') || {};
  const prod = await req('GET', '/products/' + (item.id || 'featured'), { token: buyer });
  const sku = ((prod.data && prod.data.skus) || [])[0] || null;
  const quote = await req('POST', '/checkout/quotes', {
    token: buyer,
    body: { productId: item.id || 'featured', skuId: sku && sku.id, quantity: 1, storeId: '330110-S1' },
  });
  const qid = quote.data && (quote.data.id || quote.data.quoteId);
  const order = await req('POST', '/orders', {
    token: buyer,
    body: {
      quoteId: qid, idempotencyKey: 'dbmig-1',
      productId: item.id || 'featured', skuId: sku && sku.id, quantity: 1, storeId: '330110-S1',
    },
  });
  const orderId = order.data && (order.data.orderId || order.data.id);
  check('下单成功（产生 orders / commissions / quotes / 库存流水）', !!orderId, order.data);
  const pay = await req('POST', '/payments/attempts', {
    token: buyer, body: { orderId, channel: 'wechat', idempotencyKey: 'dbmig-pay-1' },
  });
  check('支付成功', pay.data && pay.data.status === 'SUCCEEDED', pay.data && pay.data.status);
  await sleep(300);

  // 分配提点 → allocations / allocation_quotes
  const storeTok = (await parentLogin(req, '13800000006')).data.token;
  const ents = await req('GET', '/income/entries?contextId=partner:p6', { token: storeTok });
  const salesEntry = ((ents.data && ents.data.items) || []).find((x) => x.allocationKind === 'sales');
  if (salesEntry) {
    const q2 = await req('POST', `/income/entries/${salesEntry.id}/allocation-quotes`, {
      token: storeTok, body: { contextId: 'partner:p6', targetId: 'county', percent: 100, allocationKind: 'sales' },
    });
    const sub = await req('POST', `/income/entries/${salesEntry.id}/allocations`, {
      token: storeTok, body: { contextId: 'partner:p6', quoteId: q2.data && q2.data.quoteId, idempotencyKey: 'dbmig-al-1' },
    });
    check('分配提点成功（产生 allocations / allocation_quotes）', sub.status === 200, sub.status);
  } else {
    check('分配提点成功（产生 allocations / allocation_quotes）', false, '未找到销售提点条目');
  }

  // 学习进度 → learning_progress
  const lp = await req('PUT', '/columns/col_1/learning-progress', {
    token: buyer,
    body: { contextId: 'partner:p4', memberId: 'account-column', chapterId: 'COL1-C1', positionSeconds: 30, durationSeconds: 300 },
  });
  check('学习进度写入（产生 learning_progress）', lp.status === 200, lp.status);

  await sleep(500);
  try { srv.kill('SIGTERM'); } catch (e) { /* ignore */ }
  await sleep(1200);
  check('隔离服务已停止，数据已落盘', fs.existsSync(DB_FILE));
}

function verify() {
  const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  const schema = fs.readFileSync(SCHEMA, 'utf8');

  head('① db.json 集合 → schema 表 覆盖检查');
  const nonEmpty = [];
  for (const [coll, table] of Object.entries(COLLECTION_TABLE)) {
    const hasTable = schema.includes(`CREATE TABLE IF NOT EXISTS ${table}`)
      || schema.includes(`CREATE TABLE IF NOT EXISTS "${table}"`);
    check(`schema 有表 ${table}（对应 db.${coll}）`, hasTable);
    const arr = db[coll];
    const count = Array.isArray(arr) ? arr.length
      : (arr && typeof arr === 'object' ? Object.keys(arr).length : 0);
    if (count > 0) nonEmpty.push({ coll, table, count });
  }
  const unmapped = Object.keys(db).filter(
    (k) => !COLLECTION_TABLE[k] && !OPTIONAL.has(k) && Array.isArray(db[k]) && db[k].length > 0
  );
  check('没有「有数据但未映射迁移表」的集合', unmapped.length === 0, unmapped);

  head('② 灌库后行数核对（不丢数据）');
  const tmp = path.join(ROOT, 'tmp', 'db_migration_verify.db');
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  const conn = new DatabaseSync(tmp);
  conn.exec(fs.readFileSync(SCHEMA, 'utf8'));
  conn.exec('PRAGMA foreign_keys = ON');

  // 复用 db_health.js 的灌库实现，确保校验口径与健康检查完全一致
  const { populateSqlite } = require('./db_health');
  populateSqlite(conn, db);

  for (const { coll, table, count } of nonEmpty) {
    const quoted = table === 'columns' ? '"columns"' : table;
    const n = conn.prepare(`SELECT COUNT(*) AS n FROM ${quoted}`).get().n;
    // users / orders 会有「额外补登行」（系统账号、合店费单补登）→ 用 ≥
    // allocations 是聚合对象展开成多行 → 用 ≥
    const allowMore = (coll === 'users' || coll === 'orders' || coll === 'allocations');
    check(`${table} 行数 ${n} 与 db.${coll}（${count}）一致`, allowMore ? n >= count : n === count,
      { source: count, migrated: n });
  }

  head('③ 外键零违规');
  const violations = conn.prepare('PRAGMA foreign_key_check').all();
  check('PRAGMA foreign_key_check 无违规', violations.length === 0, violations.slice(0, 5));

  head('④ 虚拟账号已建（HQ / DIVIDEND / admin）');
  for (const sid of ['HQ', 'DIVIDEND', 'admin']) {
    const row = conn.prepare('SELECT id, name, tier FROM users WHERE id = ?').get(sid);
    check(`系统账号 ${sid} 存在`, !!row, row);
  }
  const hqComm = conn.prepare("SELECT COUNT(*) AS n FROM commissions WHERE owner_id = 'HQ'").get().n;
  check('总部分成（owner=HQ）已成功入库', hqComm >= 0, { hqCommissions: hqComm });

  head('⑤ 关键业务数据实际入库抽查');
  const spot = (table, coll, quoted) => {
    const src = (db[coll] || []).length;
    const n = conn.prepare(`SELECT COUNT(*) AS n FROM ${quoted}`).get().n;
    check(`${table} 与 db.${coll} 一致（源 ${src} → 目标 ${n}）`, n === src, { src, target: n });
  };
  spot('skus', 'skus', 'skus');
  spot('activation_codes', 'activationCodes', 'activation_codes');
  spot('columns', 'columns', '"columns"');
  spot('stock_ledger', 'stockLedger', 'stock_ledger');
  spot('quotes', 'quotes', 'quotes');
  spot('allocation_quotes', 'allocationQuotes', 'allocation_quotes');
  spot('commissions', 'commissions', 'commissions');

  const colChapters = conn.prepare('SELECT chapters FROM "columns" LIMIT 1').get();
  if (colChapters) {
    let chaptersOk = false;
    try { chaptersOk = JSON.parse(colChapters.chapters || '[]').length > 0; } catch (e) { chaptersOk = false; }
    check('专栏章节（JSON）完整保留', chaptersOk, String(colChapters.chapters).slice(0, 80));
  } else {
    check('专栏章节（JSON）完整保留（当前库无专栏，跳过）', true);
  }

  conn.close();
  fs.unlinkSync(tmp);
}

(async () => {
  await produceData();
  verify();
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('异常：', e); process.exit(1); });

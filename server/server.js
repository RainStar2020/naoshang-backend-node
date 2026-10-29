/**
 * 脑商AI合伙人 · 后端 API 服务（纯 Node 内置模块，无外部依赖）
 *
 * 职责：
 *   1. 纯 REST API 服务：契约接口层（routes/h5.js + routes/h5biz.js，RESTful）
 *      + 管理/计算接口（/api/*，算薪结算引擎与总部后台）
 *   2. 内存数据层(store.js) + JSON 持久化(data/db.json)，重启不丢数据
 *   3. 全部金额/名额计算复用 commission.js / settlement.js / regionAgent.js 纯函数
 *
 * 启动：node server.js   （端口 3000，可用 PORT 环境变量覆盖）
 * 说明：本服务不托管前端静态资源（前端独立部署）；GET / 返回服务信息。
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const API_STANDARD = require('./src/common/api-standard');
const MONEY_SHADOW = require('./src/common/api-standard/money-shadow');

const S = require('./src/store');
const IZ = require('./src/identity');
const R = require('./src/routes');
const C = require('./src/commission');
const SET = require('./src/settlement');
const RA = require('./src/regionAgent');
const PS = require('./src/productSplit');
const Q = require('./src/quotaLedger');
const H = require('./src/routes/h5');
const HQ = require('./src/routes/hq');   // 总部后台（HQ）接口层：/api/hq/*
const OL = require('./src/orderLifecycle');   // P0-5 支付超时 / P0-6 线下核销
const ALC = require('./src/allocation');       // P0-9 分配意愿自选
const DIV = require('./src/dividendGate');     // P0-7 分红业绩门槛（可配）
const EXP = require('./src/experience');       // P0-1 经验值 / P0-2 晋升任务
const PWD = require('./src/utils/password');  // P2-4 密码哈希
const PORTINFO = require('./src/utils/portInfo'); // 端口归属诊断（分清"自己占用"还是"别人占用"）
const PAY = require('./src/payment');        // P2-3 支付模式（sandbox/live）
const DBL = require('./src/dbLayer');        // P2-5 数据访问抽象层（memory / pg）
const STK = require('./src/stock');         // SKU 库存台账（2026-10-27）
const SESSION_STORE = require('./src/utils/session-store'); // 会话持久化（重启不掉线，2026-10-28）

// PORT / DB_FILE 会在「启动前预检」里被重新赋值（端口自动避让 + 数据隔离），故用 let
let PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin888';
const DATA_DIR = path.join(__dirname, 'data');
// DB_FILE 可用环境变量覆盖（默认不变）：测试用独立数据文件做隔离验证，避免污染真实库
let DB_FILE = process.env.DB_FILE ? path.resolve(process.env.DB_FILE) : path.join(DATA_DIR, 'db.json');

/** 收益类型中文名（前后端共用，供逐笔明细展示） */
const T_CN = {
  supply: '供应差价', direct: '直推奖', rebuy: '复购奖', parity: '平级奖',
  global: '全球奖', founding: '创始奖', agent: '区域代理', costore: '合店费',
  region_vip: '区域奖', region_goods_diff: '商品级差', region_signing: '直推代理奖',
  region_admin_delivery: '行政费', region_costore: '合店提成', region_vip_partner: 'VIP合伙人奖',
  product: '产品分润',
};
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * 种子账号统一口令（2026-10-28）
 *
 * 背景：parent 登录已改为「手机号 + 密码」（不再免密发 token），
 *   但 DEFAULT_SEED 的 p1~p7 没有 password 字段 → 种子账号全部无法登录，
 *   连带 12 个使用 scripts/loginKit.cjs 的 verify 脚本全部失败。
 *
 * 方案：播种时给每个种子用户写入同一口令的 scrypt 哈希，
 *   并让 loginKit.cjs 用同一口令登录（两处共用本常量，避免再次漂移）。
 * ⚠️ 仅测试/开发环境使用；生产环境应由真实注册流程设置各自口令。
 */
const SEED_USER_PASSWORD = process.env.SEED_USER_PASSWORD || 'Naoshang@2026';

// ───────────── 默认种子数据（可直接在 H5 后台编辑/重载） ─────────────
// 场景：p1 联创(持创始奖·省代33/市代3301兼任) → p2 私董 → p3 天使 → p4 VIP
//        p5 私董(区县代 330110，父级 3301) → p6 天使(单店/门店老板 330110-S1，父级 330110)
//        p7 天使(合店老板) 开合店
const DEFAULT_SEED = {
  users: [
    { id: 'p1', name: '总部联创-甲', phone: '13800000001', tier: 'cofounder', principal_tier: 'cofounder', is_founding: true, upline_id: null, quota: 500 },
    { id: 'p2', name: '私董-乙', phone: '13800000002', tier: 'private', principal_tier: 'private', referral_upline_tier: 'cofounder', is_founding: false, upline_id: 'p1', quota: 200 },
    { id: 'p3', name: '天使-丙', phone: '13800000003', tier: 'angel', principal_tier: 'angel', referral_upline_tier: 'private', is_founding: false, upline_id: 'p2', quota: 100, activityQuota: 4 },
    { id: 'p4', name: 'VIP-丁', phone: '13800000004', tier: 'vip', principal_tier: 'vip', referral_upline_tier: 'angel', is_founding: false, upline_id: 'p3', quota: 50 },
    { id: 'p5', name: '区县代-戊(私董)', phone: '13800000005', tier: 'private', principal_tier: 'private', referral_upline_tier: 'cofounder', is_founding: false, upline_id: 'p1', quota: 200 },
    { id: 'p6', name: '门店老板-己(天使/单店)', phone: '13800000006', tier: 'angel', principal_tier: 'angel', referral_upline_tier: 'private', is_founding: false, upline_id: 'p5', quota: 100 },
    { id: 'p7', name: '合店老板-庚(天使)', phone: '13800000007', tier: 'angel', principal_tier: 'angel', referral_upline_tier: 'angel', is_founding: false, upline_id: 'p3', quota: 100 },
  ],
  orders: [
    { buyer_id: 'p4', packageTier: 'vip', oldTier: 'vip', quotaCount: 1, regionCode: '330110', buyerIsNew: false },
    { buyer_id: 'p6', packageTier: 'angel', oldTier: 'angel', quotaCount: 3, regionCode: '330110', buyerIsNew: false },
    { buyer_id: 'p7', packageTier: 'angel', oldTier: 'angel', quotaCount: 2, regionCode: '330110', buyerIsNew: false },
  ],
  agents: [
    { partner_id: 'p1', region_type: 'province', region_code: '33' },
    { partner_id: 'p1', region_type: 'city', region_code: '3301', parent_code: '33' },
    { partner_id: 'p5', region_type: 'district', region_code: '330110', parent_code: '3301' },
    { partner_id: 'p6', region_type: 'store', region_code: '330110-S1', parent_code: '330110' },
  ],
  costores: [
    // 合店老板 p7（天使）入股；门店店长=门店股东 p6（天使/单店）；推荐人 p6（非合店老板）
    // → 场景 C：门店老板 53%（40%服务+13%）+ 上级 p3 拿 2% 复购奖；分红池 10% 单店分给 p7
    { owner_id: 'p7', promoter_id: 'p6', storeManagerId: 'p6', store_id: '330110-S1',
      monthly_fee: 698, ownerCount: 1, joinDate: '2026-10', owners: [{ id: 'p7', performance: 500 }] },
  ],
};

// ───────────── DB 初始化 / 持久化 ─────────────
let db = S.createDb();

/**
 * P2-5 · 数据访问抽象层
 *   DB_KIND=memory（默认）→ memoryAdapter，委托 store.js，行为与既往完全一致
 *   DB_KIND=pg + DATABASE_URL → pgAdapter（需安装 pg 并连上真实库）
 * repository 是「未来把业务层切到异步仓储」的接入点；当前业务层仍直连内存 db，
 * 故 pg 模式下启动会给出明确告警（避免"以为切了库、其实还在写内存"的误判）。
 */
const DB_KIND = String(process.env.DB_KIND || 'memory').toLowerCase();
let repository = null;
let pgPool = null;
if (DB_KIND === 'pg') {
  try {
    const { Pool } = require('pg');
    pgPool = new Pool({ connectionString: process.env.DATABASE_URL });
    repository = DBL.createRepository({ pool: pgPool });
    console.log('[DB] DB_KIND=pg —— 已创建 PostgreSQL 仓储适配器');
  } catch (e) {
    console.error('[DB][FATAL] DB_KIND=pg 但无法初始化 pg 连接池：' + e.message);
    console.error('       请先 `npm i pg` 并确认 DATABASE_URL 正确；或改回 DB_KIND=memory。');
    process.exit(1);
  }
} else {
  repository = DBL.createRepository({ db });
}
/**
 * 会话存储（2026-10-28）
 *
 * 改造前是纯内存对象 `const sessions = {}`：**API 进程一重启，全部登录态立刻作废**。
 * 小程序侧表现为 GET /me 返回 401 → 前端 logout() 清本地 session 并跳登录页，
 * 表现为"莫名其妙被踢下线"。
 *
 * 现在会话落盘到独立文件 data/sessions.json（AES-256-GCM 加密），启动时载入内存。
 * 之所以**不进 db.json**：db.json 是业务真源且会被同步器单向镜像到 MySQL，
 * 会话 token 属凭证，绝不能进入业务库与 MySQL 镜像。
 *
 * 落地为 Proxy，对外接口与原对象完全一致（sessions[token] 读写 / delete 均照旧），
 * 业务代码零改动；过期会话在读取时自动失效（HQ 原本签发了 expiresAt 却从不校验）。
 */
const sessionStore = SESSION_STORE.createSessionStore({
  // 随 db 实例隔离：db.json → sessions.json；db.debug-3000.json → sessions.debug-3000.json
  resolveFile: () => {
    const base = path.basename(DB_FILE, '.json');
    const suffix = base === 'db' ? '' : '.' + base.replace(/^db[-_.]?/, '');
    return path.join(DATA_DIR, `sessions${suffix}.json`);
  },
  defaultTtlMs: 30 * 24 * 60 * 60 * 1000, // C 端会话默认 30 天
});
const sessions = sessionStore.sessions; // token -> { role, userId }

/** 全量快照持久化：db 上所有数据集合（含 h5biz 业务集合）一并落盘，新增集合无需改此处 */
function saveDb() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const snap = {};
    for (const k of Object.keys(db)) {
      const v = db[k];
      if (v && typeof v === 'object') snap[k] = v;
    }
    // 计数器为数字，需显式携带（否则重启后编号从头再来）
    snap.seq = db.seq;
    snap.userSeq = db.userSeq;
    snap.memberSeq = db.memberSeq;
    fs.writeFileSync(DB_FILE, JSON.stringify(snap, null, 2));
  } catch (e) { console.error('saveDb err', e.message); }
}

function loadDb() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const snap = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      Object.assign(db, S.createDb(), snap);
      if (migrateIdentities(db)) saveDb(); // 存量数据补编号/权益字段（2026-10-24）
      if (migratePasswords(db)) saveDb(); // 存量明文密码 → scrypt 哈希（P2-4，2026-10-26）
      if (initBizDefaults(db)) saveDb(); // 业务基础数据（SKU/专栏/激活码）固化落库
      console.log('[DB] 已从', DB_FILE, '恢复数据');
      return;
    }
  } catch (e) { console.error('loadDb err', e.message); }
  loadSeed(DEFAULT_SEED);
  if (initBizDefaults(db)) saveDb();
  saveDb();
}

/**
 * 业务基础数据初始化（2026-10-27）
 *
 * 背景：SKU 目录、专栏、激活码此前只在「个人中心等业务路由」被访问时才懒初始化，
 *   导致：① 真机首开商城时商品没有规格可选；② 专栏/激活码不落 db.json，
 *   迁移 PostgreSQL 时会丢失。现在统一在**启动时**固化一次。
 *   · SKU：只补缺失规格，不覆盖业务改过的库存与单价
 *   · 专栏：集合为空时用 src/columns.js 的默认专栏填充
 *   · 激活码：集合为空时用内置种子填充
 * 返回是否有变更（决定是否需要 saveDb）。
 */
function initBizDefaults(db) {
  let changed = false;
  try {
    const CAT = require('./src/catalogDisplay');
    const COLS = require('./src/columns');
    const DAY = 24 * 60 * 60 * 1000;

    // SKU 目录
    if (!Array.isArray(db.skus)) { db.skus = []; changed = true; }
    const before = db.skus.length;
    CAT.ensureSkuRecords(db);
    if (db.skus.length !== before) changed = true;

    // 专栏（业务可编辑；集合为空时回落默认专栏）
    if (!Array.isArray(db.columns)) { db.columns = []; changed = true; }
    if (db.columns.length === 0) {
      db.columns = JSON.parse(JSON.stringify(COLS.DEFAULT_COLUMNS));
      MONEY_SHADOW.writeBatch('columns', db.columns);
      changed = true;
    }

    // 激活码种子（与 h5biz.ensure 同一份，避免两处漂移）
    if (!Array.isArray(db.activationCodes)) { db.activationCodes = []; changed = true; }
    if (db.activationCodes.length === 0) {
      const exp = Date.now() + 90 * DAY;
      db.activationCodes.push(
        { code: 'NS-FS-0001', targetType: 'fs', targetId: null, maxUses: 1, uses: 0, status: 'active', expiresAt: exp },
        { code: 'NS-FS-0006', targetType: 'fs', targetId: null, maxUses: 1, uses: 0, status: 'active', expiresAt: exp },
        { code: 'NS-JY-0002', targetType: 'jy', targetId: null, maxUses: 1, uses: 0, status: 'active', expiresAt: exp },
        { code: 'NS-CJ-0003', targetType: 'cj', targetId: null, maxUses: 1, uses: 0, status: 'active', expiresAt: exp },
        { code: 'NS-XN-0004', targetType: 'xn', targetId: null, maxUses: 1, uses: 0, status: 'active', expiresAt: exp },
        { code: 'NS-YS-0005', targetType: 'ys', targetId: null, maxUses: 1, uses: 0, status: 'active', expiresAt: exp },
        { code: 'NS-L1-0001', targetType: 'level', targetId: 'L1', maxUses: 1, uses: 0, status: 'active', expiresAt: exp },
        { code: 'NS-L2-0002', targetType: 'level', targetId: 'L2', maxUses: 1, uses: 0, status: 'active', expiresAt: exp },
        { code: 'NS-COL-0001', targetType: 'column', targetId: 'col_1', maxUses: 1, uses: 0, status: 'active', expiresAt: exp },
      );
      changed = true;
    }

    // ── 总部后台（HQ）集合与管理员 ──
    // 需求文档标注「当前库无对应表 / 落地待定」的模块，先落在独立 hq* 集合中，
    // 接口可真实跑通；需要进 MySQL 时按 docs/后台API.md 附录 D 补表 + 补同步映射。
    const HQMOD = require('./src/routes/hq/modules/auth');
    const HQLIB = require('./src/routes/hq/lib');
    if (HQLIB.ensureCollections(db)) changed = true;
    const adminsBefore = (db.hqAdmins || []).length;
    HQMOD.ensureAdmins(db);
    if ((db.hqAdmins || []).length !== adminsBefore) changed = true;
  } catch (e) {
    console.error('[DB] 业务基础数据初始化失败：', e.message);
  }
  return changed;
}

/**
 * 明文密码迁移（P2-4 · 2026-10-26）：把 users[*].password 中的明文就地升级为
 * scrypt 哈希。已哈希的跳过；无密码的跳过。返回是否有变更。
 */
function migratePasswords(db) {
  let changed = false;
  for (const id of Object.keys(db.users || {})) {
    const u = db.users[id];
    if (!u || typeof u.password !== 'string' || !u.password) continue;
    if (PWD.isHashed(u.password)) continue;
    try {
      PWD.setPassword(u, u.password);
      changed = true;
    } catch (e) { /* 忽略异常，保持原值 */ }
  }
  if (changed) console.log('[DB] 已把存量明文密码升级为 scrypt 哈希');
  return changed;
}

/**
 * 身份编号迁移（2026-10-24）：为存量用户补 seq（按插入序）、entitlement_state（默认 active）、display_id。
 * 内部 uid 一律不变，仅新增对外展示字段。返回是否有变更。
 */
function migrateIdentities(db) {
  let changed = false;
  for (const id of Object.keys(db.users || {})) {
    const u = db.users[id];
    if (u.seq == null) { IZ.assignSeq(db, id); changed = true; }
    if (u.entitlement_state == null) { u.entitlement_state = 'active'; changed = true; }
    const did = IZ.recomputeDisplayId(db, id);
    if (u.display_id !== did) changed = true;
  }
  // 存量孩子补编号字段（2026-10-24 会员等级体系）：按添加顺序补 memberSeq，等级缺省普通会员
  if (Array.isArray(db.members)) {
    const ordered = db.members.slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    for (const m of ordered) {
      if (m.memberLevel == null) { m.memberLevel = 'normal'; changed = true; }
      if (m.memberSeq == null) { IZ.assignMemberSeq(db, m.id); changed = true; }
      const did = IZ.recomputeMemberDisplayId(db, m.id);
      if (m.display_id !== did) changed = true;
    }
  }
  return changed;
}

// 载入种子（重置全部数据后按 seed 重建）
function loadSeed(seed) {
  db.users = {}; db.orders = []; db.commissions = []; db.quotaLedger = {}; db.quota_transactions = [];
  db.regionalAgents = []; db.coStores = []; db.uplineHistory = []; db.seq = 1; db.userSeq = 1; db.memberSeq = 1; db.lastSettlement = null;
  db.payments = []; // 支付单随种子重置清空
  db.inviteCodes = []; // P1-8 两套邀请码流水随种子重置清空
  db.wechatTickets = []; // P2-2 微信登录票据随种子重置清空
  db.experience = [];      // P0-1 经验值流水随种子重置清空
  db.promotionTasks = [];  // P0-2 晋升任务随种子重置清空
  db.freeUpgradeLog = [];  // 拉人免费升档触发日志随种子重置清空
  db.allocations = [];     // P0-9 分配意愿记录随种子重置清空
  if (typeof H.resetBiz === 'function') H.resetBiz(db); // 清空业务集合（地址/会员/提现/上传等）

  for (const u of (seed.users || [])) {
    const seedPwdHash = PWD.hashPassword(SEED_USER_PASSWORD);
    S.addUser(db, {
      id: u.id, name: u.name, phone: u.phone, tier: u.tier,
      password: seedPwdHash,                    // 种子账号统一口令（2026-10-28，配合 SEED_USER_PASSWORD）
      principal_tier: u.principal_tier || u.tier,           // 本金档：种子用户按其档位（2026-10-26）
      referral_upline_tier: u.referral_upline_tier || null,  // 推荐快照：被推荐时上级档位
      referral_tier: u.referral_tier || null,
      free_upgrade_applied: u.free_upgrade_applied || 0,
      upline_id: u.upline_id || null,
      is_founding: u.is_founding ? 'founding' : 'none',
      teamVip: u.teamVip || 0,
      annual_fee_paid: u.annual_fee_paid !== false,
    });
    // P0-3：种子名额拆标准/活动两桶（seed 可用 activityQuota 配活动名额）
    const qe = Q.normalize(db.quotaLedger, u.id);
    qe.standard = Number(u.quota) || 0;
    if (u.activityQuota) {
      Q.issueQuota(db.quotaLedger, u.id, Number(u.activityQuota), 'activity', { tx: db.quota_transactions, ref: 'seed' });
    }
  }
  for (const o of (seed.orders || [])) {
    try {
      R.createOrder(db, {
        buyerId: o.buyerId || o.buyer_id,
        packageTier: o.packageTier,
        oldTier: o.oldTier,
        rawQuota: o.rawQuota != null ? o.rawQuota : o.quotaCount,
        regionCode: o.regionCode,
        buyerIsNew: o.buyerIsNew !== false,
      });
    } catch (e) { console.error('[seed] order fail', o, e.message); }
  }
  for (const a of (seed.agents || [])) {
    try { S.appointAgent(db, { partnerId: a.partner_id, regionType: a.region_type, regionCode: a.region_code }); }
    catch (e) { console.error('[seed] agent fail', a, e.message); }
  }
  for (const cs of (seed.costores || [])) {
    try { S.addCoStore(db, cs); } catch (e) { console.error('[seed] costore fail', cs, e.message); }
  }
  // 业务基础数据（SKU 目录 / 专栏 / 激活码）随种子一起重置后必须补回，
  // 否则总部点「恢复默认种子」会让商城没有规格、专栏与激活码消失（2026-10-27）。
  initBizDefaults(db);
  return db;
}

// ───────────── HTTP 工具 ─────────────
function sendJSON(res, code, obj) {
  const adapted = API_STANDARD.adapt(code, API_STANDARD.prepareWire(obj));
  code = adapted.httpStatus;
  obj = adapted.body;
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', ...API_STANDARD.corsHeaders() });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => {
      if (!d) return resolve({});
      try { resolve(API_STANDARD.parseJson(d, req)); } catch (e) { reject(new Error('请求体不是合法 JSON')); }
    });
    req.on('error', reject);
  });
}
function getSession(req, url) {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : (url.searchParams.get('token') || '');
  return sessions[token] || null;
}
function currentUserId(req, url, sess) {
  const q = url.searchParams.get('userId');
  if (sess && sess.role === 'admin' && q) return q;
  if (sess && sess.role === 'user') return sess.userId;
  return q || null;
}

// ───────────── API 路由表 ─────────────
async function handleApi(req, res, url) {
  const p = url.pathname;
  const m = req.method;
  const sess = getSession(req, url);

  // 登录（无需鉴权）
  if (p === '/api/auth/login' && m === 'POST') {
    const b = await readBody(req);
    if (b.role === 'admin') {
      if (b.password !== ADMIN_PASSWORD) return sendJSON(res, 401, { error: '管理员密码错误' });
      const token = 'admin-' + Math.random().toString(36).slice(2);
      sessions[token] = { role: 'admin' };
      return sendJSON(res, 200, { token, role: 'admin', name: '总部/后台' });
    }
    if (b.role === 'user') {
      const u = S.getUserByPhone(db, b.phone);
      if (!u) return sendJSON(res, 404, { error: '未找到该手机号对应的合伙人' });
      const token = 'user-' + Math.random().toString(36).slice(2);
      sessions[token] = { role: 'user', userId: u.id };
      return sendJSON(res, 200, { token, role: 'user', userId: u.id, tier: u.tier, name: u.name });
    }
    return sendJSON(res, 400, { error: 'role 必须是 admin 或 user' });
  }

  // 计算器（纯算法验证，无需鉴权）—— 直接跑 regionAgent 等纯函数
  if (p === '/api/calc/region-vip' && m === 'POST') {
    const b = await readBody(req);
    return sendJSON(res, 200, RA.regionVipBonus(b.regionType, b.vipCount || 1));
  }
  if (p === '/api/calc/goods-diff' && m === 'POST') {
    const b = await readBody(req);
    return sendJSON(res, 200, RA.goodsTierDiff(b.kind || 'physical', b.sellerLevel, b.buyerLevel, b.qty || 1, b.salePrice || 1000));
  }
  if (p === '/api/calc/store-delivery' && m === 'POST') {
    const b = await readBody(req);
    return sendJSON(res, 200, RA.storeDeliveryAllocation(b.discountAmount, b.ownerCount || 1, b.opts || {}));
  }
  if (p === '/api/calc/region' && m === 'POST') {
    const b = await readBody(req);
    return sendJSON(res, 200, RA.monthlyRegionAgent(b));
  }
  // 门店二维码内容生成（展示层，公开，无需登录）：顾客扫码 → 前端解析 store_code → 下单携带 storeCode
  if (p === '/api/agent/qrcode' && m === 'GET') {
    const code = url.searchParams.get('code') || '';
    return sendJSON(res, 200, {
      store_code: code,
      qrContent: `https://<域名>/s?c=${code}`,
      scanFlow: '顾客扫码 → 前端解析 store_code → 带入下单参数 storeCode → 结算按父链 门店→区县→市→省 归集',
      note: '域名请替换为实际部署域名；二维码图片可据此文本用任意二维码库生成',
    });
  }
  if (p === '/api/calc/virtual-split' && m === 'POST') {
    const b = await readBody(req);
    return sendJSON(res, 200, RA.virtualDeliverySplit(b.paidAmount || 0, b.deliveryType || 'store'));
  }
  if (p === '/api/calc/physical-diff' && m === 'POST') {
    const b = await readBody(req);
    return sendJSON(res, 200, RA.physicalTierDiff(b.sellerLevel, b.buyerLevel, b.qty || 1, b.basePrice || 6980));
  }
  if (p === '/api/calc/agent-fee' && m === 'GET') {
    const cityTier = Number(url.searchParams.get('cityTier') || 1);
    return sendJSON(res, 200, {
      share: RA.AGENT_SHARE,
      thresholdFee: {
        province: RA.agentThresholdFee('province'),
        city: RA.agentThresholdFee('city', cityTier),
        district: RA.agentThresholdFee('district'),
        store: RA.agentThresholdFee('store'),
      },
      tier: RA.AGENT_TIER,
      // 2026-10-23 新价格表（图1，按人数分档）+ 技术费口径
      priceTable: RA.AGENT_PRICE_TABLE,
      partnerDirectRatio: RA.PARTNER_DIRECT_RATIO,
    });
  }
  // ── 产品域计算（2026-10-23 新规格：productSplit.js） ──
  if (p === '/api/products' && m === 'GET') {
    // 商城系统预留：带 userId（或登录态）时返回该买家维度报价——
    // 代理折扣与合伙人折扣两套表分开，成交档位按 resolveBuyerLevel 单一入口解析
    const qUser = url.searchParams.get('userId') || (sess && sess.role === 'user' ? sess.userId : null);
    const resp = {
      catalog: PS.PRODUCT_CATALOG,
      kind: PS.PRODUCT_KIND,
      featuredSplitRows: PS.FEATURED_SPLIT_ROWS,
      partnerProductRate: PS.PARTNER_PRODUCT_RATE,
      productCommissionMode: PS.PRODUCT_COMMISSION_MODE,
      discounts: { partner: RA.PARTNER_DISCOUNT, agent: RA.AGENT_DISCOUNT },
    };
    if (qUser) {
      const buyer = db.users[qUser];
      const agentRec = db.regionalAgents.find((a) => a.partner_id === qUser) || null;
      if (buyer) {
        const bp = PS.buyerProductPrices(buyer, agentRec, 1);
        resp.buyer = {
          id: buyer.id, name: buyer.name, tier: buyer.tier,
          agent_region_type: agentRec ? agentRec.region_type : null,
          level: bp.level, discount_kind: bp.discountKind,
          partner_level: bp.partnerLevel, agent_level: bp.agentLevel,
        };
        resp.prices = bp.prices;
      }
    }
    return sendJSON(res, 200, resp);
  }
  if (p === '/api/calc/product-price' && m === 'POST') {
    const b = await readBody(req);
    return sendJSON(res, 200, PS.productPrice(b.key, b.level || 'list', b.qty || 1));
  }
  if (p === '/api/calc/product-commission' && m === 'POST') {
    const b = await readBody(req);
    return sendJSON(res, 200, PS.partnerProductCommission({ paid: b.paid || 0, uplineTier: b.uplineTier, mode: b.mode }));
  }
  if (p === '/api/calc/featured-split' && m === 'POST') {
    const b = await readBody(req);
    return sendJSON(res, 200, PS.featuredSplit(b.paid || 0, {
      fixedCost: b.fixedCost || 0, deliveryType: b.deliveryType || 'store', inspectionAssignee: b.inspectionAssignee || null,
    }));
  }

  // 以下接口需要登录
  if (!sess) return sendJSON(res, 401, { error: '未登录或 token 失效' });

  // ───── 管理员（总部/后台） ─────
  if (sess.role === 'admin') {
    if (p === '/api/seed' && m === 'GET') {
      // 导出当前数据（便于编辑后再 POST 回来）
      return sendJSON(res, 200, {
        users: Object.values(db.users).map((u) => ({ id: u.id, name: u.name, phone: u.phone, tier: u.tier, is_founding: u.is_founding === 'founding', upline_id: u.upline_id, quota: Q.getStandard(db.quotaLedger, u.id), quotaStandard: Q.getStandard(db.quotaLedger, u.id), quotaActivity: Q.getActivity(db.quotaLedger, u.id) })),
        orders: db.orders.filter((o) => o.packageTier).map((o) => ({ buyer_id: o.buyer_id, packageTier: o.packageTier, oldTier: o.oldTier, quotaCount: o.quotaCount, regionCode: o.regionCode, buyerIsNew: false })),
        agents: db.regionalAgents.map((a) => ({ partner_id: a.partner_id, region_type: a.region_type, region_code: a.region_code })),
        costores: db.coStores,
      });
    }
    if (p === '/api/seed' && m === 'POST') {
      const b = await readBody(req);
      loadSeed(b); saveDb();
      return sendJSON(res, 200, { ok: true, message: '种子数据已载入并重置', users: Object.keys(db.users).length });
    }
    if (p === '/api/seed/reset' && m === 'POST') {
      loadSeed(DEFAULT_SEED); saveDb();
      return sendJSON(res, 200, { ok: true, message: '已恢复默认示例种子' });
    }
    if (p === '/api/partner' && m === 'POST') {
      const b = await readBody(req);
      const u = S.addUser(db, { id: b.id || undefined, name: b.name, phone: b.phone, tier: b.tier, upline_id: b.upline_id || null, is_founding: b.is_founding ? 'founding' : 'none', teamVip: b.teamVip || 0 });
      const e = Q.normalize(db.quotaLedger, u.id);
      e.standard = Number(b.quota) || 0;
      saveDb();
      return sendJSON(res, 200, { ok: true, user: u, quota: e.standard, quotaStandard: e.standard, quotaActivity: Q.getActivity(db.quotaLedger, u.id) });
    }
    if (p === '/api/order' && m === 'POST') {
      const b = await readBody(req);
      const r = R.createOrder(db, b); saveDb();
      return sendJSON(res, 200, { ok: true, ...r });
    }
    if (p === '/api/order/product' && m === 'POST') {
      // 产品购买（后台代下单，2026-10-23 新规格）：与用户端同逻辑；
      // buyerId 取请求体或 ?userId= 覆盖；行政费金额走 body.amount
      const b = await readBody(req);
      const buyerId = b.buyerId || url.searchParams.get('userId');
      if (!buyerId) return sendJSON(res, 400, { error: '缺少买家 userId' });
      try {
        const r = R.createProductOrder(db, { ...b, buyerId });
        saveDb();
        return sendJSON(res, 200, { ok: true, ...r });
      } catch (e) { return sendJSON(res, 400, { error: e.message }); }
    }
    if (p === '/api/agent/appoint' && m === 'POST') {
      const b = await readBody(req);
      try {
        const r = S.appointAgent(db, b); saveDb();
        return sendJSON(res, 200, { ok: true, ...r });
      } catch (e) {
        return sendJSON(res, 400, { ok: false, error: e.message });
      }
    }
    // 撤销代理（2026-10-24 拍板）：摘除代理身份；用户编号 seq 不变、前缀改 QZ（普通用户）；已赠档位保留
    if (p === '/api/agent/revoke' && m === 'POST') {
      const b = await readBody(req);
      try {
        const r = S.revokeAgent(db, b); saveDb();
        return sendJSON(res, 200, { ok: true, ...r });
      } catch (e) {
        return sendJSON(res, 400, { ok: false, error: e.message });
      }
    }
    // 编辑代理（区域码层级化：可改 parent_code 父链 / region_code 层级码）
    if (p === '/api/agent/update' && m === 'POST') {
      const b = await readBody(req);
      try {
        const r = S.updateAgent(db, b.partnerId, b.patch || b); saveDb();
        return sendJSON(res, 200, { ok: true, agent: r });
      } catch (e) {
        return sendJSON(res, 400, { ok: false, error: e.message });
      }
    }
    if (p === '/api/costore' && m === 'POST') {
      const b = await readBody(req);
      try {
        const r = S.addCoStore(db, b); saveDb();
        return sendJSON(res, 200, { ok: true, costore: r });
      } catch (e) { return sendJSON(res, 400, { error: e.message }); }
    }
    // 后台可调配置（合店费月费 / 最少月数 / 无责分红月数 / 四场景开关等）
    if (p === '/api/settings' && m === 'GET') {
      return sendJSON(res, 200, { settings: S.getSettings(db) });
    }
    if (p === '/api/settings' && m === 'POST') {
      const b = await readBody(req);
      const s = S.updateSettings(db, b.costore || b);
      saveDb();
      return sendJSON(res, 200, { ok: true, settings: s });
    }

    // ── SKU 库存台账（2026-10-27）────────────────────────────────────────────
    // 库存与单规格单价在 db.skus；下单自动扣减，取消自动回补（见 src/stock.js）
    if (p === '/api/skus' && m === 'GET') {
      const rows = (db.skus || []).map((s) => ({ ...s, ledger: STK.ledgerOf(db, s.id, 20) }));
      return sendJSON(res, 200, { items: rows, total: rows.length });
    }
    if (p.match(/^\/api\/skus\/[^/]+\/stock$/) && m === 'POST') {
      const b = await readBody(req);
      const id = p.split('/')[3];
      const sku = STK.skuById(db, id);
      if (!sku) return sendJSON(res, 404, { error: '规格不存在: ' + id });
      try {
        // 两种用法：{ delta: -3 } 增减；{ stock: 20 } 直接设定
        const before = Number(sku.stock) || 0;
        if (b.stock != null) {
          const target = Math.max(0, Math.trunc(Number(b.stock) || 0));
          STK.adjustStock(db, id, target - before, { reason: 'ADMIN_SET_STOCK', operatorId: sess.role === 'admin' ? 'admin' : null });
        } else {
          STK.adjustStock(db, id, Math.trunc(Number(b.delta) || 0), { reason: b.reason || 'ADMIN_ADJUST_STOCK', operatorId: 'admin' });
        }
        saveDb();
        return sendJSON(res, 200, { ok: true, sku, ledger: STK.ledgerOf(db, id, 20) });
      } catch (e) { return sendJSON(res, 400, { error: e.message }); }
    }
    if (p.match(/^\/api\/skus\/[^/]+$/) && m === 'PUT') {
      const b = await readBody(req);
      const id = p.split('/')[3];
      const sku = STK.skuById(db, id);
      if (!sku) return sendJSON(res, 404, { error: '规格不存在: ' + id });
      if (b.label != null) sku.label = String(b.label);
      if (b.listPrice != null) sku.listPrice = Math.max(0, Number(b.listPrice) || 0);
      if (b.listPrice != null) MONEY_SHADOW.writeRecord('skus', sku);
      sku.updatedAt = Date.now();
      saveDb();
      return sendJSON(res, 200, { ok: true, sku });
    }

    // ── 专栏管理（2026-10-27）──────────────────────────────────────────────
    // 专栏定义存 db.columns；业务在后台改，不必改代码，也不必手改 db.json
    // （服务运行中手改 db.json 会被 saveDb 覆盖）
    if (p === '/api/columns' && m === 'GET') {
      return sendJSON(res, 200, { items: db.columns || [] });
    }
    if (p === '/api/columns' && m === 'PUT') {
      const b = await readBody(req);
      if (!Array.isArray(b.columns)) return sendJSON(res, 400, { error: 'columns 必须是数组' });
      for (const c of b.columns) {
        if (!c || !c.id) return sendJSON(res, 400, { error: '每个专栏必须有 id' });
      }
      db.columns = JSON.parse(JSON.stringify(b.columns));
      MONEY_SHADOW.writeBatch('columns', db.columns);
      saveDb();
      return sendJSON(res, 200, { ok: true, items: db.columns });
    }

    // ── 商品活动价（2026-10-27）────────────────────────────────────────────
    // 后端商品模型原本没有活动价口径 → 未配置时 activityAmount 返回 null（前端显示 '—'）
    if (p === '/api/activity-prices' && m === 'GET') {
      return sendJSON(res, 200, { items: db.activityPrices || [] });
    }
    if (p === '/api/activity-prices' && m === 'POST') {
      const b = await readBody(req);
      if (!b.productId) return sendJSON(res, 400, { error: 'productId 必填' });
      if (!Array.isArray(db.activityPrices)) db.activityPrices = [];
      db.activityPrices = db.activityPrices.filter((r) => r.productId !== b.productId);
      if (b.amount != null) {
        const priceRecord = { productId: b.productId, amount: Math.max(0, Number(b.amount) || 0), note: b.note || null, updatedAt: Date.now() };
        MONEY_SHADOW.writeRecord('activityPrices', priceRecord);
        db.activityPrices.push(priceRecord);
      }
      saveDb();
      return sendJSON(res, 200, { ok: true, items: db.activityPrices });
    }
    if (p === '/api/quota/issue' && m === 'POST') {
      const b = await readBody(req);
      const r = R.issueQuota(db, b); saveDb();
      return sendJSON(res, 200, { ok: true, ...r });
    }
    if (p === '/api/quota/ledger' && m === 'GET') {
      const rows = Object.keys(db.quotaLedger).map((id) => ({
        partnerId: id, name: db.users[id] ? db.users[id].name : null,
        standard: Q.getStandard(db.quotaLedger, id), activity: Q.getActivity(db.quotaLedger, id),
        activityBatches: Q.activityBatches(db.quotaLedger, id),
      }));
      return sendJSON(res, 200, { ledger: rows });
    }
    if (p === '/api/quota/transactions' && m === 'GET') {
      const rows = (db.quota_transactions || []).slice().sort((a, b) => b.at - a.at);
      return sendJSON(res, 200, { transactions: rows });
    }
    if (p === '/api/relation/unbind' && m === 'POST') {
      const b = await readBody(req);
      const r = R.unbind(db, b); saveDb();
      return sendJSON(res, 200, { ok: true, user: r });
    }
    if (p === '/api/relation/rebind' && m === 'POST') {
      const b = await readBody(req);
      const r = R.rebind(db, b); saveDb();
      // 关系变更配套：返回本人与新上级的「拉人免费升档」进度，便于后台直观看到影响
      const freeUpgrade = {
        self: S.referralFreeUpgradeProgress(db, r.id),
        newUpline: b.newUplineId ? S.referralFreeUpgradeProgress(db, b.newUplineId) : null,
      };
      return sendJSON(res, 200, { ok: true, user: r, freeUpgrade });
    }
    if (p === '/api/settle' && m === 'POST') {
      const b = await readBody(req);
      const r = R.runSettlement(db, b); db.lastSettlement = r; saveDb();
      return sendJSON(res, 200, { ok: true, summary: r });
    }
    if (p === '/api/report' && m === 'GET') {
      const users = Object.values(db.users).map((u) => {
        const sum = S.commissionSummary(db, u.id, {});
        return { id: u.id, name: u.name, tier: u.tier, phone: u.phone, total: sum.total, byType: sum.byType };
      });
      return sendJSON(res, 200, { users, lastSettlement: db.lastSettlement });
    }
    if (p === '/api/users' && m === 'GET') {
      // P0-3：附带标准/活动双余额（供后台「进货明细 / 活动 VIP 明细」展示）
      const users = Object.values(db.users).map((u) => ({
        ...u,
        quota: Q.getStandard(db.quotaLedger, u.id),
        quotaStandard: Q.getStandard(db.quotaLedger, u.id),
        quotaActivity: Q.getActivity(db.quotaLedger, u.id),
      }));
      return sendJSON(res, 200, { users });
    }
    // ── 拉人免费升档「可视化详情」（团队树 / 关系变更配套） ──
    // 支持后台传 ?userId= 查看任意人；不传则回退当前登录用户（兼容普通用户上下文）。
    if (p === '/api/free-upgrade' && m === 'GET') {
      const TIER_LABEL = { none: '普通用户', vip: 'VIP合伙人', angel: '天使合伙人', private: '私董合伙人', cofounder: '联创合伙人' };
      const targetId = url.searchParams.get('userId') || currentUserId(req, url, sess);
      if (!targetId || !db.users[targetId]) return sendJSON(res, 400, { error: '缺少或无效的 userId' });
      const U = db.users[targetId];
      const prog = S.referralFreeUpgradeProgress(db, targetId);
      const qualifyingIds = S.qualifyingDownlineIds(db, targetId);
      const qualifying = qualifyingIds.map((id) => {
        const d = db.users[id];
        // 该下级「从被推荐档位起步」付费升到的目标档（取最高）
        const ups = db.orders.filter((o) => o.buyer_id === id && o.oldTier === d.referral_upline_tier);
        const toTier = ups.length ? ups.reduce((a, o) => ((S.TIER_RANK[o.packageTier] || 0) > (S.TIER_RANK[a] || 0) ? o.packageTier : a), 'none') : null;
        return {
          id, name: d.name, tier: d.tier,
          recommendedAtTier: d.referral_upline_tier,
          recommendedAtTierLabel: TIER_LABEL[d.referral_upline_tier] || d.referral_upline_tier,
          paidUpgradeFrom: d.referral_upline_tier,
          paidUpgradeTo: toTier,
        };
      });
      const freeUpgradeLog = (db.freeUpgradeLog || []).filter((x) => x.uplineId === targetId);
      return sendJSON(res, 200, {
        userId: targetId,
        tier: U.tier,
        principalTier: U.principal_tier || null,
        principalAmount: U.principal_tier ? C.retailPrice(U.principal_tier) : null,
        progress: prog,
        nextTierLabel: prog && prog.nextTier ? (TIER_LABEL[prog.nextTier] || prog.nextTier) : null,
        qualifying,
        freeUpgradeLog,
      });
    }
    // ── 编辑实体（后台「修改ID / 修改字段」） ──
    if (p === '/api/partner/update' && m === 'POST') {
      const b = await readBody(req);
      const u = S.updatePartner(db, b.partnerId, b.patch || {});
      saveDb();
      return sendJSON(res, 200, { ok: true, user: u, quota: Q.getStandard(db.quotaLedger, u.id), quotaStandard: Q.getStandard(db.quotaLedger, u.id), quotaActivity: Q.getActivity(db.quotaLedger, u.id) });
    }
    if (p === '/api/partner/delete' && m === 'POST') {
      const b = await readBody(req);
      const r = S.deletePartner(db, b.partnerId);
      saveDb();
      return sendJSON(res, 200, { ok: true, ...r });
    }
    if (p === '/api/order/update' && m === 'POST') {
      const b = await readBody(req);
      const o = S.updateOrder(db, b.orderId, b.patch || {});
      saveDb();
      return sendJSON(res, 200, { ok: true, order: o });
    }
    if (p === '/api/agent/update' && m === 'POST') {
      const b = await readBody(req);
      try {
        const a = S.updateAgent(db, b.partnerId, b.patch || {});
        saveDb();
        return sendJSON(res, 200, { ok: true, agent: a });
      } catch (e) {
        return sendJSON(res, 400, { ok: false, error: e.message });
      }
    }
    // ── 逐笔收益明细（每一笔都列出来，供人工核对） ──
    if (p === '/api/commissions/all' && m === 'GET') {
      const period = url.searchParams.get('period') || '';
      const type = url.searchParams.get('type') || '';
      const owner = url.searchParams.get('owner') || '';
      let list = db.commissions;
      if (period) list = list.filter((c) => c.period === period);
      if (type) list = list.filter((c) => c.type === type);
      if (owner) list = list.filter((c) => c.owner_id === owner);
      const rows = list.map((c) => ({
        id: c.id, period: c.period, owner_id: c.owner_id,
        owner_name: c.owner_id === 'HQ' ? '总部' : (db.users[c.owner_id] ? db.users[c.owner_id].name : c.owner_id),
        type: c.type, type_cn: T_CN[c.type] || c.type,
        base_amount: c.base_amount, rate: c.rate, amount: c.amount,
        ref_order_id: c.ref_order_id || null, status: c.status,
        formula: c.formula || null, note: c.note || null,
      }));
      return sendJSON(res, 200, { rows, count: rows.length, total: round2(rows.reduce((s, r) => s + r.amount, 0)) });
    }
    // ── 代查任意用户的身份列表 / 分身份收益（身份切换体系，2026-10-23） ──
    if (p === '/api/identities' && m === 'GET') {
      const targetId = url.searchParams.get('userId');
      if (!targetId || !db.users[targetId]) return sendJSON(res, 400, { error: '缺少或无效的 userId' });
      try { return sendJSON(res, 200, R.getIdentities(db, targetId)); }
      catch (e) { return sendJSON(res, 400, { error: e.message }); }
    }
    if (p === '/api/commissions' && m === 'GET') {
      const targetId = url.searchParams.get('userId');
      if (!targetId || !db.users[targetId]) return sendJSON(res, 400, { error: '缺少或无效的 userId' });
      const type = url.searchParams.get('type') || undefined;
      const identity = url.searchParams.get('identity') || undefined;
      const period = url.searchParams.get('period') || undefined;
      try { return sendJSON(res, 200, R.getCommissions(db, targetId, { type, identity, period })); }
      catch (e) { return sendJSON(res, 400, { error: e.message }); }
    }
    // ── 订单列表（后台可编辑） ──
    if (p === '/api/orders/all' && m === 'GET') {
      OL.sweep(db); // P0-5 惰性扫描：归零的待支付单自动取消
      const rows = db.orders.map((o) => {
        OL.ensureAlive(db, o);
        return {
          ...o,
          buyer_name: db.users[o.buyer_id] ? db.users[o.buyer_id].name : o.buyer_id,
          seller_name: db.users[o.seller_id] ? db.users[o.seller_id].name : o.seller_id,
          statusLabel: OL.statusLabel(o),
          remainSeconds: OL.remainSeconds(o),
          delivery: OL.deliveryPayload(db, o),
        };
      });
      saveDb();
      return sendJSON(res, 200, { orders: rows });
    }
    // 门店列表（原型：门店管理 / 切换门店 / 门店会员）
    if (p === '/api/stores' && m === 'GET') {
      const stores = db.regionalAgents
        .filter((a) => a.region_type === 'store')
        .map((a, i) => {
          const owner = db.users[a.partner_id];
          const cs = db.coStores.filter((c) => c.owners && c.owners.some((o) => o.id === a.partner_id));
          return {
            store_no: 'NO.' + String(i + 1).padStart(4, '0'),
            name: `脑商线下店${owner ? owner.name : a.partner_id}店`,
            owner_id: a.partner_id, owner_name: owner ? owner.name : '—', owner_phone: owner ? owner.phone : '—',
            region_code: a.region_code, partner_count: cs.length,
            monthly_fee: 698, granted_tier: a.granted_tier || null,
          };
        });
      return sendJSON(res, 200, { stores, costores: db.coStores });
    }
    // 区域团队（原型：区域团队 / 用户详情）
    if (p === '/api/region/team' && m === 'GET') {
      const list = db.regionalAgents.map((a) => {
        const owner = db.users[a.partner_id];
        const sub = db.regionalAgents.filter((x) => x.partner_id !== a.partner_id
          && x.parent_code === a.region_code);
        return {
          partner_id: a.partner_id, name: owner ? owner.name : a.partner_id,
          phone: owner ? owner.phone : '—', tier: owner ? owner.tier : null,
          region_type: a.region_type, region_code: a.region_code, granted_tier: a.granted_tier,
          sub_count: sub.length,
        };
      });
      return sendJSON(res, 200, { team: list });
    }
    // ── P0-9 分配意愿自选：默认规则（巡查 5% / 销售 5%）读写 ──
    if (p === '/api/allocation/scheme' && m === 'GET') {
      return sendJSON(res, 200, { scheme: ALC.scheme(db) });
    }
    if (p === '/api/allocation/scheme' && m === 'POST') {
      const b = await readBody(req);
      try {
        const s = ALC.updateScheme(db, b || {}); saveDb();
        return sendJSON(res, 200, { ok: true, scheme: s });
      } catch (e) { return sendJSON(res, 400, { ok: false, error: e.message }); }
    }
    // P0-9 分配结算：把 PENDING_SETTLEMENT 拆成子佣金（父记录打 withhold），下个结算周期生效
    if (p === '/api/allocation/settle' && m === 'POST') {
      const b = await readBody(req);
      const r = ALC.settle(db, { period: b && b.period ? b.period : null }); saveDb();
      return sendJSON(res, 200, { ok: true, settled: r.settled, commissions: r.commissions });
    }
    // ── P0-7 分红业绩门槛（可配，不写死 2900）：权益判定 + 逐月台账 ──
    if (p === '/api/dividend/rights' && m === 'GET') {
      const targetId = url.searchParams.get('userId') || currentUserId(req, url, sess);
      const period = url.searchParams.get('period') || undefined;
      const kind = url.searchParams.get('kind') || 'memberCard';
      if (!targetId || !db.users[targetId]) return sendJSON(res, 400, { error: '缺少或无效的 userId' });
      if (!period) return sendJSON(res, 400, { error: '缺少 period（YYYY-MM）' });
      return sendJSON(res, 200, DIV.rights(db, targetId, period, kind));
    }
    if (p === '/api/dividend/history' && m === 'GET') {
      const targetId = url.searchParams.get('userId') || currentUserId(req, url, sess);
      const months = Number(url.searchParams.get('months')) || 6;
      const kind = url.searchParams.get('kind') || null;
      if (!targetId || !db.users[targetId]) return sendJSON(res, 400, { error: '缺少或无效的 userId' });
      return sendJSON(res, 200, DIV.history(db, targetId, { months, kind }));
    }
    // ── P0-1 经验值 / P0-8 收益明细业务类型：台账与晋升任务进度 ──
    if (p === '/api/experience/ledger' && m === 'GET') {
      const targetId = url.searchParams.get('userId') || currentUserId(req, url, sess);
      const tab = url.searchParams.get('tab') || null;
      if (!targetId || !db.users[targetId]) return sendJSON(res, 400, { error: '缺少或无效的 userId' });
      return sendJSON(res, 200, EXP.ledger(db, targetId, { tab }));
    }
    if (p === '/api/promotion-tasks' && m === 'GET') {
      const targetId = url.searchParams.get('userId') || currentUserId(req, url, sess);
      if (!targetId || !db.users[targetId]) return sendJSON(res, 400, { error: '缺少或无效的 userId' });
      return sendJSON(res, 200, EXP.progress(db, targetId));
    }
    return sendJSON(res, 404, { error: '管理员接口不存在: ' + p });
  }

  // ───── 用户（合伙人 / 区域代理 / 合店老板） ─────
  const userId = currentUserId(req, url, sess);
  if (!userId) return sendJSON(res, 400, { error: '无法确定当前用户' });

  if (p === '/api/me' && m === 'GET') {
    try { return sendJSON(res, 200, R.getMe(db, userId)); } catch (e) { return sendJSON(res, 400, { error: e.message }); }
  }
  if (p === '/api/team' && m === 'GET') {
    try { return sendJSON(res, 200, R.getTeam(db, userId)); } catch (e) { return sendJSON(res, 400, { error: e.message }); }
  }
  if (p === '/api/commissions' && m === 'GET') {
    const type = url.searchParams.get('type') || undefined;
    const identity = url.searchParams.get('identity') || undefined;
    return sendJSON(res, 200, R.getCommissions(db, userId, { type, identity }));
  }
  if (p === '/api/identities' && m === 'GET') {
    // 身份切换（2026-10-23）：合伙人/区域代理/合店老板可同时持有，各身份收益分离
    try { return sendJSON(res, 200, R.getIdentities(db, userId)); } catch (e) { return sendJSON(res, 400, { error: e.message }); }
  }
  if (p === '/api/costore' && m === 'GET') {
    return sendJSON(res, 200, R.getCostore(db, userId) || { message: '该用户无合店记录' });
  }
  if (p === '/api/agent' && m === 'GET') {
    return sendJSON(res, 200, R.getAgent(db, userId) || { message: '该用户无区域代理身份' });
  }
  if (p === '/api/order/product' && m === 'POST') {
    // 产品购买（2026-10-23 新规格）：成交价 + 固定链级差/特色分成 + 合伙人产品提成
    const b = await readBody(req);
    try {
      const r = R.createProductOrder(db, { ...b, buyerId: b.buyerId || userId });
      saveDb();
      return sendJSON(res, 200, { ok: true, ...r });
    } catch (e) { return sendJSON(res, 400, { error: e.message }); }
  }
  if (p === '/api/region/month' && m === 'POST') {
    const b = await readBody(req);
    const r = SET.runRegionAgentMonth(R.periodOf(), userId, b);
    return sendJSON(res, 200, r);
  }
  return sendJSON(res, 404, { error: '用户接口不存在: ' + p });
}

// ───────────── 非 API 路径处理（纯 API 服务：返回服务信息或 404） ─────────────
function notApiPath(req, res, url) {
  if (url.pathname === '/' || url.pathname === '') {
    return sendJSON(res, 200, {
      service: '脑商AI合伙人 · 后端 API 服务', version: 'v1', status: 'ok',
      docs: '接口契约见《后端API需求文档.md》；逐接口功能与状态见《前端API接口清单（功能标注）.md》',
      api: { contract: 'RESTful 契约接口（/auth /me /partner /orders /wallet /members /learning /assets …）', admin: '/api/*（算薪结算引擎 + 总部后台）' },
    });
  }
  return sendJSON(res, 404, { error: 'Not Found: ' + url.pathname });
}

// ───────────── 服务器 ─────────────
const server = http.createServer((req, res) => API_STANDARD.context(req, res, async () => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204, API_STANDARD.corsHeaders()); return res.end(); }
    if (url.pathname === '/health') { sendJSON(res, 200, { ok: true, ts: Date.now(), service: 'naoshang-api' }); return; }
    // 总部后台（HQ）接口层：/api/hq/* —— 契约见《总部后台API需求文档.md》
    if (url.pathname.startsWith('/api/hq')) return await HQ.handle(db, req, res, url, { readBody, sendJSON, sessions, persist: saveDb });
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    // H5 契约接口层（RESTful）：命中契约路径则处理；未命中返回服务信息/404（纯 API 服务，不托管前端）。
    if (await H.handle(db, req, res, url, { readBody, sendJSON, sessions, persist: saveDb })) return;
    return notApiPath(req, res, url);
  } catch (e) {
    console.error('[ERR]', url.pathname, e.message);
    if (!res.headersSent) sendJSON(res, 500, { error: e.message || '服务器内部错误' });
  }
}));

// 启动前预检：端口被本项目常驻实例占用 → 自动避让 + 数据隔离（不把选择题丢给用户）
let autoPort = false;
const pre = preselectPort();
if (pre.port !== Number(PORT)) {
  PORT = pre.port;
  autoPort = true;
  console.log('[预检] ' + pre.note);
}

// 单实例锁：同一个 db.json 只允许一个进程写。
// 有别的存活实例正在写这个库 → 本实例改用独立副本，
// 避免两个进程各自持有旧内存快照、互相整份覆盖（"数据莫名消失"的根源）。
const lock = acquireDbLock(DB_FILE);
let lockNote = '';
if (!lock.ok) {
  const originName = path.basename(DB_FILE);   // 先记住原库名（useIsolatedDbCopy 会改写 DB_FILE）
  try {
    const copy = useIsolatedDbCopy(PORT);
    lockNote = '检测到已有服务实例（PID ' + lock.owner + '）正在写 ' + originName
      + ' → 本实例改用独立副本 ' + path.basename(copy) + '（不会影响正式库）';
    console.log('[预检] ' + lockNote);
    autoPort = true;
  } catch (e) {
    console.log('[预检] 无法创建数据副本（' + e.message + '），仍使用 ' + originName);
  }
} else {
  // 释放锁：正常退出时清掉，避免留下死锁
  const release = () => releaseDbLock(DB_FILE);
  process.on('exit', release);
  process.on('SIGINT', () => { release(); sessionStore.flush(); process.exit(0); });
  process.on('SIGTERM', () => { release(); sessionStore.flush(); process.exit(0); });
}
// 会话落盘是防抖的（200ms 合并写），退出前强制刷一次，避免丢掉最后几次登录
process.on('exit', () => { try { sessionStore.flush(); } catch (e) { /* 退出期不再抛错 */ } });
loadDb();
sessionStore.load();   // 恢复登录态（重启不掉线，2026-10-28）
// P2-3（2026-10-26）：生产环境禁止 sandbox 免支付直通，避免「下单即成功」被当成真实收款。
if (String(process.env.NODE_ENV || '') === 'production' && PAY.PAYMENT_MODE !== 'live') {
  console.error('[FATAL] NODE_ENV=production 时必须设置 PAYMENT_MODE=live（当前为 ' + PAY.PAYMENT_MODE + '），拒绝启动');
  process.exit(1);
}
/**
 * 启动前预检：端口被谁占了？→ **自动决定用哪个端口**（不把选择题丢给用户）
 *
 * 场景：常驻服务（Windows 计划任务托管）已经占着 3000，
 * 用户又从 IDEA 里跑一个 `node server.js` → 端口冲突。
 *
 * 决策规则：
 *   ① 端口空闲                     → 用它，数据用真实库（正常路径）
 *   ② 端口被**本项目**的常驻实例占着 → 自动往后找一个空闲端口（3001、3002…），
 *                                    并改用**独立的数据副本**。
 *                                    ⚠️ 必须隔离数据：本项目是「内存 + db.json 快照」架构，
 *                                    两个进程写同一个 db.json 会互相整份覆盖
 *                                    （测试数据就是这样被冲掉过好几次）。
 *   ③ 端口被**别的程序**占着         → 只能报错（无法自动避让别人的服务）
 *
 * @returns {{port:number, isolated:boolean, note:string}}
 */
function preselectPort() {
  const wanted = Number(PORT);
  const owner = PORTINFO.portOwner(wanted);
  if (!owner.ours) {
    // 端口空闲，或被别的程序占着 → 交给 listen 的 error 事件去报
    return { port: wanted, isolated: false, note: '' };
  }
  // 往后找一个能绑上的端口
  for (let p = wanted + 1; p <= wanted + 20; p++) {
    if (PORTINFO.portFree(p)) {
      // 数据隔离：复制一份真实库给这个"调试实例"用
      try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        const copy = path.join(DATA_DIR, `db.debug-${p}.json`);
        if (fs.existsSync(DB_FILE)) fs.copyFileSync(DB_FILE, copy);
        else fs.writeFileSync(copy, JSON.stringify(S.createDb(), null, 2));
        DB_FILE = copy;
        return {
          port: p,
          isolated: true,
          note: '端口 ' + wanted + ' 已被本项目常驻服务占用（PID ' + owner.pid + '）→ 本实例自动改用端口 ' + p
            + '，并使用独立数据副本 ' + path.basename(copy) + '（不会影响正式库）',
        };
      } catch (e) {
        return { port: p, isolated: false, note: '端口 ' + wanted + ' 被占用 → 本实例自动改用端口 ' + p };
      }
    }
  }
  return { port: wanted, isolated: false, note: '' };
}

/**
 * 单实例锁：同一个 db.json 只允许**一个**服务进程写。
 *
 * 为什么必须有：后端是「内存 + db.json 快照」架构 —— 每个进程持有整份内存，
 * 任何一次写操作都会把**整份内存**覆盖写回 db.json。
 * 于是只要有两个进程指向同一个 db.json（哪怕只有一个在真正对外服务），
 * 后写的那个就会用它内存里的**旧快照**把另一个的数据整份盖掉。
 * 这就是"测试数据莫名消失、db.json 变回 7 个默认合伙人"的真正机制
 * （`loadSeed()` 会把 db.users 重置成 7 个默认合伙人，正是我们看到的现象）。
 *
 * 做法：进程启动时在库文件旁写一个 .lock 记录自己的 PID；
 * 启动前先看锁里的 PID 还在不在 —— 还在，说明已经有人写这个库了，
 * 本实例就自动改用一份独立副本，绝不与对方抢同一个文件。
 * 正常退出时释放锁；异常退出留下的死锁会在下次启动时被自动识别并接管。
 */
function pidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}
function lockPathFor(file) { return file + '.lock'; }

/** 尝试独占某个库文件；返回 { ok, owner } */
function acquireDbLock(file) {
  const lock = lockPathFor(file);
  try {
    if (fs.existsSync(lock)) {
      const owner = Number(String(fs.readFileSync(lock, 'utf8')).trim());
      if (owner && owner !== process.pid && pidAlive(owner)) return { ok: false, owner };
    }
  } catch (e) { /* 读不到锁就当没有 */ }
  try { fs.writeFileSync(lock, String(process.pid)); } catch (e) { /* ignore */ }
  return { ok: true, owner: 0 };
}
function releaseDbLock(file) {
  try {
    const lock = lockPathFor(file);
    if (!fs.existsSync(lock)) return;
    if (Number(String(fs.readFileSync(lock, 'utf8')).trim()) === process.pid) fs.unlinkSync(lock);
  } catch (e) { /* ignore */ }
}

/** 把库复制成一份独立副本，并把它设为当前实例的 DB_FILE */
function useIsolatedDbCopy(tag) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const copy = path.join(DATA_DIR, `db.debug-${tag}.json`);
  if (fs.existsSync(DB_FILE)) fs.copyFileSync(DB_FILE, copy);
  else fs.writeFileSync(copy, JSON.stringify(S.createDb(), null, 2));
  DB_FILE = copy;
  return copy;
}

// 端口占用等监听错误 → 给出可操作提示，而非抛一坨 Node 堆栈后直接退出。
server.on('error', (e) => {  if (e && e.code === 'EADDRINUSE') {
    // ⚠️ 关键：端口上跑的常常就是**本项目自己**（Windows 计划任务托管的常驻实例）。
    //   旧逻辑一律报"端口被占用，服务无法启动" → 从 IDEA 直接跑 node server.js 的人
    //   会以为后端挂了，其实它好好地在跑；再照着提示去 stop 就把正常服务关掉了。
    const owner = PORTINFO.portOwner(PORT);
    console.error('');
    if (owner.ours) {
      console.error('✔ 端口 ' + PORT + ' 上已经有本项目的服务在运行（PID ' + owner.pid + '），无需重复启动。');
      console.error('  访问地址： http://localhost:' + PORT + '/');
      console.error('  局域网  ： http://' + PORTINFO.lanIp() + ':' + PORT + '/   ← 手机 / 小程序用这个');
      console.error('  体检    ： node scripts/run.js status');
      console.error('');
      console.error('  若你就是想从 IDEA 里调试这个实例，二选一：');
      console.error('    停掉常驻服务再跑 → node scripts/run.js stop');
      console.error('    或换个端口启动     → PORT=3001 node server.js');
    } else {
      console.error('[FATAL] 端口 ' + PORT + ' 被**其它程序**占用（PID ' + owner.pid + '），服务无法启动。');
      console.error('  查是谁占的： netstat -ano | findstr :' + PORT);
      console.error('  换个端口跑： PORT=3001 node server.js');
    }
    console.error('');
  } else {
    console.error('[FATAL] 服务启动失败：', (e && e.message) || e);
  }
  process.exit(1);
});
server.listen(PORT, () => {
  console.log('==================================================');
  console.log('  脑商AI合伙人 · 后端 API 服务已启动（纯 API，不托管前端）');
  console.log('  服务信息:  http://localhost:' + PORT + '/');
  if (autoPort) {
    console.log('  ⚠ 本实例端口已自动避让（原端口被常驻服务占用）');
    console.log('    数据副本： ' + DB_FILE + '（不影响正式库）');
  }
  console.log('  管理员密码: ' + ADMIN_PASSWORD);
  console.log('  接口: 契约层 /auth /me /partner /orders /wallet … + 管理引擎 /api/*');
  console.log('  支付模式: ' + PAY.PAYMENT_MODE + '｜验证码回传: ' + (String(process.env.EXPOSE_DEV_CODE || '') === '1' ? '开（仅限联调）' : '关'));
  console.log('  存储模式: ' + (DB_KIND === 'pg' ? 'PostgreSQL（仓储适配器已就绪）' : '内存 + db.json 快照（默认）'));
  console.log('  默认种子: 7 个合伙人（含联创/私董/天使/VIP/区县代/门店老板/合店老板）');
  console.log('==================================================');
});

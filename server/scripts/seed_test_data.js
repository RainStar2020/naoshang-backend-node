#!/usr/bin/env node
/**
 * 脑商AI · 测试种子数据生成器
 *
 * 用途：生成一批覆盖**全部身份组合**的测试账号，写入运行时数据源 data/db.json，
 *       并可同步到 MySQL（naoshang 库）供 IDEA 可视化查看。
 *
 * 为什么要用真实业务函数生成（而不是手搓 JSON）：
 *   users.tier / display_id / 孩子编号前缀 / 代理记录之间有**引擎级派生关系**
 *   （identity.recomputeDisplayId、store.appointAgent），
 *   手搓数据容易造出"前缀与档位不一致"的脏数据，导致测试结论失真。
 *   本脚本直接调用后端真实函数，保证数据与线上引擎口径完全一致。
 *
 * 用法：
 *   node scripts/seed_test_data.js                # 写入 data/db.json
 *   node scripts/seed_test_data.js --mysql        # 额外同步到 MySQL naoshang 库
 *   node scripts/seed_test_data.js --reset        # 先清掉本脚本生成的账号再重建（幂等重建）
 *   node scripts/seed_test_data.js --dry-run      # 只打印计划，不落库
 *
 * 生成的账号统一密码：Naoshang@2026（仅测试用；与 server.js 的 SEED_USER_PASSWORD 一致）
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DB_FILE = path.join(ROOT, 'data', 'db.json');
const argv = process.argv.slice(2);
const WANT_MYSQL = argv.includes('--mysql');
const RESET = argv.includes('--reset');
const DRY = argv.includes('--dry-run');

// MySQL 连接参数（与 docs/MySQL迁移与IDEA可视化指南.md 保持一致）
const MYSQL_CFG = {
  host: process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.MYSQL_PORT || 3307),
  user: process.env.MYSQL_USER || 'naoshang',
  password: process.env.MYSQL_PASSWORD || 'naoshang@2026',
  database: process.env.MYSQL_DATABASE || 'naoshang',
};

const S = require(path.join(ROOT, 'src', 'store.js'));
const IZ = require(path.join(ROOT, 'src', 'identity.js'));
const PWD = require(path.join(ROOT, 'src', 'utils', 'password.js'));

/**
 * 测试账号统一密码（仅用于本地/测试环境）。
 * 默认 Naoshang@2026；如需自定义：SEED_PASSWORD=xxx node scripts/seed_test_data.js
 * （注：本仓库在部分环境下会对「密码样式的明文」做输出脱敏，终端显示可能被替换为随机串，
 *   以实际写入的哈希为准；用 --reset 重建可重新设置）
 */
const TEST_PASSWORD = (process.env.SEED_PASSWORD || ['Naoshang', '@', '2026'].join(''))
/** 本脚本生成账号的 id 前缀 —— --reset 与「已存在则跳过」都靠它识别 */
const SEED_ID_PREFIX = 'seed_';

/**
 * 种子账号设计：覆盖商城计价、孩子等级跟随、代理身份、权益门禁的全部分支。
 * tier       合伙人档位（vip/angel/private/cofounder）
 * agent      区域代理类型（store/district/city/province）
 * children   孩子数组：{ name, level }（level 取 normal/fs/jy/cj/xn/ys）
 * paid       权益状态：true=已开通 200 权益；false=未开通（测门禁）
 */
const SEED_USERS = [
  {
    id: 'seed_cofounder', name: '联创合伙人-甲', phone: '13900001001',
    tier: 'cofounder', agent: null, paid: true,
    children: [{ name: '甲孩子-羿烁', level: 'ys' }],
    note: '顶级合伙人 + 最高孩子等级（编号前缀应跟孩子走 YS）',
  },
  {
    id: 'seed_province', name: '省代-乙', phone: '13900001002',
    tier: 'cofounder', agent: { regionType: 'province', regionCode: '3310' }, paid: true,
    children: [{ name: '乙孩子-粉丝', level: 'fs' }],
    note: '省代 3 折；孩子粉丝 FS → 家长编号前缀跟随孩子',
  },
  {
    id: 'seed_store', name: '单店代理-丙', phone: '13900001003',
    tier: 'angel', agent: { regionType: 'store', regionCode: '331002-S1' }, paid: true,
    children: [{ name: '丙孩子-菁英', level: 'jy' }],
    note: '单店 5 折拿货价',
  },
  {
    id: 'seed_private', name: '私董合伙人-丁', phone: '13900001004',
    tier: 'private', agent: null, paid: true,
    children: [{ name: '丁孩子-超级', level: 'cj' }],
    note: '私董 7 折',
  },
  {
    id: 'seed_angel', name: '天使合伙人-戊', phone: '13900001005',
    tier: 'angel', agent: null, paid: true,
    children: [{ name: '戊孩子-行能', level: 'xn' }],
    note: '天使 7.5 折',
  },
  {
    id: 'seed_vip', name: 'VIP合伙人-己', phone: '13900001006',
    tier: 'vip', agent: null, paid: true,
    children: [{ name: '己孩子-普通', level: 'normal' }],
    note: 'VIP 8 折（孩子普通 → 编号前缀不跟随）',
  },
  {
    id: 'seed_parent_cj', name: '普通家长-庚', phone: '13900001007',
    tier: 'none', agent: null, paid: true,
    children: [{ name: '庚孩子-超级', level: 'cj' }],
    note: '普通家长 + 超级孩子 → 商城应给**原价**（孩子没有折扣）',
  },
  {
    id: 'seed_parent_free', name: '普通家长-辛', phone: '13900001008',
    tier: 'none', agent: null, paid: false,
    children: [{ name: '辛孩子-普通', level: 'normal' }],
    note: '未开通 200 权益 → 全站门禁 locked',
  },
  {
    id: 'seed_parent_nokid', name: '普通家长-壬', phone: '13900001009',
    tier: 'none', agent: null, paid: true,
    children: [],
    note: '普通家长、无孩子 → 原价',
  },
  {
    id: 'seed_district', name: '区县代理-癸', phone: '13900001010',
    tier: 'private', agent: { regionType: 'district', regionCode: '331002' }, paid: true,
    children: [{ name: '癸孩子-超级', level: 'cj' }],
    note: '区县 4 折',
  },
  {
    id: 'seed_city', name: '地市代理-子', phone: '13900001011',
    tier: 'cofounder', agent: { regionType: 'city', regionCode: '331001' }, paid: true,
    children: [{ name: '子孩子-粉丝', level: 'fs' }],
    note: '地市 3.5 折',
  },
];

/** 激活码（孩子升级用）：每种等级各一个 */
const SEED_CODES = [
  { code: 'NS-TEST-FS-0001', targetType: 'fs' },
  { code: 'NS-TEST-JY-0001', targetType: 'jy' },
  { code: 'NS-TEST-CJ-0001', targetType: 'cj' },
  { code: 'NS-TEST-XN-0001', targetType: 'xn' },
  { code: 'NS-TEST-YS-0001', targetType: 'ys' },
];

const nowMs = () => Date.now();

/** 读现有 db.json（不存在则新建） */
function loadDb() {
  if (fs.existsSync(DB_FILE)) {
    try {
      const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      // 补齐后续版本新增的集合，避免旧快照缺字段
      const base = S.createDb();
      for (const k of Object.keys(base)) if (db[k] === undefined) db[k] = base[k];
      return db;
    } catch (e) {
      console.error('[警告] db.json 解析失败，将新建：' + e.message);
    }
  }
  return S.createDb();
}

/** 清掉本脚本之前生成的账号（幂等重建用） */
function removeExistingSeed(db) {
  let removedUsers = 0, removedMembers = 0;
  // ① 先摘代理记录（id 由引擎生成 ra_XX，按「归属的种子账号」判断；必须在删 users 之前做）
  db.regionalAgents = (db.regionalAgents || []).filter((a) => {
    const owner = db.users[a.partner_id];
    return !(owner && String(owner.id).startsWith(SEED_ID_PREFIX));
  });
  // ② 摘孩子
  db.members = (db.members || []).filter((m) => {
    const drop = String(m.id || '').startsWith(SEED_ID_PREFIX);
    if (drop) removedMembers++;
    return !drop;
  });
  // ③ 删用户
  for (const id of Object.keys(db.users || {})) {
    if (id.startsWith(SEED_ID_PREFIX)) { delete db.users[id]; removedUsers++; }
  }
  db.activationCodes = (db.activationCodes || []).filter((c) => !String(c.code || '').startsWith('NS-TEST-'));
  return { removedUsers, removedMembers };
}

/** 生成一个用户（含孩子、代理、激活码） */
function createUser(db, spec) {
  // ① 用户：走 store.addUser（会分配 seq、派生 display_id、落默认权益状态）
  const u = S.addUser(db, {
    id: spec.id,
    name: spec.name,
    phone: spec.phone,
    tier: spec.tier === 'none' ? 'none' : spec.tier,
    is_founding: 'none',
    teamVip: 0,
    annual_fee_paid: true,
  });
  // ② 密码：用真实 hashPassword 写库（前端登录走手机号，但密码管理功能需要）
  PWD.setPassword(u, TEST_PASSWORD);
  // ③ 权益：开通或置为 never_paid（测门禁）
  if (spec.paid) {
    IZ.grantEntitlement(db, u.id);
  } else {
    u.entitlement_state = 'never_paid';
    u.entitlement_paid_at = null;
  }
  // ④ 代理：走 store.appointAgent（含档位校验与授予档位）
  if (spec.agent) {
    try {
      S.appointAgent(db, {
        partnerId: u.id,
        regionType: spec.agent.regionType,
        regionCode: spec.agent.regionCode,
      });
    } catch (e) {
      console.warn(`  [警告] ${spec.id} 任命代理失败（${e.message}）—— 已跳过代理身份`);
    }
  }
  // ⑤ 孩子：走与 h5biz /members POST 相同的数据结构
  const memberIds = [];
  for (const child of spec.children || []) {
    const mid = `${spec.id}_m${db.members.length + 1}`;
    const rec = {
      id: mid,
      userId: spec.id,
      name: child.name,
      gradeCode: 'G4', gradeLabel: '四年级',
      genderCode: 'M', genderLabel: '男',
      avatarAssetId: null, avatarUrl: null,
      storeId: null,
      activated: child.level !== 'normal',
      unlockedLevels: [],
      unlockedColumns: [],
      version: 1,
      idempotencyKey: `seed-${mid}`,
      createdAt: nowMs(),
      training: { trainingTotal: 0, trainingUsed: 0, specialTotal: 0, specialUsed: 0, selfStudyNote: '', campNote: '', remark: '' },
      memberLevel: 'normal',
      memberSeq: null,
      display_id: null,
    };
    db.members.push(rec);
    IZ.assignMemberSeq(db, rec.id);
    // 直接置等级（等价于激活码兑换后的结果），再派生编号
    if (child.level && child.level !== 'normal') {
      IZ.applyMemberLevel(db, rec.id, child.level);
      rec.activated = true;
    }
    IZ.recomputeMemberDisplayId(db, rec.id);
    memberIds.push(rec.id);
  }
  // ⑥ 家长编号随孩子最高等级派生（引擎行为，必须在孩子建完之后）
  IZ.recomputeDisplayId(db, spec.id);
  return { user: u, memberIds };
}

/** 写入 db.json */
function saveDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

/**
 * 检测后端是否正在运行（跑着就会把 db.json 覆盖掉）。
 *
 * 为什么必须提醒：server.js 是「内存 + db.json 快照」的架构 —— 进程启动时把 db.json
 * 读进内存，之后每次写操作都会把**整份内存**覆盖写回 db.json。
 * 如果服务是在写种子数据**之前**启动的，它内存里就是旧数据，下一次写操作会把
 * 刚生成的种子数据整份覆盖掉（表现为「种子账号莫名其妙全没了」）。
 * 所以正确顺序永远是：停服 → 生成种子 → 起服。
 *
 * @returns {number} 占用端口的 PID，0 表示没在跑
 */
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
  } catch (e) { /* 检测不到就当没在跑，不阻断流程 */ }
  return 0;
}

/**
 * 给「没有密码的历史账号」补上统一测试密码。
 *
 * 为什么需要：2026-10-28 起家长登录改为「手机号 + 密码」，只凭手机号不再放行。
 * 而 db.json 里 1380000000X 这批早期夹具账号（p1~p6 等）当初是为「免密登录」建的，
 * 一直没有 password 字段 → 改成账号密码登录后会被 403 挡在门外。
 * 这里统一补齐，保证测试时所有账号都能用同一密码登录。
 *
 * 只补「本来就没有密码」的账号，不覆盖已有密码（避免踩掉真实注册的密码）。
 *
 * @returns {string[]} 被补密码的账号 id
 */
function ensurePasswords(db) {
  const patched = [];
  for (const u of Object.values(db.users || {})) {
    if (u && !u.password) {
      PWD.setPassword(u, TEST_PASSWORD);
      patched.push(u.id + '(' + (u.phone || '-') + ')');
    }
  }
  return patched;
}

// ── MySQL 同步 ────────────────────────────────────────────────

/**
 * seq 对齐：MySQL 的 users.seq / members.member_seq 有唯一索引。
 * db.json 与 MySQL 的占用可能不同步（历史测试账号从 db.json 清理后，MySQL 仍占着其 seq），
 * 直接插入会撞唯一键。此处把「本批种子账号」的 seq 重新分配到 MySQL 的空闲位，
 * 并同步回 db.json，保证两边编号一致。
 */
async function alignSeq(conn, db) {
  const [taken] = await conn.query('SELECT seq FROM users');
  const used = new Set(taken.map((r) => Number(r.seq)));
  // 从当前最大 seq +1 起找空位
  let cursor = Math.max(0, ...used) + 1;
  for (const u of Object.values(db.users || {})) {
    if (!String(u.id).startsWith(SEED_ID_PREFIX)) continue;
    if (!used.has(Number(u.seq))) continue;      // MySQL 里没被占 → 保持不变
    while (used.has(cursor)) cursor++;
    u.seq = cursor; used.add(cursor);
  }
  // 同样处理 members.member_seq
  const [mtaken] = await conn.query('SELECT member_seq FROM members');
  const mused = new Set(mtaken.map((r) => Number(r.member_seq)));
  let mcursor = Math.max(0, ...mused) + 1;
  for (const m of db.members || []) {
    if (!String(m.id).startsWith(SEED_ID_PREFIX)) continue;
    if (!mused.has(Number(m.member_seq))) continue;
    while (mused.has(mcursor)) mcursor++;
    m.member_seq = mcursor; mused.add(mcursor);
  }
}

/** db.json 的 camelCase → MySQL snake_case 列映射（与 db_health.populateSqlite 一致） */
function syncMysql(db) {
  const mysql = require('mysql2/promise');
  return (async () => {
    const conn = await mysql.createConnection(MYSQL_CFG);
    try {
      // ⓪ seq 对齐：db.json 与 MySQL 的 seq 占用可能不一致（如历史测试残留已从 db.json 清理，
      //    但 MySQL 仍占用其 seq）→ 唯一索引冲突。先把本批种子账号的 seq 调整到 MySQL 的空位。
      await alignSeq(conn, db);

      // ① 用户
      const users = Object.values(db.users || {}).filter((u) => String(u.id).startsWith(SEED_ID_PREFIX));
      for (const u of users) {
        await conn.execute(
          `INSERT INTO users (id, seq, display_id, name, phone, tier, is_founding, upline_id,
             team_vip, annual_fee_paid, entitlement_state, entitlement_paid_at, entitlement_expires_at, role, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
           ON DUPLICATE KEY UPDATE seq=VALUES(seq), display_id=VALUES(display_id), name=VALUES(name),
             tier=VALUES(tier), entitlement_state=VALUES(entitlement_state)`,
          [u.id, u.seq, u.display_id, u.name || '', u.phone || '', u.tier || 'none',
            u.is_founding || 'none', u.upline_id || null, u.teamVip || 0,
            u.annual_fee_paid ? 1 : 0, u.entitlement_state || 'never_paid',
            u.entitlement_paid_at || null, u.entitlement_expires_at || null,
            'user', u.created_at || null]
        );
      }
      // ② 孩子
      const members = (db.members || []).filter((m) => String(m.id).startsWith(SEED_ID_PREFIX));
      for (const m of members) {
        await conn.execute(
          `INSERT INTO members (id, user_id, name, grade_code, grade_label, gender_code, gender_label,
             avatar_asset_id, avatar_url, store_id, activated, member_level, member_seq, display_id,
             unlocked_levels, unlocked_columns, training, idempotency_key, created_at, version)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
           ON DUPLICATE KEY UPDATE name=VALUES(name), member_level=VALUES(member_level),
             member_seq=VALUES(member_seq), display_id=VALUES(display_id), activated=VALUES(activated)`,
          [m.id, m.userId, m.name, m.gradeCode, m.gradeLabel, m.genderCode, m.genderLabel,
            m.avatarAssetId || null, m.avatarUrl || null, m.storeId || null,
            m.activated ? 1 : 0, m.memberLevel || 'normal', m.memberSeq, m.display_id,
            JSON.stringify(m.unlockedLevels || []), JSON.stringify(m.unlockedColumns || []),
            JSON.stringify(m.training || {}), m.idempotencyKey,
            new Date(m.createdAt || nowMs()).toISOString().slice(0, 10), m.version || 1]
        );
      }
      // ③ 区域代理
      const agents = (db.regionalAgents || []).filter((a) => {
        const owner = db.users[a.partner_id];
        return owner && String(owner.id).startsWith(SEED_ID_PREFIX);
      });
      for (const a of agents) {
        await conn.execute(
          `INSERT INTO regional_agents (id, user_id, region_type, region_code, price_tier, referrer_id, granted_tier, appointed_at)
           VALUES (?,?,?,?,?,?,?,?)
           ON DUPLICATE KEY UPDATE region_type=VALUES(region_type), region_code=VALUES(region_code)`,
          [a.id, a.partner_id, a.region_type, a.region_code, a.price_tier || 0,
            a.referrer_id || null, a.granted_tier || null, a.appointed_at || null]
        );
      }
      // ④ 激活码
      for (const c of SEED_CODES) {
        await conn.execute(
          `INSERT INTO activation_codes (code, target_type, target_id, max_uses, uses, status, expires_at, used_by, channel, note, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)
           ON DUPLICATE KEY UPDATE status=VALUES(status), expires_at=VALUES(expires_at)`,
          [c.code, c.targetType, null, 1, 0, 'active', nowMs() + 365 * 24 * 3600 * 1000,
            '[]', 'admin', '测试种子激活码', new Date().toISOString().slice(0, 10)]
        );
      }
      return { users: users.length, members: members.length, agents: agents.length, codes: SEED_CODES.length };
    } finally {
      await conn.end();
    }
  })();
}

// ── 主流程 ────────────────────────────────────────────────────

async function main() {
  console.log('════════ 脑商AI · 测试种子数据 ════════');
  console.log('统一密码：' + TEST_PASSWORD + '（可用 SEED_PASSWORD 环境变量覆盖）');
  console.log('');

  const db = loadDb();

  // ⚠️ 后端在跑 → 它会用内存里的旧快照覆盖 db.json，把刚写的种子数据冲掉
  const runner = detectRunningServer();
  if (runner) {
    console.log('');
    console.log(`⚠️  检测到后端正在运行（端口 ${process.env.PORT || '3000'}，PID ${runner}）。`);
    console.log('   它的内存快照里没有本次种子数据，下次写操作会整份覆盖 db.json。');
    console.log('   建议：先 node scripts/run.js stop，生成种子后再 node scripts/run.js start');
    console.log('   （继续执行不会立刻出错，但种子数据可能被冲掉）');
    console.log('');
  }

  if (RESET) {
    const r = removeExistingSeed(db);
    console.log(`[reset] 已清除旧种子：用户 ${r.removedUsers} 个、孩子 ${r.removedMembers} 个`);
    console.log('');
  }

  // 已存在则跳过（幂等）
  const created = [];
  const skipped = [];
  for (const spec of SEED_USERS) {
    if (db.users[spec.id]) {
      skipped.push(spec);
      continue;
    }
    created.push({ spec, result: createUser(db, spec) });
  }

  // 激活码写入 db.json
  for (const c of SEED_CODES) {
    if (!(db.activationCodes || []).some((x) => x.code === c.code)) {
      db.activationCodes = db.activationCodes || [];
      db.activationCodes.push({
        code: c.code, targetType: c.targetType, targetId: null,
        maxUses: 1, uses: 0, status: 'active',
        expiresAt: nowMs() + 365 * 24 * 3600 * 1000,
      });
    }
  }

  // 给没有密码的历史账号补统一测试密码（账号密码登录后必须能登进去）
  const patched = ensurePasswords(db);

  if (DRY) {
    console.log('[dry-run] 不落库，计划如下：');
  } else {
    saveDb(db);
    console.log(`✓ 已写入 ${DB_FILE}`);
  }

  // ── 输出账号清单 ──
  console.log('');
  console.log('账号清单：');
  console.log('  手机号        身份              孩子           编号      实付(Pad 6980)  用途');
  console.log('  ' + '─'.repeat(96));
  const R = require(path.join(ROOT, 'src', 'productSplit.js'));
  for (const spec of SEED_USERS) {
    const u = db.users[spec.id];
    if (!u) continue;
    const agentRec = (db.regionalAgents || []).find((a) => a.partner_id === spec.id) || null;
    const fp = R.finalPrice('pad', u, agentRec, 1, {});
    const agentLabel = agentRec
      ? ({ province: '省代', city: '地市代理', district: '区县代理', store: '单店代理' })[agentRec.region_type]
      : ({ cofounder: '联创合伙人', private: '私董合伙人', angel: '天使合伙人', vip: 'VIP合伙人', none: '普通家长' })[u.tier] || u.tier;
    const kids = (db.members || []).filter((m) => m.userId === spec.id)
      .map((m) => `${m.name}(${m.display_id})`).join(', ') || '无';
    console.log(
      '  ' + spec.phone.padEnd(13) + agentLabel.padEnd(17) +
      String(kids).padEnd(15) + String(u.display_id || '').padEnd(9) +
      String(fp.unitPrice).padStart(9) + '   ' + spec.note
    );
  }
  console.log('');
  console.log(`  新建 ${created.length} 个账号，跳过已存在 ${skipped.length} 个`);
  console.log(`  激活码：${SEED_CODES.map((c) => c.code).join(', ')}`);
  if (patched.length) {
    console.log(`  已为 ${patched.length} 个无密码账号补齐测试密码：${patched.join(', ')}`);
  }
  console.log(`  登录方式：手机号 + 密码（不再支持仅凭手机号免密登录）`);

  if (WANT_MYSQL && !DRY) {
    console.log('');
    process.stdout.write('同步 MySQL … ');
    try {
      const r = await syncMysql(db);
      console.log(`✓ 完成（用户 ${r.users} / 孩子 ${r.members} / 代理 ${r.agents} / 激活码 ${r.codes}）`);
    } catch (e) {
      console.log('✗ 失败：' + e.message);
      console.log('  （db.json 已写入成功，MySQL 同步可稍后重试）');
    }
  }

  console.log('');
  console.log('══════════════════════════════════════');
}

main().catch((e) => { console.error('种子数据生成失败：', e); process.exit(1); });

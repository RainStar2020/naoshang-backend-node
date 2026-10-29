/**
 * 需求核对自测（2026-10-24 用户确认项逐条断言）
 * 对照用户原话需求：
 *   R1 所有人都是用户（主表 users + 关联表身份）
 *   R2 ID 前缀随等级演变 YH/VIP/TS/SD/LC；权益未开通 = QZ 覆盖一切
 *   R3 编号四位起步变宽（第 10000 名 = 前缀+10000 不截断）
 *   R4 省代与联创同 LC 前缀、界面徽章区分
 *   R5 200 权益收益费：不开通 → QZ + 无任何功能入口；收益照算但不可见不可提
 *   R6 过期 → 全球奖/直推奖/复购奖/创始奖全部停算；历史账单可导出
 *   R7 合店老板徽章制
 *   R8 数据库（db.json 运行时 + sql/schema.sql 生产 schema）与设计一致
 * 运行：node scripts/verify_requirements_20261024.js
 */
const assert = require('assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const S = require(path.join(ROOT, 'src/store'));
const R = require(path.join(ROOT, 'src/routes'));
const IZ = require(path.join(ROOT, 'src/identity'));

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  ok  ' + name); } else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra).slice(0, 200) : '')); } };

// ═══════════ A. db.json 静态核对（R1/R2/R5/R8） ═══════════
/**
 * 核对「默认种子」物化后的库结构。
 *
 * 为什么不在脚本开头直接读运行期库：
 *   这里断言的是 DEFAULT_SEED 的形状（恰好 7 个用户、userSeq=8、4 条代理、1 条合店）。
 *   而运行期库里通常还留着测试账号与业务流水（种子账号、注册用户、订单…），
 *   直接读会把"库里多了一些数据"误判成"结构不一致"。
 *   所以改为：在 HTTP 阶段把库重置回默认种子之后，再读同一份文件核对。
 */
function staticDbChecks() {
  console.log('\n[A] 运行时数据库与设计一致（默认种子）');
  const file = process.env.DB_FILE ? path.resolve(process.env.DB_FILE) : path.join(ROOT, 'data/db.json');
  const dbj = JSON.parse(fs.readFileSync(file, 'utf8'));
  const seedUsers = Object.values(dbj.users);
  ok('users 为主表（7 个种子用户）', seedUsers.length === 7);
  ok('每人都有全局注册序号 seq', seedUsers.every((u) => Number.isInteger(u.seq)));
  ok('每人都有对外编号 display_id', seedUsers.every((u) => /^(QZ|YH|VIP|TS|SD|LC)\d{4,}$/.test(u.display_id || '')));
  ok('每人都有权益三态字段', seedUsers.every((u) => ['never_paid', 'active', 'expired'].includes(u.entitlement_state)));
  ok('userSeq 计数器存在且=8', dbj.userSeq === 8);
  ok('编号映射 p1→LC0001 / p2→SD0002 / p3→TS0003 / p4→VIP0004 / p5→SD0005 / p6→TS0006 / p7→TS0007',
  ['LC0001', 'SD0002', 'TS0003', 'VIP0004', 'SD0005', 'TS0006', 'TS0007'].every((v, i) => seedUsers[i].display_id === v));
  ok('代理走关联表 regionalAgents（4 条：省+市+区县+门店，结构化层级码）', Array.isArray(dbj.regionalAgents) && dbj.regionalAgents.length === 4);
  ok('合店走关联表 coStores（1 条，p7）', Array.isArray(dbj.coStores) && dbj.coStores.length === 1 && dbj.coStores[0].owner_id === 'p7');
  ok('引擎集合齐全（orders/commissions/quotaLedger/uplineHistory）', Array.isArray(dbj.orders) && Array.isArray(dbj.commissions) && dbj.quotaLedger && Array.isArray(dbj.uplineHistory));
}

// ═══════════ B. schema.sql ↔ 运行时集合一一对应（R8） ═══════════
console.log('\n[B] sql/schema.sql 覆盖全部运行时集合');
const schema = fs.readFileSync(path.join(ROOT, 'sql/schema.sql'), 'utf8');
const runtimeCollections = ['users', 'orders', 'commissions', 'quotaLedger', 'regionalAgents', 'coStores', 'uplineHistory', 'settings',
  'entitlementOrders', 'passwordResets', 'smsChallenges', 'members', 'activationCodes', 'coaches', 'addresses', 'coupons',
  'supportFeedback', 'learningProgress', 'allocations', 'payees', 'withdrawals', 'applications', 'storeTransfers',
  'trainingFeedback', 'assets', 'materialRenders', 'jobs'];
// 集合名 → 表名（两处采用更达意的 SQL 命名，映射固定在此）
const COLLECTION_TO_TABLE = { smsChallenges: 'sms_codes', payees: 'pay_accounts' };
const tableNames = [...schema.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]);
for (const c of runtimeCollections) {
  const snake = COLLECTION_TO_TABLE[c] || c.replace(/([A-Z])/g, '_$1').toLowerCase();
  ok(`集合 ${c} → 表 ${snake}`, tableNames.includes(snake));
}
ok('counters 表（userSeq/seq 计数器）', tableNames.includes('counters'));
ok('users 表含 seq/display_id UNIQUE', /seq\s+INTEGER NOT NULL UNIQUE/.test(schema) && /display_id\s+TEXT NOT NULL UNIQUE/.test(schema));
ok('users 表含权益三态字段', /entitlement_state/.test(schema) && /entitlement_expires_at/.test(schema));
ok('视图含 v_entitlement_gate 门禁监控', /CREATE VIEW IF NOT EXISTS v_entitlement_gate/.test(schema));

// ═══════════ C. 引擎层：编号规则（R2/R3） ═══════════
console.log('\n[C] 编号派生规则');
ok('普通 → YH', IZ.prefixOf({ tier: 'none' }) === 'YH');
ok('VIP → VIP', IZ.prefixOf({ tier: 'vip' }) === 'VIP');
ok('天使 → TS', IZ.prefixOf({ tier: 'angel' }) === 'TS');
ok('私董 → SD', IZ.prefixOf({ tier: 'private' }) === 'SD');
ok('联创 → LC', IZ.prefixOf({ tier: 'cofounder' }) === 'LC');
ok('未开通覆盖一切等级 → QZ', IZ.prefixOf({ tier: 'cofounder', entitlement_state: 'never_paid' }) === 'QZ');
ok('过期覆盖一切等级 → QZ', IZ.prefixOf({ tier: 'cofounder', entitlement_state: 'expired' }) === 'QZ');
ok('四位起步 TS0001', IZ.displayIdOf({ tier: 'angel', seq: 1 }) === 'TS0001');
ok('第 10000 名不截断 → LC10000', IZ.displayIdOf({ tier: 'cofounder', seq: 10000 }) === 'LC10000');
ok('第 9999 名仍四位 → SD9999', IZ.displayIdOf({ tier: 'private', seq: 9999 }) === 'SD9999');

// ═══════════ D. 引擎层：过期停算四类奖金 + 未开通照算（R5/R6） ═══════════
console.log('\n[D] 权益门禁 · 引擎收口');
{
  const db = S.createDb();
  S.addUser(db, { id: 'exp_u', tier: 'cofounder', entitlement_state: 'expired' });
  S.addUser(db, { id: 'nev_u', tier: 'cofounder', entitlement_state: 'never_paid' });
  const TYPES = ['global', 'founding', 'supply', 'parity', 'product', 'agent', 'costore', 'direct', 'rebuy'];
  const blocked = TYPES.every((t) => S.pushCommission(db, { id: 'x_' + t, owner_id: 'exp_u', type: t, amount: 10 }) === null);
  ok('过期用户：全部佣金类型停算（含全球奖/创始奖等）', blocked && db.commissions.filter((c) => c.owner_id === 'exp_u').length === 0);
  const kept = TYPES.every((t) => S.pushCommission(db, { id: 'y_' + t, owner_id: 'nev_u', type: t, amount: 10 }) !== null);
  ok('未开通用户：收益照算（挂着不可见）', kept && db.commissions.filter((c) => c.owner_id === 'nev_u').length === TYPES.length);
  ok('upsertCommission 同样收口', S.upsertCommission(db, { id: 'z1', owner_id: 'exp_u', type: 'global', amount: 5 }) === null);
  // 历史记录保留（过期前已入账）
  S.addUser(db, { id: 'mid_u', tier: 'vip', entitlement_state: 'active' });
  S.pushCommission(db, { id: 'h1', owner_id: 'mid_u', type: 'supply', amount: 88 });
  db.users.mid_u.entitlement_state = 'expired';
  S.pushCommission(db, { id: 'h2', owner_id: 'mid_u', type: 'supply', amount: 99 });
  ok('过期前历史账单保留（可导出）', db.commissions.some((c) => c.id === 'h1') && !db.commissions.some((c) => c.id === 'h2'));
  // 惰性过期
  const db2 = S.createDb();
  S.addUser(db2, { id: 'lz', tier: 'cofounder', entitlement_state: 'active', entitlement_expires_at: Date.now() - 1000 });
  ok('惰性过期（expires_at 已过 → expired）', IZ.entitlementState(db2.users.lz) === 'expired');
  ok('惰性过期 → 停算', S.pushCommission(db2, { id: 'lzc', owner_id: 'lz', type: 'global', amount: 10 }) === null);
  // 升级/开通编号重算
  const db3 = S.createDb();
  const g = S.addUser(db3, { id: 'g1', tier: 'none', entitlement_state: 'never_paid' });
  ok('注册未开通 → QZ0001', g.display_id === 'QZ0001');
  IZ.grantEntitlement(db3, 'g1');
  ok('开通 → YH0001（带到期时间）', db3.users.g1.display_id === 'YH0001' && db3.users.g1.entitlement_expires_at > Date.now());
  S.updatePartner(db3, 'g1', { tier: 'cofounder' });
  ok('升联创 → LC0001', db3.users.g1.display_id === 'LC0001');
  db3.users.g1.entitlement_state = 'expired';
  ok('过期回落 → QZ0001', IZ.recomputeDisplayId(db3, 'g1') === 'QZ0001');
  // 旧数据兼容（无权益字段 → active）
  const db4 = S.createDb();
  S.addUser(db4, { id: 'old1', tier: 'vip' });
  ok('存量无权益字段 → active 兼容', db4.users.old1.entitlement_state === 'active' && db4.users.old1.display_id === 'VIP0001');
}

// ═══════════ E. HTTP 端到端（R4/R5/R6/R7） ═══════════
const PORT = 3226;
const BASE = `http://127.0.0.1:${PORT}`;
const { parentLogin } = require('./loginKit.cjs');
const req = (m, p, { token, body } = {}) => fetch(BASE + p, {
  method: m,
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
}).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }));

async function httpTests() {
  const srv = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT, env: { ...process.env, PORT: String(PORT), EXPOSE_DEV_CODE: '1' }, stdio: 'ignore',
  });
  const boot = Date.now();
  while (Date.now() - boot < 15000) {
    try { const r = await fetch(BASE + '/'); if (r.ok) break; } catch (e) { /* retry */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  try {
    const admin = (await req('POST', '/auth/sessions', { body: { channel: 'admin', password: 'admin888' } })).data.token;
    await req('POST', '/api/seed/reset', { token: admin });
    // 库已重置回默认种子 → 此时核对结构才有意义（见 staticDbChecks 注释）
    staticDbChecks();
    console.log('\n[E] HTTP 端到端（真实服务 ' + PORT + '）');

    // ── R5 未开通 = 全功能锁 ──
    const phone = '139' + String(Math.floor(10000000 + Math.random() * 89999999));
    const _code = (await req('POST', '/auth/sms-challenges', { body: { phone, purpose: 'register' } })).data.devCode;
    const reg = await req('POST', '/auth/registrations', { body: { phone, code: _code, password: 'abc123', name: '需求自测', inviteCode: '13800000001' } });
    ok('R5 注册即 never_paid + QZ 编号', reg.status === 200 && /^QZ\d{4,}$/.test(reg.data.user.displayId) && reg.data.entitlement.state === 'never_paid');
    const T = reg.data.token;
    const uid = reg.data.user.id;
    const lockedPaths = [
      ['GET', `/partner/overview?contextId=partner:${uid}`],
      ['GET', '/wallet/withdrawal-options'],
      ['GET', '/addresses'],
      ['GET', '/members'],
      ['GET', '/learning/levels'],
      ['GET', '/materials?type=image'],
      ['POST', '/wallet/withdrawals'],
    ];
    for (const [m, p] of lockedPaths) {
      const r = await req(m, p, { token: T, body: m === 'POST' ? { idempotencyKey: 'k' + Math.random() } : undefined });
      ok(`R5 未开通 → ${m} ${p.split('?')[0]} 锁定（locked+200 元）`, r.status === 200 && r.data && r.data.locked === true && r.data.entitlementAmount === 200);
    }
    ok('R5 未开通 → 导出 403（无账单）', (await req('GET', '/me/income-export', { token: T })).status === 403);
    ok('R5 豁免：bootstrap 可查（下发门禁）', (await req('GET', '/me/bootstrap', { token: T })).data.entitlement.state === 'never_paid');

    // ── R5 开通后解锁 + 编号重算 ──
    const pay = await req('POST', '/me/entitlement-orders', { token: T, body: { idempotencyKey: 'req-ent-1' } });
    ok('R5 开通 → SUCCEEDED + active + 到期时间', pay.data.status === 'SUCCEEDED' && pay.data.entitlement.state === 'active' && pay.data.entitlement.expiresAt > Date.now());
    ok('R5 开通后编号重算（VIP 前缀，注册默认 vip 档）', /^VIP\d{4,}$/.test(pay.data.displayId), pay.data.displayId);
    const unlocked = await req('GET', `/partner/overview?contextId=partner:${uid}`, { token: T });
    ok('R5 开通后报表解锁', unlocked.data.locked === undefined);
    ok('R5 开通后导出 200', (await req('GET', '/me/income-export', { token: T })).status === 200);
    ok('R5 开通幂等（同 key 同 operationId）', (await req('POST', '/me/entitlement-orders', { token: T, body: { idempotencyKey: 'req-ent-1' } })).data.operationId === pay.data.operationId);

    // ── R4 省代徽章：同 LC 前缀，界面身份区分 ──
    const appt = await req('POST', '/api/agent/appoint', { token: admin, body: { partnerId: 'p1', regionType: 'province', regionCode: 'P1' } });
    ok('R4 任命省代成功', appt.status === 200 && appt.data.ok !== false);
    const b1 = await req('GET', '/me/bootstrap', { token: await login('13800000001') });
    ok('R4 省代用户编号仍为 LC 前缀（LC0001）', b1.data.displayId === 'LC0001');
    const agentCtx = (b1.data.businessContexts || []).find((c) => c.module === 'agency');
    ok('R4 徽章：agent 身份 detail 含「省代」', agentCtx && /省代/.test(agentCtx.detail || ''), agentCtx && agentCtx.detail);
    const partnerCtx = (b1.data.businessContexts || []).find((c) => c.module === 'wholesale');
    ok('R4 徽章：partner 身份 detail 为「联创合伙人」', partnerCtx && /联创/.test(partnerCtx.detail || ''));

    // ── R7 合店老板徽章 ──
    const b7 = await req('GET', '/me/bootstrap', { token: await login('13800000007') });
    ok('R7 合店老板编号 TS0007（前缀不带 HD，徽章制）', b7.data.displayId === 'TS0007');
    const csCtx = (b7.data.businessContexts || []).find((c) => c.module === 'costore');
    ok('R7 徽章：costore 身份 detail 含「合店老板」', csCtx && /合店老板/.test(csCtx.detail || ''), csCtx && csCtx.detail);

    // ── R6 过期态 HTTP 表现（导出可用、门禁 frozen） ──
    // 直接改库造过期态（经 admin 接口无法设置，用引擎层已验；此处验导出与 gate 文案）
    const gateExp = IZ.gatePayload({ entitlement_state: 'expired' });
    ok('R6 gatePayload 过期 → frozen + 可导出', gateExp.frozen === true && gateExp.canExportBills === true && /停止计算/.test(gateExp.message));
    const gateNev = IZ.gatePayload({ entitlement_state: 'never_paid' });
    ok('R5 gatePayload 未开通 → 不冻结 + 不可导出', gateNev.frozen === false && gateNev.canExportBills === false);

    // ── R1 一人多身份（p1：联创+省代；p7：天使+合店老板） ──
    ok('R1 p1 同时持有 wholesale+agency 两个身份上下文', (b1.data.businessContexts || []).length >= 2);
    ok('R1 p7 同时持有 wholesale+costore 两个身份上下文', (b7.data.businessContexts || []).length >= 2);

    // ── 收尾：恢复默认种子（保证 data/db.json 干净，不带测试残留） ──
    const reset = await req('POST', '/api/seed/reset', { token: admin });
    ok('测试后 seed reset（db.json 恢复规范种子）', reset.status === 200);
  } finally {
    srv.kill();
  }
}
async function login(phone) {
  return (await parentLogin(req, phone)).data.token;
}

(async () => {
  await httpTests();
  console.log(`\n需求核对自测: PASS=${pass} FAIL=${fail}`);
  process.exit(fail ? 1 : 0);
})();

/**
 * 代理撤销专项验证（2026-10-24 用户拍板）
 * 规则：撤销代理后 → 对外编号 seq 不变、前缀改 QZ（普通用户）；
 *       已赠予的合伙人档位保留（不降档）；派生优先级：权益门禁 QZ > 孩子等级 > 撤销 QZ > 家长档位。
 * 覆盖：store.revokeAgent（定位/消歧/打标/重算编号）、identity.userPrefix 撤销分支、
 *       HTTP 端点 /api/agent/revoke、与孩子等级/权益门禁的交互。
 * 运行：node scripts/verify_agent_revoke.js
 */
const assert = require('assert');
const path = require('path');
const { spawn } = require('child_process');
const S = require('../src/store');
const IZ = require('../src/identity');

const ROOT = path.join(__dirname, '..');
const PORT = 3291;
const BASE = `http://127.0.0.1:${PORT}`;
const { parentLogin } = require('./loginKit.cjs');
const req = (m, p, { token, body } = {}) => fetch(BASE + p, {
  method: m,
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
}).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }));

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  ok  ' + name); } else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' → ' + JSON.stringify(extra) : '')); } };

// ───────────── 1. 引擎层：编号派生（撤销分支） ─────────────
console.log('\n[1] userPrefix 撤销分支');
{
  const db = S.createDb();
  S.addUser(db, { id: 'rv', tier: 'cofounder', entitlement_state: 'active' });
  ok('联创（未撤销）→ LC', IZ.userPrefix(db, db.users.rv) === 'LC');
  db.users.rv.agent_revoked_at = '2026-10-24T00:00:00Z';
  ok('联创撤销后 → QZ（编号不变只换前缀）', IZ.userPrefix(db, db.users.rv) === 'QZ');
  ok('撤销后完整编号 seq 不变（QZ0001）', IZ.displayIdOfUser(db, db.users.rv) === 'QZ0001', IZ.displayIdOfUser(db, db.users.rv));
  // 优先级：权益门禁 > 孩子 > 撤销
  db.users.rv.entitlement_state = 'expired';
  ok('撤销 + 权益过期 → 仍 QZ（门禁优先）', IZ.userPrefix(db, db.users.rv) === 'QZ');
  db.users.rv.entitlement_state = 'active';
  db.members = [{ id: 'k1', userId: 'rv', memberLevel: 'fs', memberSeq: 1 }];
  ok('撤销 + 粉丝孩子 → FS（孩子优先于撤销）', IZ.userPrefix(db, db.users.rv) === 'FS');
  db.members = [];
  db.users.rv.tier = 'vip';
  ok('VIP 撤销后 → QZ（不是 VIP）', IZ.userPrefix(db, db.users.rv) === 'QZ');
  db.users.rv.agent_revoked_at = null;
  ok('撤销标记清除 → 恢复 VIP', IZ.userPrefix(db, db.users.rv) === 'VIP');
}

// ───────────── 2. 引擎层：revokeAgent ─────────────
console.log('\n[2] store.revokeAgent');
{
  const db = S.createDb();
  S.addUser(db, { id: 'p', tier: 'angel', entitlement_state: 'active' });
  S.appointAgent(db, { partnerId: 'p', regionType: 'district', regionCode: 'D1' }); // 赠私董
  const u = db.users.p;
  ok('区县代任命 → 档位赠私董 + 编号 SD', u.tier === 'private' && u.display_id.startsWith('SD'));
  const seqBefore = u.seq;
  const r = S.revokeAgent(db, { partnerId: 'p', reason: '考核未过' });
  ok('撤销 → 代理记录摘除', db.regionalAgents.length === 0);
  ok('撤销 → 编号 seq 不变', u.seq === seqBefore);
  ok('撤销 → 前缀改 QZ', u.display_id === 'QZ' + String(seqBefore).padStart(4, '0'), u.display_id);
  ok('撤销 → 档位保留私董（不降档）', u.tier === 'private');
  ok('撤销 → 打标 revoked_at/count/reason', !!u.agent_revoked_at && u.agent_revoked_count === 1 && u.agent_revoked_reason === '考核未过');
  ok('返回体带 agentId/regionType/displayId', r.revoked === true && r.regionType === 'district' && /^QZ\d{4,}$/.test(r.displayId));
  // 重复撤销报错
  assert.throws(() => S.revokeAgent(db, { partnerId: 'p' }), /没有代理身份/);
  ok('重复撤销 → 抛错', true);
  // 多代理身份须消歧
  S.addUser(db, { id: 'q', tier: 'cofounder', entitlement_state: 'active' });
  S.appointAgent(db, { partnerId: 'q', regionType: 'province', regionCode: 'P1' });
  S.appointAgent(db, { partnerId: 'q', regionType: 'city', regionCode: 'C1' });
  assert.throws(() => S.revokeAgent(db, { partnerId: 'q' }), /多个代理身份/);
  ok('多代理身份不指定 → 抛错要求消歧', true);
  const rq = S.revokeAgent(db, { partnerId: 'q', regionType: 'city' });
  ok('按 regionType 消歧撤销成功', rq.regionType === 'city' && db.regionalAgents.filter((a) => a.partner_id === 'q').length === 1);
  const rq2 = S.revokeAgent(db, { partnerId: 'q', agentId: db.regionalAgents.find((a) => a.partner_id === 'q').id });
  ok('按 agentId 撤销最后一条成功', db.regionalAgents.length === 0 && db.users.q.agent_revoked_count === 2);
  // 不存在用户
  assert.throws(() => S.revokeAgent(db, { partnerId: 'nope' }), /合伙人不存在/);
  ok('撤销不存在用户 → 抛错', true);
}

// ───────────── 3. HTTP 端到端 ─────────────
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
    console.log('\n[3] HTTP 端到端（真实服务 ' + PORT + '）');

    // p4（VIP-丁）任命省代 → 赠联创 → LC0004
    const ap = await req('POST', '/api/agent/appoint', { token: admin, body: { partnerId: 'p4', regionType: 'province', regionCode: 'P1' } });
    ok('任命省代成功（赠联创）', ap.data && ap.data.ok === true);
    const b4a = await parentLogin(req, '13800000004');
    const T4 = b4a.data.token;
    const boot4a = await req('GET', '/me/bootstrap', { token: T4 });
    ok('任命后 p4 编号 → LC0004', boot4a.data.displayId === 'LC0004', boot4a.data.displayId);

    // 撤销 → QZ0004（seq 不变）
    const rv = await req('POST', '/api/agent/revoke', { token: admin, body: { partnerId: 'p4', reason: '测试撤销' } });
    ok('撤销端点成功', rv.data && rv.data.ok === true && rv.data.regionType === 'province');
    const boot4b = await req('GET', '/me/bootstrap', { token: T4 });
    ok('撤销后 p4 编号 → QZ0004（编号不变前缀改）', boot4b.data.displayId === 'QZ0004', boot4b.data.displayId);
    const agents = await req('GET', '/api/agent', { token: admin });
    ok('代理列表中 p4 已摘除', !(agents.data.agents || agents.data.items || []).some((a) => a.partner_id === 'p4'));

    // 撤销 + 孩子等级：孩子优先（p4 加孩子激活粉丝 → FS0004）
    const c1 = await req('POST', '/members', { token: T4, body: { name: '小丁', gradeCode: 'G1', genderCode: 'male', idempotencyKey: 'rv-mb-1' } });
    ok('撤销后仍可添加孩子（权益正常）', c1.status === 200);
    const kid = c1.data.member.id;
    const act = await req('POST', '/activations', { token: T4, body: { code: 'NS-FS-0001', targetType: 'fs', memberId: kid, idempotencyKey: 'rv-act-fs' } });
    ok('激活粉丝孩子成功', act.status === 200);
    const boot4c = await req('GET', '/me/bootstrap', { token: T4 });
    ok('撤销家长+粉丝孩子 → FS0004（孩子优先）', boot4c.data.displayId === 'FS0004', boot4c.data.displayId);

    // 未指定 partnerId → 400
    const bad = await req('POST', '/api/agent/revoke', { token: admin, body: { reason: 'x' } });
    ok('缺 partnerId → 400', bad.status === 400);
    // 收尾：先重置种子（服务还活着，重置才生效），再杀服务——避免把测试残留留给下一个脚本
    await req('POST', '/api/seed/reset', { token: admin }).catch(() => {});
  } finally {
    srv.kill();
  }
}

(async () => {
  await httpTests();
  console.log(`\n代理撤销验证: PASS=${pass} FAIL=${fail}`);
  process.exit(fail ? 1 : 0);
})();

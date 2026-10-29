/**
 * verify_free_upgrade_visual.js — 验证「拉人免费升档」已可视化到团队树/关系变更/明细接口。
 * 覆盖两层：
 *   A. store 层：S.tree() 每个节点带 referralFreeUpgrade / name / principal_tier；S.maybeGrantFreeUpgrade 触发后进度联动。
 *   B. HTTP 层：/api/free-upgrade 明细结构正确；/api/team 节点带进度；rebind 返回 freeUpgrade。
 */
const S = require('../src/store');
const C = require('../src/commission');
const http = require('http');
const { URL } = require('url');

let PASS = 0, FAIL = 0;
const ok = (name, cond, got, expect) => {
  if (cond) { PASS++; console.log(`  ✅ ${name}`); }
  else { FAIL++; console.log(`  ❌ ${name}\n       实际: ${JSON.stringify(got)}  期望: ${JSON.stringify(expect)}`); }
};
const near = (a, b) => Math.abs(a - b) < 1e-6;

// ───────────────────────── A. store 层 ─────────────────────────
console.log('\n═══ A. store 层：团队树节点可视化 ═══');
{
  const db = S.createDb();
  const U = S.addUser(db, { id: 'U', name: '上级-A', tier: 'angel', principal_tier: 'angel', upline_id: null, entitlement_state: 'active', seq: 1 });
  db.quotaLedger['U'] = 99;
  // U 直推 3 名：在被推荐时与 U 同级(angel)，且各自 angel→private 付费升档
  for (const id of ['D1', 'D2', 'D3']) {
    const d = S.addUser(db, { id, name: id, tier: 'angel', principal_tier: 'angel', upline_id: 'U', entitlement_state: 'active', seq: 2 });
    d.referral_upline_tier = 'angel'; d.referral_tier = 'angel';
    S.addOrder(db, { id: S.nextId(db, 'o'), type: 'upgrade', buyer_id: id, oldTier: 'angel', packageTier: 'private', actual_paid: 30000, status: 'paid' });
  }
  // 触发发放
  S.maybeGrantFreeUpgrade(db, 'U');

  const t = S.tree(db, 'U');
  ok('tree 根节点含 name', t.name === '上级-A', t.name);
  ok('tree 根节点含 principal_tier', t.principal_tier === 'angel', t.principal_tier);
  ok('tree 根节点含 referralFreeUpgrade', !!t.referralFreeUpgrade, t.referralFreeUpgrade);
  ok('tree 根节点进度 applied=1（已升 1 档）', t.referralFreeUpgrade.applied === 1, t.referralFreeUpgrade && t.referralFreeUpgrade.applied);
  ok('tree 根节点进度 required=3', t.referralFreeUpgrade.required === 3, t.referralFreeUpgrade && t.referralFreeUpgrade.required);
  ok('tree 子节点（D1）也带 referralFreeUpgrade', t.children.length === 3 && !!t.children[0].referralFreeUpgrade, t.children.map((c) => !!c.referralFreeUpgrade));
  ok('tree 子节点 name 可见', t.children[0].name === 'D1', t.children[0].name);
}

// ───────────────────────── B. HTTP 层 ─────────────────────────
function req(port, m, p, token, body) {
  return new Promise((resolve, reject) => {
    const u = new URL('http://127.0.0.1:' + port + p);
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({ hostname: '127.0.0.1', port, path: u.pathname + u.search, method: m,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, },
      (res) => { let buf = ''; res.on('data', (c) => (buf += c)); res.on('end', () => resolve({ s: res.statusCode, d: JSON.parse(buf || '{}') })); });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

(async () => {
  const PORT = 3217;
  // 启动一个独立端口的服务（不动默认 3000 端口的潜在占用）
  let child;
  try {
    const { spawn } = require('child_process');
    child = spawn(process.execPath, ['server.js'], { cwd: __dirname + '/..', env: { ...process.env, PORT: String(PORT), EXPOSE_DEV_CODE: '1' } });
    await new Promise((r) => setTimeout(r, 1500));

    const adminLogin = await req(PORT, 'POST', '/auth/sessions', null, { channel: 'admin', password: 'admin888' });
    const A = adminLogin.d.token;
    ok('后台登录 200', adminLogin.s === 200 && !!A, adminLogin.s);

    // 重置种子
    await req(PORT, 'POST', '/api/seed/reset', A);

    // B1. /api/free-upgrade 明细结构（p1 联创）
    const fu = await req(PORT, 'GET', '/api/free-upgrade?userId=p1', A);
    ok('GET /api/free-upgrade 200', fu.s === 200, fu.s);
    ok('  含 principalTier', fu.d.principalTier === 'cofounder', fu.d.principalTier);
    ok('  含 principalAmount = 239800', fu.d.principalAmount === 239800, fu.d.principalAmount);
    ok('  含 progress.required=3', fu.d.progress && fu.d.progress.required === 3, fu.d.progress && fu.d.progress.required);
    ok('  含 qualifying 数组', Array.isArray(fu.d.qualifying), fu.d.qualifying);
    ok('  含 freeUpgradeLog 数组', Array.isArray(fu.d.freeUpgradeLog), fu.d.freeUpgradeLog);

    // B2. /api/team 节点带进度（以 p3 登录，p3 有下级 p4/p7）
    const p3Login = await req(PORT, 'POST', '/auth/login', null, { channel: 'parent', phone: '13800000003', password: process.env.SEED_PASSWORD || 'Naoshang@2026' });
    const P3 = p3Login.d.token;
    const team = await req(PORT, 'GET', '/api/team', P3);
    ok('GET /api/team 200', team.s === 200, team.s);
    const nodeHasFU = (n) => !!n.referralFreeUpgrade;
    const allNodes = [];
    (function walk(n){ if(!n) return; allNodes.push(n); (n.children||[]).forEach(walk); })(team.d);
    ok('  /api/team 每个节点含 referralFreeUpgrade', allNodes.length>0 && allNodes.every(nodeHasFU), allNodes.map((n)=>!!n.referralFreeUpgrade));
    ok('  /api/team 节点含 name', allNodes.every((n)=>n.name!=null), allNodes.map((n)=>n.name));

    // B3. rebind 返回 freeUpgrade（把 p4 重绑到 p3 → 看 p3 进度）
    const rb = await req(PORT, 'POST', '/api/relation/rebind', A, { partnerId: 'p4', newUplineId: 'p3' });
    ok('POST /api/relation/rebind 200', rb.s === 200, rb.s);
    ok('  rebind 返回 freeUpgrade.self', !!rb.d.freeUpgrade && !!rb.d.freeUpgrade.self, rb.d.freeUpgrade && rb.d.freeUpgrade.self);
    ok('  rebind 返回 freeUpgrade.newUpline', !!rb.d.freeUpgrade && rb.d.freeUpgrade.newUpline != null, rb.d.freeUpgrade && rb.d.freeUpgrade.newUpline);

  } catch (e) {
    console.log('  ⚠️ HTTP 测试异常:', e.message);
    FAIL++;
  } finally {
    if (child) child.kill();
  }

  console.log('\n════════════════════════════════════════');
  console.log(`自由升档可视化验证：通过 ${PASS} / 失败 ${FAIL}`);
  process.exit(FAIL ? 1 : 0);
})();

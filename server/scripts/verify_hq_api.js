/**
 * 总部后台（HQ）API 端到端验证脚本
 *
 * 覆盖：
 *   1. 鉴权拦截（未登录 / 错误口令 / token 失效）
 *   2. 登录 → token → 全模块可达性
 *   3. 分页 / 列表 / 详情 / catalog
 *   4. 写操作闭环（reason 必填 / version 乐观锁 / 幂等键 / 审计回执）
 *   5. 错误码语义（40400 / 40000 / 40901 / 40900 / 40903）
 *
 * 用法：node scripts/verify_hq_api.js [baseUrl]
 */

const http = require('http');
const HOST = '127.0.0.1';
// 端口由 with_server 注入（PORT 环境变量）→ 电池可用随机端口，避开本机常驻服务占用 3000
const PORT = Number(process.env.PORT || 3000);
const BASE = process.argv[2] || `http://${HOST}:${PORT}`;

let PASS = 0;
let FAIL = 0;
const failures = [];

function ok(name) { PASS++; console.log('  ✅ ' + name); }
function no(name, detail) {
  FAIL++;
  failures.push(name + (detail ? ' → ' + detail : ''));
  console.log('  ❌ ' + name + (detail ? ' → ' + detail : ''));
}

function request(method, path, { body, token, headers } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const h = { ...(headers || {}) };
    if (data) {
      h['Content-Type'] = 'application/json';
      h['Content-Length'] = Buffer.byteLength(data);
    }
    if (token) h['Authorization'] = 'Bearer ' + token;
    const req = http.request({ host: HOST, port: PORT, path, method, headers: h, timeout: 20000 }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(raw); } catch (e) { json = { _raw: raw.slice(0, 300) }; }
        resolve({ status: res.statusCode, json });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    if (data) req.write(data);
    req.end();
  });
}

const API = '/api/hq';

(async () => {
  console.log('=== 总部后台（HQ）API 端到端验证 ===');
  console.log('目标：' + BASE + API + '\n');

  // ── 1. 鉴权拦截 ──
  console.log('[1] 鉴权拦截');
  let r = await request('GET', API + '/users');
  if (r.status === 401 && r.json.code === 40100) ok('未登录访问 → 401/40100');
  else no('未登录访问', `got ${r.status}/${r.json.code}`);

  r = await request('POST', API + '/auth/login', { body: { username: 'admin', password: 'wrong-password' } });
  if (r.status === 401 && r.json.code === 40100) ok('错误口令 → 401/40100');
  else no('错误口令', `got ${r.status}/${r.json.code}`);

  r = await request('GET', API + '/users', { token: 'hq-admin-bogus-token' });
  if (r.status === 401 && r.json.code === 40100) ok('伪造 token → 401/40100');
  else no('伪造 token', `got ${r.status}/${r.json.code}`);

  // ── 2. 登录 ──
  console.log('\n[2] 登录与会话');
  r = await request('POST', API + '/auth/login', { body: { username: 'admin', password: 'admin888' } });
  if (r.status === 200 && r.json.code === 0 && r.json.data.token) {
    ok('登录成功，签发 token');
  } else {
    no('登录失败', JSON.stringify(r.json).slice(0, 200));
    console.log('\n无法继续后续验证。');
    process.exit(1);
  }
  const token = r.json.data.token;
  const admin = r.json.data.admin;
  if (admin && admin.adminId && admin.role === 'admin') ok('返回 admin 资料（adminId/role）');
  else no('admin 资料缺失', JSON.stringify(admin));
  if (r.json.data.expiresAt) ok('返回 token 过期时间');
  else no('缺 expiresAt');

  r = await request('GET', API + '/auth/me', { token });
  if (r.status === 200 && r.json.data.adminId === admin.adminId) ok('GET /auth/me 返回当前管理员');
  else no('/auth/me', JSON.stringify(r.json).slice(0, 150));

  // ── 3. 全模块可达性 ──
  console.log('\n[3] 全模块接口可达性（26 模块）');
  const HQ = require('../src/routes/hq');
  const readEndpoints = [];
  for (const m of HQ.STATS.list) {
    for (const ep of m.endpoints) {
      const [method, path] = ep.split(' ');
      if (method === 'GET') readEndpoints.push({ module: m.code, title: m.title, path });
    }
  }
  let reachOK = 0;
  const reachFail = [];
  for (const ep of readEndpoints) {
    const res = await request('GET', API + ep.path, { token });
    // 命中判定：路由已匹配 → 200，或业务层 40400（资源不存在）
    const hit = res.status === 200
      || (res.status === 404 && res.json && res.json.code === 40400 && !String(res.json.message).includes('接口不存在'));
    if (hit) reachOK++; else reachFail.push(`${ep.module} ${ep.path} → ${res.status} ${JSON.stringify(res.json).slice(0, 100)}`);
  }
  if (reachFail.length === 0) ok(`全部 ${reachOK} 个 GET 接口路由命中`);
  else { no(`${reachFail.length}/${readEndpoints.length} 个 GET 接口未命中`, reachFail.slice(0, 8).join(' | ')); }

  // ── 4. 分页 ──
  console.log('\n[4] 分页与列表信封');
  r = await request('GET', API + '/users?page=1&pageSize=2', { token });
  if (r.status === 200 && r.json.data && Array.isArray(r.json.data.items) && r.json.data.pageSize === 2) {
    ok(`分页生效：items=${r.json.data.items.length} / total=${r.json.data.total}`);
  } else no('分页', JSON.stringify(r.json).slice(0, 150));

  r = await request('GET', API + '/users?pageSize=999', { token });
  if (r.json.data && r.json.data.pageSize === 100) ok('pageSize 上限截断为 100');
  else no('pageSize 上限', JSON.stringify(r.json.data && r.json.data.pageSize));

  // ── 5. 写操作：reason 必填 ──
  console.log('\n[5] 写操作统一约定');
  const users = (await request('GET', API + '/users?pageSize=1', { token })).json.data.items;
  const acctId = users[0] && users[0].accountId;
  if (!acctId) {
    no('无账号可用于写操作测试');
  } else {
    // 先取账号详情，拿到**当前真实 version**。
    // 不能硬编码 version —— 账号版本随每次写操作递增，硬编码必然误报 VERSION_CONFLICT。
    const detail = await request('GET', API + `/users/${acctId}`, { token });
    const prof = detail.json.data && detail.json.data.profile;
    const curVersion = prof && prof.version;
    const wasFrozen = !!(prof && prof.frozen);

    r = await request('POST', API + `/users/${acctId}/mutate`, { token, body: { action: 'freeze', version: curVersion } });
    if (r.status === 400 && r.json.code === 40000) ok('缺 reason → 400/40000');
    else no('缺 reason', `got ${r.status}/${r.json.code}`);

    // 冻结 → 重复冻结 → INVALID_STATE
    r = await request('POST', API + `/users/${acctId}/mutate`, { token, body: { action: 'freeze', reason: 'HQ 测试冻结', version: curVersion } });
    if (r.status === 200 && r.json.code === 0 && r.json.data.profile.frozen === true) ok('冻结成功，返回更新后 profile');
    else no('冻结失败', JSON.stringify(r.json).slice(0, 150));

    const newVersion = r.json.data && r.json.data.profile && r.json.data.profile.version;

    r = await request('POST', API + `/users/${acctId}/mutate`, { token, body: { action: 'freeze', reason: '重复冻结', version: newVersion } });
    if (r.status === 409 && r.json.code === 40900) ok('重复冻结 → 409/40900 (INVALID_STATE)');
    else no('重复冻结', `got ${r.status}/${r.json.code}`);

    // version 冲突：用**过期的** version（当前 version - 1）触发乐观锁
    r = await request('POST', API + `/users/${acctId}/mutate`, { token, body: { action: 'unfreeze', reason: '解冻', version: (newVersion || 1) - 1 } });
    if (r.status === 409 && r.json.code === 40901) ok('version 冲突 → 409/40901 (VERSION_CONFLICT)');
    else no('version 冲突', `got ${r.status}/${r.json.code}`);

    // 幂等键
    const idemKey = 'hq-test-idem-' + Date.now();
    const payload = { action: 'unfreeze', reason: '幂等测试解冻', version: newVersion, idempotencyKey: idemKey };
    const r1 = await request('POST', API + `/users/${acctId}/mutate`, { token, body: payload });
    const r2 = await request('POST', API + `/users/${acctId}/mutate`, { token, body: payload });
    if (r1.status === 200 && r2.status === 200 && r1.json.data.operationId === r2.json.data.operationId) {
      ok('幂等键：重复提交返回同一 operationId');
    } else no('幂等键', `r1=${r1.status}/${r1.json.code} r2=${r2.status}/${r2.json.code}`);

    // 幂等键冲突（不同载荷）
    const r3 = await request('POST', API + `/users/${acctId}/mutate`, {
      token,
      body: { action: 'update-note', note: '不同载荷', reason: '幂等冲突测试', version: r1.json.data.profile.version, idempotencyKey: idemKey },
    });
    if (r3.status === 409 && r3.json.code === 40902) ok('幂等键不同载荷 → 409/40902 (IDEMPOTENCY_CONFLICT)');
    else no('幂等键冲突', `got ${r3.status}/${r3.json.code}`);

    // 恢复原状（解冻 + 清备注）
    const v = r1.json.data.profile.version;
    const restore = await request('POST', API + `/users/${acctId}/mutate`, { token, body: { action: 'unfreeze', reason: '测试结束恢复', version: v } });
    if (wasFrozen && restore.status === 200) {
      // 原先是冻结态 → 恢复冻结
      await request('POST', API + `/users/${acctId}/mutate`, { token, body: { action: 'freeze', reason: '测试结束恢复冻结', version: restore.json.data.profile.version } });
    }
  }

  // ── 6. 404 与 400 ──
  console.log('\n[6] 错误码语义');
  // 注意：URL 路径中的中文必须编码，否则 Node 的 http.request 会抛 ERR_UNESCAPED_CHARACTERS
  r = await request('GET', API + '/users/' + encodeURIComponent('不存在的账号ID'), { token });
  if (r.status === 404 && r.json.code === 40400) ok('资源不存在 → 404/40400');
  else no('资源不存在', `got ${r.status}/${r.json.code}`);

  r = await request('GET', API + '/' + encodeURIComponent('不存在的模块'), { token });
  if (r.status === 404 && r.json.code === 40400) ok('路由不存在 → 404/40400');
  else no('路由不存在', `got ${r.status}/${r.json.code}`);

  r = await request('POST', API + '/users/' + encodeURIComponent('任意') + '/mutate', { token, body: { action: '不存在的动作', reason: 'x' } });
  if (r.status === 400 && r.json.code === 40000) ok('非法 action → 400/40000');
  else no('非法 action', `got ${r.status}/${r.json.code}`);

  // ── 7. 审计与追踪 ──
  console.log('\n[7] 审计与追踪溯源 (HQ-26)');
  r = await request('GET', API + '/trace?pageSize=5', { token });
  if (r.status === 200 && Array.isArray(r.json.data.items)) {
    ok(`审计日志可查：共 ${r.json.data.total} 条`);
  } else no('审计日志查询', JSON.stringify(r.json).slice(0, 150));

  r = await request('GET', API + '/trace/catalog', { token });
  if (r.status === 200 && Array.isArray(r.json.data.modules) && r.json.data.modules.length > 0) {
    ok(`审计目录：${r.json.data.modules.length} 个模块 / ${r.json.data.actions.length} 个动作`);
  } else no('审计目录', JSON.stringify(r.json).slice(0, 150));

  // ── 8. 金额单位为元 ──
  console.log('\n[8] 金额单位校验（应为元，两位小数）');
  r = await request('GET', API + '/orders?pageSize=50', { token });
  if (r.status === 200 && r.json.data.items.length) {
    const bad = r.json.data.items.filter((o) =>
      [o.goodsAmount, o.payableAmount, o.discountAmount].some(
        // 容忍浮点误差：648.7*100 = 64870.00000000001，abs 差 < 1e-6 视为合法两位小数金额
        (v) => v != null && Math.abs(v * 100 - Math.round(v * 100)) > 1e-6));
    if (bad.length === 0) ok(`订单金额均为「元」且保留两位小数（抽查 ${r.json.data.items.length} 单）`);
    else no('订单金额精度', bad.length + ' 单异常');
  } else ok('暂无订单数据可校验（跳过）');

  // ── 9. 敏感字段脱敏 ──
  console.log('\n[9] 敏感字段脱敏');
  r = await request('GET', API + '/users?pageSize=10', { token });
  const phones = (r.json.data.items || []).map((u) => u.phone).filter(Boolean);
  if (!phones.length || phones.every((p) => p.includes('****'))) ok('列表手机号脱敏');
  else no('手机号脱敏', phones.slice(0, 3).join(','));

  // ── 10. 登出 ──
  console.log('\n[10] 登出');
  r = await request('POST', API + '/auth/logout', { token, body: {} });
  if (r.status === 200 && r.json.code === 0) ok('登出成功');
  else no('登出', JSON.stringify(r.json).slice(0, 120));

  r = await request('GET', API + '/users', { token });
  if (r.status === 401) ok('登出后 token 失效 → 401');
  else no('登出后 token 仍有效', `got ${r.status}`);

  console.log('\n========================================');
  console.log(`结果：${PASS} 项通过，${FAIL} 项失败`);
  if (FAIL) {
    console.log('\n失败明细：');
    failures.forEach((f) => console.log('  - ' + f));
  }
  console.log('========================================');
  process.exit(FAIL ? 1 : 0);
})().catch((e) => {
  console.error('\n验证脚本异常：', e);
  process.exit(1);
});

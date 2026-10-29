#!/usr/bin/env node
/**
 * 经营身份（联营/合店/批发）前后端契约验证（2026-10-28）
 *
 * 背景：用户反馈「点击联营不显示收益内容」，前端报「经营身份配置异常」。
 *   根因不在前端，而是**后端 /me/bootstrap 的 businessContexts 契约缺口**：
 *   后端只发 id/accountId/module/label/detail/capabilities/validUntil，
 *   前端还要求 costore 带 storeId+contractId、agency 带 assignmentId+agencyType；
 *   且模块名后端叫 partner/agent、前端叫 wholesale/agency → 身份被过滤掉。
 *
 * 本脚本按**前端真实判据**（src/services/business.js getBusinessContexts）
 * 校验后端返回，并顺带比对后端能力点清单与前端 catalog.js 是否漂移。
 *
 * 覆盖：
 *   ① /me/bootstrap.businessContexts 满足前端全部校验（格式/字段/枚举/唯一性）
 *   ② module 名与前端 catalog.js 的 businessModules 对齐
 *   ③ capabilities 覆盖前端 businessTools 的全部功能点（不多不少不少漏）
 *   ④ 每个 agency/costore 身份都能命中对应的 /agency/overview、/costore/overview
 *   ⑤ 一个用户多个代理身份（省代+市代）时能分别选中并返回各自数据
 *
 * 运行：node scripts/verify_business_contract.js
 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DB_SRC = path.join(ROOT, 'data', 'db.json');
const DB_COPY = path.join(ROOT, 'tmp', 'business_contract.json');
const PORT = 3397;
const BASE = `http://127.0.0.1:${PORT}`;
const FRONT_SRC = process.env.FRONT_SRC || 'E:\\脑商ai1\\src\\features\\business\\catalog.js';
const PASSWORD = process.env.SEED_PASSWORD || ['Naoshang', '@', '2026'].join('');

/** 被测账号：分别覆盖「只有合伙人+合店」「省代」「省代+市代」「单店代理」「区县代理」 */
const ACCOUNTS = [
  { phone: '13900001001', label: '联创合伙人(有合店)' },
  { phone: '13900001002', label: '省代-乙' },
  { phone: '13800000001', label: '总部联创-甲(省代+市代)' },
  { phone: '13900001003', label: '单店代理-丙' },
  { phone: '13900001010', label: '区县代理-癸' },
];

let pass = 0, fail = 0;
const failures = [];
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + label + (extra !== undefined ? '  ' + extra : '')); }
  else { fail++; failures.push(label + (extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 220) : '')); console.log('  ✗ ' + label + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 220) : '')); }
}
function head(t) { console.log('\n【' + t + '】'); }

function req(method, p, { body, token } = {}) {
  return new Promise((resolve) => {
    const data = body !== undefined ? JSON.stringify(body) : null;
    const h = { 'Content-Type': 'application/json' };
    if (token) h.Authorization = 'Bearer ' + token;
    if (data) h['Content-Length'] = Buffer.byteLength(data);
    const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method, headers: h, timeout: 15000 }, (res) => {
      let t = ''; res.on('data', (c) => (t += c));
      res.on('end', () => { let j = null; try { j = JSON.parse(t); } catch (e) {} resolve({ status: res.statusCode, data: j, raw: t }); });
    });
    r.on('error', (e) => resolve({ status: 0, data: null, raw: e.message }));
    if (data) r.write(data);
    r.end();
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 从前端源码里解析模块 id 与功能点，用于比对后端是否漂移 */
function parseFrontCatalog() {
  const out = { modules: [], tools: [] };
  try {
    const src = fs.readFileSync(FRONT_SRC, 'utf8');
    const modBlock = src.match(/export const businessModules\s*=\s*\[([\s\S]*?)\]/);
    if (modBlock) {
      for (const m of modBlock[1].matchAll(/id:\s*'([^']+)'/g)) out.modules.push(m[1]);
    }
    const toolBlock = src.match(/export const businessTools\s*=\s*\[([\s\S]*?)\n\]/);
    if (toolBlock) {
      for (const m of toolBlock[1].matchAll(/tool\('([^']+)'\s*,\s*'([^']+)'/g)) out.tools.push({ id: m[1], module: m[2] });
    }
  } catch (e) { /* 前端源码不可达时跳过比对 */ }
  return out;
}

/** 前端 getBusinessContexts() 的原始判据（逐字照抄 src/services/business.js） */
function frontendRows(ctxs, accountId) {
  const MODULES = ['wholesale', 'costore', 'agency'];
  return (ctxs || []).filter((item) => item.accountId === accountId
    && MODULES.includes(item.module)
    && (!item.validUntil || Date.parse(item.validUntil) > Date.now()));
}
function frontendViolations(rows) {
  const AGENCY_TYPES = ['STORE', 'COUNTY', 'CITY', 'PROVINCE'];
  const bad = [];
  for (const item of rows) {
    if (!item.id) bad.push({ id: item.id, why: '缺 id' });
    if (!Array.isArray(item.capabilities)) bad.push({ id: item.id, why: 'capabilities 非数组' });
    if (item.module === 'costore' && (!item.storeId || !item.contractId)) bad.push({ id: item.id, why: 'costore 缺 storeId/contractId' });
    if (item.module === 'agency' && (!item.assignmentId || !AGENCY_TYPES.includes(item.agencyType))) bad.push({ id: item.id, why: 'agency 缺 assignmentId 或 agencyType 非法: ' + item.agencyType });
  }
  if (new Set(rows.map((r) => r.id)).size !== rows.length) bad.push({ id: '(重复)', why: 'context id 不唯一' });
  return bad;
}

(async () => {
  // ── 起隔离实例（真实库副本，绝不动生产数据）────────────────────
  fs.mkdirSync(path.join(ROOT, 'tmp'), { recursive: true });
  fs.copyFileSync(DB_SRC, DB_COPY);
  const srv = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT, env: { ...process.env, PORT: String(PORT), DB_FILE: DB_COPY, EXPOSE_DEV_CODE: '1' }, stdio: 'ignore',
  });
  const boot = Date.now();
  let up = false;
  while (Date.now() - boot < 15000) {
    try { const r = await fetch(BASE + '/'); if (r.ok) { up = true; break; } } catch (e) { /* retry */ }
    await sleep(200);
  }
  if (!up) { console.error('隔离服务未启动'); srv.kill('SIGKILL'); process.exit(1); }

  console.log('════════ 经营身份前后端契约验证 ════════');
  const front = parseFrontCatalog();
  if (front.modules.length) {
    head('0. 前端契约基线');
    console.log('  前端模块: ' + front.modules.join(', '));
    console.log('  前端功能点: ' + front.tools.length + ' 个');
  }

  const seenAgency = [];
  const tokens = new Map();
  const allCaps = new Set();
  for (const acc of ACCOUNTS) {
    head(`${acc.label}（${acc.phone}）`);
    const login = await req('POST', '/auth/login', { body: { phone: acc.phone, password: PASSWORD, channel: 'parent' } });
    const token = login.data && login.data.token;
    if (!token) { check('登录', false, login.raw.slice(0, 120)); continue; }
    const uid = login.data.user.id;
    tokens.set(uid, token);
    check('登录成功', true, 'user=' + login.data.user.displayId);

    const bs = await req('GET', '/me/bootstrap', { token });
    const ctxs = bs.data && bs.data.businessContexts;
    check('/me/bootstrap 返回 businessContexts 数组', Array.isArray(ctxs), Array.isArray(ctxs) ? ctxs.length + ' 条' : String(ctxs));

    const rows = frontendRows(ctxs, uid);
    const violations = frontendViolations(rows);
    check('前端判据全部通过（否则前端抛「经营身份配置异常」）', violations.length === 0, violations);

    // 模块名对齐
    if (front.modules.length) {
      const badMod = rows.filter((r) => !front.modules.includes(r.module)).map((r) => r.module);
      check('module 名与前端 businessModules 对齐', badMod.length === 0, badMod);
    }

    // 能力点：本身份的模块功能点必须齐全（store-management 只对单店代理开放）
    if (front.tools.length) {
      for (const row of rows) {
        const own = front.tools.filter((t) => t.module === row.module).map((t) => row.module + ':' + t.id);
        const have = new Set(row.capabilities || []);
        const expect = own.filter((c) => c !== 'agency:store-management' || row.agencyType === 'STORE');
        const miss = expect.filter((c) => !have.has(c));
        check(`身份 ${row.module}${row.agencyType ? '/' + row.agencyType : ''} 的功能点齐全`, miss.length === 0, { missing: miss });
        (row.capabilities || []).forEach((c) => allCaps.add(c));
      }
    }

    // 每个身份都能命中自己的 overview
    for (const row of rows) {
      if (row.module === 'agency') {
        seenAgency.push(row);
        const r = await req('GET', '/agency/overview?contextId=' + encodeURIComponent(row.id) + '&assignmentId=' + encodeURIComponent(row.assignmentId || ''), { token });
        check(`agency 身份可查 overview（${row.agencyType}）`, r.status === 200 && r.data && r.data.agencyType === row.agencyType,
          r.status === 200 ? 'agencyType=' + (r.data && r.data.agencyType) + ' monthIncome=' + (r.data && r.data.monthIncome) : r.raw.slice(0, 140));
        if (row.agencyType === 'STORE') {
          const w = await req('GET', '/agency/store-workspace?contextId=' + encodeURIComponent(row.id) + '&assignmentId=' + encodeURIComponent(row.assignmentId || '') + '&storeId=' + encodeURIComponent(row.storeId || ''), { token });
          check('单店代理可进门店工作台（门店管理入口）', w.status === 200, w.status === 200 ? 'ok' : 'HTTP ' + w.status + ' ' + w.raw.slice(0, 100));
        }
      }
      if (row.module === 'costore') {
        const r = await req('GET', '/costore/overview?contextId=' + encodeURIComponent(row.id) + '&contractId=' + encodeURIComponent(row.contractId || ''), { token });
        check('costore 身份可查 overview', r.status === 200 && r.data && r.data.accountId === uid,
          r.status === 200 ? 'storeId=' + (r.data && r.data.storeId) + ' monthlyFee=' + (r.data && r.data.monthlyFee) : r.raw.slice(0, 140));
      }
    }
    console.log('  · 本账号身份: ' + (rows.length ? rows.map((r) => r.module + (r.agencyType ? '/' + r.agencyType : '') + '[' + r.id + ']').join('  ') : '（无）'));
  }

  // 全部账号能力点并集 → 必须覆盖前端全部功能点（防止后端漏发某个功能点）
  if (front.tools.length) {
    const need = new Set(front.tools.map((t) => t.module + ':' + t.id));
    const missing = [...need].filter((c) => !allCaps.has(c));
    const extra = [...allCaps].filter((c) => !need.has(c));
    head('7. 能力点总表（后端 ↔ 前端 catalog.js）');
    check('能力点并集覆盖前端全部功能点', missing.length === 0, { missing });
    check('能力点无前端不存在的功能点', extra.length === 0, { extra });
    console.log('  前端功能点 ' + need.size + ' 个；后端下发 ' + allCaps.size + ' 个');
  }

  head('6. 多身份用户可分别选中（省代 + 市代）');
  const multi = seenAgency.filter((r) => r.agencyType === 'PROVINCE' || r.agencyType === 'CITY');
  const byUser = new Map();
  for (const r of seenAgency) {
    if (!byUser.has(r.accountId)) byUser.set(r.accountId, []);
    byUser.get(r.accountId).push(r);
  }
  for (const [uid, list] of byUser) {
    if (list.length < 2) continue;
    const types = list.map((x) => x.agencyType).join('+');
    const token = tokens.get(uid);
    const results = [];
    for (const row of list) {
      const r = await req('GET', '/agency/overview?contextId=' + encodeURIComponent(row.id), { token });
      results.push({ want: row.agencyType, got: r.data && r.data.agencyType, region: r.data && r.data.regionCode });
    }
    check(`同一账号的多个代理身份分别返回各自层级（${types}）`, results.length > 0 && results.every((x) => x.want === x.got), results);
  }
  if (![...byUser.values()].some((l) => l.length >= 2)) check('存在多代理身份账号用于验证', false, '未找到');

  try { fs.unlinkSync(DB_COPY); } catch (e) { /* ignore */ }
  try { srv.kill('SIGTERM'); } catch (e) { /* ignore */ }
  await sleep(600);
  try { srv.kill('SIGKILL'); } catch (e) { /* ignore */ }

  console.log('\n════════════════════════════════════════');
  console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败');
  if (fail) { console.log('失败项：'); failures.forEach((f) => console.log('  · ' + f)); }
  console.log('════════════════════════════════════════');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('验证脚本异常：', e); process.exit(1); });

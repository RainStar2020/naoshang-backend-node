#!/usr/bin/env node
/**
 * 静态资源路径契约验证（后端下发 ↔ 前端产物）
 *
 * 背景（2026-10-28 实战事故）：
 *   前端把图片从 PNG 优化成 JPEG（product-cover.png → product-cover.jpg），
 *   前端源码与构建产物都改对了，但**后端** catalogDisplay.js / columns.js 里
 *   硬编码的封面兜底路径没跟着改 → /catalog 仍返回
 *   `coverUrl: /static/product/product-cover.png` → 该文件已不存在 →
 *   小程序 <image> 加载失败 → 渲染层报
 *   `[渲染层网络层错误] Failed to load image .../static/product/product-cover.png`
 *
 *   前端自己的资源检查（work/check-static-assets.js）查不到这类问题，
 *   因为**坏路径是后端给的**，所以必须由后端侧来校验。
 *
 * 两道校验：
 *   ① 静态扫描：后端 src 里所有 '/static/...' 字面量 → 必须在前端 src/static 与构建产物中存在
 *   ② 运行时扫描：真实接口返回体里出现的所有 '/static/...' → 必须在前端构建产物中存在
 *
 * 运行：node scripts/verify_static_assets_contract.js
 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FRONT_SRC = process.env.FRONT_SRC || 'E:\\脑商ai1\\src';
const FRONT_DIST = process.env.FRONT_DIST || 'E:\\脑商ai1\\dist\\build\\mp-weixin';
const PORT = 3396;
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = process.env.SEED_PASSWORD || ['Naoshang', '@', '2026'].join('');

let pass = 0, fail = 0;
const failures = [];
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + label + (extra !== undefined ? '  ' + extra : '')); }
  else { fail++; failures.push(label + (extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 240) : '')); console.log('  ✗ ' + label + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 240) : '')); }
}
function head(t) { console.log('\n【' + t + '】'); }

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
/** 递归收集响应体里所有 /static/ 开头的字符串 */
function collectStaticPaths(node, out = new Set()) {
  if (typeof node === 'string') {
    const m = node.match(/\/static\/[A-Za-z0-9_\-./]+/g);
    if (m) m.forEach((x) => out.add(x));
  } else if (Array.isArray(node)) {
    node.forEach((x) => collectStaticPaths(x, out));
  } else if (node && typeof node === 'object') {
    Object.values(node).forEach((x) => collectStaticPaths(x, out));
  }
  return out;
}
function req(method, p, { body, token } = {}) {
  return new Promise((resolve) => {
    const data = body !== undefined ? JSON.stringify(body) : null;
    const h = { 'Content-Type': 'application/json' };
    if (token) h.Authorization = 'Bearer ' + token;
    if (data) h['Content-Length'] = Buffer.byteLength(data);
    const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method, headers: h, timeout: 15000 }, (res) => {
      let t = ''; res.on('data', (c) => (t += c));
      res.on('end', () => { let j = null; try { j = JSON.parse(t); } catch (e) {} resolve({ status: res.statusCode, data: j }); });
    });
    r.on('error', (e) => resolve({ status: 0, data: null }));
    if (data) r.write(data);
    r.end();
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log('════════ 静态资源路径契约（后端 ↔ 前端产物）════════');
  console.log('前端源码: ' + FRONT_SRC);
  console.log('前端产物: ' + FRONT_DIST);

  // ── ① 静态扫描后端源码里的 '/static/...' 字面量 ────────────────────
  head('① 后端源码硬编码的 /static 路径');
  const literals = new Map();
  for (const f of walk(path.join(ROOT, 'src')).filter((x) => /\.js$/.test(x))) {
    const text = fs.readFileSync(f, 'utf8');
    for (const m of text.matchAll(/['"`](\/static\/[A-Za-z0-9_\-./]+)['"`]/g)) {
      const p = m[1];
      if (!literals.has(p)) literals.set(p, []);
      literals.get(p).push(path.relative(ROOT, f));
    }
  }
  check('后端存在硬编码的 /static 路径', literals.size > 0, literals.size + ' 个');
  for (const [p, files] of literals) {
    const inSrc = fs.existsSync(path.join(FRONT_SRC, p.replace(/^\/static\//, 'static/')));
    const inDist = fs.existsSync(path.join(FRONT_DIST, p.replace(/^\/static\//, 'static/')));
    check(`前端存在 ${p}`, inSrc && inDist, { inSrc, inDist, 出处: files });
  }

  // ── ② 运行时扫描接口返回体 ──────────────────────────────────────────
  head('② 真实接口返回的 /static 路径');
  fs.mkdirSync(path.join(ROOT, 'tmp'), { recursive: true });
  const dbCopy = path.join(ROOT, 'tmp', 'static_assets_contract.json');
  fs.copyFileSync(path.join(ROOT, 'data', 'db.json'), dbCopy);
  const srv = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT, env: { ...process.env, PORT: String(PORT), DB_FILE: dbCopy, EXPOSE_DEV_CODE: '1' }, stdio: 'ignore',
  });
  const t0 = Date.now();
  let up = false;
  while (Date.now() - t0 < 15000) {
    try { const r = await fetch(BASE + '/'); if (r.ok) { up = true; break; } } catch (e) { /* retry */ }
    await sleep(200);
  }
  if (!up) { console.error('隔离服务未启动'); srv.kill('SIGKILL'); process.exit(1); }

  const login = await req('POST', '/auth/login', { body: { phone: '13900001001', password: PASSWORD, channel: 'parent' } });
  const token = login.data && login.data.token;
  check('登录成功', !!token, token ? '' : '无法登录，后续用例跳过');

  const endpoints = ['/catalog', '/columns', '/me/bootstrap', '/partner/overview?contextId=wholesale:seed_cofounder', '/costore/overview?contextId=costore:seed_cofounder:cs_41'];
  const all = new Set();
  for (const ep of endpoints) {
    const r = await req('GET', ep, { token });
    const found = collectStaticPaths(r.data);
    found.forEach((p) => all.add(p));
    check(`GET ${ep} → ${r.status}`, r.status === 200, r.status === 200 ? `返回 ${found.size} 个 /static 路径` : '');
  }
  console.log('  · 接口返回的 /static 路径共 ' + all.size + ' 个');
  for (const p of all) {
    const inDist = fs.existsSync(path.join(FRONT_DIST, p.replace(/^\/static\//, 'static/')));
    check(`前端产物存在 ${p}`, inDist, { 缺失: p });
  }

  try { fs.unlinkSync(dbCopy); } catch (e) { /* ignore */ }
  try { srv.kill('SIGTERM'); } catch (e) { /* ignore */ }
  await sleep(600);
  try { srv.kill('SIGKILL'); } catch (e) { /* ignore */ }

  console.log('\n════════════════════════════════════════');
  console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败');
  if (fail) { console.log('失败项：'); failures.forEach((f) => console.log('  · ' + f)); }
  console.log('════════════════════════════════════════');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('验证脚本异常：', e); process.exit(1); });

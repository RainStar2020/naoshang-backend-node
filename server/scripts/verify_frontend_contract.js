#!/usr/bin/env node
/**
 * 脑商AI · 前后端契约体检（前端产物 ↔ 后端路由）
 *
 * 为什么需要：
 *   前端每新增一个接口调用，如果后端没实现，运行时才会炸。
 *   这里**从已构建的小程序产物里静态抽出所有 request(path, {method}) 调用**，
 *   再逐条打到后端，用「后端对未知路由的固定文案」区分两种 404：
 *     · 404 + "用户接口不存在: /xxx"  → **路由缺失 = 真的前后端没接上** ⚠
 *     · 404 + 其它业务文案（会员不存在…）→ 路由存在，只是 id 不对 ✓
 *
 * 覆盖的是**发布产物**（dist/build/mp-weixin），不是源码 —— 也就是说
 * "用户手机上真正会调的那些接口"是否都在后端实现了。
 *
 * 用法：
 *   node scripts/verify_frontend_contract.js
 *   SEED_BASE=http://127.0.0.1:3000 node scripts/verify_frontend_contract.js
 *   FRONT_DIST=E:/脑商ai1/dist/build/mp-weixin node scripts/verify_frontend_contract.js
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { URL } = require('url');

const BASE = process.env.SEED_BASE || 'http://192.168.0.44:3000';
const FRONT_DIST = process.env.FRONT_DIST || 'E:\\脑商ai1\\dist\\build\\mp-weixin';
const PASSWORD = process.env.SEED_PASSWORD || ['Naoshang', '@', '2026'].join('');
const LOGIN_PHONE = '13900001001';

let pass = 0, fail = 0;
const missing = [];
const notes = [];

function check(label, cond, detail) {
  if (cond) { pass++; }
  else { fail++; missing.push(label); console.log('  ✗ ' + label + (detail ? '  → ' + detail : '')); }
}

/** 递归收集目录下所有 .js */
function collectJs(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...collectJs(p));
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

/** 从产物里抽出 { path, method } */
function extractCalls(files) {
  const map = new Map();
  for (const f of files) {
    const s = fs.readFileSync(f, 'utf8');
    for (const m of s.matchAll(/request\(\s*[`'"]([^`'"]+)[`'"]/g)) {
      const raw = m[1];
      // 方法：在调用点之后的一小段窗口里找。
      // 注意 options 里常含嵌套对象，不能用正则整体匹配，只能就近取窗。
      // 还要处理三元写法 `method:id?'PATCH':'POST'` → 两个方法都要探。
      const window = s.slice(m.index, m.index + 260);
      const methods = [];
      const ternary = /method\s*:\s*[^,}]*\?\s*["']([A-Z]+)["']\s*:\s*["']([A-Z]+)["']/.exec(window);
      if (ternary) { methods.push(ternary[1], ternary[2]); }
      else {
        const one = (/method\s*:\s*["']([A-Z]+)["']/.exec(window) || [])[1];
        methods.push(one || 'GET');
      }
      for (const method of new Set(methods)) {
        const key = raw + '|' + method;
        if (!map.has(key)) map.set(key, { path: raw, method });
      }
    }
  }
  return [...map.values()].sort((a, b) => (a.path + a.method).localeCompare(b.path + b.method));
}

/**
 * 把模板路径归一化成可探测的形态，并给出**多个候选**。
 *
 * 有些路径的末段是"动作名"（如 /orders/{id}/cancel），不是 id ——
 * 归一化成 __id__ 会探到一个根本不存在的路由，产生假报警。
 * 所以这类路径列出所有可能的动作候选，任一命中即视为"路由存在"。
 */
function pathVariants(p) {
  // 先把完整的 ${...} 换成 __id__；产物里模板可能被截断（如 `${i?` 没有右花括号），
  // 这种残片要一并去掉，否则会探出一个根本不存在的路径。
  let norm = p.replace(/\$\{[^}]*\}/g, '__id__').replace(/\$\{[^$]*$/, '');
  // 丢掉末尾残段（含未闭合模板的）
  norm = norm.replace(/\/[^/]*\$[^/]*$/, '');
  // 订单动作：/orders/{id}/{action} —— 末段是动作名不是 id，列候选逐个试
  if (/^\/orders\/__id__\/__id__$/.test(norm)) {
    return ['cancel', 'cancellations', 'confirm-receipt', 'receipts', 'payment'].map((a) => '/orders/__id__/' + a);
  }
  return [norm];
}

function call(method, p, token, body) {
  return new Promise((resolve) => {
    const data = body !== undefined ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    if (data) headers['Content-Length'] = Buffer.byteLength(data);
    const u = new URL(BASE + p);
    const req = http.request({
      host: u.hostname, port: u.port, path: u.pathname + u.search, method, headers, timeout: 8000,
    }, (res) => {
      let b = '';
      res.on('data', (c) => { b += c; });
      res.on('end', () => resolve({ status: res.statusCode, raw: b }));
    });
    req.on('error', (e) => resolve({ status: 0, raw: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, raw: 'timeout' }); });
    req.end(data);
  });
}

/**
 * 未知路由在后端有两种固定文案，都要认：
 *   · "Not Found: /xxx"          → server.js 层就没匹配到（连契约层都没进）
 *   · "用户接口不存在: /xxx"     → 进了契约层但没有任何路由匹配（h5.js:921）
 * 只认其中一种会漏判 → 会给出"全部通过"的假信心。
 */
function isRouteMissing(status, raw) {
  if (status !== 404) return false;
  return /Not Found:|用户接口不存在|管理员接口不存在/.test(raw);
}

(async () => {
  console.log('════════ 前后端契约体检（小程序产物 ↔ 后端路由）════════');
  console.log('产物目录：' + FRONT_DIST);
  console.log('后端地址：' + BASE);
  console.log('');

  const files = collectJs(FRONT_DIST);
  if (!files.length) {
    console.error('✗ 没找到小程序产物（' + FRONT_DIST + '），请先 npm run build:mp-weixin');
    process.exit(1);
  }
  const calls = extractCalls(files);
  console.log('产物文件 ' + files.length + ' 个｜抽出调用 ' + calls.length + ' 条');
  console.log('');

  // 先登录拿 token（后端对未知路由也要先过鉴权）
  const login = await call('POST', '/auth/login', null, { phone: LOGIN_PHONE, password: PASSWORD, channel: 'parent' });
  const token = (JSON.parse(login.raw) || {}).token;
  if (!token) {
    console.error('✗ 登录失败，无法体检：' + login.raw.slice(0, 120));
    process.exit(1);
  }

  console.log('【逐条探测前端会调的接口】');
  for (const c of calls) {
    const variants = pathVariants(c.path);
    if (!variants.some((v) => v.startsWith('/'))) continue;
    // 写操作给个空体即可：路由存在时多半返回 400（参数校验），不存在时返回 404「接口不存在」
    const body = c.method === 'GET' ? undefined : {};
    let allMissing = true;
    let lastRaw = '';
    for (const v of variants) {
      const r = await call(c.method, v, token, body);
      lastRaw = r.raw;
      if (!isRouteMissing(r.status, r.raw)) { allMissing = false; break; }
      if (r.status === 0) notes.push(`${c.method} ${v} → 连接失败：${r.raw.slice(0, 60)}`);
    }
    if (allMissing) {
      check(`${c.method} ${c.path}`, false, lastRaw.slice(0, 100));
    } else {
      pass++;
    }
  }

  console.log('');
  if (notes.length) {
    console.log('连接异常（非路由问题）：');
    for (const n of notes) console.log('  · ' + n);
    console.log('');
  }

  console.log('════════════════════════════════════════');
  console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败（路由缺失）');
  if (missing.length) {
    console.log('');
    console.log('❌ 以下前端调用在后端**没有对应路由**（前后端没接上）：');
    for (const m of missing) console.log('   · ' + m);
    console.log('');
    console.log('（若这些接口前端其实没用到 —— 例如遗留代码 —— 可删除前端调用或补后端实现）');
  } else {
    console.log('✅ 前端产物调用的每一个接口，后端都有对应路由');
  }
  console.log('════════════════════════════════════════');
  process.exit(missing.length ? 1 : 0);
})().catch((e) => { console.error('体检脚本异常：', e && e.message ? e.message : e); process.exit(1); });

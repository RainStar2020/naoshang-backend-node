/**
 * 前后端连通性 · 实机只读验收（对真实运行中的服务，不写业务数据）
 * 覆盖小程序真实调用链：登录 → 会话 → 商城目录 → 商品详情 → 结算选项 → 身份
 */
const http = require('http');
const PASSWORD = ['Naoshang', '@', '2026'].join('');
const PHONE = '13900001001';

function req(host, port, method, p, { body, token } = {}) {
  return new Promise((resolve) => {
    const data = body !== undefined ? JSON.stringify(body) : null;
    const h = { 'Content-Type': 'application/json' };
    if (token) h.Authorization = 'Bearer ' + token;
    if (data) h['Content-Length'] = Buffer.byteLength(data);
    const r = http.request({ host, port, path: p, method, headers: h, timeout: 12000 }, (res) => {
      let t = ''; res.on('data', (c) => (t += c));
      res.on('end', () => { let j = null; try { j = JSON.parse(t); } catch (e) {} resolve({ status: res.statusCode, data: j, raw: t }); });
    });
    r.on('error', (e) => resolve({ status: 0, data: null, raw: e.message }));
    r.on('timeout', () => { r.destroy(); resolve({ status: 0, data: null, raw: 'timeout' }); });
    if (data) r.write(data);
    r.end();
  });
}
let pass = 0, fail = 0;
const fails = [];
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + label + (extra ? '  ' + extra : '')); }
  else { fail++; fails.push(label); console.log('  ✗ ' + label + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 180) : '')); }
}

(async () => {
  console.log('════════ 实机前后端连通性验收（只读）════════');
  for (const [label, host] of [['本机 127.0.0.1', '127.0.0.1'], ['局域网 192.168.0.44', '192.168.0.44']]) {
    console.log('\n【' + label + ':3000】');
    let r = await req(host, 3000, 'GET', '/');
    ok('GET / 根路由可达', r.status === 200, 'HTTP ' + r.status);
    if (r.status !== 200) continue;

    r = await req(host, 3000, 'POST', '/auth/login', { body: { phone: PHONE, password: PASSWORD, channel: 'parent' } });
    const token = r.data && r.data.token;
    ok('POST /auth/login（手机号+密码）', r.status === 200 && !!token, r.status === 200 ? 'user=' + (r.data.user && r.data.user.displayId) : r.raw.slice(0, 120));
    if (!token) continue;

    r = await req(host, 3000, 'GET', '/me/bootstrap', { token });
    const ctxs = (r.data && r.data.contexts) || [];
    ok('GET /me/bootstrap 身份列表', r.status === 200 && Array.isArray(ctxs) && ctxs.length > 0, 'contexts=' + ctxs.length);

    r = await req(host, 3000, 'GET', '/catalog', { token });
    const items = (r.data && r.data.items) || [];
    ok('GET /catalog 商城目录', r.status === 200 && items.length > 0, 'items=' + items.length + ' locked=' + (r.data && r.data.locked));
    ok('目录商品带「你的价」viewerPrice', items.some((i) => i && i.viewerPrice));

    const pad = items.find((i) => i.id === 'pad');
    ok('目录含 flagship 商品 pad', !!pad, pad ? pad.title : '缺失');

    r = await req(host, 3000, 'GET', '/products/pad', { token });
    ok('GET /products/pad 商品详情', r.status === 200 && !!(r.data && r.data.title), (r.data && r.data.title) || r.raw.slice(0, 80));
    const skuStock = r.data && r.data.skus && r.data.skus.map((s) => s.label + ':' + s.stock).join(' / ');
    ok('pad 各档位库存可见（一档已补货）', !!(r.data && r.data.skus && r.data.skus.length), skuStock || '');

    r = await req(host, 3000, 'GET', '/checkout/options', { token });
    ok('GET /checkout/options 结算选项', r.status === 200 && !!(r.data && r.data.stores && r.data.members),
      'stores=' + ((r.data && r.data.stores || []).length) + ' members=' + ((r.data && r.data.members || []).length));

    r = await req(host, 3000, 'GET', '/me', { token });
    ok('GET /me 个人资料', r.status === 200 && !!(r.data && r.data.profile), r.data && r.data.profile && r.data.profile.nickname);

    r = await req(host, 3000, 'GET', '/announcements', { token });
    ok('GET /announcements 公告', r.status === 200 && Array.isArray(r.data && r.data.items), 'items=' + ((r.data && r.data.items || []).length));

    r = await req(host, 3000, 'GET', '/support/config', { token });
    ok('GET /support/config 客服配置', r.status === 200 && !!(r.data && r.data.phone));
  }
  console.log('\n════════════════════════════════════════');
  console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败');
  if (fail) { console.log('失败项：'); fails.forEach((f) => console.log('  · ' + f)); }
  console.log('════════════════════════════════════════');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('异常：', e); process.exit(1); });

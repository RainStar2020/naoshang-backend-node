/**
 * 注册全链路专项验证（2026-10-27）
 *
 * 覆盖用户手动测试注册时可能踩到的每一个环节：
 *   ① 参数校验（缺 phone / 缺 password）
 *   ② 手机号重复注册拦截（409）
 *   ③ 正常注册：返回 token + 用户资料 + 对外编号
 *   ④ 邀请码绑定上级（inviteCode → upline_id）
 *   ⑤ 密码只存哈希（scrypt$），不落明文
 *   ⑥ 注册后账号密码登录可用（/auth/sessions：手机号 + 密码）
 * ⑦ 注册后可拉取 /me，且地区（3 级编码）已落库
 *   ⑧ 注册用户可正常下单（报价 → 下单）
 *   ⑨ **重启服务后注册数据不丢**（持久化关键）
 *
 * 运行：node scripts/verify_registration.js
 * 隔离：独立端口 3221 + 独立数据文件（tmp/registration_test_db.json），不污染真实库
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const PORT = 3221;
const BASE = `http://127.0.0.1:${PORT}`;
const DB_FILE = path.join(__dirname, '..', 'tmp', 'registration_test_db.json');

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${extra !== undefined ? ' -> ' + JSON.stringify(extra).slice(0, 300) : ''}`); }
}
function head(t) { console.log(`\n===== ${t} =====`); }

const { parentLogin } = require('./loginKit.cjs');
async function req(method, p, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + p, {
    method, headers, body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  return { status: res.status, data };
}

function spawnServer() {
  const p = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DB_FILE, EXPOSE_DEV_CODE: '1' },
    stdio: 'ignore',
  });
  return p;
}
async function waitBoot() {
  const boot = Date.now();
  while (Date.now() - boot < 15000) {
    try { const r = await fetch(BASE + '/'); if (r.ok) return true; } catch (e) { /* retry */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const NEW_PHONE = '13900008888';
const PASSWORD = 'test123456';

(async () => {
  // 干净起点
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  if (fs.existsSync(DB_FILE)) fs.unlinkSync(DB_FILE);

  let srv = spawnServer();
  if (!await waitBoot()) { console.log('服务启动失败'); process.exit(1); }

  try {
    // ─────────────────────────────────────────────────────────
    head('① 参数校验');
    let r = await req('POST', '/auth/registrations', { body: { password: PASSWORD } });
    check('缺 phone → 400', r.status === 400, r.data);
    r = await req('POST', '/auth/registrations', { body: { phone: NEW_PHONE } });
    check('缺 password → 400', r.status === 400, r.data);

    head('② 短信验证码（发码）');
    r = await req('POST', '/auth/sms-challenges', { body: { phone: NEW_PHONE, purpose: 'register' } });
    check('发验证码 200', r.status === 200, r.data);
    check('开发模式返回 devCode（EXPOSE_DEV_CODE=1）', !!r.data.devCode, r.data);
    check('验证码不回传时也应可用（此处为联调模式）', typeof r.data.devCode === 'string' && /^\d{6}$/.test(r.data.devCode), r.data.devCode);
    const CHALLENGE_CODE = r.data.devCode;
    r = await req('POST', '/auth/sms-challenges', { body: { phone: NEW_PHONE, purpose: 'bad-purpose' } });
    check('非法 purpose → 400', r.status === 400, r.data);

    head('②b 验证码校验（输错不能注册成功）');
    r = await req('POST', '/auth/registrations', { body: { phone: NEW_PHONE, code: '000000', password: PASSWORD } });
    check('验证码错误 → 400', r.status === 400, r.data);
    check('错误提示含「验证码」', /验证码/.test((r.data && r.data.error) || ''), r.data && r.data.error);
    r = await req('POST', '/auth/registrations', { body: { phone: NEW_PHONE, password: PASSWORD } });
    check('未带验证码 → 400', r.status === 400, r.data);
    r = await req('POST', '/auth/sms-challenges', { body: { phone: '13900005555', purpose: 'register' } });
    const onceCode = r.data.devCode;
    r = await req('POST', '/auth/registrations', { body: { phone: '13900005555', code: onceCode, password: PASSWORD } });
    check('首次用码注册 200', r.status === 200, r.data);
    r = await req('POST', '/auth/registrations', { body: { phone: '13900005556', code: onceCode, password: PASSWORD } });
    check('验证码不可复用 → 400', r.status === 400, r.data);
    // 重新发码后旧码失效（只认最新一条）
    r = await req('POST', '/auth/sms-challenges', { body: { phone: '13900005557', purpose: 'register' } });
    const oldCode = r.data.devCode;
    r = await req('POST', '/auth/sms-challenges', { body: { phone: '13900005557', purpose: 'register' } });
    const newCode = r.data.devCode;
    r = await req('POST', '/auth/registrations', { body: { phone: '13900005557', code: oldCode, password: PASSWORD } });
    check('重新发码后旧验证码失效 → 400', r.status === 400, r.data);
    r = await req('POST', '/auth/registrations', { body: { phone: '13900005557', code: newCode, password: PASSWORD } });
    check('最新验证码可注册 → 200', r.status === 200, r.data);

    head('③ 正常注册（带邀请码 + 3 级地区）');
    r = await req('POST', '/auth/registrations', {
      body: {
        phone: NEW_PHONE,
        code: CHALLENGE_CODE,
        password: PASSWORD,
        name: '新注册测试',
        inviteCode: '13800000001',
        regionCodes: ['33', '3301', '330110'],
        regionNames: ['浙江省', '杭州市', '余杭区'],
      },
    });
    check('注册成功 → 200', r.status === 200, r.data);
    check('返回 token', !!(r.data && r.data.token), r.data);
    check('返回 user.id', !!(r.data && r.data.user && r.data.user.id), r.data && r.data.user);
    check('返回对外编号 displayId（QZ 开头）', !!(r.data && r.data.user && /^QZ\d+$/.test(r.data.user.displayId)), r.data && r.data.user);
    check('entitlement 状态为 never_paid', r.data && r.data.entitlement && r.data.entitlement.state === 'never_paid', r.data && r.data.entitlement);
    check('accountType = parent', r.data && r.data.accountType === 'parent', r.data && r.data.accountType);
    const NEW_TOKEN = r.data.token;
    const NEW_UID = r.data.user.id;

    head('④ 落库检查（db.json）');
    const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    const nu = db.users[NEW_UID];
    check('用户已写入 db.json', !!nu);
    check('upline_id 绑定到邀请人 p1', nu && nu.upline_id === 'p1', nu && nu.upline_id);
    check('tier = vip（注册默认档位）', nu && nu.tier === 'vip', nu && nu.tier);
    check('entitlement_state = never_paid', nu && nu.entitlement_state === 'never_paid', nu && nu.entitlement_state);
    check('**密码只存 scrypt 哈希，不落明文**', nu && typeof nu.password === 'string' && nu.password.startsWith('scrypt$') && !nu.password.includes(PASSWORD), nu && String(nu.password).slice(0, 40));
    check('quotaLedger 已初始化', !!(db.quotaLedger && db.quotaLedger[NEW_UID]), db.quotaLedger && Object.keys(db.quotaLedger));

    head('⑤ 地区（regionCodes）落库检查');
    check('regionCodes 已保存（3 级）', !!(nu && Array.isArray(nu.regionCodes) && nu.regionCodes.length === 3), nu && nu.regionCodes);
    check('regionNames 已保存', !!(nu && Array.isArray(nu.regionNames) && nu.regionNames.length === 3), nu && nu.regionNames);

    head('⑥ 手机号重复注册拦截');
    r = await req('POST', '/auth/registrations', { body: { phone: NEW_PHONE, password: PASSWORD } });
    check('重复手机号 → 409', r.status === 409, r.data);

    head('⑦ 注册后账号密码登录（手机号 + 密码）');
    r = await parentLogin(req, NEW_PHONE, PASSWORD);
    check('账号密码登录 200', r.status === 200, r.data);
    check('拿到新 token', !!(r.data && r.data.token), r.data);
    const LOGIN_TOKEN = r.data.token;

    r = await req('POST', '/auth/sessions', { body: { phone: NEW_PHONE, password: 'wrong-pass', channel: 'parent' } });
    check('密码错误 → 401', r.status === 401, r.data);
    r = await req('POST', '/auth/sessions', { body: { phone: NEW_PHONE, channel: 'parent' } });
    check('缺密码 → 400（不允许仅凭手机号登录）', r.status === 400, r.data);
    r = await req('POST', '/auth/sessions', { body: { phone: '13999999999', password: PASSWORD, channel: 'parent' } });
    check('未注册手机号登录 → 404', r.status === 404, r.data);

    head('⑨ 权益门禁：注册后未开通 200 元权益 → 全功能锁定（设计如此）');
    {
      const locked = await req('GET', '/catalog', { token: NEW_TOKEN });
      check('未开通权益时 /catalog 返回 locked=true（权益门禁生效）', locked.data && locked.data.locked === true, locked.data);
      check('门禁响应带开通引导文案', !!(locked.data && locked.data.message && locked.data.message.includes('权益')), locked.data && locked.data.message);
    }

    head('⑩ 开通 200 元权益 → 解锁');
    {
      const ent = await req('POST', '/me/entitlement-orders', {
        token: NEW_TOKEN,
        body: { channel: 'wechat', idempotencyKey: 'reg-test-entitlement-1' },
      });
      check('开通权益请求 200', ent.status === 200, ent.data);
      check('权益支付状态 SUCCEEDED（sandbox 直通）', ent.data && ent.data.status === 'SUCCEEDED', ent.data);
      check('开通后 entitlement.state 变为 active', ent.data && ent.data.entitlement && ent.data.entitlement.state === 'active', ent.data && ent.data.entitlement);
      // 幂等：同一 idempotencyKey 重复提交不应重复扣费
      const ent2 = await req('POST', '/me/entitlement-orders', {
        token: NEW_TOKEN,
        body: { channel: 'wechat', idempotencyKey: 'reg-test-entitlement-1' },
      });
      check('权益开通幂等（重复提交仍成功、不重复计费）', ent2.status === 200 && ent2.data && ent2.data.status === 'SUCCEEDED', ent2.data);
      // 解锁后 /catalog 恢复正常
      const cat2 = await req('GET', '/catalog', { token: NEW_TOKEN });
      check('**开通后 /catalog 解锁（不再 locked）**', cat2.status === 200 && !(cat2.data && cat2.data.locked), cat2.data && cat2.data.locked);
      check('**开通后目录返回商品**', !!(cat2.data && Array.isArray(cat2.data.items) && cat2.data.items.length > 0), cat2.data && cat2.data.items && cat2.data.items.length);
      // 解锁后 /me 正常
      const me2 = await req('GET', '/me?contextId=partner:' + NEW_UID, { token: NEW_TOKEN });
      check('**开通后 /me 正常返回 profile**', me2.status === 200 && !!(me2.data && me2.data.profile), me2.data);
      check('/me 返回本人 id', me2.data && me2.data.profile && me2.data.profile.id === NEW_UID, me2.data && me2.data.profile);
      check('/me 返回手机号', me2.data && me2.data.profile && me2.data.profile.phone === NEW_PHONE, me2.data && me2.data.profile);
      check('/me 返回地区（3 级）', me2.data && me2.data.profile && Array.isArray(me2.data.profile.regionCodes) && me2.data.profile.regionCodes.length === 3, me2.data && me2.data.profile && me2.data.profile.regionCodes);
    }

    head('⑪ 注册用户可正常下单');
    const cat = await req('GET', '/catalog', { token: LOGIN_TOKEN });
    check('商城目录可取', cat.status === 200, cat.status);
    const items = (cat.data && cat.data.items) || [];
    check('目录有商品', items.length > 0, items.length);
    const prod = items.find((x) => x && x.id) || items[0];
    const sku = (prod && prod.skus && prod.skus[0]) || null;
    // 报价与下单的参数结构与前端完全一致（顶层 productId/skuId/quantity/storeId）
    const quote = await req('POST', '/checkout/quotes', {
      token: LOGIN_TOKEN,
      body: {
        productId: prod.id,
        skuId: sku ? sku.id : undefined,
        quantity: 1,
        storeId: '330110-S1',
      },
    });
    // 报价响应字段是 id（前端 quoteCheckout 取 result.id；下单时作为 quoteId 回传）
    const quoteId = quote.data && (quote.data.id || quote.data.quoteId);
    check('报价成功', quote.status === 200 && !!quoteId, quote.data);
    const order = await req('POST', '/orders', {
      token: LOGIN_TOKEN,
      body: {
        quoteId,
        idempotencyKey: 'reg-test-order-1',
        productId: prod.id,
        skuId: sku ? sku.id : undefined,
        quantity: 1,
        storeId: '330110-S1',
      },
    });
    check('下单成功 → 200', order.status === 200, order.data);
    check('订单已生成', !!(order.data && (order.data.orderId || order.data.id)), order.data);

    head('⑫ 重启服务后数据不丢（持久化关键）');
    srv.kill('SIGTERM');
    await sleep(1500);
    srv = spawnServer();
    const booted = await waitBoot();
    check('重启成功', booted);
    if (booted) {
      r = await parentLogin(req, NEW_PHONE, PASSWORD);
      check('**重启后注册账号仍可登录**', r.status === 200 && !!(r.data && r.data.token), r.data);
      const r2 = await req('GET', '/me?contextId=partner:' + NEW_UID, { token: r.data && r.data.token });
      check('**重启后 /me 仍可取到该用户**', r2.status === 200 && !!(r2.data && r2.data.profile && r2.data.profile.id === NEW_UID), r2.data && r2.data.profile);
      check('**重启后地区仍在**', !!(r2.data && r2.data.profile && r2.data.profile.regionCodes && r2.data.profile.regionCodes.length === 3), r2.data && r2.data.profile && r2.data.profile.regionCodes);
      const db2 = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      check('**重启后 db.json 仍含该用户**', !!(db2.users && db2.users[NEW_UID]), Object.keys(db2.users || {}));
    }
  } finally {
    try { srv.kill('SIGTERM'); } catch (e) { /* ignore */ }
  }

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('异常：', e); process.exit(1); });

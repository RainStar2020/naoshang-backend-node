/**
 * 新增能力回归：P1-8 两套邀请码 / P1-7 L1–L10 阶梯 / P1-9 会员价·渠道价双折扣 / P2-5 数据访问抽象层
 * 运行：node scripts/verify_new_features_20261026.js
 *   —— 自带服务自启/自收尾（未检测到运行实例时用独立端口拉起临时 server.js），可直接纳入全量回归。
 *
 * 覆盖：
 *   A. 单元：inviteCode（生成/解析/绑定/失效/限次/吊销）、ladder（等级判定/晋升进度/阶梯图）、
 *      productSplit（dualPrice/finalPrice）、dbLayer（内存适配读写 + PG 适配接口一致性）。
 *   B. HTTP：/catalog 与 /products/{key}（顺带修复 PRODUCTS 目录是对象导致 .find 崩溃的 bug）、
 *      /checkout/quotes 三套价、/me/invite-codes 生成与列表、凭注册码注册自动绑推荐人、
 *      /partner/superior-bindings 凭类型化邀请码绑定、/agency/application-options 凭代理归属码带入归属、
 *      /partner/ladder 阶梯图。
 */
const { spawn } = require('child_process');
const path = require('path');

const PORT = 3331;
const BASE = `http://127.0.0.1:${PORT}`;
let passed = 0, failed = 0;
const check = (name, cond, extra) => {
  if (cond) { passed++; console.log(`  ok  ${name}`); }
  else { failed++; console.log(`  FAIL ${name}${extra !== undefined ? ' -> ' + JSON.stringify(extra).slice(0, 300) : ''}`); }
};
const { parentLogin } = require('./loginKit.cjs');
const req = (m, p, { token, body } = {}) => fetch(BASE + p, {
  method: m,
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
}).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }));
const loginParent = async (phone) => (await parentLogin(req, phone)).data.token;

// ───────────────── A. 单元测试 ─────────────────
async function unitTests() {  console.log('== A. 单元测试 ==');
  const IC = require('../src/inviteCode');
  const LAD = require('../src/ladder');
  const PS = require('../src/productSplit');
  const DBL = require('../src/dbLayer');
  const S = require('../src/store');

  // ── P1-8 邀请码 ──
  const db = S.createDb();
  db.users = { p1: { id: 'p1', name: '甲', phone: '13800000001', tier: 'vip' }, p2: { id: 'p2', name: '乙', phone: '13800000002', tier: 'vip' } };
  const rec = IC.generateInviteCode(db, { ownerId: 'p1', type: 'register' });  check('生成注册邀请码（R 前缀）', /^R[A-Z0-9]{8}$/.test(rec.code), rec.code);
  check('解析有效邀请码', IC.resolveInviteCode(db, rec.code) === rec);
  check('大小写不敏感解析', IC.resolveInviteCode(db, rec.code.toLowerCase()) === rec);
  check('无效邀请码返回 null', IC.resolveInviteCode(db, 'NOPE1234') === null);
  const b1 = IC.bindByInviteCode(db, rec.code, 'p2', { setUpline: (u, uid) => { u.upline_id = uid; } });
  check('register 码绑定 upline', b1.ok && b1.bound && db.users.p2.upline_id === 'p1', b1);
  check('绑定后 usedBy 计数 +1', rec.usedBy.length === 1);
  const b2 = IC.bindByInviteCode(db, rec.code, 'p2', { setUpline: (u, uid) => { u.upline_id = uid; } });
  check('重复绑定幂等（不覆盖已有上级）', b2.ok && b2.bound === false && db.users.p2.upline_id === 'p1', b2);
  const ag = IC.generateInviteCode(db, { ownerId: 'p1', type: 'agent' });
  check('生成代理归属码（A 前缀）', /^A[A-Z0-9]{8}$/.test(ag.code), ag.code);
  const b3 = IC.bindByInviteCode(db, ag.code, 'p2', { setReferrer: (u, uid) => { u.referrer_id = uid; } });
  check('agent 码绑定 referrer', b3.ok && b3.bound && db.users.p2.referrer_id === 'p1', b3);
  const lim = IC.generateInviteCode(db, { ownerId: 'p1', type: 'register', maxUse: 1 });
  db.users.p3 = { id: 'p3', name: '丙', phone: '13800000003', tier: 'vip' };
  IC.bindByInviteCode(db, lim.code, 'p3', { setUpline: (u, uid) => { u.upline_id = uid; } });
  check('限次用尽后失效', IC.resolveInviteCode(db, lim.code) === null, { used: lim.usedBy.length });
  const exp = IC.generateInviteCode(db, { ownerId: 'p1', type: 'register', ttlDays: 0 });
  exp.expiresAt = Date.now() - 1000;
  check('过期邀请码失效', IC.resolveInviteCode(db, exp.code) === null);
  const rev = IC.generateInviteCode(db, { ownerId: 'p1', type: 'register' });
  IC.revokeInviteCode(db, rev.code, 'p1');
  check('吊销后失效', IC.resolveInviteCode(db, rev.code) === null);
  check('按类型过滤列表', IC.listMyCodes(db, 'p1', 'agent').length === 1 && IC.listMyCodes(db, 'p1').length === 5, IC.listMyCodes(db, 'p1').length);
  check('publicCode 输出含 typeLabel/usedCount', IC.publicCode(rec).typeLabel === '注册邀请码' && IC.publicCode(rec).usedCount === 1);

  // ── P1-7 阶梯 ──
  check('阶梯共 10 级', LAD.DEFAULT_LEVELS.length === 10);
  check('score=0 → L1', LAD.levelOf(0).level === 'L1');
  check('score=15000 → L4', LAD.levelOf(15000).level === 'L4', LAD.levelOf(15000).level);
  check('score 低于 L1 阈值 → 仍 L1', LAD.levelOf(-5).level === 'L1');
  check('满级 → next 为 null', LAD.nextLevel(99999999) === null);
  const pr = LAD.progress(3000);
  check('晋升进度：L2→L3，还差 2000', pr.current.level === 'L2' && pr.next.level === 'L3' && pr.toNext === 2000, pr);
  check('进度比例在 0..1', pr.ratio >= 0 && pr.ratio <= 1);
  const chart = LAD.ladderChart(0);
  check('阶梯图含 10 个坐标点', chart.levels.length === 10 && chart.levels.every((l) => l.coord && typeof l.coord.x === 'number'));
  check('阶梯图 x 坐标 1..10 递增', chart.levels.every((l, i) => l.coord.x === i + 1));

  // ── P1-9 双价格 ──
  const dp = PS.dualPrice('pad');
  check('dualPrice pad：标价 6980 / 会员 5584 / 渠道 3490', dp.list === 6980 && dp.member === 5584 && dp.channel === 3490, dp);
  const f1 = PS.finalPrice('pad', { tier: 'vip' }, null, 1);
  check('finalPrice 默认沿用档位折扣（partner 0.8）', f1.unitPrice === 5584 && f1.applied === 'partner', f1);
  const f2 = PS.finalPrice('pad', { tier: 'vip' }, { region_type: 'store' }, 1, { dualDiscountEnabled: true });
  check('双折扣开启：代理取渠道价', f2.applied === 'channel' && f2.unitPrice === 3490, f2);
  const f3 = PS.finalPrice('pad', { tier: 'vip' }, null, 1, { dualDiscountEnabled: true });
  check('双折扣开启：会员取会员价', f3.applied === 'member' && f3.unitPrice === 5584, f3);
  const f4 = PS.finalPrice('pad', { tier: 'vip' }, null, 1, { level: 'list' });
  check('显式指定 level 时沿用旧行为', f4.unitPrice === 6980 && f4.applied === 'list', f4);

  // ── P2-5 数据访问抽象层 ──
  const mem = DBL.memoryAdapter(db);
  const u = await mem.getUser('p1');
  check('内存适配：getUser', u && u.id === 'p1');
  const nu = await mem.addUser({ id: 'p9', name: '测试', phone: '13900000009', tier: 'vip' });
  check('内存适配：addUser', nu && nu.id === 'p9' && db.users.p9);
  const us = await mem.listUsers();
  check('内存适配：listUsers', us.length === 4, us.length);
  const st = await mem.updateSettings({ costore: { monthlyFee: 888 } });
  check('内存适配：updateSettings', st.costore.monthlyFee === 888, st.costore);
  check('内存适配：kind=memory', mem.kind === 'memory');
  let pgErr = null;
  try { DBL.pgAdapter(null); } catch (e) { pgErr = e.message; }
  check('PG 适配需注入 pool（缺失时清晰报错）', !!pgErr && /pg\.Pool/.test(pgErr), pgErr);
  const fakePool = { query: async () => ({ rows: [{ id: 'p1', name: '甲' }] }) };
  const pg = DBL.pgAdapter(fakePool);
  const prow = await pg.getUser('p1');
  check('PG 适配：getUser 返回行', prow && prow.id === 'p1');
  check('PG 适配：kind=pg', pg.kind === 'pg');

  // ── P1-1 拉人免费升档 · 两套规则 ──
  const fdb = S.createDb();
  fdb.users = {
    U: { id: 'U', name: '上级', phone: '13900000001', tier: 'angel', principal_tier: 'angel' },
    d1: { id: 'd1', name: 'D1', phone: '13900000002', tier: 'angel', upline_id: 'U', referral_upline_tier: 'angel' },
    d2: { id: 'd2', name: 'D2', phone: '13900000003', tier: 'angel', upline_id: 'U', referral_upline_tier: 'angel' },
  };
  fdb.orders = [
    { id: 'o1', buyer_id: 'd1', oldTier: 'angel', packageTier: 'private', actual_paid: 59800 },
    { id: 'o2', buyer_id: 'd2', oldTier: 'angel', packageTier: 'private', actual_paid: 59800 },
  ];
  const fp0 = S.referralFreeUpgradeProgress(fdb, 'U');
  check('P1-1 规则A：合格下级计数', fp0.qualifying === 2 && fp0.required === 3, { q: fp0.qualifying });
  check('P1-1 默认只启用规则A（业绩规则关闭）', fp0.rules.performance.enabled === false && fp0.rules.performance.earned === 0, fp0.rules.performance);
  check('P1-1 规则B 业绩累计 = 直属下级升档实付', S.referralPerformanceAmount(fdb, 'U') === 119600, S.referralPerformanceAmount(fdb, 'U'));
  // 开启规则B：业绩阈值调低到 100000 → earned=1
  S.updateSettings(fdb, { freeUpgrade: { performanceEnabled: true, performanceRequired: 100000 } });
  const fp1 = S.referralFreeUpgradeProgress(fdb, 'U');
  check('P1-1 规则B 开启后 earned 取较高者', fp1.earned === 1 && fp1.rules.performance.earned === 1 && fp1.rules.count.earned === 0, fp1.rules);
  check('P1-1 activeRule 指示生效规则', fp1.activeRule === 'performance', fp1.activeRule);
  const g1 = S.maybeGrantFreeUpgrade(fdb, 'U');
  check('P1-1 规则B 触发免费升档 1 次', g1.granted.length === 1 && fdb.users.U.tier === 'private', { g: g1.granted, tier: fdb.users.U.tier });
  check('P1-1 免费升档不改变本金档', fdb.users.U.principal_tier === 'angel', fdb.users.U.principal_tier);

  // ── P1-3 直推提点分档 ──
  const RA = require('../src/regionAgent');
  check('P1-3 默认直推提点 = 固定 15%', RA.resolveAgentDirectRate({}) === 0.15, RA.resolveAgentDirectRate({}));
  check('P1-3 无配置时仍为 15%', RA.resolveAgentDirectRate({ cfg: { enabled: true, tiers: [], byRegionType: {} } }) === 0.15);
  check('P1-3 enabled=false 强制回到 15%', RA.resolveAgentDirectRate({ cfg: { enabled: false, tiers: [{ minReferrals: 1, rate: 0.3 }] } }) === 0.15);
  check('P1-3 按数量分档：1 名 → 15%', RA.resolveAgentDirectRate({ referralCount: 1, cfg: { enabled: true, tiers: [{ minReferrals: 1, rate: 0.15 }, { minReferrals: 3, rate: 0.18 }] } }) === 0.15);
  check('P1-3 按数量分档：3 名 → 18%', RA.resolveAgentDirectRate({ referralCount: 3, cfg: { enabled: true, tiers: [{ minReferrals: 1, rate: 0.15 }, { minReferrals: 3, rate: 0.18 }] } }) === 0.18);
  check('P1-3 按级别分档优先于数量分档', RA.resolveAgentDirectRate({ referralCount: 9, developerRegionType: 'province', cfg: { enabled: true, tiers: [{ minReferrals: 1, rate: 0.15 }], byRegionType: { province: 0.10 } } }) === 0.10);
  const b15 = RA.agentDirectBonus(40000);
  check('P1-3 官方算例：40000×15% = 6000', b15.amount === 6000 && b15.rate === 0.15, b15);
  const bT = RA.agentDirectBonus(40000, null, { referralCount: 3, cfg: { enabled: true, tiers: [{ minReferrals: 3, rate: 0.18 }] } });
  check('P1-3 分档后 40000×18% = 7200', bT.amount === 7200, bT);

  // P1-3（补）：按业务类型分档（原型屏 50）双口径
  const C = require('../src/commission');
  const bizCfg = { mode: 'byBizType', byBizType: C.DIRECT_BIZ_RATIO };
  check('P1-3 默认口径 = 按推荐人档位（金额不变）', C.directBonus(10000, 'vip') === 500, C.directBonus(10000, 'vip'));
  check('P1-3 业务类型口径：供应链 2%', C.directBonus(2500, 'private', { bizType: 'supply_chain', cfg: bizCfg }) === 50);
  check('P1-3 业务类型口径：软件卡 5%', C.directBonus(100000, 'vip', { bizType: 'software_fee', cfg: bizCfg }) === 5000);
  check('P1-3 业务类型口径：合店费复购 2%', C.directBonus(100000, 'cofounder', { bizType: 'costore', cfg: bizCfg }) === 2000);
  check('P1-3 业务类型口径：代理费 5%', C.directBonus(80000, 'angel', { bizType: 'agent_fee', cfg: bizCfg }) === 4000);
  check('P1-3 业务类型口径：升级奖 2%', C.directBonus(50000, 'angel', { bizType: 'upgrade', cfg: bizCfg }) === 1000);
  check('P1-3 业务类型口径：权益费 5%', C.directBonus(20000, 'vip', { bizType: 'entitlement', cfg: bizCfg }) === 1000);
  check('P1-3 未覆盖业务类型回落推荐人档位', C.directBonus(10000, 'angel', { bizType: 'unknown_x', cfg: bizCfg }) === 1000);
  const dd = C.directBonusDetail(2500, 'private', { bizType: 'supply_chain', cfg: bizCfg });
  check('P1-3 明细返回 basis/bizType/formula', dd.basis === '业务类型' && dd.bizType === 'supply_chain' && dd.amount === 50, dd);
  check('P1-3 默认 settings.directBonus 存在且为 byUplineTier', (S.getSettings(S.createDb()).directBonus || {}).mode === 'byUplineTier', S.getSettings(S.createDb()).directBonus);
  const PS2 = require('../src/productSplit');
  const pc0 = PS2.partnerProductCommission({ paid: 10000, uplineTier: 'angel' });
  check('P1-3 产品提成默认按上级档位（金额不变）', pc0.rate === 0.10 && pc0.amount === 1000 && pc0.basis === 'uplineTier', pc0);
  const pc1 = PS2.partnerProductCommission({ paid: 10000, uplineTier: 'angel', kind: 'physical', directBonusCfg: bizCfg });
  check('P1-3 产品提成可切业务类型口径（实物→供应链 2%）', pc1.rate === 0.02 && pc1.amount === 200 && pc1.bizType === 'supply_chain', pc1);
  const pc2 = PS2.partnerProductCommission({ paid: 10000, uplineTier: 'angel', kind: 'software', directBonusCfg: bizCfg });
  check('P1-3 产品提成业务类型口径（软件卡→5%）', pc2.rate === 0.05 && pc2.amount === 500 && pc2.bizType === 'software_fee', pc2);
  check('P1-3 无上级仍为 0', PS2.partnerProductCommission({ paid: 10000, uplineTier: 'none', directBonusCfg: bizCfg }).amount === 0);

  // ── P1-5 特色产品固定 / 自选分配模式 ──
  const ALC = require('../src/allocation');
  const adb = S.createDb();
  adb.users = { p1: { id: 'p1', name: '甲', phone: '13800000001', tier: 'vip' } };
  const sc0 = ALC.scheme(adb);
  check('P1-5 默认自选分配模式', sc0.mode === 'self_assign' && sc0.kinds.every((k) => k.ownerAssignable === true), sc0.mode);
  S.updateSettings(adb, { productAllocation: { mode: 'fixed' } });
  const sc1 = ALC.scheme(adb);
  check('P1-5 切固定模式后两块均不可自选', sc1.mode === 'fixed' && sc1.kinds.every((k) => k.ownerAssignable === false), sc1.kinds.map((k) => k.ownerAssignable));
  const ent = { id: 'c1', owner_id: 'p1', subtype: 'featured_district_inspect' };
  const al = ALC.allocatable(adb, ent);
  check('P1-5 固定模式下 allocatable 拒绝自选', al.ok === false && /关闭|固定/.test(al.reason), al);
  ALC.updateScheme(adb, { mode: 'self_assign' });
  check('P1-5 总部可切回自选模式', ALC.scheme(adb).mode === 'self_assign');

  console.log('');
  await httpTests();
}

// ───────────────── B. HTTP 端到端 ─────────────────
async function httpTests() {
  console.log('== B. HTTP 端到端 ==');
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(PORT), EXPOSE_DEV_CODE: '1' }, stdio: 'ignore',
  });
  const boot = Date.now();
  while (Date.now() - boot < 15000) {
    try { const r = await fetch(BASE + '/'); if (r.ok) break; } catch (e) { /* retry */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  try {
    const admin = (await req('POST', '/auth/sessions', { body: { channel: 'admin', password: 'admin888' } })).data.token;
    check('admin 登录', !!admin);
    check('恢复默认种子', (await req('POST', '/api/seed/reset', { token: admin })).status === 200);

    const P1 = await loginParent('13800000001');
    const P6 = await loginParent('13800000006');
    check('合伙人登录 p1/p6', !!P1 && !!P6);

    // ── P1-9 商城目录（修复 PRODUCT_CATALOG 是对象导致的 .find 崩溃）──
    const cat = await req('GET', '/catalog', { token: P1 });
    check('GET /catalog 返回数组 items', cat.status === 200 && Array.isArray(cat.data.items) && cat.data.items.length === 8, cat.data.items && cat.data.items.length);
    check('GET /catalog 每项带三套价', cat.data.items && cat.data.items.every((x) => x.prices && typeof x.prices.list === 'number' && typeof x.prices.member === 'number' && typeof x.prices.channel === 'number'));
    const prod = await req('GET', '/products/pad', { token: P1 });
    check('GET /products/pad 200（原实现会因 .find 崩溃）', prod.status === 200 && prod.data.id === 'pad', prod.data);
    check('GET /products/pad 带三套价', prod.data.prices && prod.data.prices.list === 6980, prod.data.prices);
    check('GET /products/nope 404', (await req('GET', '/products/nope', { token: P1 })).status === 404);

    // ── P1-9 报价 ──
    const q = await req('POST', '/checkout/quotes', { token: P1, body: { productKey: 'pad', quantity: 2 } });
    check('POST /checkout/quotes 200', q.status === 200);
    check('报价返回三套价 + appliedPriceKind', q.data.product && q.data.product.listUnitPrice === 6980 && q.data.product.memberUnitPrice === 5584 && q.data.product.channelUnitPrice === 3490 && !!q.data.product.appliedPriceKind, q.data.product);
    check('报价 payableAmount = unitPrice × qty', q.data.payableAmount === Math.round(q.data.product.unitPrice * 2 * 100) / 100, { pa: q.data.payableAmount, up: q.data.product.unitPrice });
    check('报价 discountAmount = 标价 − 应付', q.data.discountAmount === Math.round((q.data.product.listUnitPrice * 2 - q.data.payableAmount) * 100) / 100, q.data.discountAmount);
    check('POST /checkout/quotes 未知商品 400', (await req('POST', '/checkout/quotes', { token: P1, body: { productKey: 'nope' } })).status === 400);

    // ── P1-8 邀请码（contextId 必填，与其它 H5 端点一致）──
    const gen = await req('POST', '/me/invite-codes?contextId=partner:p1', { token: P1, body: { type: 'register' } });
    check('POST /me/invite-codes 生成注册码 201', gen.status === 201 && /^R/.test(gen.data.inviteCode.code), gen.data);
    const code = gen.data.inviteCode.code;
    const list = await req('GET', '/me/invite-codes?contextId=partner:p1', { token: P1 });
    check('GET /me/invite-codes 返回列表', list.status === 200 && list.data.items.some((x) => x.code === code), list.data.items);
    const listA = await req('GET', '/me/invite-codes?contextId=partner:p1&type=agent', { token: P1 });
    check('GET /me/invite-codes?type=agent 按类型过滤', listA.status === 200 && listA.data.items.every((x) => x.type === 'agent'), listA.data.items);
    check('POST /me/invite-codes 非法类型 400', (await req('POST', '/me/invite-codes?contextId=partner:p1', { token: P1, body: { type: 'bad' } })).status === 400);
    check('POST /me/invite-codes 缺 contextId 400', (await req('POST', '/me/invite-codes', { token: P1, body: { type: 'register' } })).status === 400);

    // 凭注册码注册 → 自动绑定推荐人
    // 注：新注册用户处于「200 元权益未开通」门禁态，/partner/* 系列会被锁；
    //     故先开通权益（沙箱自动支付），再验证绑定链路。
    const phone = '137' + String(Math.floor(10000000 + Math.random() * 89999999));
    const _code = (await req('POST', '/auth/sms-challenges', { body: { phone, purpose: 'register' } })).data.devCode;
    const reg = await req('POST', '/auth/registrations', { body: { phone, code: _code, password: 'abc123', name: '受邀用户', inviteCode: code } });
    check('凭注册邀请码注册 200', reg.status === 200, reg.data);
    const newId = reg.data && reg.data.user && reg.data.user.id;
    const unlock = await req('POST', '/me/entitlement-orders', { token: reg.data.token, body: { idempotencyKey: 'ent-' + newId, channel: 'wechat' } });
    check('新用户开通 200 权益（沙箱自动支付）', unlock.status === 200, unlock.data);
    const sup = await req('GET', `/partner/superior?contextId=partner:${newId}`, { token: reg.data.token });
    check('注册后自动绑定推荐人（上级=码主 p1）', sup.status === 200 && sup.data.superior && sup.data.superior.phone === '13800000001', sup.data);

    // 凭类型化邀请码绑定上级
    const phone2 = '136' + String(Math.floor(10000000 + Math.random() * 89999999));
    const _code2 = (await req('POST', '/auth/sms-challenges', { body: { phone: phone2, purpose: 'register' } })).data.devCode;
    const reg2 = await req('POST', '/auth/registrations', { body: { phone: phone2, code: _code2, password: 'abc123', name: '待绑定用户' } });
    await req('POST', '/me/entitlement-orders', { token: reg2.data.token, body: { idempotencyKey: 'ent-' + reg2.data.user.id, channel: 'wechat' } });
    const supB = await req('POST', '/partner/superior-bindings', { token: reg2.data.token, body: { contextId: `partner:${reg2.data.user.id}`, inviteCode: code } });
    check('POST /partner/superior-bindings 凭注册码绑定 200', supB.status === 200 && supB.data.superior && supB.data.superior.phone === '13800000001', supB.data);

    // 代理归属码 → 带入代理归属
    const ag = await req('POST', '/me/invite-codes?contextId=partner:p6', { token: P6, body: { type: 'agent' } });
    check('生成代理归属码 201', ag.status === 201 && /^A/.test(ag.data.inviteCode.code), ag.data);
    const opts = await req('GET', `/agency/application-options?promotionCode=${ag.data.inviteCode.code}`, { token: P6 });
    check('代理归属码带入 referredBy', opts.status === 200 && opts.data.referredBy && opts.data.referredBy.id === 'p6', opts.data.referredBy);

    // ── P2-2 微信 OAuth ──
    const wauth = await req('POST', '/auth/wechat/authorizations', { body: { redirectUri: 'https://h5.example.com/cb' } });
    check('POST /auth/wechat/authorizations 200', wauth.status === 200 && !!wauth.data.url && !!wauth.data.state, wauth.data);
    check('未配置微信凭据时为 mock 模式', wauth.data.mode === 'mock', wauth.data.mode);
    const wex = await req('POST', '/auth/wechat/exchanges', { body: { code: 'mock-code' } });
    check('POST /auth/wechat/exchanges 200（mock 票据）', wex.status === 200 && !!wex.data.registrationTicket, wex.data);

    // ── P1-7 阶梯 ──
    const lad = await req('GET', '/partner/ladder?contextId=partner:p1', { token: P1 });
    check('GET /partner/ladder 200', lad.status === 200, lad.data);
    check('阶梯含 10 级 + 坐标', lad.data.levels && lad.data.levels.length === 10 && lad.data.levels.every((l) => l.coord), lad.data.levels && lad.data.levels.length);
    check('阶梯含当前等级/距下一级', lad.data.currentLevel && lad.data.currentScore != null && lad.data.toNext != null, { cur: lad.data.currentLevel, toNext: lad.data.toNext });
    check('阶梯分数来源=累计经验值', lad.data.scoreSource && /经验/.test(lad.data.scoreSource), lad.data.scoreSource);
  } finally {
    try { srv.kill(); } catch (e) { /* ignore */ }
  }
}

unitTests().then(() => {
  console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
  process.exit(failed ? 1 : 0);
}).catch((e) => {
  console.error('脚本异常：', e);
  process.exit(1);
});

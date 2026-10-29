/**
 * 脑商AI合伙人 H5 · 契约接口层（RESTful，对接前端契约《后端API需求文档.md》）
 *
 * 设计：
 *   - 复用 commission / settlement / regionAgent / productSplit / costorePlan / store / quotaLedger 纯函数。
 *   - 鉴权：Bearer token（getSession 已支持）。
 *   - contextId 形如 `partner:<userId>` / `costore:<userId>` / `agency:<userId>`（bootstrap 下发）；
 *     无前缀时整体当作 userId。
 *   - 金额单位：引擎内部按「元」计算并 round2，本层直接返回「元」数值；契约约定对外用「分」，
 *     联调前需统一（建议后端转整数分）——见《后端API交接说明》第 4 节。
 *
 * 范围（本批次实现）：
 *   ✅ §3 认证（登录/bootstrap/登出/注册/短信/密码/微信占位）
 *   ✅ §7 商城目录/详情/报价、§8 订单（创建/列表/详情/取消/收货/支付占位）
 *   ✅ §9 经营报表（全部 GET）
 *   ✅ §10 经营操作（名额划拨/购买/升级/年度权益/绑定门店 三段式）
 *   ✅ §12 创始奖、合店申请、代理申请
 *   ✅ §4/§5/§6/§11/§13/§14 业务模块（个人中心/地址/优惠券/家庭会员/激活/学习/公告/课程/
 *      收益分配/钱包提现/门店工作台/健脑官/课时/反馈/转店/上传/素材/合成任务）见 h5biz.js
 *   仅保留占位：短信/微信登录/密码重置（返回 mock 票据）、支付attempt（免支付直通）。
 */
const S = require('../store');
const IZ = require('../identity');
const R = require('../routes');
const C = require('../commission');
const Q = require('../quotaLedger');
const PAY = require('../payment');
const CD = require('./h5codes');
const PS = require('../productSplit');
const RA = require('../regionAgent');
const SET = require('../settlement');
const CP = require('../costorePlan');
const SI = require('../storeIncome');
const EXP = require('../experience');
const OL = require('../orderLifecycle');
const DIV = require('../dividendGate');
const BIZ = require('../bizType');
const ALC = require('../allocation');
const PWD = require('../utils/password');
const IC = require('../inviteCode');
const QT = require('../quoteStore');
const US = require('../upgradeService');
const LAD = require('../ladder');
const B = require('./h5biz');
const CAT = require('../catalogDisplay');   // 商品目录展示层（前端商城结构）
const COLS = require('../columns');         // 专栏定义（db.columns，业务可编辑）
const STK = require('../stock');            // SKU 库存台账

/**
 * 当前登录者的「商城身份视图」（2026-10-27）
 *
 * 商城折扣**只按购买者本人的身份**算，与孩子的会员等级无关（用户明确：孩子没有折扣）：
 *   代理身份（regionalAgents.region_type）> 合伙人档位（users.tier）> 原价
 * ⚠️ 家长加孩子后 display_id 前缀会跟着孩子走，但 tier / 代理记录都不变 → 身份不会丢。
 * @param {object} db
 * @param {object} sess 会话（role='user' 时才有 userId）
 * @returns {null|{buyer:object, agentRec:object|null}}
 */
function viewerOf(db, sess) {
  if (!sess || sess.role !== 'user' || !sess.userId) return null;
  const buyer = db.users[sess.userId];
  if (!buyer) return null;
  const agentRec = db.regionalAgents.find((a) => a.partner_id === sess.userId) || null;
  return { buyer, agentRec };
}

/**
 * 报价 / 下单的商品组合。
 * ⚠️ 键序必须完全一致：quoteStore.checkQuote 用 JSON.stringify 逐字比对，
 * 报价与下单任一侧改了形状都会判"商品组合与报价不一致"。
 */
const quoteItems = (key, qty, skuId) => (skuId ? [{ key, qty, skuId }] : [{ key, qty }]);

const T_CN = {
  supply: '供应差价', direct: '直推奖', rebuy: '复购奖', parity: '平级奖',
  global: '全球奖', founding: '创始奖', agent: '区域代理', costore: '合店费',
  region_vip: '区域奖', region_goods_diff: '商品级差', region_signing: '直推代理奖',
  region_admin_delivery: '行政费', region_costore: '合店提成', region_vip_partner: 'VIP合伙人奖',
  product: '产品分润',
};
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const periodOf = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin888';
const nowMs = () => Date.now();

/**
 * contextId -> { userId, module, scope }
 *
 * 格式：`<module>:<userId>` 或 `<module>:<userId>:<scope>`
 *   scope 是同一用户在同一模块下的**第 N 个身份**（代理任命记录 id / 合店合同 id），
 *   用来在「一个用户同时是省代+市代」或「持有多家合店」时精确选中身份。
 *
 * module 归一：
 *   wholesale → partner（前端叫「批发」，后端身份 key 叫 partner）
 *   agent     → agency  （前端叫「代理」，历史 key 叫 agent）
 */
function resolveContext(contextId) {
  if (!contextId) return { userId: null, module: null };
  const i = contextId.indexOf(':');
  if (i > -1) {
    const mod = contextId.slice(0, i);
    const rest = contextId.slice(i + 1);
    const j = rest.indexOf(':');
    const id = j > -1 ? rest.slice(0, j) : rest;
    const scope = j > -1 ? rest.slice(j + 1) : null;
    const norm = mod === 'wholesale' ? 'partner' : (mod === 'agent' ? 'agency' : mod);
    if (['partner', 'costore', 'agency'].includes(norm)) {
      return { userId: id, module: norm, scope: scope || null };
    }
  }
  return { userId: contextId, module: null };
}

/**
 * 代理层级：后端 region_type（小写）→ 前端 agencyType（大写枚举）
 * 前端 src/components/AgencyDashboard.vue 按 PROVINCE/CITY/COUNTY/STORE 分组渲染。
 */
const AGENCY_TYPE_MAP = { store: 'STORE', district: 'COUNTY', city: 'CITY', province: 'PROVINCE' };
const AGENCY_TYPE_CN = { STORE: '单店代理', COUNTY: '区县代理', CITY: '市代', PROVINCE: '省代' };

/**
 * 各经营身份可用的功能点（`${module}:${toolId}`）。
 *
 * 与前端 src/features/business/catalog.js 的 businessTools 一一对应 ——
 * 前端 visibleBusinessTools() 按 context.capabilities 过滤工具列表，
 * 后端若返回空数组，工作台会出现「有身份但没有任何功能入口」。
 * scripts/verify_business_contract.js 会比对两边，防止清单漂移。
 */
const BUSINESS_CAPABILITIES = {
  wholesale: ['income', 'superior', 'share', 'materials', 'global-awards', 'promotion', 'experience', 'team',
    'quota-ledger', 'quota-transfers', 'quota-batches', 'quota-transfer', 'quota-purchase', 'upgrade', 'entitlement', 'bind-store'],
  costore: ['income', 'card-dividends', 'promotion-dividends'],
  agency: ['team', 'income'],
};
function businessCapabilities(module, agencyType) {
  const list = (BUSINESS_CAPABILITIES[module] || []).slice();
  // 门店管理只对单店代理有意义
  if (module === 'agency' && agencyType === 'STORE') list.push('store-management');
  return list.map((id) => module + ':' + id);
}

/**
 * 构造经营身份上下文列表（前端契约）。
 *
 * 契约来源：前端 src/services/business.js getBusinessContexts() 的判据 +
 *          src/services/mock/business.js mockBusinessContexts() 的样本形状。
 * 后端此前只发 id/accountId/module/label/detail/capabilities/validUntil，
 * 缺 storeId/contractId/assignmentId/agencyType → 前端直接抛「经营身份配置异常」，
 * 整个经营中心（联营/合店/批发）都打不开。
 */
function buildBusinessContexts(db, userId, identities) {
  const out = [];
  const partner = (identities || []).find((i) => i.key === 'partner');
  if (partner) {
    out.push({
      id: `wholesale:${userId}`, accountId: userId, module: 'wholesale',
      label: '批发商', levelName: partner.detail, detail: partner.detail,
      capabilities: businessCapabilities('wholesale'), validUntil: null, storeId: null,
    });
  }
  // 区域代理：一条 regionalAgents 记录 = 一个经营身份（同一用户可同时是省代 + 市代）
  for (const a of db.regionalAgents || []) {
    if (a.partner_id !== userId) continue;
    const agencyType = AGENCY_TYPE_MAP[a.region_type];
    if (!agencyType) continue;
    const isStore = a.region_type === 'store';
    const store = isStore
      ? { id: a.region_code, name: a.store_name || `脑商线下店 ${a.region_code}`, address: a.store_address || '', contact: a.store_contact || '' }
      : null;
    out.push({
      id: `agency:${userId}:${a.id}`, accountId: userId, module: 'agency',
      label: AGENCY_TYPE_CN[agencyType], detail: `${AGENCY_TYPE_CN[agencyType]} · ${a.region_code || ''}`,
      regionLabel: a.region_code || '', scopeLabel: AGENCY_TYPE_CN[agencyType],
      agencyType, assignmentId: a.id,
      storeId: store ? store.id : null, store,
      capabilities: businessCapabilities('agency', agencyType), validUntil: null,
    });
  }
  // 合店：一个门店 = 一个经营身份（种子数据存在同一门店的重复记录 → 按门店去重）
  const seenStore = new Set();
  for (const c of db.coStores || []) {
    if (c.owner_id !== userId && !(c.owners || []).some((o) => o.id === userId)) continue;
    const storeId = c.store_id || c.storeManagerId;
    if (!storeId || seenStore.has(storeId)) continue;
    seenStore.add(storeId);
    out.push({
      id: `costore:${userId}:${c.id}`, accountId: userId, module: 'costore',
      label: `合店 ${storeId}`, detail: `合店老板 · 门店 ${storeId}`,
      contractId: c.id, storeId,
      store: { id: storeId, name: `合店 ${storeId}`, address: '', contact: '' },
      capabilities: businessCapabilities('costore'), validUntil: null,
    });
  }
  return out;
}

/** 拉平团队树为成员列表 */
function flatDownline(tree, acc = []) {
  if (!tree) return acc;
  for (const n of (tree.children || [])) {
    acc.push(n);
    flatDownline(n, acc);
  }
  return acc;
}

/**
 * 路由别名表（《后端API需求文档》§16「联调命名与现有适配差异」）
 *
 * 前端按**业务化短路径**调用认证类接口（更贴近前端语义），
 * 后端内部仍使用 REST 资源路径；此处在路由匹配前做一次等价重写，
 * 使两端无需各改一半即可联调。
 *
 *   POST /auth/login            → /auth/sessions
 *   POST /auth/register         → /auth/registrations
 *   POST /auth/sms/send         → /auth/sms-challenges
 *   POST /auth/password/verify  → /auth/password-reset-verifications
 *   POST /auth/password/reset   → /auth/password-resets
 *   POST /auth/password/change  → /me/password-changes
 *   POST /auth/wechat/authorize → /auth/wechat/authorizations
 *   POST /auth/wechat/exchange  → /auth/wechat/exchanges
 *
 * ⚠️ 别名只在 POST 上生效（这些接口都是动作型 POST），GET 语义仍走 REST 原路径。
 */
const ROUTE_ALIASES = {
  '/auth/login': '/auth/sessions',
  '/auth/register': '/auth/registrations',
  '/auth/sms/send': '/auth/sms-challenges',
  '/auth/password/verify': '/auth/password-reset-verifications',
  '/auth/password/reset': '/auth/password-resets',
  '/auth/password/change': '/me/password-changes',
  '/auth/wechat/authorize': '/auth/wechat/authorizations',
  '/auth/wechat/exchange': '/auth/wechat/exchanges',
};

/**
 * 统一入口。返回 true 表示已处理（无论成功失败）；返回 false 表示不归本层（交给 /api/*）。
 */
async function handle(db, req, res, url, { readBody, sendJSON, sessions, persist }) {
  const m = req.method;
  // 路径别名重写（仅 POST 动作型接口）
  const p = (m === 'POST' && ROUTE_ALIASES[url.pathname]) || url.pathname;
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : (url.searchParams.get('token') || '');
  const sess = sessions[token] || null;
  const ok = (code, obj) => { sendJSON(res, code || 200, obj); return true; };
  const fail = (code, msg) => { sendJSON(res, code, { error: msg }); return true; };
  // 问题8：错误对象带 status（如幂等键冲突 409）→ 用对应 HTTP 码返回
  const failErr = (e, dflt = 400) => fail((e && e.status) || dflt, e && e.message ? e.message : String(e));
  const save = () => { if (typeof persist === 'function') persist(); };
  const q = (k) => url.searchParams.get(k);

  // 纯 API 服务：带扩展名的路径一律不归契约层（交回 server.js 返回 404）。
  if (m === 'GET' && (p === '/' || /\.(html|js|css|png|jpe?g|gif|svg|ico|map|woff2?|ttf)$/i.test(p))) return false;

  // ───────────────────────── §3 认证、注册与身份初始化 ─────────────────────────
  if (p === '/auth/sessions' && m === 'POST') {
    const b = await readBody(req);
    const channel = b.channel || 'parent';
    if (channel === 'admin') {
      if (b.password !== ADMIN_PASSWORD) return fail(401, '管理员密码错误');
      const t = 'admin-' + Math.random().toString(36).slice(2);
      sessions[t] = { role: 'admin' };
      return ok(200, { token: t, user: { id: 'admin', name: '总部/后台', role: 'admin' }, accountType: 'admin', expiresAt: null });
    }
    if (channel === 'coach') {
      // 健脑官独立登录（测试平台按 loginAccount 登录；初始凭证发放方式待业务确认，不返回明文密码）
      const coach = B.findCoachByLogin(db, b.loginAccount);
      if (!coach) return fail(404, '健脑官账号不存在');
      if (coach.status !== 'ACTIVE') return fail(403, '账号已停用');
      const t = 'coach-' + Math.random().toString(36).slice(2);
      sessions[t] = { role: 'coach', coachId: coach.id, storeId: coach.storeId, name: coach.name };
      return ok(200, { token: t, user: { id: coach.id, name: coach.name, role: 'coach' }, accountType: 'coach', expiresAt: null });
    }
    // parent：手机号 + 密码 登录（账号密码登录，不再免密直接发 token）
    const phone = b.phone;
    const password = b.password;
    if (!phone) return fail(400, 'parent 登录需 phone');
    if (!password) return fail(400, 'parent 登录需 password');
    const u = S.getUserByPhone(db, phone);
    if (!u) return fail(404, '未找到该手机号对应的合伙人');
    if (!u.password) return fail(403, '该账号尚未设置密码，请先注册或重置密码');
    const v = PWD.verifyPassword(u.password, password);
    if (!v.ok) return fail(401, '手机号或密码错误');
    if (v.needsUpgrade) { PWD.upgradeIfPlaintext(u, password); save(); }
    const t = 'user-' + Math.random().toString(36).slice(2);
    sessions[t] = { role: 'user', userId: u.id };
    return ok(200, { token: t, user: { id: u.id, name: u.name, role: 'user', displayId: u.display_id }, entitlement: { state: IZ.entitlementState(u), amount: IZ.ENTITLEMENT_AMOUNT }, accountType: 'parent', expiresAt: null });
  }
  if (p === '/auth/sms-challenges' && m === 'POST') {
    const b = await readBody(req);
    if (!b.phone || !b.purpose) return fail(400, '需 phone 与 purpose');
    if (!['register', 'reset-password', 'login'].includes(b.purpose)) return fail(400, 'purpose 为 register/reset-password/login');
    const code = String(Math.floor(100000 + Math.random() * 900000));
    db.smsChallenges = db.smsChallenges || [];
    // 同一手机号+用途：旧验证码作废，只认最新一条（防刷 + 避免旧码仍可用）
    for (const c of db.smsChallenges) {
      if (c.phone === b.phone && c.purpose === b.purpose && !c.used) c.used = true;
    }
    db.smsChallenges.push({ phone: b.phone, code, purpose: b.purpose, expiresAt: nowMs() + 300000, used: false });
    save();
    // P2-1（2026-10-26）：验证码**不回传**到响应体，避免绕过短信通道直接登录。
    //   仅当显式设置 EXPOSE_DEV_CODE=1（本地联调）时才带 devCode；生产必须走短信网关。
    //
    // 开发联调：验证码输出到**后端终端**（IDEA Console / node 进程 stdout），
    //   走终端而不是响应体 → 抓包拿不到验证码，联调安全且无需短信网关。
    const isProd = String(process.env.NODE_ENV || '') === 'production';
    const logToConsole = !isProd || String(process.env.SMS_LOG_CONSOLE || '') === '1';
    if (logToConsole) {
      const masked = String(b.phone).replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2');
      console.log(`[短信验证码] 手机号 ${masked} | 用途 ${b.purpose} | 验证码 ${code} | 5 分钟内有效`);
    }
    const expose = String(process.env.EXPOSE_DEV_CODE || '') === '1';
    return ok(200, expose
      ? { retryAfter: 60, expiresAt: nowMs() + 300000, devCode: code, note: '开发联调模式：EXPOSE_DEV_CODE=1，验证码直接返回' }
      : { retryAfter: 60, expiresAt: nowMs() + 300000 });
  }
  if (p === '/auth/registrations' && m === 'POST') {
    const b = await readBody(req);
    if (!b.phone || !b.password) return fail(400, '需 phone 与 password');
    if (S.getUserByPhone(db, b.phone)) return fail(409, '该手机号已注册');
    // 短信验证码校验（与密码重置同口径）：必须有「本手机号 + register 用途 + 未使用 + 未过期」的验证码
    const ch = (db.smsChallenges || []).filter((c) => c.phone === b.phone && c.purpose === 'register' && !c.used && c.expiresAt > nowMs()).pop();
    if (!ch) return fail(400, '验证码不存在或已过期，请先获取');
    if (!b.code || String(b.code).trim() !== ch.code) return fail(400, '验证码错误');
    ch.used = true;
    let upline_id = null;
    let inviteRec = null;
    if (b.inviteCode) {
      // P1-8：优先按「注册邀请码」（类型化）解析；未命中则回退旧码（手机号/uid）兼容
      const icCfg = (S.getSettings(db) || {}).inviteCode || {};
      inviteRec = IC.resolveInviteCode(db, b.inviteCode);
      if (inviteRec && inviteRec.type === 'register' && icCfg.bindOnRegister !== false) {
        upline_id = inviteRec.ownerId;
      } else {
        const inv = S.getUserByPhone(db, b.inviteCode) || db.users[b.inviteCode];
        if (inv) upline_id = inv.id;
      }
    }
    const id = 'u_' + Math.random().toString(36).slice(2, 8);
    const u = S.addUser(db, { id, name: b.name || b.phone, phone: b.phone, tier: 'vip', upline_id, is_founding: 'none', teamVip: 0 });
    if (inviteRec && inviteRec.ownerId === upline_id) inviteRec.usedBy.push({ userId: id, at: nowMs() });
    // P2-2：微信登录票据 → 绑定 openid（票据一次性使用）
    if (b.wechatTicket) {
      const tk = (db.wechatTickets || []).find((t) => t.ticket === b.wechatTicket && t.expiresAt > nowMs());
      if (tk) { u.wechat_openid = tk.openid; if (tk.unionid) u.wechat_unionid = tk.unionid; tk.usedAt = nowMs(); }
    }
    PWD.setPassword(u, b.password);
    // 地区：前端注册页强制要求 3 级地区编码，落库后 /me 可回显（否则用户所选地区丢失）
    if (Array.isArray(b.regionCodes) && b.regionCodes.length === 3) {
      u.regionCodes = b.regionCodes.slice();
      u.regionNames = Array.isArray(b.regionNames) ? b.regionNames.slice() : [];
    }
    // 新注册：权益未开通 → QZ 编号 + 全功能门禁（收益照算、付清 200 后解锁可见）
    u.entitlement_state = 'never_paid';
    IZ.recomputeDisplayId(db, id);
    db.quotaLedger[id] = { standard: 0, activity: [] };
    save();
    const t = 'user-' + Math.random().toString(36).slice(2);
    sessions[t] = { role: 'user', userId: id };
    return ok(200, { token: t, user: { id, name: u.name, role: 'user', displayId: u.display_id }, entitlement: { state: 'never_paid', amount: IZ.ENTITLEMENT_AMOUNT }, accountType: 'parent', expiresAt: null });
  }
  if (p === '/auth/password-reset-verifications' && m === 'POST') {
    const b = await readBody(req);
    if (!b.phone || !b.code) return fail(400, 'phone 与 code 必填');
    const ch = (db.smsChallenges || []).find((c) => c.phone === b.phone && c.purpose === 'reset-password' && !c.used && c.expiresAt > nowMs());
    if (!ch) return fail(400, '验证码不存在或已过期，请先发送');
    if (String(b.code) !== ch.code) return fail(400, '验证码错误');
    ch.used = true;
    const ticket = 'prt_' + Math.random().toString(36).slice(2, 10);
    db.passwordResets = db.passwordResets || [];
    db.passwordResets.push({ ticket, phone: b.phone, expiresAt: nowMs() + 600000, used: false });
    save();
    return ok(200, { resetTicket: ticket, expiresAt: nowMs() + 600000 });
  }
  if (p === '/auth/password-resets' && m === 'POST') {
    const b = await readBody(req);
    if (!b.resetTicket) return fail(400, 'resetTicket 必填');
    const t = (db.passwordResets || []).find((x) => x.ticket === b.resetTicket && !x.used && x.expiresAt > nowMs());
    if (!t) return fail(400, '重置票据无效或已过期');
    if (!b.password || !PWD.isStrongEnough(b.password)) return fail(400, '新密码至少 6 位');
    const u = S.getUserByPhone(db, t.phone);
    if (!u) return fail(404, '账号不存在');
    PWD.setPassword(u, b.password); t.used = true; save();
    return ok(200, { success: true });
  }
  if (p === '/me/password-changes' && m === 'POST') {
    if (!sess || sess.role !== 'user') return fail(401, '未登录');
    const b = await readBody(req);
    const u = db.users[sess.userId];
    if (!u) return fail(404, '用户不存在');
    if (!b.newPassword || !PWD.isStrongEnough(b.newPassword)) return fail(400, '新密码至少 6 位');
    if (u.password) {
      const v = PWD.verifyPassword(u.password, b.oldPassword || '');
      if (!v.ok) return fail(400, '原密码错误');
      if (v.needsUpgrade) PWD.upgradeIfPlaintext(u, b.oldPassword || '');
    }
    PWD.setPassword(u, b.newPassword); save();
    return ok(200, { changed: true });
  }
  // ── P2-2 微信 OAuth 登录 ──
  //   配置（WECHAT_APPID / WECHAT_SECRET）齐全 → 走真实微信授权与 code 换 openid；
  //   未配置 → 走 mock 模式（返回 mock 授权地址与 mock 注册票据），保证本地联调不阻塞。
  if (p === '/auth/wechat/authorizations' && m === 'POST') {
    const b = await readBody(req);
    const state = Math.random().toString(36).slice(2);
    const appid = process.env.WECHAT_APPID || '';
    const redirectUri = b.redirectUri || '';
    if (appid) {
      const url = 'https://open.weixin.qq.com/connect/oauth2/authorize'
        + '?appid=' + encodeURIComponent(appid)
        + '&redirect_uri=' + encodeURIComponent(redirectUri)
        + '&response_type=code&scope=snsapi_base&state=' + encodeURIComponent(state)
        + '#wechat_redirect';
      return ok(200, { url, state, mode: 'live', note: '真实微信授权地址；回调时请把 code 透传到 /auth/wechat/exchanges' });
    }
    return ok(200, { url: 'https://mock.wechat.example.com/authorize?redirect_uri=' + encodeURIComponent(redirectUri) + '&state=' + state, state, mode: 'mock', note: '未配置 WECHAT_APPID，返回 mock 授权地址（仅供本地联调）' });
  }
  if (p === '/auth/wechat/exchanges' && m === 'POST') {
    const b = await readBody(req);
    const appid = process.env.WECHAT_APPID || '';
    const secret = process.env.WECHAT_SECRET || '';
    if (!appid || !secret) {
      return ok(200, { registrationTicket: 'mock-' + Math.random().toString(36).slice(2), expiresAt: nowMs() + 300000, mode: 'mock', note: '未配置 WECHAT_APPID/WECHAT_SECRET，返回 mock 注册票据' });
    }
    if (!b.code) return fail(400, 'code 必填');
    try {
      const u = 'https://api.weixin.qq.com/sns/oauth2/access_token'
        + '?appid=' + encodeURIComponent(appid)
        + '&secret=' + encodeURIComponent(secret)
        + '&code=' + encodeURIComponent(b.code)
        + '&grant_type=authorization_code';
      const r = await fetch(u);
      const j = await r.json().catch(() => ({}));
      if (j.errcode || !j.openid) return fail(400, `微信换取 openid 失败：${j.errcode || 'unknown'} ${j.errmsg || ''}`.trim());
      const ticket = 'wx-' + j.openid + '-' + Math.random().toString(36).slice(2, 8);
      db.wechatTickets = db.wechatTickets || [];
      db.wechatTickets.push({ ticket, openid: j.openid, unionid: j.unionid || null, expiresAt: nowMs() + 300000, at: nowMs() });
      save();
      return ok(200, { registrationTicket: ticket, expiresAt: nowMs() + 300000, mode: 'live', note: '凭 ticket 到 /auth/registrations 完成注册/登录' });
    } catch (e) {
      return fail(502, '调用微信接口失败：' + e.message);
    }
  }
  if (p === '/me/bootstrap' && m === 'GET') {
    if (!sess || sess.role !== 'user') return fail(401, '未登录');
    const userId = sess.userId;
    const u = S.getUser(db, userId);
    if (!u) return fail(404, '用户不存在');
    const idRes = R.getIdentities(db, userId);
    const businessContexts = buildBusinessContexts(db, userId, idRes.identities);
    // contexts：学习身份上下文（家长本人 + 每个孩子）
    //   前端 learning.js 的 getLearningIdentities() 只认这个数组，并且按
    //   accountId + mode('parent'|'child') + memberId 过滤；
    //   之前这里写死 [] → 会员页只能显示"暂无可用身份，请联系服务人员"，
    //   等级区也永远是"暂无等级"。
    //   字段口径与前端 mock/learning.js 的 mockIdentities 保持一致。
    const contexts = [];
    contexts.push({
      id: `parent:${userId}`, accountId: userId, mode: 'parent',
      name: u.name || '家长', displayId: u.display_id || userId,
      grade: '', badge: '家长',
    });
    for (const mm of (db.members || []).filter((x) => x.userId === userId)) {
      const unlockedCount = (mm.unlockedLevels || []).length;
      contexts.push({
        id: `member:${mm.id}`, accountId: userId, mode: 'child', memberId: mm.id,
        name: mm.name, displayId: mm.display_id || mm.id,
        grade: mm.gradeLabel || '',
        badge: (mm.memberLevel && mm.memberLevel !== 'normal')
          ? IZ.memberTierName(mm.memberLevel)
          : (unlockedCount ? '已开通等级' : '未激活会员'),
      });
    }
    const ent = IZ.entitlementState(u);
    return ok(200, {
      displayId: u.display_id,
      entitlement: { state: ent, amount: IZ.ENTITLEMENT_AMOUNT, expiresAt: u.entitlement_expires_at || null, frozen: ent === 'expired', canExportBills: ent === 'expired' },
      contexts, businessContexts,
    });
  }
  // 权益收益费开通/续费（周期制；当前免支付占位，正式收银台接入后替换）
  if (p === '/me/entitlement-orders' && m === 'POST') {
    if (!sess || sess.role !== 'user') return fail(401, '未登录');
    const b = await readBody(req);
    if (!b.idempotencyKey) return fail(400, 'idempotencyKey 必填');
    const u = db.users[sess.userId];
    if (!u) return fail(404, '用户不存在');
    const channel = b.channel || 'wechat';   // wechat/alipay/bank_card
    let created;
    try {
      created = PAY.createPayment(db, { bizType: 'entitlement', userId: sess.userId, amount: IZ.ENTITLEMENT_AMOUNT, channel, idempotencyKey: b.idempotencyKey });
    } catch (e) { return fail(400, e.message); }
    if (created.paid) {
      if (!created.duplicated) PAY.applyBizEffect(db, created.payment);
      save();
      const uu = db.users[sess.userId];
      return ok(200, { status: 'SUCCEEDED', operationId: created.payment.id, paymentId: created.payment.id, channel: created.payment.channel, displayId: uu.display_id, entitlement: { state: IZ.entitlementState(uu), amount: IZ.ENTITLEMENT_AMOUNT, paidAt: uu.entitlement_paid_at, expiresAt: uu.entitlement_expires_at }, note: created.payment.note });
    }
    save();
    return ok(200, { status: 'CREATED', paymentId: created.payment.id, channel: created.payment.channel, channelName: PAY.channelName(created.payment.channel), amount: IZ.ENTITLEMENT_AMOUNT, payParams: created.payParams, note: '请调起支付；支付结果以渠道异步通知为准（可轮询 GET /me/payments/{id}）' });
  }
  // ── 支付单查询（我的支付单；未开通用户亦可查权益单状态，故置于门禁之前） ──
  if (p === '/me/payments' && m === 'GET') {
    if (!sess || sess.role !== 'user') return fail(401, '未登录');
    return ok(200, { items: PAY.listPayments(db, sess.userId).map(PAY.publicPayment), hasMore: false, nextCursor: null, paymentMode: PAY.PAYMENT_MODE });
  }
  if (p.startsWith('/me/payments/') && m === 'GET' && !p.endsWith('/sandbox-confirm')) {
    if (!sess || sess.role !== 'user') return fail(401, '未登录');
    const id = p.slice('/me/payments/'.length);
    const pay = PAY.getPayment(db, id);
    if (!pay || pay.userId !== sess.userId) return fail(404, '支付单不存在');
    return ok(200, { payment: PAY.publicPayment(pay), payParams: pay.status === 'CREATED' ? pay.payParams : undefined });
  }
  // 沙箱确认（live 模式联调：模拟渠道异步通知入账；sandbox 模式已自动支付）
  if (p.startsWith('/me/payments/') && p.endsWith('/sandbox-confirm') && m === 'POST') {
    if (!sess || sess.role !== 'user') return fail(401, '未登录');
    const id = p.slice('/me/payments/'.length, p.length - '/sandbox-confirm'.length);
    const pay = PAY.getPayment(db, id);
    if (!pay || pay.userId !== sess.userId) return fail(404, '支付单不存在');
    if (!PAY.IS_SANDBOX && pay.status !== 'PAID') {
      const r = PAY.settlePayment(db, id, { transactionId: 'sandbox_confirm' }); save();
      return ok(200, { payment: PAY.publicPayment(r.payment), effect: r.effect || null });
    }
    return ok(200, { payment: PAY.publicPayment(pay), note: PAY.IS_SANDBOX ? 'sandbox 模式已自动支付' : '该单已支付' });
  }
  // 渠道异步通知（公开端点：验签 → 入账 → 业务效果；置于登录门禁之前）
  if (p.startsWith('/payments/notify/') && m === 'POST') {
    const channel = p.slice('/payments/notify/'.length);
    const b = await readBody(req);
    const r = PAY.handleNotify(db, channel, b);
    if (!r.ok) return fail(400, r.error);
    save();
    return ok(200, { ok: true, paymentId: r.payment.id, status: r.payment.status, newlyPaid: r.newlyPaid, effect: r.effect || null });
  }
  // 历史账单导出（权益过期后仍可导出之前的收益；未开通无账单可导）
  if (p === '/me/income-export' && m === 'GET') {
    if (!sess || sess.role !== 'user') return fail(401, '未登录');
    const u = db.users[sess.userId];
    if (!u) return fail(404, '用户不存在');
    const st = IZ.entitlementState(u);
    if (st === 'never_paid') return fail(403, '未开通权益收益费，暂无账单可导出');
    const rows = db.commissions.filter((c) => c.owner_id === sess.userId).sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
    const total = round2(rows.reduce((s, c) => s + c.amount, 0));
    const byType = {};
    for (const c of rows) byType[c.type] = round2((byType[c.type] || 0) + c.amount);
    const items = rows.map((c) => ({ id: c.id, period: c.period || null, category: c.type, title: T_CN[c.type] || c.type, amount: c.amount, baseAmount: c.base_amount, rate: c.rate, status: c.status || 'SETTLED', createdAt: c.created_at, sourceOrder: c.ref_order_id || null }));
    if (q('format') === 'csv') {
      const head = '编号,月份,类型,金额(元),基数,比例,状态,来源订单,时间\n';
      const body = rows.map((c) => [c.id, c.period || '', T_CN[c.type] || c.type, c.amount, c.base_amount == null ? '' : c.base_amount, c.rate == null ? '' : c.rate, c.status || 'SETTLED', c.ref_order_id || '', c.created_at ? new Date(c.created_at).toISOString() : ''].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="income-${u.display_id || sess.userId}.csv"` });
      res.end('\uFEFF' + head + body + `\n"合计","","",${total},,,,,\n`);
      return true;
    }
    return ok(200, { displayId: u.display_id, entitlementState: st, total, byType, count: rows.length, exportedAt: nowMs(), items });
  }
  if (p === '/auth/sessions/current' && m === 'DELETE') {
    if (token && sessions[token]) { delete sessions[token]; }
    return ok(200, { success: true });
  }

  // 以下需登录（user / admin / coach）
  // 例外：协议正文（用户服务协议 / 隐私政策）属公开法律文档，登录前也要能读（如注册页勾选协议）
  const isPublicDoc = m === 'GET' && p.startsWith('/agreements/');
  if (!sess && !isPublicDoc) return fail(401, '未登录或 token 失效');

  // ───────────────────────── 权益门禁（2026-10-24 用户确认） ─────────────────────────
  // 200 权益收益费未开通/已过期 → 什么功能都不给（前端隐藏全部功能入口，只留「开通权益」）。
  // 豁免：bootstrap（下发门禁状态）、开通/续费、历史账单导出（过期）、改密码、登出。
  if (sess && sess.role === 'user') {
    const me0 = db.users[sess.userId];
    const gate = IZ.gatePayload(me0);
    if (gate) {
      const EXEMPT = new Set(['/me/bootstrap', '/me/entitlement-orders', '/me/income-export', '/me/password-changes', '/auth/sessions/current']);
      if (!EXEMPT.has(p)) {
        return ok(200, {
          locked: true, entitlementState: gate.entitlementState, entitlementAmount: gate.entitlementAmount,
          frozen: gate.frozen, canExportBills: gate.canExportBills, message: gate.message,
          displayId: me0 ? me0.display_id : null,
          entitlement: { state: gate.entitlementState, amount: gate.entitlementAmount, expiresAt: me0 ? (me0.entitlement_expires_at || null) : null },
        });
      }
    }
  }

  // ───────────────────────── 业务模块层（§4/§5/§6/§11/§12遗留/§13/§14，见 h5biz.js） ─────────────────────────
  if (await B.handle(db, req, res, url, { sess, ok, fail, save, q, readBody, resolveContext })) return true;
  if (await CD.handle(db, req, res, url, { sess, ok, fail, save, q, readBody, resolveContext })) return true; // 支付/激活码发放（h5codes.js）

  // ───────────────────────── §9 经营报表（GET） ─────────────────────────
  const needCtx = (module) => {
    const cid = q('contextId');
    if (!cid) return fail(400, 'contextId 必填');
    const { userId, module: mod, scope } = resolveContext(cid);
    if (!userId || (module && mod && mod !== module)) return fail(400, 'contextId 与模块不匹配');
    if (!db.users[userId]) return fail(404, 'contextId 指向的用户不存在');
    return { userId, scope };
  };

  if (p === '/partner/overview' && m === 'GET') {
    const c = needCtx('partner'); if (!c.userId) return c;
    const me = R.getMe(db, c.userId);
    const u = db.users[c.userId] || {};
    // 本金（2026-10-26）：实际付过钱的最高档一口价；无本金记录时回退当前档（兼容旧种子）
    const principalTier = u.principal_tier || u.tier || null;
    const principal = principalTier ? (C.RETAIL_PRICE[principalTier] || 0) : 0;
    const idr = R.getIdentities(db, c.userId).identities.find((x) => x.key === 'partner');
    // 拉人免费升档进度（2026-10-26）：直推 N 名同级付费升档 → 免费升 1 档
    const referralFreeUpgrade = S.referralFreeUpgradeProgress(db, c.userId);
    // 经验值（P0-1）与晋升任务（P0-2）
    const expSum = EXP.summary(db, c.userId);
    const task = EXP.progress(db, c.userId);
    // 分红门槛提示（P0-7）
    const dividendPrompt = DIV.currentPrompt(db, c.userId, 'memberCard');
    return ok(200, {
      accountId: c.userId, contextId: q('contextId'), displayId: u.display_id || null,
      levelName: idr ? idr.detail : me.tier, partnerStatus: 'active', annualRemainingDays: null, rankDescription: '',
      experience: expSum.promotionExperience + expSum.productExperience,
      experienceDetail: { promotion: expSum.promotionExperience, product: expSum.productExperience },
      experienceTarget: 0, benefits: [],
      quotaBalance: me.quota_balance, monthIncome: me.month_income, monthByType: me.month_by_type, teamVip: me.team_vip,
      principalTier, principal, referralFreeUpgrade,
      promotionTask: task, dividendPrompt,
    });
  }
  if (p === '/costore/overview' && m === 'GET') {
    const c = needCtx('costore'); if (!c.userId) return c;
    const cs = R.getCostore(db, c.userId, { contractId: c.scope || q('contractId') });
    if (!cs) return fail(404, '该用户无合店记录');
    return ok(200, { accountId: c.userId, contextId: q('contextId'), storeId: cs.store_id || cs.storeManagerId, contractId: cs.id, monthlyFee: cs.monthly_fee, scenario: cs.scenario, byRecipient: cs.byRecipient, dividendPool: cs.dividendPool, benefits: [] });
  }
  if (p === '/agency/overview' && m === 'GET') {
    const c = needCtx('agency'); if (!c.userId) return c;
    const ag = R.getAgent(db, c.userId, { assignmentId: c.scope || q('assignmentId') });
    if (!ag) return fail(404, '该用户无区域代理身份');
    const agencyType = AGENCY_TYPE_MAP[ag.agent.region_type] || ag.agent.region_type;
    return ok(200, { accountId: c.userId, contextId: q('contextId'), agencyType, regionCode: ag.agent.region_code, grantedTier: ag.agent.granted_tier || null, levelName: `${AGENCY_TYPE_CN[agencyType] || agencyType} · ${ag.agent.region_code || ''}`, monthIncome: ag.month_income, byRegion: ag.by_region, benefits: [] });
  }
  if (p === '/partner/income' && m === 'GET') {
    const c = needCtx('partner'); if (!c.userId) return c;
    const r = R.getCommissions(db, c.userId, { identity: 'partner' });
    const items = r.list.map((x) => ({ id: x.id, title: T_CN[x.type] || x.type, category: x.type, amount: x.amount, rate: x.rate, baseAmount: x.base_amount, createdAt: x.created_at, status: x.status || 'SETTLED', sourceOrder: x.ref_order_id || null, ...BIZ.enrich(db, x) }));
    const available = round2(items.reduce((s, i) => s + i.amount, 0));
    return ok(200, { available, metrics: [{ label: '可提现金额', kind: 'money', value: available }], items });
  }
  if (p === '/partner/team' && m === 'GET') {
    const c = needCtx('partner'); if (!c.userId) return c;
    const tree = R.getTeam(db, c.userId);
    const flat = flatDownline(tree);
    const items = flat.map((n) => ({ id: n.id, name: n.name, displayId: n.displayId || n.id, phone: n.phone, levelLabel: n.tier, storeName: n.storeName || null, joinedAt: n.joinedAt || null, performance: n.performance || 0 }));
    return ok(200, { items, hasMore: false, nextCursor: null });
  }
  if (p === '/income/entries' && m === 'GET') {
    const c = needCtx(); if (!c.userId) return c;
    const identity = q('filter') === 'pending' ? null : q('identity') || null;
    const r = R.getCommissions(db, c.userId, { identity });
    const items = r.list.map((x) => ({ id: x.id, title: T_CN[x.type] || x.type, category: x.type, amount: x.amount, rate: x.rate, baseAmount: x.base_amount, createdAt: x.created_at, status: x.status || 'SETTLED', allocationStatus: x.allocationStatus || 'NONE', allocationKind: ALC.publicKind(ALC.kindOf(x)), incomeChannel: SI.incomeChannelOf(x), incomeChannelLabel: (SI.INCOME_CHANNEL[SI.incomeChannelOf(x)] || {}).label || null, settlementStatus: 'SETTLED', sourceOrder: x.ref_order_id || null, ...BIZ.enrich(db, x) }));
    const metrics = [{ label: '收益合计', kind: 'money', value: r.total }];
    return ok(200, { metrics, items, hasMore: false, nextCursor: null });
  }
  if (p.startsWith('/income/entries/') && m === 'GET') {
    const id = p.slice('/income/entries/'.length);
    const x = db.commissions.find((c) => c.id === id);
    if (!x) return fail(404, '收益不存在');
    const me = db.users[x.owner_id] || {};
    const order = x.ref_order_id ? db.orders.find((o) => o.id === x.ref_order_id) : null;
    const buyer = order && order.buyer_id ? db.users[order.buyer_id] : null;
    const idKeys = R.getIdentities(db, x.owner_id).identities.map((i) => i.name);
    const biz = BIZ.enrich(db, x);
    // P0-9：仅「巡查 5% / 销售 5%」可分配池才给 allocate 动作（与 allocation-options 的可分配判定一致）
    const alloc = ALC.allocatable(db, x);
    return ok(200, {
      id: x.id, title: T_CN[x.type] || x.type, category: x.type, channel: 'H5', paymentTypeLabel: '微信支付',
      identityLabel: idKeys.join('/'), baseAmount: x.base_amount, rateBps: Math.round((x.rate || 0) * 10000),
      amount: x.amount, createdAt: x.created_at, allocationKind: ALC.publicKind(alloc.kind), incomeChannel: SI.incomeChannelOf(x), incomeChannelLabel: (SI.INCOME_CHANNEL[SI.incomeChannelOf(x)] || {}).label || null,
      allocationStatus: x.allocationStatus || 'NONE', settlementStatus: 'SETTLED',
      beneficiaryName: me.name || null, recommended: !!x.is_direct, buyer: buyer ? { id: buyer.id, name: buyer.name } : null,
      store: order && order.regionCode ? { id: order.regionCode, name: '门店 ' + order.regionCode } : null,
      sourceOrder: x.ref_order_id || null, allowedActions: alloc.ok ? ['allocate'] : [], version: 1, formula: x.formula || null, note: x.note || null, ...biz,
    });
  }
  if (p === '/costore/card-dividends' && m === 'GET') {
    const c = needCtx('costore'); if (!c.userId) return c;
    const r = R.getCommissions(db, c.userId, { type: 'costore' });
    const items = r.list.map((x) => ({ id: x.id, title: '合店分红', amount: x.amount, createdAt: x.created_at, sourceOrder: x.ref_order_id || null }));
    return ok(200, { metrics: [{ label: '合店分红合计', kind: 'money', value: r.total }], items, hasMore: false, nextCursor: null });
  }
  if (p === '/costore/promotion-dividends' && m === 'GET') {
    const c = needCtx('costore'); if (!c.userId) return c;
    const r = R.getCommissions(db, c.userId, { type: 'costore' });
    const items = r.list.map((x) => ({ id: x.id, title: '推广分红', amount: x.amount, createdAt: x.createdAt || x.created_at, sourceOrder: x.ref_order_id || null }));
    return ok(200, { metrics: [{ label: '推广分红合计', kind: 'money', value: r.total }], items, hasMore: false, nextCursor: null });
  }
  if (p === '/agency/team' && m === 'GET') {
    const c = needCtx('agency'); if (!c.userId) return c;
    const ag = db.regionalAgents.find((a) => a.partner_id === c.userId);
    if (!ag) return fail(404, '无区域代理身份');
    const prefix = (ag.region_code || '').slice(0, 2);
    const team = db.regionalAgents
      .filter((a) => a.partner_id !== c.userId && (a.region_code || '').startsWith(prefix))
      .map((a) => { const o = db.users[a.partner_id]; return { id: a.partner_id, name: o ? o.name : a.partner_id, roleLabel: a.region_type, regionLabel: a.region_code, performance: 0 }; });
    return ok(200, { items: team, hasMore: false, nextCursor: null });
  }
  if (p.startsWith('/agency/team/') && m === 'GET') {
    const c = needCtx('agency'); if (!c.userId) return c;
    const id = p.slice('/agency/team/'.length);
    const node = db.users[id];
    if (!node) return fail(404, '节点不存在');
    const tree = R.getTeam(db, id);
    const flat = flatDownline(tree);
    return ok(200, {
      node: { id, name: node.name, roleLabel: node.tier },
      members: flat.map((n) => ({ id: n.id, name: n.name, roleLabel: n.tier || '', performance: n.performance || 0 })),
      stores: [], hasMore: false, nextCursor: null,
    });
  }
  if (p === '/partner/superior-bindings' && m === 'POST') {
    const b = await readBody(req);
    const cid = b.contextId || q('contextId');
    if (!cid) return fail(400, 'contextId 必填');
    const { userId } = resolveContext(cid);
    if (!userId || !db.users[userId]) return fail(404, 'contextId 无效');
    if (!b.inviteCode) return fail(400, 'inviteCode 必填');
    // P1-8：支持类型化「注册邀请码」；未命中再回退旧码（手机号/uid）
    const icRec = IC.resolveInviteCode(db, b.inviteCode);
    let target = null;
    if (icRec && icRec.type === 'register') {
      target = db.users[icRec.ownerId] || null;
    } else {
      target = S.getUserByPhone(db, b.inviteCode) || db.users[b.inviteCode] || null;
    }
    if (!target) return fail(404, '邀请码不存在');
    if (target.id === userId) return fail(400, '不能绑定自己为上级');
    try {
      R.rebind(db, { partnerId: userId, newUplineId: target.id });
      if (icRec && icRec.ownerId === target.id) icRec.usedBy.push({ userId, at: nowMs() });
      save();
      return ok(200, { superior: { id: target.id, name: target.name, phone: target.phone, levelLabel: target.tier } });
    } catch (e) { return fail(400, e.message); }
  }
  if (p === '/stores' && m === 'GET') {
    const assignmentId = q('assignmentId');
    let stores = db.regionalAgents.filter((a) => a.region_type === 'store');
    if (assignmentId) {
      const ag = db.regionalAgents.find((a) => a.partner_id === assignmentId);
      if (ag) stores = stores.filter((a) => (a.region_code || '').startsWith((ag.region_code || '').slice(0, 2)));
    }
    const costoreFee = (S.getSettings(db) || {}).costore ? (S.getSettings(db).costore.monthlyFee || C.COSTORE_FEE_MONTHLY || 698) : (C.COSTORE_FEE_MONTHLY || 698);
    const items = stores.map((a) => {
      const o = db.users[a.partner_id];
      // P1-6：门店维度统计——当前已有合店老板数（原型屏 145「当前已有 8 位合店老板」）
      const owners = (db.coStores || []).filter((c) =>
        (c.store_id && c.store_id === a.partner_id) ||
        (c.storeManagerId && c.storeManagerId === a.partner_id) ||
        (c.owners && c.owners.some((x) => x.id === a.partner_id)));
      return {
        id: a.partner_id,
        name: `脑商线下店${o ? o.name : a.partner_id}店`,
        address: (db.stores && db.stores[a.partner_id] && db.stores[a.partner_id].address) || '',
        contact: o ? o.phone : '',
        version: 1,
        regionCode: a.region_code || '',
        // ── 新增：合店相关展示字段 ──
        costoreOwnerCount: owners.length,
        costoreOwnerLimit: RA.STORE_OWNER_COUNT,
        costoreMonthlyFee: costoreFee,
        costoreMonthlyFeeLabel: `¥${costoreFee}/月`,
      };
    });
    return ok(200, { items, hasMore: false, nextCursor: null });
  }
  if (p === '/partner/superior' && m === 'GET') {
    const c = needCtx('partner'); if (!c.userId) return c;
    const u = db.users[c.userId];
    const up = u && u.upline_id ? db.users[u.upline_id] : null;
    return ok(200, { items: [], superior: up ? { name: up.name, phone: up.phone, levelLabel: up.tier, scopeLabel: '' } : null });
  }
  if (p === '/promotion/share-code' && m === 'GET') {
    const c = needCtx(); if (!c.userId) return c;
    const u = db.users[c.userId];
    const inviteCode = u.phone || u.id;
    return ok(200, { accountId: c.userId, contextId: q('contextId'), promotionId: 'promo-' + c.userId, inviteCode, qrUrl: `https://h5.naoshang.example.com/qr/${inviteCode}`, posterUrl: `https://h5.naoshang.example.com/poster/${inviteCode}`, shareUrl: `https://h5.naoshang.example.com/?invite=${inviteCode}` });
  }
  // ── P1-8 两套邀请码：注册邀请码（拉新→绑推荐人）/ 代理归属码（申请代理→绑归属代理） ──
  if (p === '/me/invite-codes' && m === 'GET') {
    const c = needCtx(); if (!c.userId) return c;
    const type = q('type') || null;
    const list = IC.listMyCodes(db, c.userId, type).map(IC.publicCode);
    return ok(200, { items: list, hasMore: false, nextCursor: null, types: IC.VALID_TYPES.map((t) => ({ id: t, label: t === 'register' ? '注册邀请码' : '代理归属码' })) });
  }
  if (p === '/me/invite-codes' && m === 'POST') {
    const b = await readBody(req);
    const c = needCtx(); if (!c.userId) return c;
    const type = b.type || 'register';
    const cfg = (S.getSettings(db) || {}).inviteCode || {};
    if (type === 'register' && cfg.registerEnabled === false) return fail(400, '注册邀请码当前未开放');
    if (type === 'agent' && cfg.agentEnabled === false) return fail(400, '代理归属码当前未开放');
    const maxUse = b.maxUse != null ? Number(b.maxUse) : (cfg.defaultMaxUse || 0);
    const ttlDays = b.ttlDays != null ? Number(b.ttlDays) : (cfg.ttlDays || 30);
    try {
      const rec = IC.generateInviteCode(db, { ownerId: c.userId, type, maxUse, ttlDays });
      save();
      return ok(201, { inviteCode: IC.publicCode(rec), shareUrl: `https://h5.naoshang.example.com/?invite=${rec.code}` });
    } catch (e) { return fail(400, e.message); }
  }
  // ── P1-7 合伙人成长阶梯 L1–L10（阶梯图坐标 + 晋升进度） ──
  if (p === '/partner/ladder' && m === 'GET') {
    const c = needCtx('partner'); if (!c.userId) return c;
    const cfg = (S.getSettings(db) || {}).ladder || {};
    const overrides = Array.isArray(cfg.levels) && cfg.levels.length ? cfg.levels : null;
    const score = EXP.summary(db, c.userId).total;
    const chart = LAD.ladderChart(score, overrides);
    return ok(200, { ...chart, unit: cfg.unit || '成长积分', scoreSource: '累计经验值（1 元 = 1 积分）' });
  }
  if (p === '/partner/global-awards' && m === 'GET') {
    const c = needCtx('partner'); if (!c.userId) return c;
    const u = db.users[c.userId];
    const r = R.getCommissions(db, c.userId, { type: 'global' });
    const pool = db.commissions.filter((x) => x.type === 'global').reduce((s, x) => s + x.amount, 0);
    const items = r.list.map((x) => ({ month: x.period, eligibility: 'ELIGIBLE', amount: x.amount, weightedAmount: x.amount, performanceAmount: x.amount, salesAmount: x.base_amount, shareBps: Math.round((x.rate || 0) * 10000), people: 1, poolAmount: pool }));
    return ok(200, { eligibilityLabel: u.tier === 'cofounder' ? '符合全球奖资格' : '非联创无资格', metrics: [{ label: '你的全球奖', kind: 'money', value: r.total }, { label: '奖池总额', kind: 'money', value: round2(pool) }], summary: { total: r.total, pool: round2(pool) }, columns: [], items });
  }
  if (p === '/partner/quota-ledger' && m === 'GET') {
    const c = needCtx('partner'); if (!c.userId) return c;
    return ok(200, { standardRemaining: Q.getStandard(db.quotaLedger, c.userId), activityRemaining: Q.getActivity(db.quotaLedger, c.userId), items: [] });
  }
  if (p === '/partner/quotas' && m === 'GET') return ok(200, { items: [], hasMore: false, nextCursor: null });
  // ── P0-1 经验值（原型屏 46/47：业务推广 / 购买产品 两个 Tab） ──
  if (p === '/partner/experience-ledger' && m === 'GET') {
    const c = needCtx('partner'); if (!c.userId) return c;
    const tab = q('tab') && ['promotion', 'product'].includes(q('tab')) ? q('tab') : null;
    const r = EXP.ledger(db, c.userId, { tab });
    return ok(200, {
      promotionExperience: r.promotionExperience,
      productExperience: r.productExperience,
      total: r.total,
      tabs: r.tabs,
      metrics: [
        { label: '累计业务推广', kind: 'points', value: r.promotionExperience },
        { label: '累计购买产品', kind: 'points', value: r.productExperience },
      ],
      items: r.items, hasMore: false, nextCursor: null,
    });
  }
  if (p === '/partner/experience/summary' && m === 'GET') {
    const c = needCtx('partner'); if (!c.userId) return c;
    const r = EXP.summary(db, c.userId);
    return ok(200, { promotionExperience: r.promotionExperience, productExperience: r.productExperience, total: r.total, count: r.count, rule: '标价多少加多少（1 元 = 1 经验值）' });
  }
  // ── P0-2 晋升/推广任务（原型屏 21/22：补差价直接晋升 / 推广达标免费晋升） ──
  if (p === '/partner/promotion-tasks' && m === 'GET') {
    const c = needCtx('partner'); if (!c.userId) return c;
    const u = db.users[c.userId] || {};
    const prog = EXP.progress(db, c.userId);
    const nextTier = S.FREE_UPGRADE_NEXT[u.tier] || null;
    // 补差价直接晋升的报价（本金锚点：目标档一口价 − 本金一口价）
    const principalPrice = C.RETAIL_PRICE[u.principal_tier || u.tier] || 0;
    const promotion = {
      beforeName: EXP.TIER_CN[u.tier] || u.tier,
      afterName: nextTier ? (EXP.TIER_CN[nextTier] || nextTier) : (EXP.TIER_CN[u.tier] || u.tier),
      beforeQuota: C.TIER_VIP[u.tier] || 0,
      afterQuota: nextTier ? (C.TIER_VIP[nextTier] || 0) : (C.TIER_VIP[u.tier] || 0),
      paidAmount: principalPrice,
      standardAmount: nextTier ? (C.RETAIL_PRICE[nextTier] || 0) : principalPrice,
      differenceAmount: nextTier ? Math.max(0, (C.RETAIL_PRICE[nextTier] || 0) - principalPrice) : 0,
      taskDescription: prog.text || '',
      progress: prog.items && prog.items.length ? Math.max(...prog.items.map((x) => x.percent)) : 0,
      target: prog.items && prog.items.length ? prog.items[0].required : 0,
      statusLabel: prog.statusLabel,
      validUntil: prog.validUntil || null,
      daysLeft: prog.daysLeft || 0,
      rule: prog.grantRule || null,
    };
    return ok(200, { items: prog.items || [], promotion, task: prog });
  }
  // ── 问题7：晋升领取接口（前端反馈：有 ACHIEVED/CLAIMED 状态却没说怎么领取）──
  //   GET  /partner/promotion-claims → 领取状态（是否达标、可否领取、已授档位）
  //   POST /partner/promotion-claims → 领取（达标即授级，幂等：重复领取返回同一结果）
  if (p === '/partner/promotion-claims' && m === 'GET') {
    const c = needCtx('partner'); if (!c.userId) return c;
    const prog = EXP.progress(db, c.userId);
    const task = prog.taskId ? (db.promotionTasks || []).find((x) => x.id === prog.taskId) : null;
    const u = db.users[c.userId] || {};
    return ok(200, {
      taskId: prog.taskId || null,
      status: prog.status || 'NONE',          // ONGOING | ACHIEVED | CLAIMED | EXPIRED | NONE
      statusLabel: prog.statusLabel,
      achieved: !!prog.achieved,
      claimable: prog.status === 'ACHIEVED',  // 达标未领取 → 可领取
      claimed: prog.status === 'CLAIMED',
      grantedTier: task ? task.grantedTier : null,
      grantedTierLabel: task && task.grantedTier ? (EXP.TIER_CN[task.grantedTier] || task.grantedTier) : null,
      achievedAt: task ? task.achievedAt : null,
      claimedAt: task ? task.claimedAt : null,
      currentTier: u.tier,
      currentTierLabel: EXP.TIER_CN[u.tier] || u.tier,
      items: prog.items || [],
      validUntil: prog.validUntil || null,
      daysLeft: prog.daysLeft || 0,
      grantRule: prog.grantRule || null,
    });
  }
  if (p === '/partner/promotion-claims' && m === 'POST') {
    // contextId 可放 body 或 query（两种都支持，便于前端按习惯传）
    const b = await readBody(req);
    const cid = b.contextId || q('contextId');
    if (!cid) return fail(400, 'contextId 必填');
    const { userId, module: mod } = resolveContext(cid);
    if (!userId || !db.users[userId]) return fail(404, 'contextId 无效');
    if (mod && mod !== 'partner') return fail(400, 'contextId 与模块不匹配');
    const c = { userId };
    const prog = EXP.progress(db, c.userId);
    if (!prog.enabled) return fail(400, '晋升任务未开启');
    if (!prog.taskId) return fail(400, '尚未开通合伙人，无晋升任务');
    if (prog.status === 'CLAIMED') {
      // 幂等：已领取 → 直接返回当前结果，不重复授级
      const t = (db.promotionTasks || []).find((x) => x.id === prog.taskId);
      return ok(200, {
        status: 'CLAIMED', granted: false, alreadyClaimed: true,
        fromTier: t ? t.startTier : null, toTier: t ? t.grantedTier : null,
        taskId: prog.taskId, message: '该晋升已领取',
      });
    }
    if (!prog.achieved) return fail(400, '尚未达标，暂不可领取');
    let r;
    try {
      r = EXP.applyIfAchieved(db, c.userId);
    } catch (e) { return fail(400, `领取失败：${e.message}`); }
    save();
    const u = db.users[c.userId] || {};
    return ok(200, {
      status: r.status, granted: !!r.granted, alreadyClaimed: false,
      fromTier: r.fromTier || null, toTier: r.toTier || null,
      fromTierLabel: r.fromTier ? (EXP.TIER_CN[r.fromTier] || r.fromTier) : null,
      toTierLabel: r.toTier ? (EXP.TIER_CN[r.toTier] || r.toTier) : null,
      taskId: r.taskId || prog.taskId,
      note: r.note || null,
      currentTier: u.tier,
    });
  }
  // ── P0-7 分红业绩门槛与「当月无分红权」台账（原型屏 112） ──
  if (p === '/partner/dividend-rights' && m === 'GET') {
    const c = needCtx(); if (!c.userId) return c;
    const months = Math.max(1, Math.min(24, parseInt(q('months'), 10) || 6));
    const kind = q('kind') && ['memberCard', 'promotion'].includes(q('kind')) ? q('kind') : null;
    const h = DIV.history(db, c.userId, { months, kind });
    return ok(200, {
      prompt: DIV.currentPrompt(db, c.userId, kind || 'memberCard'),
      metrics: [
        { label: '分红合计', kind: 'money', value: h.summary.totalAmount },
        { label: '可提现分红', kind: 'money', value: h.summary.withdrawableAmount },
        { label: '无分红权（暂不可提现）', kind: 'money', value: h.summary.withheldAmount },
      ],
      threshold: S.getSettings(db).dividend,
      items: h.items, summary: h.summary,
    });
  }
  // ── P0-9 分配意愿规则（巡查 5% / 销售 5% 默认归属；改规则权限在总部后台） ──
  if (p === '/partner/allocation-scheme' && m === 'GET') {
    return ok(200, { ...ALC.scheme(db), note: ALC.scheme(db).note });
  }
  // ── 问题6：bizType 字典 + 各类 bizDetail 结构 + allocationKind 字典 ──
  // ── 门店收益规则表（拨比表口径：门店收益随商品类型不同）+ 收益线分离字典 ──
  if (p === '/income/store-income-rules' && m === 'GET') {
    return ok(200, {
      rules: SI.storeIncomeRuleTable(),
      incomeChannels: Object.values(SI.INCOME_CHANNEL),
      note: '门店收益随商品类型按拨比表规则计算（实物/软件卡=拿货差价，特色产品=比例分成池，行政费=5/5/90）；合店老板收益来自合店费入股分配，与门店卖货收益分属两条独立账，不可合并统计',
    });
  }
  if (p === '/income/biz-types' && m === 'GET') {
    return ok(200, BIZ.fullDictionary());
  }

  // ───────────────────────── §7 商城目录/详情/报价、§8 订单 ─────────────────────────
  if (p === '/catalog' && m === 'GET') {
    // 展示层：前端商城需要的 id/title/summary/coverUrl/分类/金额(分)/会员价/规格/SKU/正文 + 三套价
    // + viewerPrice：按当前登录者身份（含孩子会员等级）算出的「你的成交价」
    return ok(200, { categories: CAT.CATEGORIES, items: CAT.buildCatalogItems(db, viewerOf(db, sess)) });
  }
  if (p.startsWith('/products/') && m === 'GET') {
    const id = p.slice('/products/'.length);
    const prod = CAT.buildProductItem(db, id, viewerOf(db, sess));
    if (!prod) return fail(404, '商品不存在');
    return ok(200, prod);
  }
  if (p === '/checkout/options' && m === 'GET') {
    const uid = sess.role === 'user' ? sess.userId : null;
    // 门店来自区域代理（region_type='store'），与后台 /api/stores 同一口径
    const stores = db.regionalAgents
      .filter((a) => a.region_type === 'store')
      .map((a, i) => {
        const owner = db.users[a.partner_id] || {};
        return {
          id: a.region_code, regionCode: a.region_code,
          name: `脑商线下店${owner.name || a.partner_id}店`,
          number: 'NO.' + String(i + 1).padStart(4, '0'),
          address: '', managerName: owner.name || '', phone: owner.phone || '', coverUrl: '',
        };
      });
    return ok(200, {
      stores, defaultStoreId: stores.length ? stores[0].id : null, deliveryLocked: false,
      members: uid && Array.isArray(db.members) ? db.members.filter((mm) => mm.userId === uid).map((mm) => ({
        id: mm.id, name: mm.name, memberLevel: mm.memberLevel || 'normal',
        levelLabel: IZ.memberTierName(mm.memberLevel) || '普通会员',
        displayId: mm.display_id || null, gradeLabel: mm.gradeLabel || '', genderLabel: mm.genderLabel || '',
        avatarUrl: mm.avatarUrl || null,
      })) : [],
      addresses: uid ? B.listAddresses(db, uid).map((a) => ({ id: a.id, recipient: a.recipient, phone: a.phone, detail: a.detail, isDefault: a.isDefault })) : [],
      coupons: uid ? B.listCoupons(db, uid, 'available') : [],
    });
  }
  if (p === '/checkout/quotes' && m === 'POST') {
    const b = await readBody(req);
    try {
      const uid = sess.role === 'user' ? sess.userId : null;
      const buyer = uid ? db.users[uid] : null;
      const agentRec = uid ? S.getRegionalAgent(db, uid) : null;
      const cfg = (S.getSettings(db) || {}).pricing || {};
      const key = b.productKey || b.productId || 'pad';
      const qty = b.quantity || 1;
      // SKU（2026-10-27 库存台账）：命中规格 → 按该规格计价 + 校验库存；报价与下单用同一套规格
      const sku = b.skuId ? STK.skuById(db, b.skuId) : null;
      if (b.skuId && !sku) return fail(400, '规格不存在：' + b.skuId);
      if (sku && sku.productId && sku.productId !== key) return fail(400, '规格与商品不匹配');
      if (sku) STK.assertStock(db, sku.id, qty);
      // P1-9：按买家身份解析最终成交价（代理身份 > 合伙人档位 > 原价；与孩子的会员等级无关）
      const fp = sku
        ? PS.finalSkuPrice(key, sku, buyer, agentRec, qty, { dualDiscountEnabled: !!cfg.dualDiscountEnabled, level: b.level || null })
        : PS.finalPrice(key, buyer, agentRec, qty, { dualDiscountEnabled: !!cfg.dualDiscountEnabled, level: b.level || null });
      const dp = sku ? { list: sku.listPrice, member: fp.member, channel: fp.channel } : PS.dualPrice(key);
      const r2 = (n) => Math.round(n * 100) / 100;
      // ⚠️ 2026-10-28 修：报价必须与下单同口径，否则前端展示金额 ≠ 实际扣款金额。
      //   代理本人购买 AI软件卡（记忆卡）时按**固定拿货价**成交（省150/市170/区县250/单店350），
      //   此前报价走折扣口径、下单走拿货价，导致「报价 598.8 / 实付 300」。
      //   现统一调用 PS.payableAmountFor（与 routes.createProductOrder 同一函数）。
      const prodDef = PS.getProduct(key);
      const payable = PS.payableAmountFor(prodDef, agentRec, fp.unitPrice, qty);
      const unitPrice = r2(payable.applied.indexOf('agent_pick_price') === 0
        ? payable.amount / qty
        : fp.unitPrice);
      const payableAmount = payable.amount;
      const listAmount = r2(dp.list * qty);
      // 问题1：报价落库 → 提交时凭 quoteId 校验「用户确认的价格 / 有效期 / 商品组合」
      const quote = QT.issueQuote(db, {
        scene: QT.QUOTE_SCENES.CHECKOUT,
        userId: uid || 'anonymous',
        amount: payableAmount,
        breakdown: {
          goodsAmount: payableAmount,
          discountAmount: r2(listAmount - payableAmount),
          listAmount,
        },
        items: quoteItems(key, qty, sku ? sku.id : null),
        meta: { productKey: fp.key, level: b.level || null, memberId: b.memberId || null, skuId: sku ? sku.id : null, storeId: b.storeId || null, addressId: b.addressId || null, quantity: qty },
      });
      save();
      return ok(200, {
        id: quote.id,
        goodsAmount: payableAmount,
        discountAmount: r2(listAmount - payableAmount),
        payableAmount,
        expiresAt: quote.expiresAt, serverTime: nowMs(), ruleVersion: quote.ruleVersion,
        store: null, memberId: b.memberId || null,
        dualDiscountEnabled: !!cfg.dualDiscountEnabled,
        skuId: sku ? sku.id : null,
        product: {
          key: fp.key, name: fp.name, unitPrice, qty,
          listUnitPrice: dp.list, memberUnitPrice: dp.member, channelUnitPrice: dp.channel,
          appliedPriceKind: fp.applied,
        },
      });
    } catch (e) { return fail(400, e.message); }
  }
  if (p === '/orders' && m === 'POST') {
    const b = await readBody(req);
    try {
      const buyerId = b.buyerId || (sess.role === 'user' ? sess.userId : b.buyerId);
      // ── 问题1：报价绑定提交 ──
      //  · 传了 quoteId → 必须校验通过（价格 / 有效期 / 商品组合 / 归属），并消费报价（一次性）
      //  · 没传 quoteId → 允许（兼容旧调用），但**金额一律服务端重算**，绝不采信客户端传的 payableAmount
      // ⚠️ 客户端传 payableAmount 只用于与报价比对，服务端始终用 PS.productPrice 重算。
      // ⚠️ 前端 createCheckoutOrder 只传 {quoteId, idempotencyKey}；商品/规格/数量/成员/门店从报价回填，
      //    否则 quoteItems 缺 skuId → checkQuote JSON.stringify 比对失败「商品/名额组合与报价不一致」。
      let orderKey = b.productKey || b.productId || null;
      let orderQty = (b.quantity != null ? b.quantity : (b.qty != null ? b.qty : null));
      let orderSkuId = b.skuId || null;
      let orderLevel = b.level || null;
      let memberIdIn = b.memberId || null;
      let orderStoreId = b.storeId || null;
      if (b.quoteId) {
        const q0 = (db.quotes || []).find((x) => x.id === b.quoteId);
        if (q0) {
          const qi = Array.isArray(q0.items) && q0.items[0] ? q0.items[0] : null;
          const qm = q0.meta || {};
          orderKey = orderKey || qm.productKey || (qi && qi.key) || null;
          if (orderQty == null) orderQty = (qi && qi.qty != null) ? qi.qty : (qm.quantity != null ? qm.quantity : null);
          orderSkuId = orderSkuId || qm.skuId || (qi && qi.skuId) || null;
          orderLevel = orderLevel || qm.level || null;
          memberIdIn = memberIdIn || qm.memberId || null;
          orderStoreId = orderStoreId || qm.storeId || null;
        }
      }
      orderKey = orderKey || 'pad';
      orderQty = orderQty != null ? orderQty : 1;
      // SKU（2026-10-27）：规格 id 贯穿报价→下单；库存校验与扣减在 createProductOrder 内完成
      const orderSku = orderSkuId ? STK.skuById(db, orderSkuId) : null;
      if (orderSkuId && !orderSku) return fail(400, '规格不存在：' + orderSkuId);
      if (orderSku && orderSku.productId && orderSku.productId !== orderKey) return fail(400, '规格与商品不匹配');
      let quoteRec = null;
      // 服务对象（孩子）——仅记录，不参与计价；报价与下单用同一个 memberId 即可
      if (b.quoteId) {
        const buyer = db.users[buyerId];
        const agentRec = buyerId ? db.regionalAgents.find((a) => a.partner_id === buyerId) : null;
        const cfg = (S.getSettings(db) || {}).pricing || {};
        const fp = orderSku
          ? PS.finalSkuPrice(orderKey, orderSku, buyer, agentRec, orderQty, { dualDiscountEnabled: !!cfg.dualDiscountEnabled, level: orderLevel || null })
          : PS.finalPrice(orderKey, buyer, agentRec, orderQty, { dualDiscountEnabled: !!cfg.dualDiscountEnabled, level: orderLevel || null });
        // ⚠️ 2026-10-28：与报价/实付同口径（代理本人买软件卡按固定拿货价），
        //   否则 serverAmount 与报价单金额不一致 → checkQuote 必然失败。
        const serverAmount = PS.payableAmountFor(PS.getProduct(orderKey), agentRec, fp.unitPrice, orderQty).amount;
        // 问题1：与其它 7 个提交端点保持一致 —— 先校验（不消费），业务成功后再消费。
        //   下单失败时报价仍然可用，避免"一次失败报价就白费"。
        quoteRec = QT.checkQuote(db, b.quoteId, {
          scene: QT.QUOTE_SCENES.CHECKOUT,
          userId: sess.role === 'user' ? sess.userId : buyerId,
          serverAmount,
          items: quoteItems(orderKey, orderQty, orderSku ? orderSku.id : null),
        });
      }
      // qty 显式传（不用 spread 里的 quantity/qty，避免与报价数量不一致）
      // storeId = 收银台选中的门店，**参与分润归属**（门店即「单店」获单店份额；
      //   省/市/区县份额归对应区域代理，与门店收益分开记账）。2026-10-27 口径已定。
      const r = R.createProductOrder(db, { ...b, buyerId, productKey: orderKey, qty: orderQty, skuId: orderSkuId || null, storeId: orderStoreId || null, memberId: memberIdIn });
      save();
      if (quoteRec) {
        // 业务已成功 → 此时才消费报价，并回填关联单号
        QT.markConsumed(db, quoteRec.id, { ref: (r.order && r.order.id) || (r.order_id) || null });
        save();
      }
      const order = r.order || r;
      return ok(200, {
        ok: true,
        // 问题2：统一给 id（后续查详情/发起支付/轮询都要用），同时保留 order_id 兼容旧字段
        id: order.id || order.order_id || null,
        orderId: order.id || order.order_id || null,
        order,
        quoteId: quoteRec ? quoteRec.id : (b.quoteId || null),
        quoteConsumed: !!quoteRec,
      });
    } catch (e) { return fail(400, e.message); }
  }
  if (p === '/orders' && m === 'GET') {
    OL.sweep(db);          // P0-5：惰性扫描，把已过支付时限的待支付单自动取消
    const rows = db.orders.filter((o) => o.type !== 'issue').map((o) => {
      OL.ensureAlive(db, o);
      const buyer = db.users[o.buyer_id] || {};
      return {
        ...o,
        buyer_name: buyer.name || o.buyer_id,
        status: o.status || 'PAID',
        statusLabel: OL.statusLabel(o),
        remainSeconds: OL.remainSeconds(o),
        delivery: OL.deliveryPayload(db, o),   // P0-6：交付模式 / 核销码 / 倒计时
      };
    });
    save();
    return ok(200, { items: rows, hasMore: false, nextCursor: null });
  }
  // 注意：/orders/{id}/payment-channels 是更长的路径，必须在此排除（见下方端点）
  if (p.startsWith('/orders/') && m === 'GET' && !/\/payment-channels$/.test(p)) {
    const id = p.slice('/orders/'.length);
    const o = db.orders.find((x) => (x.id === id) || (x.orderNo === id));
    if (!o) return fail(404, '订单不存在');
    OL.ensureAlive(db, o); save();
    const buyer = db.users[o.buyer_id] || {};
    return ok(200, {
      order: {
        ...o,
        buyer_name: buyer.name || o.buyer_id,
        statusLabel: OL.statusLabel(o),
        // 2026-10-27：按订单状态返回可用动作。
        //   此前无条件返回 ['pay','cancel']，导致前端对**已支付**订单也显示「取消订单」，
        //   用户点取消后钱不退、库存不回补（已取消的订单还会出现在列表里）。
        allowedActions: OL.allowedActions(o),
        remainSeconds: OL.remainSeconds(o),
        delivery: OL.deliveryPayload(db, o),   // P0-6
      }, serverTime: nowMs(),
    });
  }
  // ── P0-5 待支付订单支付成功：放行分润（createProductOrder 挂起的 commission_rows 落账） ──
  // 问题2：统一为「发起支付」语义，并保留旧契约字段（orderId/status/releasedCommissions/delivery）：
  //   · sandbox：支付直通 → 标记订单已付 + 放行分润 → 返回 SUCCEEDED
  //   · live   ：创建支付单 → 返回 CREATED + payParams（前端调起渠道），由 /payments/notify/{channel} 回调入账
  if (p.match(/\/orders\/[^/]+\/payment$/) && m === 'POST') {
    const id = p.split('/')[2];
    const b = await readBody(req);
    const o = db.orders.find((x) => (x.id === id) || (x.orderNo === id));
    if (!o) return fail(404, '订单不存在');
    if (sess.role === 'user' && o.buyer_id && o.buyer_id !== sess.userId) return fail(403, '无权支付该订单');
    const channel = b.channel || 'wechat';
    if (!PAY.channelsFor('product_order').includes(channel)) {
      return fail(400, `该订单不支持 ${PAY.channelName(channel)}（可用：${PAY.channelsFor('product_order').map(PAY.channelName).join('、')}）`);
    }
    const amount = OL.orderAmount(o);
    if (!(amount > 0)) return fail(400, '订单金额无效，无法发起支付');

    // ── 旧路径：订单本就是「待支付」态 → 直接标记已付并放行分润（保持原行为）──
    if (OL.isPending(o) && PAY.IS_SANDBOX && !b.paymentId) {
      OL.markPaid(o);
      const released = R.releaseProductCommissions(db, o);
      save();
      return ok(200, {
        id: o.id, orderId: o.id, status: 'paid', releasedCommissions: released.length,
        delivery: OL.deliveryPayload(db, o),
        paymentMode: PAY.PAYMENT_MODE, channel, amount,
        payParams: PAY.buildPayParams(channel, o),
      });
    }

    // ── 通用路径：创建支付单（幂等键冲突 → 409）──
    let created;
    try {
      created = PAY.createPayment(db, {
        bizType: 'product_order', bizId: o.id, userId: o.buyer_id || sess.userId || 'unknown',
        amount, channel, idempotencyKey: b.idempotencyKey, meta: { orderId: o.id },
      });
    } catch (e) { return failErr(e, 400); }
    let released = 0;
    if (created.paid && !created.duplicated) {
      // sandbox：支付单直通 → 标记订单已付 + 放行分润
      if (OL.isPending(o)) { OL.markPaid(o); released = R.releaseProductCommissions(db, o).length; }
    }
    save();
    return ok(200, {
      // 问题2：必须带 id / paymentId（后续 GET /payments/attempts/{id} 轮询用）
      id: created.payment.id, paymentId: created.payment.id,
      orderId: o.id, status: created.paid ? 'SUCCEEDED' : 'CREATED',
      releasedCommissions: released,
      delivery: OL.deliveryPayload(db, o),
      // 幂等命中时回显支付单实际渠道（而非本次请求渠道）
      paymentMode: PAY.PAYMENT_MODE, channel: created.payment.channel,
      channelName: PAY.channelName(created.payment.channel), amount,
      // 问题2：payParams 始终返回（sandbox 下标明 autoPay 直通），前端结构一致
      payParams: created.payParams,
    });
  }
  // 订单动作端点。
  //   规范路径用复数名词（REST 风格）：/cancellations、/receipts。
  //   ⚠️ 同时兼容前端历史写法 /cancel、/confirm-receipt ——
  //   小程序侧 commerce.js 的 changeOrder(action) 直接把 action 拼进路径，
  //   两边命名不一致时按钮能显示（后端 allowedActions 给的）但一点就 404，
  //   属于最难自查的一类前后端没接上。两条路径都收，行为完全一致。
  if (p.match(/\/orders\/[^/]+\/(cancellations|cancel)$/) && m === 'POST') {
    const id = p.split('/')[2];
    const o = db.orders.find((x) => x.id === id); if (!o) return fail(404, '订单不存在');
    // 统一走 orderLifecycle.cancel：它内置「已支付订单不可取消，请走退款」的保护。
    //   （2026-10-27 修复：本端点曾自行改 status，绕过了该保护 → 已付款订单能被
    //     取消，钱不退、库存不回补，形成资损风险。）
    // 取消前先记录原状态：cancel() 会把 status 改成 CANCELLED，之后就判断不出是否待支付了。
    const wasPending = OL.isPending(o) || ['pending', 'UNPAID', 'CREATED'].includes(o.status);
    try {
      OL.cancel(o, { reason: 'USER_CANCEL', operatorId: sess && sess.userId ? sess.userId : null });
    } catch (e) {
      return fail(400, e.message);
    }
    // 只有"未支付"的订单才回补库存（已支付的货已卖出，回补会造成超卖）
    if (wasPending) STK.restoreStockForOrder(db, o);   // SKU 库存回补（幂等）
    save();
    return ok(200, { order: o });
  }
  if (p.match(/\/orders\/[^/]+\/(receipts|confirm-receipt)$/) && m === 'POST') {
    const id = p.split('/')[2];
    const o = db.orders.find((x) => x.id === id); if (!o) return fail(404, '订单不存在');
    o.status = 'COMPLETED'; o.fulfillmentStatus = 'DELIVERED'; return ok(200, { order: o });
  }
  // P2-3（2026-10-26）：支付发起统一走支付模块 —— sandbox 直通 SUCCEEDED 并放行分润；
  //   live 返回 CREATED + payParams（前端调起渠道），由 POST /payments/notify/{channel} 回调入账。
  if (p === '/payments/attempts' && m === 'POST') {
    const b = await readBody(req);
    const orderId = b.orderId;
    const o = db.orders.find((x) => x.id === orderId) || (db.orders.find((x) => x.orderNo === orderId) || null);
    const channel = b.channel || 'wechat';
    if (!PAY.channelsFor('product_order').includes(channel)) {
      return fail(400, `该订单不支持 ${PAY.channelName(channel)}（可用：${PAY.channelsFor('product_order').map(PAY.channelName).join('、')}）`);
    }
    const amount = o ? OL.orderAmount(o) : Number(b.amount || 0);
    if (!(amount > 0)) return fail(400, '订单金额无效，无法发起支付');
    let created;
    try {
      created = PAY.createPayment(db, {
        bizType: 'product_order', bizId: o ? o.id : null,
        userId: o ? o.buyer_id : (sess.userId || 'unknown'),
        amount, channel, idempotencyKey: b.idempotencyKey,
        meta: { orderId: o ? o.id : orderId },
      });
    } catch (e) { return failErr(e, 400); }
    if (created.paid) {
      // sandbox：支付即入账。applyBizEffect 负责标记订单已付并放行挂起的分润台账。
      const effect = created.duplicated ? null : PAY.applyBizEffect(db, created.payment);
      save();
      return ok(200, {
        id: created.payment.id, paymentId: created.payment.id, orderId: o ? o.id : orderId, status: 'SUCCEEDED',
        channel: created.payment.channel, channelName: PAY.channelName(created.payment.channel), amount, paymentMode: PAY.PAYMENT_MODE,
        releasedCommissions: effect && effect.kind === 'product_order' ? effect.releasedCommissions : 0,
        delivery: o ? OL.deliveryPayload(db, o) : null,
        // 问题2：payParams 始终返回（sandbox 下标明 autoPay 直通），前端结构一致
        payParams: created.payParams,
      });
    }
    save();
    return ok(200, {
      id: created.payment.id, paymentId: created.payment.id, orderId: o ? o.id : orderId, status: 'CREATED',
      channel: created.payment.channel, channelName: PAY.channelName(created.payment.channel), amount, paymentMode: PAY.PAYMENT_MODE,
      payParams: created.payParams,
    });
  }
  if (p.startsWith('/payments/attempts/') && m === 'GET') {
    const id = p.slice('/payments/attempts/'.length);
    const pmt = PAY.getPayment(db, id);
    if (!pmt) return fail(404, '支付单不存在');
    const o = pmt.meta && pmt.meta.orderId ? db.orders.find((x) => x.id === pmt.meta.orderId) : null;
    return ok(200, {
      id: pmt.id, orderId: pmt.meta && pmt.meta.orderId ? pmt.meta.orderId : null,
      status: pmt.status, channel: pmt.channel, channelName: PAY.channelName(pmt.channel),
      amount: pmt.amount, paymentMode: PAY.PAYMENT_MODE,
      paidAt: pmt.paidAt ? new Date(pmt.paidAt).toISOString() : null,
      delivery: o ? OL.deliveryPayload(db, o) : null,
    });
  }
  // ── 问题2：文档里写了但代码里缺失的端点（补齐，前端按文档调用即可）──
  //   GET /orders/{id}/payment-channels → 该订单可用的支付渠道
  //   （POST /orders/{id}/payment 见上方 P0-5 端点，已统一为「发起支付」语义）
  if (p.match(/^\/orders\/[^/]+\/payment-channels$/) && m === 'GET') {
    const orderId = p.split('/')[2];
    const o = db.orders.find((x) => x.id === orderId) || db.orders.find((x) => x.orderNo === orderId);
    if (!o) return fail(404, '订单不存在');
    const items = PAY.channelsFor('product_order').map((c) => ({
      id: c, label: PAY.channelName(c),
      kind: c === 'wechat' ? 'WECHAT' : c === 'alipay' ? 'ALIPAY' : c === 'unionpay' ? 'UNIONPAY' : 'BANK_CARD',
    }));
    return ok(200, {
      items, orderId: o.id, orderNo: o.orderNo || o.order_no || null,
      amount: OL.orderAmount(o),
      paymentMode: PAY.PAYMENT_MODE,
      note: PAY.IS_SANDBOX ? 'sandbox：支付直通，提交即入账' : 'live：提交后返回 payParams，前端调起渠道支付',
    });
  }
  if (p === '/columns' && m === 'GET') {
    // 专栏列表（目录页用）：与商城目录、激活码种子三处同 id
    const uid = sess && sess.role === 'user' ? sess.userId : null;
    const me = uid ? db.users[uid] : null;
    const items = COLS.columnList(db).map((c) => {
      const unlocked = !!(me && (me.unlockedColumns || []).includes(c.id));
      const item = CAT.columnItem(db, c);
      return { id: c.id, title: c.title, summary: c.summary || '', coverUrl: item.coverUrl, price: item.prices ? item.prices.list : 0, unlocked, chapterCount: (c.chapters || []).length };
    });
    return ok(200, { items, hasMore: false, nextCursor: null });
  }
  if (p.startsWith('/columns/') && m === 'GET') {
    const id = p.slice('/columns/'.length);
    const col = COLS.columnById(db, id);
    if (!col) return fail(404, '专栏不存在');
    const memberId = q('memberId');
    let unlocked = false;
    const me = sess && sess.userId ? db.users[sess.userId] : null;
    if (me && (me.unlockedColumns || []).includes(id)) unlocked = true;
    if (memberId) { const mm = db.members.find((x) => x.id === memberId); if (mm && (mm.unlockedColumns || []).includes(id)) unlocked = true; }
    return ok(200, {
      product: CAT.columnItem(db, col),
      unlocked,
      chapters: (col.chapters || []).map((c) => ({ id: c.id, title: c.title, type: c.type })),
    });
  }

  // ───────────────────────── §10 经营操作（三段式） ─────────────────────────
  const opCtx = async () => {
    const b = await readBody(req);
    // contextId 支持 body 或 query 两种传法（前端按习惯放哪个都能用）
    const cid = b.contextId || q('contextId');
    if (!cid) return { err: fail(400, 'contextId 必填') };
    const { userId, module } = resolveContext(cid);
    if (!userId || !db.users[userId]) return { err: fail(404, 'contextId 无效') };
    return { userId, b: { ...b, contextId: cid } };
  };
  // 年度权益（契约 §15：金额待业务确认，先以暂行值实现三段式）
  const ANNUAL_FEE = { amount: 1980, months: 12, note: '金额为暂行值，待业务确认后调整（见契约 §15）' };
  if (p === '/partner/entitlement-options' && m === 'GET') {
    const c = needCtx('partner'); if (!c.userId) return c;
    const u = db.users[c.userId];
    return ok(200, {
      plans: [{ id: 'annual', label: '年度权益（12 个月）', amount: ANNUAL_FEE.amount, months: ANNUAL_FEE.months, note: ANNUAL_FEE.note }],
      currentPaid: !!u.annual_fee_paid,
      currentExpiresAt: u.annual_paid_at ? new Date(u.annual_paid_at + 365 * 86400000).toISOString() : null,
      allowedActions: ['quote', 'submit'],
      allowedPaymentChannelIds: PAY.channelsFor('annual_fee'), paymentMode: PAY.PAYMENT_MODE,
    });
  }
  if (p === '/partner/entitlement-quotes' && m === 'POST') {
    const o = await opCtx(); if (o.err) return o.err;
    if ((o.b.planId || 'annual') !== 'annual') return fail(400, '未知套餐（当前仅 annual）');
    // 问题1：报价落库 → 提交时凭 quoteId 校验价格/有效期/套餐
    let quote;
    try {
      quote = QT.issueQuote(db, {
        scene: QT.QUOTE_SCENES.ENTITLEMENT,
        userId: o.userId,
        amount: ANNUAL_FEE.amount,
        breakdown: { months: ANNUAL_FEE.months },
        items: [{ key: 'annual', qty: 1 }],
        meta: { planId: 'annual' },
      });
    } catch (e) { return fail(400, e.message); }
    save();
    return ok(200, { id: quote.id, contextId: o.b.contextId, planId: 'annual', amount: ANNUAL_FEE.amount, months: ANNUAL_FEE.months, note: ANNUAL_FEE.note, expiresAt: quote.expiresAt, serverTime: nowMs(), ruleVersion: quote.ruleVersion });
  }
  if (p === '/partner/entitlement-orders' && m === 'POST') {
    const o = await opCtx(); if (o.err) return o.err;
    const channel = o.b.channel || 'wechat';
    // 问题1：提交时凭 quoteId 校验（价格服务端重算、有效期、归属、一次性）
    // 顺序：先校验 → 建支付单 → 成功后再消费报价（业务失败不浪费报价）
    let quoteRec = null;
    if (o.b.quoteId) {
      try {
        quoteRec = QT.checkQuote(db, o.b.quoteId, {
          scene: QT.QUOTE_SCENES.ENTITLEMENT, userId: o.userId,
          serverAmount: ANNUAL_FEE.amount, items: [{ key: 'annual', qty: 1 }],
        });
      } catch (e) { return fail(400, e.message); }
    }
    let created;
    try {
      created = PAY.createPayment(db, { bizType: 'annual_fee', userId: o.userId, amount: ANNUAL_FEE.amount, channel, idempotencyKey: o.b.idempotencyKey, meta: { months: ANNUAL_FEE.months } });
    } catch (e) { return fail(400, e.message); }
    if (quoteRec) { QT.markConsumed(db, quoteRec.id, { ref: created.payment.id }); }
    if (created.paid) {
      const effect = created.duplicated ? null : PAY.applyBizEffect(db, created.payment);
      save();
      const uu = db.users[o.userId];
      return ok(200, { status: 'SUCCEEDED', operationId: created.payment.id, paymentId: created.payment.id, channel: created.payment.channel, orderId: effect ? effect.orderId : null, validUntil: uu.annual_paid_at ? new Date(uu.annual_paid_at + 365 * 86400000).toISOString() : null, note: ANNUAL_FEE.note });
    }
    save();
    return ok(200, { status: 'CREATED', paymentId: created.payment.id, channel: created.payment.channel, channelName: PAY.channelName(created.payment.channel), amount: ANNUAL_FEE.amount, payParams: created.payParams });
  }
  if (p === '/partner/quota-purchase-options' && m === 'GET') {
    const c = needCtx('partner'); if (!c.userId) return c;
    return ok(200, { unitAmount: C.WHOLESALE_PER_QUOTA.cofounder, purchaseMode: 'PAYMENT', pricingLabel: '联创名额进货价（按联创本档价 6500 · 银联支付）', allowedPaymentChannelIds: PAY.channelsFor('quota_purchase'), allowedActions: ['quote', 'submit'], standardRemaining: Q.getStandard(db.quotaLedger, c.userId), activityRemaining: Q.getActivity(db.quotaLedger, c.userId), paymentMode: PAY.PAYMENT_MODE });
  }
  if (p === '/partner/quota-purchase-quotes' && m === 'POST') {
    const o = await opCtx(); if (o.err) return o.err;
    const qty = Math.max(1, parseInt(o.b.userId || o.b.quantity, 10) || 1);
    const amount = round2(C.WHOLESALE_PER_QUOTA.cofounder * qty);
    // 问题1：报价落库（含数量组合，提交时校验数量被篡改）
    let quote;
    try {
      quote = QT.issueQuote(db, {
        scene: QT.QUOTE_SCENES.QUOTA_PURCHASE,
        userId: o.userId,
        amount,
        breakdown: { unitAmount: C.WHOLESALE_PER_QUOTA.cofounder, quantity: qty },
        items: [{ key: 'quota', qty }],
        meta: { quantity: qty },
      });
    } catch (e) { return fail(400, e.message); }
    save();
    return ok(200, { id: quote.id, contextId: o.b.contextId, unitAmount: C.WHOLESALE_PER_QUOTA.cofounder, quantity: qty, amount, expiresAt: quote.expiresAt, serverTime: nowMs(), ruleVersion: quote.ruleVersion });
  }
  if (p === '/partner/quota-orders' && m === 'POST') {
    const o = await opCtx(); if (o.err) return o.err;
    const qty = Math.max(1, parseInt(o.b.quantity, 10) || 1);
    const channel = o.b.channel || 'unionpay';   // 联创向总部购买名额：银联
    const amount = round2(C.WHOLESALE_PER_QUOTA.cofounder * qty);
    // 问题1：先校验报价 → 建支付单 → 成功后消费报价
    let quoteRec = null;
    if (o.b.quoteId) {
      try {
        quoteRec = QT.checkQuote(db, o.b.quoteId, {
          scene: QT.QUOTE_SCENES.QUOTA_PURCHASE, userId: o.userId,
          serverAmount: amount, items: [{ key: 'quota', qty }],
        });
      } catch (e) { return fail(400, e.message); }
    }
    let created;
    try {
      created = PAY.createPayment(db, { bizType: 'quota_purchase', userId: o.userId, amount, channel, idempotencyKey: o.b.idempotencyKey, meta: { quantity: qty } });
    } catch (e) { return fail(400, e.message); }
    if (quoteRec) { QT.markConsumed(db, quoteRec.id, { ref: created.payment.id }); }
    if (created.paid) {
      if (!created.duplicated) PAY.applyBizEffect(db, created.payment);
      save();
      return ok(200, { status: 'SUCCEEDED', operationId: created.payment.id, paymentId: created.payment.id, channel: created.payment.channel, quantity: qty, balances: { standardRemaining: Q.getStandard(db.quotaLedger, o.userId), activityRemaining: Q.getActivity(db.quotaLedger, o.userId) }, note: created.payment.note });
    }
    save();
    return ok(200, { status: 'CREATED', paymentId: created.payment.id, channel: created.payment.channel, channelName: PAY.channelName(created.payment.channel), amount, quantity: qty, payParams: created.payParams });
  }
  if (p === '/partner/upgrade-options' && m === 'GET') {
    const c = needCtx('partner'); if (!c.userId) return c;
    const u = db.users[c.userId] || {};
    const base = u.principal_tier || u.tier || 'none';   // 本金锚点：升级价以本金档为减数
    const basePrice = C.RETAIL_PRICE[base] || 0;
    const rank = S.TIER_RANK;
    // P0-3/P0-4：升级服务费单价（后台可配）+ 升级时上级可用活动名额（决定本单是否产生服务费）
    const qCfg = Q.resolveConfig((S.getSettings(db) || {}).quota || {});
    const seller = u.upline_id ? db.users[u.upline_id] : null;
    const sellerActivity = seller ? Q.getActivity(db.quotaLedger, seller.id) : 0;
    const sellerStandard = seller ? Q.getStandard(db.quotaLedger, seller.id) : 0;
    const upgradePlans = ['vip', 'angel', 'private', 'cofounder']
      .filter((t) => (rank[t] || 0) > (rank[u.tier] || 0))
      .map((t) => {
        const quotaCount = Math.max(0, (C.TIER_VIP[t] || 0) - (C.TIER_VIP[u.tier] || 0));
        // 预览：上级先扣活动名额（先过期先扣）→ 活动名额不足部分走标准
        const usedActivity = Math.min(quotaCount, qCfg.activityValidForUpgrade ? sellerActivity : 0);
        const usedStandard = quotaCount - usedActivity;
        const serviceFee = usedActivity * qCfg.serviceFeePerActivity;
        const partnerFee = Math.max(0, (C.RETAIL_PRICE[t] || 0) - basePrice);
        return {
          from: base, to: t,
          amount: partnerFee,
          // P0-1：名额消耗按「目标档名额 − 当前档名额」的**增量**计；
          //   普通用户（none=0 名额）升 VIP 合伙人只消耗 1 个名额（不按整包 2 个计）
          quotaCount,
          currentTierQuota: C.TIER_VIP[u.tier] || 0,
          targetTierQuota: C.TIER_VIP[t] || 0,
          principalDeducted: basePrice,
          // P0-4 服务费明细（原型屏 36「服务费明细」）
          usedActivityQuota: usedActivity,
          usedStandardQuota: usedStandard,
          serviceFee,
          serviceFeePerActivity: qCfg.serviceFeePerActivity,
          totalPayable: C.round2(partnerFee + serviceFee),
          label: `${EXP.TIER_CN[u.tier] || u.tier} → ${EXP.TIER_CN[t] || t}`,
        };
      });
    return ok(200, {
      members: [], upgradePlans,
      principalTier: base, principal: basePrice, currentTier: u.tier,
      standardRemaining: Q.getStandard(db.quotaLedger, c.userId), activityRemaining: Q.getActivity(db.quotaLedger, c.userId),
      // P0-3/P0-4 余额与计价规则（原型屏 35/36：活动 VIP 余额 / 标准 VIP 余额 / 服务费计价规则）
      quotaBalances: { standard: Q.getStandard(db.quotaLedger, c.userId), activity: Q.getActivity(db.quotaLedger, c.userId) },
      serviceFeeRule: { perActivityQuota: qCfg.serviceFeePerActivity, standardQuotaFree: true, activityValidityDays: qCfg.activityValidityDays },
      sellerBalances: { standard: sellerStandard, activity: sellerActivity },
      pricingNote: '升级实付 = 目标档一口价 − 本金档一口价（非当前档）；名额按增量消耗',
    });
  }
  if (p === '/partner/upgrade-quotes' && m === 'POST') {
    const o = await opCtx(); if (o.err) return o.err;
    const targetLevel = o.b.targetLevel || 'angel';
    const targetId = o.b.targetAccountId || o.userId;
    if (!db.users[targetId]) return fail(404, '目标用户不存在');
    // 计价与落账同源（upgradeService.quoteUpgrade），保证「报价 = 实收」
    let q, quote;
    try {
      q = US.quoteUpgrade(db, { targetAccountId: targetId, targetLevel });
      quote = QT.issueQuote(db, {
        scene: QT.QUOTE_SCENES.UPGRADE,
        userId: o.userId,
        amount: q.totalPayable,
        breakdown: {
          partnerFee: q.amount,          // 合伙人费（差价）
          serviceFee: q.serviceFeeEstimate, // 升级服务费（活动名额）
        },
        items: [{ key: targetLevel, qty: q.quotaCount }],
        meta: { targetLevel, targetAccountId: targetId },
      });
    } catch (e) { return fail(400, e.message); }
    save();
    return ok(200, {
      id: quote.id, contextId: o.b.contextId, targetLevel, targetAccountId: targetId,
      amount: q.amount, quotaCount: q.quotaCount, principalTier: q.principalTier, principal: q.principal,
      serviceFeePerActivity: q.serviceFeePerActivity, serviceFeeEstimate: q.serviceFeeEstimate,
      usedActivityQuota: q.usedActivityQuota, usedStandardQuota: q.usedStandardQuota,
      totalPayable: q.totalPayable,
      label: q.label,
      // 问题3：明确「差价 + 服务费合并为一张支付单」
      paymentNote: '差价与升级服务费合并为一张支付单（totalPayable）；名额扣减与等级授予在支付成功后执行',
      expiresAt: quote.expiresAt, serverTime: nowMs(), ruleVersion: quote.ruleVersion,
    });
  }
  if (p === '/partner/upgrades' && m === 'POST') {
    const o = await opCtx(); if (o.err) return o.err;
    const targetId = o.b.targetAccountId || o.userId;
    const targetLevel = o.b.targetLevel || 'angel';
    if (!db.users[targetId]) return fail(404, '目标用户不存在');
    // ── 2026-10-26 对齐：授级通道与实时下单同口径 ──
    //  · 计价/落账统一走 upgradeService（与升级报价同源）
    //  · 问题3：live 模式先创建**一张**支付单（差价+服务费合并），支付成功后才扣名额+授级
    //           sandbox 模式下单直通，行为与原来完全一致（回归脚本不受影响）
    let q, quoteRec = null;
    try {
      q = US.quoteUpgrade(db, { targetAccountId: targetId, targetLevel });
      if (o.b.quoteId) {
        quoteRec = QT.checkQuote(db, o.b.quoteId, {
          scene: QT.QUOTE_SCENES.UPGRADE, userId: o.userId,
          serverAmount: q.totalPayable,
          items: [{ key: targetLevel, qty: q.quotaCount }],
        });
      }
    } catch (e) { return fail(400, e.message); }

    // ── live 模式：创建支付单，等支付成功回调后再落账 ──
    if (!PAY.IS_SANDBOX) {
      const channel = o.b.channel || 'wechat';
      let created;
      try {
        created = PAY.createPayment(db, {
          bizType: 'upgrade', userId: o.userId, amount: q.totalPayable, channel,
          idempotencyKey: o.b.idempotencyKey,
          subject: `合伙人升档 ${EXP.TIER_CN[q.oldTier] || q.oldTier} → ${EXP.TIER_CN[targetLevel] || targetLevel}`,
          meta: { targetAccountId: targetId, targetLevel },
        });
      } catch (e) { return fail(400, e.message); }
      if (quoteRec) { QT.markConsumed(db, quoteRec.id, { ref: created.payment.id }); }
      save();
      return ok(200, {
        status: created.paid ? 'SUCCEEDED' : 'CREATED',
        operationId: created.payment.id,
        paymentId: created.payment.id,
        channel: created.payment.channel,
        channelName: PAY.channelName(created.payment.channel),
        amount: q.totalPayable,
        breakdown: { partnerFee: q.amount, serviceFee: q.serviceFeeEstimate },
        targetLevel, targetAccountId: targetId,
        payParams: created.payParams,
        // 支付成功后才发生的动作（前端可据此提示用户）
        pendingEffects: ['扣减上级增量名额', '授予目标账号等级', '落供货链级差与平级奖台账'],
        balances: { standardRemaining: Q.getStandard(db.quotaLedger, o.userId), activityRemaining: Q.getActivity(db.quotaLedger, o.userId) },
        note: '请完成支付；支付成功后系统自动扣减名额并授予等级',
      });
    }

    // ── sandbox 模式：直通落账 ──
    let r;
    try {
      r = US.applyUpgrade(db, { targetAccountId: targetId, targetLevel });
    } catch (e) {
      return fail(400, `授级失败：${e.message}`);
    }
    save();
    if (quoteRec) { QT.markConsumed(db, quoteRec.id, { ref: r.orderId }); save(); }
    return ok(200, {
      status: 'SUCCEEDED', operationId: 'op_' + Math.random().toString(36).slice(2),
      orderId: r.orderId, balances: { standardRemaining: Q.getStandard(db.quotaLedger, o.userId), activityRemaining: Q.getActivity(db.quotaLedger, o.userId) },
      settlement: r.settlement,
    });
  }
  if (p === '/partner/store-binding-options' && m === 'GET') {
    const c = needCtx('partner'); if (!c.userId) return c;
    const stores = db.regionalAgents.filter((a) => a.region_type === 'store').map((a) => ({ id: a.partner_id, name: '门店' + a.region_code, regionCode: a.region_code }));
    return ok(200, { members: [], stores, headquarters: { id: 'HQ', name: '总部' } });
  }
  if (p === '/partner/store-binding-quotes' && m === 'POST') {
    const o = await opCtx(); if (o.err) return o.err;
    const targetId = o.b.targetAccountId || o.userId;
    // 问题1：门店绑定报价落库（绑定动作免费，校验的是「绑定对象组合」）
    let quote;
    try {
      quote = QT.issueQuote(db, {
        scene: QT.QUOTE_SCENES.STORE_BINDING,
        userId: o.userId,
        amount: 0,
        breakdown: { storeId: o.b.storeId, targetAccountId: targetId },
        items: [{ key: 'store', qty: 1, storeId: o.b.storeId || null }],
        meta: { storeId: o.b.storeId || null, targetAccountId: targetId },
      });
    } catch (e) { return fail(400, e.message); }
    save();
    return ok(200, { id: quote.id, contextId: o.b.contextId, targetAccountId: targetId, storeId: o.b.storeId, amount: 0, expiresAt: quote.expiresAt, serverTime: nowMs(), ruleVersion: quote.ruleVersion });
  }
  if (p === '/partner/store-bindings' && m === 'POST') {
    const o = await opCtx(); if (o.err) return o.err;
    const targetId = o.b.targetAccountId || o.userId;
    const store = db.regionalAgents.find((a) => a.partner_id === o.b.storeId) || db.coStores.find((x) => x.store_id === o.b.storeId);
    const regionCode = store ? (store.region_code || o.b.storeId) : o.b.storeId;
    // 问题1：提交时校验报价（绑定对象组合必须与报价一致）
    let quoteRec = null;
    if (o.b.quoteId) {
      try {
        quoteRec = QT.checkQuote(db, o.b.quoteId, {
          scene: QT.QUOTE_SCENES.STORE_BINDING, userId: o.userId,
          serverAmount: 0,
          items: [{ key: 'store', qty: 1, storeId: o.b.storeId || null }],
        });
      } catch (e) { return fail(400, e.message); }
    }
    try {
      const r = S.appointAgent(db, { partnerId: targetId, regionType: 'store', regionCode });
      save();
      return ok(200, { status: 'SUCCEEDED', operationId: 'op_' + Math.random().toString(36).slice(2), agent: r });
    } catch (e) { return fail(400, e.message); }
  }
  if (p === '/partner/quota-transfer-options' && m === 'GET') {
    const c = needCtx('partner'); if (!c.userId) return c;
    const tree = R.getTeam(db, c.userId);
    const candidates = flatDownline(tree).map((n) => ({ id: n.id, name: n.name, phone: n.phone }));
    return ok(200, { fields: [{ key: 'targetAccountId', label: '接收人' }, { key: 'quantity', label: '数量' }], balances: { standardRemaining: Q.getStandard(db.quotaLedger, c.userId), activityRemaining: Q.getActivity(db.quotaLedger, c.userId) }, allowedActions: ['quote', 'submit'], candidates });
  }
  if (p === '/partner/quota-transfer-quotes' && m === 'POST') {
    const o = await opCtx(); if (o.err) return o.err;
    const qty = Math.max(1, parseInt(o.b.quantity, 10) || 1);
    // 问题1：名额划转报价落库（校验「接收人 + 数量」组合）
    let quote;
    try {
      quote = QT.issueQuote(db, {
        scene: QT.QUOTE_SCENES.QUOTA_TRANSFER,
        userId: o.userId,
        amount: 0,
        breakdown: { quantity: qty, targetAccountId: o.b.targetAccountId || null },
        items: [{ key: 'quota', qty, targetAccountId: o.b.targetAccountId || null }],
        meta: { quantity: qty, targetAccountId: o.b.targetAccountId || null },
      });
    } catch (e) { return fail(400, e.message); }
    save();
    return ok(200, { id: quote.id, contextId: o.b.contextId, targetAccountId: o.b.targetAccountId, quantity: qty, senderBalanceAfter: Q.getStandard(db.quotaLedger, o.userId) - qty, expiresAt: quote.expiresAt, serverTime: nowMs(), ruleVersion: quote.ruleVersion });
  }
  if (p === '/partner/quota-transfers' && m === 'POST') {
    const o = await opCtx(); if (o.err) return o.err;
    const qty = Math.max(1, parseInt(o.b.quantity, 10) || 1);
    const targetId = o.b.targetAccountId;
    if (!db.users[targetId]) return fail(404, '接收人不存在');
    // 问题1：提交时校验报价（接收人 + 数量组合必须与报价一致）
    let quoteRec = null;
    if (o.b.quoteId) {
      try {
        quoteRec = QT.checkQuote(db, o.b.quoteId, {
          scene: QT.QUOTE_SCENES.QUOTA_TRANSFER, userId: o.userId,
          serverAmount: 0,
          items: [{ key: 'quota', qty, targetAccountId: targetId || null }],
        });
      } catch (e) { return fail(400, e.message); }
    }
    if (Q.getStandard(db.quotaLedger, o.userId) < qty) return fail(400, '名额不足');
    Q.consumeQuota(db.quotaLedger, o.userId, qty, { prefer: 'standard' });
    Q.issueQuota(db.quotaLedger, targetId, qty, 'standard');
    save();
    if (quoteRec) { QT.markConsumed(db, quoteRec.id, { ref: targetId }); save(); }
    return ok(200, { status: 'SUCCEEDED', operationId: 'op_' + Math.random().toString(36).slice(2), balances: { senderRemaining: Q.getStandard(db.quotaLedger, o.userId), senderActivityRemaining: Q.getActivity(db.quotaLedger, o.userId), receiverRemaining: Q.getStandard(db.quotaLedger, targetId), receiverActivityRemaining: Q.getActivity(db.quotaLedger, targetId) } });
  }

  // ───────────────────────── §12 创始奖 / 合店申请 / 代理申请 ─────────────────────────
  if (p === '/founder-awards' && m === 'GET') {
    const c = needCtx(); if (!c.userId) return c;
    const r = R.getCommissions(db, c.userId, { type: 'founding' });
    const items = r.list.map((x) => ({ id: x.id, title: '创始奖', amount: x.amount, createdAt: x.created_at, sourceOrder: x.ref_order_id || null }));
    return ok(200, { items, hasMore: false, nextCursor: null, monthTotal: r.total });
  }
  if (p === '/costore/application-options' && m === 'GET') return ok(200, { stores: [], durations: [{ id: '12', label: '12 个月', months: 12 }, { id: '24', label: '24 个月', months: 24 }], benefits: '合店老板权益', agreement: { version: 'v1', content: '合店协议（占位）' } });
  if (p === '/costore/application-quotes' && m === 'POST') {
    const b = await readBody(req);
    const months = parseInt(b.durationId === '24' ? 24 : 12, 10);
    const fee = C.COSTORE_FEE_MONTHLY || 698;
    const payableAmount = round2(fee * months);
    // 问题1：合店申请报价落库（校验「门店 + 期限」组合与金额）
    const ownerId = sess.role === 'user' ? sess.userId : (b.ownerId || 'anonymous');
    let quote;
    try {
      quote = QT.issueQuote(db, {
        scene: QT.QUOTE_SCENES.COSTORE_APPLICATION,
        userId: ownerId,
        amount: payableAmount,
        breakdown: { monthlyFee: fee, months, durationId: b.durationId === '24' ? '24' : '12' },
        items: [{ key: 'costore', qty: months, storeId: b.storeId || null }],
        meta: { storeId: b.storeId || null, durationId: b.durationId === '24' ? '24' : '12', months },
      });
    } catch (e) { return fail(400, e.message); }
    save();
    return ok(200, { id: quote.id, storeId: b.storeId, durationId: b.durationId, durationLabel: months + ' 个月', payableAmount, currency: 'CNY', expiresAt: quote.expiresAt, serverTime: nowMs(), ruleVersion: quote.ruleVersion });
  }
  if (p === '/applications/costore' && m === 'POST') {
    const b = await readBody(req);
    const ownerId = sess.role === 'user' ? sess.userId : b.ownerId;
    const months = parseInt(b.durationId === '24' ? 24 : 12, 10);
    const fee = C.COSTORE_FEE_MONTHLY || 698;
    const payableAmount = round2(fee * months);
    // 问题1：提交时校验报价（金额服务端重算 + 门店/期限组合）
    let quoteRec = null;
    if (b.quoteId) {
      try {
        quoteRec = QT.checkQuote(db, b.quoteId, {
          scene: QT.QUOTE_SCENES.COSTORE_APPLICATION, userId: ownerId,
          serverAmount: payableAmount,
          items: [{ key: 'costore', qty: months, storeId: b.storeId || null }],
        });
      } catch (e) { return fail(400, e.message); }
    }
    try {
      const r = S.addCoStore(db, { owner_id: ownerId, storeManagerId: b.storeId || ownerId, store_id: b.storeId, monthly_fee: fee, joinDate: periodOf(), owners: [{ id: ownerId, performance: 0 }], promoter_id: null });
      save();
      const app = B.recordApplication(db, {
        type: 'COSTORE', title: '申请合店', applicationStatus: 'PENDING_REVIEW', userId: ownerId,
        storeId: b.storeId || ownerId, storeAgentId: b.storeId || ownerId,
        payableAmount,
        store: b.storeId ? { id: b.storeId, name: '门店 ' + b.storeId } : null, idempotencyKey: b.idempotencyKey || null,
      });
      save();
      if (quoteRec) { QT.markConsumed(db, quoteRec.id, { ref: app.id }); save(); }
      return ok(200, { application: { id: app.id, title: app.title, applicationStatus: app.applicationStatus, paymentStatus: app.paymentStatus, contractStatus: app.contractStatus, entitlementStatus: app.entitlementStatus, store: app.store, agencyType: null, payableAmount: app.payableAmount, createdAt: app.createdAt }, costore: r });
    } catch (e) { return fail(400, e.message); }
  }
  if (p === '/promotion/agency-code' && m === 'GET') {
    const agencyType = q('agencyType') || 'store';
    return ok(200, { accountId: sess.userId, agencyType, promotionId: 'promo-' + sess.userId, qrUrl: 'https://h5.naoshang.example.com/qr/agency/' + sess.userId, posterUrl: '', shareUrl: 'https://h5.naoshang.example.com/?agency=' + sess.userId });
  }
  // ── 问题1：代理申请报价（三段式补齐：报价 → 提交 → 支付）────────────────
  if (p === '/agency/application-quotes' && m === 'POST') {
    const b = await readBody(req);
    const agencyType = b.agencyType || 'store';
    const tierIndex = parseInt(b.tierIndex || '0', 10) || 0;
    const fee = RA.agentThresholdFee(agencyType, tierIndex);   // 金额一律服务端算
    const payableAmount = Number(fee.total || 0);
    const partnerId = sess.role === 'user' ? sess.userId : (b.partnerId || 'anonymous');
    let quote;
    try {
      quote = QT.issueQuote(db, {
        scene: QT.QUOTE_SCENES.AGENCY_APPLICATION,
        userId: partnerId,
        amount: payableAmount,
        breakdown: { brandFee: fee.brand || 0, extraFee: fee.extra || 0, deviceFee: fee.device || 0, depositFee: fee.deposit || 0, total: payableAmount },
        items: [{ key: 'agency', qty: 1, agencyType, tierIndex }],
        meta: { agencyType, tierIndex, regionCodes: b.regionCodes || b.regionCode || null },
      });
    } catch (e) { return fail(400, e.message); }
    save();
    return ok(200, {
      id: quote.id, agencyType, tierIndex, payableAmount, currency: 'CNY',
      feeBreakdown: { brandFee: fee.brand || 0, extraFee: fee.extra || 0, deviceFee: fee.device || 0, depositFee: fee.deposit || 0, total: payableAmount },
      expiresAt: quote.expiresAt, serverTime: nowMs(), ruleVersion: quote.ruleVersion,
    });
  }
  // ── P1-6（2026-10-26）：代理申请表单预填（原型屏 148）────────────────────────
  //   费用明细 ¥80000.00（品牌费4w / 设备费2w / 保证金2w）+ 推广码带入等级 + 门头照/协议勾选项
  if (p === '/agency/application-options' && m === 'GET') {
    const agencyType = q('agencyType') || 'store';
    const tierIndex = parseInt(q('tierIndex') || '0', 10) || 0;
    const fee = RA.agentThresholdFee(agencyType, tierIndex);   // brand/extra/device/deposit/total
    const price = RA.agentPrice(agencyType, tierIndex);
    const promoCode = q('promotionCode') || (sess.userId ? 'promo-' + sess.userId : '');
    // 推广码带入等级：查到上级代理 → 带入其可授予档位；查不到按 default
    // P1-8：promotionCode 支持「代理归属码」（类型化 agent 码）或旧格式 promo-<userId>
    let referredTier = null, referredBy = null;
    if (promoCode) {
      const icRec = IC.resolveInviteCode(db, promoCode);
      let refAgent = null;
      if (icRec && icRec.type === 'agent') {
        refAgent = (db.regionalAgents || []).find((a) => a.partner_id === icRec.ownerId);
      } else {
        const refId = promoCode.replace(/^promo-/, '');
        refAgent = (db.regionalAgents || []).find((a) => a.partner_id === refId);
      }
      if (refAgent) {
        referredBy = { id: refAgent.partner_id, name: (db.users[refAgent.partner_id] || {}).name || refAgent.partner_id };
        referredTier = refAgent.granted_tier || null;
      }
    }
    return ok(200, {
      agencyType,
      agencyTypeLabel: (RA.LEVEL_CN && RA.LEVEL_CN[agencyType]) || agencyType,
      feeBreakdown: {
        brandFee: fee.brand || 0,
        extraFee: fee.extra || 0,
        deviceFee: fee.device || 0,
        depositFee: fee.deposit || 0,
        total: fee.total || price.total,
        label: `¥${(fee.total || price.total).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}`,
        note: fee.note || price.note || '',
      },
      priceTiers: (RA.AGENT_PRICE_TABLE[agencyType] || { tiers: [] }).tiers,
      techFee: price.techFee,
      techFeeNote: '直推代理奖按「技术费」计，不按合计',
      promotionCode: promoCode,
      referredBy,
      referredTier,
      grantedTier: referredTier || (S.AGENT_GRANT_TIER && S.AGENT_GRANT_TIER[agencyType]) || null,
      // 表单项：门头照走 /assets/upload-intents 上传后回填 fileId；协议需勾选
      requiredUploads: [{ key: 'storefrontPhoto', label: '门头照', type: 'image', maxCount: 3 }],
      requiredAgreements: [{ key: 'agencyAgreement', label: '代理协议', version: 'v1' }],
      allowedActions: ['submit'],
    });
  }
  if (p === '/agency/applications' && m === 'POST') {
    const b = await readBody(req);
    const partnerId = sess.role === 'user' ? sess.userId : b.partnerId;
    const agencyType = b.agencyType || 'store';
    const tierIndex = parseInt(b.tierIndex || '0', 10) || 0;
    // P1-6：费用明细按后台价格表计算（不接受前端传入金额），门头照/协议为必填项
    const fee = RA.agentThresholdFee(agencyType, tierIndex);
    const payableAmount = Number(fee.total || 0);
    const agreements = Array.isArray(b.agreements) ? b.agreements : [];
    if (!agreements.some((a) => a && a.key === 'agencyAgreement' && a.accepted === true)) {
      return fail(400, '请先阅读并勾选代理协议');
    }
    // ── 问题4：上传资源校验 ──
    //   旧版只判断「有没有 fileId」，不校验资源是否真实存在、是否已上传完成（READY）、是否属于当前账号。
    //   → 凭证 ID 直接当资源用，会出现「申请里挂着一个从不存在的门头照」。
    //   统一标识：fileId 与 assetId 是**同一个 id**（upload-intents 返回二者），此处两种都接受。
    const uploads = Array.isArray(b.uploads) ? b.uploads : [];
    const photo = uploads.find((u) => u && u.key === 'storefrontPhoto' && (u.fileId || u.assetId));
    if (!photo) return fail(400, '请上传门头照');
    const photoId = photo.fileId || photo.assetId;
    const asset = (db.assets || []).find((a) => a.id === photoId);
    if (!asset) return fail(400, `门头照资源不存在（${photoId}）：请重新上传后再提交`);
    if (asset.status !== 'READY') return fail(400, `门头照尚未上传完成（当前状态 ${asset.status}）：请完成上传后再提交`);
    if (sess.role === 'user' && asset.userId && asset.userId !== sess.userId) {
      return fail(400, '门头照资源不属于当前账号');
    }
    // 问题1：提交时凭 quoteId 校验（金额服务端重算 + 代理类型/档位组合）
    let quoteRec = null;
    if (b.quoteId) {
      try {
        quoteRec = QT.checkQuote(db, b.quoteId, {
          scene: QT.QUOTE_SCENES.AGENCY_APPLICATION, userId: partnerId,
          serverAmount: payableAmount,
          items: [{ key: 'agency', qty: 1, agencyType, tierIndex }],
        });
      } catch (e) { return fail(400, e.message); }
    }
    try {
      const r = S.appointAgent(db, { partnerId, regionType: agencyType, regionCode: b.regionCodes || b.regionCode || 'D1', referrerId: b.referrerId || null });
      save();
      const app = B.recordApplication(db, {
        type: 'AGENCY', title: '代理申请', applicationStatus: 'APPROVED', userId: partnerId,
        agencyType: agencyType.toUpperCase(), payableAmount, idempotencyKey: b.idempotencyKey || null,
        feeBreakdown: { brandFee: fee.brand || 0, extraFee: fee.extra || 0, deviceFee: fee.device || 0, depositFee: fee.deposit || 0, total: payableAmount },
        uploads, agreements,
      });
      save();
      if (quoteRec) { QT.markConsumed(db, quoteRec.id, { ref: app.id }); save(); }
      return ok(200, { application: { id: app.id, title: app.title, applicationStatus: app.applicationStatus, paymentStatus: app.paymentStatus, contractStatus: app.contractStatus, entitlementStatus: app.entitlementStatus, store: null, agencyType: app.agencyType, payableAmount: app.payableAmount, feeBreakdown: app.feeBreakdown || null, createdAt: app.createdAt }, agent: r });
    } catch (e) { return fail(400, e.message); }
  }

  // ───────────────────────── 兜底 ─────────────────────────
  // 业务模块（h5biz.js）已覆盖契约全部章节；未命中路径交回 /api/*（其自身 404）。
  return false;
}

module.exports = { handle, resolveContext, resetBiz: B.resetBiz };

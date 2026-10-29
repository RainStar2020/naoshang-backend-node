/**
 * H5 契约接口层 · 端到端验证（spawn 临时服务器 + fetch）
 *
 * 覆盖：§3 认证 / §4 个人中心·地址·优惠券·客服 / §5 家庭会员·激活 / §6 学习·公告·课程·
 *       §7-§8 商城订单 / §9 经营报表 / §10 经营操作 / §11 收益分配·钱包提现 /
 *       §12 申请·邀请 / §13 门店·健脑官·转店 / §14 上传·素材·合成任务。
 * 运行：node scripts/verify_h5_contract.js   （ internally 起 3219 端口，结束自动恢复默认种子 ）
 */
const { spawn } = require('child_process');
const path = require('path');

const PORT = 3219;
const BASE = `http://127.0.0.1:${PORT}`;
let passed = 0, failed = 0;
const check = (name, cond, extra) => {
  if (cond) { passed++; console.log(`  ok  ${name}`); }
  else { failed++; console.log(`  FAIL ${name}${extra !== undefined ? ' -> ' + JSON.stringify(extra).slice(0, 240) : ''}`); }
};
const { parentLogin, TEST_LOGIN_PASSWORD } = require('./loginKit.cjs');
const req = (m, p, { token, body } = {}) => fetch(BASE + p, {
  method: m,
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
}).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }));
const loginParent = async (phone) => (await parentLogin(req, phone)).data.token;

async function main() {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(PORT), EXPOSE_DEV_CODE: '1' }, stdio: 'ignore',
  });
  const boot = Date.now();
  while (Date.now() - boot < 15000) {
    try { const r = await fetch(BASE + '/'); if (r.ok) break; } catch (e) { /* retry */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  try {
    // ── 0. 服务信息 + 恢复默认种子 ──
    const root = await req('GET', '/');
    check('GET / 返回服务信息（纯 API）', root.status === 200 && root.data && root.data.service);
    const admin = (await req('POST', '/auth/sessions', { body: { channel: 'admin', password: 'admin888' } })).data.token;
    check('admin 登录', !!admin);
    check('静态路径 404（纯 API）', (await req('GET', '/app.js')).status === 404);
    check('/api/* 仍可用', (await req('GET', '/api/calc/agent-fee')).status === 200);
    check('恢复默认种子', (await req('POST', '/api/seed/reset', { token: admin })).status === 200);
    const settle = await req('POST', '/api/settle', { token: admin, body: { period: '2026-10' } });
    check('月度结算（生成全球奖/创始奖）', settle.status === 200);

    // ── §3 认证 ──
    const P1 = await loginParent('13800000001');
    const P6 = await loginParent('13800000006');
    check('合伙人登录 p1/p6', !!P1 && !!P6);
    check('错误手机号 404', (await req('POST', '/auth/sessions', { body: { channel: 'parent', phone: '13800000000', password: TEST_LOGIN_PASSWORD } })).status === 404);
    check('未登录 401', (await req('GET', '/partner/overview?contextId=partner:p1')).status === 401);
    const boot1 = await req('GET', '/me/bootstrap', { token: P1 });
    check('/me/bootstrap 身份上下文', boot1.status === 200 && boot1.data.businessContexts.length >= 1);
    check('bootstrap 下发对外编号（联创 LC0001）', boot1.data.displayId === 'LC0001');
    check('bootstrap 下发权益状态（存量默认 active）', boot1.data.entitlement && boot1.data.entitlement.state === 'active' && boot1.data.entitlement.amount === 200);

    // ── §3+ 权益门禁与对外编号（2026-10-24）──
    const gatePhone = '1390000' + String(Math.floor(1000 + Math.random() * 9000));
    const _code = (await req('POST', '/auth/sms-challenges', { body: { phone: gatePhone, purpose: 'register' } })).data.devCode;
    const reg = await req('POST', '/auth/registrations', { body: { phone: gatePhone, code: _code, password: 'abc123', name: '门禁测试', inviteCode: '13800000001' } });
    check('新注册返回 QZ 编号 + 未开通权益', reg.status === 200 && /^QZ\d{4,}$/.test(reg.data.user.displayId) && reg.data.entitlement.state === 'never_paid');
    const GT = reg.data.token;
    check('新注册 bootstrap 权益 never_paid', (await req('GET', '/me/bootstrap', { token: GT })).data.entitlement.state === 'never_paid');
    const gateOv = await req('GET', '/partner/overview?contextId=partner:' + reg.data.user.id, { token: GT });
    check('未开通 → 经营报表锁定（locked+200）', gateOv.status === 200 && gateOv.data.locked === true && gateOv.data.entitlementAmount === 200);
    check('未开通 → 钱包类同样锁定', (await req('GET', '/wallet/withdrawal-options?contextId=partner:' + reg.data.user.id, { token: GT })).data.locked === true);
    check('未开通 → 导出账单 403', (await req('GET', '/me/income-export', { token: GT })).status === 403);
    const pay = await req('POST', '/me/entitlement-orders', { token: GT, body: { idempotencyKey: 'ent-gate-1' } });
    check('开通权益收益费 → SUCCEEDED + 编号重算', pay.status === 200 && pay.data.status === 'SUCCEEDED' && /^(YH|VIP|TS|SD|LC)\d{4,}$/.test(pay.data.displayId) && pay.data.entitlement.state === 'active' && pay.data.entitlement.expiresAt > Date.now());
    check('开通幂等（同 key 不重复）', (await req('POST', '/me/entitlement-orders', { token: GT, body: { idempotencyKey: 'ent-gate-1' } })).data.operationId === pay.data.operationId);
    const afterOv = await req('GET', '/partner/overview?contextId=partner:' + reg.data.user.id, { token: GT });
    check('开通后 → 报表解锁', afterOv.status === 200 && afterOv.data.locked === undefined && afterOv.data.displayId === pay.data.displayId);
    check('开通后 → 导出账单可用（JSON）', (await req('GET', '/me/income-export', { token: GT })).status === 200);
    check('开通后 → 导出账单可用（CSV）', (await req('GET', '/me/income-export?format=csv', { token: GT })).status === 200);
    check('缺少 idempotencyKey 400', (await req('POST', '/me/entitlement-orders', { token: GT, body: {} })).status === 400);

    // ── §4 个人中心 / 地址 / 优惠券 / 客服 / 协议 ──
    const me = await req('GET', '/me', { token: P1 });
    check('GET /me 资料', me.status === 200 && me.data.profile.id === 'p1' && me.data.orderCounts);
    const mePatch = await req('PATCH', '/me', { token: P1, body: { nickname: '联创-甲', version: 1 } });
    check('PATCH /me 改昵称（乐观锁）', mePatch.status === 200 && mePatch.data.profile.version === 2);
    check('PATCH /me 错误 version 409', (await req('PATCH', '/me', { token: P1, body: { nickname: 'x', version: 1 } })).status === 409);
    const adr1 = await req('POST', '/addresses', { token: P1, body: { recipient: '张三', phone: '13800138000', regionCodes: ['44', '4403', '440305'], regionNames: ['广东省', '深圳市', '南山区'], detail: '科技园 1 栋' } });
    check('POST /addresses 新增（首个为默认）', adr1.status === 200 && adr1.data.address.isDefault === true);
    const adr2 = await req('POST', '/addresses', { token: P1, body: { recipient: '李四', phone: '13800138000', regionCodes: ['44', '4403', '440304'], regionNames: ['广东省', '深圳市', '福田区'], detail: '中心区 2 栋' } });
    check('POST /addresses 第二个（非默认）', adr2.status === 200 && adr2.data.address.isDefault === false);
    check('GET /addresses 列表', (await req('GET', '/addresses', { token: P1 })).data.items.length === 2);
    check('PATCH /addresses 修改', (await req('PATCH', `/addresses/${adr2.data.address.id}`, { token: P1, body: { recipient: '李四四', version: 1 } })).status === 200);
    check('PUT /addresses/default 切换默认', (await req('PUT', '/addresses/default', { token: P1, body: { addressId: adr2.data.address.id, version: 2 } })).data.defaultAddressId === adr2.data.address.id);
    check('DELETE /addresses 删除', (await req('DELETE', `/addresses/${adr1.data.address.id}`, { token: P1, body: { version: 1 } })).status === 200);
    check('GET /coupons 可用券', (await req('GET', '/coupons?status=available', { token: P1 })).data.items.length === 2);
    check('GET /coupons 缺少 status 400', (await req('GET', '/coupons', { token: P1 })).status === 400);
    check('GET /support/config', (await req('GET', '/support/config', { token: P1 })).data.feedback.maxImages === 3);
    check('POST /support/feedback', (await req('POST', '/support/feedback', { token: P1, body: { content: '希望增加批量划拨', idempotencyKey: 'fbk-1' } })).status === 200);
    check('GET /agreements/user', (await req('GET', '/agreements/user', { token: P1 })).data.title === '用户服务协议');

    // ── §5 家庭会员 / 激活 ──
    check('GET /members/options', (await req('GET', '/members/options', { token: P1 })).data.grades.length > 10);
    const mem1 = await req('POST', '/members', { token: P1, body: { name: '张小宝', gradeCode: 'G3', genderCode: 'male', idempotencyKey: 'mem-1' } });
    check('POST /members 新增孩子', mem1.status === 200 && mem1.data.member.gradeLabel === '三年级');
    const mem1b = await req('POST', '/members', { token: P1, body: { name: '张小宝', gradeCode: 'G3', genderCode: 'male', idempotencyKey: 'mem-1' } });
    check('POST /members 幂等重复', mem1b.data.member.id === mem1.data.member.id);
    const memId = mem1.data.member.id;
    check('GET /members 列表', (await req('GET', '/members?scope=family', { token: P1 })).data.items.length === 1);
    check('PATCH /members 修改', (await req('PATCH', `/members/${memId}`, { token: P1, body: { gradeCode: 'G4', version: 1 } })).data.member.gradeLabel === '四年级');
    const prev1 = await req('POST', '/activations/preview', { token: P1, body: { code: 'NS-L1-0001', memberId: memId } });
    check('POST /activations/preview', prev1.status === 200 && prev1.data.alreadyActivated === false && prev1.data.levelName === '脑商启蒙');
    check('POST /activations 激活等级', (await req('POST', '/activations', { token: P1, body: { code: 'NS-L1-0001', targetType: 'level', targetId: 'L1', memberId: memId, idempotencyKey: 'act-1' } })).data.unlocked === true);
    check('激活后 preview 显示已激活', (await req('POST', '/activations/preview', { token: P1, body: { code: 'NS-L1-0001', memberId: memId } })).data.alreadyActivated === true);
    check('激活码不能重复用', (await req('POST', '/activations', { token: P1, body: { code: 'NS-L1-0001', targetType: 'level', targetId: 'L1', memberId: memId, idempotencyKey: 'act-2' } })).status === 400);
    check('GET /members/{id}/levels', (await req('GET', `/members/${memId}/levels`, { token: P1 })).data.levels.find((l) => l.id === 'L1').unlocked === true);
    check('GET /members/{id}/orders', (await req('GET', `/members/${memId}/orders`, { token: P1 })).status === 200);

    // ── §6 学习 / 公告 / 课程 / 进度 ──
    check('GET /learning/levels 导航（5 板块：粉丝/菁英/超级/行能/羿烁）', (await req('GET', '/learning/levels', { token: P1 })).data.levels.length === 5);
    const lv1 = await req('GET', `/learning/levels/L1?memberId=${memId}`, { token: P1 });
    check('GET /learning/levels/L1 章节可访问', lv1.status === 200 && lv1.data.chapters.every((c) => c.accessible));
    const prog = await req('PUT', `/members/${memId}/learning-progress`, { token: P1, body: { levelId: 'L1', chapterId: 'L1-C2', positionSeconds: 600, durationSeconds: 600, ended: true } });
    check('PUT 学习进度（视频看完自动完成）', prog.status === 200 && prog.data.completed === true);
    const les1 = await req('GET', `/lessons/L1-C1?memberId=${memId}`, { token: P1 });
    check('GET /lessons/{id} 已解锁返回正文', les1.status === 200 && les1.data.locked === false && les1.data.content);
    check('GET /lessons/{id} 未解锁锁定', (await req('GET', '/lessons/L2-C1?memberId=' + memId, { token: P1 })).data.locked === true);
    check('GET /announcements 列表', (await req('GET', '/announcements', { token: P1 })).data.items.length === 3);
    check('GET /announcements/{id} 详情', (await req('GET', '/announcements/ann_1', { token: P1 })).data.content.format === 'nodes');

    // ── §9 经营报表（抽查关键口径） ──
    const ov = await req('GET', '/partner/overview?contextId=partner:p1', { token: P1 });
    check('GET /partner/overview', ov.status === 200 && ov.data.quotaBalance === 500);
    const ga = await req('GET', '/partner/global-awards?contextId=partner:p1', { token: P1 });
    check('GET /partner/global-awards（teamVip 权重口径）', ga.status === 200 && ga.data.items.length >= 1);
    const ag = await req('GET', '/agency/overview?contextId=agency:p5', { token: P1 });
    check('GET /agency/overview 区县代', ag.status === 200 && ag.data.agencyType === 'COUNTY');
    const cs = await req('GET', '/costore/overview?contextId=costore:p7', { token: P1 });
    check('GET /costore/overview 合店（场景 C）', cs.status === 200 && cs.data.scenario && cs.data.scenario.code === 'C');

    // ── §10 经营操作 ──
    check('POST /partner/quota-orders 买名额', (await req('POST', '/partner/quota-orders', { token: P1, body: { contextId: 'partner:p1', quantity: 3, idempotencyKey: 'qo-1' } })).data.balances.standardRemaining === 503);
    check('POST /partner/quota-transfers 划拨', (await req('POST', '/partner/quota-transfers', { token: P1, body: { contextId: 'partner:p1', targetAccountId: 'p4', quantity: 2, idempotencyKey: 'qt-1' } })).data.balances.senderRemaining === 501);
    check('POST /partner/upgrades 升级', (await req('POST', '/partner/upgrades', { token: P1, body: { contextId: 'partner:p1', targetAccountId: 'p4', targetLevel: 'angel', idempotencyKey: 'up-1' } })).status === 200);
    check('POST /partner/store-bindings 绑定门店', (await req('POST', '/partner/store-bindings', { token: P1, body: { contextId: 'partner:p1', targetAccountId: 'p4', storeId: 'p6', idempotencyKey: 'sb-1' } })).status === 200);

    // ── §11 收益分配 / 钱包提现 ──
    // P0-9：可分配池 = 特色产品的「巡查 5% / 销售 5%」明细（owner 为区县代 p5 / 门店老板 p6），
    //   需先造一笔特色产品订单才会产生 pending_allocation 明细；普通供货差价不可分配。
    await req('POST', '/api/order/product', { token: admin, body: { buyerId: 'p4', productKey: 'featured', qty: 1, regionCode: '330110', deliveryType: 'store' } });
    const entries = await req('GET', '/income/entries?contextId=partner:p1', { token: P1 });
    check('GET /income/entries 收益列表', entries.status === 200 && entries.data.items.length >= 1);
    // 不可分配的明细：详情不再给 allocate 动作（与 allocation-options 判定一致）
    const plainId = entries.data.items[0].id;
    const plainDetail = await req('GET', `/income/entries/${plainId}?contextId=partner:p1`, { token: P1 });
    check('GET /income/entries/{id} 详情', plainDetail.status === 200 && Array.isArray(plainDetail.data.allowedActions));
    check('非可分配池明细不提供 allocate 动作', !plainDetail.data.allowedActions.includes('allocate'), plainDetail.data.allowedActions);
    // 可分配明细：区县代 p5 的巡查 5%
    const P5 = await loginParent('13800000005');
    const p5Entries = await req('GET', '/income/entries?contextId=partner:p5', { token: P5 });
    const allocEntry = (p5Entries.data.items || []).find((x) => x.allocationKind === 'inspection');
    check('巡查 5% 明细标记为可分配池', !!allocEntry, (p5Entries.data.items || []).map((x) => x.allocationKind));
    const entryId = allocEntry && allocEntry.id;
    const entryDetail = await req('GET', `/income/entries/${entryId}?contextId=partner:p5`, { token: P5 });
    check('可分配明细详情提供 allocate 动作', entryDetail.status === 200 && entryDetail.data.allowedActions.includes('allocate'));
    const allocOpts = await req('GET', `/income/entries/${entryId}/allocation-options?contextId=partner:p5`, { token: P5 });
    check('GET allocation-options 候选人', allocOpts.status === 200 && allocOpts.data.candidates.length >= 1);
    check('allocation-options 合计须 100% 的规则说明', allocOpts.status === 200 && /100%/.test(allocOpts.data.note || ''), allocOpts.data.note);
    // 比例合计 100%：本人 60% + 总部 40%
    const allocQuote = await req('POST', `/income/entries/${entryId}/allocation-quotes`, { token: P5, body: { contextId: 'partner:p5', targets: [{ targetId: 'p5', percent: 60, kind: 'self' }, { targetId: 'HQ', percent: 40, kind: 'hq' }] } });
    check('POST allocation-quotes 有效', allocQuote.status === 200 && allocQuote.data.valid === true, allocQuote.data);
    check('allocation-quotes 返回分账明细', allocQuote.status === 200 && Array.isArray(allocQuote.data.rows) && allocQuote.data.rows.length === 2);
    const alloc = await req('POST', `/income/entries/${entryId}/allocations`, { token: P5, body: { contextId: 'partner:p5', quoteId: allocQuote.data.id, targets: [{ targetId: 'p5', percent: 60, kind: 'self' }, { targetId: 'HQ', percent: 40, kind: 'hq' }], idempotencyKey: 'al-1' } });
    check('POST allocations 提交分配', alloc.status === 200 && alloc.data.status === 'PENDING_SETTLEMENT', alloc.data);
    check('分配后收益明细状态', (await req('GET', `/income/entries/${entryId}?contextId=partner:p5`, { token: P5 })).data.allocationStatus === 'PENDING');
    const wOpts = await req('GET', '/wallet/withdrawal-options?contextId=partner:p1', { token: P1 });
    check('GET /wallet/withdrawal-options', wOpts.status === 200 && wOpts.data.balance >= 100 && wOpts.data.minAmount === 100);
    check('POST /wallet/payees 登记收款账户', (await req('POST', '/wallet/payees', { token: P1, body: { contextId: 'partner:p1', accountType: 'PERSONAL', name: '张三', bankName: '招商银行', bankNumber: '6225880212345678' } })).data.payee.maskedBankNumber === '****5678');
    check('POST /wallet/payees 卡号位数错 400', (await req('POST', '/wallet/payees', { token: P1, body: { contextId: 'partner:p1', accountType: 'PERSONAL', name: '张三', bankName: '招商银行', bankNumber: '6225' } })).status === 400);
    const wQuote = await req('POST', '/wallet/withdrawal-quotes', { token: P1, body: { contextId: 'partner:p1', accountType: 'PERSONAL', payeeToken: (await req('GET', '/wallet/withdrawal-options?contextId=partner:p1', { token: P1 })).data.payees[0].token, amount: 100 } });
    check('POST /wallet/withdrawal-quotes', wQuote.status === 200 && wQuote.data.fee === 1 && wQuote.data.netAmount === 99);
    check('POST /wallet/withdrawal-quotes 低于最低 400', (await req('POST', '/wallet/withdrawal-quotes', { token: P1, body: { contextId: 'partner:p1', accountType: 'PERSONAL', payeeToken: wQuote.data.payeeToken, amount: 10 } })).status === 400);
    const wd = await req('POST', '/wallet/withdrawals', { token: P1, body: { contextId: 'partner:p1', quoteId: wQuote.data.id, payeeToken: wQuote.data.payeeToken, amount: 100, idempotencyKey: 'wd-1' } });
    check('POST /wallet/withdrawals 提现', wd.status === 200 && wd.data.status === 'PENDING_REVIEW');
    check('GET /wallet/withdrawals 列表', (await req('GET', '/wallet/withdrawals?contextId=partner:p1', { token: P1 })).data.items.length === 1);

    // ── §12 申请 / 邀请 ──
    check('GET /applications 列表', (await req('GET', '/applications?type=COSTORE', { token: P1 })).status === 200);
    const inv = await req('GET', '/promotion/invitations/promo-p5', { token: P1 });
    check('GET /promotion/invitations/{id} 区县邀请', inv.status === 200 && inv.data.agencyType === 'COUNTY' && inv.data.payableAmount === 100000);

    // ── §13 门店 / 健脑官 / 转店 ──
    const ws = await req('GET', '/agency/store-workspace?contextId=agency:p6&assignmentId=p6', { token: P6 });
    check('GET /agency/store-workspace', ws.status === 200 && ws.data.store && ws.data.allowedActions.length > 0);
    const stPatch = await req('PATCH', '/stores/p6', { token: P6, body: { contextId: 'agency:p6', name: '脑商线下店南山店', address: '深圳市南山区科技园 1 栋', version: 1 } });
    check('PATCH /stores/{id} 改门店资料', stPatch.status === 200 && stPatch.data.store.version === 2);
    const coach1 = await req('POST', '/stores/p6/coaches', { token: P6, body: { contextId: 'agency:p6', name: '王教练', loginAccount: 'coach_wang', idempotencyKey: 'co-1' } });
    check('POST /stores/{id}/coaches 新增健脑官', coach1.status === 200 && coach1.data.coach.status === 'ACTIVE');
    check('POST coaches 登录名重复 409', (await req('POST', '/stores/p6/coaches', { token: P6, body: { contextId: 'agency:p6', name: '李教练', loginAccount: 'coach_wang', idempotencyKey: 'co-2' } })).status === 409);
    check('PATCH /stores/{id}/coaches/{id} 改健脑官', (await req('PATCH', `/stores/p6/coaches/${coach1.data.coach.id}`, { token: P6, body: { contextId: 'agency:p6', name: '王教练二号', version: 1 } })).data.coach.name === '王教练二号');
    const COACH = (await req('POST', '/auth/sessions', { body: { channel: 'coach', loginAccount: 'coach_wang' } })).data.token;
    check('coach 登录', !!COACH);
    const cws = await req('GET', '/coach/workspace', { token: COACH });
    check('GET /coach/workspace', cws.status === 200 && cws.data.store.id === 'p6');
    const trOpts = await req('GET', `/store-transfer/options?contextId=agency:p6&memberId=${memId}`, { token: P6 });
    check('GET /store-transfer/options', trOpts.status === 200 && trOpts.data.stores.length >= 1);
    const trApp = await req('POST', '/store-transfer/applications', { token: P6, body: { contextId: 'agency:p6', memberId: memId, targetStoreId: 'p6', reason: '就近上课', idempotencyKey: 'tr-1' } });
    check('POST /store-transfer/applications', trApp.status === 200 && trApp.data.application.status === 'PENDING');
    check('同会员重复待审转店 409', (await req('POST', '/store-transfer/applications', { token: P6, body: { contextId: 'agency:p6', memberId: memId, targetStoreId: 'p6', reason: 'x', idempotencyKey: 'tr-2' } })).status === 409);
    const decision = await req('POST', `/applications/${trApp.data.application.id}/decisions`, { token: admin, body: { decision: 'APPROVE', version: 1 } });
    check('POST /applications/{id}/decisions 审批通过', decision.status === 200 && decision.data.status === 'APPROVED');
    const memList = (await req('GET', '/members?scope=family', { token: P1 })).data;
    const memAfter = memList.items[0];
    check('审批后会员归属门店', memAfter.storeId === 'p6');
    const sp = await req('GET', `/members/${memId}/store-profile?contextId=coach:${coach1.data.coach.id}`, { token: COACH });
    check('GET /members/{id}/store-profile', sp.status === 200 && sp.data.member.storeId === 'p6');
    const trPatch = await req('PATCH', `/members/${memId}/training`, { token: COACH, body: { trainingTotal: 20, trainingUsed: 5, specialTotal: 4, specialUsed: 1, version: memAfter.version } });
    check('PATCH /members/{id}/training 课时', trPatch.status === 200 && trPatch.data.member.training.trainingTotal === 20);
    check('PATCH training 超总课时 400', (await req('PATCH', `/members/${memId}/training`, { token: COACH, body: { trainingTotal: 5, trainingUsed: 6, specialTotal: 0, specialUsed: 0, version: trPatch.data.member.version } })).status === 400);
    const tfb = await req('POST', '/training-feedback', { token: COACH, body: { memberId: memId, kind: 'training', title: '今日训练反馈', text: '专注力有明显提升。', idempotencyKey: 'tf-1' } });
    check('POST /training-feedback', tfb.status === 200 && !!tfb.data.id);
    check('GET /training-feedback/{id} 详情', (await req('GET', `/training-feedback/${tfb.data.id}?memberId=${memId}`, { token: COACH })).data.memberName === '张小宝');
    check('GET /members/{id}/training-feedback', (await req('GET', `/members/${memId}/training-feedback?kind=training`, { token: COACH })).data.items.length === 1);

    // ── §14 上传 / 素材 / 合成任务 ──
    const up1 = await req('POST', '/assets/upload-intents', { token: P1, body: { purpose: 'avatar', fileName: 'a.png', mimeType: 'image/png', size: 1024 } });
    check('POST /assets/upload-intents', up1.status === 200 && up1.data.uploadUrl.startsWith('https://'));
    check('upload-intents 类型不符 400', (await req('POST', '/assets/upload-intents', { token: P1, body: { purpose: 'avatar', fileName: 'a.pdf', mimeType: 'application/pdf', size: 1024 } })).status === 400);
    const comp1 = await req('POST', `/assets/${up1.data.assetId}/completions`, { token: P1 });
    check('POST /assets/{id}/completions', comp1.status === 200 && comp1.data.status === 'ready' && comp1.data.previewUrl);
    const upQr = await req('POST', '/assets/upload-intents', { token: P1, body: { purpose: 'material-qr', fileName: 'qr.png', mimeType: 'image/png', size: 2048 } });
    await req('POST', `/assets/${upQr.data.assetId}/completions`, { token: P1 });
    check('GET /materials/categories', (await req('GET', '/materials/categories?type=image', { token: P1 })).data.categories.length === 2);
    check('GET /materials 列表', (await req('GET', '/materials?type=image', { token: P1 })).data.items.length === 2);
    check('GET /materials/{id}', (await req('GET', '/materials/mat_1', { token: P1 })).data.templateId === 'tpl_poster_v1');
    const render = await req('POST', '/materials/mat_1/renders', { token: P1, body: { qrAssetId: upQr.data.assetId, idempotencyKey: 'rd-1' } });
    check('POST /materials/{id}/renders', render.status === 200 && !!render.data.jobId);
    let job = null;
    for (let i = 0; i < 20; i++) { job = (await req('GET', `/jobs/${render.data.jobId}`, { token: P1 })).data; if (job.status === 'succeeded' || job.status === 'failed') break; await new Promise((r) => setTimeout(r, 300)); }
    check('GET /jobs/{jobId} 合成成功', job && job.status === 'succeeded' && job.downloadUrl && job.shareUrl);

    // ── §7/§8 商城订单（抽查） ──
    check('GET /catalog', (await req('GET', '/catalog', { token: P1 })).status === 200);
    check('POST /checkout/quotes', (await req('POST', '/checkout/quotes', { token: P1, body: { productKey: 'pad', quantity: 2 } })).status === 200);
    check('POST /checkout/quotes 未知商品 400', (await req('POST', '/checkout/quotes', { token: P1, body: { productKey: 'nope', quantity: 1 } })).status === 400);
    check('GET /orders', (await req('GET', '/orders', { token: P1 })).status === 200);

    // ── §3 短信/密码重置（真实流程，测试平台回传 devCode） ──
    const sms = await req('POST', '/auth/sms-challenges', { body: { phone: '13800000001', purpose: 'reset-password' } });
    check('POST /auth/sms-challenges（回传 devCode 供联调）', sms.status === 200 && /^\d{6}$/.test(sms.data.devCode || ''));
    const prt = await req('POST', '/auth/password-reset-verifications', { body: { phone: '13800000001', code: sms.data.devCode } });
    check('POST /auth/password-reset-verifications', prt.status === 200 && !!prt.data.resetTicket);
    check('POST /auth/password-resets', (await req('POST', '/auth/password-resets', { body: { resetTicket: prt.data.resetTicket, password: 'newpass123' } })).data.success === true);
    check('POST /auth/password-resets 票据复用 400', (await req('POST', '/auth/password-resets', { body: { resetTicket: prt.data.resetTicket, password: 'newpass123' } })).status === 400);
    check('POST /me/password-changes', (await req('POST', '/me/password-changes', { token: P1, body: { oldPassword: 'newpass123', newPassword: 'backpass123' } })).data.changed === true);

    // ── §10 年度权益三段式 ──
    check('GET /partner/entitlement-options', (await req('GET', '/partner/entitlement-options?contextId=partner:p1', { token: P1 })).data.plans[0].id === 'annual');
    check('POST /partner/entitlement-quotes', (await req('POST', '/partner/entitlement-quotes', { token: P1, body: { contextId: 'partner:p1', planId: 'annual' } })).data.amount === 1980);
    // 报价已落库（2026-10-26）：提交时凭真实 quoteId 校验；quoteId 为假 id 时应被拒
    const entQ = await req('POST', '/partner/entitlement-quotes', { token: P1, body: { contextId: 'partner:p1', planId: 'annual' } });
    check('POST /partner/entitlement-quotes 返回真实 quoteId', !!entQ.data.id && entQ.data.ruleVersion === 1, entQ.data);
    check('POST /partner/entitlement-orders（真实 quoteId）', (await req('POST', '/partner/entitlement-orders', { token: P1, body: { contextId: 'partner:p1', quoteId: entQ.data.id, planId: 'annual', idempotencyKey: 'en-1' } })).data.status === 'SUCCEEDED');
    check('POST /partner/entitlement-orders（假 quoteId 被拒）', (await req('POST', '/partner/entitlement-orders', { token: P1, body: { contextId: 'partner:p1', quoteId: 'q', planId: 'annual', idempotencyKey: 'en-2' } })).status === 400);

    // ── §8 专栏激活 ──
    check('POST /activations 专栏激活（账号级）', (await req('POST', '/activations', { token: P1, body: { code: 'NS-COL-0001', targetType: 'column', targetId: 'col_1', idempotencyKey: 'act-col-1' } })).data.unlocked === true);
    check('GET /columns/{id} 解锁状态', (await req('GET', '/columns/col_1', { token: P1 })).data.unlocked === true);

    // ── §9 团队节点详情 / 上级绑定 ──
    check('GET /agency/team/{id} 节点详情', (await req('GET', '/agency/team/p2?contextId=agency:p5', { token: P1 })).data.node.name === '私董-乙');
    check('POST /partner/superior-bindings 绑定上级', (await req('POST', '/partner/superior-bindings', { token: P1, body: { contextId: 'partner:p4', inviteCode: '13800000001' } })).data.superior.id === 'p1');
    check('POST /partner/superior-bindings 邀请码错 404', (await req('POST', '/partner/superior-bindings', { token: P1, body: { contextId: 'partner:p4', inviteCode: '000' } })).status === 404);

    // ── 收尾：恢复默认种子，保证 db.json 干净 ──
    check('测试后恢复默认种子', (await req('POST', '/api/seed/reset', { token: admin })).status === 200);
  } finally {
    srv.kill();
  }
  console.log(`\nH5 契约端到端: PASS=${passed} FAIL=${failed}`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error('runner error', e); process.exit(1); });

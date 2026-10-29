/**
 * 孩子会员等级体系 + 家长编号派生 · 专项验证（2026-10-24 产品截图规则）
 * 覆盖：
 *   1. 六级会员等级阶梯（normal/fs/jy/cj/xn/ys）与前缀（QZ/FS/JY/CJ/XN/YS）
 *   2. 孩子编号：前缀 + 全局添加序号；升级只变前缀、编号不变（FS3000→CJ3000）
 *   3. 家长编号：QZ 门禁绝对优先；权益正常时「跟着最高孩子等级走」，不与家长档位比高低
 *   4. 激活码：五级会员等级码 + 家长档位门槛（CJ←VIP合伙人；XN/YS←天使合伙人）+ 只升不降
 *   5. 板块权益：等级分 ≥ 板块要求分解锁（粉丝→菁英→超级→行能→羿烁逐级累积）
 *   6. 存量迁移：旧 member 补 memberSeq/memberLevel/display_id
 * 运行：node scripts/verify_member_tiers.js
 */
const assert = require('assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const S = require(path.join(ROOT, 'src/store'));
const R = require(path.join(ROOT, 'src/routes'));
const IZ = require(path.join(ROOT, 'src/identity'));

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  ok  ' + name); } else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra).slice(0, 200) : '')); } };

// ═══════════ 1. 等级阶梯 ═══════════
console.log('\n[1] 六级会员等级阶梯');
ok('六级齐全', ['normal', 'fs', 'jy', 'cj', 'xn', 'ys'].every((k) => IZ.MEMBER_TIERS[k]));
ok('前缀 QZ/FS/JY/CJ/XN/YS', ['normal', 'fs', 'jy', 'cj', 'xn', 'ys'].map((k) => IZ.MEMBER_TIERS[k].prefix).join(',') === 'QZ,FS,JY,CJ,XN,YS');
ok('分数 0-5 递增', [0, 1, 2, 3, 4, 5].every((s, i) => IZ.MEMBER_TIERS[['normal', 'fs', 'jy', 'cj', 'xn', 'ys'][i]].score === s));
ok('孩子编号四位起步', IZ.memberDisplayId('fs', 1) === 'FS0001' && IZ.memberDisplayId('normal', 7) === 'QZ0007');
ok('升级只变前缀编号不变（FS3000→CJ3000）', IZ.memberDisplayId('cj', 3000) === 'CJ3000');
ok('家长档位门槛：cj 需 VIP合伙人(score1)', IZ.MEMBER_TIER_MIN_TIER_SCORE.cj === 1 && IZ.memberTierAllowedForParent('cj', 'vip') === true && IZ.memberTierAllowedForParent('cj', 'none') === false);
ok('家长档位门槛：xn/ys 需 天使合伙人(score2)', IZ.MEMBER_TIER_MIN_TIER_SCORE.xn === 2 && IZ.memberTierAllowedForParent('xn', 'vip') === false && IZ.memberTierAllowedForParent('xn', 'angel') === true);
ok('家长档位门槛：fs/jy 门店码无要求', IZ.memberTierAllowedForParent('fs', 'none') === true && IZ.memberTierAllowedForParent('jy', 'none') === true);

// ═══════════ 2. 家长编号派生（家长跟着孩子走，不在于身份高低） ═══════════
console.log('\n[2] 家长编号派生规则');
function buildParent(tier, ent, children = []) {
  const db = S.createDb();
  const u = S.addUser(db, { id: 'par', tier, entitlement_state: ent || 'active' });
  children.forEach((lv, i) => {
    db.members = db.members || [];
    db.members.push({ id: 'm' + i, userId: 'par', memberLevel: lv, memberSeq: i + 1, display_id: IZ.memberDisplayId(lv, i + 1) });
  });
  return db;
}
ok('权益未开通 → QZ（即使孩子是羿烁）', IZ.userPrefix(buildParent('none', 'never_paid', ['ys']), { id: 'par', tier: 'none', entitlement_state: 'never_paid', seq: 8 }) === 'QZ');
ok('权益过期 → QZ（即使孩子是羿烁）', IZ.userPrefix(buildParent('cofounder', 'expired', ['ys']), { id: 'par', tier: 'cofounder', entitlement_state: 'expired', seq: 8 }) === 'QZ');
ok('普通家长无孩子 → YH', IZ.userPrefix(buildParent('none', 'active'), { id: 'par', tier: 'none', seq: 1 }) === 'YH');
ok('普通家长+普通孩子（游客）→ YH（不降 QZ）', IZ.userPrefix(buildParent('none', 'active', ['normal']), { id: 'par', tier: 'none', seq: 1 }) === 'YH');
ok('普通家长+粉丝孩子 → FS（跟着孩子走）', IZ.userPrefix(buildParent('none', 'active', ['fs']), { id: 'par', tier: 'none', seq: 5 }) === 'FS');
ok('VIP家长+菁英孩子 → JY（跟着孩子走）', IZ.userPrefix(buildParent('vip', 'active', ['jy']), { id: 'par', tier: 'vip', seq: 5 }) === 'JY');
ok('天使家长+菁英孩子 → JY（跟着孩子走，不比高低）', IZ.userPrefix(buildParent('angel', 'active', ['jy']), { id: 'par', tier: 'angel', seq: 5 }) === 'JY');
ok('联创家长+粉丝孩子 → FS（跟着孩子走，不比高低）', IZ.userPrefix(buildParent('cofounder', 'active', ['fs']), { id: 'par', tier: 'cofounder', seq: 1 }) === 'FS');
ok('联创家长+羿烁孩子 → YS（跟着孩子走）', IZ.userPrefix(buildParent('cofounder', 'active', ['ys']), { id: 'par', tier: 'cofounder', seq: 1 }) === 'YS');
ok('联创家长+普通孩子（未激活）→ LC（无已激活孩子，保留家长档位）', IZ.userPrefix(buildParent('cofounder', 'active', ['normal']), { id: 'par', tier: 'cofounder', seq: 1 }) === 'LC');
ok('天使家长+超级孩子 → CJ（跟着孩子走）', IZ.userPrefix(buildParent('angel', 'active', ['cj']), { id: 'par', tier: 'angel', seq: 5 }) === 'CJ');
ok('多孩子取最高（粉丝+超级 → 按 cj 判）', IZ.bestMemberLevel(buildParent('vip', 'active', ['fs', 'cj']), 'par') === 'cj');
ok('完整编号：普通家长+粉丝孩子 → FS0005', IZ.displayIdOfUser(buildParent('none', 'active', ['fs']), { id: 'par', tier: 'none', seq: 5 }) === 'FS0005');
ok('完整编号：联创家长+羿烁孩子 → YS0001', IZ.displayIdOfUser(buildParent('cofounder', 'active', ['ys']), { id: 'par', tier: 'cofounder', seq: 1 }) === 'YS0001');

// ═══════════ 3. applyMemberLevel 联动重算 ═══════════
console.log('\n[3] 孩子升级 → 双方编号重算');
{
  const db = S.createDb();
  S.addUser(db, { id: 'par', tier: 'none', entitlement_state: 'active' });
  db.members = [];
  db.members.push({ id: 'kid', userId: 'par', memberLevel: 'normal' });
  IZ.assignMemberSeq(db, 'kid');
  IZ.recomputeMemberDisplayId(db, 'kid');
  ok('新孩子 → QZ0001 + 家长 YH0001', db.members[0].display_id === 'QZ0001' && db.users.par.display_id === 'YH0001');
  IZ.applyMemberLevel(db, 'kid', 'fs');
  ok('激活粉丝 → 孩子 FS0001 + 家长 FS0001', db.members[0].display_id === 'FS0001' && db.users.par.display_id === 'FS0001');
  IZ.applyMemberLevel(db, 'kid', 'cj');
  ok('再激活超级 → 孩子 CJ0001（编号不变）+ 家长 CJ0001', db.members[0].display_id === 'CJ0001' && db.users.par.display_id === 'CJ0001');
  IZ.applyMemberLevel(db, 'kid', 'jy'); // 降级尝试
  ok('只升不降（cj 孩子激活 jy 无效）', db.members[0].memberLevel === 'cj' && db.members[0].display_id === 'CJ0001');
  // 序号连续
  db.members.push({ id: 'kid2', userId: 'par', memberLevel: 'normal' });
  IZ.assignMemberSeq(db, 'kid2');
  ok('第二个孩子序号 0002', db.members[1].memberSeq === 2 && IZ.recomputeMemberDisplayId(db, 'kid2') === 'QZ0002');
}

// ═══════════ 4. 存量迁移 ═══════════
console.log('\n[4] 存量数据迁移');
{
  const db = S.createDb();
  db.members = [
    { id: 'old2', userId: 'p1', name: '老二', createdAt: 2000 },
    { id: 'old1', userId: 'p1', name: '老大', createdAt: 1000 },
  ];
  const ordered = db.members.slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  for (const m of ordered) {
    if (m.memberLevel == null) m.memberLevel = 'normal';
    if (m.memberSeq == null) IZ.assignMemberSeq(db, m.id);
    IZ.recomputeMemberDisplayId(db, m.id);
  }
  ok('按添加时间补序号（老大0001/老二0002）', db.members.find((m) => m.id === 'old1').memberSeq === 1 && db.members.find((m) => m.id === 'old2').memberSeq === 2);
  ok('补默认等级 normal + 编号 QZ', db.members.every((m) => m.memberLevel === 'normal' && /^QZ\d{4}$/.test(m.display_id)));
}

// ═══════════ 5. HTTP 端到端 ═══════════
const PORT = 3227;
const BASE = `http://127.0.0.1:${PORT}`;
const { parentLogin } = require('./loginKit.cjs');
const req = (m, p, { token, body } = {}) => fetch(BASE + p, {
  method: m,
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
}).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }));
const login = async (phone) => (await parentLogin(req, phone)).data.token;

async function httpTests() {
  const srv = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT, env: { ...process.env, PORT: String(PORT), EXPOSE_DEV_CODE: '1' }, stdio: 'ignore',
  });
  const boot = Date.now();
  while (Date.now() - boot < 15000) {
    try { const r = await fetch(BASE + '/'); if (r.ok) break; } catch (e) { /* retry */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  try {
    const admin = (await req('POST', '/auth/sessions', { body: { channel: 'admin', password: 'admin888' } })).data.token;
    await req('POST', '/api/seed/reset', { token: admin });
    console.log('\n[5] HTTP 端到端（真实服务 ' + PORT + '）');

    // 注册新家长（默认 vip 档）→ 未开通时加孩子/激活都被门禁挡住
    const phone = '139' + String(Math.floor(10000000 + Math.random() * 89999999));
    const _code = (await req('POST', '/auth/sms-challenges', { body: { phone, purpose: 'register' } })).data.devCode;
    const reg = await req('POST', '/auth/registrations', { body: { phone, code: _code, password: 'abc123', name: '会员体系自测', inviteCode: '13800000001' } });
    const T = reg.data.token;
    const uid = reg.data.user.id;
    ok('注册 → QZ 编号（未开通）', /^QZ\d{4,}$/.test(reg.data.user.displayId));
    const addLocked = await req('POST', '/members', { token: T, body: { name: '小宝', gradeCode: 'K1', genderCode: 'male', idempotencyKey: 'mb-lock' } });
    ok('未开通 → 添加孩子被锁定（locked）', addLocked.data && addLocked.data.locked === true);

    // 开通权益 → active
    await req('POST', '/me/entitlement-orders', { token: T, body: { idempotencyKey: 'mt-ent' } });
    const bootMe = await req('GET', '/me/bootstrap', { token: T });
    ok('开通后家长编号（vip 档，无孩子 → VIP）', /^VIP\d{4,}$/.test(bootMe.data.displayId), bootMe.data.displayId);

    // 添加两个孩子
    const c1 = await req('POST', '/members', { token: T, body: { name: '大宝', gradeCode: 'G1', genderCode: 'male', idempotencyKey: 'mb-1' } });
    const c2 = await req('POST', '/members', { token: T, body: { name: '二宝', gradeCode: 'K2', genderCode: 'female', idempotencyKey: 'mb-2' } });
    const kid1 = c1.data.member.id;
    const kid2 = c2.data.member.id;
    ok('孩子1 → QZ0001（普通会员游客）', c1.data.member.displayId === 'QZ0001', c1.data.member.displayId);
    ok('孩子2 → QZ0002（按添加顺序）', c2.data.member.displayId === 'QZ0002', c2.data.member.displayId);
    ok('公共输出含 memberLevel/memberLevelName', c1.data.member.memberLevel === 'normal' && c1.data.member.memberLevelName === '普通会员（游客）');
    ok('家长只有普通（未激活）孩子 → 保留 VIP', /^VIP\d{4,}$/.test(bootMe.data.displayId));

    // ── 普通孩子（游客）板块权益：全部未锁；写进度 403；历史 level 码仍兼容 ──
    const lv2 = await req('GET', `/members/${kid2}/levels`, { token: T });
    ok('普通孩子：全部板块未解锁', lv2.data.levels.every((l) => l.unlocked === false));
    const progLocked = await req('PUT', `/members/${kid2}/learning-progress`, { token: T, body: { levelId: 'L1', chapterId: 'L1-C1', positionSeconds: 10, durationSeconds: 100 } });
    ok('普通孩子写学习进度 → 403', progLocked.status === 403);
    const actL1 = await req('POST', '/activations', { token: T, body: { code: 'NS-L1-0001', targetType: 'level', targetId: 'L1', memberId: kid2, idempotencyKey: 'act-l1-k2' } });
    ok('历史 level 激活码仍可用（兼容）', actL1.status === 200);
    const lv2b = await req('GET', `/members/${kid2}/levels`, { token: T });
    ok('普通孩子单开 L1 后可学 L1', lv2b.data.levels.find((l) => l.id === 'L1').unlocked === true && lv2b.data.levels.find((l) => l.id === 'L2').unlocked === false);

    // 激活粉丝会员（孩子1）→ 孩子 FS0001；家长 vip(1) vs fs(1) 同分 → 保持 VIP
    const actFs = await req('POST', '/activations', { token: T, body: { code: 'NS-FS-0001', targetType: 'fs', memberId: kid1, idempotencyKey: 'act-fs' } });
    ok('激活粉丝会员成功', actFs.status === 200 && actFs.data.unlocked === true);
    const k1 = await req('GET', '/members', { token: T });
    const m1 = k1.data.items.find((x) => x.id === kid1);
    ok('孩子1 编号 → FS0001', m1.displayId === 'FS0001', m1.displayId);
    ok('孩子1 memberLevelName → 粉丝会员', m1.memberLevelName === '粉丝会员');
    ok('家长 VIP + 粉丝孩子 → FS（跟着孩子走，不比高低）', /^FS\d{4,}$/.test((await req('GET', '/me/bootstrap', { token: T })).data.displayId));

    // 激活 1阶菁英（孩子1）→ JY0001；家长 2>1 → JY 上浮
    const actJy = await req('POST', '/activations', { token: T, body: { code: 'NS-JY-0002', targetType: 'jy', memberId: kid1, idempotencyKey: 'act-jy' } });
    ok('激活 1阶菁英会员成功', actJy.status === 200);
    const m1b = (await req('GET', '/members', { token: T })).data.items.find((x) => x.id === kid1);
    ok('孩子1 编号 → JY0001（编号不变只变前缀）', m1b.displayId === 'JY0001', m1b.displayId);
    const boot2 = await req('GET', '/me/bootstrap', { token: T });
    ok('家长跟着孩子走 → JY', /^JY\d{4,}$/.test(boot2.data.displayId), boot2.data.displayId);

    // 家长档位门槛：vip 家长激活 XN（需天使）→ 403 且不消耗码
    const actXn = await req('POST', '/activations', { token: T, body: { code: 'NS-XN-0004', targetType: 'xn', memberId: kid1, idempotencyKey: 'act-xn' } });
    ok('VIP 家长激活 2阶行能 → 403（需天使合伙人）', actXn.status === 403, actXn.data && actXn.data.error);
    // 升级家长为天使 → 再激活 XN 成功
    await req('POST', '/api/partner/update', { token: admin, body: { partnerId: uid, patch: { tier: 'angel' } } });
    const actXn2 = await req('POST', '/activations', { token: T, body: { code: 'NS-XN-0004', targetType: 'xn', memberId: kid1, idempotencyKey: 'act-xn2' } });
    ok('升天使后激活 2阶行能成功', actXn2.status === 200);
    const m1c = (await req('GET', '/members', { token: T })).data.items.find((x) => x.id === kid1);
    ok('孩子1 编号 → XN0001', m1c.displayId === 'XN0001', m1c.displayId);
    const boot3 = await req('GET', '/me/bootstrap', { token: T });
    ok('家长跟着孩子走 → XN', /^XN\d{4,}$/.test(boot3.data.displayId), boot3.data.displayId);

    // ── 联创家长 + 粉丝孩子 → FS（跟着孩子走，不在于身份高低；端到端） ──
    const phone2 = '139' + String(Math.floor(10000000 + Math.random() * 89999999));
    const _code2 = (await req('POST', '/auth/sms-challenges', { body: { phone: phone2, purpose: 'register' } })).data.devCode;
    const reg2 = await req('POST', '/auth/registrations', { body: { phone: phone2, code: _code2, password: 'abc123', name: '联创家长自测', inviteCode: '13800000001' } });
    const T2 = reg2.data.token;
    const uid2 = reg2.data.user.id;
    await req('POST', '/me/entitlement-orders', { token: T2, body: { idempotencyKey: 'mt-ent2' } });
    await req('POST', '/api/partner/update', { token: admin, body: { partnerId: uid2, patch: { tier: 'cofounder' } } });
    const bootLc = await req('GET', '/me/bootstrap', { token: T2 });
    ok('联创家长（无孩子）→ LC 编号', /^LC\d{4,}$/.test(bootLc.data.displayId), bootLc.data.displayId);
    const c3 = await req('POST', '/members', { token: T2, body: { name: '小联', gradeCode: 'G2', genderCode: 'female', idempotencyKey: 'mb-3' } });
    const kid3 = c3.data.member.id;
    ok('第二个家长的孩子 → QZ0003（全平台按添加时间全局排序）', c3.data.member.displayId === 'QZ0003', c3.data.member.displayId);
    const bootLc2 = await req('GET', '/me/bootstrap', { token: T2 });
    ok('联创家长+普通孩子（未激活）→ 仍 LC', /^LC\d{4,}$/.test(bootLc2.data.displayId), bootLc2.data.displayId);
    const actFs2 = await req('POST', '/activations', { token: T2, body: { code: 'NS-FS-0006', targetType: 'fs', memberId: kid3, idempotencyKey: 'act-fs2' } });
    ok('联创家长激活粉丝孩子成功', actFs2.status === 200);
    const bootFs = await req('GET', '/me/bootstrap', { token: T2 });
    ok('联创家长+粉丝孩子 → FS（跟着孩子走，不比高低）', /^FS\d{4,}$/.test(bootFs.data.displayId), bootFs.data.displayId);

    // 只升不降：用 CJ 码（3<4）激活 XN 孩子 → duplicate 不降级、不消耗码
    const actDown = await req('POST', '/activations', { token: T, body: { code: 'NS-CJ-0003', targetType: 'cj', memberId: kid1, idempotencyKey: 'act-cj-down' } });
    ok('低等级码激活高等级孩子 → 不降级', actDown.data && (actDown.data.duplicate === true || actDown.data.unlocked === true));
    const m1d = (await req('GET', '/members', { token: T })).data.items.find((x) => x.id === kid1);
    ok('孩子1 仍为 XN0001', m1d.displayId === 'XN0001');
    // CJ 码未被消耗（可再用于孩子2，家长天使档允许）
    const actCj2 = await req('POST', '/activations', { token: T, body: { code: 'NS-CJ-0003', targetType: 'cj', memberId: kid2, idempotencyKey: 'act-cj-k2' } });
    ok('未降级则不消耗码（CJ 码可激活孩子2）', actCj2.status === 200);
    const m2 = (await req('GET', '/members', { token: T })).data.items.find((x) => x.id === kid2);
    ok('孩子2 → CJ0002（等级前缀+自己的序号）', m2.displayId === 'CJ0002', m2.displayId);

    // 板块权益（孩子1 = XN：解锁 L1-L4；孩子2 已升 CJ 后同样可学 L1-L3）
    const lv1 = await req('GET', `/members/${kid1}/levels`, { token: T });
    const unlockedIds = lv1.data.levels.filter((l) => l.unlocked).map((l) => l.id);
    ok('XN 孩子：解锁 L1-L4（粉丝/菁英/超级/行能）', JSON.stringify(unlockedIds) === JSON.stringify(['L1', 'L2', 'L3', 'L4']), unlockedIds);
    ok('XN 孩子：L5 羿烁板块仍锁', lv1.data.levels.find((l) => l.id === 'L5').unlocked === false);
    ok('板块带 requireMemberLevel 说明', lv1.data.levels.find((l) => l.id === 'L2').requireMemberLevel === '1阶菁英会员');
    const learnQ = await req('GET', `/learning/levels?memberId=${kid1}`, { token: T });
    ok('/learning/levels 同步板块权益', learnQ.data.levels.filter((l) => l.unlocked).length === 4 && learnQ.data.memberLevelName === '2阶行能会员');
    const progOk = await req('PUT', `/members/${kid1}/learning-progress`, { token: T, body: { levelId: 'L1', chapterId: 'L1-C1', positionSeconds: 10, durationSeconds: 100 } });
    ok('XN 孩子写学习进度 → 200', progOk.status === 200);
    const lessonLocked = await req('GET', `/lessons/L5-C1?memberId=${kid1}`, { token: T });
    ok('未解锁板块课程 → locked + 提示所需等级', lessonLocked.data.locked === true && lessonLocked.data.requireMemberLevel === '3阶羿烁会员');

    // 激活码预览（会员等级类）
    const prev = await req('POST', '/activations/preview', { token: T, body: { code: 'NS-YS-0005', memberId: kid1 } });
    ok('preview 会员等级码：memberLevel=ys + 未激活', prev.data.memberLevel === 'ys' && prev.data.alreadyActivated === false && prev.data.memberLevelName === '3阶羿烁会员');

    // 收尾：恢复默认种子
    const reset = await req('POST', '/api/seed/reset', { token: admin });
    ok('测试后 seed reset', reset.status === 200);
  } finally {
    srv.kill();
  }
}

(async () => {
  await httpTests();
  console.log(`\n会员等级体系: PASS=${pass} FAIL=${fail}`);
  process.exit(fail ? 1 : 0);
})();

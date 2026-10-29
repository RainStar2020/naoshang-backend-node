/**
 * 脑商AI合伙人 H5 · 业务模块契约接口层
 * 覆盖契约 §4 个人中心/地址/优惠券/客服、§5 家庭会员/激活、§6 学习/公告/课程/进度、
 *      §11 收益分配/钱包提现、§12 遗留（申请列表/邀请落地页）、
 *      §13 门店工作台/健脑官/课时/反馈/转店、§14 上传/素材/合成任务。
 *
 * 设计：
 *   - 数据集合懒初始化于 db（BIZ_KEYS），随 server.js saveDb 全量快照持久化；
 *     /api/seed/reset 时经 resetBiz 清空（见 server.js loadSeed）。
 *   - 金额单位与 h5.js 一致：内部按「元」round2（契约约定对外「分」，联调统一前以此为准，
 *     已在《后端API交接说明》第 4 节标注）。
 *   - 鉴权沿用 Bearer token；身份：user（合伙人）/ admin（总部）/ coach（健脑官，loginAccount 登录）。
 *   - 乐观锁：地址/会员/门店/申请等带 version，修改与删除须携带且匹配。
 *   - 幂等：创建类接口接受 idempotencyKey，重复提交返回原结果。
 */
const S = require('../store');
const R = require('../routes');
const C = require('../commission');
const RA = require('../regionAgent');
const IZ = require('../identity');
const OL = require('../orderLifecycle');
const ALC = require('../allocation');
const IDEM = require('../utils/idempotency');
// 富文本节点：统一走 richContent.js（前端 normalizeContent 契约格式，2026-10-27 修正）
const { nodes, para, heading } = require('../richContent');
// 专栏定义：db.columns（业务可编辑），缺省回落到 columns.js 的默认种子
const { DEFAULT_COLUMNS, columnById, columnChapterOf, columnList } = require('../columns');
// 商品目录展示层（SKU 结构推导 + 活动价读取）
const CAT = require('../catalogDisplay');
const MONEY_SHADOW = require('../common/api-standard/money-shadow');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const nowMs = () => Date.now();
const rid = (p) => `${p}_${Math.random().toString(36).slice(2, 10)}`;
const DAY = 86400000;
const periodOf = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

// ───────────── 业务数据集合（懒初始化 + 可重置） ─────────────
const BIZ_KEYS = [
  'addresses', 'members', 'coupons', 'supportFeedback', 'activationCodes',
  'learningProgress', 'withdrawals', 'payees', 'allocations',
  'coaches', 'trainingFeedback', 'storeTransfers', 'assets', 'materialRenders', 'jobs', 'applications',
  'passwordResets', 'smsChallenges', 'entitlementOrders',
  'columns', // 专栏（业务可编辑：data/db.json 的 columns 集合）
  'skus', 'stockLedger', // SKU 库存台账 + 库存流水
  'activityPrices', // 商品活动价（[{productId, amount(元), updatedAt}]；未配置则 activityAmount=null）
];
function ensure(db) {
  for (const k of BIZ_KEYS) if (!Array.isArray(db[k])) db[k] = [];
  if (db.activationCodes.length === 0) {
    const exp = nowMs() + 90 * DAY;
    // 孩子会员等级激活码（2026-10-24 截图规则）：FS 门店19.9 / JY 门店3990 / CJ 家长VIP合伙人赠码 / XN·YS 家长天使合伙人赠码
    db.activationCodes.push(
      { code: 'NS-FS-0001', targetType: 'fs', targetId: null, maxUses: 1, uses: 0, status: 'active', expiresAt: exp },
      { code: 'NS-FS-0006', targetType: 'fs', targetId: null, maxUses: 1, uses: 0, status: 'active', expiresAt: exp },
      { code: 'NS-JY-0002', targetType: 'jy', targetId: null, maxUses: 1, uses: 0, status: 'active', expiresAt: exp },
      { code: 'NS-CJ-0003', targetType: 'cj', targetId: null, maxUses: 1, uses: 0, status: 'active', expiresAt: exp },
      { code: 'NS-XN-0004', targetType: 'xn', targetId: null, maxUses: 1, uses: 0, status: 'active', expiresAt: exp },
      { code: 'NS-YS-0005', targetType: 'ys', targetId: null, maxUses: 1, uses: 0, status: 'active', expiresAt: exp },
      { code: 'NS-L1-0001', targetType: 'level', targetId: 'L1', maxUses: 1, uses: 0, status: 'active', expiresAt: exp },
      { code: 'NS-L2-0002', targetType: 'level', targetId: 'L2', maxUses: 1, uses: 0, status: 'active', expiresAt: exp },
      { code: 'NS-COL-0001', targetType: 'column', targetId: 'col_1', maxUses: 1, uses: 0, status: 'active', expiresAt: exp },
    );
  }
  // 专栏集合为空时用默认种子填充（业务可直接改 data/db.json 的 columns，改空则回落到默认）
  if (db.columns.length === 0) {
    db.columns = JSON.parse(JSON.stringify(DEFAULT_COLUMNS));
    MONEY_SHADOW.writeBatch('columns', db.columns);
  }
  // SKU 库存台账：补齐代码里新增的规格（只补缺失，**不覆盖业务调过的库存与单价**）
  CAT.ensureSkuRecords(db);
}
function resetBiz(db) { for (const k of BIZ_KEYS) delete db[k]; }

// ───────────── 静态配置 ─────────────
const GRADES = [
  { code: 'K1', label: '幼儿园小班' }, { code: 'K2', label: '幼儿园中班' }, { code: 'K3', label: '幼儿园大班' },
  { code: 'G1', label: '一年级' }, { code: 'G2', label: '二年级' }, { code: 'G3', label: '三年级' },
  { code: 'G4', label: '四年级' }, { code: 'G5', label: '五年级' }, { code: 'G6', label: '六年级' },
  { code: 'G7', label: '初一' }, { code: 'G8', label: '初二' }, { code: 'G9', label: '初三' },
  { code: 'G10', label: '高一' }, { code: 'G11', label: '高二' }, { code: 'G12', label: '高三' },
];
const GENDERS = [{ code: 'male', label: '男孩' }, { code: 'female', label: '女孩' }];
const gradeLabel = (code) => (GRADES.find((g) => g.code === code) || {}).label || code;
const genderLabel = (code) => (GENDERS.find((g) => g.code === code) || {}).label || code;

const LEVELS = [
  {
    id: 'L1', name: '脑商启蒙', summary: '认识大脑与基础专注力，适合启蒙阶段的孩子。', covers: [],
    section: 'fs', sectionName: '粉丝会员板块', // 归属首页板块 + 解锁所需孩子会员等级
    chapters: [
      { id: 'L1-C1', title: '第一课 · 认识我们的大脑', type: 'article', content: nodes(heading('认识我们的大脑'), para('大脑是我们身体最神奇的器官，本课带你认识大脑的基本结构与功能。')) },
      { id: 'L1-C2', title: '第二课 · 专注力小训练', type: 'video', videoUrl: 'https://cdn.naoshang.example.com/video/L1-C2.mp4', posterUrl: 'https://cdn.naoshang.example.com/poster/L1-C2.jpg', content: nodes(heading('专注力小训练'), para('跟随视频完成 10 分钟专注力训练。')) },
      { id: 'L1-C3', title: '第三课 · 记忆小达人', type: 'article', content: nodes(heading('记忆小达人'), para('学习联想记忆法，让背书变得轻松。')) },
    ],
  },
  {
    id: 'L2', name: '脑商进阶', summary: '系统性训练记忆与逻辑思维。', covers: [],
    section: 'jy', sectionName: '1阶菁英会员板块',
    chapters: [
      { id: 'L2-C1', title: '第一课 · 逻辑推理入门', type: 'article', content: nodes(heading('逻辑推理入门'), para('从生活中的例子理解逻辑推理。')) },
      { id: 'L2-C2', title: '第二课 · 图像记忆法', type: 'video', videoUrl: 'https://cdn.naoshang.example.com/video/L2-C2.mp4', posterUrl: 'https://cdn.naoshang.example.com/poster/L2-C2.jpg', content: nodes(heading('图像记忆法'), para('把抽象信息转化为图像，记忆更牢固。')) },
      { id: 'L2-C3', title: '第三课 · 思维导图', type: 'article', content: nodes(heading('思维导图'), para('用思维导图整理知识结构。')) },
    ],
  },
  {
    id: 'L3', name: '脑商高手', summary: '高阶思维与学习效率管理。', covers: [],
    section: 'cj', sectionName: '1阶超级会员板块',
    chapters: [
      { id: 'L3-C1', title: '第一课 · 时间管理', type: 'article', content: nodes(heading('时间管理'), para('学会规划学习时间，提高效率。')) },
      { id: 'L3-C2', title: '第二课 · 快速阅读', type: 'video', videoUrl: 'https://cdn.naoshang.example.com/video/L3-C2.mp4', posterUrl: 'https://cdn.naoshang.example.com/poster/L3-C2.jpg', content: nodes(heading('快速阅读'), para('训练视幅与阅读节奏。')) },
      { id: 'L3-C3', title: '第三课 · 费曼学习法', type: 'article', content: nodes(heading('费曼学习法'), para('以教促学，检验真正理解。')) },
    ],
  },
  {
    id: 'L4', name: '脑商大师', summary: '综合能力与竞赛冲刺。', covers: [],
    section: 'xn', sectionName: '2阶行能会员板块',
    chapters: [
      { id: 'L4-C1', title: '第一课 · 综合思维训练', type: 'article', content: nodes(heading('综合思维训练'), para('多维度思考问题。')) },
      { id: 'L4-C2', title: '第二课 · 赛事冲刺', type: 'video', videoUrl: 'https://cdn.naoshang.example.com/video/L4-C2.mp4', posterUrl: 'https://cdn.naoshang.example.com/poster/L4-C2.jpg', content: nodes(heading('赛事冲刺'), para('针对脑力赛事的专项训练。')) },
    ],
  },
  {
    id: 'L5', name: '脑商宗师', summary: '全部板块融会贯通，冲刺羿烁荣耀。', covers: [],
    section: 'ys', sectionName: '3阶羿烁会员板块',
    chapters: [
      { id: 'L5-C1', title: '第一课 · 大师思维', type: 'article', content: nodes(heading('大师思维'), para('融会贯通各大板块的核心方法。')) },
      { id: 'L5-C2', title: '第二课 · 羿烁冲刺', type: 'video', videoUrl: 'https://cdn.naoshang.example.com/video/L5-C2.mp4', posterUrl: 'https://cdn.naoshang.example.com/poster/L5-C2.jpg', content: nodes(heading('羿烁冲刺'), para('完成最终挑战，加冕羿烁。')) },
    ],
  },
];
const levelOf = (id) => LEVELS.find((l) => l.id === id) || null;
const chapterOf = (cid) => { for (const l of LEVELS) { const c = l.chapters.find((x) => x.id === cid); if (c) return { level: l, chapter: c }; } return null; };
// 专栏课程目录：已外置为 db.columns（业务可编辑，见 src/columns.js），此处不再硬编码

/** 板块权益：孩子会员等级分 ≥ 板块要求分 即解锁该板块全部课程（逐级累积：YS 解锁全部板块） */
function sectionUnlocked(mm, level) {
  if (!mm || !level) return false;
  return IZ.memberTierScore(mm.memberLevel || 'normal') >= IZ.memberTierScore(level.section);
}
/** 等级是否可学：板块权益达标，或历史 level 激活码已单开（兼容旧激活码） */
function levelAccessible(mm, level) {
  return sectionUnlocked(mm, level) || !!(mm && level && mm.unlockedLevels.includes(level.id));
}

const ANNOUNCEMENTS = [
  { id: 'ann_1', title: '平台上线公告', summary: '脑商AI合伙人平台正式上线。', publishedAt: '2026-10-20T10:00:00+08:00', content: nodes(para('脑商AI合伙人平台今日正式上线，欢迎各位合伙人体验。')) },
  { id: 'ann_2', title: '全球奖发放规则说明', summary: '全球奖按团队 VIP 业绩权重计算。', publishedAt: '2026-10-22T09:00:00+08:00', content: nodes(para('全球奖业绩权重以团队 VIP 名额为准，详细规则见收益页面。')) },
  { id: 'ann_3', title: '合店权益升级', summary: '合店老板权益全新升级。', publishedAt: '2026-10-24T08:00:00+08:00', content: nodes(para('合店老板分红与门店服务费规则已优化，详见合店页面。')) },
];

const AGREEMENTS = {
  user: { title: '用户服务协议', version: 'v1.0', content: nodes(heading('用户服务协议'), para('欢迎使用脑商AI合伙人平台。使用本平台即表示您同意以下条款：'), para('1. 您应如实填写注册信息并妥善保管账号；'), para('2. 平台收益规则以平台公示为准，如有调整将提前公告；'), para('3. 禁止通过任何手段作弊、刷单，违规者平台有权冻结账号与收益。')) },
  privacy: { title: '隐私政策', version: 'v1.0', content: nodes(heading('隐私政策'), para('我们重视您的隐私：'), para('1. 仅收集业务所必需的手机号、订单与收益信息；'), para('2. 银行卡信息仅用于提现登记，不会完整回传；'), para('3. 未经您同意，不会向第三方披露您的个人信息。')) },
};

const MATERIAL_CATEGORIES = {
  image: [{ id: 'img-poster', name: '宣传海报' }, { id: 'img-qr', name: '二维码图' }],
  article: [{ id: 'art-notice', name: '平台公告' }, { id: 'art-course', name: '课程介绍' }],
  video: [{ id: 'vid-intro', name: '平台介绍' }, { id: 'vid-course', name: '课程视频' }],
};
const MATERIALS = [
  { id: 'mat_1', title: '脑商合伙人招募海报', type: 'image', categoryId: 'img-poster', coverUrl: 'https://cdn.naoshang.example.com/mat/1.jpg', content: nodes(para('扫码加入脑商合伙人')), mediaUrl: null, shareUrl: 'https://h5.naoshang.example.com/m/1', templateId: 'tpl_poster_v1', allowedOperations: ['render'] },
  { id: 'mat_2', title: '平台介绍长图', type: 'image', categoryId: 'img-poster', coverUrl: 'https://cdn.naoshang.example.com/mat/2.jpg', content: nodes(para('一张图看懂脑商')), mediaUrl: null, shareUrl: 'https://h5.naoshang.example.com/m/2', templateId: 'tpl_poster_v2', allowedOperations: ['render'] },
  { id: 'mat_3', title: '产品介绍文章', type: 'article', categoryId: 'art-course', coverUrl: null, content: nodes(heading('产品介绍'), para('脑商AI课程体系介绍……')), mediaUrl: null, shareUrl: 'https://h5.naoshang.example.com/m/3', templateId: null, allowedOperations: [] },
  { id: 'mat_4', title: '平台宣传视频', type: 'video', categoryId: 'vid-intro', coverUrl: 'https://cdn.naoshang.example.com/mat/4.jpg', content: nodes(para('平台宣传视频')), mediaUrl: 'https://cdn.naoshang.example.com/video/mat4.mp4', shareUrl: 'https://h5.naoshang.example.com/m/4', templateId: null, allowedOperations: [] },
];

const ASSET_RULES = {
  'avatar': { mimes: ['image/png', 'image/jpeg'], maxSize: 5 * 1024 * 1024, label: '头像' },
  'member-avatar': { mimes: ['image/png', 'image/jpeg'], maxSize: 5 * 1024 * 1024, label: '会员头像' },
  'feedback': { mimes: ['image/png', 'image/jpeg'], maxSize: 10 * 1024 * 1024, label: '反馈图片' },
  'storefront': { mimes: ['image/png', 'image/jpeg'], maxSize: 10 * 1024 * 1024, label: '门头照' },
  'material-qr': { mimes: ['image/png', 'image/jpeg'], maxSize: 5 * 1024 * 1024, label: '素材二维码' },
  'training-file': { mimes: ['application/pdf', 'video/mp4'], maxSize: 30 * 1024 * 1024, label: '训练附件' },
  'training-video': { mimes: ['video/mp4'], maxSize: 30 * 1024 * 1024, label: '训练视频' },
};

// 提现规则（契约第 15 节待业务确认项，本版先按此执行，调整只需改此处）
const WITHDRAW = { min: 100, max: 50000, feeRate: 0.006, feeMin: 1, arriveNote: '审核通过后 T+1 到账' };

const AGENCY_TYPE_MAP = { store: 'STORE', district: 'COUNTY', city: 'CITY', province: 'PROVINCE' };
const AGENCY_TYPE_CN = { STORE: '单店代理', COUNTY: '区县代理', CITY: '城市代理', PROVINCE: '省代' };
const REGION_TYPE_OF = { STORE: 'store', COUNTY: 'district', CITY: 'city', PROVINCE: 'province' };

// ───────────── 小工具 ─────────────
function flatDownline(tree, acc = []) {
  if (!tree) return acc;
  for (const n of (tree.children || [])) { acc.push(n); flatDownline(n, acc); }
  return acc;
}
function findCoachByLogin(db, loginAccount) {
  ensure(db);
  return db.coaches.find((c) => c.loginAccount === loginAccount) || null;
}
/** 记录一条申请（h5.js §12 创建合店/代理申请时调用） */
function recordApplication(db, app) {
  ensure(db);
  const rec = {
    id: app.id || rid('app'), type: app.type || 'COSTORE', title: app.title || '申请',
    applicationStatus: app.applicationStatus || 'PENDING_REVIEW',
    paymentStatus: 'NOT_STARTED', contractStatus: 'NOT_SIGNED', entitlementStatus: 'NOT_OPEN',
    userId: app.userId || null, storeId: app.storeId || null, storeAgentId: app.storeAgentId || null,
    agencyType: app.agencyType || null, payableAmount: app.payableAmount || 0,
    store: app.store || null, idempotencyKey: app.idempotencyKey || null,
    // P1-6：代理申请的费用明细拆解 / 门头照 / 协议勾选记录（可空）
    feeBreakdown: app.feeBreakdown || null,
    uploads: Array.isArray(app.uploads) ? app.uploads : [],
    agreements: Array.isArray(app.agreements) ? app.agreements : [],
    createdAt: app.createdAt || new Date(nowMs()).toISOString(), version: 1,
  };
  db.applications.push(rec);
  return rec;
}
/** 当前操作者 userId（user=本人；admin 需 contextId 指定，query 或 body 均可） */
async function ownerUserId(db, ctx) {
  const { sess, q, fail, resolveContext } = ctx;
  if (sess.role === 'user') return sess.userId;
  if (sess.role === 'admin') {
    const b = await ctx.readBodyOnce();
    const { userId } = resolveContext(b.contextId || q('contextId') || '');
    if (userId && db.users[userId]) return userId;
    fail(400, 'admin 调用需传有效 contextId（如 partner:p1）');
    return null;
  }
  fail(403, '当前身份不支持该接口（健脑官请使用 /coach/workspace）');
  return null;
}
/** 代理身份 userId（contextId=agency:xxx，query 或 body 均可） */
async function agencyUserId(db, ctx) {
  const { sess, q, fail, resolveContext } = ctx;
  const isAgent = (id) => db.regionalAgents.some((a) => a.partner_id === id) || db.coStores.some((c) => c.owner_id === id);
  if (sess.role === 'admin') {
    const b = await ctx.readBodyOnce();
    const { userId } = resolveContext(b.contextId || q('contextId') || '');
    if (userId && isAgent(userId)) return userId;
    fail(400, 'admin 调用需传有效代理 contextId（如 agency:p6）');
    return null;
  }
  if (sess.role === 'user') {
    if (isAgent(sess.userId)) return sess.userId;
    fail(403, '当前账号无区域代理/合店身份');
    return null;
  }
  fail(403, '当前身份不支持该接口');
  return null;
}
function storeById(db, id) {
  // id 可能是：用户 id / 门店区域码 / **代理任命记录 id**（前端 context.assignmentId）
  const ag = db.regionalAgents.find((a) => a.partner_id === id && a.region_type === 'store')
    || db.regionalAgents.find((a) => a.region_code === id && a.region_type === 'store')
    || db.regionalAgents.find((a) => a.id === id && a.region_type === 'store');
  if (ag) return { kind: 'agent', id: ag.partner_id, regionCode: ag.region_code, name: ag.store_name || `脑商线下店 ${ag.region_code}`, address: ag.store_address || '', contact: ag.store_contact || '' };
  const cs = db.coStores.find((c) => c.store_id === id || c.owner_id === id);
  if (cs) return { kind: 'costore', id: cs.owner_id, regionCode: cs.store_id, name: `合店 ${cs.store_id}`, address: '', contact: '' };
  return null;
}
function memberOf(db, id) { ensure(db); return db.members.find((m) => m.id === id) || null; }
function canManageMember(db, ctx, m) {
  if (!m) return false;
  if (ctx.sess.role === 'admin') return true;
  if (ctx.sess.role === 'user' && m.userId === ctx.sess.userId) return true;
  if (ctx.sess.role === 'coach' && m.storeId && m.storeId === ctx.sess.storeId) return true;
  return false;
}
/** 转店场景：发起方可以是家长本人、总部，或任一代理/合店身份（会员在其门店受训） */
function canTransferMember(db, ctx, m) {
  if (!m) return false;
  if (ctx.sess.role === 'admin') return true;
  if (ctx.sess.role === 'user' && m.userId === ctx.sess.userId) return true;
  if (ctx.sess.role === 'user' && (db.regionalAgents.some((a) => a.partner_id === ctx.sess.userId) || db.coStores.some((c) => c.owner_id === ctx.sess.userId))) return true;
  return false;
}
function walletAvailable(db, userId) {
  const settled = db.commissions.filter((c) => c.owner_id === userId).reduce((s, c) => s + (c.amount || 0), 0);
  const held = db.withdrawals.filter((w) => w.userId === userId && ['PENDING_REVIEW', 'APPROVED', 'PAID'].includes(w.status)).reduce((s, w) => s + (w.amount || 0), 0);
  return round2(settled - held);
}
function couponsOf(db, userId) {
  ensure(db);
  if (!db.coupons.some((c) => c.userId === userId)) {
    const base = nowMs();
    db.coupons.push(
      { id: rid('cpn'), userId, title: '新人专享券', discountAmount: 50, thresholdText: '满 500 元可用', scopeLabel: '全场通用', status: 'available', expiresAt: base + 30 * DAY },
      { id: rid('cpn'), userId, title: '学习课程券', discountAmount: 100, thresholdText: '满 1000 元可用', scopeLabel: '课程类商品', status: 'available', expiresAt: base + 60 * DAY },
      { id: rid('cpn'), userId, title: '商城满减券', discountAmount: 30, thresholdText: '满 300 元可用', scopeLabel: '甄选商品', status: 'used', expiresAt: base + 30 * DAY },
      { id: rid('cpn'), userId, title: '已过期券', discountAmount: 20, thresholdText: '满 200 元可用', scopeLabel: '全场通用', status: 'void', expiresAt: base - DAY },
    );
  }
  return db.coupons.filter((c) => c.userId === userId);
}
function listAddresses(db, userId) { ensure(db); return db.addresses.filter((a) => a.userId === userId); }
function listCoupons(db, userId, status) { return couponsOf(db, userId).filter((c) => !status || c.status === status); }

/**
 * 统一入口。返回 true = 已处理；false = 不归本层（交回 h5.js 后续逻辑）。
 */
async function handle(db, req, res, url, ctx) {
  ensure(db);
  const { sess, ok, fail, save, q, readBody, resolveContext } = ctx;
  const p = url.pathname;
  const m = req.method;
  // body 缓存读取：同一请求只读一次（流不可重复消费；ownerUserId 与各处理器共用）
  let _body = null, _bodyRead = false;
  const readBodyOnce = async () => {
    if (!_bodyRead) { _bodyRead = true; try { _body = await readBody(req); } catch (e) { _body = {}; } }
    return _body || {};
  };
  ctx.readBodyOnce = readBodyOnce;
  const seg = (prefix) => (p.startsWith(prefix + '/') ? p.slice(prefix.length + 1) : null);

  // ═══════════════════ §4 个人中心 / 地址 / 优惠券 / 客服 / 协议 ═══════════════════
  if (p === '/me' && m === 'GET') {
    const uid = await ownerUserId(db, ctx); if (uid === null) return true;
    const u = db.users[uid]; if (!u) return fail(404, '用户不存在');
    const orders = db.orders.filter((o) => o.buyer_id === uid);
    const ag = db.regionalAgents.find((a) => a.partner_id === uid);
    const cs = db.coStores.find((c) => c.owner_id === uid || (c.owners || []).some((o) => o.id === uid));
    let store = null;
    if (ag && ag.region_type === 'store') store = { id: ag.region_code, name: ag.store_name || `脑商线下店 ${ag.region_code}`, address: ag.store_address || '', contact: ag.store_contact || '' };
    else if (cs) store = { id: cs.store_id, name: `合店 ${cs.store_id}`, address: '', contact: '' };
    const idKeys = R.getIdentities(db, uid).identities.map((i) => i.key);
    return ok(200, {
      profile: { id: uid, nickname: u.name, avatarUrl: u.avatarUrl || null, phone: u.phone, regionCodes: u.regionCodes || [], regionNames: u.regionNames || [], version: u.profileVersion || 1 },
      store, orderCounts: {
        pendingPayment: orders.filter((o) => ['UNPAID', 'PENDING', 'PENDING_PAYMENT'].includes(o.status)).length,
        waitingShipment: orders.filter((o) => (o.status === 'PAID' || !o.status) && (!o.fulfillmentStatus || o.fulfillmentStatus === 'PENDING')).length,
        waitingReceipt: orders.filter((o) => o.fulfillmentStatus === 'SHIPPED').length,
        completed: orders.filter((o) => o.status === 'COMPLETED').length,
      },
      support: { phone: '400-800-1234', description: '工作日 9:00-18:00' },
      exclusiveAccess: { accountId: uid, contextId: `partner:${uid}`, capabilities: idKeys },
    });
  }
  if (p === '/me' && m === 'PATCH') {
    const uid = await ownerUserId(db, ctx); if (uid === null) return true;
    const b = await readBodyOnce();
    const u = db.users[uid]; if (!u) return fail(404, '用户不存在');
    const cur = u.profileVersion || 1;
    if (b.version == null || Number(b.version) !== cur) return fail(409, `version 不匹配（当前 ${cur}）`);
    if (b.nickname != null) {
      const nk = String(b.nickname).trim();
      if (nk.length < 1 || nk.length > 24) return fail(400, '昵称需 1–24 字');
      u.name = nk;
    }
    if (b.regionCodes != null) {
      const rcs = Array.isArray(b.regionCodes) ? b.regionCodes : [];
      if (rcs.length && rcs.length !== 3) return fail(400, '地区须为三级编码');
      u.regionCodes = rcs; u.regionNames = Array.isArray(b.regionNames) ? b.regionNames : [];
    }
    if (b.avatarAssetId != null) {
      const ast = db.assets.find((a) => a.id === b.avatarAssetId);
      if (!ast || ast.userId !== uid) return fail(400, '头像资源不存在或不属于当前账号');
      if (ast.status !== 'READY') return fail(400, '头像资源未就绪');
      u.avatarUrl = ast.previewUrl || null;
    }
    u.profileVersion = cur + 1; save();
    return ok(200, { profile: { id: uid, nickname: u.name, avatarUrl: u.avatarUrl || null, phone: u.phone, regionCodes: u.regionCodes || [], regionNames: u.regionNames || [], version: u.profileVersion } });
  }
  if (p === '/addresses' && m === 'GET') {
    const uid = await ownerUserId(db, ctx); if (uid === null) return true;
    return ok(200, { items: listAddresses(db, uid).map(publicAddress), hasMore: false, nextCursor: null });
  }
  if (p === '/addresses' && m === 'POST') {
    const uid = await ownerUserId(db, ctx); if (uid === null) return true;
    const b = await readBodyOnce();
    const v = validateAddress(b, false); if (v) return fail(400, v);
    const list = listAddresses(db, uid);
    const first = list.length === 0;
    const rec = { id: rid('adr'), userId: uid, recipient: b.recipient.trim(), phone: b.phone.trim(), regionCodes: b.regionCodes, regionNames: b.regionNames || [], detail: b.detail.trim(), isDefault: b.isDefault === true || first, version: 1, createdAt: nowMs() };
    if (rec.isDefault) list.forEach((a) => (a.isDefault = false));
    db.addresses.push(rec); save();
    return ok(200, { address: publicAddress(rec) });
  }
  if (p.startsWith('/addresses/') && m === 'GET') {
    const uid = await ownerUserId(db, ctx); if (uid === null) return true;
    const a = listAddresses(db, uid).find((x) => x.id === p.slice('/addresses/'.length));
    if (!a) return fail(404, '地址不存在');
    return ok(200, { address: publicAddress(a) });
  }
  if (p.startsWith('/addresses/') && m === 'PATCH') {
    const uid = await ownerUserId(db, ctx); if (uid === null) return true;
    const a = listAddresses(db, uid).find((x) => x.id === p.slice('/addresses/'.length));
    if (!a) return fail(404, '地址不存在');
    const b = await readBodyOnce();
    if (b.version == null || Number(b.version) !== a.version) return fail(409, `version 不匹配（当前 ${a.version}）`);
    const v = validateAddress(b, true); if (v) return fail(400, v);
    if (b.recipient != null) a.recipient = b.recipient.trim();
    if (b.phone != null) a.phone = b.phone.trim();
    if (b.regionCodes != null) a.regionCodes = b.regionCodes;
    if (b.regionNames != null) a.regionNames = b.regionNames;
    if (b.detail != null) a.detail = b.detail.trim();
    if (b.isDefault === true) { listAddresses(db, uid).forEach((x) => (x.isDefault = false)); a.isDefault = true; }
    else if (b.isDefault === false) a.isDefault = false;
    a.version += 1; save();
    return ok(200, { address: publicAddress(a) });
  }
  if (p === '/addresses/default' && m === 'PUT') {
    const uid = await ownerUserId(db, ctx); if (uid === null) return true;
    const b = await readBodyOnce();
    const a = listAddresses(db, uid).find((x) => x.id === b.addressId);
    if (!a) return fail(404, '地址不存在');
    if (b.version == null) return fail(400, 'version 必填');
    listAddresses(db, uid).forEach((x) => (x.isDefault = x.id === a.id));
    save();
    return ok(200, { defaultAddressId: a.id });
  }
  if (p.startsWith('/addresses/') && m === 'DELETE') {
    const uid = await ownerUserId(db, ctx); if (uid === null) return true;
    const id = p.slice('/addresses/'.length);
    const idx = db.addresses.findIndex((x) => x.id === id && x.userId === uid);
    if (idx < 0) return fail(404, '地址不存在');
    const b = await readBodyOnce();
    if (b.version == null || Number(b.version) !== db.addresses[idx].version) return fail(409, 'version 不匹配');
    const wasDefault = db.addresses[idx].isDefault;
    db.addresses.splice(idx, 1);
    if (wasDefault) { const rest = listAddresses(db, uid); if (rest.length) rest[0].isDefault = true; }
    save();
    return ok(200, { success: true });
  }
  if (p === '/coupons' && m === 'GET') {
    const uid = await ownerUserId(db, ctx); if (uid === null) return true;
    const status = q('status');
    if (!['available', 'used', 'void'].includes(status || '')) return fail(400, 'status 必填且为 available/used/void');
    return ok(200, { items: listCoupons(db, uid, status), hasMore: false, nextCursor: null });
  }
  if (p === '/support/config' && m === 'GET') {
    return ok(200, { phone: '400-800-1234', description: '工作日 9:00-18:00', feedback: { maxImages: 3 } });
  }
  if (p === '/support/feedback' && m === 'POST') {
    const uid = await ownerUserId(db, ctx); if (uid === null) return true;
    const b = await readBodyOnce();
    if (!b.content || !b.idempotencyKey) return fail(400, 'content 与 idempotencyKey 必填');
    const content = String(b.content).trim();
    if (content.length < 1 || content.length > 500) return fail(400, '内容需 1–500 字');
    const imgs = Array.isArray(b.imageAssetIds) ? b.imageAssetIds : [];
    if (imgs.length > 3) return fail(400, '最多 3 张图片');
    const idem = IDEM.check({ list: db.supportFeedback, key: b.idempotencyKey, payload: { content, imageAssetIds: imgs } });
    if (idem.conflict) return fail(409, idem.conflictReason);
    if (idem.duplicated) return ok(200, { feedbackId: idem.record.id });
    for (const aid of imgs) { const ast = db.assets.find((a) => a.id === aid); if (!ast || ast.userId !== uid) return fail(400, `图片资源 ${aid} 不存在或不属于当前账号`); }
    const rec = IDEM.stamp({ id: rid('fbk'), userId: uid, content, imageAssetIds: imgs, createdAt: nowMs(), idempotencyKey: b.idempotencyKey }, { content, imageAssetIds: imgs });
    db.supportFeedback.push(rec); save();
    return ok(200, { feedbackId: rec.id });
  }
  if (p.startsWith('/agreements/') && m === 'GET') {
    const type = p.slice('/agreements/'.length);
    const ag = AGREEMENTS[type];
    if (!ag) return fail(404, '协议不存在（支持 user/privacy）');
    return ok(200, { title: ag.title, version: ag.version, content: ag.content });
  }

  // ═══════════════════ §5 家庭会员与激活 ═══════════════════
  if (p === '/members/options' && m === 'GET') return ok(200, { grades: GRADES, genders: GENDERS });
  if (p === '/members' && m === 'GET') {
    const uid = await ownerUserId(db, ctx); if (uid === null) return true;
    if ((q('scope') || 'family') !== 'family') return fail(400, 'scope 仅支持 family');
    const items = db.members.filter((mm) => mm.userId === uid).map(publicMember);
    return ok(200, { items, hasMore: false, nextCursor: null });
  }
  if (p === '/members' && m === 'POST') {
    const uid = await ownerUserId(db, ctx); if (uid === null) return true;
    const b = await readBodyOnce();
    if (!b.name || !b.gradeCode || !b.genderCode) return fail(400, 'name、gradeCode、genderCode 必填');
    if (!b.idempotencyKey) return fail(400, 'idempotencyKey 必填');
    const idem = IDEM.check({ list: db.members, key: b.idempotencyKey, payload: { name: String(b.name).trim(), gradeCode: b.gradeCode, genderCode: b.genderCode, avatarAssetId: b.avatarAssetId || null } });
    if (idem.conflict) return fail(409, idem.conflictReason);
    if (idem.duplicated) return ok(200, { member: publicMember(idem.record) });
    const name = String(b.name).trim();
    if (name.length < 1 || name.length > 24) return fail(400, '姓名需 1–24 字');
    if (!GRADES.some((g) => g.code === b.gradeCode)) return fail(400, 'gradeCode 非法');
    if (!GENDERS.some((g) => g.code === b.genderCode)) return fail(400, 'genderCode 非法');
    if (b.avatarAssetId != null) {
      const ast = db.assets.find((a) => a.id === b.avatarAssetId);
      if (!ast || ast.userId !== uid || ast.status !== 'READY') return fail(400, '头像资源不可用');
    }
    const rec = IDEM.stamp({
      id: rid('m'), userId: uid, name, gradeCode: b.gradeCode, gradeLabel: gradeLabel(b.gradeCode),
      genderCode: b.genderCode, genderLabel: genderLabel(b.genderCode),
      avatarAssetId: b.avatarAssetId || null, avatarUrl: b.avatarAssetId ? (db.assets.find((a) => a.id === b.avatarAssetId) || {}).previewUrl || null : null,
      storeId: null, activated: false, unlockedLevels: [], unlockedColumns: [], version: 1, idempotencyKey: b.idempotencyKey, createdAt: nowMs(),
      __idemPayload: { name: String(b.name).trim(), gradeCode: b.gradeCode, genderCode: b.genderCode, avatarAssetId: b.avatarAssetId || null },
      // 孩子身份编号（2026-10-24 截图规则）：默认普通会员（游客）；序号=第几个添加；升级只变前缀
      memberLevel: 'normal', memberSeq: null, display_id: null,
      training: { trainingTotal: 0, trainingUsed: 0, specialTotal: 0, specialUsed: 0, selfStudyNote: '', campNote: '', remark: '' },
    });
    db.members.push(rec);
    IZ.assignMemberSeq(db, rec.id);
    IZ.recomputeMemberDisplayId(db, rec.id);
    IZ.recomputeDisplayId(db, uid); // 家长编号随孩子最高等级派生（普通孩子不改变，保持调用一致）
    save();
    return ok(200, { member: publicMember(rec) });
  }
  // 注意：/members/{id} 的子路径处理（orders/training-feedback/store-profile/training/levels/learning-progress）
  // 必须位于下方通用 PATCH /members/{id} 之前，否则会被父路径规则抢先匹配。
  if (p === '/activations/preview' && m === 'POST') {
    const b = await readBodyOnce();
    if (!b.code || !b.memberId) return fail(400, 'code 与 memberId 必填');
    const mm = memberOf(db, b.memberId);
    if (!mm || !canManageMember(db, ctx, mm)) return fail(404, '会员不存在');
    const rec = db.activationCodes.find((c) => c.code === String(b.code).trim().toUpperCase());
    if (!rec) return fail(404, '激活码不存在');
    if (rec.issuedTo && ctx.sess.role === 'user' && rec.issuedTo !== ctx.sess.userId) return fail(403, '该激活码已绑定指定家长，仅本人可使用');
    if (rec.status !== 'active') return fail(400, '激活码已停用');
    if (rec.expiresAt && rec.expiresAt < nowMs()) return fail(400, '激活码已过期');
    const memLevel = IZ.MEMBER_ACTIVATION_TYPES[rec.targetType] || null; // 会员等级类激活码
    if (rec.uses >= rec.maxUses) {
      // 预览不消耗码：次数用尽时返回已消耗状态供前端展示（契约 §5），而非报错
      const lv2 = rec.targetType === 'level' ? levelOf(rec.targetId) : null;
      return ok(200, {
        code: rec.code, memberId: mm.id, targetType: rec.targetType, targetId: rec.targetId || null,
        levelId: lv2 ? lv2.id : undefined, levelName: lv2 ? lv2.name : undefined,
        memberLevel: memLevel || undefined, memberLevelName: memLevel ? IZ.memberTierName(memLevel) : undefined,
        alreadyActivated: rec.targetType === 'level' ? mm.unlockedLevels.includes(rec.targetId)
          : memLevel ? IZ.memberTierScore(mm.memberLevel || 'normal') >= IZ.memberTierScore(memLevel) : !!mm.activated,
        consumed: true, validUntil: rec.expiresAt ? new Date(rec.expiresAt).toISOString() : null,
        maxUses: rec.maxUses, remainingUses: 0,
      });
    }
    const targetType = rec.targetType;
    const targetId = rec.targetId || null;
    const lv = targetType === 'level' ? levelOf(targetId) : null;
    return ok(200, {
      code: rec.code, memberId: mm.id, targetType, targetId,
      levelId: lv ? lv.id : undefined, levelName: lv ? lv.name : undefined,
      memberLevel: memLevel || undefined, memberLevelName: memLevel ? IZ.memberTierName(memLevel) : undefined,
      alreadyActivated: targetType === 'level' ? mm.unlockedLevels.includes(targetId)
        : memLevel ? IZ.memberTierScore(mm.memberLevel || 'normal') >= IZ.memberTierScore(memLevel) : !!mm.activated,
      validUntil: rec.expiresAt ? new Date(rec.expiresAt).toISOString() : null,
      maxUses: rec.maxUses, remainingUses: rec.maxUses - rec.uses,
    });
  }
  if (p === '/activations' && m === 'POST') {
    const b = await readBodyOnce();
    if (!b.code || !b.targetType) return fail(400, 'code、targetType 必填');
    if (!b.idempotencyKey) return fail(400, 'idempotencyKey 必填');
    const memLevel = IZ.MEMBER_ACTIVATION_TYPES[b.targetType] || null; // 会员等级类激活码（fs/jy/cj/xn/ys，兼容旧 member=fs）
    if (!b.targetId && !memLevel) return fail(400, 'level/column 类激活码必须传 targetId');
    const mm = memberOf(db, b.memberId || '');
    if ((b.targetType === 'level' || memLevel) && (!mm || !canManageMember(db, ctx, mm))) return fail(404, '会员不存在');
    const rec = db.activationCodes.find((c) => c.code === String(b.code).trim().toUpperCase());
    if (!rec) return fail(404, '激活码不存在');
    if (rec.issuedTo && ctx.sess.role === 'user' && rec.issuedTo !== ctx.sess.userId) return fail(403, '该激活码已绑定指定家长，仅本人可使用');
    if (rec.status !== 'active') return fail(400, '激活码已停用');
    if (rec.expiresAt && rec.expiresAt < nowMs()) return fail(400, '激活码已过期');
    if (rec.uses >= rec.maxUses) return fail(400, '激活码使用次数已用完');
    if (rec.targetType !== b.targetType || (rec.targetId && rec.targetId !== b.targetId)) return fail(400, '激活码与提交的目标不一致');
    if (b.targetType === 'level' && mm.unlockedLevels.includes(b.targetId)) return ok(200, { unlocked: true, memberId: mm.id, targetType: b.targetType, targetId: b.targetId, duplicate: true });
    rec.uses += 1; rec.usedBy = rec.usedBy || []; rec.usedBy.push({ memberId: b.memberId || null, at: nowMs(), channel: rec.channel || null, issuedBy: rec.issuedBy || null });
    if (b.targetType === 'level') { if (!mm.unlockedLevels.includes(b.targetId)) mm.unlockedLevels.push(b.targetId); }
    else if (memLevel) {
      // 会员等级激活（截图规则）：家长档位门槛（CJ←VIP合伙人；XN/YS←天使合伙人）+ 只升不降
      const parent = db.users[mm.userId];
      if (!parent) return fail(404, '家长账号不存在');
      if (!IZ.memberTierAllowedForParent(memLevel, parent.tier)) {
        rec.uses -= 1; // 档位不符不消耗激活码
        const needName = IZ.MEMBER_TIER_MIN_TIER_SCORE[memLevel] >= 2 ? '天使合伙人' : 'VIP合伙人';
        return fail(403, `激活${IZ.memberTierName(memLevel)}需家长为${needName}（当前档位不符）`);
      }
      if (IZ.memberTierScore(mm.memberLevel || 'normal') >= IZ.memberTierScore(memLevel)) {
        rec.uses -= 1; // 已达更高等级不消耗
        return ok(200, { unlocked: true, memberId: mm.id, targetType: b.targetType, targetId: b.targetId, duplicate: true });
      }
      IZ.applyMemberLevel(db, mm.id, memLevel); // 重算孩子编号（只变前缀）+ 家长编号（取高上浮）
    }
    else if (b.targetType === 'column') {
      // 专栏权益发放到账号（memberId 缺省时）或指定孩子
      const holder = mm || (ctx.sess.role === 'user' ? db.users[ctx.sess.userId] : null);
      if (holder) { holder.unlockedColumns = holder.unlockedColumns || []; if (!holder.unlockedColumns.includes(b.targetId)) holder.unlockedColumns.push(b.targetId); }
    }
    save();
    return ok(200, { unlocked: true, memberId: b.memberId || null, targetType: b.targetType, targetId: b.targetId });
  }
  if (p.startsWith('/members/') && p.endsWith('/orders') && m === 'GET') {
    const id = p.slice('/members/'.length, -'/orders'.length);
    const mm = memberOf(db, id);
    if (!mm || !canManageMember(db, ctx, mm)) return fail(404, '会员不存在');
    const items = db.orders.filter((o) => o.buyer_id === id).map((o) => ({ ...o, buyer_name: mm.name, status: o.status || 'PAID' }));
    return ok(200, { items, hasMore: false, nextCursor: null });
  }
  if (p.startsWith('/members/') && p.endsWith('/training-feedback') && m === 'GET') {
    const id = p.slice('/members/'.length, -'/training-feedback'.length);
    const mm = memberOf(db, id);
    if (!mm || !canManageMember(db, ctx, mm)) return fail(404, '会员不存在');
    const kind = q('kind');
    if (kind && !['training', 'self-study', 'camp'].includes(kind)) return fail(400, 'kind 为 training/self-study/camp');
    const items = db.trainingFeedback.filter((f) => f.memberId === id && (!kind || f.kind === kind)).map((f) => publicFeedback(f, db));
    return ok(200, { items, hasMore: false, nextCursor: null, allowedActions: canManageMember(db, ctx, mm) ? ['create'] : [] });
  }
  if (p.startsWith('/members/') && p.endsWith('/store-profile') && m === 'GET') {
    const id = p.slice('/members/'.length, -'/store-profile'.length);
    const mm = memberOf(db, id);
    if (!mm || !canManageMember(db, ctx, mm)) return fail(404, '会员不存在');
    return ok(200, { member: publicMember(mm), allowedActions: ctx.sess.role === 'coach' || ctx.sess.role === 'admin' ? ['update-training', 'create-feedback'] : [] });
  }
  if (p.startsWith('/members/') && p.endsWith('/training') && m === 'PATCH') {
    const id = p.slice('/members/'.length, -'/training'.length);
    const mm = memberOf(db, id);
    if (!mm || !canManageMember(db, ctx, mm)) return fail(404, '会员不存在');
    const b = await readBodyOnce();
    if (b.version == null || Number(b.version) !== mm.version) return fail(409, `version 不匹配（当前 ${mm.version}）`);
    const t = mm.training;
    const pick = (v, cur) => (v === undefined ? cur : v);
    const nt = {
      trainingTotal: pick(b.trainingTotal, t.trainingTotal), trainingUsed: pick(b.trainingUsed, t.trainingUsed),
      specialTotal: pick(b.specialTotal, t.specialTotal), specialUsed: pick(b.specialUsed, t.specialUsed),
      selfStudyNote: pick(b.selfStudyNote, t.selfStudyNote), campNote: pick(b.campNote, t.campNote), remark: pick(b.remark, t.remark),
    };
    for (const k of ['trainingTotal', 'trainingUsed', 'specialTotal', 'specialUsed']) {
      const v = Number(nt[k]);
      if (!Number.isInteger(v) || v < 0 || v > 10000) return fail(400, `${k} 须为 0–10000 的整数`);
      nt[k] = v;
    }
    if (nt.trainingUsed > nt.trainingTotal || nt.specialUsed > nt.specialTotal) return fail(400, '已消耗课时不能超过总课时');
    for (const k of ['selfStudyNote', 'campNote', 'remark']) if (String(nt[k] || '').length > 500) return fail(400, `${k} 最多 500 字`);
    mm.training = nt; mm.version += 1; save();
    return ok(200, { member: publicMember(mm) });
  }
  if (p.startsWith('/members/') && p.endsWith('/levels') && m === 'GET') {
    const id = p.slice('/members/'.length, -'/levels'.length);
    const mm = memberOf(db, id);
    if (!mm || !canManageMember(db, ctx, mm)) return fail(404, '会员不存在');
    const levels = LEVELS.map((l) => {
      const unlocked = levelAccessible(mm, l);
      const done = l.chapters.filter((c) => progressOf(db, mm.id, l.id, c.id).completed).length;
      return {
        id: l.id, name: l.name, unlocked,
        section: l.section, sectionName: l.sectionName, requireMemberLevel: IZ.memberTierName(l.section),
        progress: unlocked ? { completed: done, total: l.chapters.length } : undefined,
      };
    });
    return ok(200, { levels, memberLevel: mm.memberLevel || 'normal', memberLevelName: IZ.memberTierName(mm.memberLevel || 'normal') });
  }
  if (p.startsWith('/members/') && p.endsWith('/learning-progress') && m === 'PUT') {
    const id = p.slice('/members/'.length, -'/learning-progress'.length);
    const mm = memberOf(db, id);
    if (!mm || !canManageMember(db, ctx, mm)) return fail(404, '会员不存在');
    const b = await readBodyOnce();
    if (!b.levelId || !b.chapterId) return fail(400, 'levelId 与 chapterId 必填');
    const lv = levelOf(b.levelId); if (!lv) return fail(404, '等级不存在');
    const ch = lv.chapters.find((c) => c.id === b.chapterId); if (!ch) return fail(404, '章节不存在');
    if (!levelAccessible(mm, lv)) return fail(403, '该等级尚未激活（需孩子会员等级达到 ' + IZ.memberTierName(lv.section) + '）');
    const pos = Math.max(0, Number(b.positionSeconds) || 0);
    const dur = Math.max(0, Number(b.durationSeconds) || 0);
    const completed = b.completed === true || (ch.type === 'video' && b.ended === true && dur > 0 && pos >= dur * 0.98);
    const rec = { memberId: mm.id, levelId: lv.id, chapterId: ch.id, positionSeconds: pos, durationSeconds: dur, completed, updatedAt: nowMs() };
    const idx = db.learningProgress.findIndex((x) => x.memberId === mm.id && x.levelId === lv.id && x.chapterId === ch.id);
    if (idx >= 0) db.learningProgress[idx] = rec; else     db.learningProgress.push(rec);
    save();
    return ok(200, { positionSeconds: pos, durationSeconds: dur, completed });
  }
  // 专栏课程进度（账号级，无孩子维度；前端 learning.js 以 account-column 身份记录）
  if (p.startsWith('/columns/') && p.endsWith('/learning-progress') && m === 'PUT') {
    const id = p.slice('/columns/'.length, -'/learning-progress'.length);
    const col = columnById(db, id);
    if (!col) return fail(404, '专栏不存在');
    const uid = await ownerUserId(db, ctx); if (uid === null) return true;
    const b = await readBodyOnce();
    if (!b.chapterId) return fail(400, 'chapterId 必填');
    const ch = col.chapters.find((c) => c.id === b.chapterId); if (!ch) return fail(404, '章节不存在');
    const pos = Math.max(0, Number(b.positionSeconds) || 0);
    const dur = Math.max(0, Number(b.durationSeconds) || 0);
    const completed = b.completed === true || (ch.type === 'video' && b.ended === true && dur > 0 && pos >= dur * 0.98);
    const levelKey = 'column:' + col.id;
    const rec = { memberId: 'account-column', accountId: uid, levelId: levelKey, chapterId: ch.id, positionSeconds: pos, durationSeconds: dur, completed, updatedAt: nowMs() };
    const idx = db.learningProgress.findIndex((x) => x.memberId === 'account-column' && x.levelId === levelKey && x.chapterId === ch.id);
    if (idx >= 0) db.learningProgress[idx] = rec; else db.learningProgress.push(rec);
    save();
    return ok(200, { positionSeconds: pos, durationSeconds: dur, completed });
  }
  // 通用会员修改（置于全部 /members/{id}/ 子路径之后，避免抢先匹配）
  if (p.startsWith('/members/') && m === 'PATCH') {
    const id = p.slice('/members/'.length);
    const mm = memberOf(db, id);
    if (!mm || !canManageMember(db, ctx, mm)) return fail(404, '会员不存在');
    const b = await readBodyOnce();
    if (b.version == null || Number(b.version) !== mm.version) return fail(409, `version 不匹配（当前 ${mm.version}）`);
    if (b.name != null) { const nk = String(b.name).trim(); if (nk.length < 1 || nk.length > 24) return fail(400, '姓名需 1–24 字'); mm.name = nk; }
    if (b.gradeCode != null) { if (!GRADES.some((g) => g.code === b.gradeCode)) return fail(400, 'gradeCode 非法'); mm.gradeCode = b.gradeCode; mm.gradeLabel = gradeLabel(b.gradeCode); }
    if (b.genderCode != null) { if (!GENDERS.some((g) => g.code === b.genderCode)) return fail(400, 'genderCode 非法'); mm.genderCode = b.genderCode; mm.genderLabel = genderLabel(b.genderCode); }
    if (b.avatarAssetId != null) {
      const ast = db.assets.find((a) => a.id === b.avatarAssetId);
      if (!ast || ast.userId !== mm.userId || ast.status !== 'READY') return fail(400, '头像资源不可用');
      mm.avatarAssetId = b.avatarAssetId; mm.avatarUrl = ast.previewUrl || null;
    }
    mm.version += 1; save();
    return ok(200, { member: publicMember(mm) });
  }

  // ═══════════════════ §6 学习等级 / 公告 / 课程 ═══════════════════
  if (p === '/learning/levels' && m === 'GET') {
    const memberId = q('memberId');
    let mm = null;
    if (memberId) { mm = memberOf(db, memberId); if (!mm || !canManageMember(db, ctx, mm)) return fail(404, '会员不存在'); }
    return ok(200, {
      memberLevel: mm ? (mm.memberLevel || 'normal') : undefined,
      memberLevelName: mm ? IZ.memberTierName(mm.memberLevel || 'normal') : undefined,
      levels: LEVELS.map((l) => ({
        id: l.id, name: l.name, summary: l.summary,
        unlocked: mm ? levelAccessible(mm, l) : false,
        section: l.section, sectionName: l.sectionName, requireMemberLevel: IZ.memberTierName(l.section),
      })),
    });
  }
  if (p.startsWith('/learning/levels/') && m === 'GET') {
    const lv = levelOf(p.slice('/learning/levels/'.length));
    if (!lv) return fail(404, '等级不存在');
    const memberId = q('memberId');
    let mm = null;
    if (memberId) { mm = memberOf(db, memberId); if (!mm || !canManageMember(db, ctx, mm)) return fail(404, '会员不存在'); }
    const unlocked = mm ? levelAccessible(mm, lv) : false;
    return ok(200, {
      id: lv.id, name: lv.name, summary: lv.summary, covers: lv.covers, unlocked,
      section: lv.section, sectionName: lv.sectionName, requireMemberLevel: IZ.memberTierName(lv.section),
      content: unlocked || !mm ? nodes(heading(lv.name), para(lv.summary)) : null,
      chapters: lv.chapters.map((c) => ({
        id: c.id, title: c.title, type: c.type, accessible: unlocked,
        progress: mm ? progressOf(db, mm.id, lv.id, c.id) : { positionSeconds: 0, durationSeconds: 0, completed: false },
      })),
    });
  }
  if (p === '/announcements' && m === 'GET') {
    return ok(200, { items: ANNOUNCEMENTS.map(({ content, ...rest }) => rest), hasMore: false, nextCursor: null });
  }
  if (p.startsWith('/announcements/') && p.endsWith('/read') && m === 'PUT') {
    // 标记已读（2026-10-28 补齐）
    //   前端 learning.js 的 markAnnouncementRead() 在非 mock 模式下调 PUT /announcements/{id}/read，
    //   但后端此前**没有这条路由** → 打开公告详情页时必 404（前端 catch 后不显示，
    //   属于静默失败，很难被察觉）。
    const id = p.slice('/announcements/'.length, -'/read'.length);
    if (!ANNOUNCEMENTS.some((x) => x.id === id)) return fail(404, '公告不存在');
    const uid = sess && sess.userId ? sess.userId : null;
    if (!uid) return fail(401, '未登录');
    db.announcementReads = db.announcementReads || {};
    const mine = db.announcementReads[uid] = db.announcementReads[uid] || {};
    // 幂等：重复标记只更新首次时间
    if (!mine[id]) mine[id] = nowMs();
    save();
    return ok(200, { read: true, announcementId: id, readAt: mine[id] });
  }
  if (p.startsWith('/announcements/') && m === 'GET') {
    const a = ANNOUNCEMENTS.find((x) => x.id === p.slice('/announcements/'.length));
    if (!a) return fail(404, '公告不存在');
    return ok(200, { id: a.id, title: a.title, publishedAt: a.publishedAt, content: a.content });
  }
  if (p.startsWith('/lessons/') && m === 'GET') {
    const cid = p.slice('/lessons/'.length);
    // columnId 兼容两种传法：query（uni.request GET 会把 data 拼到 query）与 body
    const columnId = q('columnId') || (await readBodyOnce()).columnId;
    const found = columnId ? columnChapterOf(db, cid) : chapterOf(cid);
    if (!found) return fail(404, '课程不存在');
    const memberId = q('memberId');
    let mm = null;
    if (memberId) { mm = memberOf(db, memberId); if (!mm || !canManageMember(db, ctx, mm)) return fail(404, '会员不存在'); }
    if (columnId) {
      const { column, chapter } = found;
      const body = { id: chapter.id, title: chapter.title, type: chapter.type, locked: false, posterUrl: chapter.posterUrl || null, requireMemberLevel: null, columnId };
      body.content = chapter.content;
      body.videoUrl = chapter.videoUrl || null;
      if (mm) body.progress = progressOf(db, mm.id, 'column:' + column.id, chapter.id);
      return ok(200, body);
    }
    const { level, chapter } = found;
    const unlocked = mm ? levelAccessible(mm, level) : false;
    const body = { id: chapter.id, title: chapter.title, type: chapter.type, locked: !unlocked, posterUrl: chapter.posterUrl || null, requireMemberLevel: IZ.memberTierName(level.section) };
    if (unlocked) { body.content = chapter.content; body.videoUrl = chapter.videoUrl || null; body.progress = progressOf(db, mm.id, level.id, chapter.id); }
    return ok(200, body);
  }

  // ═══════════════════ §11 收益分配 / 钱包提现 ═══════════════════
  // ── P0-9 分配意愿（巡查 5% / 销售 5%） ──
  //   两块可自定义分配对象（本人 / 上级代理 / 合作代理 / 总部，比例自填合计 100%），默认规则与单笔指派权限在总部后台。
  if (/^\/income\/entries\/[^/]+\/allocation-options$/.test(p) && m === 'GET') {
    const id = p.split('/')[3];
    const uid = await ownerUserId(db, ctx); if (uid === null) return true;
    const entry = db.commissions.find((c) => c.id === id && (c.owner_id === uid));
    if (!entry) return fail(404, '收益不存在');
    const a = ALC.allocatable(db, entry);
    if (!a.ok) return fail(400, a.reason);
    const cands = ALC.candidates(db, entry);
    return ok(200, {
      entryId: id,
      bizType: a.kind, bizTypeLabel: a.scheme ? a.scheme.label : a.kind,
      allocationKind: ALC.publicKind(a.kind),
      allocationStatus: entry.allocationStatus || 'NONE',
      scheme: ALC.scheme(db),
      // 前端弹窗直接消费：fields[targetId].options 即原型那几项收益方
      fields: [{
        key: 'targetId',
        label: a.kind === 'sales' ? '销售方' : '巡查方',
        type: 'enum',
        options: cands.map((c) => ({
          value: c.value, label: c.label, name: c.name || '',
          needsId: !!c.needsId, available: c.available !== false,
          unavailableReason: c.unavailableReason || null,
        })),
      }],
      candidates: cands,
      balances: { available: walletAvailable(db, uid), entryAmount: entry.amount },
      allowedActions: ['quote', 'submit'], version: 1,
      note: '巡查 5% / 销售 5% 可自定义分配对象与比例，合计须 100%；「其他代理」需填写对应代理 ID',
    });
  }
  if (/^\/income\/entries\/[^/]+\/allocation-quotes$/.test(p) && m === 'POST') {
    const id = p.split('/')[3];
    const uid = await ownerUserId(db, ctx); if (uid === null) return true;
    const entry = db.commissions.find((c) => c.id === id && (c.owner_id === uid));
    if (!entry) return fail(404, '收益不存在');
    const b = await readBodyOnce();
    const targets = Array.isArray(b.targets) && b.targets.length
      ? b.targets
      : (b.targetId ? [{ targetId: b.targetId, percent: Number(b.percent) || 100, kind: b.allocationKind, agentId: b.agentId }] : []);
    const q2 = ALC.quote(db, entry, { targets, kind: b.allocationKind });
    if (!q2.valid) return ok(200, { valid: false, errors: q2.errors, entryId: id, entryAmount: q2.entryAmount, rows: q2.rows });
    // 报价单落库：前端提交时可只带 quoteId，服务端据此还原分配方案
    const quoteId = ALC.saveQuote(db, {
      entryId: id, userId: uid, kind: q2.kind, targets,
      entryAmount: q2.entryAmount, rows: q2.rows,
      totalPercent: q2.totalPercent, totalAmount: q2.totalAmount,
    });
    save();
    return ok(200, {
      valid: true, id: quoteId, quoteId, entryId: id,
      kind: ALC.publicKind(q2.kind), internalKind: q2.kind, kindLabel: q2.kindLabel,
      entryAmount: q2.entryAmount, rows: q2.rows, totalPercent: q2.totalPercent, totalAmount: q2.totalAmount,
      settlementNote: q2.settlementNote, expiresAt: nowMs() + ALC.QUOTE_TTL, serverTime: nowMs(),
    });
  }
  if (/^\/income\/entries\/[^/]+\/allocations$/.test(p) && m === 'POST') {
    const id = p.split('/')[3];
    const uid = await ownerUserId(db, ctx); if (uid === null) return true;
    const entry = db.commissions.find((c) => c.id === id && (c.owner_id === uid));
    if (!entry) return fail(404, '收益不存在');
    const b = await readBodyOnce();
    if (!b.idempotencyKey) return fail(400, 'idempotencyKey 必填');
    const targets = Array.isArray(b.targets) && b.targets.length
      ? b.targets
      : (b.targetId ? [{ targetId: b.targetId, percent: Number(b.percent) || 100, kind: b.allocationKind, agentId: b.agentId }] : []);
    try {
      const r = ALC.submit(db, entry, {
        targets, kind: b.allocationKind,
        quoteId: b.quoteId || null,          // 只带 quoteId 也能提交（前端主路径）
        idempotencyKey: b.idempotencyKey, operatorId: uid,
      });
      save();
      return ok(200, { status: r.status, allocationId: r.allocationId, operationId: rid('op'), rows: r.rows });
    } catch (e) { return fail(400, e.message); }
  }
  if (/^\/income\/entries\/[^/]+\/allocations\/[^/]+\/revoke$/.test(p) && m === 'POST') {
    const entryId = p.split('/')[3];
    const allocationId = p.split('/')[5];
    const uid = await ownerUserId(db, ctx); if (uid === null) return true;
    const entry = db.commissions.find((c) => c.id === entryId && (c.owner_id === uid));
    if (!entry) return fail(404, '收益不存在');
    try {
      const rec = ALC.revoke(db, allocationId, { operatorId: uid });
      save();
      return ok(200, { status: rec.status, allocationId: rec.id });
    } catch (e) { return fail(400, e.message); }
  }
  if (p === '/wallet/withdrawal-options' && m === 'GET') {
    const uid = await ownerUserId(db, ctx); if (uid === null) return true;
    const payees = db.payees.filter((x) => x.userId === uid).map(({ bankNumber, ...rest }) => rest);
    return ok(200, {
      balance: walletAvailable(db, uid), minAmount: WITHDRAW.min, maxAmount: WITHDRAW.max,
      feeRate: WITHDRAW.feeRate, feeMin: WITHDRAW.feeMin, feeNote: `手续费 ${(WITHDRAW.feeRate * 100).toFixed(1)}%（最低 ${WITHDRAW.feeMin} 元）`,
      arriveNote: WITHDRAW.arriveNote, accountTypes: ['PERSONAL', 'COMPANY'], payees,
      allowedActions: ['create-payee', 'quote', 'submit'],
    });
  }
  if (p === '/wallet/payees' && m === 'POST') {
    const uid = await ownerUserId(db, ctx); if (uid === null) return true;
    const b = await readBodyOnce();
    if (!b.accountType || !b.name || !b.bankName || !b.bankNumber) return fail(400, 'accountType、name、bankName、bankNumber 必填');
    if (!['PERSONAL', 'COMPANY'].includes(b.accountType)) return fail(400, 'accountType 为 PERSONAL/COMPANY');
    const num = String(b.bankNumber).replace(/\s/g, '');
    if (!/^\d{16,19}$/.test(num)) return fail(400, '银行卡号须为 16–19 位数字');
    const rec = { token: rid('payee'), userId: uid, accountType: b.accountType, name: String(b.name).trim(), bankName: String(b.bankName).trim(), bankNumber: num, maskedBankNumber: '****' + num.slice(-4), createdAt: nowMs() };
    db.payees.push(rec); save();
    const { bankNumber, ...pub } = rec;
    return ok(200, { payeeToken: rec.token, payee: pub });
  }
  if (p === '/wallet/withdrawal-quotes' && m === 'POST') {
    const uid = await ownerUserId(db, ctx); if (uid === null) return true;
    const b = await readBodyOnce();
    if (!b.accountType || !b.payeeToken || b.amount == null) return fail(400, 'accountType、payeeToken、amount 必填');
    const payee = db.payees.find((x) => x.token === b.payeeToken && x.userId === uid);
    if (!payee) return fail(404, '收款账户不存在');
    if (payee.accountType !== b.accountType) return fail(400, '账户类型与收款账户不一致');
    const amount = round2(Number(b.amount));
    if (!(amount >= WITHDRAW.min)) return fail(400, `单笔提现最低 ${WITHDRAW.min} 元`);
    if (amount > WITHDRAW.max) return fail(400, `单笔提现最高 ${WITHDRAW.max} 元`);
    const balance = walletAvailable(db, uid);
    if (amount > balance) return fail(400, `可提现余额不足（当前 ${balance} 元）`);
    const fee = Math.max(WITHDRAW.feeMin, round2(amount * WITHDRAW.feeRate));
    const netAmount = round2(amount - fee);
    return ok(200, {
      id: rid('quote'), accountType: b.accountType, payeeToken: b.payeeToken, amount, fee, netAmount,
      payee: { name: payee.name, bankName: payee.bankName, maskedBankNumber: payee.maskedBankNumber, accountType: payee.accountType },
      arriveNote: WITHDRAW.arriveNote, expiresAt: nowMs() + 600000, serverTime: nowMs(),
    });
  }
  if (p === '/wallet/withdrawals' && m === 'POST') {
    const uid = await ownerUserId(db, ctx); if (uid === null) return true;
    const b = await readBodyOnce();
    if (!b.quoteId || !b.idempotencyKey) return fail(400, 'quoteId 与 idempotencyKey 必填');
    const idem = IDEM.check({ list: db.withdrawals, key: b.idempotencyKey, payload: { payeeToken: b.payeeToken || null, amount: b.amount == null ? null : Number(b.amount) } });
    if (idem.conflict) return fail(409, idem.conflictReason);
    if (idem.duplicated) {
      const dup = idem.record;
      return ok(200, { status: dup.status, withdrawalId: dup.id, operationId: dup.operationId });
    }
    if (!b.payeeToken || b.amount == null) return fail(400, 'quoteId 无效（缺少收款信息）');
    const payee = db.payees.find((x) => x.token === b.payeeToken && x.userId === uid);
    if (!payee) return fail(404, '收款账户不存在');
    const amount = round2(Number(b.amount));
    if (!(amount >= WITHDRAW.min) || amount > WITHDRAW.max) return fail(400, '提现金额超出限制');
    const balance = walletAvailable(db, uid);
    if (amount > balance) return fail(400, `可提现余额不足（当前 ${balance} 元）`);
    const fee = Math.max(WITHDRAW.feeMin, round2(amount * WITHDRAW.feeRate));
    const rec = IDEM.stamp({
      id: rid('wdl'), userId: uid, title: '余额提现', amount, fee, netAmount: round2(amount - fee),
      status: 'PENDING_REVIEW', accountType: payee.accountType, accountName: payee.name,
      bankName: payee.bankName, maskedBankNumber: payee.maskedBankNumber,
      operationId: rid('op'), idempotencyKey: b.idempotencyKey, createdAt: nowMs(),
      __idemPayload: { payeeToken: b.payeeToken || null, amount: round2(Number(b.amount)) },
    });
    db.withdrawals.push(rec); save();
    return ok(200, { status: 'PENDING_REVIEW', withdrawalId: rec.id, operationId: rec.operationId });
  }
  if (p === '/wallet/withdrawals' && m === 'GET') {
    const uid = await ownerUserId(db, ctx); if (uid === null) return true;
    const items = db.withdrawals.filter((w) => w.userId === uid).map((w) => ({
      id: w.id, title: w.title, amount: w.amount, fee: w.fee, netAmount: w.netAmount, status: w.status,
      accountType: w.accountType, accountName: w.accountName, bankName: w.bankName,
      maskedBankNumber: w.maskedBankNumber, createdAt: new Date(w.createdAt).toISOString(),
    }));
    return ok(200, { items, hasMore: false, nextCursor: null });
  }

  // ═══════════════════ §12 遗留：申请列表 / 邀请落地页 ═══════════════════
  if (p === '/applications' && m === 'GET') {
    const uid = await ownerUserId(db, ctx); if (uid === null) return true;
    const type = (q('type') || 'COSTORE').toUpperCase();
    const items = db.applications.filter((a) => a.userId === uid && (type === 'ALL' || a.type === type)).map(publicApplication);
    return ok(200, { items, hasMore: false, nextCursor: null });
  }
  if (p.startsWith('/promotion/invitations/') && m === 'GET') {
    const promotionId = p.slice('/promotion/invitations/'.length);
    const uid = promotionId.replace(/^promo-/, '');
    const u = db.users[uid];
    if (!u) return fail(404, '推广不存在');
    const ag = db.regionalAgents.find((a) => a.partner_id === uid);
    const agencyType = ag ? (AGENCY_TYPE_MAP[ag.region_type] || 'STORE') : 'STORE';
    const regionType = REGION_TYPE_OF[agencyType] || 'store';
    const tiers = (RA.AGENT_PRICE_TABLE[regionType] || {}).tiers || [];
    const payableAmount = tiers.length ? tiers[tiers.length - 1].total : 0;
    return ok(200, {
      promotionId, agencyType, label: `${AGENCY_TYPE_CN[agencyType]}邀请（${u.name}）`, payableAmount,
      agreement: { version: 'v1', content: nodes(heading('代理申请协议'), para(`申请成为${AGENCY_TYPE_CN[agencyType]}，认可平台代理规则与分润方案。`)) },
    });
  }

  // ═══════════════════ §13 门店 / 健脑官 / 反馈 / 转店 ═══════════════════
  if (p === '/agency/store-workspace' && m === 'GET') {
    const uid = await agencyUserId(db, ctx); if (uid === null) return true;
    const assignmentId = q('assignmentId');
    if (!assignmentId) return fail(400, 'assignmentId 必填');
    const store = storeById(db, assignmentId);
    if (!store) return fail(404, '门店不存在');
    const staff = db.coaches.filter((c) => c.storeId === store.id).map(publicCoach);
    const approvals = db.applications.filter((a) => a.storeAgentId === store.id && ['PENDING_REVIEW', 'PENDING'].includes(a.applicationStatus)).map(publicApplication);
    const members = db.members.filter((mm) => mm.storeId === store.id).map(publicMember);
    const cs = db.coStores.find((c) => c.owner_id === store.id);
    const owners = cs ? (cs.owners || []).map((o) => { const ou = db.users[o.id]; return { id: o.id, name: ou ? ou.name : o.id, performance: o.performance || 0 }; }) : [];
    return ok(200, { store, staff, approvals, members, owners, allowedActions: ['update-store', 'manage-coach', 'decide-application', 'update-training', 'create-feedback', 'transfer-member'] });
  }
  // 注意：/stores/{storeId}/coaches[/{id}] 必须位于通用 PATCH /stores/{id} 之前。
  if (p.match(/^\/stores\/[^/]+\/coaches$/) && m === 'POST') {
    const storeId = p.split('/')[2];
    const uid = await agencyUserId(db, ctx); if (uid === null) return true;
    const store = storeById(db, storeId);
    if (!store) return fail(404, '门店不存在');
    const b = await readBodyOnce();
    if (!b.name || !b.loginAccount) return fail(400, 'name 与 loginAccount 必填');
    if (!b.idempotencyKey) return fail(400, 'idempotencyKey 必填');
    const idem = IDEM.check({ list: db.coaches, key: b.idempotencyKey, payload: { storeId: store.id, name: String(b.name).trim(), loginAccount: String(b.loginAccount) } });
    if (idem.conflict) return fail(409, idem.conflictReason);
    if (idem.duplicated) return ok(200, { coach: publicCoach(idem.record) });
    if (!/^[a-zA-Z0-9_-]{4,32}$/.test(String(b.loginAccount))) return fail(400, '登录名须为 4–32 位字母、数字、下划线或短横线');
    if (db.coaches.some((c) => c.loginAccount === b.loginAccount)) return fail(409, '登录名已被占用');
    const rec = IDEM.stamp({ id: rid('co'), storeId: store.id, name: String(b.name).trim(), loginAccount: String(b.loginAccount), status: 'ACTIVE', invitationStatus: 'PENDING', version: 1, idempotencyKey: b.idempotencyKey, createdAt: nowMs() }, { storeId: store.id, name: String(b.name).trim(), loginAccount: String(b.loginAccount) });
    db.coaches.push(rec); save();
    return ok(200, { coach: publicCoach(rec) });
  }
  if (p.match(/^\/stores\/[^/]+\/coaches\/[^/]+$/) && m === 'PATCH') {
    const storeId = p.split('/')[2];
    const uid = await agencyUserId(db, ctx); if (uid === null) return true;
    const store = storeById(db, storeId);
    if (!store) return fail(404, '门店不存在');
    const coach = db.coaches.find((c) => c.id === p.split('/')[4] && c.storeId === store.id);
    if (!coach) return fail(404, '健脑官不存在');
    const b = await readBodyOnce();
    if (b.version == null || Number(b.version) !== coach.version) return fail(409, `version 不匹配（当前 ${coach.version}）`);
    if (b.name != null) coach.name = String(b.name).trim();
    if (b.loginAccount != null) {
      if (!/^[a-zA-Z0-9_-]{4,32}$/.test(String(b.loginAccount))) return fail(400, '登录名格式不合法');
      if (db.coaches.some((c) => c.loginAccount === b.loginAccount && c.id !== coach.id)) return fail(409, '登录名已被占用');
      coach.loginAccount = String(b.loginAccount);
    }
    if (b.status != null && ['ACTIVE', 'DISABLED'].includes(b.status)) coach.status = b.status;
    coach.version += 1; save();
    return ok(200, { coach: publicCoach(coach) });
  }
  // ───────────── P0-6 线下交付核销（门店工作台 / 总部 / 健脑官） ─────────────
  if (p.match(/^\/stores\/[^/]+\/orders\/[^/]+\/verify$/) && m === 'POST') {
    const storeId = p.split('/')[2];
    const orderNo = p.split('/')[4];
    const b = await ctx.readBodyOnce();
    let operatorId = null, verifyStoreId = null;
    if (sess.role === 'admin') {
      operatorId = 'HQ';
      verifyStoreId = storeId || null; // 总部代核销，门店以路径参数为准
    } else if (sess.role === 'coach') {
      operatorId = sess.coachId;
      const st = storeById(db, sess.storeId);
      verifyStoreId = (st && st.regionCode) || sess.storeId || storeId || null;
    } else if (sess.role === 'user') {
      const st = storeById(db, storeId);
      if (!st || st.kind !== 'agent') return fail(403, '当前账号非门店老板，无权核销');
      const sa = db.regionalAgents.find((a) => a.partner_id === sess.userId && a.region_type === 'store' && a.region_code === st.regionCode);
      if (!sa) return fail(403, '当前账号非该门店老板，无权核销');
      operatorId = sess.userId;
      verifyStoreId = st.regionCode;
    } else {
      return fail(403, '无权核销');
    }
    let r;
    try {
      r = OL.verify(db, { storeId: verifyStoreId, orderNo, code: b.code, operatorId });
    } catch (e) {
      return fail(400, e.message);
    }
    save();
    return ok(200, {
      orderId: r.order.id, status: 'COMPLETED', deliveryMode: r.deliveryMode,
      activationCode: r.activationCode, verifiedAt: r.verifiedAt,
      verifyStore: r.order.verify_store || verifyStoreId || storeId,
    });
  }
  // 通用门店修改（置于 /stores/{id}/coaches 子路径之后，避免抢先匹配）
  if (p.startsWith('/stores/') && m === 'PATCH') {
    const id = p.slice('/stores/'.length);
    const uid = await agencyUserId(db, ctx); if (uid === null) return true;
    const b = await readBodyOnce();
    if (b.name == null || b.address == null || b.version == null) return fail(400, 'name、address、version 必填');
    if (String(b.name).length > 60) return fail(400, '名称最多 60 字');
    if (String(b.address).length > 200) return fail(400, '地址最多 200 字');
    const ag = db.regionalAgents.find((a) => a.partner_id === id && a.region_type === 'store');
    if (!ag) return fail(404, '门店不存在');
    if (ag.store_version && Number(b.version) !== ag.store_version) return fail(409, `version 不匹配（当前 ${ag.store_version}）`);
    ag.store_name = String(b.name).trim(); ag.store_address = String(b.address).trim();
    if (b.contact != null) ag.store_contact = String(b.contact).trim();
    ag.store_version = (ag.store_version || 1) + 1; save();
    return ok(200, { store: { id: ag.partner_id, name: ag.store_name, address: ag.store_address, contact: ag.store_contact || '', version: ag.store_version } });
  }
  if (p.match(/^\/applications\/[^/]+\/decisions$/) && m === 'POST') {
    const id = p.split('/')[2];
    const b = await readBodyOnce();
    const app = db.applications.find((a) => a.id === id);
    if (!app) return fail(404, '申请不存在');
    if (b.version == null || Number(b.version) !== app.version) return fail(409, `version 不匹配（当前 ${app.version}）`);
    if (!['APPROVE', 'REJECT'].includes(b.decision || '')) return fail(400, 'decision 为 APPROVE/REJECT');
    if (b.decision === 'REJECT' && !b.reason) return fail(400, '拒绝须填 reason');
    if (b.decision === 'REJECT' && String(b.reason).length > 200) return fail(400, 'reason 最多 200 字');
    const isAdmin = ctx.sess.role === 'admin';
    const isStoreAgent = ctx.sess.role === 'user' && app.storeAgentId && app.storeAgentId === ctx.sess.userId;
    if (!isAdmin && !isStoreAgent) return fail(403, '无权审批该申请');
    if (!['PENDING_REVIEW', 'PENDING'].includes(app.applicationStatus)) return fail(409, '申请不在待审状态');
    app.applicationStatus = b.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    app.decisionReason = b.reason || null;
    app.decidedAt = nowMs(); app.version += 1;
    let nextStep = null;
    if (b.decision === 'APPROVE') {
      if (app.type === 'TRANSFER') {
        const mm = memberOf(db, app.memberId);
        if (mm) mm.storeId = app.targetStoreId;
        nextStep = '会员归属已变更';
      } else {
        app.paymentStatus = 'WAITING_PAYMENT';
        nextStep = '等待支付';
      }
    }
    save();
    return ok(200, { status: app.applicationStatus, nextStep });
  }
  if (p === '/coach/workspace' && m === 'GET') {
    if (ctx.sess.role !== 'coach') return fail(403, '仅健脑官身份可访问');
    const store = storeById(db, ctx.sess.storeId);
    if (!store) return fail(404, '任职门店不存在');
    const members = db.members.filter((mm) => mm.storeId === store.id).map(publicMember);
    return ok(200, { contextId: `coach:${ctx.sess.coachId}`, name: ctx.sess.name || '', store: { id: store.id, name: store.name }, members, allowedActions: ['view-member', 'update-training', 'create-feedback'] });
  }
  if (p === '/training-feedback' && m === 'POST') {
    const b = await readBodyOnce();
    if (!b.memberId || !b.kind || !b.title || !b.text) return fail(400, 'memberId、kind、title、text 必填');
    if (!b.idempotencyKey) return fail(400, 'idempotencyKey 必填');
    if (!['training', 'self-study', 'camp'].includes(b.kind)) return fail(400, 'kind 为 training/self-study/camp');
    const title = String(b.title).trim(); const text = String(b.text).trim();
    if (title.length < 1 || title.length > 80) return fail(400, '标题 1–80 字');
    if (text.length < 1 || text.length > 3000) return fail(400, '正文 1–3000 字');
    const mm = memberOf(db, b.memberId);
    if (!mm || !canManageMember(db, ctx, mm)) return fail(404, '会员不存在');
    const idem = IDEM.check({ list: db.trainingFeedback, key: b.idempotencyKey, payload: { memberId: b.memberId, title, text, imageAssetIds: b.imageAssetIds || [], attachmentAssetIds: b.attachmentAssetIds || [] } });
    if (idem.conflict) return fail(409, idem.conflictReason);
    if (idem.duplicated) return ok(200, { id: idem.record.id });
    const imgs = Array.isArray(b.imageAssetIds) ? b.imageAssetIds : [];
    const atts = Array.isArray(b.attachmentAssetIds) ? b.attachmentAssetIds : [];
    if (imgs.length > 6) return fail(400, '图片最多 6 张');
    if (atts.length > 6) return fail(400, '附件最多 6 个');
    for (const aid of [...imgs, ...atts]) { const ast = db.assets.find((a) => a.id === aid); if (!ast || ast.status !== 'READY') return fail(400, `资源 ${aid} 未就绪`); }
    const rec = IDEM.stamp({
      id: rid('tfb'), memberId: mm.id, kind: b.kind, title, text,
      coachId: ctx.sess.role === 'coach' ? ctx.sess.coachId : null,
      coachName: ctx.sess.role === 'coach' ? (ctx.sess.name || '健脑官') : (ctx.sess.role === 'admin' ? '总部' : '家长'),
      imageAssetIds: imgs, attachmentAssetIds: atts, idempotencyKey: b.idempotencyKey, createdAt: nowMs(),
      __idemPayload: { memberId: b.memberId, title, text, imageAssetIds: b.imageAssetIds || [], attachmentAssetIds: b.attachmentAssetIds || [] },
    });
    db.trainingFeedback.push(rec); save();
    return ok(200, { id: rec.id });
  }
  if (p.startsWith('/training-feedback/') && m === 'GET') {
    const f = db.trainingFeedback.find((x) => x.id === p.slice('/training-feedback/'.length));
    if (!f) return fail(404, '反馈不存在');
    const mm = memberOf(db, f.memberId);
    if (!canManageMember(db, ctx, mm)) return fail(403, '无权查看该反馈');
    return ok(200, publicFeedback(f, db));
  }
  if (p === '/store-transfer/options' && m === 'GET') {
    const uid = await agencyUserId(db, ctx); if (uid === null) return true;
    const memberId = q('memberId');
    if (!memberId) return fail(400, 'memberId 必填');
    const mm = memberOf(db, memberId);
    if (!mm || !canTransferMember(db, ctx, mm)) return fail(404, '会员不存在');
    const keyword = (q('keyword') || '').trim();
    let stores = db.regionalAgents.filter((a) => a.region_type === 'store').map((a) => ({ id: a.partner_id, name: a.store_name || `脑商线下店 ${a.region_code}`, address: a.store_address || '', regionCodes: [a.region_code] }));
    stores = stores.concat(db.coStores.map((c) => ({ id: c.owner_id, name: `合店 ${c.store_id}`, address: '', regionCodes: [c.store_id] })));
    if (keyword) stores = stores.filter((s) => s.name.includes(keyword) || s.id.includes(keyword));
    const current = mm.storeId ? storeById(db, mm.storeId) : null;
    return ok(200, { currentStore: current ? { id: current.id, name: current.name } : null, stores });
  }
  if (p === '/store-transfer/applications' && m === 'POST') {
    const uid = await agencyUserId(db, ctx); if (uid === null) return true;
    const b = await readBodyOnce();
    if (!b.memberId || !b.targetStoreId || !b.reason) return fail(400, 'memberId、targetStoreId、reason 必填');
    if (!b.idempotencyKey) return fail(400, 'idempotencyKey 必填');
    const mm = memberOf(db, b.memberId);
    if (!mm || !canTransferMember(db, ctx, mm)) return fail(404, '会员不存在');
    const idem = IDEM.check({ list: db.storeTransfers, key: b.idempotencyKey, payload: { memberId: mm.id, targetStoreId: b.targetStoreId, reason: b.reason } });
    if (idem.conflict) return fail(409, idem.conflictReason);
    if (idem.duplicated) return ok(200, { application: idem.record });
    if (db.storeTransfers.some((t) => t.memberId === mm.id && t.status === 'PENDING')) return fail(409, '该会员已有待审转店申请');
    const target = storeById(db, b.targetStoreId);
    if (!target) return fail(404, '目标门店不存在');
    if (mm.storeId && mm.storeId === b.targetStoreId) return fail(400, '目标门店与当前门店相同');
    const rec = IDEM.stamp({
      id: rid('trs'), type: 'TRANSFER', memberId: mm.id, fromStoreId: mm.storeId || null, targetStoreId: target.id,
      reason: String(b.reason).trim(), status: 'PENDING', userId: uid, storeAgentId: target.id,
      idempotencyKey: b.idempotencyKey, createdAt: nowMs(), version: 1,
      __idemPayload: { memberId: mm.id, targetStoreId: b.targetStoreId, reason: b.reason },
    });
    db.storeTransfers.push(rec);
    db.applications.push({
      id: rec.id, type: 'TRANSFER', title: '转店申请', applicationStatus: 'PENDING',
      paymentStatus: 'NOT_STARTED', contractStatus: 'NOT_SIGNED', entitlementStatus: 'NOT_OPEN',
      userId: uid, storeId: target.id, storeAgentId: target.id, memberId: mm.id, targetStoreId: target.id,
      payableAmount: 0, store: { id: target.id, name: target.name }, createdAt: new Date(nowMs()).toISOString(), version: 1,
    });
    save();
    return ok(200, { application: { id: rec.id, type: 'TRANSFER', memberId: mm.id, targetStoreId: rec.targetStoreId, status: 'PENDING', version: 1 } });
  }

  // ═══════════════════ §14 上传资源 / 素材库 / 海报合成 ═══════════════════
  if (p === '/assets/upload-intents' && m === 'POST') {
    const uid = await ownerUserId(db, ctx); if (uid === null) return true;
    const b = await readBodyOnce();
    if (!b.purpose || !b.fileName || !b.mimeType || b.size == null) return fail(400, 'purpose、fileName、mimeType、size 必填');
    const rule = ASSET_RULES[b.purpose];
    if (!rule) return fail(400, `purpose 不支持（可用：${Object.keys(ASSET_RULES).join('/')}）`);
    if (!rule.mimes.includes(b.mimeType)) return fail(400, `${rule.label}仅支持 ${rule.mimes.join('、')}`);
    const size = Number(b.size);
    if (!Number.isFinite(size) || size <= 0) return fail(400, 'size 不合法');
    if (size > rule.maxSize) return fail(400, `${rule.label}大小不能超过 ${Math.floor(rule.maxSize / 1024 / 1024)}MB`);
    const id = rid('ast');
    const rec = { id, userId: uid, purpose: b.purpose, fileName: String(b.fileName), mimeType: b.mimeType, size, status: 'PENDING', createdAt: nowMs() };
    db.assets.push(rec); save();
    // 问题4：fileId 与 assetId 是**同一个 id**，两种叫法都返回，前端任选其一都能提交申请。
    // ⚠️ 这只是「上传凭证」——前端必须真的把文件 PUT/POST 到 uploadUrl，再调
    //    POST /assets/{id}/completions 确认，服务端才会把 status 置为 READY。
    //    未 READY 的凭证 id 直接提交申请会被拒绝（见 /agency/applications 的资源校验）。
    return ok(200, {
      assetId: id, fileId: id,
      mode: 'multipart', uploadUrl: `https://upload.naoshang.example.com/${id}`,
      fileField: 'file', headers: {}, fields: {}, limits: { maxSize: rule.maxSize },
      status: rec.status,
      nextStep: `把文件上传到 uploadUrl（字段名 ${'file'}），然后调用 POST /assets/${id}/completions 确认`,
    });
  }
  if (p.match(/^\/assets\/[^/]+\/(completions|complete)$/) && m === 'POST') {
    const id = p.split('/')[2];
    const ast = db.assets.find((a) => a.id === id);
    if (!ast) return fail(404, '资源不存在');
    if (ctx.sess.role !== 'admin' && ast.userId !== ctx.sess.userId) return fail(403, '资源不属于当前账号');
    if (ast.status === 'READY') return ok(200, { status: 'ready', previewUrl: ast.previewUrl || null });
    const rule = ASSET_RULES[ast.purpose];
    if (!rule.mimes.includes(ast.mimeType) || ast.size > rule.maxSize) { ast.status = 'FAILED'; ast.failReason = '文件类型或大小不符合用途要求'; save(); return fail(400, ast.failReason); }
    ast.status = 'READY';
    ast.previewUrl = `https://cdn.naoshang.example.com/preview/${ast.id}`;
    save();
    return ok(200, { status: 'ready', previewUrl: ast.previewUrl });
  }
  if (p === '/materials/categories' && m === 'GET') {
    const type = q('type');
    if (!['image', 'article', 'video'].includes(type || '')) return fail(400, 'type 必填且为 image/article/video');
    return ok(200, { categories: MATERIAL_CATEGORIES[type] });
  }
  if (p === '/materials' && m === 'GET') {
    const type = q('type');
    if (!['image', 'article', 'video'].includes(type || '')) return fail(400, 'type 必填且为 image/article/video');
    let items = MATERIALS.filter((x) => x.type === type);
    if (q('categoryId')) items = items.filter((x) => x.categoryId === q('categoryId'));
    return ok(200, { items: items.map(({ content, ...rest }) => rest), hasMore: false, nextCursor: null });
  }
  if (p.startsWith('/materials/') && m === 'GET') {
    const mat = MATERIALS.find((x) => x.id === p.slice('/materials/'.length));
    if (!mat) return fail(404, '素材不存在');
    return ok(200, mat);
  }
  if (p.match(/^\/materials\/[^/]+\/renders$/) && m === 'POST') {
    const id = p.split('/')[2];
    const uid = await ownerUserId(db, ctx); if (uid === null) return true;
    const mat = MATERIALS.find((x) => x.id === id);
    if (!mat) return fail(404, '素材不存在');
    const b = await readBodyOnce();
    if (!b.qrAssetId) return fail(400, 'qrAssetId 必填');
    if (!b.idempotencyKey) return fail(400, 'idempotencyKey 必填');
    const qr = db.assets.find((a) => a.id === b.qrAssetId);
    if (!qr) return fail(404, '二维码资源不存在');
    if (ctx.sess.role === 'user' && qr.userId !== ctx.sess.userId) return fail(403, '二维码资源不属于当前账号');
    if (qr.status !== 'READY') return fail(400, '二维码资源未就绪');
    if (qr.purpose !== 'material-qr') return fail(400, '二维码资源用途必须为 material-qr');
    const idem = IDEM.check({ list: db.materialRenders, key: b.idempotencyKey, payload: { materialId: mat.id, qrAssetId: qr.id } });
    if (idem.conflict) return fail(409, idem.conflictReason);
    if (idem.duplicated) return ok(200, { jobId: idem.record.id });
    const job = IDEM.stamp({ id: rid('job'), type: 'POSTER_RENDER', materialId: mat.id, qrAssetId: qr.id, userId: uid, status: 'queued', message: null, idempotencyKey: b.idempotencyKey, createdAt: nowMs() }, { materialId: mat.id, qrAssetId: qr.id });
    db.jobs.push(job); save();
    scheduleJob(db, job, save);
    return ok(200, { jobId: job.id });
  }
  if (p.startsWith('/jobs/') && m === 'GET') {
    const job = db.jobs.find((j) => j.id === p.slice('/jobs/'.length));
    if (!job) return fail(404, '任务不存在');
    if (ctx.sess.role === 'user' && job.userId !== ctx.sess.userId) return fail(403, '任务不属于当前账号');
    return ok(200, { status: job.status, downloadUrl: job.downloadUrl || null, shareUrl: job.shareUrl || null, message: job.message || null });
  }

  return false; // 不归本层
}

// ───────────── 调度合成任务（测试平台异步模拟） ─────────────
function scheduleJob(db, job, save) {
  setTimeout(() => { job.status = 'processing'; save && save(); }, 400);
  setTimeout(() => {
    job.status = 'succeeded';
    job.downloadUrl = `https://cdn.naoshang.example.com/posters/${job.id}.png`;
    job.shareUrl = `https://h5.naoshang.example.com/poster/${job.id}`;
    save && save();
  }, 1800);
}

// ───────────── 输出整形 ─────────────
function publicAddress(a) {
  return { id: a.id, recipient: a.recipient, phone: a.phone, regionCodes: a.regionCodes, regionNames: a.regionNames, detail: a.detail, isDefault: a.isDefault, version: a.version };
}
function validateAddress(b, isPatch) {
  const req = ['recipient', 'phone', 'regionCodes', 'detail'];
  for (const k of req) if (!isPatch || b[k] != null) { if (b[k] == null || (typeof b[k] === 'string' && !b[k].trim())) return `${k} 必填`; }
  if (b.phone != null && !/^1\d{10}$/.test(String(b.phone).trim())) return 'phone 须为 11 位手机号';
  if (b.regionCodes != null && (!Array.isArray(b.regionCodes) || b.regionCodes.length !== 3)) return 'regionCodes 须为三级编码';
  return null;
}
function progressOf(db, memberId, levelId, chapterId) {
  const r = db.learningProgress.find((x) => x.memberId === memberId && x.levelId === levelId && x.chapterId === chapterId);
  return r ? { positionSeconds: r.positionSeconds, durationSeconds: r.durationSeconds, completed: r.completed } : { positionSeconds: 0, durationSeconds: 0, completed: false };
}
function publicMember(mm) {
  return {
    id: mm.id, contextId: `member:${mm.id}`, displayId: mm.display_id || mm.id, name: mm.name, avatarUrl: mm.avatarUrl || null,
    gradeCode: mm.gradeCode, gradeLabel: mm.gradeLabel, genderCode: mm.genderCode, genderLabel: mm.genderLabel,
    memberLevel: mm.memberLevel || 'normal', memberLevelName: IZ.memberTierName(mm.memberLevel || 'normal'),
    badge: (mm.memberLevel && mm.memberLevel !== 'normal') ? IZ.memberTierName(mm.memberLevel) : (mm.unlockedLevels.length ? '已开通等级' : ''),
    levels: mm.unlockedLevels.map((lid) => { const lv = levelOf(lid); return { id: lid, name: lv ? lv.name : lid }; }),
    training: mm.training, storeId: mm.storeId || null, version: mm.version,
  };
}
function publicCoach(c) {
  return { id: c.id, name: c.name, loginAccount: c.loginAccount, status: c.status, invitationStatus: c.invitationStatus, version: c.version };
}
function publicApplication(a) {
  return {
    id: a.id, title: a.title, applicationStatus: a.applicationStatus, paymentStatus: a.paymentStatus,
    contractStatus: a.contractStatus, entitlementStatus: a.entitlementStatus,
    store: a.store || null, agencyType: a.agencyType, payableAmount: a.payableAmount, createdAt: a.createdAt, version: a.version,
  };
}
function publicFeedback(f, db) {
  const mm = db ? (db.members.find((m) => m.id === f.memberId) || {}) : {};
  const assetMeta = (id) => { const a = (db ? db.assets.find((x) => x.id === id) : null) || {}; return { assetId: id, kind: a.purpose === 'training-video' ? 'video' : 'file', name: a.fileName || id, size: a.size || 0, previewUrl: a.previewUrl || null }; };
  return {
    id: f.id, memberId: f.memberId, memberName: mm.name || f.memberId, title: f.title, kind: f.kind,
    coachName: f.coachName || null, createdAt: new Date(f.createdAt).toISOString(), content: f.text,
    images: (f.imageAssetIds || []).map((id) => { const a = db.assets.find((x) => x.id === id) || {}; return { assetId: id, previewUrl: a.previewUrl || null }; }),
    attachments: (f.attachmentAssetIds || []).map(assetMeta),
  };
}

module.exports = { handle, ensure, resetBiz, BIZ_KEYS, recordApplication, findCoachByLogin, listAddresses, listCoupons, columnById, columnChapterOf, columnList };

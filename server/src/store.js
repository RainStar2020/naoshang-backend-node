/**
 * 脑商AI合伙人 · 内存数据层（轻量仓储，无外部 DB）
 * 仅用于后端逻辑设计与路由/结算的本地验证；上线时替换为 PostgreSQL/SQLite 实现。
 *
 * 实体（字段同 设计文档 §2）：users / orders / commissions / vip_quota_ledger /
 * regional_agent / co_store / upline_history。
 */

const { vipCredit } = require('./commission');
const RA = require('./regionAgent');
const Q = require('./quotaLedger');

function createDb() {
  return {
    users: {},          // id -> user
    orders: [],         // 订单数组
    commissions: [],    // 佣金数组
    quotaLedger: {},    // partnerId -> { standard, activity:[{qty,obtainedAt,expireAt}] }（P0-3 双余额）
    quota_transactions: [], // 名额流水（下发/消耗审计，原型屏 42/43）
    regionalAgents: [], // 区域代理
    coStores: [],       // 合店
    uplineHistory: [],  // 关系变更历史
    freeUpgradeLog: [], // 拉人免费升档发放记录（2026-10-26）
    experience: [],     // 经验值明细（P0-1，2026-10-26）
    promotionTasks: [], // 晋升/推广任务实例（P0-2）
    allocations: [],    // 分配意愿（P0-9）
    inviteCodes: [],    // 两套邀请码流水（P1-8：register 注册码 / agent 代理归属码）
    settings: null,     // 后台可调配置（合店费/无责分红月数/四场景开关等）
    members: [],        // 孩子（会员）列表：家长与孩子的会员等级关系（商城按孩子等级打折用）
    seq: 1,             // 内部 id 生成计数器（u_/o_/c_/ra_/cs_ 共用）
    userSeq: 1,         // 用户全局注册序号计数器（对外编号数字部分，四位起步）
    memberSeq: 1,       // 孩子（会员）全局添加序号计数器（孩子编号数字部分，第几个添加第几）
  };
}

// ───────────── 后台可调配置（全部可覆盖；与 costorePlan.DEFAULT_CONFIG 对应） ─────────────
// 说明：合店费/订单支付超时/分红门槛/晋升任务/经验值/分配意愿等全部走这里，总部后台可改；
//       未覆盖项回退到默认值。新增配置组只需在 DEFAULT_SETTINGS 里加一层，读写自动生效。
const DEFAULT_SETTINGS = {
  costore: {
    enabledV2: true,        // 四场景新逻辑开关（false → 回滚旧「53%+2%+10%」固定三分）
    monthlyFee: 698,        // 合店费月费（暂定，后台可改）
    minMonths: 6,           // 最少起付月数（不得少于 6）
    graceMonths: 1,         // 无责分红月数（入股首月，后台可调）
    softwareUnitPrice: 100, // 软件卡/VIP 分红基数（元/月/单位）
    softwareToPoolRate: 1.0,// 软件卡/VIP 销售额计入分红池比例
  },
  // P0-5 订单支付超时（原型：剩余支付时间倒计时 + 支付超时自动取消）
  order: {
    payTimeoutMinutes: 30,   // 下单后支付时限（分钟），后台可改
    autoExpireSweep: true,   // 是否允许惰性扫描自动取消（列表/详情被访问时顺带清理）
  },
  // P0-7 分红业绩门槛（原型：每月业绩达标 2900 才享分红权；不满则记「当月无分红权」）
  dividend: {
    enabled: true,
    memberCardThreshold: 2900,  // 会员卡分红业绩门槛（元）
    promotionThreshold: 2900,   // 推广分红业绩门槛（元）
    graceMonths: 1,             // 入股首月无责（不卡门槛）
    requireDirectPush: true,    // 是否仍要求当月至少直推 1 个 VIP
  },
  // P0-2 晋升/推广任务（原型：1 年内直推 3 位私董 或 18 个 VIP → 免费晋升）
  promotionTask: {
    enabled: true,
    validMonths: 12,
    targets: [
      { key: 'private', label: '直推私董', required: 3 },
      { key: 'vip', label: '直推VIP', required: 18 },
    ],
    grant: 'next',   // next=免费升 1 档（封顶联创）；原型文案写「晋升联创」，按 economic 口径收敛为 1 档
  },
  // P0-1 经验值（决策：标价多少加多少，1 元 = 1 经验值；纯记账不参与分账）
  experience: {
    enabled: true,
    yuanPerPoint: 1,
  },
  // P0-9 分配意愿（原型：巡查 5% 归县区代、销售 5% 归单店代理，可自行分配，默认值由总部后台改）
  productAllocation: {
    mode: 'self_assign',  // P1-5：self_assign=可自选分配；fixed=固定归默认受益人（两块 5% 都不允许自选）
    inspect: { rate: 0.05, defaultRecipient: 'district', ownerAssignable: true, maxTargets: 4 },
    sales: { rate: 0.05, defaultRecipient: 'store', ownerAssignable: true, maxTargets: 4 },
    editableBy: 'HQ',
  },
  // P0-3/P0-4 名额双余额 + 升级服务费（原型屏 36：¥2000.00/个活动名额，标准名额不计服务费）
  quota: {
    serviceFeePerActivity: 2000,   // 每个活动名额的升级服务费（元），后台可改
    activityValidityDays: 365,     // 活动名额有效期（天），后台可改
    activityValidForUpgrade: true, // true=活动名额可用于升级并触发服务费；false=仅标准名额可用于升级
  },
  // P1-7 合伙人成长阶梯 L1–L10（等级名/晋升阈值/提成系数/画图坐标，后台可改）
  ladder: {
    enabled: true,
    unit: '成长积分',
    levels: [],   // 空 = 用 src/ladder.js 默认阶梯；非空则覆盖（每项含 level/name/minScore/commissionRate/coord）
  },
  // P1-8 两套邀请码（register 注册码 / agent 代理归属码）
  inviteCode: {
    registerEnabled: true,  // 是否开放「注册邀请码」
    agentEnabled: true,     // 是否开放「代理归属码」
    ttlDays: 30,            // 邀请码有效期（天）
    defaultMaxUse: 0,       // 默认限次（0 = 不限次）
    bindOnRegister: true,   // 注册时凭注册码自动绑定推荐人（upline）
  },
  // P1-9 会员价 / 渠道价 双折扣
  pricing: {
    dualDiscountEnabled: false, // false=沿用「按买家档位单一折扣」；true=渠道取渠道价、会员取会员价
    exposeBothPrices: true,    // 报价接口是否同时返回 list/member/channel 三套价（默认返回，不影响成交价）
  },
  // P1-1 拉人免费升档 · 两套规则（取二者进度较高者）
  freeUpgrade: {
    enabled: true,             // 关闭后不再发放免费升档
    countRequired: 3,          // 规则A（人数）：每满 N 名「合格下级」免费升 1 档
    performanceEnabled: false, // 规则B（业绩）：是否启用「团队付费升档业绩达标」规则
    performanceRequired: 100000, // 规则B 阈值（元）：直属下级付费升档实付金额累计
  },
  // P1-3 直推提点分档（默认固定 15%，与 tp123 口径一致；后台可按数量/级别分档）
  agentDirectBonus: {
    enabled: true,   // false = 强制回到固定 15%
    tiers: [],       // [{ minReferrals, rate }] 按直推代理数量分档
    byRegionType: {},// { province, city, district, store } 按推荐人代理级别分档（优先级更高）
  },
  // P1-3 直推奖口径二选一（默认 byUplineTier = 按推荐人身份，既有金额不变）：
  //   byUplineTier：vip 5% / angel 10% / private 15% / cofounder 15%（= commission.DIRECT_RATIO）
  //   byBizType   ：原型屏 50 —— 供应链/合店费复购/升级奖 2%；软件卡/代理费/权益费 5%
  directBonus: {
    mode: 'byUplineTier',
    byUplineTier: { vip: 0.05, angel: 0.10, private: 0.15, cofounder: 0.15 },
    byBizType: {
      supply_chain: 0.02, costore: 0.02, upgrade: 0.02,
      software_fee: 0.05, agent_fee: 0.05, entitlement: 0.05,
    },
  },
};

const SETTINGS_GROUPS = ['costore', 'order', 'dividend', 'promotionTask', 'experience', 'productAllocation', 'quota', 'ladder', 'inviteCode', 'pricing', 'freeUpgrade', 'agentDirectBonus', 'directBonus'];

/** 递归合并：只接受默认值里已声明的键，并按默认值类型收敛（防止后台写坏结构） */
function mergeGroup(defaults, patch) {
  const out = Array.isArray(defaults) ? defaults.slice() : { ...defaults };
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return out;
  for (const k of Object.keys(defaults)) {
    if (patch[k] === undefined) continue;
    const dv = defaults[k];
    if (dv && typeof dv === 'object' && !Array.isArray(dv)) {
      out[k] = mergeGroup(dv, patch[k]);
    } else if (Array.isArray(dv)) {
      if (Array.isArray(patch[k])) out[k] = JSON.parse(JSON.stringify(patch[k]));
    } else if (typeof dv === 'number') {
      const n = Number(patch[k]);
      if (Number.isFinite(n)) out[k] = n;
    } else if (typeof dv === 'boolean') {
      out[k] = !!patch[k];
    } else if (dv == null) {
      out[k] = patch[k];
    } else {
      out[k] = String(patch[k]);
    }
  }
  return out;
}

/** 取合并后的配置（后台设置优先，缺省回退默认） */
function getSettings(db) {
  const base = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  const s = db.settings || {};
  for (const g of SETTINGS_GROUPS) {
    if (s[g] && typeof s[g] === 'object') base[g] = mergeGroup(base[g], s[g]);
  }
  return base;
}

/**
 * 局部更新后台配置。
 *   兼容两种入参：
 *     ① 分组式：{ costore:{...}, order:{payTimeoutMinutes:45}, dividend:{memberCardThreshold:3000} }
 *     ② 旧扁平式：{ monthlyFee: 698, minMonths: 6 }（等价于只改 costore 组）
 */
function updateSettings(db, patch = {}) {
  const cur = getSettings(db);
  const grouped = SETTINGS_GROUPS.some((g) => patch[g] && typeof patch[g] === 'object');
  const next = {};
  for (const g of SETTINGS_GROUPS) next[g] = grouped ? mergeGroup(cur[g], patch[g]) : cur[g];
  if (!grouped) next.costore = mergeGroup(cur.costore, patch);
  // minMonths 业务下限保护（合店最低起付 6 个月）
  if (next.costore.minMonths != null) next.costore.minMonths = Math.max(1, Math.floor(next.costore.minMonths));
  if (next.costore.graceMonths != null) next.costore.graceMonths = Math.max(0, Math.floor(next.costore.graceMonths));
  if (next.order.payTimeoutMinutes != null) next.order.payTimeoutMinutes = Math.max(1, Math.floor(next.order.payTimeoutMinutes));
  db.settings = next;
  return db.settings;
}

function nextId(db, prefix) { return `${prefix}_${db.seq++}`; }

// ───────────── 用户 ─────────────
const IZ = require('./identity');

function addUser(db, u) {
  if (!u.id) u.id = nextId(db, 'u');
  db.users[u.id] = u;
  // 统一身份编号（2026-10-24）：分配全局注册序号 + 默认权益状态 + 派生对外编号
  // 注意：新注册用户默认 active 仅用于种子/后台建号；H5 注册流程会显式置 never_paid（见 routes/h5.js）
  if (u.seq == null) IZ.assignSeq(db, u.id);
  if (u.entitlement_state == null) u.entitlement_state = 'active';
  IZ.recomputeDisplayId(db, u.id);
  // 推荐关系快照（2026-10-26 拉人免费升档）：记录「被推荐时上级档位」与「本人当时档位」，
  // 用于判定下级是否「从与上级同级起步并付费升档」。仅在首次绑定上级时写入，不覆盖。
  if (u.upline_id && db.users[u.upline_id] && u.referral_upline_tier == null) {
    u.referral_upline_tier = db.users[u.upline_id].tier;
    u.referral_tier = u.tier;
  }
  if (u.free_upgrade_applied == null) u.free_upgrade_applied = 0;
  return u;
}
function getUser(db, id) { return db.users[id]; }
function getUserByPhone(db, phone) { return Object.values(db.users).find((u) => u.phone === phone); }

// ───────────── 订单 ─────────────
function addOrder(db, o) {
  if (!o.id) o.id = nextId(db, 'o');
  db.orders.push(o);
  return o;
}

// ───────────── 佣金 ─────────────
/**
 * 权益门禁（2026-10-24 用户确认）：权益过期(expired)的用户，
 * 全球奖/直推奖/复购奖/创始奖/代理奖/合店分配等全部停算——在本收口统一拦截。
 * never_paid 不拦截（收益照算、挂着不可见）；active 正常入账。
 */
function entitlementAllowsIncome(db, ownerId) {
  const u = db.users[ownerId];
  if (!u) return true; // 非用户主体（如总部）不受门禁
  return IZ.entitlementState(u) !== 'expired';
}

function pushCommission(db, c) {
  if (!entitlementAllowsIncome(db, c.owner_id)) return null; // 权益过期 → 停算
  if (!c.id) c.id = nextId(db, 'c');
  // 自动生成可手算核对的公式文本（若调用方未显式提供）
  if (!c.formula) c.formula = buildFormula(c);
  db.commissions.push(c);
  return c;
}

/**
 * 按 id覆盖式落账（幂等）。用于「重复执行同月结算不重复累加」：
 * 结算产出的佣金都带确定性 id（如 cs-hq-cs_11、gb-p1、fb-cofounder-x），
 * 同 id 则替换为新记录，不同 id 则追加。
 */
function upsertCommission(db, c) {
  if (!entitlementAllowsIncome(db, c.owner_id)) return null; // 权益过期 → 停算（既有记录保留，可导出）
  if (!c.id) return pushCommission(db, c);
  if (!c.formula) c.formula = buildFormula(c);
  const i = db.commissions.findIndex((x) => x.id === c.id);
  if (i >= 0) { db.commissions[i] = c; return c; }
  db.commissions.push(c);
  return c;
}

/**
 * 由基数 / 比例 / 金额生成人话公式，方便后台逐笔展示与人工核对。
 * 例：base=5235, rate=0.02 → "5235 × 2% = 104.70"
 */
function buildFormula(c) {
  const b = c.base_amount, r = c.rate, a = c.amount;
  // 区域代理：门店服务费 3000/VIP 的定额拆分
  if (c.type === 'agent') {
    const q = c.region_type === 'store' ? '门店' : c.region_type === 'district' ? '区县代'
      : c.region_type === 'city' ? '市代' : c.region_type === 'province' ? '省代' : c.region_type;
    return `${q} 门店服务费定额 ${round2(b)}（3000/VIP 拆分）`;
  }
  if (c.type === 'global') {
    return `奖池 ${round2(b)} × 本人份额 ${(r * 100).toFixed(2).replace(/\.?0+$/, '')}% = ${round2(a)}`;
  }
  if (c.type === 'founding') {
    return `3500 × ${(r * 100).toFixed(2).replace(/\.?0+$/, '')}% × ${Math.round(round2(b) / 3500)} VIP = ${round2(a)}`;
  }
  if (c.type === 'costore') {
    return `合店费 ${round2(b)} × ${(r * 100).toFixed(2).replace(/\.?0+$/, '')}% = ${round2(a)}`;
  }
  if (b != null && r != null) {
    const pctTxt = (Math.abs(r) <= 1 ? (r * 100).toFixed(2).replace(/\.?0+$/, '') + '%' : round2(r));
    return `${round2(b)} × ${pctTxt} = ${round2(a)}`;
  }
  if (b != null) return `基数 ${round2(b)} → ${round2(a)}`;
  return `固定 ${round2(a)}`;
}

/** 某用户佣金汇总（可按 period / type 过滤） */
function commissionSummary(db, ownerId, { period, type } = {}) {
  const list = db.commissions.filter(
    (c) => c.owner_id === ownerId && (!period || c.period === period) && (!type || c.type === type)
  );
  const byType = {};
  let total = 0;
  for (const c of list) { byType[c.type] = round2((byType[c.type] || 0) + c.amount); total += c.amount; }
  return { list, total: round2(total), byType };
}
function round2(n) { return Math.round(n * 100) / 100; }

// ───────────── 团队树 ─────────────
function getDirectDownline(db, userId) {
  return Object.values(db.users).filter((u) => u.upline_id === userId);
}
/** 收集 userId 的全部下级（含自身） */
function collectSubtree(db, userId) {
  const out = [userId];
  const q = [userId];
  while (q.length) {
    const cur = q.shift();
    for (const c of getDirectDownline(db, cur)) { out.push(c.id); q.push(c.id); }
  }
  return out;
}
/**
 * 动态统计子树（不含自身）VIP 业绩。
 * 口径与全球奖 annotateCofounders 一致：子树内订单的 vipCredit 累加（buyer≠自身）。
 */
function subtreeVip(db, userId) {
  const subtree = collectSubtree(db, userId);
  return round2(
    db.orders
      .filter((o) => subtree.includes(o.buyer_id) && o.buyer_id !== userId && o.status !== 'cancelled')
      .reduce((s, o) => s + (o.vipCredit != null ? o.vipCredit : vipCredit(o.oldTier, o.packageTier)), 0)
  );
}
/** 团队树（递归） */
function tree(db, userId) {
  const u = db.users[userId];
  const children = getDirectDownline(db, userId).map((c) => tree(db, c.id));
  return {
    id: userId,
    name: u ? u.name : null,
    tier: u ? u.tier : null,
    principal_tier: u ? u.principal_tier : null,
    team_vip: subtreeVip(db, userId),
    // 拉人免费升档进度（团队树可视化：每个节点展示其「再拉 N 人可免费升档」）
    referralFreeUpgrade: u ? referralFreeUpgradeProgress(db, userId) : null,
    children,
  };
}

// ───────────── 联创资格标注（供全球奖） ─────────────
/**
 * 从 orders + users 树计算各联创的 ownVip（本人直接卖出）/ teamVip（下级子树，不含本人）。
 * @param {Array} cofounderIds
 */
function annotateCofounders(db, cofounderIds) {
  const result = [];
  for (const id of cofounderIds) {
    const u = db.users[id];
    if (!u) continue;
    const ownVip = db.orders
      .filter((o) => o.seller_id === id)
      .reduce((s, o) => s + (o.vipCredit != null ? o.vipCredit : vipCredit(o.oldTier, o.packageTier)), 0);
    const subtree = collectSubtree(db, id);
    const teamVip = db.orders
      .filter((o) => subtree.includes(o.buyer_id) && o.buyer_id !== id)
      .reduce((s, o) => s + (o.vipCredit != null ? o.vipCredit : vipCredit(o.oldTier, o.packageTier)), 0);
    result.push({
      id, tier: u.tier,
      ownVip: round2(ownVip), teamVip: round2(teamVip),
      daysSinceCofounder: u.daysSinceCofounder != null ? u.daysSinceCofounder : 999,
      directPushedVip: u.directPushedVip != null ? u.directPushedVip : 0,
    });
  }
  return result;
}

// ───────────── 关系变更（解绑/重绑，§7.5） ─────────────
function unbind(db, partnerId) {
  const u = db.users[partnerId];
  if (!u) throw new Error('用户不存在: ' + partnerId);
  db.uplineHistory.push({ partnerId, oldUpline: u.upline_id, action: 'unbind', at: Date.now() });
  u.upline_id = null;
  return u;
}
function rebind(db, partnerId, newUplineId) {
  const u = db.users[partnerId];
  if (!u) throw new Error('用户不存在: ' + partnerId);
  const old = u.upline_id;
  if (newUplineId && !db.users[newUplineId]) throw new Error('新上级不存在: ' + newUplineId);
  db.uplineHistory.push({ partnerId, oldUpline: old, newUpline: newUplineId, action: 'rebind', at: Date.now() });
  u.upline_id = newUplineId || null;
  // 重新绑定上级时，若尚未记录推荐快照则补记（2026-10-26 拉人免费升档）
  if (u.upline_id && db.users[u.upline_id] && u.referral_upline_tier == null) {
    u.referral_upline_tier = db.users[u.upline_id].tier;
    u.referral_tier = u.tier;
  }
  return u;
}

// ───────────── 合店（门店）实体（2026-10-22/23 用户口径确认字段） ─────────────
/**
 * 合店（门店）登记。
 *   owner_id       : 合店老板（缴纳 698/月 的人，须 VIP 及以上）
 *   storeManagerId : 门店店长 / 门店股东（拿 40% 服务；也是 13%/2% 的兜底收款人）。缺省 = owner_id（单人店）
 *   promoter_id    : 推荐人（可能是合店老板 → 拿 13% 直推奖），可为空
 *   upline_id      : 被推荐人（合店老板）的上级（在合伙人体系里的直接绑定上级），拿 2% 复购奖；可推导自 users[owner_id].upline_id
 *   monthly_fee    : 合店费（默认 698/月）
 *   store_id       : 所属门店标识（单店分红用，缺省 = storeManagerId）
 *   ownerCount     : 门店老板人数（多人时 40% 服务按人数均分），缺省 = owners 数或 1
 *   joinDate       : 该合店老板入股年月（YYYY-MM）或时间戳；用于「无责分红首月」判定
 *   owners         : [{id, performance}] 本店合店老板列表（performance = 其本人售出的产品/会员/VIP 业绩，不含合店费），用于单店分红
 *   partners       : 同 owners（兼容旧字段名）
 */
function addCoStore(db, cs) {
  if (!cs.id) cs.id = nextId(db, 'cs');
  // 规则（用户 2026-10-23）：合店老板必须是 VIP 及以上身份
  const owner = db.users[cs.owner_id];
  if (!owner) throw new Error('合店老板不存在: ' + cs.owner_id);
  if (owner.tier === 'none') throw new Error('合店老板必须是 VIP 及以上身份，' + cs.owner_id + ' 当前档位为 none，请先升级为 VIP 后再入伙');
  cs.storeManagerId = cs.storeManagerId || cs.owner_id;   // 门店店长缺省 = 合店老板本人（单人店）
  cs.store_id = cs.store_id || cs.storeManagerId;          // 单店分红分组键
  cs.monthly_fee = cs.monthly_fee != null ? Number(cs.monthly_fee) : getSettings(db).costore.monthlyFee; // 缺省跟随后台配置（而非写死默认）
  cs.ownerCount = cs.ownerCount || (cs.owners ? cs.owners.length : 1) || 1;
  cs.referrer = cs.referrer || 'other';
  if (!cs.owners && cs.partners) cs.owners = cs.partners;
  if (!cs.partners && cs.owners) cs.partners = cs.owners;
  if (!cs.joinDate) cs.joinDate = periodNow();             // 默认入股当月 → 无责首月
  db.coStores.push(cs);
  return cs;
}
function getCoStore(db, ownerId) { return db.coStores.find((x) => x.owner_id === ownerId); }

/** 某用户是否为合店老板（在任一合店记录里作为 owner_id 出现） */
function isCostoreOwner(db, userId) {
  return db.coStores.some((c) => c.owner_id === userId);
}

/** 当前年月 YYYY-MM（用于 joinDate 默认与分红资格判定） */
function periodNow(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ───────────── 编辑实体（后台「修改ID」功能） ─────────────
/**
 * 修改合伙人字段。**支持修改 ID**（partnerId 改名），
 * 改 ID 时对全库做级联重命名，保证关系不丢：
 *   users 键 / upline_id / orders.buyer_id / orders.seller_id /
 *   commissions.owner_id / quotaLedger / regionalAgents.partner_id /
 *   coStores.owner_id / coStores.promoter_id / coStores.owners[].id / coStores.partners[].id
 *
 * @param {Object} db
 * @param {string} partnerId 原 ID
 * @param {Object} patch { id?, name?, phone?, tier?, upline_id?, is_founding?, quota?, annual_fee_paid? }
 */
function updatePartner(db, partnerId, patch = {}) {
  const u = db.users[partnerId];
  if (!u) throw new Error('用户不存在: ' + partnerId);

  const newId = patch.id != null && String(patch.id).trim() ? String(patch.id).trim() : null;

  // 先做普通字段更新（不含 id）
  const allowed = ['name', 'phone', 'tier', 'upline_id', 'is_founding', 'annual_fee_paid', 'teamVip'];
  for (const k of allowed) {
    if (patch[k] !== undefined) {
      u[k] = k === 'upline_id' ? (patch[k] || null) : patch[k];
    }
  }
  if (patch.quota !== undefined) {
    // P0-3：quota 字段只调整「标准名额」桶，活动名额（带有效期）不动
    const e = Q.normalize(db.quotaLedger, partnerId);
    e.standard = Number(patch.quota) || 0;
  }

  if (newId && newId !== partnerId) {
    if (db.users[newId]) throw new Error(`ID 已被占用: ${newId}`);
    // 1) 改 users 键
    db.users[newId] = u;
    delete db.users[partnerId];
    u.id = newId;
    // 2) 子级推荐关系
    for (const x of Object.values(db.users)) {
      if (x.upline_id === partnerId) x.upline_id = newId;
    }
    // 3) 订单
    for (const o of db.orders) {
      if (o.buyer_id === partnerId) o.buyer_id = newId;
      if (o.seller_id === partnerId) o.seller_id = newId;
    }
    // 4) 佣金（已落账的）
    for (const c of db.commissions) {
      if (c.owner_id === partnerId) c.owner_id = newId;
    }
    // 5) 名额台账
    if (db.quotaLedger[partnerId] !== undefined) {
      db.quotaLedger[newId] = db.quotaLedger[partnerId];
      delete db.quotaLedger[partnerId];
    }
    // 6) 区域代理
    for (const a of db.regionalAgents) {
      if (a.partner_id === partnerId) a.partner_id = newId;
    }
    // 7) 合店
    for (const cs of db.coStores) {
      if (cs.owner_id === partnerId) cs.owner_id = newId;
      if (cs.storeManagerId === partnerId) cs.storeManagerId = newId;
      if (cs.promoter_id === partnerId) cs.promoter_id = newId;
      for (const o of cs.owners || []) if (o.id === partnerId) o.id = newId;
      for (const o of cs.partners || []) if (o.id === partnerId) o.id = newId;
    }
    // 8) 关系变更历史
    for (const h of db.uplineHistory) {
      if (h.partnerId === partnerId) h.partnerId = newId;
      if (h.oldUpline === partnerId) h.oldUpline = newId;
      if (h.newUpline === partnerId) h.newUpline = newId;
    }
    db.uplineHistory.push({ partnerId: newId, action: 'rename', from: partnerId, to: newId, at: Date.now() });
  }
  // 等级可能变化 → 重算对外编号（YH0001 升天使 → TS0001）
  IZ.recomputeDisplayId(db, u.id);
  return u;
}

/**
 * 修改订单字段（后台「修改ID」功能）。
 * @param {Object} db
 * @param {string} orderId
 * @param {Object} patch { id?, buyer_id?, seller_id?, packageTier?, oldTier?, quotaCount?, regionCode?, actual_paid? }
 */
function updateOrder(db, orderId, patch = {}) {
  const o = db.orders.find((x) => x.id === orderId);
  if (!o) throw new Error('订单不存在: ' + orderId);
  const newId = patch.id != null && String(patch.id).trim() ? String(patch.id).trim() : null;
  const allowed = ['buyer_id', 'seller_id', 'packageTier', 'oldTier', 'quotaCount', 'regionCode', 'actual_paid', 'sellerCost', 'vipCredit'];
  for (const k of allowed) if (patch[k] !== undefined) o[k] = patch[k];
  if (newId && newId !== orderId) {
    if (db.orders.some((x) => x.id === newId)) throw new Error(`订单 ID 已被占用: ${newId}`);
    o.id = newId;
  }
  return o;
}

/**
 * 修改区域代理（级别 / 区域码 / 赠予身份）。
 */
function updateAgent(db, partnerId, patch = {}) {
  const a = db.regionalAgents.find((x) => x.partner_id === partnerId);
  if (!a) throw new Error('该合伙人不是区域代理: ' + partnerId);
  if (patch.region_type && !['province', 'city', 'district', 'store'].includes(patch.region_type)) {
    throw new Error('非法代理级别: ' + patch.region_type);
  }
  // 规则（用户 2026-10-23 17:45）：重新定级为「门店代理」须已为天使合伙人
  if (patch.region_type === 'store') {
    const u = db.users[partnerId];
    if (!u) throw new Error('合伙人不存在: ' + partnerId);
    if ((TIER_RANK[u.tier] || 0) < TIER_RANK[STORE_AGENT_MIN_TIER]) {
      throw new Error('门店代理须先成为天使合伙人（tier ≥ angel）');
    }
  }
  if (patch.region_type) {
    // 换级别要重算资格与赠予身份
    const u = db.users[partnerId];
    if (u) {
      const grant = { province: 'cofounder', city: 'cofounder', district: 'private', store: null }[patch.region_type];
      a.granted_tier = grant;
      if (grant && TIER_RANK[grant] > TIER_RANK[u.tier]) u.tier = grant;
    }
    a.region_type = patch.region_type;
  }
  if (patch.region_code !== undefined) a.region_code = patch.region_code;
  if (patch.parent_code !== undefined) a.parent_code = patch.parent_code; // 父级区域码（结算按父链归集）
  return a;
}

/**
 * 撤销代理（2026-10-24 用户拍板）：
 *   - 摘除 regionalAgents 记录（代理身份消失，代理类提成自此不再产生）；
 *   - 用户打标 agent_revoked_at：对外编号 seq 不变，前缀改 QZ（普通用户，见 identity.js userPrefix）；
 *   - 已赠予的合伙人档位保留不动（撤销只摘代理身份、不降档；如业务后续要降档再议）；
 *   - 历史提成/订单记录不清算。
 * 支持按 agentId 精确定位；未指定且该合伙人有多个代理身份时须传 regionType 消歧。
 */
function revokeAgent(db, { partnerId, agentId, regionType, reason } = {}) {
  const u = getUser(db, partnerId);
  if (!u) throw new Error('合伙人不存在: ' + partnerId);
  const mine = db.regionalAgents.map((a, i) => ({ a, i })).filter(({ a }) => a.partner_id === partnerId);
  if (mine.length === 0) throw new Error('该合伙人没有代理身份: ' + partnerId);
  let hit = null;
  if (agentId) {
    hit = mine.find(({ a }) => a.id === agentId) || null;
    if (!hit) throw new Error('代理记录不存在或不属于该合伙人: ' + agentId);
  } else {
    const cands = regionType ? mine.filter(({ a }) => a.region_type === regionType) : mine;
    if (cands.length === 0) throw new Error('未找到匹配的代理记录' + (regionType ? '（regionType=' + regionType + '）' : ''));
    if (cands.length > 1) throw new Error('该合伙人有多个代理身份，请指定 agentId 或 regionType');
    hit = cands[0];
  }
  const [removed] = db.regionalAgents.splice(hit.i, 1);
  u.agent_revoked_at = new Date().toISOString();
  u.agent_revoked_count = (u.agent_revoked_count || 0) + 1;
  u.agent_revoked_reason = reason || null;
  const displayId = IZ.recomputeDisplayId(db, partnerId); // seq 不变，前缀按规则重算（撤销 → QZ）
  return {
    revoked: true, agentId: removed.id, partnerId, regionType: removed.region_type,
    regionCode: removed.region_code, tierKept: u.tier, displayId, seq: u.seq,
    revokedAt: u.agent_revoked_at,
  };
}

/**
 * 删除合伙人（级联清理关联数据）。受保护：已有下级 / 已有订单 / 已是代理的不可直接删。
 */
function deletePartner(db, partnerId) {
  const u = db.users[partnerId];
  if (!u) throw new Error('用户不存在: ' + partnerId);
  const hasDown = Object.values(db.users).some((x) => x.upline_id === partnerId);
  if (hasDown) throw new Error('该合伙人仍有下级，请先解绑/转移下级');
  const hasOrder = db.orders.some((o) => o.buyer_id === partnerId || o.seller_id === partnerId);
  if (hasOrder) throw new Error('该合伙人已有订单记录，不可删除（可改 ID 或改档位）');
  if (db.regionalAgents.some((a) => a.partner_id === partnerId)) throw new Error('该合伙人是区域代理，请先撤销代理');
  delete db.users[partnerId];
  delete db.quotaLedger[partnerId];
  // 级联清理该用户的关联流水（否则 db.json 会残留孤儿记录，
  // 导致 PostgreSQL 迁移时外键校验失败）
  db.experience = (db.experience || []).filter((x) => x.userId !== partnerId);
  db.promotionTasks = (db.promotionTasks || []).filter((x) => x.userId !== partnerId);
  db.freeUpgradeLog = (db.freeUpgradeLog || []).filter((x) => x.userId !== partnerId);
  db.allocations = (db.allocations || []).filter((x) => x.owner_id !== partnerId && x.userId !== partnerId);
  db.inviteCodes = (db.inviteCodes || []).filter((x) => x.ownerId !== partnerId);
  db.quota_transactions = (db.quota_transactions || []).filter((x) => x.partnerId !== partnerId);
  return { id: partnerId, deleted: true };
}

// ───────────── 代理资格与身份授予（2026-10-22 用户澄清） ─────────────
/**
 * 代理身份获取规则（两种语义，务必分清）：
 *
 *  ① 门店代理（region_type='store'，单店代理 = 天使）
 *      → **前置门槛**：合伙人必须「先成为天使合伙人」才能开门店代理。
 *        即 tier 必须 ≥ angel；开通门店代理**不授予**任何身份，只是叠加一个角色。
 *
 *  ② 区域代理（province / city / district）
 *      → **身份授予**：开通代理即「赠予」对应档身份（不走逐级升档这条普通路径）：
 *        省代理 / 市代理 → 赠 联创；区县代理 → 赠 私董。
 *        若本人当前身份已 ≥ 该档，则不动（不降级）。
 *
 * 映射（与设计文档 §6 一致）：省=联创 / 市=联创 / 区县=私董 / 单店=天使。
 */
const TIER_RANK = { none: 0, vip: 1, angel: 2, private: 3, cofounder: 4 };
// 区域代理开通时「赠予」的身份（门店代理不在此表，因为它需要前置天使）
const AGENT_GRANT_TIER = { province: 'cofounder', city: 'cofounder', district: 'private' };
const STORE_AGENT_MIN_TIER = 'angel'; // 门店代理前置门槛
const VALID_REGION_TYPES = ['province', 'city', 'district', 'store'];

function higherTier(a, b) {
  return (TIER_RANK[a] || 0) >= (TIER_RANK[b] || 0) ? a : b;
}

/**
 * 校验某合伙人能否被任命为某类代理。
 * @returns {{ok:boolean, reason?:string, grantTier?:string|null}}
 */
function validateAgentEligibility(tier, regionType) {
  if (!VALID_REGION_TYPES.includes(regionType)) {
    return { ok: false, reason: `未知代理类型：${regionType}` };
  }
  if (regionType === 'store') {
    if ((TIER_RANK[tier] || 0) < TIER_RANK[STORE_AGENT_MIN_TIER]) {
      return { ok: false, reason: '门店代理须先成为天使合伙人（tier ≥ angel）' };
    }
    return { ok: true, grantTier: null }; // 门店代理不授予身份
  }
  // 区域代理：开通即赠身份，资格本身无门槛
  return { ok: true, grantTier: AGENT_GRANT_TIER[regionType] };
}

/**
 * 任命代理（写入 regional_agent，并按规则处理身份）。
 *
 * 开发人（推荐人）两笔提成（用户 2026-10-23 新规格）：
 *   ① 直推代理奖 = 新代理技术费 × 推荐人合伙人身份的直推奖比例（VIP5/天使10/私董15/联创15）
 *      —— 只算技术费，不算合计（单店代理按 4w 计，非 8w）
 *   ② 业务提成   = 新代理技术费 × 开发代理身份的业务提点（省20/市18/区县15/单店15）
 * 两笔都发、收件人都是开发人，但分别按「合伙人身份」「开发代理身份」计算；
 * 佣金 id 确定性（agdirect-{agentId} / agbiz-{agentId}），重复任命同一记录不会双发。
 *
 * @param {{partnerId:string, regionType:string, regionCode?:string, referrerId?:string, priceTier?:number}} opt
 *   priceTier：新价格表人数档位下标（0 起，越界取最高档）
 * @returns {{agent:object, user:object, granted?:string|null, referrer?:object, commissions:Array}}
 */
function appointAgent(db, { partnerId, regionType, regionCode, parentCode, referrerId, priceTier = 0 }) {
  const u = getUser(db, partnerId);
  if (!u) throw new Error(`合伙人不存在：${partnerId}`);
  const check = validateAgentEligibility(u.tier, regionType);
  if (!check.ok) throw new Error(check.reason);

  let granted = null;
  if (check.grantTier) {
    const before = u.tier;
    u.tier = higherTier(u.tier, check.grantTier); // 仅升不降
    if (u.tier !== before) {
      granted = u.tier;
      // 新晋联创进入 90 天无责期（否则 annotated daysSinceCofounder 缺省 999 → 全球奖不合格）
      if (granted === 'cofounder' && u.daysSinceCofounder == null) u.daysSinceCofounder = 0;
    }
  }

  const agent = {
    id: nextId(db, 'ra'),
    partner_id: partnerId,
    region_type: regionType,
    region_code: regionCode || null,
    parent_code: parentCode || null, // 显式父级区域码（2026-10-24 设计：结算按父链 门店→区县→市→省 归集）
    price_tier: Number(priceTier) || 0,
    referrer_id: referrerId || null,
    granted_tier: check.grantTier || null, // 门店代理为 null（仅叠加角色）
    appointed_at: new Date().toISOString(),
  };
  db.regionalAgents.push(agent);

  // 开发人两笔提成（无开发人时不落账）
  const commissions = [];
  let referrer = null;
  if (referrerId) {
    if (referrerId === partnerId) throw new Error('开发人（推荐人）不能是被任命人本人');
    const ru = getUser(db, referrerId);
    if (!ru) throw new Error(`开发人（推荐人）不存在：${referrerId}`);
    const ra = getRegionalAgent(db, referrerId);
    referrer = { id: ru.id, tier: ru.tier, regionType: ra ? ra.region_type : null };
    const calced = RA.agentAppointmentCommissions(referrer, { regionType, tier: agent.price_tier });
    const period = periodNow();
    if (calced.direct) {
      commissions.push({
        id: `agdirect-${agent.id}`, owner_id: ru.id, type: 'agent', subtype: 'agent_direct', period,
        base_amount: calced.direct.techFee, rate: calced.direct.rate, amount: calced.direct.amount,
        ref_order_id: agent.id, status: 'pending',
        note: `直推代理奖 | ${calced.direct.formula}`,
      });
    }
    if (calced.business) {
      commissions.push({
        id: `agbiz-${agent.id}`, owner_id: ru.id, type: 'agent', subtype: 'agent_biz', period,
        base_amount: calced.business.techFee, rate: calced.business.rate, amount: calced.business.amount,
        ref_order_id: agent.id, status: 'pending',
        note: `业务提成 | ${calced.business.formula}`,
      });
    }
    for (const c of commissions) upsertCommission(db, c);
  }
  // 任命可能赠级（区县代→私董 SD、省/市代→联创 LC）→ 重算对外编号
  IZ.recomputeDisplayId(db, partnerId);
  return { agent, user: u, granted, referrer, commissions };
}

function getRegionalAgent(db, partnerId) {
  return db.regionalAgents.find((x) => x.partner_id === partnerId);
}
/**
 * 是否「门店老板」身份 —— 唯一可以走「门店售出」通道的身份。
 *
 * 用户口径（2026-10-23 16:56 明确）：
 *   · 只有**门店老板**卖出合伙人名额，才算「门店售出」，才计提 3,000/名额 门店服务费；
 *   · 只是**合伙人**身份（VIP/天使/私董/联创档）或**合店老板**身份，一律走「合伙人售卖」通道，
 *     不产生门店服务费；
 *   · 合店股东（coStores.owner_id）和合店店长（coStores.storeManagerId）都**不算**门店老板，
 *     因为它们不是「开店的主体」，只是合店的入股人/受托店长。
 *
 * 判定依据：区域代理表中持有 store 级任命（`region_type='store'`）。
 * @param {Object} db
 * @param {string} userId 卖方 id
 * @returns {boolean}
 */
function isStoreOwner(db, userId) {
  if (!userId) return false;
  return (db.regionalAgents || []).some(
    (a) => a.partner_id === userId && a.region_type === 'store',
  );
}
function listRegionalAgents(db, regionType) {
  return regionType
    ? db.regionalAgents.filter((x) => x.region_type === regionType)
    : db.regionalAgents;
}

// ───────────── 拉人免费升档（2026-10-26 触发逻辑） ─────────────
/**
 * 规则（用户口径）：
 *   上级 U 直推 N 名「与 U 同级（被推荐时 U 的档位）」的下级，且这 N 名下级各自「从同级起步付费升档」，
 *   则 U 免费升 1 档（tier +1，principal_tier 不变 —— 免费升档不动物料本金）。
 *   每满 REQUIRED 名触发一次，可累计（6 名 → 升 2 档）；封顶到联创。
 *
 * 关键语义：
 *   · 「同级」指下级被推荐时，上级所处的档位（referral_upline_tier 快照），不随后续变动漂移；
 *   · 「付费升档」指下级存在 oldTier === referral_upline_tier 且 packageTier 更高的订单（不含免费授级）；
 *   · 免费升档只改 tier，不动 principal_tier（与本金锚点设计一致）。
 */
const FREE_UPGRADE_REQUIRED = 3;
const FREE_UPGRADE_NEXT = { vip: 'angel', angel: 'private', private: 'cofounder' };

/** 下级 downlineId 是否「从 fromTier 起步付费升档」（存在 oldTier===fromTier 且更高档的订单） */
function hasPaidUpgradeFromTier(db, downlineId, fromTier) {
  return db.orders.some(
    (o) =>
      o.buyer_id === downlineId &&
      o.oldTier === fromTier &&
      (TIER_RANK[o.packageTier] || 0) > (TIER_RANK[fromTier] || 0)
  );
}

/** 上级 userId 的「合格下级」id 列表：直推 + 被推荐时与上级同级 + 从同级起步付费升档 */
function qualifyingDownlineIds(db, userId) {
  const U = db.users[userId];
  if (!U) return [];
  return getDirectDownline(db, userId)
    .filter((D) => D.referral_upline_tier != null && hasPaidUpgradeFromTier(db, D.id, D.referral_upline_tier))
    .map((D) => D.id);
}

/**
 * P1-1 规则B（业绩）：直属下级「付费升档」实付金额累计（元）。
 * 仅统计 oldTier → packageTier 为升档的订单（与拉人升档语义一致）。
 */
function referralPerformanceAmount(db, userId) {
  const ids = new Set(getDirectDownline(db, userId).map((d) => d.id));
  return db.orders.reduce((s, o) => {
    if (!ids.has(o.buyer_id)) return s;
    if (o.oldTier == null) return s;
    if ((TIER_RANK[o.packageTier] || 0) <= (TIER_RANK[o.oldTier] || 0)) return s;
    return s + (Number(o.actual_paid) || 0);
  }, 0);
}

/** P1-1 免费升档配置（后台可调，缺省回退常量口径） */
function freeUpgradeConfig(db) {
  const cfg = (getSettings(db) || {}).freeUpgrade || {};
  return {
    enabled: cfg.enabled !== false,
    countRequired: Number(cfg.countRequired) > 0 ? Number(cfg.countRequired) : FREE_UPGRADE_REQUIRED,
    performanceEnabled: !!cfg.performanceEnabled,
    performanceRequired: Number(cfg.performanceRequired) > 0 ? Number(cfg.performanceRequired) : 100000,
  };
}

/** P1-1 两套规则的进度（取较高者作为可发放档数） */
function freeUpgradeProgressDetail(db, userId) {
  const cfg = freeUpgradeConfig(db);
  const qualifying = qualifyingDownlineIds(db, userId);
  const countEarned = Math.floor(qualifying.length / cfg.countRequired);
  const performance = referralPerformanceAmount(db, userId);
  const performanceEarned = cfg.performanceEnabled ? Math.floor(performance / cfg.performanceRequired) : 0;
  return {
    cfg,
    qualifying: qualifying.length,
    countEarned,
    performance,
    performanceEarned,
    earned: Math.max(countEarned, performanceEarned),
    rules: {
      count: { key: 'count', label: `每 ${cfg.countRequired} 名合格下级升 1 档`, required: cfg.countRequired, current: qualifying.length, earned: countEarned, toNext: Math.max(0, (countEarned + 1) * cfg.countRequired - qualifying.length) },
      performance: { key: 'performance', label: `团队升档业绩满 ¥${cfg.performanceRequired} 升 1 档`, enabled: cfg.performanceEnabled, required: cfg.performanceRequired, current: performance, earned: performanceEarned, toNext: Math.max(0, (performanceEarned + 1) * cfg.performanceRequired - performance) },
    },
  };
}

/**
 * 检查并（按需）发放免费升档。幂等：已发放数取 free_upgrade_applied，仅补足差额。
 * @returns {{granted:Array<{fromTier,toTier}>, qualifyingCount:number, earned:number, applied:number}}
 */
function maybeGrantFreeUpgrade(db, userId) {
  const U = db.users[userId];
  if (!U) return { granted: [], qualifyingCount: 0, earned: 0, applied: 0 };
  const d = freeUpgradeProgressDetail(db, userId);
  const qualifying = d.qualifying;
  const earned = d.cfg.enabled ? d.earned : 0;
  const applied = U.free_upgrade_applied || 0;
  const grants = [];
  let n = applied;
  while (n < earned) {
    const next = FREE_UPGRADE_NEXT[U.tier];
    if (!next) break; // 已联创，封顶
    const fromTier = U.tier;
    U.tier = next;
    if (next === 'cofounder' && U.daysSinceCofounder == null) U.daysSinceCofounder = 0;
    IZ.recomputeDisplayId(db, userId);
    n++;
    grants.push({ fromTier, toTier: next });
  }
  if (grants.length) {
    U.free_upgrade_applied = n;
    db.freeUpgradeLog.push({
      uplineId: userId,
      fromTier: grants[0].fromTier,
      toTier: U.tier,
      qualifyingCount: qualifying,
      required: d.cfg.countRequired,
      rule: d.rules.count.earned >= d.rules.performance.earned ? 'count' : 'performance',
      at: Date.now(),
    });
  }
  return { granted: grants, qualifyingCount: qualifying, earned, applied: n };
}

/** 上级免费升档进度（供前端展示） */
function referralFreeUpgradeProgress(db, userId) {
  const U = db.users[userId];
  if (!U) return null;
  const d = freeUpgradeProgressDetail(db, userId);
  const applied = U.free_upgrade_applied || 0;
  const earned = d.cfg.enabled ? d.earned : 0;
  const next = FREE_UPGRADE_NEXT[U.tier] || null;
  return {
    required: d.cfg.countRequired,     // 规则A 阈值（保持历史字段含义）
    qualifying: d.qualifying,
    applied,
    earned,
    pending: Math.max(0, earned - applied),
    nextTier: next,
    // P1-1 两套规则的明细（新增）
    enabled: d.cfg.enabled,
    rules: d.rules,
    activeRule: d.rules.count.earned >= d.rules.performance.earned ? 'count' : 'performance',
  };
}

module.exports = {
  createDb, nextId, addUser, getUser, getUserByPhone, addOrder, pushCommission, upsertCommission,
  commissionSummary, getDirectDownline, collectSubtree, tree, subtreeVip, annotateCofounders, unbind, rebind,
  addCoStore, getCoStore, isCostoreOwner, periodNow,
  DEFAULT_SETTINGS, getSettings, updateSettings,
  updatePartner, updateOrder, updateAgent, revokeAgent, deletePartner,
  TIER_RANK, AGENT_GRANT_TIER, STORE_AGENT_MIN_TIER, VALID_REGION_TYPES, higherTier,
  validateAgentEligibility, appointAgent, getRegionalAgent, listRegionalAgents, isStoreOwner,
  FREE_UPGRADE_REQUIRED, FREE_UPGRADE_NEXT, hasPaidUpgradeFromTier, qualifyingDownlineIds,
  maybeGrantFreeUpgrade, referralFreeUpgradeProgress,
  referralPerformanceAmount, freeUpgradeConfig, freeUpgradeProgressDetail,
};

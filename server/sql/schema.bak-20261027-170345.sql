-- ════════════════════════════════════════════════════════════════════════════
-- 脑商AI 合伙人 · 关系型数据库 Schema v2（SQLite / PostgreSQL 兼容语法）
-- 设计依据：src/store.js createDb() 运行时集合 + src/routes/h5.js + h5biz.js 契约层集合
--
-- v2 变更（2026-10-24，对齐「统一用户身份与 ID 编号模型」v1.1）：
--   1. partners 表更名 users（主表 = 人）：所有人都是用户，代理/合店是身上的角色，
--      由 regional_agents / co_stores 关联表承载，一人可同时多身份；
--   2. users 新增统一编号字段：seq（全局注册序号，四位起步不截断）+
--      display_id（对外编号 = 身份前缀 + seq，如 LC0001/SD0002/TS0003/VIP0004/QZ0008）；
--      前缀由 entitlement_state + tier 派生，见 docs/用户身份与ID编号设计.md；
--   3. users 新增权益三态字段：entitlement_state（never_paid/active/expired）+
--      entitlement_paid_at + entitlement_expires_at（200 元权益收益费门禁：
--      未开通 = QZ 前缀 + 全功能锁；过期 = 佣金引擎停算，仅可导出历史账单）；
--   4. 新增契约层表（H5 端到端）：sms_codes / password_resets / entitlement_orders /
--      withdrawals / pay_accounts / applications / store_transfers / members /
--      activation_codes / coaches / addresses / coupons / support_feedback /
--      learning_progress / allocations / training_feedback / assets /
--      material_renders / jobs；
--   5. 新增 counters 表（userSeq 全局注册序号计数器，替代旧 userSeq 顶层字段）。
--
-- 说明：金额一律 REAL（元，2 位小数）；JSON 字段（数组/嵌套对象）用 TEXT 存 JSON 字符串。
--   SQLite 外键需每连接执行 PRAGMA foreign_keys=ON 才生效。
--   运行时快照（data/db.json）字段名为 camelCase，本 schema 规范化为 snake_case。
-- ════════════════════════════════════════════════════════════════════════════

PRAGMA foreign_keys = ON;

-- ───────────── 0) 全局计数器 ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈
-- userSeq：用户全局注册序号（对外编号数字部分，四位起步，超宽不截断）；
-- seq：内部 id 生成计数器（u_/o_/c_/ra_/cs_/app/adr/... 共用）。
CREATE TABLE IF NOT EXISTS counters (
  name  TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 1
);
INSERT OR IGNORE INTO counters (name, value) VALUES ('userSeq', 1);
INSERT OR IGNORE INTO counters (name, value) VALUES ('seq', 1);

-- ───────────── 1) users 用户主表（人；原 partners 表，v2 更名）┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈
-- 业务约定：联创 / 省代 / 市代 / 私董 / 天使 / VIP / 普通 / 合店老板 / 代理 全是 users 行；
--   等级与身份只是行上的属性或关联行，不是独立表。
CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,                 -- 内部 ID（如 p1 / u_xxx）
  seq             INTEGER NOT NULL UNIQUE,          -- 全局注册序号（1,2,3…；第 10000 名即 10000）
  display_id      TEXT NOT NULL UNIQUE,             -- 对外编号：前缀+seq（QZ/YH/VIP/TS/SD/LC 六前缀）
  name            TEXT NOT NULL DEFAULT '',
  phone           TEXT NOT NULL UNIQUE,             -- 注册手机号（应用层 409 唯一校验，此处兜底）
  password        TEXT NOT NULL DEFAULT '',         -- 登录口令（自 2026年10月26 起存 scrypt 哈希串 scrypt$salt$hash；历史明文由启动迁移自动升级）
  password_migrated_at INTEGER,                     -- 明文→哈希的迁移时间（毫秒时间戳）
  tier            TEXT NOT NULL DEFAULT 'none',      -- none/vip/angel/private/cofounder（能力档位）
  is_founding     TEXT NOT NULL DEFAULT 'none',      -- 'founding'（持创始奖）/ 'none'
  upline_id       TEXT REFERENCES users(id) ON DELETE RESTRICT,  -- 直接上级（推荐链）
  team_vip        INTEGER NOT NULL DEFAULT 0,        -- 团队 VIP 计数（缓存）
  annual_fee_paid INTEGER NOT NULL DEFAULT 1,        -- 年费是否已缴
  -- ── 权益收益费三态（200 元门禁；过期 = 佣金引擎全部停算，仅可导出历史账单）──
  entitlement_state     TEXT NOT NULL DEFAULT 'never_paid'
                        CHECK (entitlement_state IN ('never_paid','active','expired')),
  entitlement_paid_at   INTEGER,                     -- 权益实付时间（毫秒时间戳，与运行时一致）
  entitlement_expires_at INTEGER,                    -- 权益到期时间（毫秒；惰性判定：< now 即 expired）
  -- ── 扩展 ──
  role           TEXT,                               -- 登录通道角色：user/parent/coach/admin（缺省由 tier 推导）
  avatar         TEXT,                               -- 头像（assets.id 或 URL）
  wechat_openid  TEXT,                               -- 微信授权 Mock 占位
  created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_users_upline   ON users(upline_id);
CREATE INDEX IF NOT EXISTS idx_users_tier     ON users(tier);
CREATE INDEX IF NOT EXISTS idx_users_entitle  ON users(entitlement_state);

-- 向后兼容视图：旧 SQL/报表里的 partners 别名（v1 查询无需改写）
CREATE VIEW IF NOT EXISTS partners AS
SELECT id, name, phone, tier, is_founding, upline_id, team_vip AS team_vip,
       annual_fee_paid, seq, display_id, entitlement_state, created_at
FROM users;

-- ───────────── 2) 订单 / 销售（收益销售来源）┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈
CREATE TABLE IF NOT EXISTS orders (
  id            TEXT PRIMARY KEY,
  buyer_id      TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,   -- 购买方（升档者）
  seller_id     TEXT REFERENCES users(id) ON DELETE RESTRICT,            -- 供货方（推荐人/上级）
  package_tier  TEXT NOT NULL,                    -- vip/angel/private/cofounder
  old_tier      TEXT,                             -- 升档前档（null=原始名额售卖）
  quota_count   INTEGER NOT NULL DEFAULT 1,        -- 消耗名额
  vip_credit    INTEGER NOT NULL DEFAULT 1,        -- 计入全球奖的 VIP 增量
  actual_paid   REAL NOT NULL DEFAULT 0,           -- 客户实付
  seller_cost   REAL NOT NULL DEFAULT 0,           -- 卖方拿货成本
  supply_spread REAL NOT NULL DEFAULT 0,           -- 供货差价（≤0 不落账）
  store_fee     REAL NOT NULL DEFAULT 0,           -- 门店服务费（仅门店渠道；月度结算拆四级）
  hq_fee        REAL NOT NULL DEFAULT 0,           -- 总部产品费（含全球/创始奖）
  region_code   TEXT,                              -- 归属区域（门店费按区域码精确匹配）
  channel       TEXT NOT NULL DEFAULT 'partner',   -- 成交渠道：store=门店老板售出 / partner=合伙人售卖
  store_id      TEXT,                              -- 成交门店（channel=store 时记录）
  status        TEXT NOT NULL DEFAULT 'paid',
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_orders_buyer  ON orders(buyer_id);
CREATE INDEX IF NOT EXISTS idx_orders_seller ON orders(seller_id);
CREATE INDEX IF NOT EXISTS idx_orders_region ON orders(region_code);

-- ───────────── 3) 收益明细（佣金；全球奖/直推奖/复购奖/创始奖/代理奖/合店分配全类型）┈┈┈
-- 引擎级门禁：users.entitlement_state='expired' 时全部类型停算（不再 INSERT）。
CREATE TABLE IF NOT EXISTS commissions (
  id           TEXT PRIMARY KEY,
  owner_id     TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,    -- 收益归属人
  identity     TEXT NOT NULL DEFAULT 'partner'
               CHECK (identity IN ('partner','costore','agent')),           -- 收益归属身份（三身份分账口径）
  type         TEXT NOT NULL,                     -- supply/parity/global/founding/agent/costore/product
  subtype      TEXT,                               -- 如 agent_direct/agent_biz/storeService/businessDirect/partner_product
  period       TEXT,                               -- 结算月 YYYY-MM
  base_amount  REAL DEFAULT 0,
  rate         REAL,                               -- 比例（可为 null，如定额拆分）
  amount       REAL NOT NULL DEFAULT 0,             -- 实际收益金额
  ref_order_id TEXT REFERENCES orders(id) ON DELETE SET NULL,  -- 关联订单（可空）
  status       TEXT NOT NULL DEFAULT 'pending',     -- pending/settled
  note         TEXT,
  formula      TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_commissions_owner ON commissions(owner_id);
CREATE INDEX IF NOT EXISTS idx_commissions_ref   ON commissions(ref_order_id);
CREATE INDEX IF NOT EXISTS idx_commissions_type  ON commissions(type, period);
CREATE INDEX IF NOT EXISTS idx_commissions_ident ON commissions(identity, period);

-- ───────────── 4) 名额台账（余额 + 流水）┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈
-- 口径（2026-10-26 P0-3）：标准名额 / 活动名额 两桶分开记账；
--   活动名额带 1 年有效期（默认 365 天，后台 settings.quota.activityValidityDays 可配）。
CREATE TABLE IF NOT EXISTS quota_ledger (
  user_id  TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  standard INTEGER NOT NULL DEFAULT 0               -- 标准 VIP 名额余额（可划拨、可用于任意升级）
);
CREATE TABLE IF NOT EXISTS quota_activity_batches (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  qty         INTEGER NOT NULL,
  obtained_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  expire_at   TEXT NOT NULL                          -- 活动名额到期时间（先过期先扣）
);
CREATE INDEX IF NOT EXISTS idx_quota_batches_user   ON quota_activity_batches(user_id);
CREATE INDEX IF NOT EXISTS idx_quota_batches_expire ON quota_activity_batches(expire_at);

CREATE TABLE IF NOT EXISTS quota_transactions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  op            TEXT NOT NULL,                      -- issue（发放）/ consume（消耗）
  kind          TEXT,                               -- standard / activity（发放类型；消耗时为混合来源）
  used_standard INTEGER NOT NULL DEFAULT 0,         -- 本次扣减的标准名额数
  used_activity INTEGER NOT NULL DEFAULT 0,         -- 本次扣减的活动名额数
  amount        REAL NOT NULL DEFAULT 0,            -- 兼容旧语义：额度变动量
  ref           TEXT,                               -- 关联订单号 / 发放来源 / 操作备注
  operator_id   TEXT,                               -- 操作人（后台发放人或下单用户）
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_quota_tx_user ON quota_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_quota_tx_ref  ON quota_transactions(ref);

-- ───────────── 5) 区域代理（省/市/县区/门店；关联表 = 角色）┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈
CREATE TABLE IF NOT EXISTS regional_agents (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,     -- 代理身份归属人
  region_type   TEXT NOT NULL,                      -- province/city/district/store
  region_code   TEXT,                               -- 区域码（门店费精确匹配键）
  price_tier    INTEGER NOT NULL DEFAULT 0,          -- 新价格表人数档位
  referrer_id   TEXT REFERENCES users(id) ON DELETE SET NULL,             -- 开发人（推荐人）
  granted_tier  TEXT,                               -- 开通时赠予身份（门店代理为 null）
  appointed_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_agents_user   ON regional_agents(user_id);
CREATE INDEX IF NOT EXISTS idx_agents_region ON regional_agents(region_type, region_code);

-- ───────────── 6) 合店 / 门店（含合店老板名单 1:N）┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈
CREATE TABLE IF NOT EXISTS co_stores (
  id              TEXT PRIMARY KEY,
  owner_id        TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,  -- 缴纳合店费者（合店老板）
  promoter_id     TEXT REFERENCES users(id) ON DELETE SET NULL,            -- 推荐人（可能为合店老板）
  store_manager_id TEXT REFERENCES users(id) ON DELETE SET NULL,           -- 门店店长/门店股东（拿 40% 服务）
  store_id        TEXT,                               -- 所属门店标识（单店分红分组键）
  monthly_fee     REAL NOT NULL DEFAULT 698,           -- 合店费月费
  owner_count     INTEGER NOT NULL DEFAULT 1,          -- 门店老板人数
  join_date       TEXT,                               -- 入股年月（无责分红首月判定）
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_costores_owner  ON co_stores(owner_id);
CREATE INDEX IF NOT EXISTS idx_costores_store  ON co_stores(store_id);

CREATE TABLE IF NOT EXISTS co_store_owners (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  co_store_id TEXT NOT NULL REFERENCES co_stores(id) ON DELETE CASCADE,       -- 所属合店
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,        -- 合店老板（本店）
  performance REAL NOT NULL DEFAULT 0,                -- 本人当月销售业绩（分红用，不含合店费）
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (co_store_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_cso_costore ON co_store_owners(co_store_id);
CREATE INDEX IF NOT EXISTS idx_cso_user    ON co_store_owners(user_id);

-- ───────────── 7) 关系变更历史 ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈
CREATE TABLE IF NOT EXISTS upline_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  old_upline  TEXT REFERENCES users(id) ON DELETE SET NULL,
  new_upline  TEXT REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT,                                  -- unbind/rebind/rename...
  at          TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_upline_hist_user ON upline_history(user_id);

-- ───────────── 8) 后台配置 ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈
CREATE TABLE IF NOT EXISTS settings (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  key   TEXT NOT NULL UNIQUE,
  value TEXT                                     -- JSON 字符串（costore 配置等）
);

-- ───────────── 9) 结算批次 ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈
CREATE TABLE IF NOT EXISTS settlements (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  period    TEXT NOT NULL,                        -- 结算月 YYYY-MM
  run_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  summary   TEXT                                  -- JSON 汇总（byType/total/agentBreakdown...）
);

-- ═══════════════════ 契约层（H5 前端 RESTful；集合见 routes/h5.js、routes/h5biz.js）═══════════════════

-- ───────────── 10) 短信验证码（scene 隔离：register/reset-password 互不混用）┈┈┈┈┈┈┈
CREATE TABLE IF NOT EXISTS sms_codes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  phone      TEXT NOT NULL,
  code       TEXT NOT NULL,
  purpose    TEXT NOT NULL DEFAULT 'register',     -- register / reset-password
  expires_at INTEGER NOT NULL,                     -- 毫秒时间戳
  used       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_sms_phone ON sms_codes(phone, used);

-- ───────────── 11) 密码重置凭据 ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈
CREATE TABLE IF NOT EXISTS password_resets (
  ticket     TEXT PRIMARY KEY,
  phone      TEXT NOT NULL,
  expires_at INTEGER NOT NULL,                     -- 毫秒时间戳（10 分钟）
  used       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ───────────── 12) 权益收益费订单（200 元门禁；幂等键 + 三段式）┈┈┈┈┈┈┈┈┈┈┈┈┈┈
CREATE TABLE IF NOT EXISTS entitlement_orders (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  idempotency_key TEXT NOT NULL UNIQUE,            -- 幂等键（重复提交返回同一结果）
  operation_id    TEXT NOT NULL,                   -- 操作流水号 op_xxx
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount          REAL NOT NULL DEFAULT 200,       -- 权益收益费金额（元）
  status          TEXT NOT NULL DEFAULT 'SUCCEEDED', -- 当前为免支付直通占位；正式收银台接入后三段式
  note            TEXT,
  at              INTEGER NOT NULL,                -- 毫秒时间戳
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_ento_user ON entitlement_orders(user_id);

-- ───────────── 13) 收款账户（提现打款目标；卡号脱敏存储）┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈
CREATE TABLE IF NOT EXISTS pay_accounts (
  token              TEXT PRIMARY KEY,             -- payee_xxx（对外凭据，不暴露库内主键）
  user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_type       TEXT NOT NULL,                -- 账户类型（银行卡/支付宝/微信…）
  name               TEXT NOT NULL,                -- 户名
  bank_name          TEXT NOT NULL DEFAULT '',     -- 开户行
  bank_number        TEXT NOT NULL DEFAULT '',     -- 完整账号（仅本表；接口只回 masked）
  masked_bank_number TEXT NOT NULL DEFAULT '',     -- 脱敏账号 ****1234
  created_at         TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_payee_user ON pay_accounts(user_id);

-- ───────────── 14) 提现单（手续费 0.6% 最低 1 元；审核流未接正式打款）┈┈┈┈┈┈
CREATE TABLE IF NOT EXISTS withdrawals (
  id                 TEXT PRIMARY KEY,
  user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title              TEXT NOT NULL DEFAULT '余额提现',
  amount             REAL NOT NULL,                -- 提现金额（元）
  fee                REAL NOT NULL DEFAULT 0,      -- 手续费（0.6%，最低 1 元）
  net_amount         REAL NOT NULL DEFAULT 0,      -- 实际到账 = amount − fee
  status             TEXT NOT NULL DEFAULT 'PENDING_REVIEW'
                       CHECK (status IN ('PENDING_REVIEW','APPROVED','REJECTED','PAID','FAILED')),
  account_type       TEXT NOT NULL,
  account_name       TEXT NOT NULL DEFAULT '',
  bank_name          TEXT NOT NULL DEFAULT '',
  masked_bank_number TEXT NOT NULL DEFAULT '',
  operation_id       TEXT NOT NULL,                -- op_xxx
  idempotency_key    TEXT UNIQUE,
  reject_reason      TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_wdl_user ON withdrawals(user_id);
CREATE INDEX IF NOT EXISTS idx_wdl_status ON withdrawals(status);

-- ───────────── 15) 申请单（合伙人/健脑官/合店/代理/转店 统一流）┈┈┈┈┈┈┈┈┈┈
CREATE TABLE IF NOT EXISTS applications (
  id                 TEXT PRIMARY KEY,
  type               TEXT NOT NULL,                -- COSTORE/TRANSFER/AGENT/PARTNER/COACH...
  title              TEXT NOT NULL DEFAULT '',
  application_status TEXT NOT NULL DEFAULT 'PENDING_REVIEW'
                       CHECK (application_status IN ('PENDING_REVIEW','APPROVED','REJECTED','CANCELLED')),
  payment_status     TEXT NOT NULL DEFAULT 'NOT_STARTED'
                       CHECK (payment_status IN ('NOT_STARTED','PAID','REFUNDED')),
  contract_status    TEXT NOT NULL DEFAULT 'NOT_SIGNED'
                       CHECK (contract_status IN ('NOT_SIGNED','SIGNED')),
  entitlement_status TEXT NOT NULL DEFAULT 'NOT_OPEN'
                       CHECK (entitlement_status IN ('NOT_OPEN','OPEN','EXPIRED')),
  user_id            TEXT REFERENCES users(id) ON DELETE SET NULL,   -- 申请人（家长账号）
  member_id          TEXT,                         -- 关联会员（转店场景）
  store_id           TEXT,                         -- 目标门店（regional_agents.store 或门店标识）
  store_agent_id     TEXT,                         -- 门店代理记录
  target_store_id    TEXT,                         -- 转店目标门店
  agency_type        TEXT,                         -- 代理类型（省代/市代/县区代…）
  payable_amount     REAL NOT NULL DEFAULT 0,      -- 应付金额（元）
  store              TEXT,                         -- 门店快照 JSON
  idempotency_key    TEXT UNIQUE,
  created_at         TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  version            INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_app_user   ON applications(user_id);
CREATE INDEX IF NOT EXISTS idx_app_status ON applications(application_status);

-- ───────────── 16) 转店申请 ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈
CREATE TABLE IF NOT EXISTS store_transfers (
  id              TEXT PRIMARY KEY,
  member_id       TEXT NOT NULL,                   -- 转店会员（members.id）
  from_store_id   TEXT,                            -- 原门店
  target_store_id TEXT NOT NULL,                   -- 目标门店
  reason          TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED','CANCELLED')),
  user_id         TEXT REFERENCES users(id) ON DELETE SET NULL,
  store_agent_id  TEXT,
  idempotency_key TEXT UNIQUE,
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  version         INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_trs_member ON store_transfers(member_id);

-- ───────────── 17) 家庭会员（孩子档案；六级会员等级 + 板块权益）┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈
-- 会员等级阶梯（2026-10-24 产品规则）：normal(普通/游客,QZ) < fs(粉丝,FS) < jy(1阶菁英,JY)
--   < cj(1阶超级,CJ) < xn(2阶行能,XN) < ys(3阶羿烁,YS)。
--   编号 = 等级前缀 + memberSeq（第几个添加第几）；升级只变前缀、编号不变（FS3000→CJ3000）。
--   权益：等级分 ≥ 板块要求分即解锁该板块全部课程（粉丝→菁英→超级→行能→羿烁逐级累积）。
CREATE TABLE IF NOT EXISTS members (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,   -- 家长账号
  name            TEXT NOT NULL DEFAULT '',
  grade_code      TEXT NOT NULL DEFAULT '',        -- K1/K2/K3/G1..G6
  grade_label     TEXT NOT NULL DEFAULT '',
  gender_code     TEXT NOT NULL DEFAULT '',
  gender_label    TEXT NOT NULL DEFAULT '',
  avatar_asset_id TEXT,                            -- 头像资源（assets.id）
  avatar_url      TEXT,                            -- 头像地址（冗余，读时免关联）
  store_id        TEXT,                            -- 绑入门店（健脑官归属）
  activated       INTEGER NOT NULL DEFAULT 0,
  member_level    TEXT NOT NULL DEFAULT 'normal'
                   CHECK (member_level IN ('normal','fs','jy','cj','xn','ys')),  -- 孩子会员等级
  member_seq      INTEGER NOT NULL UNIQUE,         -- 孩子全局添加序号（第几个添加第几）
  display_id      TEXT NOT NULL UNIQUE,            -- 孩子对外编号：等级前缀+member_seq
  unlocked_levels TEXT NOT NULL DEFAULT '[]',      -- JSON：历史 level 激活码单开的等级（兼容）
  unlocked_columns TEXT NOT NULL DEFAULT '[]',     -- JSON：已解锁栏目 id 数组
  training        TEXT NOT NULL DEFAULT '{}',      -- JSON：培训额度（trainingTotal/Used/special…）
  idempotency_key TEXT UNIQUE,
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  version         INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_members_user  ON members(user_id);
CREATE INDEX IF NOT EXISTS idx_members_store ON members(store_id);

-- 家长编号随孩子等级派生（口径见 identity.js userPrefix）：
--   权益未开通/过期 → QZ；否则「跟着最高孩子等级走，不与家长档位比高低」（无已激活孩子才保留家长档位）。
-- 家长对外编号派生视图（与 identity.js userPrefix 一致）：
--   权益非 active → QZ（门禁绝对优先，运行时为准）；有已激活孩子(最高分>0) → 孩子最高等级前缀
--   （家长跟着孩子走，不与家长档位比高低）；无孩子/孩子全是普通游客 → 家长档位前缀
CREATE VIEW IF NOT EXISTS v_parent_display_id AS
SELECT u.id AS user_id,
       u.display_id AS parent_display_id,
       COALESCE(MAX(CASE m.member_level
         WHEN 'ys' THEN 5 WHEN 'xn' THEN 4 WHEN 'cj' THEN 3
         WHEN 'jy' THEN 2 WHEN 'fs' THEN 1 ELSE 0 END), 0) AS best_member_score,
       CASE u.tier WHEN 'cofounder' THEN 4 WHEN 'private' THEN 3
                   WHEN 'angel' THEN 2 WHEN 'vip' THEN 1 ELSE 0 END AS tier_score,
       CASE
         WHEN COALESCE(MAX(CASE m.member_level
           WHEN 'ys' THEN 5 WHEN 'xn' THEN 4 WHEN 'cj' THEN 3
           WHEN 'jy' THEN 2 WHEN 'fs' THEN 1 ELSE 0 END), 0) > 0
           THEN CASE MAX(CASE m.member_level
                  WHEN 'ys' THEN 5 WHEN 'xn' THEN 4 WHEN 'cj' THEN 3
                  WHEN 'jy' THEN 2 WHEN 'fs' THEN 1 ELSE 0 END)
                WHEN 5 THEN 'YS' WHEN 4 THEN 'XN' WHEN 3 THEN 'CJ'
                WHEN 2 THEN 'JY' WHEN 1 THEN 'FS' ELSE 'QZ' END
         ELSE CASE u.tier WHEN 'cofounder' THEN 'LC' WHEN 'private' THEN 'SD'
                          WHEN 'angel' THEN 'TS' WHEN 'vip' THEN 'VIP' ELSE 'YH' END
       END AS derived_prefix
FROM users u
LEFT JOIN members m ON m.user_id = u.id
GROUP BY u.id, u.display_id, u.tier;

-- ───────────── 18) 激活码（level=学习等级单开 / column=栏目 / fs·jy·cj·xn·ys=孩子会员等级）┈┈┈
-- 会员等级码获取方式：fs=门店缴费19.9 / jy=门店缴费3990 / cj=家长开通VIP合伙人后上级赠码 /
--   xn·ys=家长开通天使合伙人后上级赠码（激活时校验家长档位门槛，只升不降）。
CREATE TABLE IF NOT EXISTS activation_codes (
  code       TEXT PRIMARY KEY,
  target_type TEXT NOT NULL,                       -- level/column/fs/jy/cj/xn/ys（兼容旧 member=fs）
  target_id  TEXT,                                 -- 目标 id（会员等级码为 null）
  max_uses   INTEGER NOT NULL DEFAULT 1,
  uses       INTEGER NOT NULL DEFAULT 0,
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','void')),
  expires_at INTEGER NOT NULL,                     -- 毫秒时间戳
  used_by    TEXT NOT NULL DEFAULT '[]',           -- JSON：核销台账 [{memberId, at, channel, issuedBy}]
  -- ── 发放与绑定（2026-10-24 用户拍板：门店收款发码 / 上级赠码）──
  channel    TEXT NOT NULL DEFAULT 'admin' CHECK (channel IN ('admin','store','upline')), -- 发放渠道
  store_id   TEXT,                                 -- 门店发码：代理区域码（agency 渠道）
  issued_by  TEXT,                                 -- 发放人（userId；admin 渠道为 'admin'）
  issued_to  TEXT REFERENCES users(id) ON DELETE SET NULL, -- 绑定家长（赠码）：仅此人可激活
  batch_id   TEXT,                                 -- 批量发放批次号
  note       TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_codes_channel ON activation_codes(channel);
CREATE INDEX IF NOT EXISTS idx_codes_issued_to ON activation_codes(issued_to);

-- ───────────── 19) 健脑官（门店独立登录账号）┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈
CREATE TABLE IF NOT EXISTS coaches (
  id                TEXT PRIMARY KEY,
  store_id          TEXT NOT NULL,                 -- 所属门店
  name              TEXT NOT NULL DEFAULT '',
  login_account     TEXT NOT NULL,                 -- 登录账号（手机号）
  status            TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISABLED')),
  invitation_status TEXT NOT NULL DEFAULT 'PENDING'
                      CHECK (invitation_status IN ('PENDING','ACCEPTED','REJECTED')),
  idempotency_key   TEXT UNIQUE,
  created_at        TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  version           INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_coaches_store ON coaches(store_id);

-- ───────────── 20) 收货地址 ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈
CREATE TABLE IF NOT EXISTS addresses (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient    TEXT NOT NULL DEFAULT '',
  phone        TEXT NOT NULL DEFAULT '',
  region_codes TEXT NOT NULL DEFAULT '[]',         -- JSON：行政区划码数组
  region_names TEXT NOT NULL DEFAULT '[]',         -- JSON：行政区划名数组
  detail       TEXT NOT NULL DEFAULT '',
  is_default   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  version      INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_adr_user ON addresses(user_id);

-- ───────────── 21) 优惠券 ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈
CREATE TABLE IF NOT EXISTS coupons (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title           TEXT NOT NULL DEFAULT '',
  discount_amount REAL NOT NULL DEFAULT 0,
  threshold_text  TEXT NOT NULL DEFAULT '',        -- 门槛文案（满 X 元可用）
  scope_label     TEXT NOT NULL DEFAULT '',        -- 适用范围文案
  status          TEXT NOT NULL DEFAULT 'available'
                   CHECK (status IN ('available','used','void')),
  expires_at      INTEGER NOT NULL,                -- 毫秒时间戳
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_cpn_user ON coupons(user_id);

-- ───────────── 22) 客服反馈 ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈
CREATE TABLE IF NOT EXISTS support_feedback (
  id              TEXT PRIMARY KEY,
  user_id         TEXT REFERENCES users(id) ON DELETE SET NULL,
  content         TEXT NOT NULL DEFAULT '',
  image_asset_ids TEXT NOT NULL DEFAULT '[]',      -- JSON：图片资源 id 数组
  idempotency_key TEXT UNIQUE,
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ───────────── 23) 学习进度（会员 × 等级 × 章节）┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈
CREATE TABLE IF NOT EXISTS learning_progress (
  member_id       TEXT NOT NULL,
  level_id        TEXT NOT NULL,
  chapter_id      TEXT NOT NULL,
  position_seconds REAL NOT NULL DEFAULT 0,
  duration_seconds REAL NOT NULL DEFAULT 0,
  completed       INTEGER NOT NULL DEFAULT 0,
  updated_at      INTEGER NOT NULL,                -- 毫秒时间戳
  PRIMARY KEY (member_id, level_id, chapter_id)
);

-- ───────────── 24) 收益分配（门店服务费/合店分红 指向具体受益人）┈┈┈┈┈┈┈┈┈
CREATE TABLE IF NOT EXISTS allocations (
  id              TEXT PRIMARY KEY,
  entry_id        TEXT NOT NULL,                   -- 关联收益条目（commissions.id）
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,   -- 操作人（店长/老板）
  target_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,   -- 受益人
  beneficiary_name TEXT NOT NULL DEFAULT '',
  kind            TEXT NOT NULL CHECK (kind IN ('sales','inspection')),  -- 销售/巡检 分配
  percent         REAL NOT NULL DEFAULT 0,
  amount          REAL NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'PENDING_SETTLEMENT'
                   CHECK (status IN ('PENDING_SETTLEMENT','SETTLED','CANCELLED')),
  operation_id    TEXT NOT NULL,
  idempotency_key TEXT UNIQUE,
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_alc_entry ON allocations(entry_id);

-- ───────────── 25) 训练反馈（家长/健脑官 → 会员）┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈
CREATE TABLE IF NOT EXISTS training_feedback (
  id                 TEXT PRIMARY KEY,
  member_id          TEXT NOT NULL,                -- members.id
  kind               TEXT NOT NULL DEFAULT '',
  title              TEXT NOT NULL DEFAULT '',
  text               TEXT NOT NULL DEFAULT '',
  coach_id           TEXT,                         -- 健脑官（coaches.id）
  coach_name         TEXT NOT NULL DEFAULT '',
  image_asset_ids    TEXT NOT NULL DEFAULT '[]',   -- JSON
  attachment_asset_ids TEXT NOT NULL DEFAULT '[]', -- JSON
  idempotency_key    TEXT UNIQUE,
  created_at         TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_tfb_member ON training_feedback(member_id);

-- ───────────── 26) 上传资源（直传占位；状态机 PENDING→READY/FAILED）┈┈┈┈┈┈┈┈
CREATE TABLE IF NOT EXISTS assets (
  id          TEXT PRIMARY KEY,
  user_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  purpose     TEXT NOT NULL,                       -- avatar/material-qr/feedback-image...
  file_name   TEXT NOT NULL DEFAULT '',
  mime_type   TEXT NOT NULL DEFAULT '',
  size        INTEGER NOT NULL DEFAULT 0,          -- 字节
  status      TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','READY','FAILED')),
  preview_url TEXT,                                -- Mock CDN 地址
  fail_reason TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_assets_user ON assets(user_id);

-- ───────────── 27) 素材渲染记录（海报合成幂等键）┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈
CREATE TABLE IF NOT EXISTS material_renders (
  id              TEXT PRIMARY KEY,
  material_id     TEXT NOT NULL,
  qr_asset_id     TEXT NOT NULL,
  user_id         TEXT REFERENCES users(id) ON DELETE SET NULL,
  idempotency_key TEXT UNIQUE,
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ───────────── 28) 异步任务（海报合成等；queued→running→succeeded/failed）┈┈┈┈┈
-- ───────────── 22) 支付单（2026-10-24 用户拍板：微信/支付宝/银行卡 + 银联）┈┈┈
-- 渠道与业务：wechat/alipay/bank_card → 200 权益收益费、合伙人年度权益；
--            unionpay（银联）→ 联创向总部购买 VIP 名额。
-- 模式：PAYMENT_MODE=sandbox（默认，下单即 PAID 直通）| live（渠道 SDK + 异步通知验签入账）。
CREATE TABLE IF NOT EXISTS payments (
  id             TEXT PRIMARY KEY,
  -- 2026-10-27 修正：此前只允许 3 种，但实际业务有 5 种
  --   （product_order=商城商品订单 / upgrade=合伙人升档），
  --   商品订单支付单迁移 PostgreSQL 时会被 CHECK 约束拒绝 → 支付流水丢失。
  biz_type       TEXT NOT NULL CHECK (biz_type IN ('entitlement','annual_fee','quota_purchase','product_order','upgrade')),
  biz_id         TEXT,                             -- 关联业务单 id（可选）
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount         REAL NOT NULL,                    -- 元
  channel        TEXT NOT NULL CHECK (channel IN ('wechat','alipay','bank_card','unionpay')),
  subject        TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'CREATED'
                   CHECK (status IN ('CREATED','PAID','SUCCEEDED','PROCESSING','FAILED','CLOSED','CANCELLED')),
  transaction_id TEXT,                             -- 渠道流水号
  idempotency_key TEXT UNIQUE,                     -- 幂等键（重复下单返回原单）
  pay_params     TEXT NOT NULL DEFAULT '{}',       -- JSON：渠道调起参数（live）
  meta           TEXT NOT NULL DEFAULT '{}',       -- JSON：业务参数（如 quantity）
  notify_raw     TEXT,                             -- JSON：渠道通知原文（留痕）
  note           TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  paid_at        INTEGER                           -- 毫秒时间戳
);
CREATE INDEX IF NOT EXISTS idx_payments_user   ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_biz    ON payments(biz_type, status);

CREATE TABLE IF NOT EXISTS jobs (
  id              TEXT PRIMARY KEY,
  type            TEXT NOT NULL DEFAULT 'POSTER_RENDER',
  material_id     TEXT,
  qr_asset_id     TEXT,
  user_id         TEXT REFERENCES users(id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'queued'
                   CHECK (status IN ('queued','running','succeeded','failed')),
  message         TEXT,
  download_url    TEXT,
  share_url       TEXT,
  idempotency_key TEXT UNIQUE,
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_jobs_user ON jobs(user_id);

-- ═══════════════════ 分析视图（三身份分账 / 资金闭环）═══════════════════
-- 业务约定（2026-10-23）：一个人最多同时持有三种身份，收益必须按身份分账，
-- 前端「身份切换」与「三身份收益卡」都读这些视图，而不是把金额加总成一个数。

-- 每人 × 每身份 × 每月 × 每类型
CREATE VIEW IF NOT EXISTS v_income_by_identity AS
SELECT c.owner_id,
       COALESCE(u.name, c.owner_id) AS partner_name,
       u.display_id,
       c.identity,
       CASE c.identity WHEN 'partner' THEN '合伙人'
                       WHEN 'costore' THEN '合店店长'
                       WHEN 'agent'   THEN '代理'
                       ELSE c.identity END AS identity_name,
       c.period,
       c.type,
       COUNT(*)                 AS records,
       ROUND(SUM(c.amount), 2)  AS amount
FROM commissions c
LEFT JOIN users u ON u.id = c.owner_id
GROUP BY c.owner_id, c.identity, c.period, c.type;

-- 每人 × 每身份 × 每月 合计（月度总收入 / 身份卡直接用）
CREATE VIEW IF NOT EXISTS v_identity_monthly AS
SELECT owner_id,
       identity,
       period,
       COUNT(*)                AS records,
       ROUND(SUM(amount), 2)   AS month_income
FROM commissions
GROUP BY owner_id, identity, period;

-- 全平台当月合计（资金闭环核对：各身份合计 + 总部留存 = 实收）
CREATE VIEW IF NOT EXISTS v_period_total AS
SELECT period,
       ROUND(SUM(CASE WHEN identity = 'partner' THEN amount ELSE 0 END), 2) AS partner_total,
       ROUND(SUM(CASE WHEN identity = 'costore' THEN amount ELSE 0 END), 2) AS costore_total,
       ROUND(SUM(CASE WHEN identity = 'agent'   THEN amount ELSE 0 END), 2) AS agent_total,
       ROUND(SUM(amount), 2) AS grand_total
FROM commissions
GROUP BY period;

-- P1-8 两套邀请码（register 注册码 / agent 代理归属码）
CREATE TABLE IF NOT EXISTS invite_codes (
  code        TEXT PRIMARY KEY,
  type        TEXT NOT NULL CHECK (type IN ('register','agent')),
  owner_id    TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER,
  max_use     INTEGER NOT NULL DEFAULT 0,
  used_by     TEXT NOT NULL DEFAULT '[]',
  status      TEXT NOT NULL DEFAULT 'active'
);
CREATE INDEX IF NOT EXISTS idx_invite_codes_owner ON invite_codes(owner_id);
CREATE INDEX IF NOT EXISTS idx_invite_codes_type   ON invite_codes(type);

-- P2-5 后台可调配置（JSON 单行；与 store.js DEFAULT_SETTINGS 对齐）
CREATE TABLE IF NOT EXISTS app_settings (
  id      TEXT PRIMARY KEY,
  payload TEXT NOT NULL
);

-- P0-1 经验值流水（1 元 = 1 经验值；纯记账，不参与分账）
CREATE TABLE IF NOT EXISTS experience_ledger (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tab         TEXT NOT NULL,                    -- promotion（业务推广） / product（购买产品）
  event       TEXT NOT NULL,
  title       TEXT,
  points      INTEGER NOT NULL DEFAULT 0,
  price       REAL NOT NULL DEFAULT 0,
  ref_id      TEXT,
  meta        TEXT NOT NULL DEFAULT '{}',
  occurred_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_experience_user ON experience_ledger(user_id);
CREATE INDEX IF NOT EXISTS idx_experience_tab   ON experience_ledger(tab);

-- P0-2 晋升任务（推广达标免费晋升通道；1 年有效期）
CREATE TABLE IF NOT EXISTS promotion_tasks (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_tier   TEXT,
  valid_until  INTEGER,
  valid_months INTEGER NOT NULL DEFAULT 12,
  targets      TEXT NOT NULL DEFAULT '[]',     -- JSON: [{key,label,required}]
  status       TEXT NOT NULL DEFAULT 'ONGOING',
  achieved_at  INTEGER,
  granted_tier TEXT,
  claimed_at   INTEGER,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_promotion_task_user ON promotion_tasks(user_id);

-- 拉人免费升档触发日志（规则A 人数 / 规则B 业绩）
CREATE TABLE IF NOT EXISTS free_upgrade_log (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_tier   TEXT,
  to_tier     TEXT,
  rule        TEXT,                            -- count / performance
  trigger_ref TEXT,
  note        TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_free_upgrade_user ON free_upgrade_log(user_id);

-- 微信授权票据（一次一换；P2-2 live / mock 双模式）
CREATE TABLE IF NOT EXISTS wechat_tickets (
  id          TEXT PRIMARY KEY,
  openid      TEXT,
  ticket      TEXT NOT NULL,
  mode        TEXT NOT NULL DEFAULT 'mock',
  used        INTEGER NOT NULL DEFAULT 0,
  expires_at  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wechat_ticket ON wechat_tickets(ticket);

-- ═══════════════════════════════════════════════════════════════════
-- 2026-10-27 补齐：db.json 中已有数据但此前 schema 缺失的表
--   （不改这些表会导致迁移 PostgreSQL 时 SKU / 库存 / 专栏 / 报价 / 激活码 等业务数据丢失）
-- ═══════════════════════════════════════════════════════════════════

-- 商城 SKU 目录（按规格细分的价格与库存）
CREATE TABLE IF NOT EXISTS skus (
  id          TEXT PRIMARY KEY,
  product_id  TEXT NOT NULL,                          -- 所属商品（productId）
  label       TEXT NOT NULL DEFAULT '',              -- 规格名（如「智能变速，一档」）
  list_price  REAL NOT NULL DEFAULT 0,               -- 标价（元）
  stock       INTEGER NOT NULL DEFAULT 0,            -- 当前库存
  updated_at  INTEGER NOT NULL DEFAULT 0             -- 毫秒时间戳
);
CREATE INDEX IF NOT EXISTS idx_sku_product ON skus(product_id);

-- SKU 库存台账（每次出入库一条流水，可回溯库存变化）
CREATE TABLE IF NOT EXISTS stock_ledger (
  id             TEXT PRIMARY KEY,
  sku_id         TEXT NOT NULL REFERENCES skus(id) ON DELETE CASCADE,
  delta          INTEGER NOT NULL,                   -- 正=入库，负=出库
  reason         TEXT NOT NULL,                      -- ORDER_CREATE / ORDER_CANCEL_RESTORE / ADMIN_ADJUST ...
  order_id       TEXT,                               -- 关联订单（无则 null）
  operator_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  at             INTEGER NOT NULL,                   -- 毫秒时间戳
  balance_after  INTEGER NOT NULL DEFAULT 0          -- 该笔之后的结存库存
);
CREATE INDEX IF NOT EXISTS idx_stock_sku ON stock_ledger(sku_id);

-- 专栏（可激活内容包；章节与正文以 JSON 保存，结构见 src/columns.js）
CREATE TABLE IF NOT EXISTS "columns" (
  id                 TEXT PRIMARY KEY,
  title              TEXT NOT NULL DEFAULT '',
  summary            TEXT NOT NULL DEFAULT '',
  cover_url          TEXT,
  price              REAL NOT NULL DEFAULT 0,
  fulfillment_type   TEXT NOT NULL DEFAULT 'ACTIVATION_CODE',
  requires_member    INTEGER NOT NULL DEFAULT 0,
  price_presentation TEXT NOT NULL DEFAULT 'single',
  checkout_notice    TEXT,
  content            TEXT NOT NULL DEFAULT '{}',     -- JSON：富文本正文（nodes）
  chapters           TEXT NOT NULL DEFAULT '[]'      -- JSON：章节数组
);

-- 商品活动价（每个商品一条；未配置则无记录，前端显示 '—'）
CREATE TABLE IF NOT EXISTS activity_prices (
  product_id  TEXT PRIMARY KEY,
  amount      REAL NOT NULL DEFAULT 0,               -- 活动价（元）
  note        TEXT,
  updated_at  INTEGER NOT NULL DEFAULT 0
);

-- 报价单（商城结算 / 权益开通 / 升级档位共用）
--   user_id 可为 'anonymous'（未登录报价），故不加外键
CREATE TABLE IF NOT EXISTS quotes (
  id            TEXT PRIMARY KEY,
  scene         TEXT NOT NULL,                       -- checkout / entitlement / upgrade ...
  user_id       TEXT,
  amount        REAL NOT NULL DEFAULT 0,
  breakdown     TEXT NOT NULL DEFAULT '{}',          -- JSON：goodsAmount/discountAmount/listAmount
  items         TEXT NOT NULL DEFAULT '[]',          -- JSON：[{key,qty,skuId}]
  meta          TEXT NOT NULL DEFAULT '{}',          -- JSON：{productKey,level,memberId,skuId}
  rule_version  INTEGER NOT NULL DEFAULT 1,
  issued_at     INTEGER NOT NULL DEFAULT 0,
  expires_at    INTEGER NOT NULL DEFAULT 0,
  consumed      INTEGER NOT NULL DEFAULT 0,
  consumed_at   INTEGER,
  consumed_ref  TEXT                                -- 消费方（订单 id 等）
);

-- 分配意愿报价单（巡查 5% / 销售 5% 的分配方案快照）
CREATE TABLE IF NOT EXISTS allocation_quotes (
  id            TEXT PRIMARY KEY,
  entry_id      TEXT NOT NULL,                       -- 被分配的收益条目
  user_id       TEXT REFERENCES users(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL,                       -- inspect / sales
  targets       TEXT NOT NULL DEFAULT '[]',          -- JSON：分配目标（语义键 + 比例）
  entry_amount  REAL NOT NULL DEFAULT 0,
  rows          TEXT NOT NULL DEFAULT '[]',          -- JSON：解析后的收款人明细
  total_percent REAL NOT NULL DEFAULT 0,
  total_amount  REAL NOT NULL DEFAULT 0,
  expires_at    INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_alloc_quote_entry ON allocation_quotes(entry_id);

-- 权益门禁监控：未开通 / 已过期用户清单（运营催缴与复盘用）
CREATE VIEW IF NOT EXISTS v_entitlement_gate AS
SELECT id, display_id, name, phone, tier, entitlement_state,
       entitlement_paid_at, entitlement_expires_at
FROM users
WHERE entitlement_state <> 'active';

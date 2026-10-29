-- ════════════════════════════════════════════════════════════════════════════
-- 脑商AI 合伙人 · 关系型数据库 Schema（SQLite）
-- 设计依据：src/store.js 内存数据层 createDb() + server.js 持久化快照(db.json)
--   JSON 实体                    →  表（并做规范化，外键连接）
--   users(对象)                  →  partners（合伙人，兼承载「合店老板」角色通过 co_stores 关联）
--   orders(数组)                 →  orders（套餐/产品销售订单 = 收益销售来源）
--   commissions(数组)            →  commissions（各类收益明细）
--   quotaLedger(对象)            →  quota_ledger（名额余额）+ quota_transactions（名额流水）
--   regionalAgents(数组)         →  regional_agents（省/市/县区/门店 代理）
--   coStores(数组)               →  co_stores（合店/门店）+ co_store_owners（合店老板名单，1:N）
--   uplineHistory(数组)          →  upline_history（关系变更历史）
--   settings                     →  settings（后台可调配置）
--   （结算批次，新增）            →  settlements
--
-- 说明：合伙人(合店老板) 是「人」；代理/合店 是其身上的「角色」。
--   所有金额用 REAL（元，2 位小数）；档位用 TEXT 枚举：none/vip/angel/private/cofounder。
--   SQLite 外键需在每个连接执行 PRAGMA foreign_keys=ON 才生效（迁移脚本已开启）。
-- ════════════════════════════════════════════════════════════════════════════

PRAGMA foreign_keys = ON;

-- ───────────── 1) 合伙人（人）┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈
CREATE TABLE IF NOT EXISTS partners (
  id              TEXT PRIMARY KEY,                 -- 合伙人 ID（如 p1 / A）
  name            TEXT NOT NULL DEFAULT '',
  phone           TEXT NOT NULL DEFAULT '',
  tier            TEXT NOT NULL DEFAULT 'none',      -- none/vip/angel/private/cofounder
  is_founding     TEXT NOT NULL DEFAULT 'none',      -- 'founding'（持创始奖）/ 'none'
  upline_id       TEXT REFERENCES partners(id) ON DELETE RESTRICT,  -- 直接上级（合伙人链）
  team_vip        INTEGER NOT NULL DEFAULT 0,        -- 团队 VIP 计数（缓存）
  annual_fee_paid INTEGER NOT NULL DEFAULT 1,        -- 年费是否已缴
  invite_code     TEXT NOT NULL DEFAULT '',          -- 邀请码
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_partners_upline  ON partners(upline_id);
CREATE INDEX IF NOT EXISTS idx_partners_phone  ON partners(phone);
CREATE INDEX IF NOT EXISTS idx_partners_invite ON partners(invite_code);

-- ───────────── 2) 订单 / 销售（收益销售来源）┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈
CREATE TABLE IF NOT EXISTS orders (
  id            TEXT PRIMARY KEY,
  buyer_id      TEXT NOT NULL REFERENCES partners(id) ON DELETE RESTRICT,   -- 购买方（升档者）
  seller_id     TEXT REFERENCES partners(id) ON DELETE RESTRICT,            -- 供货方（推荐人/上级）
  package_tier  TEXT NOT NULL,                    -- vip/angel/private/cofounder
  old_tier      TEXT,                             -- 升档前档（null=原始名额售卖）
  quota_count   INTEGER NOT NULL DEFAULT 1,        -- 消耗名额
  vip_credit    INTEGER NOT NULL DEFAULT 1,        -- 计入全球奖的 VIP 增量
  actual_paid   REAL NOT NULL DEFAULT 0,           -- 客户实付
  seller_cost   REAL NOT NULL DEFAULT 0,           -- 卖方拿货成本
  supply_spread REAL NOT NULL DEFAULT 0,           -- 供货差价（≤0 不落账）
  store_fee     REAL NOT NULL DEFAULT 0,           -- 门店服务费（仅门店渠道；月度结算拆四级）
  hq_fee        REAL NOT NULL DEFAULT 0,           -- 总部产品费（含全球/创始奖）；= 6500×名额 − store_fee
  region_code   TEXT,                              -- 归属区域（门店费按区域码精确匹配）
  channel       TEXT NOT NULL DEFAULT 'partner',   -- 成交渠道：store=门店老板售出 / partner=合伙人售卖
  store_id      TEXT,                              -- 成交门店（channel=store 时记录）
  status        TEXT NOT NULL DEFAULT 'paid',
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_orders_buyer  ON orders(buyer_id);
CREATE INDEX IF NOT EXISTS idx_orders_seller ON orders(seller_id);
CREATE INDEX IF NOT EXISTS idx_orders_region ON orders(region_code);

-- ───────────── 3) 收益明细（佣金）┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈
CREATE TABLE IF NOT EXISTS commissions (
  id           TEXT PRIMARY KEY,
  owner_id     TEXT NOT NULL REFERENCES partners(id) ON DELETE RESTRICT,    -- 收益归属人
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

-- ───────────── 4) 名额台账（余额 + 流水）┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈
CREATE TABLE IF NOT EXISTS quota_ledger (
  partner_id TEXT PRIMARY KEY REFERENCES partners(id) ON DELETE CASCADE,
  balance    REAL NOT NULL DEFAULT 0                -- 可向下发放的名额余额
);
CREATE TABLE IF NOT EXISTS quota_transactions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  partner_id TEXT NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  op         TEXT NOT NULL,                         -- issue（下发）/ consume（消耗/补货）
  amount     REAL NOT NULL,
  ref        TEXT,                                  -- 关联订单/备注
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_quota_tx_partner ON quota_transactions(partner_id);

-- ───────────── 5) 区域代理（省/市/县区/门店）┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈
CREATE TABLE IF NOT EXISTS regional_agents (
  id            TEXT PRIMARY KEY,
  partner_id    TEXT NOT NULL REFERENCES partners(id) ON DELETE CASCADE,     -- 代理身份归属人
  region_type   TEXT NOT NULL,                      -- province/city/district/store
  region_code   TEXT,                               -- 区域码（门店费精确匹配键）
  price_tier    INTEGER NOT NULL DEFAULT 0,          -- 新价格表人数档位
  referrer_id   TEXT REFERENCES partners(id) ON DELETE SET NULL,             -- 开发人（推荐人）
  granted_tier  TEXT,                               -- 开通时赠予身份（门店代理为 null）
  appointed_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_agents_partner ON regional_agents(partner_id);
CREATE INDEX IF NOT EXISTS idx_agents_region  ON regional_agents(region_type, region_code);

-- ───────────── 6) 合店 / 门店（含合店老板名单 1:N）┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈
CREATE TABLE IF NOT EXISTS co_stores (
  id              TEXT PRIMARY KEY,
  owner_id        TEXT NOT NULL REFERENCES partners(id) ON DELETE RESTRICT,  -- 缴纳合店费者（合店老板）
  promoter_id     TEXT REFERENCES partners(id) ON DELETE SET NULL,            -- 推荐人（可能为合店老板）
  store_manager_id TEXT REFERENCES partners(id) ON DELETE SET NULL,           -- 门店店长/门店股东（拿 40% 服务）
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
  partner_id  TEXT NOT NULL REFERENCES partners(id) ON DELETE CASCADE,        -- 合店老板（本店）
  performance REAL NOT NULL DEFAULT 0,                -- 本人当月销售业绩（分红用，不含合店费）
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (co_store_id, partner_id)
);
CREATE INDEX IF NOT EXISTS idx_cso_costore ON co_store_owners(co_store_id);
CREATE INDEX IF NOT EXISTS idx_cso_partner ON co_store_owners(partner_id);

-- ───────────── 7) 关系变更历史 ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈
CREATE TABLE IF NOT EXISTS upline_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  partner_id  TEXT NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  old_upline  TEXT REFERENCES partners(id) ON DELETE SET NULL,
  new_upline  TEXT REFERENCES partners(id) ON DELETE SET NULL,
  action      TEXT,                                  -- unbind/rebind/rename...
  at          TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_upline_hist_partner ON upline_history(partner_id);

-- ───────────── 8) 后台配置 ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈
CREATE TABLE IF NOT EXISTS settings (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  key   TEXT NOT NULL UNIQUE,
  value TEXT                                     -- JSON 字符串（costore 配置等）
);

-- ───────────── 9) 结算批次（新增，便于复盘月度结算）┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈
CREATE TABLE IF NOT EXISTS settlements (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  period    TEXT NOT NULL,                        -- 结算月 YYYY-MM
  run_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  summary   TEXT                                  -- JSON 汇总（byType/total/agentBreakdown...）
);
-- ───────────── 10) 三身份分账视图（合伙人 / 合店店长 / 代理）┈┈┈┈┈┈┈┈┈┈┈┈┈
-- 业务约定（2026-10-23）：一个人最多同时持有三种身份，收益必须按身份分账，
-- 前端「身份切换」与「三身份收益卡」都读这两个视图，而不是把金额加总成一个数。
CREATE VIEW IF NOT EXISTS v_income_by_identity AS
SELECT c.owner_id,
       COALESCE(p.name, c.owner_id) AS partner_name,
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
LEFT JOIN partners p ON p.id = c.owner_id
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

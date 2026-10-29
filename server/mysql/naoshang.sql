-- ═══════════════════════════════════════════════════════════════
-- 脑商AI · MySQL 迁移脚本（由 scripts/export_mysql.js 自动生成）
-- 源库   : E:\脑商ai\server\data\brain_biz_view.db
-- 生成   : 2026-10-28T00:51:20.096Z
-- 用法   : mysql -u root -p < naoshang.sql
-- ═══════════════════════════════════════════════════════════════

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE DATABASE IF NOT EXISTS `naoshang` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
USE `naoshang`;

DROP TABLE IF EXISTS `activation_codes`;
CREATE TABLE `activation_codes` (
  `code` VARCHAR(191) COMMENT '激活码明文（主键）',
  `target_type` TEXT NOT NULL COMMENT '激活目标类型：level=学习等级单开 / column=专栏 / fs=粉丝 / jy=菁英 / cj=超级 / xn=行能 / ys=羿烁（兼容旧 member=fs）',
  `target_id` TEXT COMMENT '目标 ID（会员等级码为空；专栏码为专栏 ID）',
  `max_uses` BIGINT NOT NULL DEFAULT 1 COMMENT '最大可用次数（1=一次性）',
  `uses` BIGINT NOT NULL DEFAULT 0 COMMENT '已使用次数',
  `status` VARCHAR(255) DEFAULT 'active' COMMENT '状态：active=可用 / void=作废',
  `expires_at` BIGINT NOT NULL COMMENT '过期时间（毫秒时间戳）',
  `used_by` TEXT COMMENT '核销台账（JSON：[{memberId, at, channel, issuedBy}]）',
  `channel` VARCHAR(255) DEFAULT 'admin' COMMENT '发放渠道：admin=后台 / store=门店收款发码 / upline=上级赠码',
  `store_id` TEXT COMMENT '门店发码时的代理区域码',
  `issued_by` TEXT COMMENT '发放人 ID（admin 渠道固定为 admin）',
  `issued_to` VARCHAR(191) COMMENT '绑定家长 ID（赠码场景：仅此人可激活）',
  `batch_id` TEXT COMMENT '批量发放批次号',
  `note` TEXT COMMENT '备注',
  `created_at` VARCHAR(32) DEFAULT '1970-01-01 00:00:00' COMMENT '发放时间',
  PRIMARY KEY (`code`),
  FOREIGN KEY (`issued_to`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB COMMENT = '激活码（level=学习等级单开 / column=专栏 / fs·jy·cj·xn·ys=孩子会员等级）' DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE INDEX `ix_activation_codes_idx_codes_issued_to` ON `activation_codes` (`issued_to`);
CREATE INDEX `ix_activation_codes_idx_codes_channel` ON `activation_codes` (`channel`);

DROP TABLE IF EXISTS `activity_prices`;
CREATE TABLE `activity_prices` (
  `product_id` VARCHAR(191) COMMENT '商品 ID（主键）',
  `amount` DECIMAL(18,2) NOT NULL DEFAULT 0 COMMENT '活动价（元）',
  `note` TEXT COMMENT '活动说明',
  `updated_at` BIGINT NOT NULL DEFAULT 0 COMMENT '更新时间（毫秒时间戳）',
  PRIMARY KEY (`product_id`)
) ENGINE=InnoDB COMMENT = '商品活动价（每个商品一条；未配置则无记录，前端显示「—」）' DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

DROP TABLE IF EXISTS `addresses`;
CREATE TABLE `addresses` (
  `id` VARCHAR(191) COMMENT '地址 ID',
  `user_id` VARCHAR(191) NOT NULL COMMENT '所属用户 ID',
  `recipient` VARCHAR(255) DEFAULT '' COMMENT '收货人姓名',
  `phone` VARCHAR(255) DEFAULT '' COMMENT '收货人电话',
  `region_codes` TEXT COMMENT '行政区划码数组（JSON）',
  `region_names` TEXT COMMENT '行政区划名称数组（JSON，与 region_codes 同序）',
  `detail` VARCHAR(255) DEFAULT '' COMMENT '详细地址（街道门牌）',
  `is_default` BIGINT NOT NULL DEFAULT 0 COMMENT '是否默认地址（1=是 / 0=否）',
  `created_at` VARCHAR(32) DEFAULT '1970-01-01 00:00:00' COMMENT '创建时间',
  `version` BIGINT NOT NULL DEFAULT 1 COMMENT '乐观锁版本号',
  PRIMARY KEY (`id`),
  FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT = '收货地址' DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE INDEX `ix_addresses_idx_adr_user` ON `addresses` (`user_id`);

DROP TABLE IF EXISTS `allocation_quotes`;
CREATE TABLE `allocation_quotes` (
  `id` VARCHAR(191) COMMENT '报价单 ID',
  `entry_id` VARCHAR(191) NOT NULL COMMENT '被分配的收益条目 ID',
  `user_id` VARCHAR(191) COMMENT '报价人 ID',
  `kind` TEXT NOT NULL COMMENT '分配场景：inspect=巡查 / sales=销售',
  `targets` TEXT COMMENT '分配目标（JSON：语义键 + 比例，如 [{key,percent}]）',
  `entry_amount` DECIMAL(18,2) NOT NULL DEFAULT 0 COMMENT '被分配条目的总金额（元）',
  `rows` TEXT COMMENT '解析后的收款人明细（JSON）',
  `total_percent` DECIMAL(18,2) NOT NULL DEFAULT 0 COMMENT '分配比例合计（百分比）',
  `total_amount` DECIMAL(18,2) NOT NULL DEFAULT 0 COMMENT '分配金额合计（元）',
  `expires_at` BIGINT NOT NULL DEFAULT 0 COMMENT '报价过期时间（毫秒时间戳）',
  `created_at` BIGINT NOT NULL DEFAULT 0 COMMENT '报价生成时间（毫秒时间戳）',
  PRIMARY KEY (`id`),
  FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT = '分配意愿报价单（巡查 5% / 销售 5% 的分配方案快照，提交时据此校验）' DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE INDEX `ix_allocation_quotes_idx_alloc_quote_entry` ON `allocation_quotes` (`entry_id`);

DROP TABLE IF EXISTS `allocations`;
CREATE TABLE `allocations` (
  `id` VARCHAR(191) COMMENT '分配记录 ID',
  `entry_id` VARCHAR(191) NOT NULL COMMENT '被分配的收益条目 ID（commissions.id）',
  `user_id` VARCHAR(191) NOT NULL COMMENT '操作人 ID（店长/老板，执行分配的人）',
  `target_id` VARCHAR(191) NOT NULL COMMENT '受益人 ID',
  `beneficiary_name` VARCHAR(255) DEFAULT '' COMMENT '受益人姓名（冗余快照）',
  `kind` TEXT NOT NULL COMMENT '分配场景：sales=销售 5% / inspection=巡查 5%',
  `percent` DECIMAL(18,2) NOT NULL DEFAULT 0 COMMENT '分配比例（百分比，如 5 表示 5%）',
  `amount` DECIMAL(18,2) NOT NULL DEFAULT 0 COMMENT '分配金额（元）',
  `status` VARCHAR(255) DEFAULT 'PENDING_SETTLEMENT' COMMENT '状态：PENDING_SETTLEMENT=待结算 / SETTLED=已结算 / CANCELLED=已取消',
  `operation_id` TEXT NOT NULL COMMENT '操作流水号（op_xxx，对账用）',
  `idempotency_key` VARCHAR(191) COMMENT '幂等键（重复提交只分配一次）',
  `created_at` VARCHAR(32) DEFAULT '1970-01-01 00:00:00' COMMENT '创建时间',
  UNIQUE KEY `uk_allocations_idempotency_key` (`idempotency_key`),
  PRIMARY KEY (`id`),
  FOREIGN KEY (`target_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT = '收益分配（门店服务费/合店分红指向具体受益人；巡查 5% 与销售 5% 可自选分配）' DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE INDEX `ix_allocations_idx_alc_entry` ON `allocations` (`entry_id`);
CREATE INDEX `ix_allocations_sqlite_autoindex_allocations_2` ON `allocations` (`idempotency_key`);

DROP TABLE IF EXISTS `app_settings`;
CREATE TABLE `app_settings` (
  `id` VARCHAR(191) COMMENT '配置 ID（单行固定值）',
  `payload` TEXT NOT NULL COMMENT '配置内容（JSON 对象，含 costore/order/dividend/quota/ladder 等全部可调参数）',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB COMMENT = '后台可调配置（JSON 单行存储；与 store.js DEFAULT_SETTINGS 对齐）' DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

DROP TABLE IF EXISTS `applications`;
CREATE TABLE `applications` (
  `id` VARCHAR(191) COMMENT '申请单 ID',
  `type` TEXT NOT NULL COMMENT '申请类型：PARTNER=合伙人 / COACH=健脑官 / COSTORE=合店 / AGENT=代理 / TRANSFER=转店',
  `title` VARCHAR(255) DEFAULT '' COMMENT '申请标题（列表展示）',
  `application_status` VARCHAR(255) DEFAULT 'PENDING_REVIEW' COMMENT '审批状态：PENDING_REVIEW=待审核 / APPROVED=已通过 / REJECTED=已驳回 / CANCELLED=已取消',
  `payment_status` VARCHAR(255) DEFAULT 'NOT_STARTED' COMMENT '支付状态：NOT_STARTED=未支付 / PAID=已支付 / REFUNDED=已退款',
  `contract_status` VARCHAR(255) DEFAULT 'NOT_SIGNED' COMMENT '合同状态：NOT_SIGNED=未签 / SIGNED=已签',
  `entitlement_status` VARCHAR(255) DEFAULT 'NOT_OPEN' COMMENT '权益状态：NOT_OPEN=未开通 / OPEN=已开通 / EXPIRED=已过期',
  `user_id` VARCHAR(191) COMMENT '申请人 ID（家长账号）',
  `member_id` TEXT COMMENT '关联会员 ID（转店场景）',
  `store_id` TEXT COMMENT '目标门店 ID（regional_agents.store 或门店标识）',
  `store_agent_id` TEXT COMMENT '门店代理记录 ID',
  `target_store_id` TEXT COMMENT '转店目标门店 ID',
  `agency_type` TEXT COMMENT '代理类型（省代/市代/县区代 等）',
  `payable_amount` DECIMAL(18,2) NOT NULL DEFAULT 0 COMMENT '应付金额（元）',
  `store` TEXT COMMENT '门店信息快照（JSON）',
  `idempotency_key` VARCHAR(191) COMMENT '幂等键（重复提交只生成一单）',
  `created_at` VARCHAR(32) DEFAULT '1970-01-01 00:00:00' COMMENT '申请时间',
  `version` BIGINT NOT NULL DEFAULT 1 COMMENT '乐观锁版本号（每次更新 +1，防并发覆盖）',
  UNIQUE KEY `uk_applications_idempotency_key` (`idempotency_key`),
  PRIMARY KEY (`id`),
  FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB COMMENT = '申请单（合伙人/健脑官/合店/代理/转店 统一申请流）' DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE INDEX `ix_applications_idx_app_status` ON `applications` (`application_status`);
CREATE INDEX `ix_applications_idx_app_user` ON `applications` (`user_id`);
CREATE INDEX `ix_applications_sqlite_autoindex_applications_2` ON `applications` (`idempotency_key`);

DROP TABLE IF EXISTS `assets`;
CREATE TABLE `assets` (
  `id` VARCHAR(191) COMMENT '资源 ID',
  `user_id` VARCHAR(191) COMMENT '上传人 ID',
  `purpose` TEXT NOT NULL COMMENT '资源用途：avatar=头像 / material-qr=素材二维码 / feedback-image=反馈图片 等',
  `file_name` VARCHAR(255) DEFAULT '' COMMENT '原始文件名',
  `mime_type` VARCHAR(255) DEFAULT '' COMMENT 'MIME 类型（如 image/png）',
  `size` BIGINT NOT NULL DEFAULT 0 COMMENT '文件大小（字节）',
  `status` VARCHAR(255) DEFAULT 'PENDING' COMMENT '状态：PENDING=上传中 / READY=可用 / FAILED=失败',
  `preview_url` TEXT COMMENT '访问地址（当前为 Mock CDN 地址）',
  `fail_reason` TEXT COMMENT '失败原因',
  `created_at` VARCHAR(32) DEFAULT '1970-01-01 00:00:00' COMMENT '上传时间',
  PRIMARY KEY (`id`),
  FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB COMMENT = '上传资源（直传占位；状态机 PENDING→READY/FAILED）' DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE INDEX `ix_assets_idx_assets_user` ON `assets` (`user_id`);

DROP TABLE IF EXISTS `co_store_owners`;
CREATE TABLE `co_store_owners` (
  `id` BIGINT AUTO_INCREMENT COMMENT '记录 ID（自增主键）',
  `co_store_id` VARCHAR(191) NOT NULL COMMENT '所属合店 ID',
  `user_id` VARCHAR(191) NOT NULL COMMENT '合店老板 ID',
  `performance` DECIMAL(18,2) NOT NULL DEFAULT 0 COMMENT '本人当月销售业绩（元，红分依据，不含合店费）',
  `created_at` VARCHAR(32) DEFAULT '1970-01-01 00:00:00' COMMENT '加入时间',
  PRIMARY KEY (`id`),
  FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  FOREIGN KEY (`co_store_id`) REFERENCES `co_stores` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT = '合店老板名单（一个合店可有多名老板，1:N 拆表）' DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE INDEX `ix_co_store_owners_idx_cso_user` ON `co_store_owners` (`user_id`);
CREATE INDEX `ix_co_store_owners_idx_cso_costore` ON `co_store_owners` (`co_store_id`);
CREATE INDEX `ix_co_store_owners_sqlite_autoindex_co_store_owners_1` ON `co_store_owners` (`co_store_id`, `user_id`);

DROP TABLE IF EXISTS `co_stores`;
CREATE TABLE `co_stores` (
  `id` VARCHAR(191) COMMENT '合店记录 ID',
  `owner_id` VARCHAR(191) NOT NULL COMMENT '缴纳合店费的老板 ID',
  `promoter_id` VARCHAR(191) COMMENT '推荐人 ID（可能同为合店老板）',
  `store_manager_id` VARCHAR(191) COMMENT '门店店长/门店股东 ID（拿 40% 服务费）',
  `store_id` VARCHAR(191) COMMENT '所属门店标识（单店分红分组键）',
  `monthly_fee` DECIMAL(18,2) NOT NULL DEFAULT 698 COMMENT '合店费月费（元，默认 698）',
  `owner_count` BIGINT NOT NULL DEFAULT 1 COMMENT '该门店老板人数',
  `join_date` TEXT COMMENT '入股年月（用于无责分红首月判定）',
  `created_at` VARCHAR(32) DEFAULT '1970-01-01 00:00:00' COMMENT '创建时间',
  PRIMARY KEY (`id`),
  FOREIGN KEY (`store_manager_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  FOREIGN KEY (`promoter_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  FOREIGN KEY (`owner_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB COMMENT = '合店 / 门店表（合店是 users 的角色；含合店老板名单 1:N 关系）' DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE INDEX `ix_co_stores_idx_costores_store` ON `co_stores` (`store_id`);
CREATE INDEX `ix_co_stores_idx_costores_owner` ON `co_stores` (`owner_id`);

DROP TABLE IF EXISTS `coaches`;
CREATE TABLE `coaches` (
  `id` VARCHAR(191) COMMENT '健脑官 ID',
  `store_id` VARCHAR(191) NOT NULL COMMENT '所属门店 ID',
  `name` VARCHAR(255) DEFAULT '' COMMENT '姓名',
  `login_account` TEXT NOT NULL COMMENT '登录账号（手机号）',
  `status` VARCHAR(255) DEFAULT 'ACTIVE' COMMENT '账号状态：ACTIVE=启用 / DISABLED=禁用',
  `invitation_status` VARCHAR(255) DEFAULT 'PENDING' COMMENT '邀请状态：PENDING=待接受 / ACCEPTED=已接受 / REJECTED=已拒绝',
  `idempotency_key` VARCHAR(191) COMMENT '幂等键（重复提交只建一个账号）',
  `created_at` VARCHAR(32) DEFAULT '1970-01-01 00:00:00' COMMENT '创建时间',
  `version` BIGINT NOT NULL DEFAULT 1 COMMENT '乐观锁版本号',
  UNIQUE KEY `uk_coaches_idempotency_key` (`idempotency_key`),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB COMMENT = '健脑官（门店独立登录账号；与家长账号体系分离）' DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE INDEX `ix_coaches_idx_coaches_store` ON `coaches` (`store_id`);
CREATE INDEX `ix_coaches_sqlite_autoindex_coaches_2` ON `coaches` (`idempotency_key`);

DROP TABLE IF EXISTS `columns`;
CREATE TABLE `columns` (
  `id` VARCHAR(191) COMMENT '专栏 ID（col_1 等；与激活码种子、商城商品同名，三处必须一致）',
  `title` VARCHAR(255) DEFAULT '' COMMENT '专栏标题',
  `summary` VARCHAR(255) DEFAULT '' COMMENT '专栏简介',
  `cover_url` TEXT COMMENT '封面图地址',
  `price` DECIMAL(18,2) NOT NULL DEFAULT 0 COMMENT '标价（元）',
  `fulfillment_type` VARCHAR(255) DEFAULT 'ACTIVATION_CODE' COMMENT '履约方式：ACTIVATION_CODE=通过激活码发货 等',
  `requires_member` BIGINT NOT NULL DEFAULT 0 COMMENT '是否要求会员身份才能购买（1=是 / 0=否）',
  `price_presentation` VARCHAR(255) DEFAULT 'single' COMMENT '价格展示方式：single=单一口径 / tiered=按档位分档价',
  `checkout_notice` TEXT COMMENT '下单提示语（如「下单后联系门店获取激活码」）',
  `content` TEXT COMMENT '富文本正文（JSON，nodes 结构，见 src/richContent.js）',
  `chapters` TEXT COMMENT '章节数组（JSON：[{id,title,type,content,videoUrl}]）',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB COMMENT = '专栏（可激活内容包；章节与正文以 JSON 保存，结构见 src/columns.js）' DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

DROP TABLE IF EXISTS `commissions`;
CREATE TABLE `commissions` (
  `id` VARCHAR(191) COMMENT '收益流水 ID',
  `owner_id` VARCHAR(191) NOT NULL COMMENT '收益归属人 ID（收到这笔钱的人）',
  `identity` VARCHAR(255) DEFAULT 'partner' COMMENT '收益归属身份：partner=合伙人 / costore=合店 / agent=代理（三身份分账口径，互不混算）',
  `type` VARCHAR(191) NOT NULL COMMENT '收益类型：supply=供货差价 / parity=平级奖 / global=全球奖 / founding=创始奖 / agent=代理奖 / costore=合店分配 / product=产品分成',
  `subtype` TEXT COMMENT '收益子类（agent_direct=代理直推 / agent_biz=代理业务 / storeService=门店服务费 / businessDirect=业务直推 / partner_product=合伙人产品）',
  `period` VARCHAR(191) COMMENT '结算月份（YYYY-MM）',
  `base_amount` DECIMAL(18,2) DEFAULT 0 COMMENT '计佣基数（元）',
  `rate` DECIMAL(18,2) COMMENT '提成比例（可为空，如定额拆分场景）',
  `amount` DECIMAL(18,2) NOT NULL DEFAULT 0 COMMENT '实际收益金额（元）',
  `ref_order_id` VARCHAR(191) COMMENT '关联订单 ID（可为空；订单删除后置空）',
  `status` VARCHAR(255) DEFAULT 'pending' COMMENT '结算状态：pending=待结算 / settled=已结算',
  `note` TEXT COMMENT '备注（人工说明或自动生成的计算说明）',
  `formula` TEXT COMMENT '计算公式快照（便于复核金额来源）',
  `created_at` VARCHAR(32) DEFAULT '1970-01-01 00:00:00' COMMENT '收益生成时间',
  PRIMARY KEY (`id`),
  FOREIGN KEY (`ref_order_id`) REFERENCES `orders` (`id`) ON DELETE SET NULL,
  FOREIGN KEY (`owner_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB COMMENT = '收益明细（佣金台账；全球奖/直推奖/复购奖/创始奖/代理奖/合店分配全类型统一落此表）' DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE INDEX `ix_commissions_idx_commissions_ident` ON `commissions` (`identity`, `period`);
CREATE INDEX `ix_commissions_idx_commissions_type` ON `commissions` (`type`, `period`);
CREATE INDEX `ix_commissions_idx_commissions_ref` ON `commissions` (`ref_order_id`);
CREATE INDEX `ix_commissions_idx_commissions_owner` ON `commissions` (`owner_id`);

DROP TABLE IF EXISTS `counters`;
CREATE TABLE `counters` (
  `name` VARCHAR(191) COMMENT '计数器名称（userSeq=用户注册序号 / seq=内部 id / memberSeq=孩子添加序号）',
  `value` BIGINT NOT NULL DEFAULT 1 COMMENT '当前计数值（下一个分配的序号）',
  PRIMARY KEY (`name`)
) ENGINE=InnoDB COMMENT = '全局 ID 计数器（内部 id 与对外编号的序号来源）' DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

DROP TABLE IF EXISTS `coupons`;
CREATE TABLE `coupons` (
  `id` VARCHAR(191) COMMENT '优惠券 ID',
  `user_id` VARCHAR(191) NOT NULL COMMENT '所属用户 ID',
  `title` VARCHAR(255) DEFAULT '' COMMENT '优惠券名称',
  `discount_amount` DECIMAL(18,2) NOT NULL DEFAULT 0 COMMENT '优惠金额（元）',
  `threshold_text` VARCHAR(255) DEFAULT '' COMMENT '使用门槛文案（如「满 1000 元可用」）',
  `scope_label` VARCHAR(255) DEFAULT '' COMMENT '适用范围文案',
  `status` VARCHAR(255) DEFAULT 'available' COMMENT '状态：available=未使用 / used=已使用 / void=已作废',
  `expires_at` BIGINT NOT NULL COMMENT '过期时间（毫秒时间戳）',
  `created_at` VARCHAR(32) DEFAULT '1970-01-01 00:00:00' COMMENT '发放时间',
  PRIMARY KEY (`id`),
  FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT = '优惠券（用户券包；下单时核销）' DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE INDEX `ix_coupons_idx_cpn_user` ON `coupons` (`user_id`);

DROP TABLE IF EXISTS `entitlement_orders`;
CREATE TABLE `entitlement_orders` (
  `id` BIGINT AUTO_INCREMENT COMMENT '订单 ID（自增主键）',
  `idempotency_key` VARCHAR(191) NOT NULL COMMENT '幂等键（重复提交返回同一结果）',
  `operation_id` TEXT NOT NULL COMMENT '操作流水号（op_xxx，对账用）',
  `user_id` VARCHAR(191) NOT NULL COMMENT '开通人 ID',
  `amount` DECIMAL(18,2) NOT NULL DEFAULT 200 COMMENT '权益收益费金额（元，默认 200）',
  `status` VARCHAR(255) DEFAULT 'SUCCEEDED' COMMENT '订单状态（当前为免支付直通占位；正式收银台接入后走三段式）',
  `note` TEXT COMMENT '备注',
  `at` BIGINT NOT NULL COMMENT '业务发生时间（毫秒时间戳）',
  `created_at` VARCHAR(32) DEFAULT '1970-01-01 00:00:00' COMMENT '记录创建时间',
  UNIQUE KEY `uk_entitlement_orders_idempotency_key` (`idempotency_key`),
  PRIMARY KEY (`id`),
  FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT = '权益收益费订单（200 元门禁；幂等键保证重复提交不重复扣费）' DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE INDEX `ix_entitlement_orders_idx_ento_user` ON `entitlement_orders` (`user_id`);
CREATE INDEX `ix_entitlement_orders_sqlite_autoindex_entitlement_orders_1` ON `entitlement_orders` (`idempotency_key`);

DROP TABLE IF EXISTS `experience_ledger`;
CREATE TABLE `experience_ledger` (
  `id` VARCHAR(191) COMMENT '流水 ID',
  `user_id` VARCHAR(191) NOT NULL COMMENT '获得人 ID',
  `tab` VARCHAR(191) NOT NULL COMMENT '归属页签：promotion=业务推广 / product=购买产品',
  `event` TEXT NOT NULL COMMENT '事件类型：upgrade=升档 / costore=合店 / agent=代理 / product=购买产品',
  `title` TEXT COMMENT '事件标题（列表展示）',
  `points` BIGINT NOT NULL DEFAULT 0 COMMENT '经验值增量（按「1 元 = 1 经验值」折算）',
  `price` DECIMAL(18,2) NOT NULL DEFAULT 0 COMMENT '对应金额（元）',
  `ref_id` TEXT COMMENT '关联业务 ID（用于防重复记账）',
  `meta` TEXT COMMENT '附加信息（JSON）',
  `occurred_at` BIGINT NOT NULL COMMENT '发生时间（毫秒时间戳）',
  PRIMARY KEY (`id`),
  FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT = '经验值流水（1 元 = 1 经验值；纯记账，不参与资金分账）' DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE INDEX `ix_experience_ledger_idx_experience_tab` ON `experience_ledger` (`tab`);
CREATE INDEX `ix_experience_ledger_idx_experience_user` ON `experience_ledger` (`user_id`);

DROP TABLE IF EXISTS `free_upgrade_log`;
CREATE TABLE `free_upgrade_log` (
  `id` VARCHAR(191) COMMENT '日志 ID',
  `user_id` VARCHAR(191) NOT NULL COMMENT '被升档人 ID',
  `from_tier` TEXT COMMENT '升档前档位',
  `to_tier` TEXT COMMENT '升档后档位',
  `rule` TEXT COMMENT '触发规则：count=规则A 人数达标 / performance=规则B 业绩达标',
  `trigger_ref` TEXT COMMENT '触发来源引用（如达标下级 ID）',
  `note` TEXT COMMENT '备注',
  `created_at` BIGINT NOT NULL COMMENT '发生时间（毫秒时间戳）',
  PRIMARY KEY (`id`),
  FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT = '拉人免费升档日志（规则A 按人数 / 规则B 按业绩，取进度较高者）' DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE INDEX `ix_free_upgrade_log_idx_free_upgrade_user` ON `free_upgrade_log` (`user_id`);

DROP TABLE IF EXISTS `invite_codes`;
CREATE TABLE `invite_codes` (
  `code` VARCHAR(191) COMMENT '邀请码（R+8位BASE36=注册码 / A+8位BASE36=代理码）',
  `type` VARCHAR(191) NOT NULL COMMENT '类型：register=拉新注册码（绑定推荐人 upline） / agent=代理归属码（绑定推荐代理 referrer）',
  `owner_id` VARCHAR(191) NOT NULL COMMENT '邀请码持有人 ID',
  `created_at` BIGINT NOT NULL COMMENT '生成时间（毫秒时间戳）',
  `expires_at` BIGINT COMMENT '过期时间（毫秒时间戳，默认 30 天）',
  `max_use` BIGINT NOT NULL DEFAULT 0 COMMENT '最大使用次数（0=不限次）',
  `used_by` TEXT COMMENT '使用记录（JSON 数组，记录每个使用者）',
  `status` VARCHAR(255) DEFAULT 'active' COMMENT '状态：active=可用 / void=作废',
  PRIMARY KEY (`code`)
) ENGINE=InnoDB COMMENT = '邀请码流水（两套互不混用：register 注册拉新码 / agent 代理归属码；R 开头=注册，A 开头=代理）' DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE INDEX `ix_invite_codes_idx_invite_codes_type` ON `invite_codes` (`type`);
CREATE INDEX `ix_invite_codes_idx_invite_codes_owner` ON `invite_codes` (`owner_id`);

DROP TABLE IF EXISTS `jobs`;
CREATE TABLE `jobs` (
  `id` VARCHAR(191) COMMENT '任务 ID',
  `type` VARCHAR(255) DEFAULT 'POSTER_RENDER' COMMENT '任务类型：POSTER_RENDER=海报合成 等',
  `material_id` TEXT COMMENT '关联素材 ID',
  `qr_asset_id` TEXT COMMENT '关联二维码资源 ID',
  `user_id` VARCHAR(191) COMMENT '任务发起人 ID',
  `status` VARCHAR(255) DEFAULT 'queued' COMMENT '任务状态：queued=排队中 / running=执行中 / succeeded=成功 / failed=失败',
  `message` TEXT COMMENT '执行结果消息（失败时为错误原因）',
  `download_url` TEXT COMMENT '产物下载地址',
  `share_url` TEXT COMMENT '产物分享链接',
  `idempotency_key` VARCHAR(191) COMMENT '幂等键（重复提交只建一个任务）',
  `created_at` VARCHAR(32) DEFAULT '1970-01-01 00:00:00' COMMENT '创建时间',
  UNIQUE KEY `uk_jobs_idempotency_key` (`idempotency_key`),
  PRIMARY KEY (`id`),
  FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB COMMENT = '异步任务（海报合成等；queued→running→succeeded/failed）' DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE INDEX `ix_jobs_idx_jobs_user` ON `jobs` (`user_id`);
CREATE INDEX `ix_jobs_sqlite_autoindex_jobs_2` ON `jobs` (`idempotency_key`);

DROP TABLE IF EXISTS `learning_progress`;
CREATE TABLE `learning_progress` (
  `member_id` VARCHAR(191) COMMENT '会员 ID（孩子）',
  `level_id` VARCHAR(191) COMMENT '学习等级 ID',
  `chapter_id` VARCHAR(191) COMMENT '章节 ID',
  `position_seconds` DECIMAL(18,2) NOT NULL DEFAULT 0 COMMENT '当前播放/学习位置（秒，断点续学用）',
  `duration_seconds` DECIMAL(18,2) NOT NULL DEFAULT 0 COMMENT '该章节总时长（秒）',
  `completed` BIGINT NOT NULL DEFAULT 0 COMMENT '是否已完成（1=完成 / 0=未完成）',
  `updated_at` BIGINT NOT NULL COMMENT '更新时间（毫秒时间戳）',
  PRIMARY KEY (`member_id`, `level_id`, `chapter_id`)
) ENGINE=InnoDB COMMENT = '学习进度（会员 × 学习等级 × 章节 三元组记录）' DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

DROP TABLE IF EXISTS `material_renders`;
CREATE TABLE `material_renders` (
  `id` VARCHAR(191) COMMENT '渲染记录 ID',
  `material_id` TEXT NOT NULL COMMENT '素材 ID（待渲染的原始素材）',
  `qr_asset_id` TEXT NOT NULL COMMENT '二维码资源 ID（assets.id）',
  `user_id` VARCHAR(191) COMMENT '发起渲染的用户 ID',
  `idempotency_key` VARCHAR(191) COMMENT '幂等键（同一素材重复提交只渲染一次）',
  `created_at` VARCHAR(32) DEFAULT '1970-01-01 00:00:00' COMMENT '创建时间',
  UNIQUE KEY `uk_material_renders_id` (`id`),
  UNIQUE KEY `uk_material_renders_idempotency_key` (`idempotency_key`),
  PRIMARY KEY (`id`),
  FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB COMMENT = '素材渲染记录（海报合成幂等键，防止重复渲染）' DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE INDEX `ix_material_renders_sqlite_autoindex_material_renders_2` ON `material_renders` (`idempotency_key`);

DROP TABLE IF EXISTS `members`;
CREATE TABLE `members` (
  `id` VARCHAR(191) COMMENT '会员 ID（孩子档案唯一标识）',
  `user_id` VARCHAR(191) NOT NULL COMMENT '所属家长账号 ID',
  `name` VARCHAR(255) DEFAULT '' COMMENT '孩子姓名',
  `grade_code` VARCHAR(255) DEFAULT '' COMMENT '年级代码（如 K1/K2/K3、G1..G6）',
  `grade_label` VARCHAR(255) DEFAULT '' COMMENT '年级名称（如「三年级」）',
  `gender_code` VARCHAR(255) DEFAULT '' COMMENT '性别代码',
  `gender_label` VARCHAR(255) DEFAULT '' COMMENT '性别名称',
  `avatar_asset_id` TEXT COMMENT '头像资源 ID（assets.id）',
  `avatar_url` TEXT COMMENT '头像地址（冗余存储，读时免关联查询）',
  `store_id` VARCHAR(191) COMMENT '绑入门店 ID（健脑官归属门店）',
  `activated` BIGINT NOT NULL DEFAULT 0 COMMENT '是否已激活会员身份（1=已激活 / 0=未激活）',
  `member_level` VARCHAR(255) DEFAULT 'normal' COMMENT '孩子会员等级：normal=普通游客 / fs=粉丝 / jy=一阶菁英 / cj=一阶超级 / xn=二阶行能 / ys=三阶羿烁',
  `member_seq` BIGINT NOT NULL COMMENT '孩子全局添加序号（第几个添加第几）',
  `display_id` VARCHAR(191) NOT NULL COMMENT '孩子对外编号：等级前缀 + member_seq（如 FS3000；升级只变前缀、编号不变）',
  `unlocked_levels` TEXT COMMENT '历史通过 level 类激活码单开的等级（JSON 数组，兼容旧数据）',
  `unlocked_columns` TEXT COMMENT '已解锁的专栏 ID 数组（JSON）',
  `training` TEXT COMMENT '培训额度（JSON：trainingTotal 总额 / trainingUsed 已用 / special 专项 等）',
  `idempotency_key` VARCHAR(191) COMMENT '幂等键（重复提交只创建一条档案）',
  `created_at` VARCHAR(32) DEFAULT '1970-01-01 00:00:00' COMMENT '创建时间',
  `version` BIGINT NOT NULL DEFAULT 1 COMMENT '乐观锁版本号',
  UNIQUE KEY `uk_members_id` (`id`),
  UNIQUE KEY `uk_members_member_seq` (`member_seq`),
  UNIQUE KEY `uk_members_display_id` (`display_id`),
  UNIQUE KEY `uk_members_idempotency_key` (`idempotency_key`),
  PRIMARY KEY (`id`),
  FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT = '家庭会员（孩子档案；六级会员等级 normal<fs<jy<cj<xn<ys 决定板块权益解锁）' DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE INDEX `ix_members_idx_members_store` ON `members` (`store_id`);
CREATE INDEX `ix_members_idx_members_user` ON `members` (`user_id`);
CREATE INDEX `ix_members_sqlite_autoindex_members_4` ON `members` (`idempotency_key`);
CREATE INDEX `ix_members_sqlite_autoindex_members_3` ON `members` (`display_id`);
CREATE INDEX `ix_members_sqlite_autoindex_members_2` ON `members` (`member_seq`);

DROP TABLE IF EXISTS `orders`;
CREATE TABLE `orders` (
  `id` VARCHAR(191) COMMENT '订单 ID（内部唯一标识）',
  `buyer_id` VARCHAR(191) NOT NULL COMMENT '购买方 ID（升档者）',
  `seller_id` VARCHAR(191) COMMENT '供货方 ID（推荐人/上级；直营场景可为空）',
  `package_tier` TEXT NOT NULL COMMENT '售出的档位包：vip/angel/private/cofounder',
  `old_tier` TEXT COMMENT '升档前的原档位（为空表示原始名额售卖，非升档）',
  `quota_count` BIGINT NOT NULL DEFAULT 1 COMMENT '本次消耗的 VIP 名额数量',
  `vip_credit` BIGINT NOT NULL DEFAULT 1 COMMENT '计入全球奖的 VIP 增量（用于核算全球奖池）',
  `actual_paid` DECIMAL(18,2) NOT NULL DEFAULT 0 COMMENT '客户实际支付金额（元）',
  `seller_cost` DECIMAL(18,2) NOT NULL DEFAULT 0 COMMENT '卖方拿货成本（元）',
  `supply_spread` DECIMAL(18,2) NOT NULL DEFAULT 0 COMMENT '供货差价（元）= 售价 − 成本；≤0 时不落账',
  `store_fee` DECIMAL(18,2) NOT NULL DEFAULT 0 COMMENT '门店服务费（元，仅门店渠道产生；月度结算按四级拆分）',
  `hq_fee` DECIMAL(18,2) NOT NULL DEFAULT 0 COMMENT '总部产品费（元，含全球奖与创始奖计提）',
  `region_code` VARCHAR(191) COMMENT '归属区域码（门店费按区域码精确匹配）',
  `channel` VARCHAR(255) DEFAULT 'partner' COMMENT '成交渠道：store=门店老板售出 / partner=合伙人售卖',
  `store_id` TEXT COMMENT '成交门店标识（channel=store 时记录）',
  `status` VARCHAR(255) DEFAULT 'paid' COMMENT '订单状态（已支付/已取消/已退款等）',
  `created_at` VARCHAR(32) DEFAULT '1970-01-01 00:00:00' COMMENT '下单时间',
  PRIMARY KEY (`id`),
  FOREIGN KEY (`seller_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  FOREIGN KEY (`buyer_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB COMMENT = '订单 / 销售记录（一切收益的计算来源）' DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE INDEX `ix_orders_idx_orders_region` ON `orders` (`region_code`);
CREATE INDEX `ix_orders_idx_orders_seller` ON `orders` (`seller_id`);
CREATE INDEX `ix_orders_idx_orders_buyer` ON `orders` (`buyer_id`);

DROP TABLE IF EXISTS `password_resets`;
CREATE TABLE `password_resets` (
  `ticket` VARCHAR(191) COMMENT '重置票据（一次性令牌，主键）',
  `phone` TEXT NOT NULL COMMENT '目标账号手机号',
  `expires_at` BIGINT NOT NULL COMMENT '过期时间（毫秒时间戳，默认 10 分钟）',
  `used` BIGINT NOT NULL DEFAULT 0 COMMENT '是否已使用（1=已用 / 0=未用）',
  `created_at` VARCHAR(32) DEFAULT '1970-01-01 00:00:00' COMMENT '创建时间',
  PRIMARY KEY (`ticket`)
) ENGINE=InnoDB COMMENT = '密码重置凭据（ticket 为一次性令牌，10 分钟有效）' DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

DROP TABLE IF EXISTS `pay_accounts`;
CREATE TABLE `pay_accounts` (
  `token` VARCHAR(191) COMMENT '对外凭据（payee_xxx，不暴露库内主键）',
  `user_id` VARCHAR(191) NOT NULL COMMENT '账户所属人 ID',
  `account_type` TEXT NOT NULL COMMENT '账户类型（银行卡/支付宝/微信 等）',
  `name` TEXT NOT NULL COMMENT '户名',
  `bank_name` VARCHAR(255) DEFAULT '' COMMENT '开户行名称',
  `bank_number` VARCHAR(255) DEFAULT '' COMMENT '完整账号（仅存本表；接口只回 masked_bank_number）',
  `masked_bank_number` VARCHAR(255) DEFAULT '' COMMENT '脱敏账号（如 ****1234，用于展示）',
  `created_at` VARCHAR(32) DEFAULT '1970-01-01 00:00:00' COMMENT '创建时间',
  PRIMARY KEY (`token`),
  FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT = '收款账户（提现打款目标；完整卡号仅存本表，对外只返回脱敏值）' DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE INDEX `ix_pay_accounts_idx_payee_user` ON `pay_accounts` (`user_id`);

DROP TABLE IF EXISTS `payments`;
CREATE TABLE `payments` (
  `id` VARCHAR(191) COMMENT '支付单 ID',
  `biz_type` VARCHAR(191) NOT NULL COMMENT '业务类型：entitlement=开通权益 / annual_fee=合伙人年费 / quota_purchase=购买名额 / product_order=商城商品订单 / upgrade=合伙人升档',
  `biz_id` TEXT COMMENT '关联业务单 ID（可选）',
  `user_id` VARCHAR(191) NOT NULL COMMENT '付款人 ID',
  `amount` DECIMAL(18,2) NOT NULL COMMENT '支付金额（元）',
  `channel` TEXT NOT NULL COMMENT '支付渠道：wechat=微信 / alipay=支付宝 / bank_card=银行卡 / unionpay=银联',
  `subject` VARCHAR(255) DEFAULT '' COMMENT '支付标题（收银台展示）',
  `status` VARCHAR(255) DEFAULT 'CREATED' COMMENT '支付状态：CREATED=已创建 / PAID=已支付 / SUCCEEDED=支付成功 / PROCESSING=处理中 / FAILED=失败 / CLOSED=已关闭 / CANCELLED=已取消',
  `transaction_id` TEXT COMMENT '渠道流水号（第三方支付平台返回）',
  `idempotency_key` VARCHAR(191) COMMENT '幂等键（重复下单返回原单）',
  `pay_params` TEXT COMMENT '渠道调起参数（JSON，live 模式用）',
  `meta` TEXT COMMENT '业务参数（JSON，如 quantity 数量）',
  `notify_raw` TEXT COMMENT '渠道异步通知原文（JSON，留痕对账用）',
  `note` TEXT COMMENT '备注',
  `created_at` VARCHAR(32) DEFAULT '1970-01-01 00:00:00' COMMENT '下单时间',
  `paid_at` BIGINT COMMENT '支付完成时间（毫秒时间戳）',
  UNIQUE KEY `uk_payments_idempotency_key` (`idempotency_key`),
  PRIMARY KEY (`id`),
  FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT = '支付单（微信/支付宝/银行卡 + 银联；权益费、合伙人年费、商城商品、升档共用）' DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE INDEX `ix_payments_idx_payments_biz` ON `payments` (`biz_type`, `status`);
CREATE INDEX `ix_payments_idx_payments_user` ON `payments` (`user_id`);
CREATE INDEX `ix_payments_sqlite_autoindex_payments_2` ON `payments` (`idempotency_key`);

DROP TABLE IF EXISTS `promotion_tasks`;
CREATE TABLE `promotion_tasks` (
  `id` VARCHAR(191) COMMENT '任务 ID',
  `user_id` VARCHAR(191) NOT NULL COMMENT '任务归属人 ID',
  `start_tier` TEXT COMMENT '任务发起时所在档位',
  `valid_until` BIGINT COMMENT '任务失效时间（毫秒时间戳）',
  `valid_months` BIGINT NOT NULL DEFAULT 12 COMMENT '有效月数（默认 12 个月）',
  `targets` TEXT COMMENT '达标目标（JSON：[{key,label,required}]，如直推私董 3 人、直推 VIP 18 人）',
  `status` VARCHAR(255) DEFAULT 'ONGOING' COMMENT '任务状态：ONGOING=进行中 / ACHIEVED=已达标 / CLAIMED=已领取 / EXPIRED=已过期',
  `achieved_at` BIGINT COMMENT '达标时间（毫秒时间戳）',
  `granted_tier` TEXT COMMENT '实际授予的档位',
  `claimed_at` BIGINT COMMENT '领取时间（毫秒时间戳）',
  `created_at` BIGINT NOT NULL COMMENT '创建时间（毫秒时间戳）',
  PRIMARY KEY (`id`),
  FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT = '晋升任务（推广达标免费晋升通道；默认 1 年有效期）' DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE INDEX `ix_promotion_tasks_idx_promotion_task_user` ON `promotion_tasks` (`user_id`);

DROP TABLE IF EXISTS `quota_activity_batches`;
CREATE TABLE `quota_activity_batches` (
  `id` BIGINT AUTO_INCREMENT COMMENT '批次 ID（自增主键）',
  `user_id` VARCHAR(191) NOT NULL COMMENT '持有人 ID',
  `qty` BIGINT NOT NULL COMMENT '本批次发放的活动名额数量',
  `obtained_at` VARCHAR(32) DEFAULT '1970-01-01 00:00:00' COMMENT '发放时间',
  `expire_at` VARCHAR(191) NOT NULL COMMENT '到期时间（消耗时先过期先扣）',
  PRIMARY KEY (`id`),
  FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT = '活动名额批次（每笔活动名额发放一条，带 1 年有效期）' DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE INDEX `ix_quota_activity_batches_idx_quota_batches_expire` ON `quota_activity_batches` (`expire_at`);
CREATE INDEX `ix_quota_activity_batches_idx_quota_batches_user` ON `quota_activity_batches` (`user_id`);

DROP TABLE IF EXISTS `quota_ledger`;
CREATE TABLE `quota_ledger` (
  `user_id` VARCHAR(191) COMMENT '持有人 ID（每人一行）',
  `standard` BIGINT NOT NULL DEFAULT 0 COMMENT '标准 VIP 名额余额（可划拨、可用于任意档位升级）',
  PRIMARY KEY (`user_id`),
  FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT = 'VIP 名额余额台账（标准名额与活动名额两桶分开记账）' DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

DROP TABLE IF EXISTS `quota_transactions`;
CREATE TABLE `quota_transactions` (
  `id` BIGINT AUTO_INCREMENT COMMENT '流水 ID（自增主键）',
  `user_id` VARCHAR(191) NOT NULL COMMENT '操作对象 ID',
  `op` TEXT NOT NULL COMMENT '操作类型：issue=发放 / consume=消耗',
  `kind` TEXT COMMENT '发放类型：standard=标准名额 / activity=活动名额（消耗时为混合来源）',
  `used_standard` BIGINT NOT NULL DEFAULT 0 COMMENT '本次扣减的标准名额数',
  `used_activity` BIGINT NOT NULL DEFAULT 0 COMMENT '本次扣减的活动名额数',
  `amount` DECIMAL(18,2) NOT NULL DEFAULT 0 COMMENT '额度变动量（兼容旧语义）',
  `ref` VARCHAR(191) COMMENT '关联订单号 / 发放来源 / 操作备注',
  `operator_id` TEXT COMMENT '操作人 ID（后台发放人或下单用户）',
  `created_at` VARCHAR(32) DEFAULT '1970-01-01 00:00:00' COMMENT '操作时间',
  PRIMARY KEY (`id`),
  FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT = 'VIP 名额流水（发放/消耗双向审计）' DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE INDEX `ix_quota_transactions_idx_quota_tx_ref` ON `quota_transactions` (`ref`);
CREATE INDEX `ix_quota_transactions_idx_quota_tx_user` ON `quota_transactions` (`user_id`);

DROP TABLE IF EXISTS `quotes`;
CREATE TABLE `quotes` (
  `id` VARCHAR(191) COMMENT '报价 ID（quoteId，提交时凭此校验价格）',
  `scene` TEXT NOT NULL COMMENT '报价场景：checkout=商城下单 / entitlement=开通权益 / upgrade=合伙人升级 / quota_purchase=购买名额 等',
  `user_id` TEXT COMMENT '报价所属用户 ID（未登录报价可为空或 anonymous）',
  `amount` DECIMAL(18,2) NOT NULL DEFAULT 0 COMMENT '报价总金额（元）',
  `breakdown` TEXT COMMENT '费用明细（JSON：goodsAmount 商品额 / discountAmount 优惠额 / listAmount 原价额）',
  `items` TEXT COMMENT '商品明细（JSON：[{key,qty,skuId}]）',
  `meta` TEXT COMMENT '业务上下文（JSON：{productKey,level,memberId,skuId}）',
  `rule_version` BIGINT NOT NULL DEFAULT 1 COMMENT '计价规则版本号（规则升级后旧报价可识别失效）',
  `issued_at` BIGINT NOT NULL DEFAULT 0 COMMENT '报价生成时间（毫秒时间戳）',
  `expires_at` BIGINT NOT NULL DEFAULT 0 COMMENT '报价过期时间（毫秒时间戳）',
  `consumed` BIGINT NOT NULL DEFAULT 0 COMMENT '是否已消费（1=已被订单占用，防止重复下单）',
  `consumed_at` BIGINT COMMENT '消费时间（毫秒时间戳）',
  `consumed_ref` TEXT COMMENT '消费方引用（如订单 ID）',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB COMMENT = '报价单（商城结算/权益开通/升级档位共用；默认 10 分钟有效、一次性消费）' DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

DROP TABLE IF EXISTS `regional_agents`;
CREATE TABLE `regional_agents` (
  `id` VARCHAR(191) COMMENT '代理记录 ID',
  `user_id` VARCHAR(191) NOT NULL COMMENT '代理身份归属人 ID',
  `region_type` VARCHAR(191) NOT NULL COMMENT '代理层级：province=省代 / city=市代 / district=县区代 / store=门店代理',
  `region_code` VARCHAR(191) COMMENT '区域码（门店费按此码精确匹配）',
  `price_tier` BIGINT NOT NULL DEFAULT 0 COMMENT '新价格表的人数档位（决定该代理的提价系数）',
  `referrer_id` VARCHAR(191) COMMENT '开发人 ID（推荐该代理的人）',
  `granted_tier` TEXT COMMENT '开通时赠予的身份（门店代理为空）',
  `appointed_at` VARCHAR(32) DEFAULT '1970-01-01 00:00:00' COMMENT '任命时间',
  PRIMARY KEY (`id`),
  FOREIGN KEY (`referrer_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT = '区域代理表（省代/市代/县区代/门店代理；代理是 users 的角色，故为关联表）' DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE INDEX `ix_regional_agents_idx_agents_region` ON `regional_agents` (`region_type`, `region_code`);
CREATE INDEX `ix_regional_agents_idx_agents_user` ON `regional_agents` (`user_id`);

DROP TABLE IF EXISTS `settings`;
CREATE TABLE `settings` (
  `id` BIGINT AUTO_INCREMENT COMMENT '记录 ID（自增主键）',
  `key` VARCHAR(191) NOT NULL COMMENT '配置键名（唯一，如 costore / order / dividend / quota / ladder 等）',
  `value` TEXT COMMENT '配置值（JSON 字符串）',
  UNIQUE KEY `uk_settings_key` (`key`),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB COMMENT = '后台可调配置（键值对 + JSON 值，与 store.js DEFAULT_SETTINGS 对齐）' DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE INDEX `ix_settings_sqlite_autoindex_settings_1` ON `settings` (`key`);

DROP TABLE IF EXISTS `settlements`;
CREATE TABLE `settlements` (
  `id` BIGINT AUTO_INCREMENT COMMENT '结算批次 ID（自增主键）',
  `period` TEXT NOT NULL COMMENT '结算月份（YYYY-MM）',
  `run_at` VARCHAR(32) DEFAULT '1970-01-01 00:00:00' COMMENT '跑批执行时间',
  `summary` TEXT COMMENT '结算汇总（JSON：byType 分类型合计 / total 总额 / agentBreakdown 代理明细 等）',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB COMMENT = '月度结算批次（每次跑批归档一份结果）' DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

DROP TABLE IF EXISTS `skus`;
CREATE TABLE `skus` (
  `id` VARCHAR(191) COMMENT 'SKU ID',
  `product_id` VARCHAR(191) NOT NULL COMMENT '所属商品 ID（productId）',
  `label` VARCHAR(255) DEFAULT '' COMMENT '规格名（如「智能变速，一档」）',
  `list_price` DECIMAL(18,2) NOT NULL DEFAULT 0 COMMENT '该规格标价（元）',
  `stock` BIGINT NOT NULL DEFAULT 0 COMMENT '当前可售库存',
  `updated_at` BIGINT NOT NULL DEFAULT 0 COMMENT '更新时间（毫秒时间戳）',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB COMMENT = '商城 SKU 目录（按规格细分的价格与库存）' DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE INDEX `ix_skus_idx_sku_product` ON `skus` (`product_id`);

DROP TABLE IF EXISTS `sms_codes`;
CREATE TABLE `sms_codes` (
  `id` BIGINT AUTO_INCREMENT COMMENT '验证码记录 ID（自增主键）',
  `phone` VARCHAR(191) NOT NULL COMMENT '接收手机号',
  `code` TEXT NOT NULL COMMENT '验证码明文',
  `purpose` VARCHAR(255) DEFAULT 'register' COMMENT '用途：register=注册 / reset-password=找回密码',
  `expires_at` BIGINT NOT NULL COMMENT '过期时间（毫秒时间戳）',
  `used` BIGINT NOT NULL DEFAULT 0 COMMENT '是否已使用（1=已用 / 0=未用）',
  `created_at` VARCHAR(32) DEFAULT '1970-01-01 00:00:00' COMMENT '发送时间',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB COMMENT = '短信验证码（按 purpose 场景隔离：register 与 reset-password 互不混用）' DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE INDEX `ix_sms_codes_idx_sms_phone` ON `sms_codes` (`phone`, `used`);

DROP TABLE IF EXISTS `stock_ledger`;
CREATE TABLE `stock_ledger` (
  `id` VARCHAR(191) COMMENT '流水 ID',
  `sku_id` VARCHAR(191) NOT NULL COMMENT 'SKU ID',
  `delta` BIGINT NOT NULL COMMENT '库存变动量（正=入库，负=出库）',
  `reason` TEXT NOT NULL COMMENT '变动原因：ORDER_CREATE=下单扣减 / ORDER_CANCEL_RESTORE=取消回补 / ADMIN_ADJUST=后台调整 等',
  `order_id` TEXT COMMENT '关联订单 ID（无则为空）',
  `operator_id` VARCHAR(191) COMMENT '操作人 ID（用户或后台管理员）',
  `at` BIGINT NOT NULL COMMENT '发生时间（毫秒时间戳）',
  `balance_after` BIGINT NOT NULL DEFAULT 0 COMMENT '该笔变动之后的结存库存',
  PRIMARY KEY (`id`),
  FOREIGN KEY (`operator_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  FOREIGN KEY (`sku_id`) REFERENCES `skus` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT = 'SKU 库存台账（每次出入库一条流水，可回溯库存变化）' DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE INDEX `ix_stock_ledger_idx_stock_sku` ON `stock_ledger` (`sku_id`);

DROP TABLE IF EXISTS `store_transfers`;
CREATE TABLE `store_transfers` (
  `id` VARCHAR(191) COMMENT '转店单 ID',
  `member_id` VARCHAR(191) NOT NULL COMMENT '转店会员 ID（members.id）',
  `from_store_id` TEXT COMMENT '原门店 ID',
  `target_store_id` TEXT NOT NULL COMMENT '目标门店 ID',
  `reason` VARCHAR(255) DEFAULT '' COMMENT '转店原因',
  `status` VARCHAR(255) DEFAULT 'PENDING' COMMENT '状态：PENDING=待审核 / APPROVED=已通过 / REJECTED=已驳回 / CANCELLED=已取消',
  `user_id` VARCHAR(191) COMMENT '发起人 ID（家长账号）',
  `store_agent_id` TEXT COMMENT '目标门店代理记录 ID',
  `idempotency_key` VARCHAR(191) COMMENT '幂等键（重复提交只生成一单）',
  `created_at` VARCHAR(32) DEFAULT '1970-01-01 00:00:00' COMMENT '申请时间',
  `version` BIGINT NOT NULL DEFAULT 1 COMMENT '乐观锁版本号',
  UNIQUE KEY `uk_store_transfers_id` (`id`),
  UNIQUE KEY `uk_store_transfers_idempotency_key` (`idempotency_key`),
  PRIMARY KEY (`id`),
  FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB COMMENT = '转店申请（会员在门店之间转移）' DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE INDEX `ix_store_transfers_idx_trs_member` ON `store_transfers` (`member_id`);
CREATE INDEX `ix_store_transfers_sqlite_autoindex_store_transfers_2` ON `store_transfers` (`idempotency_key`);

DROP TABLE IF EXISTS `support_feedback`;
CREATE TABLE `support_feedback` (
  `id` VARCHAR(191) COMMENT '反馈 ID',
  `user_id` VARCHAR(191) COMMENT '提交人 ID',
  `content` VARCHAR(255) DEFAULT '' COMMENT '反馈正文',
  `image_asset_ids` TEXT COMMENT '图片资源 ID 数组（JSON）',
  `idempotency_key` VARCHAR(191) COMMENT '幂等键（重复提交只留一条）',
  `created_at` VARCHAR(32) DEFAULT '1970-01-01 00:00:00' COMMENT '提交时间',
  UNIQUE KEY `uk_support_feedback_idempotency_key` (`idempotency_key`),
  PRIMARY KEY (`id`),
  FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB COMMENT = '客服反馈（用户提交的问题与建议）' DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE INDEX `ix_support_feedback_sqlite_autoindex_support_feedback_2` ON `support_feedback` (`idempotency_key`);

DROP TABLE IF EXISTS `training_feedback`;
CREATE TABLE `training_feedback` (
  `id` VARCHAR(191) COMMENT '反馈 ID',
  `member_id` VARCHAR(191) NOT NULL COMMENT '关联会员 ID（members.id）',
  `kind` VARCHAR(255) DEFAULT '' COMMENT '反馈类型（训练记录/身体状况等）',
  `title` VARCHAR(255) DEFAULT '' COMMENT '反馈标题',
  `text` VARCHAR(255) DEFAULT '' COMMENT '反馈正文',
  `coach_id` TEXT COMMENT '健脑官 ID（coaches.id）',
  `coach_name` VARCHAR(255) DEFAULT '' COMMENT '健脑官姓名（冗余快照）',
  `image_asset_ids` TEXT COMMENT '图片资源 ID 数组（JSON）',
  `attachment_asset_ids` TEXT COMMENT '附件资源 ID 数组（JSON）',
  `idempotency_key` VARCHAR(191) COMMENT '幂等键（重复提交只留一条）',
  `created_at` VARCHAR(32) DEFAULT '1970-01-01 00:00:00' COMMENT '提交时间',
  UNIQUE KEY `uk_training_feedback_text` (`text`),
  UNIQUE KEY `uk_training_feedback_idempotency_key` (`idempotency_key`),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB COMMENT = '训练反馈（家长/健脑官针对会员提交的课后反馈）' DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE INDEX `ix_training_feedback_idx_tfb_member` ON `training_feedback` (`member_id`);
CREATE INDEX `ix_training_feedback_sqlite_autoindex_training_feedback_2` ON `training_feedback` (`idempotency_key`);

DROP TABLE IF EXISTS `upline_history`;
CREATE TABLE `upline_history` (
  `id` BIGINT AUTO_INCREMENT COMMENT '记录 ID（自增主键）',
  `user_id` VARCHAR(191) NOT NULL COMMENT '被变更人 ID',
  `old_upline` VARCHAR(191) COMMENT '变更前的直接上级 ID',
  `new_upline` VARCHAR(191) COMMENT '变更后的直接上级 ID',
  `action` TEXT COMMENT '变更动作：unbind=解绑 / rebind=重绑 / rename=改名 等',
  `at` VARCHAR(32) DEFAULT '1970-01-01 00:00:00' COMMENT '变更时间',
  PRIMARY KEY (`id`),
  FOREIGN KEY (`new_upline`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  FOREIGN KEY (`old_upline`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT = '上下级关系变更历史（解绑/重绑/改名留痕）' DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE INDEX `ix_upline_history_idx_upline_hist_user` ON `upline_history` (`user_id`);

DROP TABLE IF EXISTS `users`;
CREATE TABLE `users` (
  `id` VARCHAR(191) COMMENT '内部 ID（如 u_xxx / p1），全库唯一主键',
  `seq` BIGINT NOT NULL COMMENT '全局注册序号（1,2,3…，第 10000 名即 10000，不截断）',
  `display_id` VARCHAR(191) NOT NULL COMMENT '对外编号：身份前缀 + seq（QZ 普通 / YH 用户 / VIP / TS 天使 / SD 私董 / LC 联创）',
  `name` VARCHAR(255) DEFAULT '' COMMENT '用户姓名',
  `phone` VARCHAR(191) NOT NULL COMMENT '注册手机号（应用层 409 唯一校验，此处兜底唯一约束）',
  `password` VARCHAR(255) DEFAULT '' COMMENT '登录口令（存 scrypt 哈希串 scrypt$salt$hash，历史明文由启动迁移自动升级）',
  `password_migrated_at` BIGINT COMMENT '明文口令升级为哈希的时间（毫秒时间戳）',
  `tier` VARCHAR(255) DEFAULT 'none' COMMENT '合伙人能力档位：none/vip/angel/private/cofounder（普通/VIP/天使/私董/联创）',
  `is_founding` VARCHAR(255) DEFAULT 'none' COMMENT '是否持创始奖：founding=是 / none=否',
  `upline_id` VARCHAR(191) COMMENT '直接上级 ID（推荐链，自引用；上级被删则置空）',
  `team_vip` BIGINT NOT NULL DEFAULT 0 COMMENT '团队 VIP 人数（缓存字段，读时按需重算）',
  `annual_fee_paid` BIGINT NOT NULL DEFAULT 1 COMMENT '年费是否已缴（1=已缴 / 0=未缴）',
  `entitlement_state` VARCHAR(255) DEFAULT 'never_paid' COMMENT '权益收益费三态：never_paid=未开通 / active=生效中 / expired=已过期（过期后佣金引擎全部停算，仅可导出历史账单）',
  `entitlement_paid_at` BIGINT COMMENT '权益收益费实付时间（毫秒时间戳）',
  `entitlement_expires_at` BIGINT COMMENT '权益到期时间（毫秒时间戳，惰性判定：小于当前时间即视为 expired）',
  `role` TEXT COMMENT '登录通道角色：user/parent/coach/admin（缺省时由 tier 推导）',
  `avatar` TEXT COMMENT '头像引用（assets.id 或图片 URL）',
  `wechat_openid` TEXT COMMENT '微信授权 OpenID（当前为 Mock 占位）',
  `created_at` VARCHAR(32) DEFAULT '1970-01-01 00:00:00' COMMENT '注册时间',
  `principal_tier` TEXT COMMENT '本金档（升级计价锚点）：升级价 = 目标档零售价 − 本金档零售价；旧记录缺省回退 oldTier',
  `referral_tier` TEXT COMMENT '被推荐人注册时的自身档位快照（用于推荐关系结算，不随后续变动漂移）',
  `referral_upline_tier` TEXT COMMENT '下级被推荐时其直接上级所处档位快照（用于同级推荐判定，不随上级后续变动漂移）',
  `free_upgrade_applied` BIGINT NOT NULL DEFAULT 0 COMMENT '已发放免费升档次数（幂等计数；0=未发放）',
  UNIQUE KEY `uk_users_id` (`id`),
  UNIQUE KEY `uk_users_seq` (`seq`),
  UNIQUE KEY `uk_users_display_id` (`display_id`),
  UNIQUE KEY `uk_users_phone` (`phone`),
  PRIMARY KEY (`id`),
  FOREIGN KEY (`upline_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB COMMENT = '用户主表（人；所有人的主档，代理/合店老板等身份是身上的角色而非独立表）' DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE INDEX `ix_users_idx_users_entitle` ON `users` (`entitlement_state`);
CREATE INDEX `ix_users_idx_users_tier` ON `users` (`tier`);
CREATE INDEX `ix_users_idx_users_upline` ON `users` (`upline_id`);
CREATE INDEX `ix_users_sqlite_autoindex_users_4` ON `users` (`phone`);
CREATE INDEX `ix_users_sqlite_autoindex_users_3` ON `users` (`display_id`);
CREATE INDEX `ix_users_sqlite_autoindex_users_2` ON `users` (`seq`);

DROP TABLE IF EXISTS `wechat_tickets`;
CREATE TABLE `wechat_tickets` (
  `id` VARCHAR(191) COMMENT '票据记录 ID',
  `openid` TEXT COMMENT '用户 OpenID',
  `ticket` VARCHAR(191) NOT NULL COMMENT '微信票据凭证（主查询键）',
  `mode` VARCHAR(255) DEFAULT 'mock' COMMENT '模式：mock=模拟 / live=真实微信',
  `used` BIGINT NOT NULL DEFAULT 0 COMMENT '是否已核销（1=已用 / 0=未用，一次一换）',
  `expires_at` BIGINT NOT NULL COMMENT '过期时间（毫秒时间戳）',
  `created_at` BIGINT NOT NULL COMMENT '创建时间（毫秒时间戳）',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB COMMENT = '微信授权票据（一次一换；live / mock 双模式）' DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE INDEX `ix_wechat_tickets_idx_wechat_ticket` ON `wechat_tickets` (`ticket`);

DROP TABLE IF EXISTS `withdrawals`;
CREATE TABLE `withdrawals` (
  `id` VARCHAR(191) COMMENT '提现单 ID',
  `user_id` VARCHAR(191) NOT NULL COMMENT '申请人 ID',
  `title` VARCHAR(255) DEFAULT '余额提现' COMMENT '提现标题（如「余额提现」）',
  `amount` DECIMAL(18,2) NOT NULL COMMENT '提现金额（元）',
  `fee` DECIMAL(18,2) NOT NULL DEFAULT 0 COMMENT '手续费（元）= 金额 × 0.6%，最低 1 元',
  `net_amount` DECIMAL(18,2) NOT NULL DEFAULT 0 COMMENT '实际到账金额（元）= amount − fee',
  `status` VARCHAR(255) DEFAULT 'PENDING_REVIEW' COMMENT '状态：PENDING_REVIEW=待审核 / APPROVED=已通过 / REJECTED=已驳回 / PAID=已打款 / FAILED=打款失败',
  `account_type` TEXT NOT NULL COMMENT '收款账户类型（快照）',
  `account_name` VARCHAR(255) DEFAULT '' COMMENT '收款户名（快照）',
  `bank_name` VARCHAR(255) DEFAULT '' COMMENT '开户行（快照）',
  `masked_bank_number` VARCHAR(255) DEFAULT '' COMMENT '脱敏账号（快照）',
  `operation_id` TEXT NOT NULL COMMENT '操作流水号（op_xxx）',
  `idempotency_key` VARCHAR(191) COMMENT '幂等键（重复提交只生成一单）',
  `reject_reason` TEXT COMMENT '驳回原因（审核不通过时填写）',
  `created_at` VARCHAR(32) DEFAULT '1970-01-01 00:00:00' COMMENT '申请时间',
  UNIQUE KEY `uk_withdrawals_idempotency_key` (`idempotency_key`),
  PRIMARY KEY (`id`),
  FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT = '提现单（手续费 0.6%、最低 1 元；审核流目前未接正式打款通道）' DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE INDEX `ix_withdrawals_idx_wdl_status` ON `withdrawals` (`status`);
CREATE INDEX `ix_withdrawals_idx_wdl_user` ON `withdrawals` (`user_id`);
CREATE INDEX `ix_withdrawals_sqlite_autoindex_withdrawals_2` ON `withdrawals` (`idempotency_key`);

INSERT INTO `activation_codes` (`code`, `target_type`, `target_id`, `max_uses`, `uses`, `status`, `expires_at`, `used_by`, `channel`, `store_id`, `issued_by`, `issued_to`, `batch_id`, `note`, `created_at`) VALUES
  ('NS-FS-0001', 'fs', NULL, 1, 0, 'active', 1800871807831, '[]', 'admin', NULL, NULL, NULL, NULL, NULL, '2026-10-28 08:51:15'),
  ('NS-FS-0006', 'fs', NULL, 1, 0, 'active', 1800871807831, '[]', 'admin', NULL, NULL, NULL, NULL, NULL, '2026-10-28 08:51:15'),
  ('NS-JY-0002', 'jy', NULL, 1, 0, 'active', 1800871807831, '[]', 'admin', NULL, NULL, NULL, NULL, NULL, '2026-10-28 08:51:15'),
  ('NS-CJ-0003', 'cj', NULL, 1, 0, 'active', 1800871807831, '[]', 'admin', NULL, NULL, NULL, NULL, NULL, '2026-10-28 08:51:15'),
  ('NS-XN-0004', 'xn', NULL, 1, 0, 'active', 1800871807831, '[]', 'admin', NULL, NULL, NULL, NULL, NULL, '2026-10-28 08:51:15'),
  ('NS-YS-0005', 'ys', NULL, 1, 0, 'active', 1800871807831, '[]', 'admin', NULL, NULL, NULL, NULL, NULL, '2026-10-28 08:51:15'),
  ('NS-L1-0001', 'level', 'L1', 1, 0, 'active', 1800871807831, '[]', 'admin', NULL, NULL, NULL, NULL, NULL, '2026-10-28 08:51:15'),
  ('NS-L2-0002', 'level', 'L2', 1, 0, 'active', 1800871807831, '[]', 'admin', NULL, NULL, NULL, NULL, NULL, '2026-10-28 08:51:15'),
  ('NS-COL-0001', 'column', 'col_1', 1, 0, 'active', 1800871807831, '[]', 'admin', NULL, NULL, NULL, NULL, NULL, '2026-10-28 08:51:15'),
  ('NS-TEST-FS-0001', 'fs', NULL, 1, 0, 'active', 1824684557762, '[]', 'admin', NULL, NULL, NULL, NULL, NULL, '2026-10-28 08:51:15'),
  ('NS-TEST-JY-0001', 'jy', NULL, 1, 0, 'active', 1824684557762, '[]', 'admin', NULL, NULL, NULL, NULL, NULL, '2026-10-28 08:51:15'),
  ('NS-TEST-CJ-0001', 'cj', NULL, 1, 0, 'active', 1824684557762, '[]', 'admin', NULL, NULL, NULL, NULL, NULL, '2026-10-28 08:51:15'),
  ('NS-TEST-XN-0001', 'xn', NULL, 1, 0, 'active', 1824684557762, '[]', 'admin', NULL, NULL, NULL, NULL, NULL, '2026-10-28 08:51:15'),
  ('NS-TEST-YS-0001', 'ys', NULL, 1, 0, 'active', 1824684557762, '[]', 'admin', NULL, NULL, NULL, NULL, NULL, '2026-10-28 08:51:15');

INSERT INTO `allocation_quotes` (`id`, `entry_id`, `user_id`, `kind`, `targets`, `entry_amount`, `rows`, `total_percent`, `total_amount`, `expires_at`, `created_at`) VALUES
  ('aq_72', 'po-o_70-featured_store_sales', 'p6', 'sales', '[{"targetId":"county","percent":100,"kind":"sales"}]', 46.8, '[{"targetId":"p5","name":"区县代-戊(私董)","kind":"county","percent":100,"amount":46.8,"roleLabel":"上级区代","agentId":null}]', 100, 46.8, 1793149054230, 1793148454230),
  ('aq_100', 'po-o_70-featured_store_sales', 'p6', 'sales', '[{"targetId":"county","percent":100,"kind":"sales"}]', 46.8, '[{"targetId":"p5","name":"区县代-戊(私董)","kind":"county","percent":100,"amount":46.8,"roleLabel":"上级区代","agentId":null}]', 100, 46.8, 1793149087181, 1793148487181),
  ('aq_102', 'po-o_70-featured_store_sales', 'p6', 'sales', '[{"targetId":"other","percent":100,"kind":"sales","agentId":"p5"}]', 46.8, '[{"targetId":"p5","name":"区县代-戊(私董)","kind":"other","percent":100,"amount":46.8,"roleLabel":"其他代理","agentId":"p5"}]', 100, 46.8, 1793149087189, 1793148487189),
  ('aq_105', 'po-o_70-featured_store_sales', 'p6', 'sales', '[{"targetId":"county","percent":100,"kind":"sales"}]', 46.8, '[{"targetId":"p5","name":"区县代-戊(私董)","kind":"county","percent":100,"amount":46.8,"roleLabel":"上级区代","agentId":null}]', 100, 46.8, 1793149090379, 1793148490379),
  ('aq_106', 'po-o_70-featured_store_sales', 'p6', 'sales', '[{"targetId":"other","percent":100,"kind":"sales","agentId":"p5"}]', 46.8, '[{"targetId":"p5","name":"区县代-戊(私董)","kind":"other","percent":100,"amount":46.8,"roleLabel":"其他代理","agentId":"p5"}]', 100, 46.8, 1793149090389, 1793148490389),
  ('aq_109', 'po-o_70-featured_store_sales', 'p6', 'sales', '[{"targetId":"county","percent":100,"kind":"sales"}]', 46.8, '[{"targetId":"p5","name":"区县代-戊(私董)","kind":"county","percent":100,"amount":46.8,"roleLabel":"上级区代","agentId":null}]', 100, 46.8, 1793149104750, 1793148504750),
  ('aq_110', 'po-o_70-featured_store_sales', 'p6', 'sales', '[{"targetId":"other","percent":100,"kind":"sales","agentId":"p5"}]', 46.8, '[{"targetId":"p5","name":"区县代-戊(私董)","kind":"other","percent":100,"amount":46.8,"roleLabel":"其他代理","agentId":"p5"}]', 100, 46.8, 1793149104760, 1793148504760),
  ('aq_113', 'po-o_70-featured_store_sales', 'p6', 'sales', '[{"targetId":"county","percent":100,"kind":"sales"}]', 46.8, '[{"targetId":"p5","name":"区县代-戊(私董)","kind":"county","percent":100,"amount":46.8,"roleLabel":"上级区代","agentId":null}]', 100, 46.8, 1793149116234, 1793148516234),
  ('aq_114', 'po-o_70-featured_store_sales', 'p6', 'sales', '[{"targetId":"other","percent":100,"kind":"sales","agentId":"p5"}]', 46.8, '[{"targetId":"p5","name":"区县代-戊(私董)","kind":"other","percent":100,"amount":46.8,"roleLabel":"其他代理","agentId":"p5"}]', 100, 46.8, 1793149116242, 1793148516242),
  ('aq_141', 'po-o_70-featured_store_sales', 'p6', 'sales', '[{"targetId":"county","percent":100,"kind":"sales"}]', 46.8, '[{"targetId":"p5","name":"区县代-戊(私董)","kind":"county","percent":100,"amount":46.8,"roleLabel":"上级区代","agentId":null}]', 100, 46.8, 1793149170615, 1793148570615),
  ('aq_142', 'po-o_70-featured_store_sales', 'p6', 'sales', '[{"targetId":"other","percent":100,"kind":"sales","agentId":"p5"}]', 46.8, '[{"targetId":"p5","name":"区县代-戊(私董)","kind":"other","percent":100,"amount":46.8,"roleLabel":"其他代理","agentId":"p5"}]', 100, 46.8, 1793149170625, 1793148570625),
  ('aq_143', 'po-o_139-featured_district_inspect', 'p5', 'inspect', '[{"targetId":"province","percent":100,"kind":"inspection"}]', 46.8, '[{"targetId":"p1","name":"总部联创-甲","kind":"province","percent":100,"amount":46.8,"roleLabel":"上级省代","agentId":null}]', 100, 46.8, 1793149170635, 1793148570635),
  ('aq_147', 'po-o_70-featured_store_sales', 'p6', 'sales', '[{"targetId":"county","percent":100,"kind":"sales"}]', 46.8, '[{"targetId":"p5","name":"区县代-戊(私董)","kind":"county","percent":100,"amount":46.8,"roleLabel":"上级区代","agentId":null}]', 100, 46.8, 1793149175821, 1793148575821),
  ('aq_148', 'po-o_70-featured_store_sales', 'p6', 'sales', '[{"targetId":"other","percent":100,"kind":"sales","agentId":"p5"}]', 46.8, '[{"targetId":"p5","name":"区县代-戊(私董)","kind":"other","percent":100,"amount":46.8,"roleLabel":"其他代理","agentId":"p5"}]', 100, 46.8, 1793149175830, 1793148575830),
  ('aq_149', 'po-o_139-featured_district_inspect', 'p5', 'inspect', '[{"targetId":"province","percent":100,"kind":"inspection"}]', 46.8, '[{"targetId":"p1","name":"总部联创-甲","kind":"province","percent":100,"amount":46.8,"roleLabel":"上级省代","agentId":null}]', 100, 46.8, 1793149175838, 1793148575838),
  ('aq_152', 'po-o_70-featured_store_sales', 'p6', 'sales', '[{"targetId":"county","percent":100,"kind":"sales"}]', 46.8, '[{"targetId":"p5","name":"区县代-戊(私董)","kind":"county","percent":100,"amount":46.8,"roleLabel":"上级区代","agentId":null}]', 100, 46.8, 1793149176392, 1793148576392);

INSERT INTO `allocations` (`id`, `entry_id`, `user_id`, `target_id`, `beneficiary_name`, `kind`, `percent`, `amount`, `status`, `operation_id`, `idempotency_key`, `created_at`) VALUES
  ('alc_73-0', 'po-o_70-featured_store_sales', 'p6', 'p5', '区县代-戊(私董)', 'sales', 100, 46.8, 'PENDING_SETTLEMENT', 'op-alc_73', 'bizloop-al-1-rmvreai1x', '1793148454235.0'),
  ('alc_101-0', 'po-o_70-featured_store_sales', 'p6', 'p5', '区县代-戊(私董)', 'sales', 100, 46.8, 'PENDING_SETTLEMENT', 'op-alc_101', 'e2e-al-1', '1793148487185.0'),
  ('alc_144-0', 'po-o_139-featured_district_inspect', 'p5', 'p1', '总部联创-甲', 'inspection', 100, 46.8, 'PENDING_SETTLEMENT', 'op-alc_144', 'e2e-al-2', '1793148570639.0'),
  ('alc_153-0', 'po-o_70-featured_store_sales', 'p6', 'p5', '区县代-戊(私董)', 'sales', 100, 46.8, 'PENDING_SETTLEMENT', 'op-alc_153', 'bizloop-al-1-rmvred4bd', '1793148576397.0');

INSERT INTO `co_store_owners` (`id`, `co_store_id`, `user_id`, `performance`, `created_at`) VALUES
  (1, 'cs_16', 'p7', 500, '2026-10-28 08:51:15');

INSERT INTO `co_stores` (`id`, `owner_id`, `promoter_id`, `store_manager_id`, `store_id`, `monthly_fee`, `owner_count`, `join_date`, `created_at`) VALUES
  ('cs_16', 'p7', 'p6', 'p6', '330110-S1', 698, 1, '2026-10', '2026-10-28 08:51:15');

INSERT INTO `columns` (`id`, `title`, `summary`, `cover_url`, `price`, `fulfillment_type`, `requires_member`, `price_presentation`, `checkout_notice`, `content`, `chapters`) VALUES
  ('col_1', '专注力特训专栏', '21 天专注力提升计划，配套视频与练习，适合在家自主训练。', '/static/product/product-cover.png', 299, 'ACTIVATION_CODE', 0, 'tiered', '专栏课下单后联系门店获取激活码', '{"format":"nodes","version":1,"nodes":[{"name":"h2","children":[{"type":"text","text":"专注力特训专栏"}]},{"name":"p","children":[{"type":"text","text":"这是一套面向 6–12 岁孩子的专注力训练方案，共 4 课，每课 10 分钟左右，含视频与练习。"}]},{"name":"p","children":[{"type":"text","text":"建议每天固定一个时段陪孩子跟练一次，课后记录完成情况，下一课会自动带出上次的进度。"}]}]}', '[{"id":"COL1-C1","title":"开篇 · 专注力基线测评","type":"article","content":{"format":"nodes","version":1,"nodes":[{"name":"h2","children":[{"type":"text","text":"专注力基线测评"}]},{"name":"p","children":[{"type":"text","text":"先做一次基线测评，了解孩子当前的专注水平，后续对照进步。"}]}]}},{"id":"COL1-C2","title":"第 1 周 · 呼吸与放松训练","type":"video","videoUrl":"https://cdn.naoshang.example.com/video/col1-c2.mp4","posterUrl":"https://cdn.naoshang.example.com/poster/col1-c2.jpg","content":{"format":"nodes","version":1,"nodes":[{"name":"h2","children":[{"type":"text","text":"呼吸与放松训练"}]},{"name":"p","children":[{"type":"text","text":"每天 5 分钟呼吸训练，帮助快速进入专注状态。"}]}]}},{"id":"COL1-C3","title":"第 2 周 · 番茄工作法","type":"article","content":{"format":"nodes","version":1,"nodes":[{"name":"h2","children":[{"type":"text","text":"番茄工作法"}]},{"name":"p","children":[{"type":"text","text":"用番茄钟把学习任务切小，降低启动阻力。"}]}]}},{"id":"COL1-C4","title":"第 3 周 · 干扰隔离训练","type":"video","videoUrl":"https://cdn.naoshang.example.com/video/col1-c4.mp4","posterUrl":"https://cdn.naoshang.example.com/poster/col1-c4.jpg","content":{"format":"nodes","version":1,"nodes":[{"name":"h2","children":[{"type":"text","text":"干扰隔离训练"}]},{"name":"p","children":[{"type":"text","text":"识别并隔离干扰源，打造无干扰学习环境。"}]}]}}]'),
  ('col_2', '记忆大师专栏', '从联想记忆到记忆宫殿，系统提升记忆效率。', '/static/product/product-cover.png', 199, 'ACTIVATION_CODE', 0, 'tiered', '专栏课下单后联系门店获取激活码', '{"format":"nodes","version":1,"nodes":[{"name":"h2","children":[{"type":"text","text":"记忆大师专栏"}]},{"name":"p","children":[{"type":"text","text":"共 2 课，聚焦可迁移的记忆方法：先把零散信息用故事串起来，再用空间把故事固定下来。"}]}]}', '[{"id":"COL2-C1","title":"联想记忆入门","type":"article","content":{"format":"nodes","version":1,"nodes":[{"name":"h2","children":[{"type":"text","text":"联想记忆入门"}]},{"name":"p","children":[{"type":"text","text":"用故事把零散信息串联起来，记得更牢。"}]}]}},{"id":"COL2-C2","title":"记忆宫殿实战","type":"video","videoUrl":"https://cdn.naoshang.example.com/video/col2-c2.mp4","posterUrl":"https://cdn.naoshang.example.com/poster/col2-c2.jpg","content":{"format":"nodes","version":1,"nodes":[{"name":"h2","children":[{"type":"text","text":"记忆宫殿实战"}]},{"name":"p","children":[{"type":"text","text":"搭建你的第一座记忆宫殿，存放考试要点。"}]}]}}]');

INSERT INTO `commissions` (`id`, `owner_id`, `identity`, `type`, `subtype`, `period`, `base_amount`, `rate`, `amount`, `ref_order_id`, `status`, `note`, `formula`, `created_at`) VALUES
  ('c_2', 'p3', 'partner', 'supply', NULL, '2026-10', 7980, NULL, 480, 'o_1', 'pending', NULL, '实付 7980 − 拿货成本 7500 = 差价 480', '2026-10-28 08:51:14'),
  ('c_3', 'p2', 'partner', 'supply', NULL, '2026-10', 7980, NULL, 520, 'o_1', 'pending', NULL, '供货链级差 (7500 − 6980) × 1 名额 = 520', '2026-10-28 08:51:14'),
  ('c_4', 'p1', 'partner', 'supply', NULL, '2026-10', 7980, NULL, 480, 'o_1', 'pending', NULL, '供货链级差 (6980 − 6500) × 1 名额 = 480', '2026-10-28 08:51:14'),
  ('c_6', 'p5', 'partner', 'supply', NULL, '2026-10', 22500, NULL, 1560, 'o_5', 'pending', NULL, '实付 22500 − 拿货成本 20940 = 差价 1560', '2026-10-28 08:51:14'),
  ('c_7', 'p1', 'partner', 'supply', NULL, '2026-10', 22500, NULL, 1440, 'o_5', 'pending', NULL, '供货链级差 (6980 − 6500) × 3 名额 = 1440', '2026-10-28 08:51:14'),
  ('c_9', 'p2', 'partner', 'supply', NULL, '2026-10', 15000, NULL, 760.8, 'o_8', 'pending', NULL, '供货链级差 (7500 − 6980) × 2 名额 − 平级奖 279.2 = 760.8', '2026-10-28 08:51:14'),
  ('c_10', 'p1', 'partner', 'supply', NULL, '2026-10', 15000, NULL, 960, 'o_8', 'pending', NULL, '供货链级差 (6980 − 6500) × 2 名额 = 960', '2026-10-28 08:51:14'),
  ('c_11', 'p3', 'partner', 'parity', NULL, '2026-10', 6980, 0.02, 279.2, 'o_8', 'pending', NULL, '平级奖 供货上级(private)拿货价 6980 × 2% × 2 名额 = 279.2（已从 p2 级差扣）', '2026-10-28 08:51:14'),
  ('po-o_28-chain_store', 'HQ', 'partner', 'product', 'chain_store', '2026-10', 4537, 0.23, 1047, 'o_28', 'pending', '固定链级差 单店 (0.65−0.5)×6980', '4537 × 23% = 1047', '2026-10-28 08:51:14'),
  ('po-o_28-chain_district', 'HQ', 'partner', 'product', 'chain_district', '2026-10', 4537, 0.15, 698, 'o_28', 'pending', '固定链级差 区县代 (0.5−0.4)×6980', '4537 × 15% = 698', '2026-10-28 08:51:14'),
  ('po-o_28-chain_city', 'HQ', 'partner', 'product', 'chain_city', '2026-10', 4537, 0.08, 349, 'o_28', 'pending', '固定链级差 市代 (0.4−0.35)×6980', '4537 × 8% = 349', '2026-10-28 08:51:14'),
  ('po-o_28-chain_province', 'HQ', 'partner', 'product', 'chain_province', '2026-10', 4537, 0.08, 349, 'o_28', 'pending', '固定链级差 省代 (0.35−0.3)×6980', '4537 × 8% = 349', '2026-10-28 08:51:14'),
  ('po-o_28-chain_hq', 'HQ', 'partner', 'product', 'chain_hq', '2026-10', 4537, 0.46, 2094, 'o_28', 'pending', '固定链级差 总部 (0.3−0)×6980', '4537 × 46% = 2094', '2026-10-28 08:51:14'),
  ('po-o_30-chain_hq_direct', 'HQ', 'partner', 'product', 'chain_hq_direct', '2026-10', 2094, 1, 2094, 'o_30', 'pending', '总部直供（无上级代理）', '2094 × 100% = 2094', '2026-10-28 08:51:14'),
  ('po-o_32-chain_district', 'HQ', 'partner', 'product', 'chain_district', '2026-10', 3490, 0.2, 698, 'o_32', 'pending', '固定链级差 区县代 (0.5−0.4)×6980', '3490 × 20% = 698', '2026-10-28 08:51:14'),
  ('po-o_32-chain_city', 'HQ', 'partner', 'product', 'chain_city', '2026-10', 3490, 0.1, 349, 'o_32', 'pending', '固定链级差 市代 (0.4−0.35)×6980', '3490 × 10% = 349', '2026-10-28 08:51:14'),
  ('po-o_32-chain_province', 'HQ', 'partner', 'product', 'chain_province', '2026-10', 3490, 0.1, 349, 'o_32', 'pending', '固定链级差 省代 (0.35−0.3)×6980', '3490 × 10% = 349', '2026-10-28 08:51:14'),
  ('po-o_32-chain_hq', 'HQ', 'partner', 'product', 'chain_hq', '2026-10', 3490, 0.6, 2094, 'o_32', 'pending', '固定链级差 总部 (0.3−0)×6980', '3490 × 60% = 2094', '2026-10-28 08:51:14'),
  ('po-o_34-chain_store', 'HQ', 'partner', 'product', 'chain_store', '2026-10', 4886, 0.29, 1396, 'o_34', 'pending', '固定链级差 单店 (0.7−0.5)×6980', '4886 × 29% = 1396', '2026-10-28 08:51:14'),
  ('po-o_34-chain_district', 'HQ', 'partner', 'product', 'chain_district', '2026-10', 4886, 0.14, 698, 'o_34', 'pending', '固定链级差 区县代 (0.5−0.4)×6980', '4886 × 14% = 698', '2026-10-28 08:51:14'),
  ('po-o_34-chain_city', 'HQ', 'partner', 'product', 'chain_city', '2026-10', 4886, 0.07, 349, 'o_34', 'pending', '固定链级差 市代 (0.4−0.35)×6980', '4886 × 7% = 349', '2026-10-28 08:51:14'),
  ('po-o_34-chain_province', 'HQ', 'partner', 'product', 'chain_province', '2026-10', 4886, 0.07, 349, 'o_34', 'pending', '固定链级差 省代 (0.35−0.3)×6980', '4886 × 7% = 349', '2026-10-28 08:51:14'),
  ('po-o_34-chain_hq', 'HQ', 'partner', 'product', 'chain_hq', '2026-10', 4886, 0.43, 2094, 'o_34', 'pending', '固定链级差 总部 (0.3−0)×6980', '4886 × 43% = 2094', '2026-10-28 08:51:14'),
  ('po-o_36-chain_store', 'HQ', 'partner', 'product', 'chain_store', '2026-10', 5235, 0.33, 1745, 'o_36', 'pending', '固定链级差 单店 (0.75−0.5)×6980', '5235 × 33% = 1745', '2026-10-28 08:51:14'),
  ('po-o_36-chain_district', 'HQ', 'partner', 'product', 'chain_district', '2026-10', 5235, 0.13, 698, 'o_36', 'pending', '固定链级差 区县代 (0.5−0.4)×6980', '5235 × 13% = 698', '2026-10-28 08:51:14'),
  ('po-o_36-chain_city', 'HQ', 'partner', 'product', 'chain_city', '2026-10', 5235, 0.07, 349, 'o_36', 'pending', '固定链级差 市代 (0.4−0.35)×6980', '5235 × 7% = 349', '2026-10-28 08:51:14'),
  ('po-o_36-chain_province', 'HQ', 'partner', 'product', 'chain_province', '2026-10', 5235, 0.07, 349, 'o_36', 'pending', '固定链级差 省代 (0.35−0.3)×6980', '5235 × 7% = 349', '2026-10-28 08:51:14'),
  ('po-o_36-chain_hq', 'HQ', 'partner', 'product', 'chain_hq', '2026-10', 5235, 0.4, 2094, 'o_36', 'pending', '固定链级差 总部 (0.3−0)×6980', '5235 × 40% = 2094', '2026-10-28 08:51:14'),
  ('po-o_38-chain_store', 'HQ', 'partner', 'product', 'chain_store', '2026-10', 5584, 0.38, 2094, 'o_38', 'pending', '固定链级差 单店 (0.8−0.5)×6980', '5584 × 38% = 2094', '2026-10-28 08:51:14'),
  ('po-o_38-chain_district', 'HQ', 'partner', 'product', 'chain_district', '2026-10', 5584, 0.13, 698, 'o_38', 'pending', '固定链级差 区县代 (0.5−0.4)×6980', '5584 × 13% = 698', '2026-10-28 08:51:14'),
  ('po-o_38-chain_city', 'HQ', 'partner', 'product', 'chain_city', '2026-10', 5584, 0.06, 349, 'o_38', 'pending', '固定链级差 市代 (0.4−0.35)×6980', '5584 × 6% = 349', '2026-10-28 08:51:14'),
  ('po-o_38-chain_province', 'HQ', 'partner', 'product', 'chain_province', '2026-10', 5584, 0.06, 349, 'o_38', 'pending', '固定链级差 省代 (0.35−0.3)×6980', '5584 × 6% = 349', '2026-10-28 08:51:14'),
  ('po-o_38-chain_hq', 'HQ', 'partner', 'product', 'chain_hq', '2026-10', 5584, 0.38, 2094, 'o_38', 'pending', '固定链级差 总部 (0.3−0)×6980', '5584 × 38% = 2094', '2026-10-28 08:51:14'),
  ('po-o_40-chain_store', 'HQ', 'partner', 'product', 'chain_store', '2026-10', 6980, 0.5, 3490, 'o_40', 'pending', '固定链级差 单店 (1−0.5)×6980', '6980 × 50% = 3490', '2026-10-28 08:51:14'),
  ('po-o_40-chain_district', 'HQ', 'partner', 'product', 'chain_district', '2026-10', 6980, 0.1, 698, 'o_40', 'pending', '固定链级差 区县代 (0.5−0.4)×6980', '6980 × 10% = 698', '2026-10-28 08:51:14'),
  ('po-o_40-chain_city', 'HQ', 'partner', 'product', 'chain_city', '2026-10', 6980, 0.05, 349, 'o_40', 'pending', '固定链级差 市代 (0.4−0.35)×6980', '6980 × 5% = 349', '2026-10-28 08:51:14'),
  ('po-o_40-chain_province', 'HQ', 'partner', 'product', 'chain_province', '2026-10', 6980, 0.05, 349, 'o_40', 'pending', '固定链级差 省代 (0.35−0.3)×6980', '6980 × 5% = 349', '2026-10-28 08:51:14'),
  ('po-o_40-chain_hq', 'HQ', 'partner', 'product', 'chain_hq', '2026-10', 6980, 0.3, 2094, 'o_40', 'pending', '固定链级差 总部 (0.3−0)×6980', '6980 × 30% = 2094', '2026-10-28 08:51:14'),
  ('po-o_42-chain_store', 'HQ', 'partner', 'product', 'chain_store', '2026-10', 6980, 0.5, 3490, 'o_42', 'pending', '固定链级差 单店 (1−0.5)×6980', '6980 × 50% = 3490', '2026-10-28 08:51:14'),
  ('po-o_42-chain_district', 'HQ', 'partner', 'product', 'chain_district', '2026-10', 6980, 0.1, 698, 'o_42', 'pending', '固定链级差 区县代 (0.5−0.4)×6980', '6980 × 10% = 698', '2026-10-28 08:51:14'),
  ('po-o_42-chain_city', 'HQ', 'partner', 'product', 'chain_city', '2026-10', 6980, 0.05, 349, 'o_42', 'pending', '固定链级差 市代 (0.4−0.35)×6980', '6980 × 5% = 349', '2026-10-28 08:51:14'),
  ('po-o_42-chain_province', 'HQ', 'partner', 'product', 'chain_province', '2026-10', 6980, 0.05, 349, 'o_42', 'pending', '固定链级差 省代 (0.35−0.3)×6980', '6980 × 5% = 349', '2026-10-28 08:51:14'),
  ('po-o_42-chain_hq', 'HQ', 'partner', 'product', 'chain_hq', '2026-10', 6980, 0.3, 2094, 'o_42', 'pending', '固定链级差 总部 (0.3−0)×6980', '6980 × 30% = 2094', '2026-10-28 08:51:14'),
  ('po-o_44-chain_city', 'HQ', 'partner', 'product', 'chain_city', '2026-10', 2792, 0.13, 349, 'o_44', 'pending', '固定链级差 市代 (0.4−0.35)×6980', '2792 × 13% = 349', '2026-10-28 08:51:14'),
  ('po-o_44-chain_province', 'HQ', 'partner', 'product', 'chain_province', '2026-10', 2792, 0.13, 349, 'o_44', 'pending', '固定链级差 省代 (0.35−0.3)×6980', '2792 × 13% = 349', '2026-10-28 08:51:14'),
  ('po-o_44-chain_hq', 'HQ', 'partner', 'product', 'chain_hq', '2026-10', 2792, 0.75, 2094, 'o_44', 'pending', '固定链级差 总部 (0.3−0)×6980', '2792 × 75% = 2094', '2026-10-28 08:51:14'),
  ('po-o_46-chain_province', 'HQ', 'partner', 'product', 'chain_province', '2026-10', 2443, 0.14, 349, 'o_46', 'pending', '固定链级差 省代 (0.35−0.3)×6980', '2443 × 14% = 349', '2026-10-28 08:51:14'),
  ('po-o_46-chain_hq', 'HQ', 'partner', 'product', 'chain_hq', '2026-10', 2443, 0.86, 2094, 'o_46', 'pending', '固定链级差 总部 (0.3−0)×6980', '2443 × 86% = 2094', '2026-10-28 08:51:14'),
  ('po-o_48-chain_store', 'HQ', 'partner', 'product', 'chain_store', '2026-10', 4537, 0.23, 1047, 'o_48', 'pending', '固定链级差 单店 (0.65−0.5)×6980', '4537 × 23% = 1047', '2026-10-28 08:51:14'),
  ('po-o_48-chain_district', 'HQ', 'partner', 'product', 'chain_district', '2026-10', 4537, 0.15, 698, 'o_48', 'pending', '固定链级差 区县代 (0.5−0.4)×6980', '4537 × 15% = 698', '2026-10-28 08:51:14'),
  ('po-o_48-chain_city', 'HQ', 'partner', 'product', 'chain_city', '2026-10', 4537, 0.08, 349, 'o_48', 'pending', '固定链级差 市代 (0.4−0.35)×6980', '4537 × 8% = 349', '2026-10-28 08:51:14'),
  ('po-o_48-chain_province', 'HQ', 'partner', 'product', 'chain_province', '2026-10', 4537, 0.08, 349, 'o_48', 'pending', '固定链级差 省代 (0.35−0.3)×6980', '4537 × 8% = 349', '2026-10-28 08:51:14'),
  ('po-o_48-chain_hq', 'HQ', 'partner', 'product', 'chain_hq', '2026-10', 4537, 0.46, 2094, 'o_48', 'pending', '固定链级差 总部 (0.3−0)×6980', '4537 × 46% = 2094', '2026-10-28 08:51:14'),
  ('po-o_50-chain_hq_direct', 'HQ', 'partner', 'product', 'chain_hq_direct', '2026-10', 2094, 1, 2094, 'o_50', 'pending', '总部直供（无上级代理）', '2094 × 100% = 2094', '2026-10-28 08:51:14'),
  ('po-o_52-chain_district', 'HQ', 'partner', 'product', 'chain_district', '2026-10', 3490, 0.2, 698, 'o_52', 'pending', '固定链级差 区县代 (0.5−0.4)×6980', '3490 × 20% = 698', '2026-10-28 08:51:14'),
  ('po-o_52-chain_city', 'HQ', 'partner', 'product', 'chain_city', '2026-10', 3490, 0.1, 349, 'o_52', 'pending', '固定链级差 市代 (0.4−0.35)×6980', '3490 × 10% = 349', '2026-10-28 08:51:14'),
  ('po-o_52-chain_province', 'HQ', 'partner', 'product', 'chain_province', '2026-10', 3490, 0.1, 349, 'o_52', 'pending', '固定链级差 省代 (0.35−0.3)×6980', '3490 × 10% = 349', '2026-10-28 08:51:14'),
  ('po-o_52-chain_hq', 'HQ', 'partner', 'product', 'chain_hq', '2026-10', 3490, 0.6, 2094, 'o_52', 'pending', '固定链级差 总部 (0.3−0)×6980', '3490 × 60% = 2094', '2026-10-28 08:51:14'),
  ('po-o_54-chain_store', 'HQ', 'partner', 'product', 'chain_store', '2026-10', 4886, 0.29, 1396, 'o_54', 'pending', '固定链级差 单店 (0.7−0.5)×6980', '4886 × 29% = 1396', '2026-10-28 08:51:14'),
  ('po-o_54-chain_district', 'HQ', 'partner', 'product', 'chain_district', '2026-10', 4886, 0.14, 698, 'o_54', 'pending', '固定链级差 区县代 (0.5−0.4)×6980', '4886 × 14% = 698', '2026-10-28 08:51:14'),
  ('po-o_54-chain_city', 'HQ', 'partner', 'product', 'chain_city', '2026-10', 4886, 0.07, 349, 'o_54', 'pending', '固定链级差 市代 (0.4−0.35)×6980', '4886 × 7% = 349', '2026-10-28 08:51:14'),
  ('po-o_54-chain_province', 'HQ', 'partner', 'product', 'chain_province', '2026-10', 4886, 0.07, 349, 'o_54', 'pending', '固定链级差 省代 (0.35−0.3)×6980', '4886 × 7% = 349', '2026-10-28 08:51:14'),
  ('po-o_54-chain_hq', 'HQ', 'partner', 'product', 'chain_hq', '2026-10', 4886, 0.43, 2094, 'o_54', 'pending', '固定链级差 总部 (0.3−0)×6980', '4886 × 43% = 2094', '2026-10-28 08:51:14'),
  ('po-o_56-chain_store', 'HQ', 'partner', 'product', 'chain_store', '2026-10', 5235, 0.33, 1745, 'o_56', 'pending', '固定链级差 单店 (0.75−0.5)×6980', '5235 × 33% = 1745', '2026-10-28 08:51:14'),
  ('po-o_56-chain_district', 'HQ', 'partner', 'product', 'chain_district', '2026-10', 5235, 0.13, 698, 'o_56', 'pending', '固定链级差 区县代 (0.5−0.4)×6980', '5235 × 13% = 698', '2026-10-28 08:51:14'),
  ('po-o_56-chain_city', 'HQ', 'partner', 'product', 'chain_city', '2026-10', 5235, 0.07, 349, 'o_56', 'pending', '固定链级差 市代 (0.4−0.35)×6980', '5235 × 7% = 349', '2026-10-28 08:51:14'),
  ('po-o_56-chain_province', 'HQ', 'partner', 'product', 'chain_province', '2026-10', 5235, 0.07, 349, 'o_56', 'pending', '固定链级差 省代 (0.35−0.3)×6980', '5235 × 7% = 349', '2026-10-28 08:51:14'),
  ('po-o_56-chain_hq', 'HQ', 'partner', 'product', 'chain_hq', '2026-10', 5235, 0.4, 2094, 'o_56', 'pending', '固定链级差 总部 (0.3−0)×6980', '5235 × 40% = 2094', '2026-10-28 08:51:14'),
  ('po-o_58-chain_store', 'HQ', 'partner', 'product', 'chain_store', '2026-10', 5584, 0.38, 2094, 'o_58', 'pending', '固定链级差 单店 (0.8−0.5)×6980', '5584 × 38% = 2094', '2026-10-28 08:51:14'),
  ('po-o_58-chain_district', 'HQ', 'partner', 'product', 'chain_district', '2026-10', 5584, 0.13, 698, 'o_58', 'pending', '固定链级差 区县代 (0.5−0.4)×6980', '5584 × 13% = 698', '2026-10-28 08:51:14'),
  ('po-o_58-chain_city', 'HQ', 'partner', 'product', 'chain_city', '2026-10', 5584, 0.06, 349, 'o_58', 'pending', '固定链级差 市代 (0.4−0.35)×6980', '5584 × 6% = 349', '2026-10-28 08:51:14'),
  ('po-o_58-chain_province', 'HQ', 'partner', 'product', 'chain_province', '2026-10', 5584, 0.06, 349, 'o_58', 'pending', '固定链级差 省代 (0.35−0.3)×6980', '5584 × 6% = 349', '2026-10-28 08:51:14'),
  ('po-o_58-chain_hq', 'HQ', 'partner', 'product', 'chain_hq', '2026-10', 5584, 0.38, 2094, 'o_58', 'pending', '固定链级差 总部 (0.3−0)×6980', '5584 × 38% = 2094', '2026-10-28 08:51:14'),
  ('po-o_60-chain_store', 'HQ', 'partner', 'product', 'chain_store', '2026-10', 6980, 0.5, 3490, 'o_60', 'pending', '固定链级差 单店 (1−0.5)×6980', '6980 × 50% = 3490', '2026-10-28 08:51:14'),
  ('po-o_60-chain_district', 'HQ', 'partner', 'product', 'chain_district', '2026-10', 6980, 0.1, 698, 'o_60', 'pending', '固定链级差 区县代 (0.5−0.4)×6980', '6980 × 10% = 698', '2026-10-28 08:51:14'),
  ('po-o_60-chain_city', 'HQ', 'partner', 'product', 'chain_city', '2026-10', 6980, 0.05, 349, 'o_60', 'pending', '固定链级差 市代 (0.4−0.35)×6980', '6980 × 5% = 349', '2026-10-28 08:51:14'),
  ('po-o_60-chain_province', 'HQ', 'partner', 'product', 'chain_province', '2026-10', 6980, 0.05, 349, 'o_60', 'pending', '固定链级差 省代 (0.35−0.3)×6980', '6980 × 5% = 349', '2026-10-28 08:51:14'),
  ('po-o_60-chain_hq', 'HQ', 'partner', 'product', 'chain_hq', '2026-10', 6980, 0.3, 2094, 'o_60', 'pending', '固定链级差 总部 (0.3−0)×6980', '6980 × 30% = 2094', '2026-10-28 08:51:14'),
  ('po-o_62-chain_store', 'HQ', 'partner', 'product', 'chain_store', '2026-10', 6980, 0.5, 3490, 'o_62', 'pending', '固定链级差 单店 (1−0.5)×6980', '6980 × 50% = 3490', '2026-10-28 08:51:14'),
  ('po-o_62-chain_district', 'HQ', 'partner', 'product', 'chain_district', '2026-10', 6980, 0.1, 698, 'o_62', 'pending', '固定链级差 区县代 (0.5−0.4)×6980', '6980 × 10% = 698', '2026-10-28 08:51:14'),
  ('po-o_62-chain_city', 'HQ', 'partner', 'product', 'chain_city', '2026-10', 6980, 0.05, 349, 'o_62', 'pending', '固定链级差 市代 (0.4−0.35)×6980', '6980 × 5% = 349', '2026-10-28 08:51:14'),
  ('po-o_62-chain_province', 'HQ', 'partner', 'product', 'chain_province', '2026-10', 6980, 0.05, 349, 'o_62', 'pending', '固定链级差 省代 (0.35−0.3)×6980', '6980 × 5% = 349', '2026-10-28 08:51:14'),
  ('po-o_62-chain_hq', 'HQ', 'partner', 'product', 'chain_hq', '2026-10', 6980, 0.3, 2094, 'o_62', 'pending', '固定链级差 总部 (0.3−0)×6980', '6980 × 30% = 2094', '2026-10-28 08:51:14'),
  ('po-o_64-chain_city', 'HQ', 'partner', 'product', 'chain_city', '2026-10', 2792, 0.13, 349, 'o_64', 'pending', '固定链级差 市代 (0.4−0.35)×6980', '2792 × 13% = 349', '2026-10-28 08:51:14'),
  ('po-o_64-chain_province', 'HQ', 'partner', 'product', 'chain_province', '2026-10', 2792, 0.13, 349, 'o_64', 'pending', '固定链级差 省代 (0.35−0.3)×6980', '2792 × 13% = 349', '2026-10-28 08:51:14'),
  ('po-o_64-chain_hq', 'HQ', 'partner', 'product', 'chain_hq', '2026-10', 2792, 0.75, 2094, 'o_64', 'pending', '固定链级差 总部 (0.3−0)×6980', '2792 × 75% = 2094', '2026-10-28 08:51:14'),
  ('po-o_66-chain_province', 'HQ', 'partner', 'product', 'chain_province', '2026-10', 2443, 0.14, 349, 'o_66', 'pending', '固定链级差 省代 (0.35−0.3)×6980', '2443 × 14% = 349', '2026-10-28 08:51:14'),
  ('po-o_66-chain_hq', 'HQ', 'partner', 'product', 'chain_hq', '2026-10', 2443, 0.86, 2094, 'o_66', 'pending', '固定链级差 总部 (0.3−0)×6980', '2443 × 86% = 2094', '2026-10-28 08:51:14'),
  ('po-o_68-featured_hq', 'HQ', 'partner', 'product', 'featured_hq', '2026-10', 1040, 0.14, 140.4, 'o_68', 'pending', '特色分成 总部', '1040 × 14% = 140.4', '2026-10-28 08:51:14'),
  ('po-o_68-featured_province', 'seed_province', 'partner', 'product', 'featured_province', '2026-10', 1040, 0.02, 18.72, 'o_68', 'pending', '特色分成 省代', '1040 × 2% = 18.72', '2026-10-28 08:51:14'),
  ('po-o_68-featured_city', 'seed_city', 'partner', 'product', 'featured_city', '2026-10', 1040, 0.07, 74.88, 'o_68', 'pending', '特色分成 市代', '1040 × 7% = 74.88', '2026-10-28 08:51:14'),
  ('po-o_68-featured_district_mgmt', 'seed_district', 'partner', 'product', 'featured_district_mgmt', '2026-10', 1040, 0.05, 46.8, 'o_68', 'pending', '特色分成 区县代(管理)', '1040 × 5% = 46.8', '2026-10-28 08:51:14'),
  ('po-o_68-featured_district_inspect', 'seed_district', 'partner', 'product', 'featured_district_inspect', '2026-10', 1040, 0.05, 46.8, 'o_68', 'pending_allocation', '特色分成 区县代(巡查)→待区县负责人分配（待区县负责人分配）', '1040 × 5% = 46.8', '2026-10-28 08:51:14'),
  ('po-o_68-featured_store_delivery', 'seed_store', 'partner', 'product', 'featured_store_delivery', '2026-10', 1040, 0.27, 280.8, 'o_68', 'pending', '特色分成 单店(交付)', '1040 × 27% = 280.8', '2026-10-28 08:51:14'),
  ('po-o_68-featured_store_traffic', 'seed_store', 'partner', 'product', 'featured_store_traffic', '2026-10', 1040, 0.27, 280.8, 'o_68', 'pending', '特色分成 单店(流量)', '1040 × 27% = 280.8', '2026-10-28 08:51:14'),
  ('po-o_68-featured_store_sales', 'seed_store', 'partner', 'product', 'featured_store_sales', '2026-10', 1040, 0.05, 46.8, 'o_68', 'pending', '特色分成 店长/单店负责人（固定）', '1040 × 5% = 46.8', '2026-10-28 08:51:14'),
  ('po-o_68-partner_product', 'p3', 'partner', 'product', 'partner_product', '2026-10', 1040, 0.1, 104, 'o_68', 'pending', '产品提成 | 实付 1040 × 10%（angel 产品提成） = 104', '1040 × 10% = 104', '2026-10-28 08:51:14'),
  ('po-o_70-featured_hq', 'HQ', 'partner', 'product', 'featured_hq', '2026-10', 1040, 0.14, 140.4, 'o_70', 'pending', '特色分成 总部', '1040 × 14% = 140.4', '2026-10-28 08:51:14'),
  ('po-o_70-featured_province', 'seed_province', 'partner', 'product', 'featured_province', '2026-10', 1040, 0.02, 18.72, 'o_70', 'pending', '特色分成 省代', '1040 × 2% = 18.72', '2026-10-28 08:51:14'),
  ('po-o_70-featured_city', 'seed_city', 'partner', 'product', 'featured_city', '2026-10', 1040, 0.07, 74.88, 'o_70', 'pending', '特色分成 市代', '1040 × 7% = 74.88', '2026-10-28 08:51:14'),
  ('po-o_70-featured_district_mgmt', 'seed_district', 'partner', 'product', 'featured_district_mgmt', '2026-10', 1040, 0.05, 46.8, 'o_70', 'pending', '特色分成 区县代(管理)', '1040 × 5% = 46.8', '2026-10-28 08:51:14'),
  ('po-o_70-featured_district_inspect', 'seed_district', 'partner', 'product', 'featured_district_inspect', '2026-10', 1040, 0.05, 46.8, 'o_70', 'pending_allocation', '特色分成 区县代(巡查)→待区县负责人分配（待区县负责人分配）', '1040 × 5% = 46.8', '2026-10-28 08:51:14'),
  ('po-o_70-featured_store_delivery', 'p6', 'partner', 'product', 'featured_store_delivery', '2026-10', 1040, 0.27, 280.8, 'o_70', 'pending', '特色分成 单店(交付)', '1040 × 27% = 280.8', '2026-10-28 08:51:14'),
  ('po-o_70-featured_store_traffic', 'p6', 'partner', 'product', 'featured_store_traffic', '2026-10', 1040, 0.27, 280.8, 'o_70', 'pending', '特色分成 单店(流量)', '1040 × 27% = 280.8', '2026-10-28 08:51:14'),
  ('po-o_70-featured_store_sales', 'p6', 'partner', 'product', 'featured_store_sales', '2026-10', 1040, 0.05, 46.8, 'o_70', 'pending', '特色分成 店长/单店负责人（固定）', '1040 × 5% = 46.8', '2026-10-28 08:51:14'),
  ('po-o_70-partner_product', 'p3', 'partner', 'product', 'partner_product', '2026-10', 1040, 0.1, 104, 'o_70', 'pending', '产品提成 | 实付 1040 × 10%（angel 产品提成） = 104', '1040 × 10% = 104', '2026-10-28 08:51:14'),
  ('po-o_76-chain_store', 'HQ', 'partner', 'product', 'chain_store', '2026-10', 5584, 0.38, 2094, 'o_76', 'pending', '固定链级差 单店 (0.8−0.5)×6980', '5584 × 38% = 2094', '2026-10-28 08:51:14'),
  ('po-o_76-chain_district', 'HQ', 'partner', 'product', 'chain_district', '2026-10', 5584, 0.13, 698, 'o_76', 'pending', '固定链级差 区县代 (0.5−0.4)×6980', '5584 × 13% = 698', '2026-10-28 08:51:14'),
  ('po-o_76-chain_city', 'HQ', 'partner', 'product', 'chain_city', '2026-10', 5584, 0.06, 349, 'o_76', 'pending', '固定链级差 市代 (0.4−0.35)×6980', '5584 × 6% = 349', '2026-10-28 08:51:14'),
  ('po-o_76-chain_province', 'HQ', 'partner', 'product', 'chain_province', '2026-10', 5584, 0.06, 349, 'o_76', 'pending', '固定链级差 省代 (0.35−0.3)×6980', '5584 × 6% = 349', '2026-10-28 08:51:14'),
  ('po-o_76-chain_hq', 'HQ', 'partner', 'product', 'chain_hq', '2026-10', 5584, 0.38, 2094, 'o_76', 'pending', '固定链级差 总部 (0.3−0)×6980', '5584 × 38% = 2094', '2026-10-28 08:51:14'),
  ('po-o_78-chain_store', 'HQ', 'partner', 'product', 'chain_store', '2026-10', 4537, 0.23, 1047, 'o_78', 'pending', '固定链级差 单店 (0.65−0.5)×6980', '4537 × 23% = 1047', '2026-10-28 08:51:14'),
  ('po-o_78-chain_district', 'HQ', 'partner', 'product', 'chain_district', '2026-10', 4537, 0.15, 698, 'o_78', 'pending', '固定链级差 区县代 (0.5−0.4)×6980', '4537 × 15% = 698', '2026-10-28 08:51:14'),
  ('po-o_78-chain_city', 'HQ', 'partner', 'product', 'chain_city', '2026-10', 4537, 0.08, 349, 'o_78', 'pending', '固定链级差 市代 (0.4−0.35)×6980', '4537 × 8% = 349', '2026-10-28 08:51:14'),
  ('po-o_78-chain_province', 'HQ', 'partner', 'product', 'chain_province', '2026-10', 4537, 0.08, 349, 'o_78', 'pending', '固定链级差 省代 (0.35−0.3)×6980', '4537 × 8% = 349', '2026-10-28 08:51:14'),
  ('po-o_78-chain_hq', 'HQ', 'partner', 'product', 'chain_hq', '2026-10', 4537, 0.46, 2094, 'o_78', 'pending', '固定链级差 总部 (0.3−0)×6980', '4537 × 46% = 2094', '2026-10-28 08:51:14'),
  ('po-o_80-chain_hq_direct', 'HQ', 'partner', 'product', 'chain_hq_direct', '2026-10', 2094, 1, 2094, 'o_80', 'pending', '总部直供（无上级代理）', '2094 × 100% = 2094', '2026-10-28 08:51:14'),
  ('po-o_82-chain_district', 'HQ', 'partner', 'product', 'chain_district', '2026-10', 3490, 0.2, 698, 'o_82', 'pending', '固定链级差 区县代 (0.5−0.4)×6980', '3490 × 20% = 698', '2026-10-28 08:51:14'),
  ('po-o_82-chain_city', 'HQ', 'partner', 'product', 'chain_city', '2026-10', 3490, 0.1, 349, 'o_82', 'pending', '固定链级差 市代 (0.4−0.35)×6980', '3490 × 10% = 349', '2026-10-28 08:51:14'),
  ('po-o_82-chain_province', 'HQ', 'partner', 'product', 'chain_province', '2026-10', 3490, 0.1, 349, 'o_82', 'pending', '固定链级差 省代 (0.35−0.3)×6980', '3490 × 10% = 349', '2026-10-28 08:51:14'),
  ('po-o_82-chain_hq', 'HQ', 'partner', 'product', 'chain_hq', '2026-10', 3490, 0.6, 2094, 'o_82', 'pending', '固定链级差 总部 (0.3−0)×6980', '3490 × 60% = 2094', '2026-10-28 08:51:14'),
  ('po-o_84-chain_store', 'HQ', 'partner', 'product', 'chain_store', '2026-10', 4886, 0.29, 1396, 'o_84', 'pending', '固定链级差 单店 (0.7−0.5)×6980', '4886 × 29% = 1396', '2026-10-28 08:51:14'),
  ('po-o_84-chain_district', 'HQ', 'partner', 'product', 'chain_district', '2026-10', 4886, 0.14, 698, 'o_84', 'pending', '固定链级差 区县代 (0.5−0.4)×6980', '4886 × 14% = 698', '2026-10-28 08:51:14'),
  ('po-o_84-chain_city', 'HQ', 'partner', 'product', 'chain_city', '2026-10', 4886, 0.07, 349, 'o_84', 'pending', '固定链级差 市代 (0.4−0.35)×6980', '4886 × 7% = 349', '2026-10-28 08:51:14'),
  ('po-o_84-chain_province', 'HQ', 'partner', 'product', 'chain_province', '2026-10', 4886, 0.07, 349, 'o_84', 'pending', '固定链级差 省代 (0.35−0.3)×6980', '4886 × 7% = 349', '2026-10-28 08:51:14'),
  ('po-o_84-chain_hq', 'HQ', 'partner', 'product', 'chain_hq', '2026-10', 4886, 0.43, 2094, 'o_84', 'pending', '固定链级差 总部 (0.3−0)×6980', '4886 × 43% = 2094', '2026-10-28 08:51:14'),
  ('po-o_86-chain_store', 'HQ', 'partner', 'product', 'chain_store', '2026-10', 5235, 0.33, 1745, 'o_86', 'pending', '固定链级差 单店 (0.75−0.5)×6980', '5235 × 33% = 1745', '2026-10-28 08:51:14'),
  ('po-o_86-chain_district', 'HQ', 'partner', 'product', 'chain_district', '2026-10', 5235, 0.13, 698, 'o_86', 'pending', '固定链级差 区县代 (0.5−0.4)×6980', '5235 × 13% = 698', '2026-10-28 08:51:14'),
  ('po-o_86-chain_city', 'HQ', 'partner', 'product', 'chain_city', '2026-10', 5235, 0.07, 349, 'o_86', 'pending', '固定链级差 市代 (0.4−0.35)×6980', '5235 × 7% = 349', '2026-10-28 08:51:14'),
  ('po-o_86-chain_province', 'HQ', 'partner', 'product', 'chain_province', '2026-10', 5235, 0.07, 349, 'o_86', 'pending', '固定链级差 省代 (0.35−0.3)×6980', '5235 × 7% = 349', '2026-10-28 08:51:14'),
  ('po-o_86-chain_hq', 'HQ', 'partner', 'product', 'chain_hq', '2026-10', 5235, 0.4, 2094, 'o_86', 'pending', '固定链级差 总部 (0.3−0)×6980', '5235 × 40% = 2094', '2026-10-28 08:51:14'),
  ('po-o_88-chain_store', 'HQ', 'partner', 'product', 'chain_store', '2026-10', 5584, 0.38, 2094, 'o_88', 'pending', '固定链级差 单店 (0.8−0.5)×6980', '5584 × 38% = 2094', '2026-10-28 08:51:14'),
  ('po-o_88-chain_district', 'HQ', 'partner', 'product', 'chain_district', '2026-10', 5584, 0.13, 698, 'o_88', 'pending', '固定链级差 区县代 (0.5−0.4)×6980', '5584 × 13% = 698', '2026-10-28 08:51:14'),
  ('po-o_88-chain_city', 'HQ', 'partner', 'product', 'chain_city', '2026-10', 5584, 0.06, 349, 'o_88', 'pending', '固定链级差 市代 (0.4−0.35)×6980', '5584 × 6% = 349', '2026-10-28 08:51:14'),
  ('po-o_88-chain_province', 'HQ', 'partner', 'product', 'chain_province', '2026-10', 5584, 0.06, 349, 'o_88', 'pending', '固定链级差 省代 (0.35−0.3)×6980', '5584 × 6% = 349', '2026-10-28 08:51:14'),
  ('po-o_88-chain_hq', 'HQ', 'partner', 'product', 'chain_hq', '2026-10', 5584, 0.38, 2094, 'o_88', 'pending', '固定链级差 总部 (0.3−0)×6980', '5584 × 38% = 2094', '2026-10-28 08:51:14'),
  ('po-o_90-chain_store', 'HQ', 'partner', 'product', 'chain_store', '2026-10', 6980, 0.5, 3490, 'o_90', 'pending', '固定链级差 单店 (1−0.5)×6980', '6980 × 50% = 3490', '2026-10-28 08:51:14'),
  ('po-o_90-chain_district', 'HQ', 'partner', 'product', 'chain_district', '2026-10', 6980, 0.1, 698, 'o_90', 'pending', '固定链级差 区县代 (0.5−0.4)×6980', '6980 × 10% = 698', '2026-10-28 08:51:14'),
  ('po-o_90-chain_city', 'HQ', 'partner', 'product', 'chain_city', '2026-10', 6980, 0.05, 349, 'o_90', 'pending', '固定链级差 市代 (0.4−0.35)×6980', '6980 × 5% = 349', '2026-10-28 08:51:14'),
  ('po-o_90-chain_province', 'HQ', 'partner', 'product', 'chain_province', '2026-10', 6980, 0.05, 349, 'o_90', 'pending', '固定链级差 省代 (0.35−0.3)×6980', '6980 × 5% = 349', '2026-10-28 08:51:14'),
  ('po-o_90-chain_hq', 'HQ', 'partner', 'product', 'chain_hq', '2026-10', 6980, 0.3, 2094, 'o_90', 'pending', '固定链级差 总部 (0.3−0)×6980', '6980 × 30% = 2094', '2026-10-28 08:51:14'),
  ('po-o_92-chain_store', 'HQ', 'partner', 'product', 'chain_store', '2026-10', 6980, 0.5, 3490, 'o_92', 'pending', '固定链级差 单店 (1−0.5)×6980', '6980 × 50% = 3490', '2026-10-28 08:51:14'),
  ('po-o_92-chain_district', 'HQ', 'partner', 'product', 'chain_district', '2026-10', 6980, 0.1, 698, 'o_92', 'pending', '固定链级差 区县代 (0.5−0.4)×6980', '6980 × 10% = 698', '2026-10-28 08:51:14'),
  ('po-o_92-chain_city', 'HQ', 'partner', 'product', 'chain_city', '2026-10', 6980, 0.05, 349, 'o_92', 'pending', '固定链级差 市代 (0.4−0.35)×6980', '6980 × 5% = 349', '2026-10-28 08:51:14'),
  ('po-o_92-chain_province', 'HQ', 'partner', 'product', 'chain_province', '2026-10', 6980, 0.05, 349, 'o_92', 'pending', '固定链级差 省代 (0.35−0.3)×6980', '6980 × 5% = 349', '2026-10-28 08:51:14'),
  ('po-o_92-chain_hq', 'HQ', 'partner', 'product', 'chain_hq', '2026-10', 6980, 0.3, 2094, 'o_92', 'pending', '固定链级差 总部 (0.3−0)×6980', '6980 × 30% = 2094', '2026-10-28 08:51:14'),
  ('po-o_94-chain_city', 'HQ', 'partner', 'product', 'chain_city', '2026-10', 2792, 0.13, 349, 'o_94', 'pending', '固定链级差 市代 (0.4−0.35)×6980', '2792 × 13% = 349', '2026-10-28 08:51:14'),
  ('po-o_94-chain_province', 'HQ', 'partner', 'product', 'chain_province', '2026-10', 2792, 0.13, 349, 'o_94', 'pending', '固定链级差 省代 (0.35−0.3)×6980', '2792 × 13% = 349', '2026-10-28 08:51:14'),
  ('po-o_94-chain_hq', 'HQ', 'partner', 'product', 'chain_hq', '2026-10', 2792, 0.75, 2094, 'o_94', 'pending', '固定链级差 总部 (0.3−0)×6980', '2792 × 75% = 2094', '2026-10-28 08:51:14'),
  ('po-o_96-chain_province', 'HQ', 'partner', 'product', 'chain_province', '2026-10', 2443, 0.14, 349, 'o_96', 'pending', '固定链级差 省代 (0.35−0.3)×6980', '2443 × 14% = 349', '2026-10-28 08:51:14'),
  ('po-o_96-chain_hq', 'HQ', 'partner', 'product', 'chain_hq', '2026-10', 2443, 0.86, 2094, 'o_96', 'pending', '固定链级差 总部 (0.3−0)×6980', '2443 × 86% = 2094', '2026-10-28 08:51:14'),
  ('po-o_98-featured_hq', 'HQ', 'partner', 'product', 'featured_hq', '2026-10', 1040, 0.14, 140.4, 'o_98', 'pending', '特色分成 总部', '1040 × 14% = 140.4', '2026-10-28 08:51:14'),
  ('po-o_98-featured_province', 'seed_province', 'partner', 'product', 'featured_province', '2026-10', 1040, 0.02, 18.72, 'o_98', 'pending', '特色分成 省代', '1040 × 2% = 18.72', '2026-10-28 08:51:14'),
  ('po-o_98-featured_city', 'seed_city', 'partner', 'product', 'featured_city', '2026-10', 1040, 0.07, 74.88, 'o_98', 'pending', '特色分成 市代', '1040 × 7% = 74.88', '2026-10-28 08:51:14'),
  ('po-o_98-featured_district_mgmt', 'seed_district', 'partner', 'product', 'featured_district_mgmt', '2026-10', 1040, 0.05, 46.8, 'o_98', 'pending', '特色分成 区县代(管理)', '1040 × 5% = 46.8', '2026-10-28 08:51:14'),
  ('po-o_98-featured_district_inspect', 'seed_district', 'partner', 'product', 'featured_district_inspect', '2026-10', 1040, 0.05, 46.8, 'o_98', 'pending_allocation', '特色分成 区县代(巡查)→待区县负责人分配（待区县负责人分配）', '1040 × 5% = 46.8', '2026-10-28 08:51:14'),
  ('po-o_98-featured_store_delivery', 'seed_store', 'partner', 'product', 'featured_store_delivery', '2026-10', 1040, 0.27, 280.8, 'o_98', 'pending', '特色分成 单店(交付)', '1040 × 27% = 280.8', '2026-10-28 08:51:14'),
  ('po-o_98-featured_store_traffic', 'seed_store', 'partner', 'product', 'featured_store_traffic', '2026-10', 1040, 0.27, 280.8, 'o_98', 'pending', '特色分成 单店(流量)', '1040 × 27% = 280.8', '2026-10-28 08:51:14'),
  ('po-o_98-featured_store_sales', 'seed_store', 'partner', 'product', 'featured_store_sales', '2026-10', 1040, 0.05, 46.8, 'o_98', 'pending', '特色分成 店长/单店负责人（固定）', '1040 × 5% = 46.8', '2026-10-28 08:51:14'),
  ('po-o_98-partner_product', 'p3', 'partner', 'product', 'partner_product', '2026-10', 1040, 0.1, 104, 'o_98', 'pending', '产品提成 | 实付 1040 × 10%（angel 产品提成） = 104', '1040 × 10% = 104', '2026-10-28 08:51:14'),
  ('po-o_103-featured_hq', 'HQ', 'partner', 'product', 'featured_hq', '2026-10', 1040, 0.14, 140.4, 'o_103', 'pending', '特色分成 总部', '1040 × 14% = 140.4', '2026-10-28 08:51:14'),
  ('po-o_103-featured_province', 'seed_province', 'partner', 'product', 'featured_province', '2026-10', 1040, 0.02, 18.72, 'o_103', 'pending', '特色分成 省代', '1040 × 2% = 18.72', '2026-10-28 08:51:14'),
  ('po-o_103-featured_city', 'seed_city', 'partner', 'product', 'featured_city', '2026-10', 1040, 0.07, 74.88, 'o_103', 'pending', '特色分成 市代', '1040 × 7% = 74.88', '2026-10-28 08:51:14'),
  ('po-o_103-featured_district_mgmt', 'seed_district', 'partner', 'product', 'featured_district_mgmt', '2026-10', 1040, 0.05, 46.8, 'o_103', 'pending', '特色分成 区县代(管理)', '1040 × 5% = 46.8', '2026-10-28 08:51:14'),
  ('po-o_103-featured_district_inspect', 'seed_district', 'partner', 'product', 'featured_district_inspect', '2026-10', 1040, 0.05, 46.8, 'o_103', 'pending_allocation', '特色分成 区县代(巡查)→待区县负责人分配（待区县负责人分配）', '1040 × 5% = 46.8', '2026-10-28 08:51:14'),
  ('po-o_103-featured_store_delivery', 'seed_store', 'partner', 'product', 'featured_store_delivery', '2026-10', 1040, 0.27, 280.8, 'o_103', 'pending', '特色分成 单店(交付)', '1040 × 27% = 280.8', '2026-10-28 08:51:14'),
  ('po-o_103-featured_store_traffic', 'seed_store', 'partner', 'product', 'featured_store_traffic', '2026-10', 1040, 0.27, 280.8, 'o_103', 'pending', '特色分成 单店(流量)', '1040 × 27% = 280.8', '2026-10-28 08:51:14'),
  ('po-o_103-featured_store_sales', 'seed_store', 'partner', 'product', 'featured_store_sales', '2026-10', 1040, 0.05, 46.8, 'o_103', 'pending', '特色分成 店长/单店负责人（固定）', '1040 × 5% = 46.8', '2026-10-28 08:51:14'),
  ('po-o_103-partner_product', 'p3', 'partner', 'product', 'partner_product', '2026-10', 1040, 0.1, 104, 'o_103', 'pending', '产品提成 | 实付 1040 × 10%（angel 产品提成） = 104', '1040 × 10% = 104', '2026-10-28 08:51:14'),
  ('po-o_107-featured_hq', 'HQ', 'partner', 'product', 'featured_hq', '2026-10', 1040, 0.14, 140.4, 'o_107', 'pending', '特色分成 总部', '1040 × 14% = 140.4', '2026-10-28 08:51:14'),
  ('po-o_107-featured_province', 'seed_province', 'partner', 'product', 'featured_province', '2026-10', 1040, 0.02, 18.72, 'o_107', 'pending', '特色分成 省代', '1040 × 2% = 18.72', '2026-10-28 08:51:14'),
  ('po-o_107-featured_city', 'seed_city', 'partner', 'product', 'featured_city', '2026-10', 1040, 0.07, 74.88, 'o_107', 'pending', '特色分成 市代', '1040 × 7% = 74.88', '2026-10-28 08:51:14'),
  ('po-o_107-featured_district_mgmt', 'seed_district', 'partner', 'product', 'featured_district_mgmt', '2026-10', 1040, 0.05, 46.8, 'o_107', 'pending', '特色分成 区县代(管理)', '1040 × 5% = 46.8', '2026-10-28 08:51:14'),
  ('po-o_107-featured_district_inspect', 'seed_district', 'partner', 'product', 'featured_district_inspect', '2026-10', 1040, 0.05, 46.8, 'o_107', 'pending_allocation', '特色分成 区县代(巡查)→待区县负责人分配（待区县负责人分配）', '1040 × 5% = 46.8', '2026-10-28 08:51:14'),
  ('po-o_107-featured_store_delivery', 'seed_store', 'partner', 'product', 'featured_store_delivery', '2026-10', 1040, 0.27, 280.8, 'o_107', 'pending', '特色分成 单店(交付)', '1040 × 27% = 280.8', '2026-10-28 08:51:14'),
  ('po-o_107-featured_store_traffic', 'seed_store', 'partner', 'product', 'featured_store_traffic', '2026-10', 1040, 0.27, 280.8, 'o_107', 'pending', '特色分成 单店(流量)', '1040 × 27% = 280.8', '2026-10-28 08:51:14'),
  ('po-o_107-featured_store_sales', 'seed_store', 'partner', 'product', 'featured_store_sales', '2026-10', 1040, 0.05, 46.8, 'o_107', 'pending', '特色分成 店长/单店负责人（固定）', '1040 × 5% = 46.8', '2026-10-28 08:51:14'),
  ('po-o_107-partner_product', 'p3', 'partner', 'product', 'partner_product', '2026-10', 1040, 0.1, 104, 'o_107', 'pending', '产品提成 | 实付 1040 × 10%（angel 产品提成） = 104', '1040 × 10% = 104', '2026-10-28 08:51:14'),
  ('po-o_111-featured_hq', 'HQ', 'partner', 'product', 'featured_hq', '2026-10', 1040, 0.14, 140.4, 'o_111', 'pending', '特色分成 总部', '1040 × 14% = 140.4', '2026-10-28 08:51:14'),
  ('po-o_111-featured_province', 'seed_province', 'partner', 'product', 'featured_province', '2026-10', 1040, 0.02, 18.72, 'o_111', 'pending', '特色分成 省代', '1040 × 2% = 18.72', '2026-10-28 08:51:14'),
  ('po-o_111-featured_city', 'seed_city', 'partner', 'product', 'featured_city', '2026-10', 1040, 0.07, 74.88, 'o_111', 'pending', '特色分成 市代', '1040 × 7% = 74.88', '2026-10-28 08:51:14'),
  ('po-o_111-featured_district_mgmt', 'seed_district', 'partner', 'product', 'featured_district_mgmt', '2026-10', 1040, 0.05, 46.8, 'o_111', 'pending', '特色分成 区县代(管理)', '1040 × 5% = 46.8', '2026-10-28 08:51:14'),
  ('po-o_111-featured_district_inspect', 'seed_district', 'partner', 'product', 'featured_district_inspect', '2026-10', 1040, 0.05, 46.8, 'o_111', 'pending_allocation', '特色分成 区县代(巡查)→待区县负责人分配（待区县负责人分配）', '1040 × 5% = 46.8', '2026-10-28 08:51:14'),
  ('po-o_111-featured_store_delivery', 'seed_store', 'partner', 'product', 'featured_store_delivery', '2026-10', 1040, 0.27, 280.8, 'o_111', 'pending', '特色分成 单店(交付)', '1040 × 27% = 280.8', '2026-10-28 08:51:14'),
  ('po-o_111-featured_store_traffic', 'seed_store', 'partner', 'product', 'featured_store_traffic', '2026-10', 1040, 0.27, 280.8, 'o_111', 'pending', '特色分成 单店(流量)', '1040 × 27% = 280.8', '2026-10-28 08:51:14'),
  ('po-o_111-featured_store_sales', 'seed_store', 'partner', 'product', 'featured_store_sales', '2026-10', 1040, 0.05, 46.8, 'o_111', 'pending', '特色分成 店长/单店负责人（固定）', '1040 × 5% = 46.8', '2026-10-28 08:51:14'),
  ('po-o_111-partner_product', 'p3', 'partner', 'product', 'partner_product', '2026-10', 1040, 0.1, 104, 'o_111', 'pending', '产品提成 | 实付 1040 × 10%（angel 产品提成） = 104', '1040 × 10% = 104', '2026-10-28 08:51:14'),
  ('po-o_119-chain_store', 'HQ', 'partner', 'product', 'chain_store', '2026-10', 4537, 0.23, 1047, 'o_119', 'pending', '固定链级差 单店 (0.65−0.5)×6980', '4537 × 23% = 1047', '2026-10-28 08:51:14'),
  ('po-o_119-chain_district', 'HQ', 'partner', 'product', 'chain_district', '2026-10', 4537, 0.15, 698, 'o_119', 'pending', '固定链级差 区县代 (0.5−0.4)×6980', '4537 × 15% = 698', '2026-10-28 08:51:14'),
  ('po-o_119-chain_city', 'HQ', 'partner', 'product', 'chain_city', '2026-10', 4537, 0.08, 349, 'o_119', 'pending', '固定链级差 市代 (0.4−0.35)×6980', '4537 × 8% = 349', '2026-10-28 08:51:14'),
  ('po-o_119-chain_province', 'HQ', 'partner', 'product', 'chain_province', '2026-10', 4537, 0.08, 349, 'o_119', 'pending', '固定链级差 省代 (0.35−0.3)×6980', '4537 × 8% = 349', '2026-10-28 08:51:14'),
  ('po-o_119-chain_hq', 'HQ', 'partner', 'product', 'chain_hq', '2026-10', 4537, 0.46, 2094, 'o_119', 'pending', '固定链级差 总部 (0.3−0)×6980', '4537 × 46% = 2094', '2026-10-28 08:51:14'),
  ('po-o_121-chain_hq_direct', 'HQ', 'partner', 'product', 'chain_hq_direct', '2026-10', 2094, 1, 2094, 'o_121', 'pending', '总部直供（无上级代理）', '2094 × 100% = 2094', '2026-10-28 08:51:14'),
  ('po-o_123-chain_district', 'HQ', 'partner', 'product', 'chain_district', '2026-10', 3490, 0.2, 698, 'o_123', 'pending', '固定链级差 区县代 (0.5−0.4)×6980', '3490 × 20% = 698', '2026-10-28 08:51:14'),
  ('po-o_123-chain_city', 'HQ', 'partner', 'product', 'chain_city', '2026-10', 3490, 0.1, 349, 'o_123', 'pending', '固定链级差 市代 (0.4−0.35)×6980', '3490 × 10% = 349', '2026-10-28 08:51:14'),
  ('po-o_123-chain_province', 'HQ', 'partner', 'product', 'chain_province', '2026-10', 3490, 0.1, 349, 'o_123', 'pending', '固定链级差 省代 (0.35−0.3)×6980', '3490 × 10% = 349', '2026-10-28 08:51:15'),
  ('po-o_123-chain_hq', 'HQ', 'partner', 'product', 'chain_hq', '2026-10', 3490, 0.6, 2094, 'o_123', 'pending', '固定链级差 总部 (0.3−0)×6980', '3490 × 60% = 2094', '2026-10-28 08:51:15'),
  ('po-o_125-chain_store', 'HQ', 'partner', 'product', 'chain_store', '2026-10', 4886, 0.29, 1396, 'o_125', 'pending', '固定链级差 单店 (0.7−0.5)×6980', '4886 × 29% = 1396', '2026-10-28 08:51:15'),
  ('po-o_125-chain_district', 'HQ', 'partner', 'product', 'chain_district', '2026-10', 4886, 0.14, 698, 'o_125', 'pending', '固定链级差 区县代 (0.5−0.4)×6980', '4886 × 14% = 698', '2026-10-28 08:51:15'),
  ('po-o_125-chain_city', 'HQ', 'partner', 'product', 'chain_city', '2026-10', 4886, 0.07, 349, 'o_125', 'pending', '固定链级差 市代 (0.4−0.35)×6980', '4886 × 7% = 349', '2026-10-28 08:51:15'),
  ('po-o_125-chain_province', 'HQ', 'partner', 'product', 'chain_province', '2026-10', 4886, 0.07, 349, 'o_125', 'pending', '固定链级差 省代 (0.35−0.3)×6980', '4886 × 7% = 349', '2026-10-28 08:51:15'),
  ('po-o_125-chain_hq', 'HQ', 'partner', 'product', 'chain_hq', '2026-10', 4886, 0.43, 2094, 'o_125', 'pending', '固定链级差 总部 (0.3−0)×6980', '4886 × 43% = 2094', '2026-10-28 08:51:15'),
  ('po-o_127-chain_store', 'HQ', 'partner', 'product', 'chain_store', '2026-10', 5235, 0.33, 1745, 'o_127', 'pending', '固定链级差 单店 (0.75−0.5)×6980', '5235 × 33% = 1745', '2026-10-28 08:51:15'),
  ('po-o_127-chain_district', 'HQ', 'partner', 'product', 'chain_district', '2026-10', 5235, 0.13, 698, 'o_127', 'pending', '固定链级差 区县代 (0.5−0.4)×6980', '5235 × 13% = 698', '2026-10-28 08:51:15'),
  ('po-o_127-chain_city', 'HQ', 'partner', 'product', 'chain_city', '2026-10', 5235, 0.07, 349, 'o_127', 'pending', '固定链级差 市代 (0.4−0.35)×6980', '5235 × 7% = 349', '2026-10-28 08:51:15'),
  ('po-o_127-chain_province', 'HQ', 'partner', 'product', 'chain_province', '2026-10', 5235, 0.07, 349, 'o_127', 'pending', '固定链级差 省代 (0.35−0.3)×6980', '5235 × 7% = 349', '2026-10-28 08:51:15'),
  ('po-o_127-chain_hq', 'HQ', 'partner', 'product', 'chain_hq', '2026-10', 5235, 0.4, 2094, 'o_127', 'pending', '固定链级差 总部 (0.3−0)×6980', '5235 × 40% = 2094', '2026-10-28 08:51:15'),
  ('po-o_129-chain_store', 'HQ', 'partner', 'product', 'chain_store', '2026-10', 5584, 0.38, 2094, 'o_129', 'pending', '固定链级差 单店 (0.8−0.5)×6980', '5584 × 38% = 2094', '2026-10-28 08:51:15'),
  ('po-o_129-chain_district', 'HQ', 'partner', 'product', 'chain_district', '2026-10', 5584, 0.13, 698, 'o_129', 'pending', '固定链级差 区县代 (0.5−0.4)×6980', '5584 × 13% = 698', '2026-10-28 08:51:15'),
  ('po-o_129-chain_city', 'HQ', 'partner', 'product', 'chain_city', '2026-10', 5584, 0.06, 349, 'o_129', 'pending', '固定链级差 市代 (0.4−0.35)×6980', '5584 × 6% = 349', '2026-10-28 08:51:15'),
  ('po-o_129-chain_province', 'HQ', 'partner', 'product', 'chain_province', '2026-10', 5584, 0.06, 349, 'o_129', 'pending', '固定链级差 省代 (0.35−0.3)×6980', '5584 × 6% = 349', '2026-10-28 08:51:15'),
  ('po-o_129-chain_hq', 'HQ', 'partner', 'product', 'chain_hq', '2026-10', 5584, 0.38, 2094, 'o_129', 'pending', '固定链级差 总部 (0.3−0)×6980', '5584 × 38% = 2094', '2026-10-28 08:51:15'),
  ('po-o_131-chain_store', 'HQ', 'partner', 'product', 'chain_store', '2026-10', 6980, 0.5, 3490, 'o_131', 'pending', '固定链级差 单店 (1−0.5)×6980', '6980 × 50% = 3490', '2026-10-28 08:51:15'),
  ('po-o_131-chain_district', 'HQ', 'partner', 'product', 'chain_district', '2026-10', 6980, 0.1, 698, 'o_131', 'pending', '固定链级差 区县代 (0.5−0.4)×6980', '6980 × 10% = 698', '2026-10-28 08:51:15'),
  ('po-o_131-chain_city', 'HQ', 'partner', 'product', 'chain_city', '2026-10', 6980, 0.05, 349, 'o_131', 'pending', '固定链级差 市代 (0.4−0.35)×6980', '6980 × 5% = 349', '2026-10-28 08:51:15'),
  ('po-o_131-chain_province', 'HQ', 'partner', 'product', 'chain_province', '2026-10', 6980, 0.05, 349, 'o_131', 'pending', '固定链级差 省代 (0.35−0.3)×6980', '6980 × 5% = 349', '2026-10-28 08:51:15'),
  ('po-o_131-chain_hq', 'HQ', 'partner', 'product', 'chain_hq', '2026-10', 6980, 0.3, 2094, 'o_131', 'pending', '固定链级差 总部 (0.3−0)×6980', '6980 × 30% = 2094', '2026-10-28 08:51:15'),
  ('po-o_133-chain_store', 'HQ', 'partner', 'product', 'chain_store', '2026-10', 6980, 0.5, 3490, 'o_133', 'pending', '固定链级差 单店 (1−0.5)×6980', '6980 × 50% = 3490', '2026-10-28 08:51:15'),
  ('po-o_133-chain_district', 'HQ', 'partner', 'product', 'chain_district', '2026-10', 6980, 0.1, 698, 'o_133', 'pending', '固定链级差 区县代 (0.5−0.4)×6980', '6980 × 10% = 698', '2026-10-28 08:51:15'),
  ('po-o_133-chain_city', 'HQ', 'partner', 'product', 'chain_city', '2026-10', 6980, 0.05, 349, 'o_133', 'pending', '固定链级差 市代 (0.4−0.35)×6980', '6980 × 5% = 349', '2026-10-28 08:51:15'),
  ('po-o_133-chain_province', 'HQ', 'partner', 'product', 'chain_province', '2026-10', 6980, 0.05, 349, 'o_133', 'pending', '固定链级差 省代 (0.35−0.3)×6980', '6980 × 5% = 349', '2026-10-28 08:51:15'),
  ('po-o_133-chain_hq', 'HQ', 'partner', 'product', 'chain_hq', '2026-10', 6980, 0.3, 2094, 'o_133', 'pending', '固定链级差 总部 (0.3−0)×6980', '6980 × 30% = 2094', '2026-10-28 08:51:15'),
  ('po-o_135-chain_city', 'HQ', 'partner', 'product', 'chain_city', '2026-10', 2792, 0.13, 349, 'o_135', 'pending', '固定链级差 市代 (0.4−0.35)×6980', '2792 × 13% = 349', '2026-10-28 08:51:15'),
  ('po-o_135-chain_province', 'HQ', 'partner', 'product', 'chain_province', '2026-10', 2792, 0.13, 349, 'o_135', 'pending', '固定链级差 省代 (0.35−0.3)×6980', '2792 × 13% = 349', '2026-10-28 08:51:15'),
  ('po-o_135-chain_hq', 'HQ', 'partner', 'product', 'chain_hq', '2026-10', 2792, 0.75, 2094, 'o_135', 'pending', '固定链级差 总部 (0.3−0)×6980', '2792 × 75% = 2094', '2026-10-28 08:51:15'),
  ('po-o_137-chain_province', 'HQ', 'partner', 'product', 'chain_province', '2026-10', 2443, 0.14, 349, 'o_137', 'pending', '固定链级差 省代 (0.35−0.3)×6980', '2443 × 14% = 349', '2026-10-28 08:51:15'),
  ('po-o_137-chain_hq', 'HQ', 'partner', 'product', 'chain_hq', '2026-10', 2443, 0.86, 2094, 'o_137', 'pending', '固定链级差 总部 (0.3−0)×6980', '2443 × 86% = 2094', '2026-10-28 08:51:15'),
  ('po-o_139-featured_hq', 'HQ', 'partner', 'product', 'featured_hq', '2026-10', 1040, 0.14, 140.4, 'o_139', 'pending', '特色分成 总部', '1040 × 14% = 140.4', '2026-10-28 08:51:15'),
  ('po-o_139-featured_province', 'seed_province', 'partner', 'product', 'featured_province', '2026-10', 1040, 0.02, 18.72, 'o_139', 'pending', '特色分成 省代', '1040 × 2% = 18.72', '2026-10-28 08:51:15'),
  ('po-o_139-featured_city', 'p1', 'partner', 'product', 'featured_city', '2026-10', 1040, 0.07, 74.88, 'o_139', 'pending', '特色分成 市代', '1040 × 7% = 74.88', '2026-10-28 08:51:15'),
  ('po-o_139-featured_district_mgmt', 'p5', 'partner', 'product', 'featured_district_mgmt', '2026-10', 1040, 0.05, 46.8, 'o_139', 'pending', '特色分成 区县代(管理)', '1040 × 5% = 46.8', '2026-10-28 08:51:15'),
  ('po-o_139-featured_district_inspect', 'p5', 'partner', 'product', 'featured_district_inspect', '2026-10', 1040, 0.05, 46.8, 'o_139', 'pending_allocation', '特色分成 区县代(巡查)→待区县负责人分配（待区县负责人分配）', '1040 × 5% = 46.8', '2026-10-28 08:51:15'),
  ('po-o_139-featured_store_delivery', 'p6', 'partner', 'product', 'featured_store_delivery', '2026-10', 1040, 0.27, 280.8, 'o_139', 'pending', '特色分成 单店(交付)', '1040 × 27% = 280.8', '2026-10-28 08:51:15'),
  ('po-o_139-featured_store_traffic', 'p6', 'partner', 'product', 'featured_store_traffic', '2026-10', 1040, 0.27, 280.8, 'o_139', 'pending', '特色分成 单店(流量)', '1040 × 27% = 280.8', '2026-10-28 08:51:15'),
  ('po-o_139-featured_store_sales', 'p6', 'partner', 'product', 'featured_store_sales', '2026-10', 1040, 0.05, 46.8, 'o_139', 'pending', '特色分成 店长/单店负责人（固定）', '1040 × 5% = 46.8', '2026-10-28 08:51:15'),
  ('po-o_139-partner_product', 'p3', 'partner', 'product', 'partner_product', '2026-10', 1040, 0.1, 104, 'o_139', 'pending', '产品提成 | 实付 1040 × 10%（angel 产品提成） = 104', '1040 × 10% = 104', '2026-10-28 08:51:15'),
  ('po-o_145-featured_hq', 'HQ', 'partner', 'product', 'featured_hq', '2026-10', 1040, 0.14, 140.4, 'o_145', 'pending', '特色分成 总部', '1040 × 14% = 140.4', '2026-10-28 08:51:15'),
  ('po-o_145-featured_province', 'seed_province', 'partner', 'product', 'featured_province', '2026-10', 1040, 0.02, 18.72, 'o_145', 'pending', '特色分成 省代', '1040 × 2% = 18.72', '2026-10-28 08:51:15'),
  ('po-o_145-featured_city', 'p1', 'partner', 'product', 'featured_city', '2026-10', 1040, 0.07, 74.88, 'o_145', 'pending', '特色分成 市代', '1040 × 7% = 74.88', '2026-10-28 08:51:15'),
  ('po-o_145-featured_district_mgmt', 'p5', 'partner', 'product', 'featured_district_mgmt', '2026-10', 1040, 0.05, 46.8, 'o_145', 'pending', '特色分成 区县代(管理)', '1040 × 5% = 46.8', '2026-10-28 08:51:15'),
  ('po-o_145-featured_district_inspect', 'p5', 'partner', 'product', 'featured_district_inspect', '2026-10', 1040, 0.05, 46.8, 'o_145', 'pending_allocation', '特色分成 区县代(巡查)→待区县负责人分配（待区县负责人分配）', '1040 × 5% = 46.8', '2026-10-28 08:51:15'),
  ('po-o_145-featured_store_delivery', 'p6', 'partner', 'product', 'featured_store_delivery', '2026-10', 1040, 0.27, 280.8, 'o_145', 'pending', '特色分成 单店(交付)', '1040 × 27% = 280.8', '2026-10-28 08:51:15'),
  ('po-o_145-featured_store_traffic', 'p6', 'partner', 'product', 'featured_store_traffic', '2026-10', 1040, 0.27, 280.8, 'o_145', 'pending', '特色分成 单店(流量)', '1040 × 27% = 280.8', '2026-10-28 08:51:15'),
  ('po-o_145-featured_store_sales', 'p6', 'partner', 'product', 'featured_store_sales', '2026-10', 1040, 0.05, 46.8, 'o_145', 'pending', '特色分成 店长/单店负责人（固定）', '1040 × 5% = 46.8', '2026-10-28 08:51:15'),
  ('po-o_145-partner_product', 'p3', 'partner', 'product', 'partner_product', '2026-10', 1040, 0.1, 104, 'o_145', 'pending', '产品提成 | 实付 1040 × 10%（angel 产品提成） = 104', '1040 × 10% = 104', '2026-10-28 08:51:15'),
  ('po-o_150-featured_hq', 'HQ', 'partner', 'product', 'featured_hq', '2026-10', 1040, 0.14, 140.4, 'o_150', 'pending', '特色分成 总部', '1040 × 14% = 140.4', '2026-10-28 08:51:15'),
  ('po-o_150-featured_province', 'seed_province', 'partner', 'product', 'featured_province', '2026-10', 1040, 0.02, 18.72, 'o_150', 'pending', '特色分成 省代', '1040 × 2% = 18.72', '2026-10-28 08:51:15'),
  ('po-o_150-featured_city', 'p1', 'partner', 'product', 'featured_city', '2026-10', 1040, 0.07, 74.88, 'o_150', 'pending', '特色分成 市代', '1040 × 7% = 74.88', '2026-10-28 08:51:15'),
  ('po-o_150-featured_district_mgmt', 'p5', 'partner', 'product', 'featured_district_mgmt', '2026-10', 1040, 0.05, 46.8, 'o_150', 'pending', '特色分成 区县代(管理)', '1040 × 5% = 46.8', '2026-10-28 08:51:15'),
  ('po-o_150-featured_district_inspect', 'p5', 'partner', 'product', 'featured_district_inspect', '2026-10', 1040, 0.05, 46.8, 'o_150', 'pending_allocation', '特色分成 区县代(巡查)→待区县负责人分配（待区县负责人分配）', '1040 × 5% = 46.8', '2026-10-28 08:51:15'),
  ('po-o_150-featured_store_delivery', 'p6', 'partner', 'product', 'featured_store_delivery', '2026-10', 1040, 0.27, 280.8, 'o_150', 'pending', '特色分成 单店(交付)', '1040 × 27% = 280.8', '2026-10-28 08:51:15'),
  ('po-o_150-featured_store_traffic', 'p6', 'partner', 'product', 'featured_store_traffic', '2026-10', 1040, 0.27, 280.8, 'o_150', 'pending', '特色分成 单店(流量)', '1040 × 27% = 280.8', '2026-10-28 08:51:15'),
  ('po-o_150-featured_store_sales', 'p6', 'partner', 'product', 'featured_store_sales', '2026-10', 1040, 0.05, 46.8, 'o_150', 'pending', '特色分成 店长/单店负责人（固定）', '1040 × 5% = 46.8', '2026-10-28 08:51:15'),
  ('po-o_150-partner_product', 'p3', 'partner', 'product', 'partner_product', '2026-10', 1040, 0.1, 104, 'o_150', 'pending', '产品提成 | 实付 1040 × 10%（angel 产品提成） = 104', '1040 × 10% = 104', '2026-10-28 08:51:15'),
  ('po-o_156-chain_store', 'HQ', 'partner', 'product', 'chain_store', '2026-10', 5584, 0.38, 2094, 'o_156', 'pending', '固定链级差 单店 (0.8−0.5)×6980', '5584 × 38% = 2094', '2026-10-28 08:51:15'),
  ('po-o_156-chain_district', 'HQ', 'partner', 'product', 'chain_district', '2026-10', 5584, 0.13, 698, 'o_156', 'pending', '固定链级差 区县代 (0.5−0.4)×6980', '5584 × 13% = 698', '2026-10-28 08:51:15'),
  ('po-o_156-chain_city', 'HQ', 'partner', 'product', 'chain_city', '2026-10', 5584, 0.06, 349, 'o_156', 'pending', '固定链级差 市代 (0.4−0.35)×6980', '5584 × 6% = 349', '2026-10-28 08:51:15'),
  ('po-o_156-chain_province', 'HQ', 'partner', 'product', 'chain_province', '2026-10', 5584, 0.06, 349, 'o_156', 'pending', '固定链级差 省代 (0.35−0.3)×6980', '5584 × 6% = 349', '2026-10-28 08:51:15'),
  ('po-o_156-chain_hq', 'HQ', 'partner', 'product', 'chain_hq', '2026-10', 5584, 0.38, 2094, 'o_156', 'pending', '固定链级差 总部 (0.3−0)×6980', '5584 × 38% = 2094', '2026-10-28 08:51:15'),
  ('po-o_158-chain_store', 'HQ', 'partner', 'product', 'chain_store', '2026-10', 4537, 0.23, 1047, 'o_158', 'pending', '固定链级差 单店 (0.65−0.5)×6980', '4537 × 23% = 1047', '2026-10-28 08:51:15'),
  ('po-o_158-chain_district', 'HQ', 'partner', 'product', 'chain_district', '2026-10', 4537, 0.15, 698, 'o_158', 'pending', '固定链级差 区县代 (0.5−0.4)×6980', '4537 × 15% = 698', '2026-10-28 08:51:15'),
  ('po-o_158-chain_city', 'HQ', 'partner', 'product', 'chain_city', '2026-10', 4537, 0.08, 349, 'o_158', 'pending', '固定链级差 市代 (0.4−0.35)×6980', '4537 × 8% = 349', '2026-10-28 08:51:15'),
  ('po-o_158-chain_province', 'HQ', 'partner', 'product', 'chain_province', '2026-10', 4537, 0.08, 349, 'o_158', 'pending', '固定链级差 省代 (0.35−0.3)×6980', '4537 × 8% = 349', '2026-10-28 08:51:15'),
  ('po-o_158-chain_hq', 'HQ', 'partner', 'product', 'chain_hq', '2026-10', 4537, 0.46, 2094, 'o_158', 'pending', '固定链级差 总部 (0.3−0)×6980', '4537 × 46% = 2094', '2026-10-28 08:51:15'),
  ('po-o_160-chain_hq_direct', 'HQ', 'partner', 'product', 'chain_hq_direct', '2026-10', 2094, 1, 2094, 'o_160', 'pending', '总部直供（无上级代理）', '2094 × 100% = 2094', '2026-10-28 08:51:15'),
  ('po-o_162-chain_district', 'HQ', 'partner', 'product', 'chain_district', '2026-10', 3490, 0.2, 698, 'o_162', 'pending', '固定链级差 区县代 (0.5−0.4)×6980', '3490 × 20% = 698', '2026-10-28 08:51:15'),
  ('po-o_162-chain_city', 'HQ', 'partner', 'product', 'chain_city', '2026-10', 3490, 0.1, 349, 'o_162', 'pending', '固定链级差 市代 (0.4−0.35)×6980', '3490 × 10% = 349', '2026-10-28 08:51:15'),
  ('po-o_162-chain_province', 'HQ', 'partner', 'product', 'chain_province', '2026-10', 3490, 0.1, 349, 'o_162', 'pending', '固定链级差 省代 (0.35−0.3)×6980', '3490 × 10% = 349', '2026-10-28 08:51:15'),
  ('po-o_162-chain_hq', 'HQ', 'partner', 'product', 'chain_hq', '2026-10', 3490, 0.6, 2094, 'o_162', 'pending', '固定链级差 总部 (0.3−0)×6980', '3490 × 60% = 2094', '2026-10-28 08:51:15'),
  ('po-o_164-chain_store', 'HQ', 'partner', 'product', 'chain_store', '2026-10', 4886, 0.29, 1396, 'o_164', 'pending', '固定链级差 单店 (0.7−0.5)×6980', '4886 × 29% = 1396', '2026-10-28 08:51:15'),
  ('po-o_164-chain_district', 'HQ', 'partner', 'product', 'chain_district', '2026-10', 4886, 0.14, 698, 'o_164', 'pending', '固定链级差 区县代 (0.5−0.4)×6980', '4886 × 14% = 698', '2026-10-28 08:51:15'),
  ('po-o_164-chain_city', 'HQ', 'partner', 'product', 'chain_city', '2026-10', 4886, 0.07, 349, 'o_164', 'pending', '固定链级差 市代 (0.4−0.35)×6980', '4886 × 7% = 349', '2026-10-28 08:51:15'),
  ('po-o_164-chain_province', 'HQ', 'partner', 'product', 'chain_province', '2026-10', 4886, 0.07, 349, 'o_164', 'pending', '固定链级差 省代 (0.35−0.3)×6980', '4886 × 7% = 349', '2026-10-28 08:51:15'),
  ('po-o_164-chain_hq', 'HQ', 'partner', 'product', 'chain_hq', '2026-10', 4886, 0.43, 2094, 'o_164', 'pending', '固定链级差 总部 (0.3−0)×6980', '4886 × 43% = 2094', '2026-10-28 08:51:15'),
  ('po-o_166-chain_store', 'HQ', 'partner', 'product', 'chain_store', '2026-10', 5235, 0.33, 1745, 'o_166', 'pending', '固定链级差 单店 (0.75−0.5)×6980', '5235 × 33% = 1745', '2026-10-28 08:51:15'),
  ('po-o_166-chain_district', 'HQ', 'partner', 'product', 'chain_district', '2026-10', 5235, 0.13, 698, 'o_166', 'pending', '固定链级差 区县代 (0.5−0.4)×6980', '5235 × 13% = 698', '2026-10-28 08:51:15'),
  ('po-o_166-chain_city', 'HQ', 'partner', 'product', 'chain_city', '2026-10', 5235, 0.07, 349, 'o_166', 'pending', '固定链级差 市代 (0.4−0.35)×6980', '5235 × 7% = 349', '2026-10-28 08:51:15'),
  ('po-o_166-chain_province', 'HQ', 'partner', 'product', 'chain_province', '2026-10', 5235, 0.07, 349, 'o_166', 'pending', '固定链级差 省代 (0.35−0.3)×6980', '5235 × 7% = 349', '2026-10-28 08:51:15'),
  ('po-o_166-chain_hq', 'HQ', 'partner', 'product', 'chain_hq', '2026-10', 5235, 0.4, 2094, 'o_166', 'pending', '固定链级差 总部 (0.3−0)×6980', '5235 × 40% = 2094', '2026-10-28 08:51:15'),
  ('po-o_168-chain_store', 'HQ', 'partner', 'product', 'chain_store', '2026-10', 5584, 0.38, 2094, 'o_168', 'pending', '固定链级差 单店 (0.8−0.5)×6980', '5584 × 38% = 2094', '2026-10-28 08:51:15'),
  ('po-o_168-chain_district', 'HQ', 'partner', 'product', 'chain_district', '2026-10', 5584, 0.13, 698, 'o_168', 'pending', '固定链级差 区县代 (0.5−0.4)×6980', '5584 × 13% = 698', '2026-10-28 08:51:15'),
  ('po-o_168-chain_city', 'HQ', 'partner', 'product', 'chain_city', '2026-10', 5584, 0.06, 349, 'o_168', 'pending', '固定链级差 市代 (0.4−0.35)×6980', '5584 × 6% = 349', '2026-10-28 08:51:15'),
  ('po-o_168-chain_province', 'HQ', 'partner', 'product', 'chain_province', '2026-10', 5584, 0.06, 349, 'o_168', 'pending', '固定链级差 省代 (0.35−0.3)×6980', '5584 × 6% = 349', '2026-10-28 08:51:15'),
  ('po-o_168-chain_hq', 'HQ', 'partner', 'product', 'chain_hq', '2026-10', 5584, 0.38, 2094, 'o_168', 'pending', '固定链级差 总部 (0.3−0)×6980', '5584 × 38% = 2094', '2026-10-28 08:51:15'),
  ('po-o_170-chain_store', 'HQ', 'partner', 'product', 'chain_store', '2026-10', 6980, 0.5, 3490, 'o_170', 'pending', '固定链级差 单店 (1−0.5)×6980', '6980 × 50% = 3490', '2026-10-28 08:51:15'),
  ('po-o_170-chain_district', 'HQ', 'partner', 'product', 'chain_district', '2026-10', 6980, 0.1, 698, 'o_170', 'pending', '固定链级差 区县代 (0.5−0.4)×6980', '6980 × 10% = 698', '2026-10-28 08:51:15'),
  ('po-o_170-chain_city', 'HQ', 'partner', 'product', 'chain_city', '2026-10', 6980, 0.05, 349, 'o_170', 'pending', '固定链级差 市代 (0.4−0.35)×6980', '6980 × 5% = 349', '2026-10-28 08:51:15'),
  ('po-o_170-chain_province', 'HQ', 'partner', 'product', 'chain_province', '2026-10', 6980, 0.05, 349, 'o_170', 'pending', '固定链级差 省代 (0.35−0.3)×6980', '6980 × 5% = 349', '2026-10-28 08:51:15'),
  ('po-o_170-chain_hq', 'HQ', 'partner', 'product', 'chain_hq', '2026-10', 6980, 0.3, 2094, 'o_170', 'pending', '固定链级差 总部 (0.3−0)×6980', '6980 × 30% = 2094', '2026-10-28 08:51:15'),
  ('po-o_172-chain_store', 'HQ', 'partner', 'product', 'chain_store', '2026-10', 6980, 0.5, 3490, 'o_172', 'pending', '固定链级差 单店 (1−0.5)×6980', '6980 × 50% = 3490', '2026-10-28 08:51:15'),
  ('po-o_172-chain_district', 'HQ', 'partner', 'product', 'chain_district', '2026-10', 6980, 0.1, 698, 'o_172', 'pending', '固定链级差 区县代 (0.5−0.4)×6980', '6980 × 10% = 698', '2026-10-28 08:51:15'),
  ('po-o_172-chain_city', 'HQ', 'partner', 'product', 'chain_city', '2026-10', 6980, 0.05, 349, 'o_172', 'pending', '固定链级差 市代 (0.4−0.35)×6980', '6980 × 5% = 349', '2026-10-28 08:51:15'),
  ('po-o_172-chain_province', 'HQ', 'partner', 'product', 'chain_province', '2026-10', 6980, 0.05, 349, 'o_172', 'pending', '固定链级差 省代 (0.35−0.3)×6980', '6980 × 5% = 349', '2026-10-28 08:51:15'),
  ('po-o_172-chain_hq', 'HQ', 'partner', 'product', 'chain_hq', '2026-10', 6980, 0.3, 2094, 'o_172', 'pending', '固定链级差 总部 (0.3−0)×6980', '6980 × 30% = 2094', '2026-10-28 08:51:15'),
  ('po-o_174-chain_city', 'HQ', 'partner', 'product', 'chain_city', '2026-10', 2792, 0.13, 349, 'o_174', 'pending', '固定链级差 市代 (0.4−0.35)×6980', '2792 × 13% = 349', '2026-10-28 08:51:15'),
  ('po-o_174-chain_province', 'HQ', 'partner', 'product', 'chain_province', '2026-10', 2792, 0.13, 349, 'o_174', 'pending', '固定链级差 省代 (0.35−0.3)×6980', '2792 × 13% = 349', '2026-10-28 08:51:15'),
  ('po-o_174-chain_hq', 'HQ', 'partner', 'product', 'chain_hq', '2026-10', 2792, 0.75, 2094, 'o_174', 'pending', '固定链级差 总部 (0.3−0)×6980', '2792 × 75% = 2094', '2026-10-28 08:51:15'),
  ('po-o_176-chain_province', 'HQ', 'partner', 'product', 'chain_province', '2026-10', 2443, 0.14, 349, 'o_176', 'pending', '固定链级差 省代 (0.35−0.3)×6980', '2443 × 14% = 349', '2026-10-28 08:51:15'),
  ('po-o_176-chain_hq', 'HQ', 'partner', 'product', 'chain_hq', '2026-10', 2443, 0.86, 2094, 'o_176', 'pending', '固定链级差 总部 (0.3−0)×6980', '2443 × 86% = 2094', '2026-10-28 08:51:15');

INSERT INTO `counters` (`name`, `value`) VALUES
  ('userSeq', 1),
  ('seq', 1);

INSERT INTO `coupons` (`id`, `user_id`, `title`, `discount_amount`, `threshold_text`, `scope_label`, `status`, `expires_at`, `created_at`) VALUES
  ('cpn_kj8rorq2', 'p4', '新人专享券', 50, '满 500 元可用', '全场通用', 'available', 1795740453898, '2026-10-28 08:51:15'),
  ('cpn_hh268ze9', 'p4', '学习课程券', 100, '满 1000 元可用', '课程类商品', 'available', 1798332453898, '2026-10-28 08:51:15'),
  ('cpn_6y007fu9', 'p4', '商城满减券', 30, '满 300 元可用', '甄选商品', 'used', 1795740453898, '2026-10-28 08:51:15'),
  ('cpn_vy9k40ut', 'p4', '已过期券', 20, '满 200 元可用', '全场通用', 'void', 1793062053898, '2026-10-28 08:51:15'),
  ('cpn_6h1l2pko', 'u_7ncoc1', '新人专享券', 50, '满 500 元可用', '全场通用', 'available', 1795740473561, '2026-10-28 08:51:15'),
  ('cpn_z0x4kekg', 'u_7ncoc1', '学习课程券', 100, '满 1000 元可用', '课程类商品', 'available', 1798332473561, '2026-10-28 08:51:15'),
  ('cpn_7tz0jjmx', 'u_7ncoc1', '商城满减券', 30, '满 300 元可用', '甄选商品', 'used', 1795740473561, '2026-10-28 08:51:15'),
  ('cpn_t6g5veu4', 'u_7ncoc1', '已过期券', 20, '满 200 元可用', '全场通用', 'void', 1793062073561, '2026-10-28 08:51:15'),
  ('cpn_rns2rohi', 'u_ys5utb', '新人专享券', 50, '满 500 元可用', '全场通用', 'available', 1795740596606, '2026-10-28 08:51:15'),
  ('cpn_4zqseu31', 'u_ys5utb', '学习课程券', 100, '满 1000 元可用', '课程类商品', 'available', 1798332596606, '2026-10-28 08:51:15'),
  ('cpn_vlhfwdfc', 'u_ys5utb', '商城满减券', 30, '满 300 元可用', '甄选商品', 'used', 1795740596606, '2026-10-28 08:51:15'),
  ('cpn_2lde8xl1', 'u_ys5utb', '已过期券', 20, '满 200 元可用', '全场通用', 'void', 1793062196606, '2026-10-28 08:51:15');

INSERT INTO `experience_ledger` (`id`, `user_id`, `tab`, `event`, `title`, `points`, `price`, `ref_id`, `meta`, `occurred_at`) VALUES
  ('exp_29', 'seed_cofounder', 'product', 'product', '脑商Pad', 4537, 4537, 'o_28', '{"productKey":"pad","kind":"physical","kindLabel":"实物","qty":1,"deliveryMode":"EXPRESS"}', 1793148444183),
  ('exp_31', 'seed_province', 'product', 'product', '脑商Pad', 2094, 2094, 'o_30', '{"productKey":"pad","kind":"physical","kindLabel":"实物","qty":1,"deliveryMode":"EXPRESS"}', 1793148444194),
  ('exp_33', 'seed_store', 'product', 'product', '脑商Pad', 3490, 3490, 'o_32', '{"productKey":"pad","kind":"physical","kindLabel":"实物","qty":1,"deliveryMode":"EXPRESS"}', 1793148444206),
  ('exp_35', 'seed_private', 'product', 'product', '脑商Pad', 4886, 4886, 'o_34', '{"productKey":"pad","kind":"physical","kindLabel":"实物","qty":1,"deliveryMode":"EXPRESS"}', 1793148444215),
  ('exp_37', 'seed_angel', 'product', 'product', '脑商Pad', 5235, 5235, 'o_36', '{"productKey":"pad","kind":"physical","kindLabel":"实物","qty":1,"deliveryMode":"EXPRESS"}', 1793148444224),
  ('exp_39', 'seed_vip', 'product', 'product', '脑商Pad', 5584, 5584, 'o_38', '{"productKey":"pad","kind":"physical","kindLabel":"实物","qty":1,"deliveryMode":"EXPRESS"}', 1793148444234),
  ('exp_41', 'seed_parent_cj', 'product', 'product', '脑商Pad', 6980, 6980, 'o_40', '{"productKey":"pad","kind":"physical","kindLabel":"实物","qty":1,"deliveryMode":"EXPRESS"}', 1793148444242),
  ('exp_43', 'seed_parent_nokid', 'product', 'product', '脑商Pad', 6980, 6980, 'o_42', '{"productKey":"pad","kind":"physical","kindLabel":"实物","qty":1,"deliveryMode":"EXPRESS"}', 1793148444251),
  ('exp_45', 'seed_district', 'product', 'product', '脑商Pad', 2792, 2792, 'o_44', '{"productKey":"pad","kind":"physical","kindLabel":"实物","qty":1,"deliveryMode":"EXPRESS"}', 1793148444258),
  ('exp_47', 'seed_city', 'product', 'product', '脑商Pad', 2443, 2443, 'o_46', '{"productKey":"pad","kind":"physical","kindLabel":"实物","qty":1,"deliveryMode":"EXPRESS"}', 1793148444266),
  ('exp_49', 'seed_cofounder', 'product', 'product', '脑商Pad', 4537, 4537, 'o_48', '{"productKey":"pad","kind":"physical","kindLabel":"实物","qty":1,"deliveryMode":"EXPRESS"}', 1793148448346),
  ('exp_51', 'seed_province', 'product', 'product', '脑商Pad', 2094, 2094, 'o_50', '{"productKey":"pad","kind":"physical","kindLabel":"实物","qty":1,"deliveryMode":"EXPRESS"}', 1793148448356),
  ('exp_53', 'seed_store', 'product', 'product', '脑商Pad', 3490, 3490, 'o_52', '{"productKey":"pad","kind":"physical","kindLabel":"实物","qty":1,"deliveryMode":"EXPRESS"}', 1793148448367),
  ('exp_55', 'seed_private', 'product', 'product', '脑商Pad', 4886, 4886, 'o_54', '{"productKey":"pad","kind":"physical","kindLabel":"实物","qty":1,"deliveryMode":"EXPRESS"}', 1793148448378),
  ('exp_57', 'seed_angel', 'product', 'product', '脑商Pad', 5235, 5235, 'o_56', '{"productKey":"pad","kind":"physical","kindLabel":"实物","qty":1,"deliveryMode":"EXPRESS"}', 1793148448387),
  ('exp_59', 'seed_vip', 'product', 'product', '脑商Pad', 5584, 5584, 'o_58', '{"productKey":"pad","kind":"physical","kindLabel":"实物","qty":1,"deliveryMode":"EXPRESS"}', 1793148448397),
  ('exp_61', 'seed_parent_cj', 'product', 'product', '脑商Pad', 6980, 6980, 'o_60', '{"productKey":"pad","kind":"physical","kindLabel":"实物","qty":1,"deliveryMode":"EXPRESS"}', 1793148448405),
  ('exp_63', 'seed_parent_nokid', 'product', 'product', '脑商Pad', 6980, 6980, 'o_62', '{"productKey":"pad","kind":"physical","kindLabel":"实物","qty":1,"deliveryMode":"EXPRESS"}', 1793148448415),
  ('exp_65', 'seed_district', 'product', 'product', '脑商Pad', 2792, 2792, 'o_64', '{"productKey":"pad","kind":"physical","kindLabel":"实物","qty":1,"deliveryMode":"EXPRESS"}', 1793148448423),
  ('exp_67', 'seed_city', 'product', 'product', '脑商Pad', 2443, 2443, 'o_66', '{"productKey":"pad","kind":"physical","kindLabel":"实物","qty":1,"deliveryMode":"EXPRESS"}', 1793148448432),
  ('exp_69', 'p4', 'product', 'product', '特色产品', 1040, 1040, 'o_68', '{"productKey":"featured","kind":"featured","kindLabel":"特色","qty":1,"deliveryMode":"ONLINE_STORE"}', 1793148453587),
  ('exp_71', 'p4', 'product', 'product', '特色产品', 1040, 1040, 'o_70', '{"productKey":"featured","kind":"featured","kindLabel":"特色","qty":1,"deliveryMode":"ONLINE_STORE"}', 1793148453903),
  ('exp_75', 'p4', 'product', 'product', '特色产品', 1040, 1040, 'o_74', '{"productKey":"featured","kind":"featured","kindLabel":"特色","qty":1,"deliveryMode":"ONLINE_STORE"}', 1793148454256),
  ('exp_77', 'u_7ncoc1', 'product', 'product', '脑商Pad', 5584, 5584, 'o_76', '{"productKey":"pad","kind":"physical","kindLabel":"实物","qty":1,"deliveryMode":"EXPRESS"}', 1793148473566),
  ('exp_79', 'seed_cofounder', 'product', 'product', '脑商Pad', 4537, 4537, 'o_78', '{"productKey":"pad","kind":"physical","kindLabel":"实物","qty":1,"deliveryMode":"EXPRESS"}', 1793148482804),
  ('exp_81', 'seed_province', 'product', 'product', '脑商Pad', 2094, 2094, 'o_80', '{"productKey":"pad","kind":"physical","kindLabel":"实物","qty":1,"deliveryMode":"EXPRESS"}', 1793148482817),
  ('exp_83', 'seed_store', 'product', 'product', '脑商Pad', 3490, 3490, 'o_82', '{"productKey":"pad","kind":"physical","kindLabel":"实物","qty":1,"deliveryMode":"EXPRESS"}', 1793148482830),
  ('exp_85', 'seed_private', 'product', 'product', '脑商Pad', 4886, 4886, 'o_84', '{"productKey":"pad","kind":"physical","kindLabel":"实物","qty":1,"deliveryMode":"EXPRESS"}', 1793148482840),
  ('exp_87', 'seed_angel', 'product', 'product', '脑商Pad', 5235, 5235, 'o_86', '{"productKey":"pad","kind":"physical","kindLabel":"实物","qty":1,"deliveryMode":"EXPRESS"}', 1793148482851),
  ('exp_89', 'seed_vip', 'product', 'product', '脑商Pad', 5584, 5584, 'o_88', '{"productKey":"pad","kind":"physical","kindLabel":"实物","qty":1,"deliveryMode":"EXPRESS"}', 1793148482860),
  ('exp_91', 'seed_parent_cj', 'product', 'product', '脑商Pad', 6980, 6980, 'o_90', '{"productKey":"pad","kind":"physical","kindLabel":"实物","qty":1,"deliveryMode":"EXPRESS"}', 1793148482870),
  ('exp_93', 'seed_parent_nokid', 'product', 'product', '脑商Pad', 6980, 6980, 'o_92', '{"productKey":"pad","kind":"physical","kindLabel":"实物","qty":1,"deliveryMode":"EXPRESS"}', 1793148482881),
  ('exp_95', 'seed_district', 'product', 'product', '脑商Pad', 2792, 2792, 'o_94', '{"productKey":"pad","kind":"physical","kindLabel":"实物","qty":1,"deliveryMode":"EXPRESS"}', 1793148482890),
  ('exp_97', 'seed_city', 'product', 'product', '脑商Pad', 2443, 2443, 'o_96', '{"productKey":"pad","kind":"physical","kindLabel":"实物","qty":1,"deliveryMode":"EXPRESS"}', 1793148482901),
  ('exp_99', 'p4', 'product', 'product', '特色产品', 1040, 1040, 'o_98', '{"productKey":"featured","kind":"featured","kindLabel":"特色","qty":1,"deliveryMode":"ONLINE_STORE"}', 1793148487174),
  ('exp_104', 'p4', 'product', 'product', '特色产品', 1040, 1040, 'o_103', '{"productKey":"featured","kind":"featured","kindLabel":"特色","qty":1,"deliveryMode":"ONLINE_STORE"}', 1793148490366),
  ('exp_108', 'p4', 'product', 'product', '特色产品', 1040, 1040, 'o_107', '{"productKey":"featured","kind":"featured","kindLabel":"特色","qty":1,"deliveryMode":"ONLINE_STORE"}', 1793148504738),
  ('exp_112', 'p4', 'product', 'product', '特色产品', 1040, 1040, 'o_111', '{"productKey":"featured","kind":"featured","kindLabel":"特色","qty":1,"deliveryMode":"ONLINE_STORE"}', 1793148516227),
  ('exp_120', 'seed_cofounder', 'product', 'product', '脑商Pad', 4537, 4537, 'o_119', '{"productKey":"pad","kind":"physical","kindLabel":"实物","qty":1,"deliveryMode":"EXPRESS"}', 1793148570337),
  ('exp_122', 'seed_province', 'product', 'product', '脑商Pad', 2094, 2094, 'o_121', '{"productKey":"pad","kind":"physical","kindLabel":"实物","qty":1,"deliveryMode":"EXPRESS"}', 1793148570352),
  ('exp_124', 'seed_store', 'product', 'product', '脑商Pad', 3490, 3490, 'o_123', '{"productKey":"pad","kind":"physical","kindLabel":"实物","qty":1,"deliveryMode":"EXPRESS"}', 1793148570367),
  ('exp_126', 'seed_private', 'product', 'product', '脑商Pad', 4886, 4886, 'o_125', '{"productKey":"pad","kind":"physical","kindLabel":"实物","qty":1,"deliveryMode":"EXPRESS"}', 1793148570378),
  ('exp_128', 'seed_angel', 'product', 'product', '脑商Pad', 5235, 5235, 'o_127', '{"productKey":"pad","kind":"physical","kindLabel":"实物","qty":1,"deliveryMode":"EXPRESS"}', 1793148570390),
  ('exp_130', 'seed_vip', 'product', 'product', '脑商Pad', 5584, 5584, 'o_129', '{"productKey":"pad","kind":"physical","kindLabel":"实物","qty":1,"deliveryMode":"EXPRESS"}', 1793148570401),
  ('exp_132', 'seed_parent_cj', 'product', 'product', '脑商Pad', 6980, 6980, 'o_131', '{"productKey":"pad","kind":"physical","kindLabel":"实物","qty":1,"deliveryMode":"EXPRESS"}', 1793148570412),
  ('exp_134', 'seed_parent_nokid', 'product', 'product', '脑商Pad', 6980, 6980, 'o_133', '{"productKey":"pad","kind":"physical","kindLabel":"实物","qty":1,"deliveryMode":"EXPRESS"}', 1793148570423),
  ('exp_136', 'seed_district', 'product', 'product', '脑商Pad', 2792, 2792, 'o_135', '{"productKey":"pad","kind":"physical","kindLabel":"实物","qty":1,"deliveryMode":"EXPRESS"}', 1793148570435),
  ('exp_138', 'seed_city', 'product', 'product', '脑商Pad', 2443, 2443, 'o_137', '{"productKey":"pad","kind":"physical","kindLabel":"实物","qty":1,"deliveryMode":"EXPRESS"}', 1793148570446),
  ('exp_140', 'p4', 'product', 'product', '特色产品', 1040, 1040, 'o_139', '{"productKey":"featured","kind":"featured","kindLabel":"特色","qty":1,"deliveryMode":"ONLINE_STORE"}', 1793148570606),
  ('exp_146', 'p4', 'product', 'product', '特色产品', 1040, 1040, 'o_145', '{"productKey":"featured","kind":"featured","kindLabel":"特色","qty":1,"deliveryMode":"ONLINE_STORE"}', 1793148575813),
  ('exp_151', 'p4', 'product', 'product', '特色产品', 1040, 1040, 'o_150', '{"productKey":"featured","kind":"featured","kindLabel":"特色","qty":1,"deliveryMode":"ONLINE_STORE"}', 1793148576070),
  ('exp_155', 'p4', 'product', 'product', '特色产品', 1040, 1040, 'o_154', '{"productKey":"featured","kind":"featured","kindLabel":"特色","qty":1,"deliveryMode":"ONLINE_STORE"}', 1793148576413),
  ('exp_157', 'u_ys5utb', 'product', 'product', '脑商Pad', 5584, 5584, 'o_156', '{"productKey":"pad","kind":"physical","kindLabel":"实物","qty":1,"deliveryMode":"EXPRESS"}', 1793148596612),
  ('exp_159', 'seed_cofounder', 'product', 'product', '脑商Pad', 4537, 4537, 'o_158', '{"productKey":"pad","kind":"physical","kindLabel":"实物","qty":1,"deliveryMode":"EXPRESS"}', 1793148605968),
  ('exp_161', 'seed_province', 'product', 'product', '脑商Pad', 2094, 2094, 'o_160', '{"productKey":"pad","kind":"physical","kindLabel":"实物","qty":1,"deliveryMode":"EXPRESS"}', 1793148605982),
  ('exp_163', 'seed_store', 'product', 'product', '脑商Pad', 3490, 3490, 'o_162', '{"productKey":"pad","kind":"physical","kindLabel":"实物","qty":1,"deliveryMode":"EXPRESS"}', 1793148605995),
  ('exp_165', 'seed_private', 'product', 'product', '脑商Pad', 4886, 4886, 'o_164', '{"productKey":"pad","kind":"physical","kindLabel":"实物","qty":1,"deliveryMode":"EXPRESS"}', 1793148606007),
  ('exp_167', 'seed_angel', 'product', 'product', '脑商Pad', 5235, 5235, 'o_166', '{"productKey":"pad","kind":"physical","kindLabel":"实物","qty":1,"deliveryMode":"EXPRESS"}', 1793148606019),
  ('exp_169', 'seed_vip', 'product', 'product', '脑商Pad', 5584, 5584, 'o_168', '{"productKey":"pad","kind":"physical","kindLabel":"实物","qty":1,"deliveryMode":"EXPRESS"}', 1793148606031),
  ('exp_171', 'seed_parent_cj', 'product', 'product', '脑商Pad', 6980, 6980, 'o_170', '{"productKey":"pad","kind":"physical","kindLabel":"实物","qty":1,"deliveryMode":"EXPRESS"}', 1793148606042),
  ('exp_173', 'seed_parent_nokid', 'product', 'product', '脑商Pad', 6980, 6980, 'o_172', '{"productKey":"pad","kind":"physical","kindLabel":"实物","qty":1,"deliveryMode":"EXPRESS"}', 1793148606055),
  ('exp_175', 'seed_district', 'product', 'product', '脑商Pad', 2792, 2792, 'o_174', '{"productKey":"pad","kind":"physical","kindLabel":"实物","qty":1,"deliveryMode":"EXPRESS"}', 1793148606067),
  ('exp_177', 'seed_city', 'product', 'product', '脑商Pad', 2443, 2443, 'o_176', '{"productKey":"pad","kind":"physical","kindLabel":"实物","qty":1,"deliveryMode":"EXPRESS"}', 1793148606078);

INSERT INTO `members` (`id`, `user_id`, `name`, `grade_code`, `grade_label`, `gender_code`, `gender_label`, `avatar_asset_id`, `avatar_url`, `store_id`, `activated`, `member_level`, `member_seq`, `display_id`, `unlocked_levels`, `unlocked_columns`, `training`, `idempotency_key`, `created_at`, `version`) VALUES
  ('seed_cofounder_m1', 'seed_cofounder', '甲孩子-羿烁', 'G4', '四年级', 'M', '男', NULL, NULL, NULL, 1, 'ys', 31, 'YS0031', '[]', '[]', '{"trainingTotal":0,"trainingUsed":0,"specialTotal":0,"specialUsed":0,"selfStudyNote":"","campNote":"","remark":""}', 'seed-seed_cofounder_m1', '2026-10-28', 1),
  ('seed_province_m2', 'seed_province', '乙孩子-粉丝', 'G4', '四年级', 'M', '男', NULL, NULL, NULL, 1, 'fs', 32, 'FS0032', '[]', '[]', '{"trainingTotal":0,"trainingUsed":0,"specialTotal":0,"specialUsed":0,"selfStudyNote":"","campNote":"","remark":""}', 'seed-seed_province_m2', '2026-10-28', 1),
  ('seed_store_m3', 'seed_store', '丙孩子-菁英', 'G4', '四年级', 'M', '男', NULL, NULL, NULL, 1, 'jy', 33, 'JY0033', '[]', '[]', '{"trainingTotal":0,"trainingUsed":0,"specialTotal":0,"specialUsed":0,"selfStudyNote":"","campNote":"","remark":""}', 'seed-seed_store_m3', '2026-10-28', 1),
  ('seed_private_m4', 'seed_private', '丁孩子-超级', 'G4', '四年级', 'M', '男', NULL, NULL, NULL, 1, 'cj', 34, 'CJ0034', '[]', '[]', '{"trainingTotal":0,"trainingUsed":0,"specialTotal":0,"specialUsed":0,"selfStudyNote":"","campNote":"","remark":""}', 'seed-seed_private_m4', '2026-10-28', 1),
  ('seed_angel_m5', 'seed_angel', '戊孩子-行能', 'G4', '四年级', 'M', '男', NULL, NULL, NULL, 1, 'xn', 35, 'XN0035', '[]', '[]', '{"trainingTotal":0,"trainingUsed":0,"specialTotal":0,"specialUsed":0,"selfStudyNote":"","campNote":"","remark":""}', 'seed-seed_angel_m5', '2026-10-28', 1),
  ('seed_vip_m6', 'seed_vip', '己孩子-普通', 'G4', '四年级', 'M', '男', NULL, NULL, NULL, 0, 'normal', 36, 'QZ0036', '[]', '[]', '{"trainingTotal":0,"trainingUsed":0,"specialTotal":0,"specialUsed":0,"selfStudyNote":"","campNote":"","remark":""}', 'seed-seed_vip_m6', '2026-10-28', 1),
  ('seed_parent_cj_m7', 'seed_parent_cj', '庚孩子-超级', 'G4', '四年级', 'M', '男', NULL, NULL, NULL, 1, 'cj', 37, 'CJ0037', '[]', '[]', '{"trainingTotal":0,"trainingUsed":0,"specialTotal":0,"specialUsed":0,"selfStudyNote":"","campNote":"","remark":""}', 'seed-seed_parent_cj_m7', '2026-10-28', 1),
  ('seed_parent_free_m8', 'seed_parent_free', '辛孩子-普通', 'G4', '四年级', 'M', '男', NULL, NULL, NULL, 0, 'normal', 38, 'QZ0038', '[]', '[]', '{"trainingTotal":0,"trainingUsed":0,"specialTotal":0,"specialUsed":0,"selfStudyNote":"","campNote":"","remark":""}', 'seed-seed_parent_free_m8', '2026-10-28', 1),
  ('seed_district_m9', 'seed_district', '癸孩子-超级', 'G4', '四年级', 'M', '男', NULL, NULL, NULL, 1, 'cj', 39, 'CJ0039', '[]', '[]', '{"trainingTotal":0,"trainingUsed":0,"specialTotal":0,"specialUsed":0,"selfStudyNote":"","campNote":"","remark":""}', 'seed-seed_district_m9', '2026-10-28', 1),
  ('seed_city_m10', 'seed_city', '子孩子-粉丝', 'G4', '四年级', 'M', '男', NULL, NULL, NULL, 1, 'fs', 40, 'FS0040', '[]', '[]', '{"trainingTotal":0,"trainingUsed":0,"specialTotal":0,"specialUsed":0,"selfStudyNote":"","campNote":"","remark":""}', 'seed-seed_city_m10', '2026-10-28', 1);

INSERT INTO `orders` (`id`, `buyer_id`, `seller_id`, `package_tier`, `old_tier`, `quota_count`, `vip_credit`, `actual_paid`, `seller_cost`, `supply_spread`, `store_fee`, `hq_fee`, `region_code`, `channel`, `store_id`, `status`, `created_at`) VALUES
  ('cs_16', 'p7', 'p6', 'vip', NULL, 1, 0, 698, 0, 0, 0, 0, '330110-S1', 'partner', '330110-S1', 'paid', '2026-10'),
  ('o_1', 'p4', 'p3', 'vip', 'vip', 1, 1, 7980, 7500, 480, 0, 6500, '330110', 'partner', NULL, 'paid', '1793095807830.0'),
  ('o_5', 'p6', 'p5', 'angel', 'angel', 3, 3, 22500, 20940, 1560, 0, 19500, '330110', 'partner', NULL, 'paid', '1793095807830.0'),
  ('o_8', 'p7', 'p3', 'angel', 'angel', 2, 2, 15000, 15000, 0, 0, 13000, '330110', 'partner', NULL, 'paid', '1793095807830.0'),
  ('o_28', 'seed_cofounder', NULL, 'cofounder', NULL, 1, 1, 0, 0, 0, 0, 0, NULL, 'partner', NULL, 'paid', '1793148444183.0'),
  ('o_30', 'seed_province', NULL, 'vip', NULL, 1, 1, 0, 0, 0, 0, 0, NULL, 'partner', NULL, 'paid', '1793148444194.0'),
  ('o_32', 'seed_store', NULL, 'vip', NULL, 1, 1, 0, 0, 0, 0, 0, NULL, 'partner', NULL, 'paid', '1793148444206.0'),
  ('o_34', 'seed_private', NULL, 'private', NULL, 1, 1, 0, 0, 0, 0, 0, NULL, 'partner', NULL, 'paid', '1793148444215.0'),
  ('o_36', 'seed_angel', NULL, 'angel', NULL, 1, 1, 0, 0, 0, 0, 0, NULL, 'partner', NULL, 'paid', '1793148444224.0'),
  ('o_38', 'seed_vip', NULL, 'vip', NULL, 1, 1, 0, 0, 0, 0, 0, NULL, 'partner', NULL, 'paid', '1793148444234.0'),
  ('o_40', 'seed_parent_cj', NULL, 'vip', NULL, 1, 1, 0, 0, 0, 0, 0, NULL, 'partner', NULL, 'paid', '1793148444242.0'),
  ('o_42', 'seed_parent_nokid', NULL, 'vip', NULL, 1, 1, 0, 0, 0, 0, 0, NULL, 'partner', NULL, 'paid', '1793148444251.0'),
  ('o_44', 'seed_district', NULL, 'vip', NULL, 1, 1, 0, 0, 0, 0, 0, NULL, 'partner', NULL, 'paid', '1793148444258.0'),
  ('o_46', 'seed_city', NULL, 'vip', NULL, 1, 1, 0, 0, 0, 0, 0, NULL, 'partner', NULL, 'paid', '1793148444266.0'),
  ('o_48', 'seed_cofounder', NULL, 'cofounder', NULL, 1, 1, 0, 0, 0, 0, 0, NULL, 'partner', NULL, 'paid', '1793148448346.0'),
  ('o_50', 'seed_province', NULL, 'vip', NULL, 1, 1, 0, 0, 0, 0, 0, NULL, 'partner', NULL, 'paid', '1793148448356.0'),
  ('o_52', 'seed_store', NULL, 'vip', NULL, 1, 1, 0, 0, 0, 0, 0, NULL, 'partner', NULL, 'paid', '1793148448367.0'),
  ('o_54', 'seed_private', NULL, 'private', NULL, 1, 1, 0, 0, 0, 0, 0, NULL, 'partner', NULL, 'paid', '1793148448378.0'),
  ('o_56', 'seed_angel', NULL, 'angel', NULL, 1, 1, 0, 0, 0, 0, 0, NULL, 'partner', NULL, 'paid', '1793148448387.0'),
  ('o_58', 'seed_vip', NULL, 'vip', NULL, 1, 1, 0, 0, 0, 0, 0, NULL, 'partner', NULL, 'paid', '1793148448397.0'),
  ('o_60', 'seed_parent_cj', NULL, 'vip', NULL, 1, 1, 0, 0, 0, 0, 0, NULL, 'partner', NULL, 'paid', '1793148448405.0'),
  ('o_62', 'seed_parent_nokid', NULL, 'vip', NULL, 1, 1, 0, 0, 0, 0, 0, NULL, 'partner', NULL, 'paid', '1793148448415.0'),
  ('o_64', 'seed_district', NULL, 'vip', NULL, 1, 1, 0, 0, 0, 0, 0, NULL, 'partner', NULL, 'paid', '1793148448423.0'),
  ('o_66', 'seed_city', NULL, 'vip', NULL, 1, 1, 0, 0, 0, 0, 0, NULL, 'partner', NULL, 'paid', '1793148448432.0'),
  ('o_68', 'p4', NULL, 'vip', NULL, 1, 1, 0, 0, 0, 0, 0, '330110', 'partner', NULL, 'paid', '1793148453587.0'),
  ('o_70', 'p4', NULL, 'vip', NULL, 1, 1, 0, 0, 0, 0, 0, '330110', 'partner', NULL, 'paid', '1793148453903.0'),
  ('o_74', 'p4', NULL, 'vip', NULL, 1, 1, 0, 0, 0, 0, 0, '330110', 'partner', NULL, 'CANCELLED', '1793148454256.0'),
  ('o_76', 'u_7ncoc1', NULL, 'vip', NULL, 1, 1, 0, 0, 0, 0, 0, NULL, 'partner', NULL, 'paid', '1793148473566.0'),
  ('o_78', 'seed_cofounder', NULL, 'cofounder', NULL, 1, 1, 0, 0, 0, 0, 0, NULL, 'partner', NULL, 'paid', '1793148482804.0'),
  ('o_80', 'seed_province', NULL, 'vip', NULL, 1, 1, 0, 0, 0, 0, 0, NULL, 'partner', NULL, 'paid', '1793148482817.0'),
  ('o_82', 'seed_store', NULL, 'vip', NULL, 1, 1, 0, 0, 0, 0, 0, NULL, 'partner', NULL, 'paid', '1793148482830.0'),
  ('o_84', 'seed_private', NULL, 'private', NULL, 1, 1, 0, 0, 0, 0, 0, NULL, 'partner', NULL, 'paid', '1793148482840.0'),
  ('o_86', 'seed_angel', NULL, 'angel', NULL, 1, 1, 0, 0, 0, 0, 0, NULL, 'partner', NULL, 'paid', '1793148482851.0'),
  ('o_88', 'seed_vip', NULL, 'vip', NULL, 1, 1, 0, 0, 0, 0, 0, NULL, 'partner', NULL, 'paid', '1793148482860.0'),
  ('o_90', 'seed_parent_cj', NULL, 'vip', NULL, 1, 1, 0, 0, 0, 0, 0, NULL, 'partner', NULL, 'paid', '1793148482870.0'),
  ('o_92', 'seed_parent_nokid', NULL, 'vip', NULL, 1, 1, 0, 0, 0, 0, 0, NULL, 'partner', NULL, 'paid', '1793148482881.0'),
  ('o_94', 'seed_district', NULL, 'vip', NULL, 1, 1, 0, 0, 0, 0, 0, NULL, 'partner', NULL, 'paid', '1793148482890.0'),
  ('o_96', 'seed_city', NULL, 'vip', NULL, 1, 1, 0, 0, 0, 0, 0, NULL, 'partner', NULL, 'paid', '1793148482901.0'),
  ('o_98', 'p4', NULL, 'vip', NULL, 1, 1, 0, 0, 0, 0, 0, '330110', 'partner', NULL, 'paid', '1793148487174.0'),
  ('o_103', 'p4', NULL, 'vip', NULL, 1, 1, 0, 0, 0, 0, 0, '330110', 'partner', NULL, 'paid', '1793148490366.0'),
  ('o_107', 'p4', NULL, 'vip', NULL, 1, 1, 0, 0, 0, 0, 0, '330110', 'partner', NULL, 'paid', '1793148504738.0'),
  ('o_111', 'p4', NULL, 'vip', NULL, 1, 1, 0, 0, 0, 0, 0, '330110', 'partner', NULL, 'paid', '1793148516227.0'),
  ('o_119', 'seed_cofounder', NULL, 'cofounder', NULL, 1, 1, 0, 0, 0, 0, 0, NULL, 'partner', NULL, 'paid', '1793148570336.0'),
  ('o_121', 'seed_province', NULL, 'vip', NULL, 1, 1, 0, 0, 0, 0, 0, NULL, 'partner', NULL, 'paid', '1793148570352.0'),
  ('o_123', 'seed_store', NULL, 'vip', NULL, 1, 1, 0, 0, 0, 0, 0, NULL, 'partner', NULL, 'paid', '1793148570367.0'),
  ('o_125', 'seed_private', NULL, 'private', NULL, 1, 1, 0, 0, 0, 0, 0, NULL, 'partner', NULL, 'paid', '1793148570378.0'),
  ('o_127', 'seed_angel', NULL, 'angel', NULL, 1, 1, 0, 0, 0, 0, 0, NULL, 'partner', NULL, 'paid', '1793148570390.0'),
  ('o_129', 'seed_vip', NULL, 'vip', NULL, 1, 1, 0, 0, 0, 0, 0, NULL, 'partner', NULL, 'paid', '1793148570401.0'),
  ('o_131', 'seed_parent_cj', NULL, 'vip', NULL, 1, 1, 0, 0, 0, 0, 0, NULL, 'partner', NULL, 'paid', '1793148570412.0'),
  ('o_133', 'seed_parent_nokid', NULL, 'vip', NULL, 1, 1, 0, 0, 0, 0, 0, NULL, 'partner', NULL, 'paid', '1793148570423.0'),
  ('o_135', 'seed_district', NULL, 'vip', NULL, 1, 1, 0, 0, 0, 0, 0, NULL, 'partner', NULL, 'paid', '1793148570435.0'),
  ('o_137', 'seed_city', NULL, 'vip', NULL, 1, 1, 0, 0, 0, 0, 0, NULL, 'partner', NULL, 'paid', '1793148570446.0'),
  ('o_139', 'p4', NULL, 'vip', NULL, 1, 1, 0, 0, 0, 0, 0, '330110', 'partner', NULL, 'paid', '1793148570606.0'),
  ('o_145', 'p4', NULL, 'vip', NULL, 1, 1, 0, 0, 0, 0, 0, '330110', 'partner', NULL, 'paid', '1793148575813.0'),
  ('o_150', 'p4', NULL, 'vip', NULL, 1, 1, 0, 0, 0, 0, 0, '330110', 'partner', NULL, 'paid', '1793148576070.0'),
  ('o_154', 'p4', NULL, 'vip', NULL, 1, 1, 0, 0, 0, 0, 0, '330110', 'partner', NULL, 'CANCELLED', '1793148576413.0'),
  ('o_156', 'u_ys5utb', NULL, 'vip', NULL, 1, 1, 0, 0, 0, 0, 0, NULL, 'partner', NULL, 'paid', '1793148596611.0'),
  ('o_158', 'seed_cofounder', NULL, 'cofounder', NULL, 1, 1, 0, 0, 0, 0, 0, NULL, 'partner', NULL, 'paid', '1793148605968.0'),
  ('o_160', 'seed_province', NULL, 'vip', NULL, 1, 1, 0, 0, 0, 0, 0, NULL, 'partner', NULL, 'paid', '1793148605982.0'),
  ('o_162', 'seed_store', NULL, 'vip', NULL, 1, 1, 0, 0, 0, 0, 0, NULL, 'partner', NULL, 'paid', '1793148605995.0'),
  ('o_164', 'seed_private', NULL, 'private', NULL, 1, 1, 0, 0, 0, 0, 0, NULL, 'partner', NULL, 'paid', '1793148606007.0'),
  ('o_166', 'seed_angel', NULL, 'angel', NULL, 1, 1, 0, 0, 0, 0, 0, NULL, 'partner', NULL, 'paid', '1793148606019.0'),
  ('o_168', 'seed_vip', NULL, 'vip', NULL, 1, 1, 0, 0, 0, 0, 0, NULL, 'partner', NULL, 'paid', '1793148606031.0'),
  ('o_170', 'seed_parent_cj', NULL, 'vip', NULL, 1, 1, 0, 0, 0, 0, 0, NULL, 'partner', NULL, 'paid', '1793148606042.0'),
  ('o_172', 'seed_parent_nokid', NULL, 'vip', NULL, 1, 1, 0, 0, 0, 0, 0, NULL, 'partner', NULL, 'paid', '1793148606055.0'),
  ('o_174', 'seed_district', NULL, 'vip', NULL, 1, 1, 0, 0, 0, 0, 0, NULL, 'partner', NULL, 'paid', '1793148606067.0'),
  ('o_176', 'seed_city', NULL, 'vip', NULL, 1, 1, 0, 0, 0, 0, 0, NULL, 'partner', NULL, 'paid', '1793148606078.0');

INSERT INTO `payments` (`id`, `biz_type`, `biz_id`, `user_id`, `amount`, `channel`, `subject`, `status`, `transaction_id`, `idempotency_key`, `pay_params`, `meta`, `notify_raw`, `note`, `created_at`, `paid_at`) VALUES
  ('pay8ff9ll18', 'product_order', 'o_70', 'p4', 1040, 'wechat', '商品订单支付', 'PAID', 'sandbox_txcq0rabtn', 'bizloop-pay-1-rmvreai1x', '{"sandbox":true,"channel":"wechat","channelName":"微信支付","mode":"sandbox","autoPay":true,"note":"sandbox 免支付直通（正式环境由渠道 SDK 返回调起参数）","invoke":{"autoPay":true,"note":"sandbox 免支付直通（正式环境由渠道 SDK 返回调起参数）"}}', '{"orderId":"o_70"}', NULL, 'sandbox 免支付直通', '1793148453911.0', 1793148453911),
  ('paypmf1btdg', 'entitlement', NULL, 'u_7ncoc1', 200, 'wechat', '权益收益费（200 元/年）', 'PAID', 'sandbox_txxnqs6e03', 'ent-1793148473555', '{"sandbox":true,"channel":"wechat","channelName":"微信支付","mode":"sandbox","autoPay":true,"note":"sandbox 免支付直通（正式环境由渠道 SDK 返回调起参数）","invoke":{"autoPay":true,"note":"sandbox 免支付直通（正式环境由渠道 SDK 返回调起参数）"}}', '{}', NULL, 'sandbox 免支付直通', '1793148473555.0', 1793148473555),
  ('payphot5uyk', 'product_order', 'o_150', 'p4', 1040, 'wechat', '商品订单支付', 'PAID', 'sandbox_tx0bqniqb9', 'bizloop-pay-1-rmvred4bd', '{"sandbox":true,"channel":"wechat","channelName":"微信支付","mode":"sandbox","autoPay":true,"note":"sandbox 免支付直通（正式环境由渠道 SDK 返回调起参数）","invoke":{"autoPay":true,"note":"sandbox 免支付直通（正式环境由渠道 SDK 返回调起参数）"}}', '{"orderId":"o_150"}', NULL, 'sandbox 免支付直通', '1793148576080.0', 1793148576080),
  ('paygum4ftvi', 'entitlement', NULL, 'u_ys5utb', 200, 'wechat', '权益收益费（200 元/年）', 'PAID', 'sandbox_txpzhtt717', 'ent-1793148596599', '{"sandbox":true,"channel":"wechat","channelName":"微信支付","mode":"sandbox","autoPay":true,"note":"sandbox 免支付直通（正式环境由渠道 SDK 返回调起参数）","invoke":{"autoPay":true,"note":"sandbox 免支付直通（正式环境由渠道 SDK 返回调起参数）"}}', '{}', NULL, 'sandbox 免支付直通', '1793148596600.0', 1793148596600);

INSERT INTO `quota_activity_batches` (`id`, `user_id`, `qty`, `obtained_at`, `expire_at`) VALUES
  (1, 'p3', 4, '1793095807830.0', '1824631807830.0');

INSERT INTO `quota_ledger` (`user_id`, `standard`) VALUES
  ('p1', 500),
  ('p2', 200),
  ('p3', 97),
  ('p4', 51),
  ('p5', 197),
  ('p6', 103),
  ('p7', 102),
  ('u_7ncoc1', 0),
  ('u_ys5utb', 0);

INSERT INTO `quota_transactions` (`id`, `user_id`, `op`, `kind`, `used_standard`, `used_activity`, `amount`, `ref`, `operator_id`, `created_at`) VALUES
  (1, 'p3', 'issue', 'activity', 0, 4, 4, 'seed', NULL, '1793095807830.0'),
  (2, 'p3', 'consume', NULL, 0, 0, 0, 'o_1', NULL, '1793095807830.0'),
  (3, 'p5', 'consume', NULL, 0, 0, 0, 'o_5', NULL, '1793095807830.0'),
  (4, 'p3', 'consume', NULL, 0, 0, 0, 'o_8', NULL, '1793095807830.0');

INSERT INTO `quotes` (`id`, `scene`, `user_id`, `amount`, `breakdown`, `items`, `meta`, `rule_version`, `issued_at`, `expires_at`, `consumed`, `consumed_at`, `consumed_ref`) VALUES
  ('q_ptz4mvyqny7r', 'checkout', 'p1', 2094, '{"goodsAmount":2094,"discountAmount":4886,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793083576311, 1793084176311, 1, 1793083576315, 'o_17'),
  ('q_aoxxv8wbny7y', 'checkout', 'p1', 2094, '{"goodsAmount":2094,"discountAmount":4886,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793083576318, 1793084176318, 0, NULL, NULL),
  ('q_sphdpq4yny82', 'checkout', 'p1', 2094, '{"goodsAmount":2094,"discountAmount":4886,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793083576322, 1793084176322, 0, NULL, NULL),
  ('q_a9bvm7m8nyb9', 'entitlement', 'p1', 1980, '{"months":12}', '[{"key":"annual","qty":1}]', '{"planId":"annual"}', 1, 1793083576437, 1793084176437, 0, NULL, NULL),
  ('q_g3d42dc9nybb', 'quota_purchase', 'p1', 13000, '{"unitAmount":6500,"quantity":2}', '[{"key":"quota","qty":2}]', '{"quantity":2}', 1, 1793083576439, 1793084176439, 0, NULL, NULL),
  ('q_hqn86gkcnybd', 'upgrade', 'p1', 0, '{"partnerFee":0,"serviceFee":0}', '[{"key":"angel","qty":0}]', '{"targetLevel":"angel","targetAccountId":"p1"}', 1, 1793083576441, 1793084176441, 0, NULL, NULL),
  ('q_dldhm8zsnybf', 'store_binding', 'p1', 0, '{"storeId":"p6","targetAccountId":"p1"}', '[{"key":"store","qty":1,"storeId":"p6"}]', '{"storeId":"p6","targetAccountId":"p1"}', 1, 1793083576443, 1793084176443, 0, NULL, NULL),
  ('q_71gtc208nybg', 'quota_transfer', 'p1', 0, '{"quantity":1,"targetAccountId":"p4"}', '[{"key":"quota","qty":1,"targetAccountId":"p4"}]', '{"quantity":1,"targetAccountId":"p4"}', 1, 1793083576444, 1793084176444, 0, NULL, NULL),
  ('q_542eqyd4nybh', 'costore_application', 'p1', 8376, '{"monthlyFee":698,"months":12,"durationId":"12"}', '[{"key":"costore","qty":12,"storeId":"p6"}]', '{"storeId":"p6","durationId":"12","months":12}', 1, 1793083576445, 1793084176445, 0, NULL, NULL),
  ('q_yphlsen0nybj', 'agency_application', 'p1', 80000, '{"brandFee":40000,"extraFee":0,"deviceFee":20000,"depositFee":20000,"total":80000}', '[{"key":"agency","qty":1,"agencyType":"store","tierIndex":0}]', '{"agencyType":"store","tierIndex":0,"regionCodes":null}', 1, 1793083576447, 1793084176447, 0, NULL, NULL),
  ('q_9ukbzrjgnybl', 'entitlement', 'p1', 1980, '{"months":12}', '[{"key":"annual","qty":1}]', '{"planId":"annual"}', 1, 1793083576449, 1793084176449, 1, 1793083576451, 'payb99wksux'),
  ('q_wlszdyeenybp', 'checkout', 'p1', 2094, '{"goodsAmount":2094,"discountAmount":4886,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793083576453, 1793084176453, 0, NULL, NULL),
  ('q_cxgqpr93nybs', 'checkout', 'p1', 2094, '{"goodsAmount":2094,"discountAmount":4886,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793083576456, 1793084176456, 0, NULL, NULL),
  ('q_6k87rzyvnybu', 'checkout', 'p1', 2094, '{"goodsAmount":2094,"discountAmount":4886,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793083576458, 1793084176458, 1, 1793083576461, 'o_20'),
  ('q_6n9ht4gpnyby', 'upgrade', 'p1', 0, '{"partnerFee":0,"serviceFee":0}', '[{"key":"angel","qty":0}]', '{"targetLevel":"angel","targetAccountId":"p1"}', 1, 1793083576462, 1793084176462, 0, NULL, NULL),
  ('q_y54iu5sinybz', 'entitlement', 'p1', 1980, '{"months":12}', '[{"key":"annual","qty":1}]', '{"planId":"annual"}', 1, 1793083576463, 1793084176463, 0, NULL, NULL),
  ('q_s4ezi4o3nyc7', 'upgrade', 'p4', 23820, '{"partnerFee":19820,"serviceFee":4000}', '[{"key":"angel","qty":2}]', '{"targetLevel":"angel","targetAccountId":"p4"}', 1, 1793083576471, 1793084176471, 1, 1793083576474, 'o_24'),
  ('q_fc6n0xgdo0b6', 'checkout', 'p1', 4188, '{"goodsAmount":4188,"discountAmount":9772,"listAmount":13960}', '[{"key":"pad","qty":2}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793083579026, 1793084179026, 0, NULL, NULL),
  ('q_8pwuqanko0ef', 'entitlement', 'p1', 1980, '{"months":12}', '[{"key":"annual","qty":1}]', '{"planId":"annual"}', 1, 1793083579143, 1793084179143, 0, NULL, NULL),
  ('q_fwx018lso0eg', 'entitlement', 'p1', 1980, '{"months":12}', '[{"key":"annual","qty":1}]', '{"planId":"annual"}', 1, 1793083579144, 1793084179144, 1, 1793083579146, 'payj99vj992'),
  ('q_jw967zhko1th', 'checkout', 'p1', 4188, '{"goodsAmount":4188,"discountAmount":9772,"listAmount":13960}', '[{"key":"pad","qty":2}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793083580981, 1793084180981, 0, NULL, NULL),
  ('q_ja9pg9myv8zf', 'checkout', 'p1', 4537, '{"goodsAmount":4537,"discountAmount":2443,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793085596475, 1793086196475, 1, 1793085596480, 'o_17'),
  ('q_6cusepa2v8zn', 'checkout', 'p1', 4537, '{"goodsAmount":4537,"discountAmount":2443,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793085596483, 1793086196483, 0, NULL, NULL),
  ('q_ty5lgif9v8zr', 'checkout', 'p1', 4537, '{"goodsAmount":4537,"discountAmount":2443,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793085596487, 1793086196487, 0, NULL, NULL),
  ('q_rm5vufawv92x', 'entitlement', 'p1', 1980, '{"months":12}', '[{"key":"annual","qty":1}]', '{"planId":"annual"}', 1, 1793085596601, 1793086196601, 0, NULL, NULL),
  ('q_yxlhui7qv930', 'quota_purchase', 'p1', 13000, '{"unitAmount":6500,"quantity":2}', '[{"key":"quota","qty":2}]', '{"quantity":2}', 1, 1793085596604, 1793086196604, 0, NULL, NULL),
  ('q_n3b8o6gyv934', 'upgrade', 'p1', 0, '{"partnerFee":0,"serviceFee":0}', '[{"key":"angel","qty":0}]', '{"targetLevel":"angel","targetAccountId":"p1"}', 1, 1793085596608, 1793086196608, 0, NULL, NULL),
  ('q_hjqy2iyyv936', 'store_binding', 'p1', 0, '{"storeId":"p6","targetAccountId":"p1"}', '[{"key":"store","qty":1,"storeId":"p6"}]', '{"storeId":"p6","targetAccountId":"p1"}', 1, 1793085596610, 1793086196610, 0, NULL, NULL),
  ('q_9sxnf17pv937', 'quota_transfer', 'p1', 0, '{"quantity":1,"targetAccountId":"p4"}', '[{"key":"quota","qty":1,"targetAccountId":"p4"}]', '{"quantity":1,"targetAccountId":"p4"}', 1, 1793085596611, 1793086196611, 0, NULL, NULL),
  ('q_obolj06rv939', 'costore_application', 'p1', 8376, '{"monthlyFee":698,"months":12,"durationId":"12"}', '[{"key":"costore","qty":12,"storeId":"p6"}]', '{"storeId":"p6","durationId":"12","months":12}', 1, 1793085596613, 1793086196613, 0, NULL, NULL),
  ('q_1blg5atxv93b', 'agency_application', 'p1', 80000, '{"brandFee":40000,"extraFee":0,"deviceFee":20000,"depositFee":20000,"total":80000}', '[{"key":"agency","qty":1,"agencyType":"store","tierIndex":0}]', '{"agencyType":"store","tierIndex":0,"regionCodes":null}', 1, 1793085596615, 1793086196615, 0, NULL, NULL),
  ('q_n6yqhqxyv93d', 'entitlement', 'p1', 1980, '{"months":12}', '[{"key":"annual","qty":1}]', '{"planId":"annual"}', 1, 1793085596617, 1793086196617, 1, 1793085596619, 'payq1rj68zl'),
  ('q_m5f7iyajv93h', 'checkout', 'p1', 4537, '{"goodsAmount":4537,"discountAmount":2443,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793085596621, 1793086196621, 0, NULL, NULL),
  ('q_gduskx0iv93k', 'checkout', 'p1', 4537, '{"goodsAmount":4537,"discountAmount":2443,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793085596624, 1793086196624, 0, NULL, NULL),
  ('q_ky6b5ye3v93m', 'checkout', 'p1', 4537, '{"goodsAmount":4537,"discountAmount":2443,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793085596626, 1793086196626, 1, 1793085596629, 'o_20'),
  ('q_cep63hg1v93r', 'upgrade', 'p1', 0, '{"partnerFee":0,"serviceFee":0}', '[{"key":"angel","qty":0}]', '{"targetLevel":"angel","targetAccountId":"p1"}', 1, 1793085596631, 1793086196631, 0, NULL, NULL),
  ('q_ndrriv9zv93t', 'entitlement', 'p1', 1980, '{"months":12}', '[{"key":"annual","qty":1}]', '{"planId":"annual"}', 1, 1793085596633, 1793086196633, 0, NULL, NULL),
  ('q_2jgpr0dqv941', 'upgrade', 'p4', 23820, '{"partnerFee":19820,"serviceFee":4000}', '[{"key":"angel","qty":2}]', '{"targetLevel":"angel","targetAccountId":"p4"}', 1, 1793085596641, 1793086196641, 1, 1793085596644, 'o_24'),
  ('q_63dcswvkvb5h', 'checkout', 'p1', 9074, '{"goodsAmount":9074,"discountAmount":4886,"listAmount":13960}', '[{"key":"pad","qty":2}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793085599285, 1793086199285, 0, NULL, NULL),
  ('q_pkz9dl7kvb8q', 'entitlement', 'p1', 1980, '{"months":12}', '[{"key":"annual","qty":1}]', '{"planId":"annual"}', 1, 1793085599402, 1793086199402, 0, NULL, NULL),
  ('q_e01wdhtlvb8r', 'entitlement', 'p1', 1980, '{"months":12}', '[{"key":"annual","qty":1}]', '{"planId":"annual"}', 1, 1793085599403, 1793086199403, 1, 1793085599405, 'payw8x1l499'),
  ('q_zs5bn6w6vcm2', 'checkout', 'p1', 9074, '{"goodsAmount":9074,"discountAmount":4886,"listAmount":13960}', '[{"key":"pad","qty":2}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793085601178, 1793086201178, 0, NULL, NULL),
  ('q_yh0w18upvcoa', 'checkout', 'p1', 2094, '{"goodsAmount":2094,"discountAmount":4886,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"memberLevel":"normal","skuId":null}', 1, 1793087280874, 1793087880874, 1, 1793087280879, 'o_17'),
  ('q_ccgcflf2vcoj', 'checkout', 'p1', 2094, '{"goodsAmount":2094,"discountAmount":4886,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"memberLevel":"normal","skuId":null}', 1, 1793087280883, 1793087880883, 0, NULL, NULL),
  ('q_gz0ziymgvcon', 'checkout', 'p1', 2094, '{"goodsAmount":2094,"discountAmount":4886,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"memberLevel":"normal","skuId":null}', 1, 1793087280887, 1793087880887, 0, NULL, NULL),
  ('q_amsump5bvcrw', 'entitlement', 'p1', 1980, '{"months":12}', '[{"key":"annual","qty":1}]', '{"planId":"annual"}', 1, 1793087281004, 1793087881004, 0, NULL, NULL),
  ('q_tewk7gp2vcs0', 'quota_purchase', 'p1', 13000, '{"unitAmount":6500,"quantity":2}', '[{"key":"quota","qty":2}]', '{"quantity":2}', 1, 1793087281008, 1793087881008, 0, NULL, NULL),
  ('q_vwsyxn5avcs3', 'upgrade', 'p1', 0, '{"partnerFee":0,"serviceFee":0}', '[{"key":"angel","qty":0}]', '{"targetLevel":"angel","targetAccountId":"p1"}', 1, 1793087281011, 1793087881011, 0, NULL, NULL),
  ('q_8q95kcjfvcs6', 'store_binding', 'p1', 0, '{"storeId":"p6","targetAccountId":"p1"}', '[{"key":"store","qty":1,"storeId":"p6"}]', '{"storeId":"p6","targetAccountId":"p1"}', 1, 1793087281014, 1793087881014, 0, NULL, NULL),
  ('q_6jmxmkbrvcs7', 'quota_transfer', 'p1', 0, '{"quantity":1,"targetAccountId":"p4"}', '[{"key":"quota","qty":1,"targetAccountId":"p4"}]', '{"quantity":1,"targetAccountId":"p4"}', 1, 1793087281015, 1793087881015, 0, NULL, NULL),
  ('q_n18l27qgvcs8', 'costore_application', 'p1', 8376, '{"monthlyFee":698,"months":12,"durationId":"12"}', '[{"key":"costore","qty":12,"storeId":"p6"}]', '{"storeId":"p6","durationId":"12","months":12}', 1, 1793087281016, 1793087881016, 0, NULL, NULL),
  ('q_wyin1p9uvcsb', 'agency_application', 'p1', 80000, '{"brandFee":40000,"extraFee":0,"deviceFee":20000,"depositFee":20000,"total":80000}', '[{"key":"agency","qty":1,"agencyType":"store","tierIndex":0}]', '{"agencyType":"store","tierIndex":0,"regionCodes":null}', 1, 1793087281019, 1793087881019, 0, NULL, NULL),
  ('q_xxpicm8nvcsc', 'entitlement', 'p1', 1980, '{"months":12}', '[{"key":"annual","qty":1}]', '{"planId":"annual"}', 1, 1793087281020, 1793087881020, 1, 1793087281022, 'pay1rt1opzo'),
  ('q_tp8r206tvcsg', 'checkout', 'p1', 2094, '{"goodsAmount":2094,"discountAmount":4886,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"memberLevel":"normal","skuId":null}', 1, 1793087281024, 1793087881024, 0, NULL, NULL),
  ('q_3iokmmg2vcsi', 'checkout', 'p1', 2094, '{"goodsAmount":2094,"discountAmount":4886,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"memberLevel":"normal","skuId":null}', 1, 1793087281026, 1793087881026, 0, NULL, NULL),
  ('q_wh91mbwmvcsl', 'checkout', 'p1', 2094, '{"goodsAmount":2094,"discountAmount":4886,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"memberLevel":"normal","skuId":null}', 1, 1793087281029, 1793087881029, 1, 1793087281033, 'o_20'),
  ('q_buas2gdcvcsq', 'upgrade', 'p1', 0, '{"partnerFee":0,"serviceFee":0}', '[{"key":"angel","qty":0}]', '{"targetLevel":"angel","targetAccountId":"p1"}', 1, 1793087281034, 1793087881034, 0, NULL, NULL),
  ('q_awug8ejivcsr', 'entitlement', 'p1', 1980, '{"months":12}', '[{"key":"annual","qty":1}]', '{"planId":"annual"}', 1, 1793087281035, 1793087881035, 0, NULL, NULL),
  ('q_3az8gv0cvcsz', 'upgrade', 'p4', 23820, '{"partnerFee":19820,"serviceFee":4000}', '[{"key":"angel","qty":2}]', '{"targetLevel":"angel","targetAccountId":"p4"}', 1, 1793087281043, 1793087881043, 1, 1793087281046, 'o_24'),
  ('q_gj05z5ofveug', 'checkout', 'p1', 4188, '{"goodsAmount":4188,"discountAmount":9772,"listAmount":13960}', '[{"key":"pad","qty":2}]', '{"productKey":"pad","level":null,"memberId":null,"memberLevel":"normal","skuId":null}', 1, 1793087283688, 1793087883688, 0, NULL, NULL),
  ('q_vmetvhq6vexp', 'entitlement', 'p1', 1980, '{"months":12}', '[{"key":"annual","qty":1}]', '{"planId":"annual"}', 1, 1793087283805, 1793087883805, 0, NULL, NULL),
  ('q_y0vggvszvexr', 'entitlement', 'p1', 1980, '{"months":12}', '[{"key":"annual","qty":1}]', '{"planId":"annual"}', 1, 1793087283807, 1793087883807, 1, 1793087283809, 'payqs4a7tdn'),
  ('q_4q7mhlp5vgb5', 'checkout', 'p1', 4188, '{"goodsAmount":4188,"discountAmount":9772,"listAmount":13960}', '[{"key":"pad","qty":2}]', '{"productKey":"pad","level":null,"memberId":null,"memberLevel":"normal","skuId":null}', 1, 1793087285585, 1793087885585, 0, NULL, NULL),
  ('q_hx2k7hmayep3', 'checkout', 'p1', 2094, '{"goodsAmount":2094,"discountAmount":4886,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"memberLevel":"normal","skuId":null}', 1, 1793087423463, 1793088023463, 1, 1793087423468, 'o_17'),
  ('q_fx6hak0tyepc', 'checkout', 'p1', 2094, '{"goodsAmount":2094,"discountAmount":4886,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"memberLevel":"normal","skuId":null}', 1, 1793087423472, 1793088023472, 0, NULL, NULL),
  ('q_ks3mfy8ayepf', 'checkout', 'p1', 2094, '{"goodsAmount":2094,"discountAmount":4886,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"memberLevel":"normal","skuId":null}', 1, 1793087423475, 1793088023475, 0, NULL, NULL),
  ('q_6b1v1rizyesp', 'entitlement', 'p1', 1980, '{"months":12}', '[{"key":"annual","qty":1}]', '{"planId":"annual"}', 1, 1793087423593, 1793088023593, 0, NULL, NULL),
  ('q_l36fqvsvyest', 'quota_purchase', 'p1', 13000, '{"unitAmount":6500,"quantity":2}', '[{"key":"quota","qty":2}]', '{"quantity":2}', 1, 1793087423597, 1793088023597, 0, NULL, NULL),
  ('q_5ng43jk4yesx', 'upgrade', 'p1', 0, '{"partnerFee":0,"serviceFee":0}', '[{"key":"angel","qty":0}]', '{"targetLevel":"angel","targetAccountId":"p1"}', 1, 1793087423601, 1793088023601, 0, NULL, NULL),
  ('q_g09uij7gyesy', 'store_binding', 'p1', 0, '{"storeId":"p6","targetAccountId":"p1"}', '[{"key":"store","qty":1,"storeId":"p6"}]', '{"storeId":"p6","targetAccountId":"p1"}', 1, 1793087423602, 1793088023602, 0, NULL, NULL),
  ('q_8b4sq8nbyet0', 'quota_transfer', 'p1', 0, '{"quantity":1,"targetAccountId":"p4"}', '[{"key":"quota","qty":1,"targetAccountId":"p4"}]', '{"quantity":1,"targetAccountId":"p4"}', 1, 1793087423604, 1793088023604, 0, NULL, NULL),
  ('q_xyhy3vayyet1', 'costore_application', 'p1', 8376, '{"monthlyFee":698,"months":12,"durationId":"12"}', '[{"key":"costore","qty":12,"storeId":"p6"}]', '{"storeId":"p6","durationId":"12","months":12}', 1, 1793087423605, 1793088023605, 0, NULL, NULL),
  ('q_k0dg1kjgyet4', 'agency_application', 'p1', 80000, '{"brandFee":40000,"extraFee":0,"deviceFee":20000,"depositFee":20000,"total":80000}', '[{"key":"agency","qty":1,"agencyType":"store","tierIndex":0}]', '{"agencyType":"store","tierIndex":0,"regionCodes":null}', 1, 1793087423608, 1793088023608, 0, NULL, NULL),
  ('q_3bxyltqbyet5', 'entitlement', 'p1', 1980, '{"months":12}', '[{"key":"annual","qty":1}]', '{"planId":"annual"}', 1, 1793087423609, 1793088023609, 1, 1793087423611, 'pay6jg4i5i6'),
  ('q_a8msiyabyeta', 'checkout', 'p1', 2094, '{"goodsAmount":2094,"discountAmount":4886,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"memberLevel":"normal","skuId":null}', 1, 1793087423614, 1793088023614, 0, NULL, NULL),
  ('q_56z29gl3yetd', 'checkout', 'p1', 2094, '{"goodsAmount":2094,"discountAmount":4886,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"memberLevel":"normal","skuId":null}', 1, 1793087423617, 1793088023617, 0, NULL, NULL),
  ('q_2n1iuamgyetf', 'checkout', 'p1', 2094, '{"goodsAmount":2094,"discountAmount":4886,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"memberLevel":"normal","skuId":null}', 1, 1793087423619, 1793088023619, 1, 1793087423623, 'o_20'),
  ('q_x5gavkm2yetl', 'upgrade', 'p1', 0, '{"partnerFee":0,"serviceFee":0}', '[{"key":"angel","qty":0}]', '{"targetLevel":"angel","targetAccountId":"p1"}', 1, 1793087423625, 1793088023625, 0, NULL, NULL),
  ('q_6sbe2xklyetm', 'entitlement', 'p1', 1980, '{"months":12}', '[{"key":"annual","qty":1}]', '{"planId":"annual"}', 1, 1793087423626, 1793088023626, 0, NULL, NULL),
  ('q_5vrdywesyetv', 'upgrade', 'p4', 23820, '{"partnerFee":19820,"serviceFee":4000}', '[{"key":"angel","qty":2}]', '{"targetLevel":"angel","targetAccountId":"p4"}', 1, 1793087423635, 1793088023635, 1, 1793087423639, 'o_24'),
  ('q_2h7dv4frygvg', 'checkout', 'p1', 4188, '{"goodsAmount":4188,"discountAmount":9772,"listAmount":13960}', '[{"key":"pad","qty":2}]', '{"productKey":"pad","level":null,"memberId":null,"memberLevel":"normal","skuId":null}', 1, 1793087426284, 1793088026284, 0, NULL, NULL),
  ('q_sbh526b5ygyr', 'entitlement', 'p1', 1980, '{"months":12}', '[{"key":"annual","qty":1}]', '{"planId":"annual"}', 1, 1793087426403, 1793088026403, 0, NULL, NULL),
  ('q_7nw30rbeygys', 'entitlement', 'p1', 1980, '{"months":12}', '[{"key":"annual","qty":1}]', '{"planId":"annual"}', 1, 1793087426404, 1793088026404, 1, 1793087426406, 'pay0qnqrix5'),
  ('q_m1pxsf0ryiev', 'checkout', 'p1', 4188, '{"goodsAmount":4188,"discountAmount":9772,"listAmount":13960}', '[{"key":"pad","qty":2}]', '{"productKey":"pad","level":null,"memberId":null,"memberLevel":"normal","skuId":null}', 1, 1793087428279, 1793088028279, 0, NULL, NULL),
  ('q_tyyuwrsb70k2', 'checkout', 'p1', 2094, '{"goodsAmount":2094,"discountAmount":4886,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"memberLevel":"normal","skuId":null}', 1, 1793087825042, 1793088425042, 1, 1793087825048, 'o_17'),
  ('q_7zevq0uf70kb', 'checkout', 'p1', 2094, '{"goodsAmount":2094,"discountAmount":4886,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"memberLevel":"normal","skuId":null}', 1, 1793087825051, 1793088425051, 0, NULL, NULL),
  ('q_pwuzutrx70kf', 'checkout', 'p1', 2094, '{"goodsAmount":2094,"discountAmount":4886,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"memberLevel":"normal","skuId":null}', 1, 1793087825055, 1793088425055, 0, NULL, NULL),
  ('q_p222swnm70nq', 'entitlement', 'p1', 1980, '{"months":12}', '[{"key":"annual","qty":1}]', '{"planId":"annual"}', 1, 1793087825174, 1793088425174, 0, NULL, NULL),
  ('q_2pw7wymy70nu', 'quota_purchase', 'p1', 13000, '{"unitAmount":6500,"quantity":2}', '[{"key":"quota","qty":2}]', '{"quantity":2}', 1, 1793087825178, 1793088425178, 0, NULL, NULL),
  ('q_3drwqwfw70nx', 'upgrade', 'p1', 0, '{"partnerFee":0,"serviceFee":0}', '[{"key":"angel","qty":0}]', '{"targetLevel":"angel","targetAccountId":"p1"}', 1, 1793087825181, 1793088425181, 0, NULL, NULL),
  ('q_m1oko09370nz', 'store_binding', 'p1', 0, '{"storeId":"p6","targetAccountId":"p1"}', '[{"key":"store","qty":1,"storeId":"p6"}]', '{"storeId":"p6","targetAccountId":"p1"}', 1, 1793087825183, 1793088425183, 0, NULL, NULL),
  ('q_ma7pn1ph70o1', 'quota_transfer', 'p1', 0, '{"quantity":1,"targetAccountId":"p4"}', '[{"key":"quota","qty":1,"targetAccountId":"p4"}]', '{"quantity":1,"targetAccountId":"p4"}', 1, 1793087825185, 1793088425185, 0, NULL, NULL),
  ('q_u7938f1d70o3', 'costore_application', 'p1', 8376, '{"monthlyFee":698,"months":12,"durationId":"12"}', '[{"key":"costore","qty":12,"storeId":"p6"}]', '{"storeId":"p6","durationId":"12","months":12}', 1, 1793087825187, 1793088425187, 0, NULL, NULL),
  ('q_cqf1ao3q70o6', 'agency_application', 'p1', 80000, '{"brandFee":40000,"extraFee":0,"deviceFee":20000,"depositFee":20000,"total":80000}', '[{"key":"agency","qty":1,"agencyType":"store","tierIndex":0}]', '{"agencyType":"store","tierIndex":0,"regionCodes":null}', 1, 1793087825190, 1793088425190, 0, NULL, NULL),
  ('q_1tvhlb3y70o7', 'entitlement', 'p1', 1980, '{"months":12}', '[{"key":"annual","qty":1}]', '{"planId":"annual"}', 1, 1793087825191, 1793088425191, 1, 1793087825193, 'paykvhwu6mk'),
  ('q_3qq3gtad70oc', 'checkout', 'p1', 2094, '{"goodsAmount":2094,"discountAmount":4886,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"memberLevel":"normal","skuId":null}', 1, 1793087825196, 1793088425196, 0, NULL, NULL),
  ('q_zgksrkhg70of', 'checkout', 'p1', 2094, '{"goodsAmount":2094,"discountAmount":4886,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"memberLevel":"normal","skuId":null}', 1, 1793087825199, 1793088425199, 0, NULL, NULL),
  ('q_241uj4dz70oh', 'checkout', 'p1', 2094, '{"goodsAmount":2094,"discountAmount":4886,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"memberLevel":"normal","skuId":null}', 1, 1793087825201, 1793088425201, 1, 1793087825205, 'o_20'),
  ('q_5k3p9fpu70on', 'upgrade', 'p1', 0, '{"partnerFee":0,"serviceFee":0}', '[{"key":"angel","qty":0}]', '{"targetLevel":"angel","targetAccountId":"p1"}', 1, 1793087825207, 1793088425207, 0, NULL, NULL),
  ('q_k4eet2fh70op', 'entitlement', 'p1', 1980, '{"months":12}', '[{"key":"annual","qty":1}]', '{"planId":"annual"}', 1, 1793087825209, 1793088425209, 0, NULL, NULL),
  ('q_neq2x6zs70oz', 'upgrade', 'p4', 23820, '{"partnerFee":19820,"serviceFee":4000}', '[{"key":"angel","qty":2}]', '{"targetLevel":"angel","targetAccountId":"p4"}', 1, 1793087825219, 1793088425219, 1, 1793087825223, 'o_24'),
  ('q_u3pdyf9072mn', 'checkout', 'p1', 4188, '{"goodsAmount":4188,"discountAmount":9772,"listAmount":13960}', '[{"key":"pad","qty":2}]', '{"productKey":"pad","level":null,"memberId":null,"memberLevel":"normal","skuId":null}', 1, 1793087827727, 1793088427727, 0, NULL, NULL),
  ('q_mc3yo5ni72q0', 'entitlement', 'p1', 1980, '{"months":12}', '[{"key":"annual","qty":1}]', '{"planId":"annual"}', 1, 1793087827848, 1793088427848, 0, NULL, NULL),
  ('q_ayycf9dp72q2', 'entitlement', 'p1', 1980, '{"months":12}', '[{"key":"annual","qty":1}]', '{"planId":"annual"}', 1, 1793087827850, 1793088427850, 1, 1793087827852, 'pay0oxu0raf'),
  ('q_ia0yqaax73r8', 'checkout', 'p1', 4188, '{"goodsAmount":4188,"discountAmount":9772,"listAmount":13960}', '[{"key":"pad","qty":2}]', '{"productKey":"pad","level":null,"memberId":null,"memberLevel":"normal","skuId":null}', 1, 1793087829188, 1793088429188, 0, NULL, NULL),
  ('q_gf0udryuh7gr', 'checkout', 'p1', 2094, '{"goodsAmount":2094,"discountAmount":4886,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793088300555, 1793088900555, 1, 1793088300560, 'o_17'),
  ('q_1g4vq24dh7h1', 'checkout', 'p1', 2094, '{"goodsAmount":2094,"discountAmount":4886,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793088300565, 1793088900565, 0, NULL, NULL),
  ('q_84ba4zgqh7h4', 'checkout', 'p1', 2094, '{"goodsAmount":2094,"discountAmount":4886,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793088300568, 1793088900568, 0, NULL, NULL),
  ('q_bhf3zfj3h7kd', 'entitlement', 'p1', 1980, '{"months":12}', '[{"key":"annual","qty":1}]', '{"planId":"annual"}', 1, 1793088300685, 1793088900685, 0, NULL, NULL),
  ('q_y3e0twnnh7ki', 'quota_purchase', 'p1', 13000, '{"unitAmount":6500,"quantity":2}', '[{"key":"quota","qty":2}]', '{"quantity":2}', 1, 1793088300690, 1793088900690, 0, NULL, NULL),
  ('q_ca3k7wmzh7km', 'upgrade', 'p1', 0, '{"partnerFee":0,"serviceFee":0}', '[{"key":"angel","qty":0}]', '{"targetLevel":"angel","targetAccountId":"p1"}', 1, 1793088300694, 1793088900694, 0, NULL, NULL),
  ('q_k729svmmh7ko', 'store_binding', 'p1', 0, '{"storeId":"p6","targetAccountId":"p1"}', '[{"key":"store","qty":1,"storeId":"p6"}]', '{"storeId":"p6","targetAccountId":"p1"}', 1, 1793088300696, 1793088900696, 0, NULL, NULL),
  ('q_gfvaoq02h7kq', 'quota_transfer', 'p1', 0, '{"quantity":1,"targetAccountId":"p4"}', '[{"key":"quota","qty":1,"targetAccountId":"p4"}]', '{"quantity":1,"targetAccountId":"p4"}', 1, 1793088300698, 1793088900698, 0, NULL, NULL),
  ('q_y4m7pmv2h7ks', 'costore_application', 'p1', 8376, '{"monthlyFee":698,"months":12,"durationId":"12"}', '[{"key":"costore","qty":12,"storeId":"p6"}]', '{"storeId":"p6","durationId":"12","months":12}', 1, 1793088300700, 1793088900700, 0, NULL, NULL),
  ('q_qwacf1efh7ku', 'agency_application', 'p1', 80000, '{"brandFee":40000,"extraFee":0,"deviceFee":20000,"depositFee":20000,"total":80000}', '[{"key":"agency","qty":1,"agencyType":"store","tierIndex":0}]', '{"agencyType":"store","tierIndex":0,"regionCodes":null}', 1, 1793088300702, 1793088900702, 0, NULL, NULL),
  ('q_zdg5z92oh7kx', 'entitlement', 'p1', 1980, '{"months":12}', '[{"key":"annual","qty":1}]', '{"planId":"annual"}', 1, 1793088300705, 1793088900705, 1, 1793088300707, 'payp0tsr96w'),
  ('q_gwuknfeqh7l2', 'checkout', 'p1', 2094, '{"goodsAmount":2094,"discountAmount":4886,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793088300710, 1793088900710, 0, NULL, NULL),
  ('q_48lprue1h7l5', 'checkout', 'p1', 2094, '{"goodsAmount":2094,"discountAmount":4886,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793088300713, 1793088900713, 0, NULL, NULL),
  ('q_napa0sx2h7l7', 'checkout', 'p1', 2094, '{"goodsAmount":2094,"discountAmount":4886,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793088300715, 1793088900715, 1, 1793088300718, 'o_20'),
  ('q_12qtdqfqh7lc', 'upgrade', 'p1', 0, '{"partnerFee":0,"serviceFee":0}', '[{"key":"angel","qty":0}]', '{"targetLevel":"angel","targetAccountId":"p1"}', 1, 1793088300720, 1793088900720, 0, NULL, NULL),
  ('q_thmcahnhh7le', 'entitlement', 'p1', 1980, '{"months":12}', '[{"key":"annual","qty":1}]', '{"planId":"annual"}', 1, 1793088300722, 1793088900722, 0, NULL, NULL),
  ('q_l67wwy0rh7ln', 'upgrade', 'p4', 23820, '{"partnerFee":19820,"serviceFee":4000}', '[{"key":"angel","qty":2}]', '{"targetLevel":"angel","targetAccountId":"p4"}', 1, 1793088300731, 1793088900731, 1, 1793088300735, 'o_24'),
  ('q_52guiqcgh9mp', 'checkout', 'p1', 4188, '{"goodsAmount":4188,"discountAmount":9772,"listAmount":13960}', '[{"key":"pad","qty":2}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793088303361, 1793088903361, 0, NULL, NULL),
  ('q_1vp2qz0dh9q0', 'entitlement', 'p1', 1980, '{"months":12}', '[{"key":"annual","qty":1}]', '{"planId":"annual"}', 1, 1793088303480, 1793088903480, 0, NULL, NULL),
  ('q_i8t5vx90h9q2', 'entitlement', 'p1', 1980, '{"months":12}', '[{"key":"annual","qty":1}]', '{"planId":"annual"}', 1, 1793088303482, 1793088903482, 1, 1793088303485, 'payxforc98q'),
  ('q_rmjppfnwhb4v', 'checkout', 'p1', 4188, '{"goodsAmount":4188,"discountAmount":9772,"listAmount":13960}', '[{"key":"pad","qty":2}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793088305310, 1793088905310, 0, NULL, NULL),
  ('q_jfxkd4ejki94', 'checkout', 'p1', 2094, '{"goodsAmount":2094,"discountAmount":4886,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793088454504, 1793089054504, 1, 1793088454509, 'o_17'),
  ('q_fmfk0ztwki9d', 'checkout', 'p1', 2094, '{"goodsAmount":2094,"discountAmount":4886,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793088454513, 1793089054513, 0, NULL, NULL),
  ('q_fxc7zd3fki9h', 'checkout', 'p1', 2094, '{"goodsAmount":2094,"discountAmount":4886,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793088454517, 1793089054517, 0, NULL, NULL),
  ('q_d5mcrammkicp', 'entitlement', 'p1', 1980, '{"months":12}', '[{"key":"annual","qty":1}]', '{"planId":"annual"}', 1, 1793088454633, 1793089054633, 0, NULL, NULL),
  ('q_pzlrwyxckict', 'quota_purchase', 'p1', 13000, '{"unitAmount":6500,"quantity":2}', '[{"key":"quota","qty":2}]', '{"quantity":2}', 1, 1793088454637, 1793089054637, 0, NULL, NULL),
  ('q_uuekk411kicv', 'upgrade', 'p1', 0, '{"partnerFee":0,"serviceFee":0}', '[{"key":"angel","qty":0}]', '{"targetLevel":"angel","targetAccountId":"p1"}', 1, 1793088454639, 1793089054639, 0, NULL, NULL),
  ('q_b15ts14pkicx', 'store_binding', 'p1', 0, '{"storeId":"p6","targetAccountId":"p1"}', '[{"key":"store","qty":1,"storeId":"p6"}]', '{"storeId":"p6","targetAccountId":"p1"}', 1, 1793088454641, 1793089054641, 0, NULL, NULL),
  ('q_j8xnwmf5kicz', 'quota_transfer', 'p1', 0, '{"quantity":1,"targetAccountId":"p4"}', '[{"key":"quota","qty":1,"targetAccountId":"p4"}]', '{"quantity":1,"targetAccountId":"p4"}', 1, 1793088454643, 1793089054643, 0, NULL, NULL),
  ('q_dk99fh5gkid1', 'costore_application', 'p1', 8376, '{"monthlyFee":698,"months":12,"durationId":"12"}', '[{"key":"costore","qty":12,"storeId":"p6"}]', '{"storeId":"p6","durationId":"12","months":12}', 1, 1793088454645, 1793089054645, 0, NULL, NULL),
  ('q_nvbijjxpkid4', 'agency_application', 'p1', 80000, '{"brandFee":40000,"extraFee":0,"deviceFee":20000,"depositFee":20000,"total":80000}', '[{"key":"agency","qty":1,"agencyType":"store","tierIndex":0}]', '{"agencyType":"store","tierIndex":0,"regionCodes":null}', 1, 1793088454648, 1793089054648, 0, NULL, NULL),
  ('q_skx1006gkid6', 'entitlement', 'p1', 1980, '{"months":12}', '[{"key":"annual","qty":1}]', '{"planId":"annual"}', 1, 1793088454650, 1793089054650, 1, 1793088454652, 'paya2u3lhk6'),
  ('q_ahrpp5olkidb', 'checkout', 'p1', 2094, '{"goodsAmount":2094,"discountAmount":4886,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793088454655, 1793089054655, 0, NULL, NULL),
  ('q_jq8fmib6kide', 'checkout', 'p1', 2094, '{"goodsAmount":2094,"discountAmount":4886,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793088454658, 1793089054658, 0, NULL, NULL),
  ('q_09y85ksdkidg', 'checkout', 'p1', 2094, '{"goodsAmount":2094,"discountAmount":4886,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793088454660, 1793089054660, 1, 1793088454664, 'o_20'),
  ('q_i4fcvppukidm', 'upgrade', 'p1', 0, '{"partnerFee":0,"serviceFee":0}', '[{"key":"angel","qty":0}]', '{"targetLevel":"angel","targetAccountId":"p1"}', 1, 1793088454666, 1793089054666, 0, NULL, NULL),
  ('q_rq2fr96nkido', 'entitlement', 'p1', 1980, '{"months":12}', '[{"key":"annual","qty":1}]', '{"planId":"annual"}', 1, 1793088454668, 1793089054668, 0, NULL, NULL),
  ('q_aminfeedkidx', 'upgrade', 'p4', 23820, '{"partnerFee":19820,"serviceFee":4000}', '[{"key":"angel","qty":2}]', '{"targetLevel":"angel","targetAccountId":"p4"}', 1, 1793088454677, 1793089054677, 1, 1793088454682, 'o_24'),
  ('q_w2elf57pkk9r', 'checkout', 'p1', 4188, '{"goodsAmount":4188,"discountAmount":9772,"listAmount":13960}', '[{"key":"pad","qty":2}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793088457119, 1793089057119, 0, NULL, NULL),
  ('q_5npeo2hmkkd2', 'entitlement', 'p1', 1980, '{"months":12}', '[{"key":"annual","qty":1}]', '{"planId":"annual"}', 1, 1793088457238, 1793089057238, 0, NULL, NULL),
  ('q_mzwfgof0kkd4', 'entitlement', 'p1', 1980, '{"months":12}', '[{"key":"annual","qty":1}]', '{"planId":"annual"}', 1, 1793088457240, 1793089057240, 1, 1793088457242, 'payd5wladgw'),
  ('q_homdw7v9kl87', 'checkout', 'p1', 4188, '{"goodsAmount":4188,"discountAmount":9772,"listAmount":13960}', '[{"key":"pad","qty":2}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793088458359, 1793089058359, 0, NULL, NULL),
  ('q_w3zwdevvzdz9', 'checkout', 'u_abo8kl', 5584, '{"goodsAmount":5584,"discountAmount":1396,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793089148805, 1793089748805, 1, 1793089148811, 'o_16'),
  ('q_upvej13r19g9', 'checkout', 'u_lodddv', 5584, '{"goodsAmount":5584,"discountAmount":1396,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793089236249, 1793089836249, 1, 1793089236253, 'o_18'),
  ('q_frfmgssu3kis', 'checkout', 'u_v5ys6s', 5584, '{"goodsAmount":5584,"discountAmount":1396,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793089343908, 1793089943908, 1, 1793089343912, 'o_20'),
  ('q_qf2bsze75z7b', 'checkout', 'p4', 1040, '{"goodsAmount":1040,"discountAmount":260,"listAmount":1300}', '[{"key":"featured","qty":1,"skuId":"sku-featured-1"}]', '{"productKey":"featured","level":null,"memberId":null,"skuId":"sku-featured-1"}', 1, 1793094495095, 1793095095095, 1, 1793094495101, 'o_29'),
  ('q_036pjpo15zgr', 'checkout', 'p4', 1040, '{"goodsAmount":1040,"discountAmount":260,"listAmount":1300}', '[{"key":"featured","qty":1,"skuId":"sku-featured-1"}]', '{"productKey":"featured","level":null,"memberId":null,"skuId":"sku-featured-1"}', 1, 1793094495435, 1793095095435, 1, 1793094495439, 'o_33'),
  ('q_g2u2rh906dvv', 'checkout', 'u_4f4buz', 5584, '{"goodsAmount":5584,"discountAmount":1396,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793094514123, 1793095114123, 1, 1793094514128, 'o_35'),
  ('q_tyegcwzw6e7o', 'checkout', 'p1', 2094, '{"goodsAmount":2094,"discountAmount":4886,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793094514548, 1793095114548, 1, 1793094514553, 'o_17'),
  ('q_nsf7u89h6e7x', 'checkout', 'p1', 2094, '{"goodsAmount":2094,"discountAmount":4886,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793094514557, 1793095114557, 0, NULL, NULL),
  ('q_6cokxod26e81', 'checkout', 'p1', 2094, '{"goodsAmount":2094,"discountAmount":4886,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793094514561, 1793095114561, 0, NULL, NULL),
  ('q_zp30c6hz6eb7', 'entitlement', 'p1', 1980, '{"months":12}', '[{"key":"annual","qty":1}]', '{"planId":"annual"}', 1, 1793094514675, 1793095114675, 0, NULL, NULL),
  ('q_bnsa43w86ebc', 'quota_purchase', 'p1', 13000, '{"unitAmount":6500,"quantity":2}', '[{"key":"quota","qty":2}]', '{"quantity":2}', 1, 1793094514680, 1793095114680, 0, NULL, NULL),
  ('q_nrfbelve6ebf', 'upgrade', 'p1', 0, '{"partnerFee":0,"serviceFee":0}', '[{"key":"angel","qty":0}]', '{"targetLevel":"angel","targetAccountId":"p1"}', 1, 1793094514683, 1793095114683, 0, NULL, NULL),
  ('q_dwyedozj6ebh', 'store_binding', 'p1', 0, '{"storeId":"p6","targetAccountId":"p1"}', '[{"key":"store","qty":1,"storeId":"p6"}]', '{"storeId":"p6","targetAccountId":"p1"}', 1, 1793094514685, 1793095114685, 0, NULL, NULL),
  ('q_6tkaxyx66ebk', 'quota_transfer', 'p1', 0, '{"quantity":1,"targetAccountId":"p4"}', '[{"key":"quota","qty":1,"targetAccountId":"p4"}]', '{"quantity":1,"targetAccountId":"p4"}', 1, 1793094514688, 1793095114688, 0, NULL, NULL),
  ('q_xs61u15g6ebl', 'costore_application', 'p1', 8376, '{"monthlyFee":698,"months":12,"durationId":"12"}', '[{"key":"costore","qty":12,"storeId":"p6"}]', '{"storeId":"p6","durationId":"12","months":12}', 1, 1793094514689, 1793095114689, 0, NULL, NULL),
  ('q_2fxqwkdi6ebn', 'agency_application', 'p1', 80000, '{"brandFee":40000,"extraFee":0,"deviceFee":20000,"depositFee":20000,"total":80000}', '[{"key":"agency","qty":1,"agencyType":"store","tierIndex":0}]', '{"agencyType":"store","tierIndex":0,"regionCodes":null}', 1, 1793094514691, 1793095114691, 0, NULL, NULL),
  ('q_x5jb18c46ebq', 'entitlement', 'p1', 1980, '{"months":12}', '[{"key":"annual","qty":1}]', '{"planId":"annual"}', 1, 1793094514694, 1793095114694, 1, 1793094514696, 'payb31mmx2m'),
  ('q_ap4ifxva6ebv', 'checkout', 'p1', 2094, '{"goodsAmount":2094,"discountAmount":4886,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793094514699, 1793095114699, 0, NULL, NULL),
  ('q_32n85d8a6eby', 'checkout', 'p1', 2094, '{"goodsAmount":2094,"discountAmount":4886,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793094514702, 1793095114702, 0, NULL, NULL),
  ('q_cs64ugq76ec0', 'checkout', 'p1', 2094, '{"goodsAmount":2094,"discountAmount":4886,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793094514704, 1793095114704, 1, 1793094514708, 'o_20'),
  ('q_q8qyyidv6ec7', 'upgrade', 'p1', 0, '{"partnerFee":0,"serviceFee":0}', '[{"key":"angel","qty":0}]', '{"targetLevel":"angel","targetAccountId":"p1"}', 1, 1793094514711, 1793095114711, 0, NULL, NULL),
  ('q_erhnlnar6ec9', 'entitlement', 'p1', 1980, '{"months":12}', '[{"key":"annual","qty":1}]', '{"planId":"annual"}', 1, 1793094514713, 1793095114713, 0, NULL, NULL),
  ('q_ir21gt8a6eci', 'upgrade', 'p4', 23820, '{"partnerFee":19820,"serviceFee":4000}', '[{"key":"angel","qty":2}]', '{"targetLevel":"angel","targetAccountId":"p4"}', 1, 1793094514722, 1793095114722, 1, 1793094514727, 'o_24'),
  ('q_xo8z1mzh6g7u', 'checkout', 'p1', 4188, '{"goodsAmount":4188,"discountAmount":9772,"listAmount":13960}', '[{"key":"pad","qty":2}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793094517146, 1793095117146, 0, NULL, NULL),
  ('q_culnw2t46gb6', 'entitlement', 'p1', 1980, '{"months":12}', '[{"key":"annual","qty":1}]', '{"planId":"annual"}', 1, 1793094517266, 1793095117266, 0, NULL, NULL),
  ('q_ny1gf6l06gb8', 'entitlement', 'p1', 1980, '{"months":12}', '[{"key":"annual","qty":1}]', '{"planId":"annual"}', 1, 1793094517268, 1793095117268, 1, 1793094517271, 'paynygjjwri'),
  ('q_iszzq4jm6h6c', 'checkout', 'p1', 4188, '{"goodsAmount":4188,"discountAmount":9772,"listAmount":13960}', '[{"key":"pad","qty":2}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793094518388, 1793095118388, 0, NULL, NULL),
  ('q_yhbeohbprlds', 'checkout', 'p4', 1040, '{"goodsAmount":1040,"discountAmount":260,"listAmount":1300}', '[{"key":"featured","qty":1,"skuId":"sku-featured-1"}]', '{"productKey":"featured","level":null,"memberId":null,"skuId":"sku-featured-1"}', 1, 1793095503616, 1793096103616, 1, 1793095503621, 'o_23'),
  ('q_fctsu0bkrln3', 'checkout', 'p4', 1040, '{"goodsAmount":1040,"discountAmount":260,"listAmount":1300}', '[{"key":"featured","qty":1,"skuId":"sku-featured-1"}]', '{"productKey":"featured","level":null,"memberId":null,"skuId":"sku-featured-1"}', 1, 1793095503951, 1793096103951, 1, 1793095503954, 'o_27'),
  ('q_kpojhwuhs07a', 'checkout', 'u_67gubf', 5584, '{"goodsAmount":5584,"discountAmount":1396,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793095522822, 1793096122822, 1, 1793095522827, 'o_29'),
  ('q_5s3vt0o9szn7', 'checkout', 'p4', 1040, '{"goodsAmount":1040,"discountAmount":260,"listAmount":1300}', '[{"key":"featured","qty":1,"skuId":"sku-featured-1"}]', '{"productKey":"featured","level":null,"memberId":null,"skuId":"sku-featured-1"}', 1, 1793095568755, 1793096168755, 1, 1793095568760, 'o_36'),
  ('q_0s5wvu3wszwj', 'checkout', 'p4', 1040, '{"goodsAmount":1040,"discountAmount":260,"listAmount":1300}', '[{"key":"featured","qty":1,"skuId":"sku-featured-1"}]', '{"productKey":"featured","level":null,"memberId":null,"skuId":"sku-featured-1"}', 1, 1793095569091, 1793096169091, 1, 1793095569095, 'o_39'),
  ('q_sh3igzi2tefp', 'checkout', 'u_4h0kdi', 5584, '{"goodsAmount":5584,"discountAmount":1396,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793095587925, 1793096187925, 1, 1793095587930, 'o_41'),
  ('q_pyr9haf0tu3w', 'checkout', 'p4', 1040, '{"goodsAmount":1040,"discountAmount":260,"listAmount":1300}', '[{"key":"featured","qty":1,"skuId":"sku-featured-1"}]', '{"productKey":"featured","level":null,"memberId":null,"skuId":"sku-featured-1"}', 1, 1793095608236, 1793096208236, 1, 1793095608240, 'o_43'),
  ('q_jvy6urc6tude', 'checkout', 'p4', 1040, '{"goodsAmount":1040,"discountAmount":260,"listAmount":1300}', '[{"key":"featured","qty":1,"skuId":"sku-featured-1"}]', '{"productKey":"featured","level":null,"memberId":null,"skuId":"sku-featured-1"}', 1, 1793095608578, 1793096208578, 1, 1793095608582, 'o_46'),
  ('q_yqs9gnzutzpk', 'checkout', 'p4', 1040, '{"goodsAmount":1040,"discountAmount":260,"listAmount":1300}', '[{"key":"featured","qty":1,"skuId":"sku-featured-1"}]', '{"productKey":"featured","level":null,"memberId":null,"skuId":"sku-featured-1"}', 1, 1793095615496, 1793096215496, 1, 1793095615501, 'o_48'),
  ('q_er99votmtzyt', 'checkout', 'p4', 1040, '{"goodsAmount":1040,"discountAmount":260,"listAmount":1300}', '[{"key":"featured","qty":1,"skuId":"sku-featured-1"}]', '{"productKey":"featured","level":null,"memberId":null,"skuId":"sku-featured-1"}', 1, 1793095615829, 1793096215829, 1, 1793095615833, 'o_51'),
  ('q_t8z82szzuhpz', 'checkout', 'p4', 1040, '{"goodsAmount":1040,"discountAmount":260,"listAmount":1300}', '[{"key":"featured","qty":1,"skuId":"sku-featured-1"}]', '{"productKey":"featured","level":null,"memberId":null,"skuId":"sku-featured-1"}', 1, 1793095638839, 1793096238839, 1, 1793095638847, 'o_53'),
  ('q_e5a7o2ijuhzk', 'checkout', 'p4', 1040, '{"goodsAmount":1040,"discountAmount":260,"listAmount":1300}', '[{"key":"featured","qty":1,"skuId":"sku-featured-1"}]', '{"productKey":"featured","level":null,"memberId":null,"skuId":"sku-featured-1"}', 1, 1793095639184, 1793096239184, 1, 1793095639189, 'o_56'),
  ('q_pcoal0hbwerc', 'checkout', 'p4', 1040, '{"goodsAmount":1040,"discountAmount":260,"listAmount":1300}', '[{"key":"featured","qty":1,"skuId":"sku-featured-1"}]', '{"productKey":"featured","level":null,"memberId":null,"skuId":"sku-featured-1"}', 1, 1793095728312, 1793096328312, 1, 1793095728318, 'o_63'),
  ('q_hj9va1r6wf0n', 'checkout', 'p4', 1040, '{"goodsAmount":1040,"discountAmount":260,"listAmount":1300}', '[{"key":"featured","qty":1,"skuId":"sku-featured-1"}]', '{"productKey":"featured","level":null,"memberId":null,"skuId":"sku-featured-1"}', 1, 1793095728647, 1793096328647, 1, 1793095728651, 'o_67'),
  ('q_4vanfz5jxi85', 'checkout', 'p4', 1040, '{"goodsAmount":1040,"discountAmount":260,"listAmount":1300}', '[{"key":"featured","qty":1,"skuId":"sku-featured-1"}]', '{"productKey":"featured","level":null,"memberId":null,"skuId":"sku-featured-1"}', 1, 1793095779461, 1793096379461, 1, 1793095779467, 'o_84'),
  ('q_6gbdargdxihh', 'checkout', 'p4', 1040, '{"goodsAmount":1040,"discountAmount":260,"listAmount":1300}', '[{"key":"featured","qty":1,"skuId":"sku-featured-1"}]', '{"productKey":"featured","level":null,"memberId":null,"skuId":"sku-featured-1"}', 1, 1793095779797, 1793096379797, 1, 1793095779802, 'o_88'),
  ('q_tz5l2e8nxx94', 'checkout', 'u_6tyo2x', 5584, '{"goodsAmount":5584,"discountAmount":1396,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793095798936, 1793096398936, 1, 1793095798942, 'o_90'),
  ('q_57tzpb0exxka', 'checkout', 'p1', 2094, '{"goodsAmount":2094,"discountAmount":4886,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793095799338, 1793096399338, 1, 1793095799343, 'o_17'),
  ('q_2w9kjwzdxxkk', 'checkout', 'p1', 2094, '{"goodsAmount":2094,"discountAmount":4886,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793095799348, 1793096399348, 0, NULL, NULL),
  ('q_wms6l043xxko', 'checkout', 'p1', 2094, '{"goodsAmount":2094,"discountAmount":4886,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793095799352, 1793096399352, 0, NULL, NULL),
  ('q_bpvx7ylxxxnr', 'entitlement', 'p1', 1980, '{"months":12}', '[{"key":"annual","qty":1}]', '{"planId":"annual"}', 1, 1793095799463, 1793096399463, 0, NULL, NULL),
  ('q_71f7qq3kxxnv', 'quota_purchase', 'p1', 13000, '{"unitAmount":6500,"quantity":2}', '[{"key":"quota","qty":2}]', '{"quantity":2}', 1, 1793095799467, 1793096399467, 0, NULL, NULL),
  ('q_jhbyjhpbxxnz', 'upgrade', 'p1', 0, '{"partnerFee":0,"serviceFee":0}', '[{"key":"angel","qty":0}]', '{"targetLevel":"angel","targetAccountId":"p1"}', 1, 1793095799471, 1793096399471, 0, NULL, NULL),
  ('q_j0t8nqggxxo2', 'store_binding', 'p1', 0, '{"storeId":"p6","targetAccountId":"p1"}', '[{"key":"store","qty":1,"storeId":"p6"}]', '{"storeId":"p6","targetAccountId":"p1"}', 1, 1793095799474, 1793096399474, 0, NULL, NULL),
  ('q_w9zkaimsxxo4', 'quota_transfer', 'p1', 0, '{"quantity":1,"targetAccountId":"p4"}', '[{"key":"quota","qty":1,"targetAccountId":"p4"}]', '{"quantity":1,"targetAccountId":"p4"}', 1, 1793095799476, 1793096399476, 0, NULL, NULL),
  ('q_cbv8nm1mxxo6', 'costore_application', 'p1', 8376, '{"monthlyFee":698,"months":12,"durationId":"12"}', '[{"key":"costore","qty":12,"storeId":"p6"}]', '{"storeId":"p6","durationId":"12","months":12}', 1, 1793095799478, 1793096399478, 0, NULL, NULL),
  ('q_shv9fnxzxxo9', 'agency_application', 'p1', 80000, '{"brandFee":40000,"extraFee":0,"deviceFee":20000,"depositFee":20000,"total":80000}', '[{"key":"agency","qty":1,"agencyType":"store","tierIndex":0}]', '{"agencyType":"store","tierIndex":0,"regionCodes":null}', 1, 1793095799481, 1793096399481, 0, NULL, NULL),
  ('q_fx4lqpgkxxoc', 'entitlement', 'p1', 1980, '{"months":12}', '[{"key":"annual","qty":1}]', '{"planId":"annual"}', 1, 1793095799484, 1793096399484, 1, 1793095799486, 'paycs4h5i83'),
  ('q_oynh61y0xxoh', 'checkout', 'p1', 2094, '{"goodsAmount":2094,"discountAmount":4886,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793095799489, 1793096399489, 0, NULL, NULL),
  ('q_l78wup8dxxok', 'checkout', 'p1', 2094, '{"goodsAmount":2094,"discountAmount":4886,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793095799492, 1793096399492, 0, NULL, NULL),
  ('q_vv0k5ln8xxoo', 'checkout', 'p1', 2094, '{"goodsAmount":2094,"discountAmount":4886,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793095799496, 1793096399496, 1, 1793095799500, 'o_20'),
  ('q_rfkjpblhxxou', 'upgrade', 'p1', 0, '{"partnerFee":0,"serviceFee":0}', '[{"key":"angel","qty":0}]', '{"targetLevel":"angel","targetAccountId":"p1"}', 1, 1793095799502, 1793096399502, 0, NULL, NULL),
  ('q_wmjgezumxxow', 'entitlement', 'p1', 1980, '{"months":12}', '[{"key":"annual","qty":1}]', '{"planId":"annual"}', 1, 1793095799504, 1793096399504, 0, NULL, NULL),
  ('q_t29szgdzxxp7', 'upgrade', 'p4', 23820, '{"partnerFee":19820,"serviceFee":4000}', '[{"key":"angel","qty":2}]', '{"targetLevel":"angel","targetAccountId":"p4"}', 1, 1793095799515, 1793096399515, 1, 1793095799520, 'o_24'),
  ('q_essla5vpxzku', 'checkout', 'p1', 4188, '{"goodsAmount":4188,"discountAmount":9772,"listAmount":13960}', '[{"key":"pad","qty":2}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793095801950, 1793096401950, 0, NULL, NULL),
  ('q_lgekcnalxzo6', 'entitlement', 'p1', 1980, '{"months":12}', '[{"key":"annual","qty":1}]', '{"planId":"annual"}', 1, 1793095802070, 1793096402070, 0, NULL, NULL),
  ('q_z1z2nrekxzo9', 'entitlement', 'p1', 1980, '{"months":12}', '[{"key":"annual","qty":1}]', '{"planId":"annual"}', 1, 1793095802073, 1793096402073, 1, 1793095802075, 'pay8nrvlnli'),
  ('q_1xb7pzcny0jd', 'checkout', 'p1', 4188, '{"goodsAmount":4188,"discountAmount":9772,"listAmount":13960}', '[{"key":"pad","qty":2}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793095803193, 1793096403193, 0, NULL, NULL),
  ('q_ab78jyf8aakz', 'checkout', 'seed_cofounder', 4537, '{"goodsAmount":4537,"discountAmount":2443,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793148444178, 1793149044178, 1, 1793148444185, 'o_28'),
  ('q_tdixf0dgaalb', 'checkout', 'seed_province', 2094, '{"goodsAmount":2094,"discountAmount":4886,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793148444191, 1793149044191, 1, 1793148444196, 'o_30'),
  ('q_i3opqa0jaaln', 'checkout', 'seed_store', 3490, '{"goodsAmount":3490,"discountAmount":3490,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793148444203, 1793149044203, 1, 1793148444208, 'o_32'),
  ('q_aq5rzqulaalw', 'checkout', 'seed_private', 4886, '{"goodsAmount":4886,"discountAmount":2094,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793148444212, 1793149044212, 1, 1793148444217, 'o_34'),
  ('q_hl3llo8vaam5', 'checkout', 'seed_angel', 5235, '{"goodsAmount":5235,"discountAmount":1745,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793148444221, 1793149044221, 1, 1793148444226, 'o_36'),
  ('q_jjpi5p5iaamf', 'checkout', 'seed_vip', 5584, '{"goodsAmount":5584,"discountAmount":1396,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793148444231, 1793149044231, 1, 1793148444236, 'o_38'),
  ('q_dkvs7j9saamn', 'checkout', 'seed_parent_cj', 6980, '{"goodsAmount":6980,"discountAmount":0,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793148444239, 1793149044239, 1, 1793148444244, 'o_40'),
  ('q_mo2csekpaamw', 'checkout', 'seed_parent_nokid', 6980, '{"goodsAmount":6980,"discountAmount":0,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793148444248, 1793149044248, 1, 1793148444253, 'o_42'),
  ('q_o36p6byoaan4', 'checkout', 'seed_district', 2792, '{"goodsAmount":2792,"discountAmount":4188,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793148444256, 1793149044256, 1, 1793148444260, 'o_44'),
  ('q_elba13oaaanc', 'checkout', 'seed_city', 2443, '{"goodsAmount":2443,"discountAmount":4537,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793148444264, 1793149044264, 1, 1793148444268, 'o_46'),
  ('q_u02wb30kadsm', 'checkout', 'seed_cofounder', 4537, '{"goodsAmount":4537,"discountAmount":2443,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793148448342, 1793149048342, 1, 1793148448348, 'o_48'),
  ('q_tde1rfbsadsx', 'checkout', 'seed_province', 2094, '{"goodsAmount":2094,"discountAmount":4886,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793148448353, 1793149048353, 1, 1793148448358, 'o_50'),
  ('q_845bb7bvadt8', 'checkout', 'seed_store', 3490, '{"goodsAmount":3490,"discountAmount":3490,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793148448364, 1793149048364, 1, 1793148448369, 'o_52'),
  ('q_ae0mcyl8adth', 'checkout', 'seed_private', 4886, '{"goodsAmount":4886,"discountAmount":2094,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793148448373, 1793149048373, 1, 1793148448380, 'o_54'),
  ('q_opp9r90vadtt', 'checkout', 'seed_angel', 5235, '{"goodsAmount":5235,"discountAmount":1745,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793148448385, 1793149048385, 1, 1793148448389, 'o_56'),
  ('q_cfsnagt7adu2', 'checkout', 'seed_vip', 5584, '{"goodsAmount":5584,"discountAmount":1396,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793148448394, 1793149048394, 1, 1793148448399, 'o_58'),
  ('q_g7hp4el8adub', 'checkout', 'seed_parent_cj', 6980, '{"goodsAmount":6980,"discountAmount":0,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793148448403, 1793149048403, 1, 1793148448407, 'o_60'),
  ('q_v80bh2o2aduk', 'checkout', 'seed_parent_nokid', 6980, '{"goodsAmount":6980,"discountAmount":0,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793148448412, 1793149048412, 1, 1793148448417, 'o_62'),
  ('q_ff0l1zgbadus', 'checkout', 'seed_district', 2792, '{"goodsAmount":2792,"discountAmount":4188,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793148448420, 1793149048420, 1, 1793148448425, 'o_64'),
  ('q_pzfo5c7qadv1', 'checkout', 'seed_city', 2443, '{"goodsAmount":2443,"discountAmount":4537,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793148448429, 1793149048429, 1, 1793148448434, 'o_66'),
  ('q_u8vznvxwai30', 'checkout', 'p4', 1040, '{"goodsAmount":1040,"discountAmount":260,"listAmount":1300}', '[{"key":"featured","qty":1,"skuId":"sku-featured-1"}]', '{"productKey":"featured","level":null,"memberId":null,"skuId":"sku-featured-1"}', 1, 1793148453900, 1793149053900, 1, 1793148453905, 'o_70'),
  ('q_u2r512fyaicr', 'checkout', 'p4', 1040, '{"goodsAmount":1040,"discountAmount":260,"listAmount":1300}', '[{"key":"featured","qty":1,"skuId":"sku-featured-1"}]', '{"productKey":"featured","level":null,"memberId":null,"skuId":"sku-featured-1"}', 1, 1793148454251, 1793149054251, 1, 1793148454259, 'o_74'),
  ('q_lzq6d9tqax96', 'checkout', 'u_7ncoc1', 5584, '{"goodsAmount":5584,"discountAmount":1396,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793148473562, 1793149073562, 1, 1793148473568, 'o_76'),
  ('q_th6r3m0wb4dt', 'checkout', 'seed_cofounder', 4537, '{"goodsAmount":4537,"discountAmount":2443,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793148482801, 1793149082801, 1, 1793148482807, 'o_78'),
  ('q_40k5z4skb4e5', 'checkout', 'seed_province', 2094, '{"goodsAmount":2094,"discountAmount":4886,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793148482813, 1793149082813, 1, 1793148482819, 'o_80'),
  ('q_wdm272xib4ei', 'checkout', 'seed_store', 3490, '{"goodsAmount":3490,"discountAmount":3490,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793148482826, 1793149082826, 1, 1793148482833, 'o_82'),
  ('q_3ewqtsijb4et', 'checkout', 'seed_private', 4886, '{"goodsAmount":4886,"discountAmount":2094,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793148482837, 1793149082837, 1, 1793148482842, 'o_84'),
  ('q_x55mqwvwb4f4', 'checkout', 'seed_angel', 5235, '{"goodsAmount":5235,"discountAmount":1745,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793148482848, 1793149082848, 1, 1793148482853, 'o_86'),
  ('q_2ihi6ly6b4fd', 'checkout', 'seed_vip', 5584, '{"goodsAmount":5584,"discountAmount":1396,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793148482857, 1793149082857, 1, 1793148482862, 'o_88'),
  ('q_7d8b6fcyb4fn', 'checkout', 'seed_parent_cj', 6980, '{"goodsAmount":6980,"discountAmount":0,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793148482867, 1793149082867, 1, 1793148482872, 'o_90'),
  ('q_ach3ggcyb4fy', 'checkout', 'seed_parent_nokid', 6980, '{"goodsAmount":6980,"discountAmount":0,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793148482878, 1793149082878, 1, 1793148482883, 'o_92'),
  ('q_gbqpi0lbb4g8', 'checkout', 'seed_district', 2792, '{"goodsAmount":2792,"discountAmount":4188,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793148482888, 1793149082888, 1, 1793148482893, 'o_94'),
  ('q_uq3pkkiqb4gh', 'checkout', 'seed_city', 2443, '{"goodsAmount":2443,"discountAmount":4537,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793148482897, 1793149082897, 1, 1793148482903, 'o_96'),
  ('q_od1sr2ckczx8', 'checkout', 'seed_cofounder', 4537, '{"goodsAmount":4537,"discountAmount":2443,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793148570332, 1793149170332, 1, 1793148570339, 'o_119'),
  ('q_wng1tmp2czxn', 'checkout', 'seed_province', 2094, '{"goodsAmount":2094,"discountAmount":4886,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793148570347, 1793149170347, 1, 1793148570355, 'o_121'),
  ('q_jt95ysojczy3', 'checkout', 'seed_store', 3490, '{"goodsAmount":3490,"discountAmount":3490,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793148570363, 1793149170363, 1, 1793148570370, 'o_123'),
  ('q_tp180ymiczye', 'checkout', 'seed_private', 4886, '{"goodsAmount":4886,"discountAmount":2094,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793148570374, 1793149170374, 1, 1793148570381, 'o_125'),
  ('q_nqouovlgczyq', 'checkout', 'seed_angel', 5235, '{"goodsAmount":5235,"discountAmount":1745,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793148570386, 1793149170386, 1, 1793148570392, 'o_127'),
  ('q_rs2wa9uqczz2', 'checkout', 'seed_vip', 5584, '{"goodsAmount":5584,"discountAmount":1396,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793148570398, 1793149170398, 1, 1793148570404, 'o_129'),
  ('q_ayfasbhaczzc', 'checkout', 'seed_parent_cj', 6980, '{"goodsAmount":6980,"discountAmount":0,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793148570408, 1793149170408, 1, 1793148570415, 'o_131'),
  ('q_toxj7zdvczzo', 'checkout', 'seed_parent_nokid', 6980, '{"goodsAmount":6980,"discountAmount":0,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793148570420, 1793149170420, 1, 1793148570426, 'o_133'),
  ('q_ik36puriczzz', 'checkout', 'seed_district', 2792, '{"goodsAmount":2792,"discountAmount":4188,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793148570431, 1793149170431, 1, 1793148570437, 'o_135'),
  ('q_o0tz52jcd009', 'checkout', 'seed_city', 2443, '{"goodsAmount":2443,"discountAmount":4537,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793148570441, 1793149170441, 1, 1793148570448, 'o_137'),
  ('q_1bcswbc9d4ch', 'checkout', 'p4', 1040, '{"goodsAmount":1040,"discountAmount":260,"listAmount":1300}', '[{"key":"featured","qty":1,"skuId":"sku-featured-1"}]', '{"productKey":"featured","level":null,"memberId":null,"skuId":"sku-featured-1"}', 1, 1793148576065, 1793149176065, 1, 1793148576073, 'o_150'),
  ('q_3c43bblxd4m0', 'checkout', 'p4', 1040, '{"goodsAmount":1040,"discountAmount":260,"listAmount":1300}', '[{"key":"featured","qty":1,"skuId":"sku-featured-1"}]', '{"productKey":"featured","level":null,"memberId":null,"skuId":"sku-featured-1"}', 1, 1793148576408, 1793149176408, 1, 1793148576416, 'o_154'),
  ('q_g9skdeabdk73', 'checkout', 'u_ys5utb', 5584, '{"goodsAmount":5584,"discountAmount":1396,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793148596607, 1793149196607, 1, 1793148596615, 'o_156'),
  ('q_y42bwq8wdrf0', 'checkout', 'seed_cofounder', 4537, '{"goodsAmount":4537,"discountAmount":2443,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793148605964, 1793149205964, 1, 1793148605971, 'o_158'),
  ('q_icdy5ee8drfd', 'checkout', 'seed_province', 2094, '{"goodsAmount":2094,"discountAmount":4886,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793148605977, 1793149205977, 1, 1793148605985, 'o_160'),
  ('q_45acnw8odrfq', 'checkout', 'seed_store', 3490, '{"goodsAmount":3490,"discountAmount":3490,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793148605990, 1793149205990, 1, 1793148605998, 'o_162'),
  ('q_7ij77wifdrg4', 'checkout', 'seed_private', 4886, '{"goodsAmount":4886,"discountAmount":2094,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793148606004, 1793149206004, 1, 1793148606010, 'o_164'),
  ('q_rsivf3jqdrgg', 'checkout', 'seed_angel', 5235, '{"goodsAmount":5235,"discountAmount":1745,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793148606016, 1793149206016, 1, 1793148606022, 'o_166'),
  ('q_catxsz62drgr', 'checkout', 'seed_vip', 5584, '{"goodsAmount":5584,"discountAmount":1396,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793148606027, 1793149206027, 1, 1793148606034, 'o_168'),
  ('q_534slhthdrh3', 'checkout', 'seed_parent_cj', 6980, '{"goodsAmount":6980,"discountAmount":0,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793148606039, 1793149206039, 1, 1793148606046, 'o_170'),
  ('q_upzgmqokdrhf', 'checkout', 'seed_parent_nokid', 6980, '{"goodsAmount":6980,"discountAmount":0,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793148606051, 1793149206051, 1, 1793148606057, 'o_172'),
  ('q_vmukmx4fdrhr', 'checkout', 'seed_district', 2792, '{"goodsAmount":2792,"discountAmount":4188,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793148606063, 1793149206063, 1, 1793148606070, 'o_174'),
  ('q_4ckrrrymdri2', 'checkout', 'seed_city', 2443, '{"goodsAmount":2443,"discountAmount":4537,"listAmount":6980}', '[{"key":"pad","qty":1}]', '{"productKey":"pad","level":null,"memberId":null,"skuId":null}', 1, 1793148606074, 1793149206074, 1, 1793148606081, 'o_176');

INSERT INTO `regional_agents` (`id`, `user_id`, `region_type`, `region_code`, `price_tier`, `referrer_id`, `granted_tier`, `appointed_at`) VALUES
  ('ra_12', 'p1', 'province', '33', 0, NULL, 'cofounder', '2026-10-27T10:10:07.830Z'),
  ('ra_13', 'p1', 'city', '3301', 0, NULL, 'cofounder', '2026-10-27T10:10:07.831Z'),
  ('ra_14', 'p5', 'district', '330110', 0, NULL, 'private', '2026-10-27T10:10:07.831Z'),
  ('ra_15', 'p6', 'store', '330110-S1', 0, NULL, NULL, '2026-10-27T10:10:07.831Z'),
  ('ra_115', 'seed_province', 'province', '3310', 0, NULL, 'cofounder', '2026-10-28T00:49:17.451Z'),
  ('ra_116', 'seed_store', 'store', '331002-S1', 0, NULL, NULL, '2026-10-28T00:49:17.486Z'),
  ('ra_117', 'seed_district', 'district', '331002', 0, NULL, 'private', '2026-10-28T00:49:17.726Z'),
  ('ra_118', 'seed_city', 'city', '331001', 0, NULL, 'cofounder', '2026-10-28T00:49:17.762Z');

INSERT INTO `skus` (`id`, `product_id`, `label`, `list_price`, `stock`, `updated_at`) VALUES
  ('sku-pad-1', 'pad', '智能变速，一档', 6980, 20, 1793095807831),
  ('sku-pad-2', 'pad', '智能变速，二档', 6980, 8, 1793095807831),
  ('sku-pad-3', 'pad', '智能变速，三档', 6980, 8, 1793095807831),
  ('sku-pad-4', 'pad', '无级变速，一档', 6980, 8, 1793095807831),
  ('sku-pad-5', 'pad', '无级变速，二档', 6980, 8, 1793095807831),
  ('sku-pad-6', 'pad', '无级变速，三档', 6980, 8, 1793095807831),
  ('sku-pad-7', 'pad', '定速，无变速，一档', 6980, 8, 1793095807831),
  ('sku-pad-8', 'pad', '定速，无变速，二档', 6980, 8, 1793095807831),
  ('sku-pad-9', 'pad', '定速，无变速，三档', 6980, 8, 1793095807831),
  ('sku-memoryCard-1', 'memoryCard', '月卡', 998, 20, 1793095807831),
  ('sku-memoryCard-2', 'memoryCard', '年卡', 998, 8, 1793095807831),
  ('sku-coachCard-1', 'coachCard', '单次', 2000, 20, 1793095807831),
  ('sku-coachCard-2', 'coachCard', '10 次包', 2000, 8, 1793095807831),
  ('sku-featured-1', 'featured', '10 课时', 1300, 18, 1793148576424),
  ('sku-featuredCamp-1', 'featuredCamp', '假期营', 10000, 20, 1793095807831),
  ('sku-adminFee-1', 'adminFee', '默认规格', 0, 20, 1793095807831),
  ('sku-col_1-1', 'col_1', '默认规格', 299, 20, 1793095807831),
  ('sku-col_2-1', 'col_2', '默认规格', 199, 20, 1793095807831);

INSERT INTO `stock_ledger` (`id`, `sku_id`, `delta`, `reason`, `order_id`, `operator_id`, `at`, `balance_after`) VALUES
  ('sl_jxhd3xns', 'sku-featured-1', -1, 'ORDER_CREATE', 'o_70', NULL, 1793148453903, 19),
  ('sl_zhp62dy6', 'sku-featured-1', -1, 'ORDER_CREATE', 'o_74', NULL, 1793148454256, 18),
  ('sl_ptaupjyl', 'sku-featured-1', 1, 'ORDER_CANCEL_RESTORE', 'o_74', NULL, 1793148454270, 19),
  ('sl_hig26pzc', 'sku-featured-1', -1, 'ORDER_CREATE', 'o_150', NULL, 1793148576070, 18),
  ('sl_6t0z2g3l', 'sku-featured-1', -1, 'ORDER_CREATE', 'o_154', NULL, 1793148576413, 17),
  ('sl_68nslote', 'sku-featured-1', 1, 'ORDER_CANCEL_RESTORE', 'o_154', NULL, 1793148576424, 18);

INSERT INTO `users` (`id`, `seq`, `display_id`, `name`, `phone`, `password`, `password_migrated_at`, `tier`, `is_founding`, `upline_id`, `team_vip`, `annual_fee_paid`, `entitlement_state`, `entitlement_paid_at`, `entitlement_expires_at`, `role`, `avatar`, `wechat_openid`, `created_at`, `principal_tier`, `referral_tier`, `referral_upline_tier`, `free_upgrade_applied`) VALUES
  ('p1', 1, 'LC0001', '总部联创-甲', '13800000001', '', NULL, 'cofounder', 'founding', NULL, 0, 1, 'active', NULL, NULL, NULL, NULL, NULL, '2026-10-28 08:51:13', 'cofounder', NULL, NULL, 0),
  ('p2', 2, 'SD0002', '私董-乙', '13800000002', '', NULL, 'private', 'none', 'p1', 0, 1, 'active', NULL, NULL, NULL, NULL, NULL, '2026-10-28 08:51:13', 'private', NULL, 'cofounder', 0),
  ('p3', 3, 'TS0003', '天使-丙', '13800000003', '', NULL, 'angel', 'none', 'p2', 0, 1, 'active', NULL, NULL, NULL, NULL, NULL, '2026-10-28 08:51:13', 'angel', NULL, 'private', 0),
  ('p4', 4, 'VIP0004', 'VIP-丁', '13800000004', '', NULL, 'vip', 'none', 'p3', 0, 1, 'active', NULL, NULL, NULL, NULL, NULL, '2026-10-28 08:51:13', 'vip', NULL, 'angel', 0),
  ('p5', 5, 'SD0005', '区县代-戊(私董)', '13800000005', '', NULL, 'private', 'none', 'p1', 0, 1, 'active', NULL, NULL, NULL, NULL, NULL, '2026-10-28 08:51:13', 'private', NULL, 'cofounder', 0),
  ('p6', 6, 'TS0006', '门店老板-己(天使/单店)', '13800000006', '', NULL, 'angel', 'none', 'p5', 0, 1, 'active', NULL, NULL, NULL, NULL, NULL, '2026-10-28 08:51:13', 'angel', NULL, 'private', 0),
  ('p7', 7, 'TS0007', '合店老板-庚(天使)', '13800000007', '', NULL, 'angel', 'none', 'p3', 0, 1, 'active', NULL, NULL, NULL, NULL, NULL, '2026-10-28 08:51:13', 'angel', NULL, 'angel', 0),
  ('u_7ncoc1', 41, 'VIP0041', '13948473487', '13948473487', '', NULL, 'vip', 'none', NULL, 0, 1, 'active', 1793148473556, 1824684473556, NULL, NULL, NULL, '2026-10-28 08:51:13', NULL, NULL, NULL, 0),
  ('seed_cofounder', 42, 'YS0042', '联创合伙人-甲', '13900001001', '', NULL, 'cofounder', 'none', NULL, 0, 1, 'active', 1793148557417, 1824684557417, NULL, NULL, NULL, '2026-10-28 08:51:13', NULL, NULL, NULL, 0),
  ('seed_province', 43, 'FS0043', '省代-乙', '13900001002', '', NULL, 'cofounder', 'none', NULL, 0, 1, 'active', 1793148557451, 1824684557451, NULL, NULL, NULL, '2026-10-28 08:51:13', NULL, NULL, NULL, 0),
  ('seed_store', 44, 'JY0044', '单店代理-丙', '13900001003', '', NULL, 'angel', 'none', NULL, 0, 1, 'active', 1793148557486, 1824684557486, NULL, NULL, NULL, '2026-10-28 08:51:13', NULL, NULL, NULL, 0),
  ('seed_private', 45, 'CJ0045', '私董合伙人-丁', '13900001004', '', NULL, 'private', 'none', NULL, 0, 1, 'active', 1793148557521, 1824684557521, NULL, NULL, NULL, '2026-10-28 08:51:13', NULL, NULL, NULL, 0),
  ('seed_angel', 46, 'XN0046', '天使合伙人-戊', '13900001005', '', NULL, 'angel', 'none', NULL, 0, 1, 'active', 1793148557555, 1824684557555, NULL, NULL, NULL, '2026-10-28 08:51:13', NULL, NULL, NULL, 0),
  ('seed_vip', 47, 'VIP0047', 'VIP合伙人-己', '13900001006', '', NULL, 'vip', 'none', NULL, 0, 1, 'active', 1793148557589, 1824684557589, NULL, NULL, NULL, '2026-10-28 08:51:13', NULL, NULL, NULL, 0),
  ('seed_parent_cj', 48, 'CJ0048', '普通家长-庚', '13900001007', '', NULL, 'none', 'none', NULL, 0, 1, 'active', 1793148557623, 1824684557623, NULL, NULL, NULL, '2026-10-28 08:51:13', NULL, NULL, NULL, 0),
  ('seed_parent_free', 49, 'QZ0049', '普通家长-辛', '13900001008', '', NULL, 'none', 'none', NULL, 0, 1, 'never_paid', NULL, NULL, NULL, NULL, NULL, '2026-10-28 08:51:13', NULL, NULL, NULL, 0),
  ('seed_parent_nokid', 50, 'YH0050', '普通家长-壬', '13900001009', '', NULL, 'none', 'none', NULL, 0, 1, 'active', 1793148557693, 1824684557693, NULL, NULL, NULL, '2026-10-28 08:51:13', NULL, NULL, NULL, 0),
  ('seed_district', 51, 'CJ0051', '区县代理-癸', '13900001010', '', NULL, 'private', 'none', NULL, 0, 1, 'active', 1793148557726, 1824684557726, NULL, NULL, NULL, '2026-10-28 08:51:13', NULL, NULL, NULL, 0),
  ('seed_city', 52, 'FS0052', '地市代理-子', '13900001011', '', NULL, 'cofounder', 'none', NULL, 0, 1, 'active', 1793148557762, 1824684557762, NULL, NULL, NULL, '2026-10-28 08:51:13', NULL, NULL, NULL, 0),
  ('u_ys5utb', 53, 'VIP0053', '13948596531', '13948596531', '', NULL, 'vip', 'none', NULL, 0, 1, 'active', 1793148596600, 1824684596600, NULL, NULL, NULL, '2026-10-28 08:51:13', NULL, NULL, NULL, 0),
  ('HQ', 900001, 'HQ', '总部', 'sys-hq', '', NULL, 'system', 'none', NULL, 0, 0, 'active', NULL, NULL, NULL, NULL, NULL, '2026-10-28T00:51:13.785Z', NULL, NULL, NULL, 0),
  ('DIVIDEND', 900002, 'DIVIDEND', '分红池', 'sys-dividend', '', NULL, 'system', 'none', NULL, 0, 0, 'active', NULL, NULL, NULL, NULL, NULL, '2026-10-28T00:51:13.786Z', NULL, NULL, NULL, 0),
  ('admin', 900003, 'ADMIN', '总部后台', 'sys-admin', '', NULL, 'system', 'none', NULL, 0, 0, 'active', NULL, NULL, NULL, NULL, NULL, '2026-10-28T00:51:13.786Z', NULL, NULL, NULL, 0);

SET FOREIGN_KEY_CHECKS = 1;

-- 完成：45 张表，832 行数据
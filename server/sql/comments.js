/**
 * 脑商AI · 数据库中文注释字典（45 表 / 418 列）
 *
 * 用途：为 MySQL 库 naoshang 的每张表、每个字段提供中文说明，
 *       便于在 IDEA / MySQL Workbench / DBeaver 中直接悬停查看，
 *       方便后续维护与交接。
 *
 * 数据来源：
 *   1) sql/schema.sql 中的行内注释（权威设计稿口径）
 *   2) src/*.js 运行时代码（字段真实语义与取值枚举）
 *
 * 维护方式：改本文件 → 重新执行 scripts/apply_comments.js
 *          （会同时更新运行中的 MySQL 实例与 mysql/naoshang.sql）
 */

module.exports = {
  // ── 全局计数器 ─────────────────────────────────────────────
  counters: {
    table: '全局 ID 计数器（内部 id 与对外编号的序号来源）',
    columns: {
      name: '计数器名称（userSeq=用户注册序号 / seq=内部 id / memberSeq=孩子添加序号）',
      value: '当前计数值（下一个分配的序号）'
    }
  },

  // ── 用户主表 ───────────────────────────────────────────────
  users: {
    table: '用户主表（人；所有人的主档，代理/合店老板等身份是身上的角色而非独立表）',
    columns: {
      id: '内部 ID（如 u_xxx / p1），全库唯一主键',
      seq: '全局注册序号（1,2,3…，第 10000 名即 10000，不截断）',
      display_id: '对外编号：身份前缀 + seq（QZ 普通 / YH 用户 / VIP / TS 天使 / SD 私董 / LC 联创）',
      name: '用户姓名',
      phone: '注册手机号（应用层 409 唯一校验，此处兜底唯一约束）',
      password: '登录口令（存 scrypt 哈希串 scrypt$salt$hash，历史明文由启动迁移自动升级）',
      password_migrated_at: '明文口令升级为哈希的时间（毫秒时间戳）',
      tier: '合伙人能力档位：none/vip/angel/private/cofounder（普通/VIP/天使/私董/联创）',
      is_founding: '是否持创始奖：founding=是 / none=否',
      upline_id: '直接上级 ID（推荐链，自引用；上级被删则置空）',
      team_vip: '团队 VIP 人数（缓存字段，读时按需重算）',
      annual_fee_paid: '年费是否已缴（1=已缴 / 0=未缴）',
      entitlement_state: '权益收益费三态：never_paid=未开通 / active=生效中 / expired=已过期（过期后佣金引擎全部停算，仅可导出历史账单）',
      entitlement_paid_at: '权益收益费实付时间（毫秒时间戳）',
      entitlement_expires_at: '权益到期时间（毫秒时间戳，惰性判定：小于当前时间即视为 expired）',
      role: '登录通道角色：user/parent/coach/admin（缺省时由 tier 推导）',
      avatar: '头像引用（assets.id 或图片 URL）',
      wechat_openid: '微信授权 OpenID（当前为 Mock 占位）',
      created_at: '注册时间',
      principal_tier: '本金档（升级计价锚点）：升级价 = 目标档零售价 − 本金档零售价；旧记录缺省回退 oldTier',
      referral_tier: '被推荐人注册时的自身档位快照（用于推荐关系结算，不随后续变动漂移）',
      referral_upline_tier: '下级被推荐时其直接上级所处档位快照（用于同级推荐判定，不随上级后续变动漂移）',
      free_upgrade_applied: '已发放免费升档次数（幂等计数；0=未发放）'
    }
  },

  // ── 订单 ───────────────────────────────────────────────────
  orders: {
    table: '订单 / 销售记录（一切收益的计算来源）',
    columns: {
      id: '订单 ID（内部唯一标识）',
      buyer_id: '购买方 ID（升档者）',
      seller_id: '供货方 ID（推荐人/上级；直营场景可为空）',
      package_tier: '售出的档位包：vip/angel/private/cofounder',
      old_tier: '升档前的原档位（为空表示原始名额售卖，非升档）',
      quota_count: '本次消耗的 VIP 名额数量',
      vip_credit: '计入全球奖的 VIP 增量（用于核算全球奖池）',
      actual_paid: '客户实际支付金额（元）',
      seller_cost: '卖方拿货成本（元）',
      supply_spread: '供货差价（元）= 售价 − 成本；≤0 时不落账',
      store_fee: '门店服务费（元，仅门店渠道产生；月度结算按四级拆分）',
      hq_fee: '总部产品费（元，含全球奖与创始奖计提）',
      region_code: '归属区域码（门店费按区域码精确匹配）',
      channel: '成交渠道：store=门店老板售出 / partner=合伙人售卖',
      store_id: '成交门店标识（channel=store 时记录）',
      status: '订单状态（已支付/已取消/已退款等）',
      created_at: '下单时间'
    }
  },

  // ── 佣金 ───────────────────────────────────────────────────
  commissions: {
    table: '收益明细（佣金台账；全球奖/直推奖/复购奖/创始奖/代理奖/合店分配全类型统一落此表）',
    columns: {
      id: '收益流水 ID',
      owner_id: '收益归属人 ID（收到这笔钱的人）',
      identity: '收益归属身份：partner=合伙人 / costore=合店 / agent=代理（三身份分账口径，互不混算）',
      type: '收益类型：supply=供货差价 / parity=平级奖 / global=全球奖 / founding=创始奖 / agent=代理奖 / costore=合店分配 / product=产品分成',
      subtype: '收益子类（agent_direct=代理直推 / agent_biz=代理业务 / storeService=门店服务费 / businessDirect=业务直推 / partner_product=合伙人产品）',
      period: '结算月份（YYYY-MM）',
      base_amount: '计佣基数（元）',
      rate: '提成比例（可为空，如定额拆分场景）',
      amount: '实际收益金额（元）',
      ref_order_id: '关联订单 ID（可为空；订单删除后置空）',
      status: '结算状态：pending=待结算 / settled=已结算',
      note: '备注（人工说明或自动生成的计算说明）',
      formula: '计算公式快照（便于复核金额来源）',
      created_at: '收益生成时间'
    }
  },

  // ── 名额台账 ───────────────────────────────────────────────
  quota_ledger: {
    table: 'VIP 名额余额台账（标准名额与活动名额两桶分开记账）',
    columns: {
      user_id: '持有人 ID（每人一行）',
      standard: '标准 VIP 名额余额（可划拨、可用于任意档位升级）'
    }
  },

  quota_activity_batches: {
    table: '活动名额批次（每笔活动名额发放一条，带 1 年有效期）',
    columns: {
      id: '批次 ID（自增主键）',
      user_id: '持有人 ID',
      qty: '本批次发放的活动名额数量',
      obtained_at: '发放时间',
      expire_at: '到期时间（消耗时先过期先扣）'
    }
  },

  quota_transactions: {
    table: 'VIP 名额流水（发放/消耗双向审计）',
    columns: {
      id: '流水 ID（自增主键）',
      user_id: '操作对象 ID',
      op: '操作类型：issue=发放 / consume=消耗',
      kind: '发放类型：standard=标准名额 / activity=活动名额（消耗时为混合来源）',
      used_standard: '本次扣减的标准名额数',
      used_activity: '本次扣减的活动名额数',
      amount: '额度变动量（兼容旧语义）',
      ref: '关联订单号 / 发放来源 / 操作备注',
      operator_id: '操作人 ID（后台发放人或下单用户）',
      created_at: '操作时间'
    }
  },

  // ── 区域代理 ───────────────────────────────────────────────
  regional_agents: {
    table: '区域代理表（省代/市代/县区代/门店代理；代理是 users 的角色，故为关联表）',
    columns: {
      id: '代理记录 ID',
      user_id: '代理身份归属人 ID',
      region_type: '代理层级：province=省代 / city=市代 / district=县区代 / store=门店代理',
      region_code: '区域码（门店费按此码精确匹配）',
      price_tier: '新价格表的人数档位（决定该代理的提价系数）',
      referrer_id: '开发人 ID（推荐该代理的人）',
      granted_tier: '开通时赠予的身份（门店代理为空）',
      appointed_at: '任命时间'
    }
  },

  // ── 合店 ───────────────────────────────────────────────────
  co_stores: {
    table: '合店 / 门店表（合店是 users 的角色；含合店老板名单 1:N 关系）',
    columns: {
      id: '合店记录 ID',
      owner_id: '缴纳合店费的老板 ID',
      promoter_id: '推荐人 ID（可能同为合店老板）',
      store_manager_id: '门店店长/门店股东 ID（拿 40% 服务费）',
      store_id: '所属门店标识（单店分红分组键）',
      monthly_fee: '合店费月费（元，默认 698）',
      owner_count: '该门店老板人数',
      join_date: '入股年月（用于无责分红首月判定）',
      created_at: '创建时间'
    }
  },

  co_store_owners: {
    table: '合店老板名单（一个合店可有多名老板，1:N 拆表）',
    columns: {
      id: '记录 ID（自增主键）',
      co_store_id: '所属合店 ID',
      user_id: '合店老板 ID',
      performance: '本人当月销售业绩（元，红分依据，不含合店费）',
      created_at: '加入时间'
    }
  },

  // ── 关系历史 ───────────────────────────────────────────────
  upline_history: {
    table: '上下级关系变更历史（解绑/重绑/改名留痕）',
    columns: {
      id: '记录 ID（自增主键）',
      user_id: '被变更人 ID',
      old_upline: '变更前的直接上级 ID',
      new_upline: '变更后的直接上级 ID',
      action: '变更动作：unbind=解绑 / rebind=重绑 / rename=改名 等',
      at: '变更时间'
    }
  },

  // ── 后台配置 ───────────────────────────────────────────────
  settings: {
    table: '后台可调配置（键值对 + JSON 值，与 store.js DEFAULT_SETTINGS 对齐）',
    columns: {
      id: '记录 ID（自增主键）',
      key: '配置键名（唯一，如 costore / order / dividend / quota / ladder 等）',
      value: '配置值（JSON 字符串）'
    }
  },

  // ── 结算 ───────────────────────────────────────────────────
  settlements: {
    table: '月度结算批次（每次跑批归档一份结果）',
    columns: {
      id: '结算批次 ID（自增主键）',
      period: '结算月份（YYYY-MM）',
      run_at: '跑批执行时间',
      summary: '结算汇总（JSON：byType 分类型合计 / total 总额 / agentBreakdown 代理明细 等）'
    }
  },

  // ── 契约层：账号安全 ───────────────────────────────────────
  sms_codes: {
    table: '短信验证码（按 purpose 场景隔离：register 与 reset-password 互不混用）',
    columns: {
      id: '验证码记录 ID（自增主键）',
      phone: '接收手机号',
      code: '验证码明文',
      purpose: '用途：register=注册 / reset-password=找回密码',
      expires_at: '过期时间（毫秒时间戳）',
      used: '是否已使用（1=已用 / 0=未用）',
      created_at: '发送时间'
    }
  },

  password_resets: {
    table: '密码重置凭据（ticket 为一次性令牌，10 分钟有效）',
    columns: {
      ticket: '重置票据（一次性令牌，主键）',
      phone: '目标账号手机号',
      expires_at: '过期时间（毫秒时间戳，默认 10 分钟）',
      used: '是否已使用（1=已用 / 0=未用）',
      created_at: '创建时间'
    }
  },

  // ── 契约层：权益与资金 ─────────────────────────────────────
  entitlement_orders: {
    table: '权益收益费订单（200 元门禁；幂等键保证重复提交不重复扣费）',
    columns: {
      id: '订单 ID（自增主键）',
      idempotency_key: '幂等键（重复提交返回同一结果）',
      operation_id: '操作流水号（op_xxx，对账用）',
      user_id: '开通人 ID',
      amount: '权益收益费金额（元，默认 200）',
      status: '订单状态（当前为免支付直通占位；正式收银台接入后走三段式）',
      note: '备注',
      at: '业务发生时间（毫秒时间戳）',
      created_at: '记录创建时间'
    }
  },

  pay_accounts: {
    table: '收款账户（提现打款目标；完整卡号仅存本表，对外只返回脱敏值）',
    columns: {
      token: '对外凭据（payee_xxx，不暴露库内主键）',
      user_id: '账户所属人 ID',
      account_type: '账户类型（银行卡/支付宝/微信 等）',
      name: '户名',
      bank_name: '开户行名称',
      bank_number: '完整账号（仅存本表；接口只回 masked_bank_number）',
      masked_bank_number: '脱敏账号（如 ****1234，用于展示）',
      created_at: '创建时间'
    }
  },

  withdrawals: {
    table: '提现单（手续费 0.6%、最低 1 元；审核流目前未接正式打款通道）',
    columns: {
      id: '提现单 ID',
      user_id: '申请人 ID',
      title: '提现标题（如「余额提现」）',
      amount: '提现金额（元）',
      fee: '手续费（元）= 金额 × 0.6%，最低 1 元',
      net_amount: '实际到账金额（元）= amount − fee',
      status: '状态：PENDING_REVIEW=待审核 / APPROVED=已通过 / REJECTED=已驳回 / PAID=已打款 / FAILED=打款失败',
      account_type: '收款账户类型（快照）',
      account_name: '收款户名（快照）',
      bank_name: '开户行（快照）',
      masked_bank_number: '脱敏账号（快照）',
      operation_id: '操作流水号（op_xxx）',
      idempotency_key: '幂等键（重复提交只生成一单）',
      reject_reason: '驳回原因（审核不通过时填写）',
      created_at: '申请时间'
    }
  },

  payments: {
    table: '支付单（微信/支付宝/银行卡 + 银联；权益费、合伙人年费、商城商品、升档共用）',
    columns: {
      id: '支付单 ID',
      biz_type: '业务类型：entitlement=开通权益 / annual_fee=合伙人年费 / quota_purchase=购买名额 / product_order=商城商品订单 / upgrade=合伙人升档',
      biz_id: '关联业务单 ID（可选）',
      user_id: '付款人 ID',
      amount: '支付金额（元）',
      channel: '支付渠道：wechat=微信 / alipay=支付宝 / bank_card=银行卡 / unionpay=银联',
      subject: '支付标题（收银台展示）',
      status: '支付状态：CREATED=已创建 / PAID=已支付 / SUCCEEDED=支付成功 / PROCESSING=处理中 / FAILED=失败 / CLOSED=已关闭 / CANCELLED=已取消',
      transaction_id: '渠道流水号（第三方支付平台返回）',
      idempotency_key: '幂等键（重复下单返回原单）',
      pay_params: '渠道调起参数（JSON，live 模式用）',
      meta: '业务参数（JSON，如 quantity 数量）',
      notify_raw: '渠道异步通知原文（JSON，留痕对账用）',
      note: '备注',
      created_at: '下单时间',
      paid_at: '支付完成时间（毫秒时间戳）'
    }
  },

  quotes: {
    table: '报价单（商城结算/权益开通/升级档位共用；默认 10 分钟有效、一次性消费）',
    columns: {
      id: '报价 ID（quoteId，提交时凭此校验价格）',
      scene: '报价场景：checkout=商城下单 / entitlement=开通权益 / upgrade=合伙人升级 / quota_purchase=购买名额 等',
      user_id: '报价所属用户 ID（未登录报价可为空或 anonymous）',
      amount: '报价总金额（元）',
      breakdown: '费用明细（JSON：goodsAmount 商品额 / discountAmount 优惠额 / listAmount 原价额）',
      items: '商品明细（JSON：[{key,qty,skuId}]）',
      meta: '业务上下文（JSON：{productKey,level,memberId,skuId}）',
      rule_version: '计价规则版本号（规则升级后旧报价可识别失效）',
      issued_at: '报价生成时间（毫秒时间戳）',
      expires_at: '报价过期时间（毫秒时间戳）',
      consumed: '是否已消费（1=已被订单占用，防止重复下单）',
      consumed_at: '消费时间（毫秒时间戳）',
      consumed_ref: '消费方引用（如订单 ID）'
    }
  },

  // ── 契约层：申请与门店 ─────────────────────────────────────
  applications: {
    table: '申请单（合伙人/健脑官/合店/代理/转店 统一申请流）',
    columns: {
      id: '申请单 ID',
      type: '申请类型：PARTNER=合伙人 / COACH=健脑官 / COSTORE=合店 / AGENT=代理 / TRANSFER=转店',
      title: '申请标题（列表展示）',
      application_status: '审批状态：PENDING_REVIEW=待审核 / APPROVED=已通过 / REJECTED=已驳回 / CANCELLED=已取消',
      payment_status: '支付状态：NOT_STARTED=未支付 / PAID=已支付 / REFUNDED=已退款',
      contract_status: '合同状态：NOT_SIGNED=未签 / SIGNED=已签',
      entitlement_status: '权益状态：NOT_OPEN=未开通 / OPEN=已开通 / EXPIRED=已过期',
      user_id: '申请人 ID（家长账号）',
      member_id: '关联会员 ID（转店场景）',
      store_id: '目标门店 ID（regional_agents.store 或门店标识）',
      store_agent_id: '门店代理记录 ID',
      target_store_id: '转店目标门店 ID',
      agency_type: '代理类型（省代/市代/县区代 等）',
      payable_amount: '应付金额（元）',
      store: '门店信息快照（JSON）',
      idempotency_key: '幂等键（重复提交只生成一单）',
      created_at: '申请时间',
      version: '乐观锁版本号（每次更新 +1，防并发覆盖）'
    }
  },

  store_transfers: {
    table: '转店申请（会员在门店之间转移）',
    columns: {
      id: '转店单 ID',
      member_id: '转店会员 ID（members.id）',
      from_store_id: '原门店 ID',
      target_store_id: '目标门店 ID',
      reason: '转店原因',
      status: '状态：PENDING=待审核 / APPROVED=已通过 / REJECTED=已驳回 / CANCELLED=已取消',
      user_id: '发起人 ID（家长账号）',
      store_agent_id: '目标门店代理记录 ID',
      idempotency_key: '幂等键（重复提交只生成一单）',
      created_at: '申请时间',
      version: '乐观锁版本号'
    }
  },

  // ── 契约层：家庭会员 ───────────────────────────────────────
  members: {
    table: '家庭会员（孩子档案；六级会员等级 normal<fs<jy<cj<xn<ys 决定板块权益解锁）',
    columns: {
      id: '会员 ID（孩子档案唯一标识）',
      user_id: '所属家长账号 ID',
      name: '孩子姓名',
      grade_code: '年级代码（如 K1/K2/K3、G1..G6）',
      grade_label: '年级名称（如「三年级」）',
      gender_code: '性别代码',
      gender_label: '性别名称',
      avatar_asset_id: '头像资源 ID（assets.id）',
      avatar_url: '头像地址（冗余存储，读时免关联查询）',
      store_id: '绑入门店 ID（健脑官归属门店）',
      activated: '是否已激活会员身份（1=已激活 / 0=未激活）',
      member_level: '孩子会员等级：normal=普通游客 / fs=粉丝 / jy=一阶菁英 / cj=一阶超级 / xn=二阶行能 / ys=三阶羿烁',
      member_seq: '孩子全局添加序号（第几个添加第几）',
      display_id: '孩子对外编号：等级前缀 + member_seq（如 FS3000；升级只变前缀、编号不变）',
      unlocked_levels: '历史通过 level 类激活码单开的等级（JSON 数组，兼容旧数据）',
      unlocked_columns: '已解锁的专栏 ID 数组（JSON）',
      training: '培训额度（JSON：trainingTotal 总额 / trainingUsed 已用 / special 专项 等）',
      idempotency_key: '幂等键（重复提交只创建一条档案）',
      created_at: '创建时间',
      version: '乐观锁版本号'
    }
  },

  activation_codes: {
    table: '激活码（level=学习等级单开 / column=专栏 / fs·jy·cj·xn·ys=孩子会员等级）',
    columns: {
      code: '激活码明文（主键）',
      target_type: '激活目标类型：level=学习等级单开 / column=专栏 / fs=粉丝 / jy=菁英 / cj=超级 / xn=行能 / ys=羿烁（兼容旧 member=fs）',
      target_id: '目标 ID（会员等级码为空；专栏码为专栏 ID）',
      max_uses: '最大可用次数（1=一次性）',
      uses: '已使用次数',
      status: '状态：active=可用 / void=作废',
      expires_at: '过期时间（毫秒时间戳）',
      used_by: '核销台账（JSON：[{memberId, at, channel, issuedBy}]）',
      channel: '发放渠道：admin=后台 / store=门店收款发码 / upline=上级赠码',
      store_id: '门店发码时的代理区域码',
      issued_by: '发放人 ID（admin 渠道固定为 admin）',
      issued_to: '绑定家长 ID（赠码场景：仅此人可激活）',
      batch_id: '批量发放批次号',
      note: '备注',
      created_at: '发放时间'
    }
  },

  coaches: {
    table: '健脑官（门店独立登录账号；与家长账号体系分离）',
    columns: {
      id: '健脑官 ID',
      store_id: '所属门店 ID',
      name: '姓名',
      login_account: '登录账号（手机号）',
      status: '账号状态：ACTIVE=启用 / DISABLED=禁用',
      invitation_status: '邀请状态：PENDING=待接受 / ACCEPTED=已接受 / REJECTED=已拒绝',
      idempotency_key: '幂等键（重复提交只建一个账号）',
      created_at: '创建时间',
      version: '乐观锁版本号'
    }
  },

  addresses: {
    table: '收货地址',
    columns: {
      id: '地址 ID',
      user_id: '所属用户 ID',
      recipient: '收货人姓名',
      phone: '收货人电话',
      region_codes: '行政区划码数组（JSON）',
      region_names: '行政区划名称数组（JSON，与 region_codes 同序）',
      detail: '详细地址（街道门牌）',
      is_default: '是否默认地址（1=是 / 0=否）',
      created_at: '创建时间',
      version: '乐观锁版本号'
    }
  },

  coupons: {
    table: '优惠券（用户券包；下单时核销）',
    columns: {
      id: '优惠券 ID',
      user_id: '所属用户 ID',
      title: '优惠券名称',
      discount_amount: '优惠金额（元）',
      threshold_text: '使用门槛文案（如「满 1000 元可用」）',
      scope_label: '适用范围文案',
      status: '状态：available=未使用 / used=已使用 / void=已作废',
      expires_at: '过期时间（毫秒时间戳）',
      created_at: '发放时间'
    }
  },

  support_feedback: {
    table: '客服反馈（用户提交的问题与建议）',
    columns: {
      id: '反馈 ID',
      user_id: '提交人 ID',
      content: '反馈正文',
      image_asset_ids: '图片资源 ID 数组（JSON）',
      idempotency_key: '幂等键（重复提交只留一条）',
      created_at: '提交时间'
    }
  },

  learning_progress: {
    table: '学习进度（会员 × 学习等级 × 章节 三元组记录）',
    columns: {
      member_id: '会员 ID（孩子）',
      level_id: '学习等级 ID',
      chapter_id: '章节 ID',
      position_seconds: '当前播放/学习位置（秒，断点续学用）',
      duration_seconds: '该章节总时长（秒）',
      completed: '是否已完成（1=完成 / 0=未完成）',
      updated_at: '更新时间（毫秒时间戳）'
    }
  },

  // ── 契约层：收益分配 ───────────────────────────────────────
  allocations: {
    table: '收益分配（门店服务费/合店分红指向具体受益人；巡查 5% 与销售 5% 可自选分配）',
    columns: {
      id: '分配记录 ID',
      entry_id: '被分配的收益条目 ID（commissions.id）',
      user_id: '操作人 ID（店长/老板，执行分配的人）',
      target_id: '受益人 ID',
      beneficiary_name: '受益人姓名（冗余快照）',
      kind: '分配场景：sales=销售 5% / inspection=巡查 5%',
      percent: '分配比例（百分比，如 5 表示 5%）',
      amount: '分配金额（元）',
      status: '状态：PENDING_SETTLEMENT=待结算 / SETTLED=已结算 / CANCELLED=已取消',
      operation_id: '操作流水号（op_xxx，对账用）',
      idempotency_key: '幂等键（重复提交只分配一次）',
      created_at: '创建时间'
    }
  },

  allocation_quotes: {
    table: '分配意愿报价单（巡查 5% / 销售 5% 的分配方案快照，提交时据此校验）',
    columns: {
      id: '报价单 ID',
      entry_id: '被分配的收益条目 ID',
      user_id: '报价人 ID',
      kind: '分配场景：inspect=巡查 / sales=销售',
      targets: '分配目标（JSON：语义键 + 比例，如 [{key,percent}]）',
      entry_amount: '被分配条目的总金额（元）',
      rows: '解析后的收款人明细（JSON）',
      total_percent: '分配比例合计（百分比）',
      total_amount: '分配金额合计（元）',
      expires_at: '报价过期时间（毫秒时间戳）',
      created_at: '报价生成时间（毫秒时间戳）'
    }
  },

  training_feedback: {
    table: '训练反馈（家长/健脑官针对会员提交的课后反馈）',
    columns: {
      id: '反馈 ID',
      member_id: '关联会员 ID（members.id）',
      kind: '反馈类型（训练记录/身体状况等）',
      title: '反馈标题',
      text: '反馈正文',
      coach_id: '健脑官 ID（coaches.id）',
      coach_name: '健脑官姓名（冗余快照）',
      image_asset_ids: '图片资源 ID 数组（JSON）',
      attachment_asset_ids: '附件资源 ID 数组（JSON）',
      idempotency_key: '幂等键（重复提交只留一条）',
      created_at: '提交时间'
    }
  },

  // ── 契约层：资源与任务 ─────────────────────────────────────
  assets: {
    table: '上传资源（直传占位；状态机 PENDING→READY/FAILED）',
    columns: {
      id: '资源 ID',
      user_id: '上传人 ID',
      purpose: '资源用途：avatar=头像 / material-qr=素材二维码 / feedback-image=反馈图片 等',
      file_name: '原始文件名',
      mime_type: 'MIME 类型（如 image/png）',
      size: '文件大小（字节）',
      status: '状态：PENDING=上传中 / READY=可用 / FAILED=失败',
      preview_url: '访问地址（当前为 Mock CDN 地址）',
      fail_reason: '失败原因',
      created_at: '上传时间'
    }
  },

  material_renders: {
    table: '素材渲染记录（海报合成幂等键，防止重复渲染）',
    columns: {
      id: '渲染记录 ID',
      material_id: '素材 ID（待渲染的原始素材）',
      qr_asset_id: '二维码资源 ID（assets.id）',
      user_id: '发起渲染的用户 ID',
      idempotency_key: '幂等键（同一素材重复提交只渲染一次）',
      created_at: '创建时间'
    }
  },

  jobs: {
    table: '异步任务（海报合成等；queued→running→succeeded/failed）',
    columns: {
      id: '任务 ID',
      type: '任务类型：POSTER_RENDER=海报合成 等',
      material_id: '关联素材 ID',
      qr_asset_id: '关联二维码资源 ID',
      user_id: '任务发起人 ID',
      status: '任务状态：queued=排队中 / running=执行中 / succeeded=成功 / failed=失败',
      message: '执行结果消息（失败时为错误原因）',
      download_url: '产物下载地址',
      share_url: '产物分享链接',
      idempotency_key: '幂等键（重复提交只建一个任务）',
      created_at: '创建时间'
    }
  },

  // ── 后台可调与成长体系 ─────────────────────────────────────
  app_settings: {
    table: '后台可调配置（JSON 单行存储；与 store.js DEFAULT_SETTINGS 对齐）',
    columns: {
      id: '配置 ID（单行固定值）',
      payload: '配置内容（JSON 对象，含 costore/order/dividend/quota/ladder 等全部可调参数）'
    }
  },

  experience_ledger: {
    table: '经验值流水（1 元 = 1 经验值；纯记账，不参与资金分账）',
    columns: {
      id: '流水 ID',
      user_id: '获得人 ID',
      tab: '归属页签：promotion=业务推广 / product=购买产品',
      event: '事件类型：upgrade=升档 / costore=合店 / agent=代理 / product=购买产品',
      title: '事件标题（列表展示）',
      points: '经验值增量（按「1 元 = 1 经验值」折算）',
      price: '对应金额（元）',
      ref_id: '关联业务 ID（用于防重复记账）',
      meta: '附加信息（JSON）',
      occurred_at: '发生时间（毫秒时间戳）'
    }
  },

  promotion_tasks: {
    table: '晋升任务（推广达标免费晋升通道；默认 1 年有效期）',
    columns: {
      id: '任务 ID',
      user_id: '任务归属人 ID',
      start_tier: '任务发起时所在档位',
      valid_until: '任务失效时间（毫秒时间戳）',
      valid_months: '有效月数（默认 12 个月）',
      targets: '达标目标（JSON：[{key,label,required}]，如直推私董 3 人、直推 VIP 18 人）',
      status: '任务状态：ONGOING=进行中 / ACHIEVED=已达标 / CLAIMED=已领取 / EXPIRED=已过期',
      achieved_at: '达标时间（毫秒时间戳）',
      granted_tier: '实际授予的档位',
      claimed_at: '领取时间（毫秒时间戳）',
      created_at: '创建时间（毫秒时间戳）'
    }
  },

  free_upgrade_log: {
    table: '拉人免费升档日志（规则A 按人数 / 规则B 按业绩，取进度较高者）',
    columns: {
      id: '日志 ID',
      user_id: '被升档人 ID',
      from_tier: '升档前档位',
      to_tier: '升档后档位',
      rule: '触发规则：count=规则A 人数达标 / performance=规则B 业绩达标',
      trigger_ref: '触发来源引用（如达标下级 ID）',
      note: '备注',
      created_at: '发生时间（毫秒时间戳）'
    }
  },

  wechat_tickets: {
    table: '微信授权票据（一次一换；live / mock 双模式）',
    columns: {
      id: '票据记录 ID',
      openid: '用户 OpenID',
      ticket: '微信票据凭证（主查询键）',
      mode: '模式：mock=模拟 / live=真实微信',
      used: '是否已核销（1=已用 / 0=未用，一次一换）',
      expires_at: '过期时间（毫秒时间戳）',
      created_at: '创建时间（毫秒时间戳）'
    }
  },

  invite_codes: {
    table: '邀请码流水（两套互不混用：register 注册拉新码 / agent 代理归属码；R 开头=注册，A 开头=代理）',
    columns: {
      code: '邀请码（R+8位BASE36=注册码 / A+8位BASE36=代理码）',
      type: '类型：register=拉新注册码（绑定推荐人 upline） / agent=代理归属码（绑定推荐代理 referrer）',
      owner_id: '邀请码持有人 ID',
      created_at: '生成时间（毫秒时间戳）',
      expires_at: '过期时间（毫秒时间戳，默认 30 天）',
      max_use: '最大使用次数（0=不限次）',
      used_by: '使用记录（JSON 数组，记录每个使用者）',
      status: '状态：active=可用 / void=作废'
    }
  },

  // ── 商城与商品 ─────────────────────────────────────────────
  skus: {
    table: '商城 SKU 目录（按规格细分的价格与库存）',
    columns: {
      id: 'SKU ID',
      product_id: '所属商品 ID（productId）',
      label: '规格名（如「智能变速，一档」）',
      list_price: '该规格标价（元）',
      stock: '当前可售库存',
      updated_at: '更新时间（毫秒时间戳）'
    }
  },

  stock_ledger: {
    table: 'SKU 库存台账（每次出入库一条流水，可回溯库存变化）',
    columns: {
      id: '流水 ID',
      sku_id: 'SKU ID',
      delta: '库存变动量（正=入库，负=出库）',
      reason: '变动原因：ORDER_CREATE=下单扣减 / ORDER_CANCEL_RESTORE=取消回补 / ADMIN_ADJUST=后台调整 等',
      order_id: '关联订单 ID（无则为空）',
      operator_id: '操作人 ID（用户或后台管理员）',
      at: '发生时间（毫秒时间戳）',
      balance_after: '该笔变动之后的结存库存'
    }
  },

  columns: {
    table: '专栏（可激活内容包；章节与正文以 JSON 保存，结构见 src/columns.js）',
    columns: {
      id: '专栏 ID（col_1 等；与激活码种子、商城商品同名，三处必须一致）',
      title: '专栏标题',
      summary: '专栏简介',
      cover_url: '封面图地址',
      price: '标价（元）',
      fulfillment_type: '履约方式：ACTIVATION_CODE=通过激活码发货 等',
      requires_member: '是否要求会员身份才能购买（1=是 / 0=否）',
      price_presentation: '价格展示方式：single=单一口径 / tiered=按档位分档价',
      checkout_notice: '下单提示语（如「下单后联系门店获取激活码」）',
      content: '富文本正文（JSON，nodes 结构，见 src/richContent.js）',
      chapters: '章节数组（JSON：[{id,title,type,content,videoUrl}]）'
    }
  },

  activity_prices: {
    table: '商品活动价（每个商品一条；未配置则无记录，前端显示「—」）',
    columns: {
      product_id: '商品 ID（主键）',
      amount: '活动价（元）',
      note: '活动说明',
      updated_at: '更新时间（毫秒时间戳）'
    }
  }
};

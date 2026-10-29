/**
 * 脑商AI · db.json 集合 → 关系表 统一映射口径
 *
 * 这是「健康检查(db_health)」与「MySQL 同步(sync_to_mysql)」共用的唯一真源，
 * 避免两套实现漂移导致迁移漏数据。
 *
 * forEachInsert(db, insert)：
 *   insert(table, cols, rows) 对每个关系表调用一次；
 *   rows 为对象数组，键名 = 列名（snake_case），值已为可直接落库的形式
 *   （JSON 列已 JSON.stringify 成字符串；数值/字符串保持原值；缺省列值为 undefined，
 *    由各自的 sink 在写入时转为 NULL）。
 */
const j = (v) => (v == null ? null : JSON.stringify(v));
const MONEY_SHADOW = require('../src/common/api-standard/money-shadow');

function forEachInsert(db, sink, declare) {
  // ── 聚合层 ────────────────────────────────────────────────────────
  // 同一张关系表可能被多次 insert（如 users：业务用户 + 系统账号；orders：主表 + 合店费单补登）。
  // sink 若逐次「DELETE + INSERT」，第二次会清掉第一次的数据。
  // 这里按表名聚合所有行、合并列集合，最后对每张表只调用一次 sink。
  const plan = new Map(); // table → { cols:Set, rows:[] }
  const insert = (table, cols, rows) => {
    // 「声明」与「写数据」分离：
    //   declare 用于告诉调用方「这张表属于本映射的管辖范围」，
    //   与当前是否有数据**无关**。这是防数据静默丢失的关键 ——
    //   若判定只看「此刻表里有没有数据」，那么某张表此刻为空被判为可写，
    //   同事写入后系统一旦产生该表数据，同步器就会 DELETE FROM + 重建，
  //   同事写的内容被抹掉且无法找回。
    if (declare) declare(table);
    if (!rows || !rows.length) return;
    let p = plan.get(table);
    if (!p) { p = { cols: new Set(), rows: [] }; plan.set(table, p); }
    for (const c of cols) p.cols.add(c);
    for (const r of rows) p.rows.push(r);
  };

  buildPlan(db, insert);

  for (const [table, p] of plan) {
    // 列顺序：先按首次出现顺序，再用后续出现补齐；保证每行列键齐全
    const cols = [...p.cols];
    sink(table, cols, p.rows.map((r) => {
      const o = {};
      for (const c of cols) o[c] = r[c] === undefined ? undefined : r[c];
      return o;
    }));
  }
}

/**
 * 列出本映射**管辖的全部表名**（与数据量无关）。
 * 用于判定「哪些表会被同步器覆盖」——必须用这个全量口径，
 * 而不是「当前哪些表有数据」，否则会出现时序漏洞。
 */
function declaredTables(db) {
  const set = new Set();
  forEachInsert(db, () => {}, (t) => set.add(t));
  return [...set];
}

function buildPlan(db, insert) {
  // users（先插，否则全部外键失败）
  const users = Object.entries(db.users || {});
  insert('users',
    ['id', 'seq', 'display_id', 'name', 'phone', 'tier', 'is_founding', 'upline_id',
      'team_vip', 'annual_fee_paid', 'entitlement_state', 'entitlement_paid_at',
      'entitlement_expires_at', 'created_at', 'principal_tier', 'referral_tier',
      'referral_upline_tier', 'free_upgrade_applied', 'password', 'password_migrated_at'],
    users.map(([id, u]) => ({
      id, seq: u.seq, display_id: u.display_id, name: u.name || '', phone: u.phone || '',
      tier: u.tier || 'none', is_founding: u.is_founding || 'none', upline_id: u.upline_id || null,
      team_vip: u.teamVip || 0, annual_fee_paid: u.annual_fee_paid === false ? 0 : 1,
      entitlement_state: u.entitlement_state || 'active',
      entitlement_paid_at: u.entitlement_paid_at || null,
      entitlement_expires_at: u.entitlement_expires_at || null,
      created_at: u.created_at || null,
      principal_tier: u.principal_tier || null,
      referral_tier: u.referral_tier || null,
      referral_upline_tier: u.referral_upline_tier || null,
      free_upgrade_applied: u.free_upgrade_applied || 0,
      // 口令哈希（scrypt$salt$hash）；缺失时留空，绝不回退明文
      password: u.password || null,
      password_migrated_at: u.password_migrated_at || null,
    })));

  // ── 系统账号（虚拟主体）────────────────────────────────────────
  const SYSTEM_USERS = [
    { id: 'HQ', name: '总部', tier: 'system', seq: 900001, displayId: 'HQ', phone: 'sys-hq' },
    { id: 'DIVIDEND', name: '分红池', tier: 'system', seq: 900002, displayId: 'DIVIDEND', phone: 'sys-dividend' },
    { id: 'admin', name: '总部后台', tier: 'system', seq: 900003, displayId: 'ADMIN', phone: 'sys-admin' },
  ];
  const existingUserIds = new Set(users.map(([id]) => id));
  const systemRows = SYSTEM_USERS
    .filter((su) => !existingUserIds.has(su.id))
    .map((su) => ({
      id: su.id, seq: su.seq, display_id: su.displayId, name: su.name, phone: su.phone, tier: su.tier,
      is_founding: 'none', upline_id: null, team_vip: 0, annual_fee_paid: 0,
      entitlement_state: 'active', entitlement_paid_at: null, entitlement_expires_at: null,
      created_at: new Date().toISOString(),
      principal_tier: null, referral_tier: null, referral_upline_tier: null, free_upgrade_applied: 0,
    }));
  if (systemRows.length) {
    insert('users',
      ['id', 'seq', 'display_id', 'name', 'phone', 'tier', 'is_founding', 'upline_id',
        'team_vip', 'annual_fee_paid', 'entitlement_state', 'entitlement_paid_at',
        'entitlement_expires_at', 'created_at', 'principal_tier', 'referral_tier',
        'referral_upline_tier', 'free_upgrade_applied'],
      systemRows);
  }

  // -- 短信验证码（smsChallenges → sms_codes）----------------------
  // db.json 侧：{ phone, code, purpose, expiresAt(ms), used }
  // MySQL 侧：id 自增，expires_at 为毫秒时间戳，used 为 0/1
  const challengeRows = (db.smsChallenges || [])
    .filter((c) => c && c.phone && c.code)
    .map((c) => ({
      phone: c.phone,
      code: String(c.code),
      purpose: c.purpose || 'register',
      expires_at: c.expiresAt || 0,
      used: c.used ? 1 : 0,
      created_at: c.createdAt ? new Date(c.createdAt).toISOString().slice(0, 19).replace('T', ' ')
        : new Date().toISOString().slice(0, 19).replace('T', ' '),
    }));
  if (challengeRows.length) {
    // id 为 AUTO_INCREMENT 自增列，不显式赋值
    insert('sms_codes',
      ['phone', 'code', 'purpose', 'expires_at', 'used', 'created_at'],
      challengeRows);
  }

  // -- 密码重置票据（passwordResets → password_resets）--------------
  const resetRows = (db.passwordResets || [])
    .filter((r) => r && r.ticket && r.phone)
    .map((r) => ({
      ticket: r.ticket,
      phone: r.phone,
      expires_at: r.expiresAt || 0,
      used: r.used ? 1 : 0,
      created_at: r.createdAt ? new Date(r.createdAt).toISOString().slice(0, 19).replace('T', ' ')
        : new Date().toISOString().slice(0, 19).replace('T', ' '),
    }));
  if (resetRows.length) {
    insert('password_resets',
      ['ticket', 'phone', 'expires_at', 'used', 'created_at'],
      resetRows);
  }

  // -- 合店费单补登为 orders 行 -------------------------------------
  const coStoreIds = new Set((db.orders || []).map((o) => o.id));
  const coStoreRows = (db.coStores || [])
    .filter((cs) => cs && cs.id && !coStoreIds.has(cs.id))
    .map((cs) => ({
      id: cs.id, buyer_id: cs.owner_id || 'HQ', seller_id: cs.promoter_id || null,
      package_tier: 'vip', old_tier: null, quota_count: 1, vip_credit: 0,
      actual_paid: cs.monthly_fee || 698, seller_cost: 0, supply_spread: 0,
      store_fee: 0, hq_fee: 0, region_code: cs.store_id || null,
      channel: 'partner', store_id: cs.store_id || null, status: 'paid',
      created_at: cs.created_at || cs.joinDate || null,
    }));
  if (coStoreRows.length) {
    insert('orders',
      ['id', 'buyer_id', 'seller_id', 'package_tier', 'old_tier', 'quota_count', 'vip_credit',
        'actual_paid', 'seller_cost', 'supply_spread', 'store_fee', 'hq_fee', 'region_code',
        'channel', 'store_id', 'status', 'created_at'],
      coStoreRows);
  }

  insert('quota_ledger', ['user_id', 'standard'],
    Object.entries(db.quotaLedger || {}).map(([id, b]) => ({
      user_id: id,
      standard: typeof b === 'number' ? b : (b.standard || 0),
    })));

  insert('quota_activity_batches', ['user_id', 'qty', 'obtained_at', 'expire_at'],
    Object.entries(db.quotaLedger || {}).flatMap(([id, b]) =>
      (typeof b === 'object' && Array.isArray(b.activity) ? b.activity : []).map((a) => ({
        user_id: id, qty: a.qty || 0, obtained_at: a.obtainedAt || null, expire_at: a.expireAt || null,
      }))));

  insert('experience_ledger',
    ['id', 'user_id', 'tab', 'event', 'title', 'points', 'price', 'ref_id', 'meta', 'occurred_at'],
    (db.experience || []).map((e) => ({
      id: e.id, user_id: e.userId, tab: e.tab || 'promotion', event: e.event || '',
      title: e.title || null, points: e.points || 0, price: e.price || 0,
      ref_id: e.refId || null, meta: j(e.meta || {}), occurred_at: e.occurredAt || 0,
    })));

  insert('promotion_tasks',
    ['id', 'user_id', 'start_tier', 'valid_until', 'valid_months', 'targets', 'status',
      'achieved_at', 'granted_tier', 'claimed_at', 'created_at'],
    (db.promotionTasks || []).map((t) => ({
      id: t.id, user_id: t.userId, start_tier: t.startTier || null, valid_until: t.validUntil || null,
      valid_months: t.validMonths || 12, targets: j(t.targets || []), status: t.status || 'ONGOING',
      achieved_at: t.achievedAt || null, granted_tier: t.grantedTier || null,
      claimed_at: t.claimedAt || null, created_at: t.createdAt || 0,
    })));

  insert('free_upgrade_log',
    ['id', 'user_id', 'from_tier', 'to_tier', 'rule', 'trigger_ref', 'note', 'created_at'],
    (db.freeUpgradeLog || []).map((g) => ({
      id: g.id, user_id: g.userId, from_tier: g.fromTier || null, to_tier: g.toTier || null,
      rule: g.rule || null, trigger_ref: g.triggerRef || null, note: g.note || null,
      created_at: g.createdAt || 0,
    })));

  insert('invite_codes',
    ['code', 'type', 'owner_id', 'created_at', 'expires_at', 'max_use', 'used_by', 'status'],
    (db.inviteCodes || []).map((c) => ({
      code: c.code, type: c.type || 'register', owner_id: c.ownerId,
      created_at: c.createdAt || 0, expires_at: c.expiresAt || null, max_use: c.maxUse || 0,
      used_by: j(c.usedBy || []), status: c.status || 'active',
    })));

  insert('wechat_tickets',
    ['id', 'openid', 'ticket', 'mode', 'used', 'expires_at', 'created_at'],
    (db.wechatTickets || []).map((w) => ({
      id: w.id, openid: w.openid || null, ticket: w.ticket, mode: w.mode || 'mock',
      used: w.used ? 1 : 0, expires_at: w.expiresAt || 0, created_at: w.createdAt || 0,
    })));

  insert('orders',
    ['id', 'buyer_id', 'seller_id', 'package_tier', 'old_tier', 'quota_count', 'vip_credit',
      'actual_paid', 'seller_cost', 'supply_spread', 'store_fee', 'hq_fee', 'region_code',
      'status', 'created_at'],
    (db.orders || []).map((o) => ({
      id: o.id, buyer_id: o.buyer_id, seller_id: o.seller_id,
      package_tier: o.packageTier || (['vip', 'angel', 'private', 'cofounder'].includes(o.level) ? o.level : 'vip'),
      old_tier: o.oldTier || null, quota_count: o.quotaCount || 1, vip_credit: o.vipCredit || 1,
      actual_paid: o.actual_paid ?? o.actualPaid ?? 0, seller_cost: o.sellerCost || 0,
      supply_spread: o.supply_spread || 0, store_fee: o.store_fee || 0, hq_fee: o.hq_fee || 0,
      region_code: o.regionCode || null, status: o.status || 'paid', created_at: o.created_at || null,
    })));

  insert('commissions',
    ['id', 'owner_id', 'type', 'subtype', 'period', 'base_amount', 'rate', 'amount',
      'ref_order_id', 'status', 'note', 'formula', 'created_at'],
    (db.commissions || []).map((c) => ({
      id: c.id, owner_id: c.owner_id, type: c.type || '', subtype: c.subtype || null,
      period: c.period || null, base_amount: c.base_amount || 0, rate: c.rate ?? null,
      amount: c.amount || 0, ref_order_id: c.ref_order_id || null, status: c.status || 'pending',
      note: c.note || null, formula: c.formula || null, created_at: c.created_at || null,
    })));

  insert('regional_agents',
    ['id', 'user_id', 'region_type', 'region_code', 'price_tier', 'referrer_id', 'granted_tier', 'appointed_at'],
    (db.regionalAgents || []).map((a) => ({
      id: a.id, user_id: a.partner_id, region_type: a.region_type, region_code: a.region_code,
      price_tier: a.price_tier || 0, referrer_id: a.referrer_id || null,
      granted_tier: a.granted_tier || null, appointed_at: a.appointed_at || null,
    })));

  insert('quota_transactions',
    ['user_id', 'op', 'kind', 'used_standard', 'used_activity', 'amount', 'ref', 'operator_id', 'created_at'],
    (db.quota_transactions || []).map((q) => {
      const isIssue = q.type === 'issue';
      const standard = isIssue && q.kind !== 'activity' ? (q.qty || 0) : 0;
      const activity = isIssue && q.kind === 'activity' ? (q.qty || 0) : 0;
      return {
        user_id: q.partnerId,
        op: isIssue ? 'issue' : 'consume',
        kind: q.kind || null,
        used_standard: standard,
        used_activity: activity,
        amount: q.qty || 0,
        ref: q.ref || null,
        operator_id: q.operatorId || null,
        created_at: q.at || null,
      };
    }));

  insert('co_stores',
    ['id', 'owner_id', 'promoter_id', 'store_manager_id', 'store_id', 'monthly_fee',
      'owner_count', 'join_date', 'created_at'],
    (db.coStores || []).map((cs) => ({
      id: cs.id, owner_id: cs.owner_id || 'HQ', promoter_id: cs.promoter_id || null,
      store_manager_id: cs.storeManagerId || null, store_id: cs.store_id || null,
      monthly_fee: cs.monthly_fee || 698, owner_count: cs.ownerCount || 1,
      join_date: cs.joinDate || null, created_at: cs.created_at || null,
    })));

  insert('co_store_owners', ['co_store_id', 'user_id', 'performance', 'created_at'],
    (db.coStores || []).flatMap((cs) =>
      ((cs.owners || cs.partners || [])).map((o) => ({
        co_store_id: cs.id, user_id: o.id, performance: o.performance || 0, created_at: cs.created_at || null,
      }))));

  // allocations：聚合对象 → 规范化表（每行一个收款人）
  {
    const allocRows = [];
    for (const al of (db.allocations || [])) {
      const rows = (al.rows && al.rows.length) ? al.rows : [{}];
      rows.forEach((row, idx) => {
        const kind = al.kind === 'inspect' ? 'inspection' : (al.kind || 'sales');
        allocRows.push({
          id: `${al.id}-${idx}`,
          entry_id: al.entryId || '',
          user_id: al.operatorId || al.userId || 'HQ',
          target_id: row.targetId || 'HQ',
          beneficiary_name: row.name || '',
          kind,
          percent: row.percent || 0,
          amount: row.amount || 0,
          status: al.status || 'PENDING_SETTLEMENT',
          operation_id: `op-${al.id}`,
          idempotency_key: idx === 0 ? (al.idempotencyKey || null) : null,
          created_at: al.createdAt || null,
        });
      });
    }
    if (allocRows.length) {
      insert('allocations',
        ['id', 'entry_id', 'user_id', 'target_id', 'beneficiary_name', 'kind', 'percent', 'amount',
          'status', 'operation_id', 'idempotency_key', 'created_at'],
        allocRows);
    }
  }

  insert('payments',
    ['id', 'biz_type', 'biz_id', 'user_id', 'amount', 'channel', 'subject', 'status',
      'transaction_id', 'idempotency_key', 'pay_params', 'meta', 'notify_raw', 'note',
      'created_at', 'paid_at'],
    (db.payments || []).map((pm) => ({
      id: pm.id,
      biz_type: pm.bizType || 'entitlement',
      biz_id: pm.bizId || null,
      user_id: pm.userId || 'HQ',
      amount: pm.amount || 0,
      channel: pm.channel || 'wechat',
      subject: pm.subject || '',
      status: pm.status || 'CREATED',
      transaction_id: pm.transactionId || null,
      idempotency_key: pm.idempotencyKey || null,
      pay_params: j(pm.payParams || {}),
      meta: j(pm.meta || {}),
      notify_raw: j(pm.notifyRaw || null),
      note: pm.note || null,
      created_at: pm.createdAt || null,
      paid_at: pm.paidAt || null,
    })));

  insert('activation_codes',
    ['code', 'target_type', 'target_id', 'max_uses', 'uses', 'status', 'expires_at', 'used_by',
      'channel', 'store_id', 'issued_by', 'issued_to', 'batch_id'],
    (db.activationCodes || []).map((a) => ({
      code: a.code, target_type: a.targetType || 'fs', target_id: a.targetId || null,
      max_uses: a.maxUses || 1, uses: a.uses || 0, status: a.status || 'active',
      expires_at: a.expiresAt || 0, used_by: j(a.usedBy || []),
      channel: a.channel || 'admin', store_id: a.storeId || null, issued_by: a.issuedBy || null,
      issued_to: a.issuedTo || null, batch_id: a.batchId || null,
    })));

  insert('coupons',
    ['id', 'user_id', 'title', 'discount_amount', 'threshold_text', 'scope_label', 'status', 'expires_at', 'created_at'],
    (db.coupons || []).map((c) => ({
      id: c.id, user_id: c.userId, title: c.title || '', discount_amount: c.discountAmount || 0,
      threshold_text: c.thresholdText || '', scope_label: c.scopeLabel || '',
      status: c.status || 'available', expires_at: c.expiresAt || 0, created_at: c.createdAt || null,
    })));

  insert('assets',
    ['id', 'user_id', 'purpose', 'file_name', 'mime_type', 'size', 'status', 'preview_url', 'fail_reason', 'created_at'],
    (db.assets || []).map((a) => ({
      id: a.id, user_id: a.userId || null, purpose: a.purpose || '', file_name: a.fileName || '',
      mime_type: a.mimeType || '', size: a.size || 0, status: a.status || 'PENDING',
      preview_url: a.previewUrl || null, fail_reason: a.failReason || null, created_at: a.createdAt || null,
    })));

  insert('jobs',
    ['id', 'type', 'material_id', 'qr_asset_id', 'user_id', 'status', 'message', 'download_url',
      'share_url', 'idempotency_key', 'created_at'],
    (db.jobs || []).map((jb) => ({
      id: jb.id, type: jb.type || 'POSTER_RENDER', material_id: jb.materialId || null,
      qr_asset_id: jb.qrAssetId || null, user_id: jb.userId || null, status: jb.status || 'queued',
      message: jb.message || null, download_url: jb.downloadUrl || null, share_url: jb.shareUrl || null,
      idempotency_key: jb.idempotencyKey || null, created_at: jb.createdAt || null,
    })));

  insert('hq_admins',
    ['admin_id', 'username', 'display_name', 'role', 'password', 'hq_permissions',
      'status', 'created_at', 'version'],
    (db.hqAdmins || []).map((a) => ({
      admin_id: a.adminId, username: a.username || '', display_name: a.displayName || '',
      role: a.role || 'admin', password: a.password || '',
      hq_permissions: j(a.hqPermissions || []), status: a.status || 'ACTIVE',
      created_at: a.createdAt || null, version: Number(a.version || 1),
    })));

  insert('learning_progress',
    ['member_id', 'level_id', 'chapter_id', 'position_seconds', 'duration_seconds', 'completed', 'updated_at'],
    (db.learningProgress || []).map((lp) => ({
      member_id: lp.memberId, level_id: lp.levelId, chapter_id: lp.chapterId,
      position_seconds: lp.positionSeconds || 0, duration_seconds: lp.durationSeconds || 0,
      completed: lp.completed ? 1 : 0, updated_at: lp.updatedAt || 0,
    })));

  insert('skus', ['id', 'product_id', 'label', 'list_price', 'stock', 'updated_at', 'list_price_cents', 'currency'],
    (db.skus || []).map((sk) => ({
      id: sk.id, product_id: sk.productId || '', label: sk.label || '',
      list_price: sk.listPrice || 0, stock: sk.stock || 0, updated_at: sk.updatedAt || 0,
      ...MONEY_SHADOW.mapped('skus', sk),
    })));

  insert('stock_ledger',
    ['id', 'sku_id', 'delta', 'reason', 'order_id', 'operator_id', 'at', 'balance_after'],
    (db.stockLedger || []).map((sl) => ({
      id: sl.id, sku_id: sl.skuId, delta: sl.delta || 0, reason: sl.reason || '',
      order_id: sl.orderId || null, operator_id: sl.operatorId || null,
      at: sl.at || 0, balance_after: sl.balanceAfter || 0,
    })));

  insert('"columns"',
    ['id', 'title', 'summary', 'cover_url', 'price', 'fulfillment_type', 'requires_member',
      'price_presentation', 'checkout_notice', 'content', 'chapters', 'price_cents', 'currency'],
    (db.columns || []).map((c) => ({
      id: c.id, title: c.title || '', summary: c.summary || '', cover_url: c.coverUrl || null,
      price: c.price || 0, fulfillment_type: c.fulfillmentType || 'ACTIVATION_CODE',
      ...MONEY_SHADOW.mapped('columns', c),
      requires_member: c.requiresMember ? 1 : 0, price_presentation: c.pricePresentation || 'single',
      checkout_notice: c.checkoutNotice || null,
      content: j(c.content || {}), chapters: j(c.chapters || []),
    })));

  insert('activity_prices', ['product_id', 'amount', 'note', 'updated_at', 'activity_price_cents', 'currency'],
    (db.activityPrices || []).map((ap) => ({
      product_id: ap.productId, amount: ap.amount || 0, note: ap.note || null, updated_at: ap.updatedAt || 0,
      ...MONEY_SHADOW.mapped('activityPrices', ap),
    })));

  insert('quotes',
    ['id', 'scene', 'user_id', 'amount', 'breakdown', 'items', 'meta', 'rule_version',
      'issued_at', 'expires_at', 'consumed', 'consumed_at', 'consumed_ref', 'payable_amount_cents', 'goods_amount_cents', 'discount_amount_cents', 'list_amount_cents', 'currency'],
    (db.quotes || []).map((qt) => ({
      id: qt.id, scene: qt.scene || 'checkout', user_id: qt.userId || null, amount: qt.amount || 0,
      ...MONEY_SHADOW.mapped('quotes', qt),
      breakdown: j(qt.breakdown || {}), items: j(qt.items || []), meta: j(qt.meta || {}),
      rule_version: qt.ruleVersion || 1, issued_at: qt.issuedAt || 0, expires_at: qt.expiresAt || 0,
      consumed: qt.consumed ? 1 : 0, consumed_at: qt.consumedAt || null, consumed_ref: qt.consumedRef || null,
    })));

  insert('allocation_quotes',
    ['id', 'entry_id', 'user_id', 'kind', 'targets', 'entry_amount', 'rows', 'total_percent',
      'total_amount', 'expires_at', 'created_at'],
    (db.allocationQuotes || []).map((aq) => ({
      id: aq.id, entry_id: aq.entryId || '', user_id: aq.userId || null, kind: aq.kind || 'sales',
      targets: j(aq.targets || []), entry_amount: aq.entryAmount || 0, rows: j(aq.rows || []),
      total_percent: aq.totalPercent || 0, total_amount: aq.totalAmount || 0,
      expires_at: aq.expiresAt || 0, created_at: aq.createdAt || 0,
    })));

  // ── counters：序号计数器（避免重启后编号从头再来）─────────────
  insert('counters', ['name', 'value'], [
    { name: 'userSeq', value: db.userSeq || 1 },
    { name: 'seq', value: db.seq || 1 },
    { name: 'memberSeq', value: db.memberSeq || 1 },
  ]);
}

module.exports = { forEachInsert, declaredTables };

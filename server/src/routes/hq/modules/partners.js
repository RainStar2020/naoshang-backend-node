/**
 * 脑商AI合伙人 · 总部后台 · HQ-22 合伙人（Partners）
 *
 * 契约：《总部后台API需求文档.md》§24
 *
 * 库表对照：
 *   - 合伙人主体（既有、托管）：db.users（tier 档位）+ db.regionalAgents（代理身份）
 *   - 合伙上下文（后台专属）：db.hqPartnerContexts
 *   - 等级权益内容（后台专属）：db.hqPartnerBenefits
 *   - 升档任务（既有、托管）：db.promotionTasks
 *
 * 年费 annualFeeAmount：单位「元」（前端字面量曾为分，实现按元）。
 */

const L = require('../lib');

const MODULE = 'partners';
const CODE = 'HQ-22';
const TITLE = '合伙人';

const PARTNER_LEVELS = ['DEMO-VIP', 'DEMO-ANGEL', 'DEMO-BOARD', 'DEMO-FOUNDER'];
const PARTNER_STATUS = ['ACTIVE', 'FROZEN', 'EXPIRED', 'PENDING_ANNUAL'];
const ANNUAL_STATUS = ['ACTIVE', 'EXPIRED', 'NOT_OPEN'];
const TASK_STATUS = ['IN_PROGRESS', 'READY', 'PROCESSING', 'COMPLETED', 'EXPIRED', 'SUPERSEDED'];

/** 内部档位 → 演示合伙等级 */
const TIER_TO_LEVEL = { vip: 'DEMO-VIP', angel: 'DEMO-ANGEL', private: 'DEMO-BOARD', cofounder: 'DEMO-FOUNDER' };
const LEVEL_TO_TIER = { 'DEMO-VIP': 'vip', 'DEMO-ANGEL': 'angel', 'DEMO-BOARD': 'private', 'DEMO-FOUNDER': 'cofounder' };

/** 取合伙上下文；没有则从 users + regionalAgents 派生 */
function readContext(db, contextId) {
  const explicit = (db.hqPartnerContexts || []).find((c) => c.contextId === contextId);
  if (explicit) return explicit;
  // contextId 形如 partner:p1
  const userId = contextId.startsWith('partner:') ? contextId.slice('partner:'.length) : contextId;
  const u = db.users[userId];
  if (!u) return null;
  const ra = (db.regionalAgents || []).find((a) => a.partner_id === userId);
  return {
    contextId: `partner:${userId}`,
    accountId: userId,
    partnerLevel: TIER_TO_LEVEL[u.tier] || 'DEMO-VIP',
    frozen: !!u.frozen,
    annualValidUntil: u.annual_fee_expires_at || null,
    annualFeeAmount: L.money(u.annual_fee_amount || 0),
    annualStatus: u.annual_fee_paid ? 'ACTIVE' : 'NOT_OPEN',
    partnerStatus: u.frozen ? 'FROZEN' : 'ACTIVE',
    superiorAccountId: u.upline_id || null,
    version: 1,
  };
}

function contextDto(db, c, opts) {
  const mask = !(opts && opts.reveal);
  const u = db.users[c.accountId];
  const ra = (db.regionalAgents || []).find((a) => a.partner_id === c.accountId);
  const superior = c.superiorAccountId ? db.users[c.superiorAccountId] : null;
  const task = (db.promotionTasks || []).find((t) => t.userId === c.accountId) || null;
  return {
    contextId: c.contextId,
    accountId: c.accountId,
    displayId: u ? u.display_id : null,
    name: u ? u.name : null,
    phone: u ? (mask ? L.maskPhone(u.phone) : (u.phone || null)) : null,
    partnerLevel: c.partnerLevel,
    partnerStatus: c.partnerStatus || 'ACTIVE',
    frozen: !!c.frozen,
    annualStatus: c.annualStatus || 'NOT_OPEN',
    annualValidUntil: L.toIso(c.annualValidUntil),
    annualFeeAmount: L.money(c.annualFeeAmount || 0),
    agentRegionType: ra ? ra.region_type : null,
    superior: superior ? { accountId: superior.id, contextId: `partner:${superior.id}`, name: superior.name } : null,
    task: task ? {
      taskId: task.id,
      startTier: task.startTier,
      status: task.status,
      validUntil: L.toIso(task.validUntil),
      grantedTier: task.grantedTier || null,
    } : null,
    version: Number(c.version || 1),
    allowedActions: ['manual-upgrade', 'claim-promotion'],
  };
}

const routes = [
  // ── 合伙人分页 ──
  {
    module: MODULE,
    method: 'GET',
    path: '/partners',
    async handler(ctx) {
      const paging = L.readPaging(ctx.query);
      const keyword = ctx.query.get('keyword') || '';
      const partnerLevel = ctx.query.get('partnerLevel') || '';
      const partnerStatus = ctx.query.get('partnerStatus') || '';

      let list = (ctx.db.hqPartnerContexts || []).slice();
      if (!list.length) {
        list = Object.keys(ctx.db.users || {}).map((id) => readContext(ctx.db, `partner:${id}`)).filter(Boolean);
      }
      if (keyword) list = list.filter((c) => {
        const u = ctx.db.users[c.accountId];
        return L.matchKeyword(keyword, c.contextId, c.accountId, u && u.name, u && u.phone, u && u.display_id);
      });
      if (partnerLevel) list = list.filter((c) => c.partnerLevel === partnerLevel);
      if (partnerStatus) list = list.filter((c) => (c.partnerStatus || 'ACTIVE') === partnerStatus);

      const items = list.slice(paging.offset, paging.offset + paging.pageSize).map((c) => contextDto(ctx.db, c));
      return L.listData(items, list.length, paging.page, paging.pageSize, {
        total: list.length,
        byLevel: PARTNER_LEVELS.reduce((a, lv) => {
          a[lv] = list.filter((c) => c.partnerLevel === lv).length;
          return a;
        }, {}),
      });
    },
  },

  // ── 等级权益、回执、审计目录 ──
  {
    module: MODULE,
    method: 'GET',
    path: '/partners/catalog',
    async handler(ctx) {
      return {
        partnerLevels: PARTNER_LEVELS.map((l) => ({ value: l, label: l })),
        partnerStatuses: PARTNER_STATUS.map((s) => ({ value: s, label: s })),
        annualStatuses: ANNUAL_STATUS.map((s) => ({ value: s, label: s })),
        taskStatuses: TASK_STATUS.map((s) => ({ value: s, label: s })),
        benefits: (ctx.db.hqPartnerBenefits || []).map((b) => ({
          partnerLevel: b.partnerLevel,
          summary: b.summary || '',
          content: b.content || null,
          version: Number(b.version || 1),
        })),
        audit: (ctx.db.hqAuditLogs || []).filter((a) => a.module === MODULE).slice(0, 30),
        summary: { total: Object.keys(ctx.db.users || {}).length },
      };
    },
  },

  // ── 详情（档案 + 任务 + 回执 + 审计）──
  {
    module: MODULE,
    method: 'GET',
    path: '/partners/:contextId',
    async handler(ctx) {
      const c = readContext(ctx.db, ctx.params.contextId);
      if (!c) throw L.err(L.ERR.NOT_FOUND, '合伙上下文不存在：' + ctx.params.contextId);
      const receipts = (ctx.db.hqAuditLogs || [])
        .filter((a) => a.module === MODULE && a.targetId === c.contextId && a.action === 'upgrade')
        .map((a) => ({ receiptId: a.id, at: a.occurredAt, reason: a.reason, after: a.after }));
      const audit = (ctx.db.hqAuditLogs || []).filter((a) => a.module === MODULE && a.targetId === c.contextId).slice(0, 20);
      return { partner: contextDto(ctx.db, c, { reveal: true }), receipts, audit };
    },
  },

  // ── upgrade / save-benefits ──
  {
    module: MODULE,
    method: 'POST',
    path: '/partners/mutate',
    async handler(ctx) {
      const { action } = ctx.body || {};
      L.requireFields(ctx.body, ['action']);
      const reason = L.requireReason(ctx.body, ctx.headerReason);
      L.ensureEnum(action, ['upgrade', 'save-benefits'], 'action');
      L.ensureCollections(ctx.db);

      return L.withIdempotency(ctx, () => {
        const operationId = L.nextId(ctx.db, 'hqop');

        if (action === 'upgrade') {
          L.requireFields(ctx.body, ['contextId', 'targetLevel']);
          L.ensureEnum(ctx.body.targetLevel, PARTNER_LEVELS, 'targetLevel');
          let c = (ctx.db.hqPartnerContexts || []).find((x) => x.contextId === ctx.body.contextId);
          if (!c) {
            const derived = readContext(ctx.db, ctx.body.contextId);
            if (!derived) throw L.err(L.ERR.NOT_FOUND, '合伙上下文不存在：' + ctx.body.contextId);
            c = derived;
            ctx.db.hqPartnerContexts.push(c);
          }
          L.checkVersion(ctx, c, ctx.body.version, '合伙档案');
          const before = { partnerLevel: c.partnerLevel, frozen: !!c.frozen };
          const targetTier = LEVEL_TO_TIER[ctx.body.targetLevel];
          const u = ctx.db.users[c.accountId];
          if (!u) throw L.err(L.ERR.NOT_FOUND, '账号不存在：' + c.accountId);
          if (c.frozen) throw L.err(L.ERR.INVALID_STATE, '合伙档案已冻结，不可升档');
          const RANK = { none: 0, vip: 1, angel: 2, private: 3, cofounder: 4 };
          if (RANK[targetTier] < RANK[u.tier || 'none']) {
            throw L.err(L.ERR.INVALID_STATE, '等级只升不降，不能降档');
          }
          u.tier = targetTier;
          c.partnerLevel = ctx.body.targetLevel;
          L.bumpVersion(c);
          const receiptId = L.nextId(ctx.db, 'hqr');
          L.audit(ctx.db, {
            module: MODULE, action: 'upgrade', targetId: c.contextId, operator: ctx.operator, reason,
            before, after: { partnerLevel: c.partnerLevel }, requestId: ctx.requestId, id: receiptId,
          });
          ctx.save();
          return { receiptId, operationId, partner: contextDto(ctx.db, c) };
        }

        // save-benefits
        L.requireFields(ctx.body, ['partnerLevel']);
        L.ensureEnum(ctx.body.partnerLevel, PARTNER_LEVELS, 'partnerLevel');
        let b = (ctx.db.hqPartnerBenefits || []).find((x) => x.partnerLevel === ctx.body.partnerLevel);
        if (!b) {
          b = { partnerLevel: ctx.body.partnerLevel, version: 1 };
          ctx.db.hqPartnerBenefits.push(b);
        }
        L.checkVersion(ctx, b, ctx.body.version, '等级权益');
        const before = { summary: b.summary || '' };
        if (ctx.body.summary !== undefined) b.summary = String(ctx.body.summary);
        if (ctx.body.content !== undefined) b.content = ctx.body.content;
        L.bumpVersion(b);
        L.audit(ctx.db, {
          module: MODULE, action: 'save-benefits', targetId: b.partnerLevel, operator: ctx.operator, reason,
          before, after: { summary: b.summary }, requestId: ctx.requestId, id: operationId,
        });
        ctx.save();
        return { receiptId: operationId, operationId, benefits: b };
      });
    },
  },
];

module.exports = { name: MODULE, code: CODE, title: TITLE, routes, contextDto };

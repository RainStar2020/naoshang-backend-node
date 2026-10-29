/**
 * 脑商AI合伙人 · 总部后台 · HQ-25 客服工单（Support）
 *
 * 契约：《总部后台API需求文档.md》§27
 *
 * 库表对照：
 *   - 工单（后台专属）：db.hqSupportTickets
 *   - 工单消息（后台专属）：db.hqSupportMessages
 *   - 既有用户反馈（托管）：db.supportFeedback（只读参考）
 */

const L = require('../lib');
const {label} = require('../../../common/api-standard/users-pilot');

const MODULE = 'support';
const CODE = 'HQ-25';
const TITLE = '客服工单';

const TICKET_STATUS = ['OPEN', 'PENDING', 'RESOLVED', 'CLOSED'];

function ticketDto(t) {
  return {
    ticketId: t.id,
    accountId: t.accountId || null,
    category: t.category || 'general',
    status: t.status || 'OPEN',
    subject: t.subject || '',
    assigneeId: t.assigneeId || null,
    createdAt: L.toIso(t.createdAt),
    updatedAt: L.toIso(t.updatedAt || t.createdAt),
    version: Number(t.version || 1),
    allowedActions:
      (t.status || 'OPEN') === 'CLOSED'
        ? []
        : ['reply', 'change-status', 'assign', 'close'],
  };
}

function messageDto(m) {
  return {
    messageId: m.id,
    ticketId: m.ticketId,
    senderRole: m.senderRole || 'admin',
    senderId: m.senderId || null,
    content: m.content || '',
    createdAt: L.toIso(m.createdAt),
  };
}

const routes = [
  // Read-only optional profile; never seed or persist an administrator.
  {
    module: MODULE,
    method: 'GET',
    path: '/support/profile',
    async handler(ctx) {
      const adminId=ctx.sess && ctx.sess.adminId || 'admin';
      const admin=(ctx.db.hqAdmins || []).find(a=>a.adminId===adminId);
      if(!admin)return null;
      const email=String(admin.email || '');
      return {adminId:admin.adminId,displayName:label(admin.displayName),phone:admin.phone ? (/^\d{11}$/.test(String(admin.phone)) ? L.maskPhone(admin.phone) : '***') : '',
        email:email ? (/^[^@]+@[^@]+$/.test(email) ? email[0]+'***@'+email.split('@')[1] : '***') : '',
        createdAt:L.toIso(admin.createdAt),updatedAt:L.toIso(admin.updatedAt),isActive:(admin.status || 'ACTIVE')==='ACTIVE'};
    },
  },
  // ── 工单分页 ──
  {
    module: MODULE,
    method: 'GET',
    path: '/support/tickets',
    async handler(ctx) {
      const paging = ctx.apiPilot ? {page:ctx.apiPilot.pageNum,pageSize:ctx.apiPilot.pageSize,offset:(ctx.apiPilot.pageNum-1)*ctx.apiPilot.pageSize} : L.readPaging(ctx.query);
      const keyword = ctx.query.get('keyword') || '';
      const status = ctx.query.get('status') || '';
      const category = ctx.query.get('category') || '';
      let list = (ctx.db.hqSupportTickets || []).slice();
      if (keyword) list = list.filter((t) => L.matchKeyword(keyword, t.id, t.subject, t.accountId));
      if (status) list = list.filter((t) => (t.status || 'OPEN') === status);
      if (category) list = list.filter((t) => (t.category || 'general') === category);
      const sortKey=ctx.apiPilot && ctx.apiPilot.sortBy;
      const direction=ctx.apiPilot ? (ctx.apiPilot.sortOrder==='desc'?-1:1) : -1;
      const sortValue=t=>sortKey==='createdAt'?(L.toIso(t.createdAt)||''):sortKey==='status'?(t.status||'OPEN'):String(t.id);
      list.sort((a,b)=>direction*sortValue(a).localeCompare(sortValue(b)));
      const all = ctx.db.hqSupportTickets || [];
      const items = list.slice(paging.offset, paging.offset + paging.pageSize).map(ticketDto);
      return L.listData(items, list.length, paging.page, paging.pageSize, {
        total: all.length,
        open: all.filter((t) => (t.status || 'OPEN') === 'OPEN').length,
        resolved: all.filter((t) => t.status === 'RESOLVED').length,
      });
    },
  },

  // ── 状态/分类目录 ──
  {
    module: MODULE,
    method: 'GET',
    path: '/support/catalog',
    async handler(ctx) {
      return {
        statuses: TICKET_STATUS.map((s) => ({ value: s, label: s })),
        categories: [
          { value: 'general', label: '一般咨询' },
          { value: 'payment', label: '支付问题' },
          { value: 'order', label: '订单问题' },
          { value: 'complaint', label: '投诉' },
          { value: 'technical', label: '技术问题' },
        ],
        actions: [
          { value: 'reply', label: '回复' },
          { value: 'change-status', label: '改状态' },
          { value: 'assign', label: '转派' },
          { value: 'close', label: '关闭' },
        ],
        summary: { total: (ctx.db.hqSupportTickets || []).length },
      };
    },
  },

  // ── 详情 + 消息流 ──
  {
    module: MODULE,
    method: 'GET',
    path: '/support/tickets/:ticketId',
    async handler(ctx) {
      const t = (ctx.db.hqSupportTickets || []).find((x) => x.id === ctx.params.ticketId);
      if (!t) throw L.err(L.ERR.NOT_FOUND, '工单不存在：' + ctx.params.ticketId);
      const messages = (ctx.db.hqSupportMessages || []).filter((m) => m.ticketId === t.id);
      return { ticket: ticketDto(t), messages: messages.map(messageDto) };
    },
  },

  // ── 回复 / 改状态 / 转派 / 关闭 ──
  {
    module: MODULE,
    method: 'POST',
    path: '/support/tickets/:ticketId/mutate',
    async handler(ctx) {
      const { action, version } = ctx.body || {};
      L.requireFields(ctx.body, ['action']);
      const reason = L.requireReason(ctx.body, ctx.headerReason);
      L.ensureEnum(action, ['reply', 'change-status', 'assign', 'close'], 'action');
      const t = (ctx.db.hqSupportTickets || []).find((x) => x.id === ctx.params.ticketId);
      if (!t) throw L.err(L.ERR.NOT_FOUND, '工单不存在：' + ctx.params.ticketId);
      L.checkVersion(ctx, t, version, '工单');
      const before = { status: t.status, assigneeId: t.assigneeId || null };

      return L.withIdempotency(ctx, () => {
        const operationId = L.nextId(ctx.db, 'hqop');

        if (action === 'reply') {
          L.requireFields(ctx.body, ['content']);
          const msg = {
            id: L.nextId(ctx.db, 'hqsm'),
            ticketId: t.id,
            senderRole: 'admin',
            senderId: ctx.operator ? ctx.operator.adminId : 'admin',
            content: String(ctx.body.content),
            createdAt: L.nowIso(),
          };
          ctx.db.hqSupportMessages.push(msg);
          t.status = t.status === 'OPEN' ? 'PENDING' : t.status;
          t.updatedAt = L.nowIso();
          L.bumpVersion(t);
          L.audit(ctx.db, {
            module: MODULE, action, targetId: t.id, operator: ctx.operator, reason,
            before, after: { status: t.status }, requestId: ctx.requestId, id: operationId,
          });
          ctx.save();
          return { ticket: ticketDto(t), message: messageDto(msg), operationId };
        }

        if (action === 'change-status') {
          L.requireFields(ctx.body, ['status']);
          L.ensureEnum(ctx.body.status, TICKET_STATUS, 'status');
          if (t.status === ctx.body.status) throw L.err(L.ERR.INVALID_STATE, '工单已处于该状态');
          t.status = ctx.body.status;
          t.updatedAt = L.nowIso();
        } else if (action === 'assign') {
          L.requireFields(ctx.body, ['assigneeId']);
          t.assigneeId = String(ctx.body.assigneeId);
          t.updatedAt = L.nowIso();
        } else if (action === 'close') {
          if (t.status === 'CLOSED') throw L.err(L.ERR.INVALID_STATE, '工单已关闭');
          t.status = 'CLOSED';
          t.closedAt = L.nowIso();
          t.closeReason = reason;
          t.updatedAt = L.nowIso();
        }
        L.bumpVersion(t);
        L.audit(ctx.db, {
          module: MODULE, action, targetId: t.id, operator: ctx.operator, reason,
          before, after: { status: t.status, assigneeId: t.assigneeId || null },
          requestId: ctx.requestId, id: operationId,
        });
        ctx.save();
        return { ticket: ticketDto(t), operationId };
      });
    },
  },

  // ── 创建工单（附加能力）──
  {
    module: MODULE,
    method: 'POST',
    path: '/support/tickets',
    async handler(ctx) {
      const b = ctx.body || {};
      L.requireFields(b, ['subject']);
      const reason = L.requireReason(b, ctx.headerReason);
      L.ensureCollections(ctx.db);

      return L.withIdempotency(ctx, () => {
        const rec = {
          id: L.nextId(ctx.db, 'hqtk'),
          accountId: b.accountId || null,
          category: b.category || 'general',
          status: 'OPEN',
          subject: String(b.subject),
          assigneeId: null,
          version: 1,
          createdAt: L.nowIso(),
          updatedAt: L.nowIso(),
        };
        ctx.db.hqSupportTickets.push(rec);
        if (b.content) {
          ctx.db.hqSupportMessages.push({
            id: L.nextId(ctx.db, 'hqsm'),
            ticketId: rec.id,
            senderRole: 'user',
            senderId: rec.accountId,
            content: String(b.content),
            createdAt: L.nowIso(),
          });
        }
        const operationId = L.nextId(ctx.db, 'hqop');
        L.audit(ctx.db, {
          module: MODULE, action: 'create', targetId: rec.id, operator: ctx.operator, reason,
          before: null, after: rec, requestId: ctx.requestId, id: operationId,
        });
        ctx.save();
        return { ticket: ticketDto(rec), operationId };
      });
    },
  },
];

module.exports = { name: MODULE, code: CODE, title: TITLE, routes, ticketDto };

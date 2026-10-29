/**
 * 脑商AI合伙人 · 总部后台 · HQ-26 追踪溯源（Trace）
 *
 * 契约：《总部后台API需求文档.md》§28
 *
 * 数据源：db.hqAuditLogs（统一审计表，由各业务写接口产生）
 * 本模块**只读**，没有写接口。
 */

const L = require('../lib');

const MODULE = 'trace';
const CODE = 'HQ-26';
const TITLE = '追踪溯源';

function traceDto(t) {
  return {
    traceId: t.id,
    module: t.module,
    action: t.action,
    targetId: t.targetId,
    operatorId: t.operatorId,
    operatorName: t.operatorName,
    reason: t.reason,
    before: t.before,
    after: t.after,
    requestId: t.requestId,
    occurredAt: t.occurredAt,
  };
}

const routes = [
  // ── 按条件搜索追踪事件 ──
  {
    module: MODULE,
    method: 'GET',
    path: '/trace',
    async handler(ctx) {
      const paging = L.readPaging(ctx.query);
      const module = ctx.query.get('module') || '';
      const action = ctx.query.get('action') || '';
      const targetId = ctx.query.get('targetId') || '';
      const requestId = ctx.query.get('requestId') || '';
      const operatorId = ctx.query.get('operatorId') || '';
      const from = ctx.query.get('from') || '';
      const to = ctx.query.get('to') || '';

      let list = (ctx.db.hqAuditLogs || []).slice();
      if (module) list = list.filter((t) => t.module === module);
      if (action) list = list.filter((t) => t.action === action);
      if (targetId) list = list.filter((t) => t.targetId === targetId);
      if (requestId) list = list.filter((t) => t.requestId === requestId);
      if (operatorId) list = list.filter((t) => t.operatorId === operatorId);
      if (from) list = list.filter((t) => new Date(t.occurredAt).getTime() >= new Date(from).getTime());
      if (to) list = list.filter((t) => new Date(t.occurredAt).getTime() <= new Date(to).getTime());

      const all = ctx.db.hqAuditLogs || [];
      const items = list.slice(paging.offset, paging.offset + paging.pageSize).map(traceDto);
      return L.listData(items, list.length, paging.page, paging.pageSize, {
        total: all.length,
      });
    },
  },

  // ── 模块/动作目录 ──
  {
    module: MODULE,
    method: 'GET',
    path: '/trace/catalog',
    async handler(ctx) {
      const byModule = {};
      const byAction = {};
      for (const t of ctx.db.hqAuditLogs || []) {
        byModule[t.module] = (byModule[t.module] || 0) + 1;
        byAction[`${t.module}.${t.action}`] = (byAction[`${t.module}.${t.action}`] || 0) + 1;
      }
      return {
        modules: Object.keys(byModule).sort().map((m) => ({ value: m, count: byModule[m] })),
        actions: Object.keys(byAction).sort().map((a) => {
          const [mod, act] = a.split('.');
          return { value: a, module: mod, action: act, count: byAction[a] };
        }),
        summary: { total: (ctx.db.hqAuditLogs || []).length },
      };
    },
  },

  // ── 单条详情 ──
  {
    module: MODULE,
    method: 'GET',
    path: '/trace/:traceId',
    async handler(ctx) {
      const t = (ctx.db.hqAuditLogs || []).find((x) => x.id === ctx.params.traceId);
      if (!t) throw L.err(L.ERR.NOT_FOUND, '追踪记录不存在：' + ctx.params.traceId);
      return { trace: traceDto(t) };
    },
  },

  // ── 按 requestId 聚合 ──
  {
    module: MODULE,
    method: 'GET',
    path: '/trace/by-request/:requestId',
    async handler(ctx) {
      const rid = ctx.params.requestId;
      const list = (ctx.db.hqAuditLogs || []).filter((t) => t.requestId === rid);
      return {
        requestId: rid,
        events: list.map(traceDto),
        total: list.length,
      };
    },
  },
];

module.exports = { name: MODULE, code: CODE, title: TITLE, routes, traceDto };

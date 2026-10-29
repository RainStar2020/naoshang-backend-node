/**
 * 脑商AI合伙人 · 总部后台 · HQ-06 公告（Announcements）
 *
 * 契约：《总部后台API需求文档.md》§8
 *
 * 库表对照：db.hqAnnouncements（总部后台专属；当前 MySQL 无公告表）
 * 注意：C 端 / H5 的公告读的是 src/routes/h5biz.js 里的静态 ANNOUNCEMENTS，
 *      本模块发布后同步一份到该静态源需另行处理 —— 此处仅落地后台数据。
 */

const L = require('../lib');

const MODULE = 'announcements';
const CODE = 'HQ-06';
const TITLE = '公告';

const STATUS = ['draft', 'published', 'offline'];

function announcementDto(a) {
  return {
    announcementId: a.id,
    title: a.title || '',
    summary: a.summary || '',
    content: a.content || null,
    status: a.status || 'draft',
    publishedAt: L.toIso(a.publishedAt),
    audience: a.audience || null,
    version: Number(a.version || 1),
    allowedActions:
      (a.status || 'draft') === 'published' ? ['offline', 'save'] : ['save', 'publish'],
  };
}

const routes = [
  {
    module: MODULE,
    method: 'GET',
    path: '/announcements',
    async handler(ctx) {
      const paging = L.readPaging(ctx.query);
      const keyword = ctx.query.get('keyword') || '';
      const status = ctx.query.get('status') || '';
      let list = (ctx.db.hqAnnouncements || []).slice();
      if (keyword) list = list.filter((a) => L.matchKeyword(keyword, a.id, a.title, a.summary));
      if (status) list = list.filter((a) => (a.status || 'draft') === status);
      list.sort((a, b) => String(b.id).localeCompare(String(a.id)));
      const all = ctx.db.hqAnnouncements || [];
      const items = list.slice(paging.offset, paging.offset + paging.pageSize).map(announcementDto);
      return L.listData(items, list.length, paging.page, paging.pageSize, {
        total: all.length,
        published: all.filter((a) => a.status === 'published').length,
        draft: all.filter((a) => (a.status || 'draft') === 'draft').length,
      });
    },
  },

  {
    module: MODULE,
    method: 'GET',
    path: '/announcements/catalog',
    async handler(ctx) {
      const audit = (ctx.db.hqAuditLogs || []).filter((a) => a.module === MODULE).slice(0, 30);
      return {
        statuses: STATUS.map((s) => ({ value: s, label: s })),
        audit,
        summary: { total: (ctx.db.hqAnnouncements || []).length },
      };
    },
  },

  {
    module: MODULE,
    method: 'GET',
    path: '/announcements/:announcementId',
    async handler(ctx) {
      const a = (ctx.db.hqAnnouncements || []).find((x) => x.id === ctx.params.announcementId);
      if (!a) throw L.err(L.ERR.NOT_FOUND, '公告不存在：' + ctx.params.announcementId);
      return { announcement: announcementDto(a) };
    },
  },

  // ── 无 id 的 mutate：create / save ──
  {
    module: MODULE,
    method: 'POST',
    path: '/announcements/mutate',
    async handler(ctx) {
      const { action } = ctx.body || {};
      L.requireFields(ctx.body, ['action']);
      const reason = L.requireReason(ctx.body, ctx.headerReason);
      L.ensureEnum(action, ['create', 'save'], 'action');
      L.ensureCollections(ctx.db);

      return L.withIdempotency(ctx, () => {
        if (action === 'create') {
          L.requireFields(ctx.body, ['title']);
          const rec = {
            id: L.nextId(ctx.db, 'hqan'),
            title: String(ctx.body.title),
            summary: ctx.body.summary || '',
            content: ctx.body.content || null,
            status: 'draft',
            publishedAt: null,
            audience: ctx.body.audience || null,
            version: 1,
            createdAt: L.nowIso(),
          };
          ctx.db.hqAnnouncements.push(rec);
          const operationId = L.nextId(ctx.db, 'hqop');
          L.audit(ctx.db, {
            module: MODULE, action: 'create', targetId: rec.id, operator: ctx.operator, reason,
            before: null, after: rec, requestId: ctx.requestId, id: operationId,
          });
          ctx.save();
          return { announcement: announcementDto(rec), operationId };
        }
        // save：需带 announcementId
        L.requireFields(ctx.body, ['announcementId']);
        const rec = ctx.db.hqAnnouncements.find((x) => x.id === ctx.body.announcementId);
        if (!rec) throw L.err(L.ERR.NOT_FOUND, '公告不存在：' + ctx.body.announcementId);
        L.checkVersion(ctx, rec, ctx.body.version, '公告');
        const before = { title: rec.title, summary: rec.summary, status: rec.status };
        if (ctx.body.title !== undefined) rec.title = String(ctx.body.title);
        if (ctx.body.summary !== undefined) rec.summary = String(ctx.body.summary);
        if (ctx.body.content !== undefined) rec.content = ctx.body.content;
        if (ctx.body.audience !== undefined) rec.audience = ctx.body.audience;
        L.bumpVersion(rec);
        const operationId = L.nextId(ctx.db, 'hqop');
        L.audit(ctx.db, {
          module: MODULE, action: 'save', targetId: rec.id, operator: ctx.operator, reason,
          before, after: { title: rec.title, summary: rec.summary, status: rec.status },
          requestId: ctx.requestId, id: operationId,
        });
        ctx.save();
        return { announcement: announcementDto(rec), operationId };
      });
    },
  },

  // ── 有 id 的 mutate：save / publish / offline ──
  {
    module: MODULE,
    method: 'POST',
    path: '/announcements/:announcementId/mutate',
    async handler(ctx) {
      const { action, version } = ctx.body || {};
      L.requireFields(ctx.body, ['action']);
      const reason = L.requireReason(ctx.body, ctx.headerReason);
      L.ensureEnum(action, ['save', 'publish', 'offline'], 'action');
      const rec = (ctx.db.hqAnnouncements || []).find((x) => x.id === ctx.params.announcementId);
      if (!rec) throw L.err(L.ERR.NOT_FOUND, '公告不存在：' + ctx.params.announcementId);
      L.checkVersion(ctx, rec, version, '公告');
      const before = { title: rec.title, status: rec.status, version: Number(rec.version || 1) };

      return L.withIdempotency(ctx, () => {
        if (action === 'save') {
          if (ctx.body.title !== undefined) rec.title = String(ctx.body.title);
          if (ctx.body.summary !== undefined) rec.summary = String(ctx.body.summary);
          if (ctx.body.content !== undefined) rec.content = ctx.body.content;
          if (ctx.body.audience !== undefined) rec.audience = ctx.body.audience;
        } else if (action === 'publish') {
          if (!rec.title) throw L.err(L.ERR.INVALID_STATE, '公告缺少标题，不可发布');
          if (rec.status === 'published') throw L.err(L.ERR.INVALID_STATE, '该公告已发布');
          rec.status = 'published';
          rec.publishedAt = L.nowIso();
        } else if (action === 'offline') {
          if (rec.status !== 'published') throw L.err(L.ERR.INVALID_STATE, '仅已发布的公告可下线');
          rec.status = 'offline';
          rec.offlineAt = L.nowIso();
        }
        L.bumpVersion(rec);
        const operationId = L.nextId(ctx.db, 'hqop');
        L.audit(ctx.db, {
          module: MODULE, action, targetId: rec.id, operator: ctx.operator, reason,
          before, after: { title: rec.title, status: rec.status, version: Number(rec.version || 1) },
          requestId: ctx.requestId, id: operationId,
        });
        ctx.save();
        return { announcement: announcementDto(rec), operationId };
      });
    },
  },
];

module.exports = { name: MODULE, code: CODE, title: TITLE, routes, announcementDto };

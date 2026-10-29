/**
 * 脑商AI合伙人 · 总部后台 · HQ-07 资料中心（Materials）
 *
 * 契约：《总部后台API需求文档.md》§9
 *
 * 库表对照：db.hqMaterials（后台资料条目）+ db.assets（上传资源，字段结构对齐）
 */

const L = require('../lib');

const MODULE = 'materials';
const CODE = 'HQ-07';
const TITLE = '资料中心';

function materialDto(m) {
  return {
    materialId: m.id,
    title: m.title || '',
    category: m.category || 'general',
    fileUrl: m.fileUrl || null,
    assetId: m.assetId || null,
    status: m.status || 'offline',
    size: Number(m.size || 0),
    mimeType: m.mimeType || null,
    version: Number(m.version || 1),
    createdAt: L.toIso(m.createdAt),
    allowedActions:
      (m.status || 'offline') === 'online'
        ? ['offline', 'save', 'delete']
        : ['online', 'save', 'delete'],
  };
}

const routes = [
  {
    module: MODULE,
    method: 'GET',
    path: '/materials',
    async handler(ctx) {
      const paging = L.readPaging(ctx.query);
      const keyword = ctx.query.get('keyword') || '';
      const category = ctx.query.get('category') || '';
      const status = ctx.query.get('status') || '';
      let list = (ctx.db.hqMaterials || []).slice();
      if (keyword) list = list.filter((m) => L.matchKeyword(keyword, m.id, m.title, m.category));
      if (category) list = list.filter((m) => m.category === category);
      if (status) list = list.filter((m) => (m.status || 'offline') === status);
      list.sort((a, b) => String(b.id).localeCompare(String(a.id)));
      const all = ctx.db.hqMaterials || [];
      const items = list.slice(paging.offset, paging.offset + paging.pageSize).map(materialDto);
      return L.listData(items, list.length, paging.page, paging.pageSize, {
        total: all.length,
        online: all.filter((m) => m.status === 'online').length,
      });
    },
  },

  {
    module: MODULE,
    method: 'GET',
    path: '/materials/catalog',
    async handler(ctx) {
      const all = ctx.db.hqMaterials || [];
      const cats = {};
      for (const m of all) {
        const c = m.category || 'general';
        cats[c] = (cats[c] || 0) + 1;
      }
      return {
        categories: Object.keys(cats).map((c) => ({ value: c, label: c, count: cats[c] })),
        statuses: [
          { value: 'online', label: '已上架' },
          { value: 'offline', label: '已下架' },
        ],
        audit: (ctx.db.hqAuditLogs || []).filter((a) => a.module === MODULE).slice(0, 30),
        summary: { total: all.length },
      };
    },
  },

  {
    module: MODULE,
    method: 'GET',
    path: '/materials/:materialId',
    async handler(ctx) {
      const m = (ctx.db.hqMaterials || []).find((x) => x.id === ctx.params.materialId);
      if (!m) throw L.err(L.ERR.NOT_FOUND, '资料不存在：' + ctx.params.materialId);
      return { material: materialDto(m) };
    },
  },

  {
    module: MODULE,
    method: 'POST',
    path: '/materials/mutate',
    async handler(ctx) {
      const { action } = ctx.body || {};
      L.requireFields(ctx.body, ['action']);
      const reason = L.requireReason(ctx.body, ctx.headerReason);
      L.ensureEnum(action, ['create', 'save', 'online', 'offline', 'delete'], 'action');
      L.ensureCollections(ctx.db);

      return L.withIdempotency(ctx, () => {
        const operationId = L.nextId(ctx.db, 'hqop');

        if (action === 'create') {
          L.requireFields(ctx.body, ['title']);
          const rec = {
            id: L.nextId(ctx.db, 'hqm'),
            title: String(ctx.body.title),
            category: ctx.body.category || 'general',
            fileUrl: ctx.body.fileUrl || null,
            assetId: ctx.body.assetId || null,
            status: 'offline',
            size: Number(ctx.body.size || 0),
            mimeType: ctx.body.mimeType || null,
            version: 1,
            createdAt: L.nowIso(),
          };
          ctx.db.hqMaterials.push(rec);
          L.audit(ctx.db, {
            module: MODULE, action: 'create', targetId: rec.id, operator: ctx.operator, reason,
            before: null, after: rec, requestId: ctx.requestId, id: operationId,
          });
          ctx.save();
          return { material: materialDto(rec), operationId };
        }

        L.requireFields(ctx.body, ['materialId']);
        const rec = ctx.db.hqMaterials.find((x) => x.id === ctx.body.materialId);
        if (!rec) throw L.err(L.ERR.NOT_FOUND, '资料不存在：' + ctx.body.materialId);
        L.checkVersion(ctx, rec, ctx.body.version, '资料');
        const before = { title: rec.title, status: rec.status, category: rec.category };

        if (action === 'save') {
          if (ctx.body.title !== undefined) rec.title = String(ctx.body.title);
          if (ctx.body.category !== undefined) rec.category = ctx.body.category;
          if (ctx.body.fileUrl !== undefined) rec.fileUrl = ctx.body.fileUrl;
          if (ctx.body.assetId !== undefined) rec.assetId = ctx.body.assetId;
        } else if (action === 'online') {
          if (rec.status === 'online') throw L.err(L.ERR.INVALID_STATE, '该资料已上架');
          rec.status = 'online';
        } else if (action === 'offline') {
          if (rec.status !== 'online') throw L.err(L.ERR.INVALID_STATE, '该资料未上架');
          rec.status = 'offline';
        } else if (action === 'delete') {
          const idx = ctx.db.hqMaterials.indexOf(rec);
          ctx.db.hqMaterials.splice(idx, 1);
          L.audit(ctx.db, {
            module: MODULE, action: 'delete', targetId: rec.id, operator: ctx.operator, reason,
            before, after: null, requestId: ctx.requestId, id: operationId,
          });
          ctx.save();
          return { deleted: true, materialId: rec.id, operationId };
        }
        L.bumpVersion(rec);
        L.audit(ctx.db, {
          module: MODULE, action, targetId: rec.id, operator: ctx.operator, reason,
          before, after: { title: rec.title, status: rec.status, category: rec.category },
          requestId: ctx.requestId, id: operationId,
        });
        ctx.save();
        return { material: materialDto(rec), operationId };
      });
    },
  },

  // ── 上传文件 ──
  {
    module: MODULE,
    method: 'POST',
    path: '/materials/assets',
    async handler(ctx) {
      const b = ctx.body || {};
      L.requireFields(b, ['fileName']);
      L.ensureCollections(ctx.db);
      const rec = {
        id: L.nextId(ctx.db, 'hqas'),
        userId: ctx.operator ? ctx.operator.adminId : 'admin',
        purpose: b.purpose || 'material',
        fileName: String(b.fileName),
        mimeType: b.mimeType || 'application/octet-stream',
        size: Number(b.size || 0),
        status: 'READY',
        createdAt: L.nowIso(),
        previewUrl: b.url || b.previewUrl || null,
      };
      ctx.db.assets.push(rec);
      ctx.save();
      return {
        assetId: rec.id,
        url: rec.previewUrl,
        mimeType: rec.mimeType,
        size: rec.size,
        fileName: rec.fileName,
      };
    },
  },
];

module.exports = { name: MODULE, code: CODE, title: TITLE, routes, materialDto };

/**
 * 脑商AI合伙人 · 总部后台 · HQ-05 专栏内容（Columns）
 *
 * 契约：《总部后台API需求文档.md》§7
 *
 * 库表对照：
 *   - 业务侧专栏内容：db.columns（托管表，C 端读取）
 *   - 后台草稿/发布态：db.hqColumns（HQ 专属；托管表由同步器管理，HQ 不直接改写）
 *
 * 设计：发布动作把 hqColumns 的 draft 内容**同步到 db.columns**，
 *      从而经既有同步器镜像进 MySQL（保证 C 端立即可见），不做直写 MySQL。
 */

const L = require('../lib');

const MODULE = 'columns';
const CODE = 'HQ-05';
const TITLE = '专栏内容';

const STATUS = ['draft', 'published', 'offline'];

function columnDto(c) {
  return {
    columnId: c.columnId,
    productId: c.productId || null,
    title: c.title || '',
    summary: c.summary || '',
    coverUrl: c.coverUrl || null,
    content: c.content || null,
    chapters: c.chapters || [],
    status: c.status || 'draft',
    version: Number(c.version || 1),
    publication: {
      publishedAt: L.toIso(c.publishedAt),
      offlineAt: L.toIso(c.offlineAt),
    },
    allowedActions:
      (c.status || 'draft') === 'published'
        ? ['offline', 'save']
        : ['save', 'publish'],
  };
}

/** 取 hq 专栏；没有 HQ 记录时以业务 columns 为初值兜底 */
function ensureHqColumns(db) {
  L.ensureCollections(db);
  if (!db.hqColumns.length) {
    for (const c of db.columns || []) {
      db.hqColumns.push({
        columnId: c.id,
        productId: c.productId || null,
        title: c.title || '',
        summary: c.summary || '',
        coverUrl: c.coverUrl || null,
        content: c.content || null,
        chapters: c.chapters || [],
        status: 'published',
        version: 1,
        publishedAt: c.publishedAt || null,
        offlineAt: null,
      });
    }
  }
  return db.hqColumns;
}

/** 把已发布的 HQ 专栏同步到业务集合（经同步器进 MySQL） */
function publishToBusiness(db, col) {
  let target = (db.columns || []).find((c) => c.id === col.columnId);
  if (!target) {
    target = { id: col.columnId };
    db.columns = db.columns || [];
    db.columns.push(target);
  }
  target.title = col.title;
  target.summary = col.summary;
  target.coverUrl = col.coverUrl;
  target.content = col.content;
  target.chapters = col.chapters;
  if (col.productId) target.productId = col.productId;
  target.fulfillmentType = target.fulfillmentType || 'COLUMN_ACCESS';
}

const routes = [
  // ── 专栏目录 + 可绑商品 + 审计 ──
  {
    module: MODULE,
    method: 'GET',
    path: '/columns/catalog',
    async handler(ctx) {
      const list = ensureHqColumns(ctx.db);
      const products = [];
      for (const s of ctx.db.skus || []) {
        if (!products.find((p) => p.productId === s.productId)) {
          products.push({ productId: s.productId, title: s.productId, fulfillmentType: 'COLUMN_ACCESS' });
        }
      }
      for (const p of ctx.db.hqProducts || []) {
        products.push({ productId: p.productId, title: p.title, fulfillmentType: p.fulfillmentType || 'COLUMN_ACCESS' });
      }
      const audit = (ctx.db.hqAuditLogs || []).filter((a) => a.module === MODULE).slice(0, 30);
      return {
        columns: list.map((c) => ({
          draft: {
            columnId: c.columnId, productId: c.productId, title: c.title, summary: c.summary,
            coverUrl: c.coverUrl, content: c.content, chapters: c.chapters,
          },
          version: Number(c.version || 1),
          status: c.status || 'draft',
          publication: { publishedAt: L.toIso(c.publishedAt), offlineAt: L.toIso(c.offlineAt) },
        })),
        products,
        audit,
      };
    },
  },

  // ── 单专栏（草稿 + 发布态）──
  {
    module: MODULE,
    method: 'GET',
    path: '/columns/:columnId',
    async handler(ctx) {
      const list = ensureHqColumns(ctx.db);
      const c = list.find((x) => x.columnId === ctx.params.columnId);
      if (!c) throw L.err(L.ERR.NOT_FOUND, '专栏不存在：' + ctx.params.columnId);
      return { column: columnDto(c) };
    },
  },

  // ── 购买/授权/学习进度 ──
  {
    module: MODULE,
    method: 'GET',
    path: '/columns/:columnId/records',
    async handler(ctx) {
      const c = ensureHqColumns(ctx.db).find((x) => x.columnId === ctx.params.columnId);
      if (!c) throw L.err(L.ERR.NOT_FOUND, '专栏不存在：' + ctx.params.columnId);
      const orders = (ctx.db.orders || []).filter((o) => o.productKey === c.columnId || o.columnId === c.columnId);
      const progress = (ctx.db.learningProgress || []).filter((p) => p.levelId === c.columnId || p.chapterId === c.columnId);
      const unlocks = (ctx.db.members || [])
        .filter((m) => Array.isArray(m.unlockedColumns) && m.unlockedColumns.includes(c.columnId))
        .map((m) => ({ memberId: m.id, accountId: m.userId, displayName: m.name }));
      return { orders, progress, unlocks };
    },
  },

  // ── 专栏写操作：save / publish / offline ──
  {
    module: MODULE,
    method: 'POST',
    path: '/columns/:columnId/mutate',
    async handler(ctx) {
      const { action, version, value } = ctx.body || {};
      L.requireFields(ctx.body, ['action']);
      const reason = L.requireReason(ctx.body, ctx.headerReason);
      L.ensureEnum(action, ['save', 'publish', 'offline'], 'action');
      const list = ensureHqColumns(ctx.db);
      let c = list.find((x) => x.columnId === ctx.params.columnId);
      if (!c) {
        if (action !== 'save') throw L.err(L.ERR.NOT_FOUND, '专栏不存在：' + ctx.params.columnId);
        c = { columnId: ctx.params.columnId, status: 'draft', version: 1, chapters: [], content: null };
        list.push(c);
      }
      L.checkVersion(ctx, c, version, '专栏');
      const before = { title: c.title, status: c.status, version: Number(c.version || 1) };

      return L.withIdempotency(ctx, () => {
        if (action === 'save') {
          if (!value || typeof value !== 'object') throw L.err(L.ERR.INVALID_INPUT, 'save 需要 value（ColumnDraft）');
          if (value.title !== undefined) c.title = String(value.title);
          if (value.summary !== undefined) c.summary = String(value.summary);
          if (value.coverUrl !== undefined) c.coverUrl = value.coverUrl;
          if (value.content !== undefined) c.content = value.content;
          if (value.chapters !== undefined) c.chapters = Array.isArray(value.chapters) ? value.chapters : [];
          if (value.productId !== undefined) c.productId = value.productId;
        } else if (action === 'publish') {
          if (!c.title) throw L.err(L.ERR.INVALID_STATE, '专栏缺少标题，不可发布');
          c.status = 'published';
          c.publishedAt = L.nowIso();
          c.offlineAt = null;
          publishToBusiness(ctx.db, c);
        } else if (action === 'offline') {
          if (c.status !== 'published') throw L.err(L.ERR.INVALID_STATE, '仅已发布的专栏可下架');
          c.status = 'offline';
          c.offlineAt = L.nowIso();
          const biz = (ctx.db.columns || []).find((x) => x.id === c.columnId);
          if (biz) biz.offline = true;
        }
        L.bumpVersion(c);
        const operationId = L.nextId(ctx.db, 'hqop');
        L.audit(ctx.db, {
          module: MODULE, action, targetId: c.columnId, operator: ctx.operator, reason,
          before, after: { title: c.title, status: c.status, version: Number(c.version || 1) },
          requestId: ctx.requestId, id: operationId,
        });
        ctx.save();
        return { column: columnDto(c), operationId };
      });
    },
  },

  // ── 上传素材（返回 CmsAsset）──
  {
    module: MODULE,
    method: 'POST',
    path: '/columns/assets',
    async handler(ctx) {
      const b = ctx.body || {};
      L.requireFields(b, ['fileName']);
      L.ensureCollections(ctx.db);
      const rec = {
        id: L.nextId(ctx.db, 'hqas'),
        fileName: String(b.fileName),
        url: b.url || null,
        mimeType: b.mimeType || 'application/octet-stream',
        size: Number(b.size || 0),
        purpose: b.purpose || 'column',
        userId: ctx.operator ? ctx.operator.adminId : 'admin',
        createdAt: L.nowIso(),
      };
      ctx.db.assets.push(rec);
      ctx.save();
      return {
        assetId: rec.id,
        url: rec.url,
        mimeType: rec.mimeType,
        size: rec.size,
        fileName: rec.fileName,
      };
    },
  },
];

module.exports = { name: MODULE, code: CODE, title: TITLE, routes, ensureHqColumns, columnDto };

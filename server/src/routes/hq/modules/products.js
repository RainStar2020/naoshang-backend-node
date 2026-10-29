/**
 * 脑商AI合伙人 · 总部后台 · HQ-11 商品（Products）
 *
 * 契约：《总部后台API需求文档.md》§13
 *
 * 库表对照：
 *   - 商城 SKU（既有、托管）：db.skus
 *   - 商品主体（后台专属）：db.hqProducts
 *
 * 金额单位：元（保留两位小数）。
 * 校验：价格 ≥ 0 且最多两位小数；上架至少一个 SKU。
 */

const L = require('../lib');

const MODULE = 'products';
const CODE = 'HQ-11';
const TITLE = '商品';

const FULFILLMENT = ['PHYSICAL', 'COLUMN_ACCESS', 'VIRTUAL', 'MEMBERSHIP', 'SOFTWARE'];
const STATUS = ['draft', 'on_sale', 'offline'];

/** 金额校验：≥ 0 且最多两位小数 */
function assertMoney(v, label) {
  const n = Number(v);
  if (!Number.isFinite(n)) throw L.err(L.ERR.INVALID_INPUT, `${label} 不是合法数字`);
  if (n < 0) throw L.err(L.ERR.INVALID_INPUT, `${label} 不能为负数`);
  if (Math.round(n * 100) !== n * 100) throw L.err(L.ERR.INVALID_INPUT, `${label} 最多保留两位小数`);
  return L.money(n);
}

function skuDto(s) {
  return {
    skuId: s.skuId || s.id,
    title: s.title || s.label || '',
    price: L.money(s.price != null ? s.price : s.listPrice),
    listPrice: s.listPrice == null ? null : L.money(s.listPrice),
    stock: s.stock === null || s.stock === undefined ? null : Number(s.stock),
    version: Number(s.version || 1),
  };
}

function productDto(p) {
  const status = p.status || 'draft';
  return {
    productId: p.productId || p.id,
    title: p.title || '',
    subtitle: p.subtitle || null,
    coverUrl: p.coverUrl || null,
    fulfillmentType: p.fulfillmentType || 'PHYSICAL',
    status,
    skus: (p.skus || []).map(skuDto),
    version: Number(p.version || 1),
    allowedActions:
      status === 'on_sale' ? ['offline', 'save', 'update-sku'] : ['publish', 'save', 'update-sku'],
  };
}

/** 合并商城既有 SKU（托管表）作为商品的 SKU 来源 */
function mergeSkus(db, p) {
  const own = (p.skus || []).map((s) => ({
    skuId: s.skuId || s.id, title: s.title || s.label || '',
    price: L.money(s.price != null ? s.price : s.listPrice),
    listPrice: s.listPrice == null ? null : L.money(s.listPrice),
    stock: s.stock === null || s.stock === undefined ? null : Number(s.stock),
  }));
  const shared = (db.skus || [])
    .filter((s) => s.productId === (p.productId || p.id))
    .map((s) => ({
      skuId: s.id, title: s.label || '', price: L.money(s.listPrice),
      listPrice: L.money(s.listPrice), stock: s.stock == null ? null : Number(s.stock),
    }));
  return own.concat(shared);
}

const routes = [
  // ── 商品分页 ──
  {
    module: MODULE,
    method: 'GET',
    path: '/products',
    async handler(ctx) {
      const paging = L.readPaging(ctx.query);
      const keyword = ctx.query.get('keyword') || '';
      const status = ctx.query.get('status') || '';
      const fulfillmentType = ctx.query.get('fulfillmentType') || '';

      let list = (ctx.db.hqProducts || []).slice();
      if (!list.length) {
        // 兜底：以商城 SKU 目录合成只读商品视图
        const seen = new Set();
        for (const s of ctx.db.skus || []) {
          if (seen.has(s.productId)) continue;
          seen.add(s.productId);
          list.push({
            productId: s.productId, title: s.productId, subtitle: null, coverUrl: null,
            fulfillmentType: 'PHYSICAL', status: 'on_sale', skus: [], version: 1,
          });
        }
      }
      if (keyword) list = list.filter((p) => L.matchKeyword(keyword, p.productId, p.title, p.subtitle));
      if (status) list = list.filter((p) => (p.status || 'draft') === status);
      if (fulfillmentType) list = list.filter((p) => (p.fulfillmentType || 'PHYSICAL') === fulfillmentType);
      list.sort((a, b) => String(a.productId || a.id).localeCompare(String(b.productId || b.id)));

      const items = list.slice(paging.offset, paging.offset + paging.pageSize).map((p) => {
        const dto = productDto(p);
        dto.skus = mergeSkus(ctx.db, p);
        return dto;
      });
      return L.listData(items, list.length, paging.page, paging.pageSize, { total: list.length });
    },
  },

  // ── 类目/履约类型目录 ──
  {
    module: MODULE,
    method: 'GET',
    path: '/products/catalog',
    async handler(ctx) {
      const categories = [];
      const seen = new Set();
      for (const s of ctx.db.skus || []) {
        if (seen.has(s.productId)) continue;
        seen.add(s.productId);
        categories.push({ productId: s.productId, title: s.productId });
      }
      return {
        categories,
        fulfillmentTypes: FULFILLMENT.map((f) => ({ value: f, label: f })),
        statuses: STATUS.map((s) => ({ value: s, label: s })),
        summary: { total: (ctx.db.hqProducts || []).length },
      };
    },
  },

  // ── 商品详情（含 SKU）──
  {
    module: MODULE,
    method: 'GET',
    path: '/products/:productId',
    async handler(ctx) {
      const p = (ctx.db.hqProducts || []).find((x) => (x.productId || x.id) === ctx.params.productId);
      if (!p) throw L.err(L.ERR.NOT_FOUND, '商品不存在：' + ctx.params.productId);
      const dto = productDto(p);
      dto.skus = mergeSkus(ctx.db, p);
      return { product: dto };
    },
  },

  // ── 创建 / 保存 ──
  {
    module: MODULE,
    method: 'POST',
    path: '/products/mutate',
    async handler(ctx) {
      const { action } = ctx.body || {};
      L.requireFields(ctx.body, ['action']);
      const reason = L.requireReason(ctx.body, ctx.headerReason);
      L.ensureEnum(action, ['create', 'save'], 'action');
      L.ensureCollections(ctx.db);

      return L.withIdempotency(ctx, () => {
        const operationId = L.nextId(ctx.db, 'hqop');

        if (action === 'create') {
          L.requireFields(ctx.body, ['title']);
          const productId = ctx.body.productId || L.nextId(ctx.db, 'hqpd');
          const rec = {
            productId,
            title: String(ctx.body.title),
            subtitle: ctx.body.subtitle || null,
            coverUrl: ctx.body.coverUrl || null,
            fulfillmentType: ctx.body.fulfillmentType || 'PHYSICAL',
            status: 'draft',
            skus: [],
            version: 1,
            createdAt: L.nowIso(),
          };
          ctx.db.hqProducts.push(rec);
          L.audit(ctx.db, {
            module: MODULE, action: 'create', targetId: productId, operator: ctx.operator, reason,
            before: null, after: rec, requestId: ctx.requestId, id: operationId,
          });
          ctx.save();
          return { product: productDto(rec), operationId };
        }

        L.requireFields(ctx.body, ['productId']);
        const rec = ctx.db.hqProducts.find((x) => (x.productId || x.id) === ctx.body.productId);
        if (!rec) throw L.err(L.ERR.NOT_FOUND, '商品不存在：' + ctx.body.productId);
        L.checkVersion(ctx, rec, ctx.body.version, '商品');
        const before = { title: rec.title, status: rec.status, fulfillmentType: rec.fulfillmentType };

        if (ctx.body.title !== undefined) rec.title = String(ctx.body.title);
        if (ctx.body.subtitle !== undefined) rec.subtitle = ctx.body.subtitle;
        if (ctx.body.coverUrl !== undefined) rec.coverUrl = ctx.body.coverUrl;
        if (ctx.body.fulfillmentType !== undefined) {
          L.ensureEnum(ctx.body.fulfillmentType, FULFILLMENT, 'fulfillmentType');
          rec.fulfillmentType = ctx.body.fulfillmentType;
        }
        if (ctx.body.skus !== undefined) {
          if (!Array.isArray(ctx.body.skus)) throw L.err(L.ERR.INVALID_INPUT, 'skus 必须是数组');
          rec.skus = ctx.body.skus.map((s, i) => ({
            skuId: s.skuId || s.id || `${rec.productId}-sku-${i + 1}`,
            title: s.title || s.label || '',
            price: assertMoney(s.price != null ? s.price : s.listPrice, `SKU[${i}] 价格`),
            listPrice: s.listPrice == null ? null : assertMoney(s.listPrice, `SKU[${i}] 划线价`),
            stock: s.stock === null || s.stock === undefined ? null : Number(s.stock),
          }));
        }
        L.bumpVersion(rec);
        L.audit(ctx.db, {
          module: MODULE, action: 'save', targetId: rec.productId, operator: ctx.operator, reason,
          before, after: { title: rec.title, status: rec.status, fulfillmentType: rec.fulfillmentType },
          requestId: ctx.requestId, id: operationId,
        });
        ctx.save();
        const dto = productDto(rec);
        dto.skus = mergeSkus(ctx.db, rec);
        return { product: dto, operationId };
      });
    },
  },

  // ── 上架 / 下架 / 改价 / 改 SKU ──
  {
    module: MODULE,
    method: 'POST',
    path: '/products/:productId/mutate',
    async handler(ctx) {
      const { action, version } = ctx.body || {};
      L.requireFields(ctx.body, ['action']);
      const reason = L.requireReason(ctx.body, ctx.headerReason);
      L.ensureEnum(action, ['publish', 'offline', 'save', 'update-sku', 'update-price'], 'action');
      const rec = (ctx.db.hqProducts || []).find((x) => (x.productId || x.id) === ctx.params.productId);
      if (!rec) throw L.err(L.ERR.NOT_FOUND, '商品不存在：' + ctx.params.productId);
      L.checkVersion(ctx, rec, version, '商品');
      const before = { title: rec.title, status: rec.status, skus: (rec.skus || []).length };

      return L.withIdempotency(ctx, () => {
        const operationId = L.nextId(ctx.db, 'hqop');

        if (action === 'publish') {
          const skus = mergeSkus(ctx.db, rec);
          if (!skus.length) throw L.err(L.ERR.INVALID_STATE, '商品至少需要一个 SKU 才可上架');
          if (rec.status === 'on_sale') throw L.err(L.ERR.INVALID_STATE, '该商品已上架');
          rec.status = 'on_sale';
          rec.publishedAt = L.nowIso();
        } else if (action === 'offline') {
          if (rec.status !== 'on_sale') throw L.err(L.ERR.INVALID_STATE, '仅已上架商品可下架');
          rec.status = 'offline';
          rec.offlineAt = L.nowIso();
        } else if (action === 'save') {
          if (ctx.body.title !== undefined) rec.title = String(ctx.body.title);
          if (ctx.body.subtitle !== undefined) rec.subtitle = ctx.body.subtitle;
          if (ctx.body.coverUrl !== undefined) rec.coverUrl = ctx.body.coverUrl;
          if (ctx.body.fulfillmentType !== undefined) {
            L.ensureEnum(ctx.body.fulfillmentType, FULFILLMENT, 'fulfillmentType');
            rec.fulfillmentType = ctx.body.fulfillmentType;
          }
        } else if (action === 'update-sku') {
          L.requireFields(ctx.body, ['skus']);
          if (!Array.isArray(ctx.body.skus)) throw L.err(L.ERR.INVALID_INPUT, 'skus 必须是数组');
          rec.skus = ctx.body.skus.map((s, i) => ({
            skuId: s.skuId || s.id || `${rec.productId}-sku-${i + 1}`,
            title: s.title || s.label || '',
            price: assertMoney(s.price != null ? s.price : s.listPrice, `SKU[${i}] 价格`),
            listPrice: s.listPrice == null ? null : assertMoney(s.listPrice, `SKU[${i}] 划线价`),
            stock: s.stock === null || s.stock === undefined ? null : Number(s.stock),
          }));
        } else if (action === 'update-price') {
          L.requireFields(ctx.body, ['price']);
          const price = assertMoney(ctx.body.price, '价格');
          if (ctx.body.skuId) {
            const sku = (rec.skus || []).find((s) => (s.skuId || s.id) === ctx.body.skuId);
            if (!sku) throw L.err(L.ERR.NOT_FOUND, 'SKU 不存在：' + ctx.body.skuId);
            sku.price = price;
          } else {
            for (const s of rec.skus || []) s.price = price;
          }
        }
        L.bumpVersion(rec);
        L.audit(ctx.db, {
          module: MODULE, action, targetId: rec.productId, operator: ctx.operator, reason,
          before, after: { title: rec.title, status: rec.status, skus: (rec.skus || []).length },
          requestId: ctx.requestId, id: operationId,
        });
        ctx.save();
        const dto = productDto(rec);
        dto.skus = mergeSkus(ctx.db, rec);
        return { product: dto, operationId };
      });
    },
  },
];

module.exports = { name: MODULE, code: CODE, title: TITLE, routes, productDto };

/**
 * 脑商AI合伙人 · 总部后台 · HQ-04 课程权益（Course）
 *
 * 契约：《总部后台API需求文档.md》§6
 *
 * 库表对照：db.hqCourseEntitlements（总部后台专属集合）
 *   entitlementId ↔ id
 *   accountId / memberId / productId / status / validFrom / validUntil / version
 *
 * 说明：需求文档标注「若命名不同以 schema 为准」。当前 MySQL 无课程权益表，
 *      故落在独立的 hq 集合中，不与既有托管表冲突。
 */

const L = require('../lib');

const MODULE = 'course';
const CODE = 'HQ-04';
const TITLE = '课程权益';

const STATUS = ['ACTIVE', 'FROZEN', 'EXPIRED', 'REVOKED'];

function entitlementDto(e) {
  const expired = e.validUntil && new Date(e.validUntil).getTime() < Date.now();
  return {
    entitlementId: e.id,
    accountId: e.accountId || null,
    memberId: e.memberId || null,
    productId: e.productId || null,
    title: e.title || '',
    status: expired && e.status === 'ACTIVE' ? 'EXPIRED' : (e.status || 'ACTIVE'),
    validFrom: L.toIso(e.validFrom),
    validUntil: L.toIso(e.validUntil),
    version: Number(e.version || 1),
    allowedActions: e.status === 'REVOKED' ? [] : ['extend', 'freeze', 'unfreeze', 'revoke'],
  };
}

const routes = [
  {
    module: MODULE,
    method: 'GET',
    path: '/course/entitlements',
    async handler(ctx) {
      const paging = L.readPaging(ctx.query);
      const keyword = ctx.query.get('keyword') || '';
      const accountId = ctx.query.get('accountId') || '';
      const memberId = ctx.query.get('memberId') || '';
      const status = ctx.query.get('status') || '';
      const productId = ctx.query.get('productId') || '';

      let list = (ctx.db.hqCourseEntitlements || []).slice();
      if (keyword) list = list.filter((e) => L.matchKeyword(keyword, e.id, e.title, e.productId, e.accountId));
      if (accountId) list = list.filter((e) => e.accountId === accountId);
      if (memberId) list = list.filter((e) => e.memberId === memberId);
      if (productId) list = list.filter((e) => e.productId === productId);
      if (status) list = list.filter((e) => entitlementDto(e).status === status);

      list.sort((a, b) => String(b.id).localeCompare(String(a.id)));
      const all = ctx.db.hqCourseEntitlements || [];
      const items = list.slice(paging.offset, paging.offset + paging.pageSize).map(entitlementDto);
      return L.listData(items, list.length, paging.page, paging.pageSize, {
        total: all.length,
        active: all.filter((e) => entitlementDto(e).status === 'ACTIVE').length,
        expired: all.filter((e) => entitlementDto(e).status === 'EXPIRED').length,
      });
    },
  },

  {
    module: MODULE,
    method: 'GET',
    path: '/course/catalog',
    async handler(ctx) {
      const products = [];
      for (const s of ctx.db.skus || []) {
        if (!products.find((p) => p.productId === s.productId)) {
          products.push({ productId: s.productId, title: s.productId, skuCount: 0 });
        }
      }
      for (const p of ctx.db.hqProducts || []) {
        products.push({ productId: p.productId, title: p.title, skuCount: (p.skus || []).length });
      }
      return {
        products,
        statuses: STATUS.map((s) => ({ value: s, label: s })),
        summary: { total: (ctx.db.hqCourseEntitlements || []).length },
      };
    },
  },

  {
    module: MODULE,
    method: 'GET',
    path: '/course/entitlements/:entitlementId',
    async handler(ctx) {
      const e = (ctx.db.hqCourseEntitlements || []).find((x) => x.id === ctx.params.entitlementId);
      if (!e) throw L.err(L.ERR.NOT_FOUND, '课程权益不存在：' + ctx.params.entitlementId);
      const audits = (ctx.db.hqAuditLogs || []).filter((a) => a.module === MODULE && a.targetId === e.id).slice(0, 20);
      return { entitlement: entitlementDto(e), audit: audits };
    },
  },

  {
    module: MODULE,
    method: 'POST',
    path: '/course/entitlements/:entitlementId/mutate',
    async handler(ctx) {
      const { action, version } = ctx.body || {};
      L.requireFields(ctx.body, ['action']);
      const reason = L.requireReason(ctx.body, ctx.headerReason);
      const e = (ctx.db.hqCourseEntitlements || []).find((x) => x.id === ctx.params.entitlementId);
      if (!e) throw L.err(L.ERR.NOT_FOUND, '课程权益不存在：' + ctx.params.entitlementId);
      L.checkVersion(ctx, e, version, '课程权益');
      L.ensureEnum(action, ['extend', 'freeze', 'unfreeze', 'revoke'], 'action');

      const before = { status: e.status, validUntil: L.toIso(e.validUntil) };

      return L.withIdempotency(ctx, () => {
        if (action === 'extend') {
          L.requireFields(ctx.body, ['validUntil']);
          const next = new Date(ctx.body.validUntil).getTime();
          const cur = e.validUntil ? new Date(e.validUntil).getTime() : 0;
          if (!Number.isFinite(next)) throw L.err(L.ERR.INVALID_INPUT, 'validUntil 不是合法时间');
          if (next <= cur) throw L.err(L.ERR.INVALID_STATE, '延期后的到期时间必须晚于当前有效期');
          e.validUntil = ctx.body.validUntil;
        } else if (action === 'freeze') {
          if (e.status === 'FROZEN') throw L.err(L.ERR.INVALID_STATE, '该权益已处于冻结状态');
          e.status = 'FROZEN';
        } else if (action === 'unfreeze') {
          if (e.status !== 'FROZEN') throw L.err(L.ERR.INVALID_STATE, '该权益不处于冻结状态');
          e.status = 'ACTIVE';
        } else if (action === 'revoke') {
          if (e.status === 'REVOKED') throw L.err(L.ERR.INVALID_STATE, '该权益已撤销，不可重复操作');
          e.status = 'REVOKED';
          e.revokedAt = L.nowIso();
          e.revokeReason = reason;
        }
        L.bumpVersion(e);
        const operationId = L.nextId(ctx.db, 'hqop');
        L.audit(ctx.db, {
          module: MODULE, action, targetId: e.id, operator: ctx.operator, reason,
          before, after: { status: e.status, validUntil: L.toIso(e.validUntil) },
          requestId: ctx.requestId, id: operationId,
        });
        ctx.save();
        return { entitlement: entitlementDto(e), operationId };
      });
    },
  },

  // ── 创建课程权益（便于后台开通；契约未列，附加能力）──
  {
    module: MODULE,
    method: 'POST',
    path: '/course/entitlements',
    async handler(ctx) {
      const b = ctx.body || {};
      L.requireFields(b, ['title']);
      const reason = L.requireReason(b, ctx.headerReason);
      L.ensureCollections(ctx.db);
      const rec = {
        id: L.nextId(ctx.db, 'hqe'),
        accountId: b.accountId || null,
        memberId: b.memberId || null,
        productId: b.productId || null,
        title: String(b.title),
        status: 'ACTIVE',
        validFrom: b.validFrom || L.nowIso(),
        validUntil: b.validUntil || null,
        version: 1,
        createdAt: L.nowIso(),
      };
      ctx.db.hqCourseEntitlements.push(rec);
      const operationId = L.nextId(ctx.db, 'hqop');
      L.audit(ctx.db, {
        module: MODULE, action: 'create', targetId: rec.id, operator: ctx.operator, reason,
        before: null, after: rec, requestId: ctx.requestId, id: operationId,
      });
      ctx.save();
      return { entitlement: entitlementDto(rec), operationId };
    },
  },
];

module.exports = { name: MODULE, code: CODE, title: TITLE, routes, entitlementDto };

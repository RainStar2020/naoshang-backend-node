/**
 * 脑商AI合伙人 · 总部后台 · HQ-14 优惠券（Coupons）
 *
 * 契约：《总部后台API需求文档.md》§16
 *
 * 库表对照：
 *   - 模板（后台专属）：db.hqCouponTemplates
 *   - 用户券（后台专属）：db.hqUserCoupons
 *   - 既有用户券（业务集合，托管）：db.coupons —— 仅只读参考，不直接改写
 *
 * 金额单位：元。
 */

const L = require('../lib');

const MODULE = 'coupons';
const CODE = 'HQ-14';
const TITLE = '优惠券';

const USER_COUPON_STATUS = ['available', 'not-started', 'reserved', 'used', 'expired'];

/** 校验金额：≥ 0，最多两位小数 */
function assertMoney(v, label) {
  const n = Number(v);
  if (!Number.isFinite(n)) throw L.err(L.ERR.INVALID_INPUT, `${label} 不是合法数字`);
  if (n < 0) throw L.err(L.ERR.INVALID_INPUT, `${label} 不能为负数`);
  if (Math.round(n * 100) !== n * 100) throw L.err(L.ERR.INVALID_INPUT, `${label} 最多保留两位小数`);
  return L.money(n);
}

function templateDto(t) {
  return {
    templateId: t.id,
    title: t.title || '',
    amount: L.money(t.amount || 0),
    minAmount: L.money(t.minAmount || 0),
    scope: t.scope || { kind: 'all', productIds: [] },
    validFrom: L.toIso(t.validFrom),
    expiresAt: L.toIso(t.expiresAt),
    enabled: t.enabled !== false,
    totalQuantity: Number(t.totalQuantity || 0),
    perAccountLimit: Number(t.perAccountLimit || 0),
    issuedQuantity: Number(t.issuedQuantity || 0),
    version: Number(t.version || 1),
  };
}

function userCouponDto(c) {
  const expired = c.expiresAt && new Date(c.expiresAt).getTime() < Date.now();
  return {
    couponId: c.id,
    templateId: c.templateId || null,
    templateVersion: Number(c.templateVersion || 1),
    accountId: c.accountId || null,
    snapshot: c.snapshot || null,
    status: expired && c.status === 'available' ? 'expired' : (c.status || 'available'),
    reservedOrderId: c.reservedOrderId || null,
    usedOrderId: c.usedOrderId || null,
    version: Number(c.version || 1),
  };
}

const routes = [
  // ── 模板与用户券目录 ──
  {
    module: MODULE,
    method: 'GET',
    path: '/coupons/catalog',
    async handler(ctx) {
      const templates = ctx.db.hqCouponTemplates || [];
      const issued = (ctx.db.hqUserCoupons || []).length;
      return {
        templates: templates.map(templateDto),
        userCouponStatus: USER_COUPON_STATUS.map((s) => ({ value: s, label: s })),
        summary: {
          templateCount: templates.length,
          issuedCount: issued,
          usedCount: (ctx.db.hqUserCoupons || []).filter((c) => c.status === 'used').length,
        },
        audit: (ctx.db.hqAuditLogs || []).filter((a) => a.module === MODULE).slice(0, 30),
      };
    },
  },

  // ── 模板列表 ──
  {
    module: MODULE,
    method: 'GET',
    path: '/coupons/templates',
    async handler(ctx) {
      const paging = L.readPaging(ctx.query);
      const keyword = ctx.query.get('keyword') || '';
      let list = (ctx.db.hqCouponTemplates || []).slice();
      if (keyword) list = list.filter((t) => L.matchKeyword(keyword, t.id, t.title));
      list.sort((a, b) => String(a.id).localeCompare(String(b.id)));
      const items = list.slice(paging.offset, paging.offset + paging.pageSize).map(templateDto);
      return L.listData(items, list.length, paging.page, paging.pageSize, { total: list.length });
    },
  },

  // ── 用户券分页 ──
  {
    module: MODULE,
    method: 'GET',
    path: '/coupons',
    async handler(ctx) {
      const paging = L.readPaging(ctx.query);
      const accountId = ctx.query.get('accountId') || '';
      const status = ctx.query.get('status') || '';
      const templateId = ctx.query.get('templateId') || '';
      let list = (ctx.db.hqUserCoupons || []).slice();
      if (accountId) list = list.filter((c) => c.accountId === accountId);
      if (templateId) list = list.filter((c) => c.templateId === templateId);
      if (status) list = list.filter((c) => userCouponDto(c).status === status);
      list.sort((a, b) => String(b.id).localeCompare(String(a.id)));
      const all = ctx.db.hqUserCoupons || [];
      const items = list.slice(paging.offset, paging.offset + paging.pageSize).map(userCouponDto);
      return L.listData(items, list.length, paging.page, paging.pageSize, { total: all.length });
    },
  },

  // ── save-template / issue ──
  {
    module: MODULE,
    method: 'POST',
    path: '/coupons/mutate',
    async handler(ctx) {
      const { action } = ctx.body || {};
      L.requireFields(ctx.body, ['action']);
      const reason = L.requireReason(ctx.body, ctx.headerReason);
      L.ensureEnum(action, ['save-template', 'issue'], 'action');
      L.ensureCollections(ctx.db);

      return L.withIdempotency(ctx, () => {
        const operationId = L.nextId(ctx.db, 'hqop');

        if (action === 'save-template') {
          const v = ctx.body.value || {};
          L.requireFields(v, ['title', 'amount']);
          let tpl = null;
          if (ctx.body.templateId) {
            tpl = ctx.db.hqCouponTemplates.find((t) => t.id === ctx.body.templateId);
            if (!tpl) throw L.err(L.ERR.NOT_FOUND, '优惠券模板不存在：' + ctx.body.templateId);
            L.checkVersion(ctx, tpl, ctx.body.version, '优惠券模板');
          } else {
            tpl = { id: L.nextId(ctx.db, 'hqct'), issuedQuantity: 0, version: 1 };
            ctx.db.hqCouponTemplates.push(tpl);
          }
          const before = { title: tpl.title, amount: tpl.amount, enabled: tpl.enabled };
          tpl.title = String(v.title);
          tpl.amount = assertMoney(v.amount, '面额');
          tpl.minAmount = assertMoney(v.minAmount || 0, '门槛');
          tpl.scope = v.scope || { kind: 'all', productIds: [] };
          tpl.validFrom = v.validFrom || tpl.validFrom || L.nowIso();
          tpl.expiresAt = v.expiresAt || null;
          tpl.enabled = v.enabled === undefined ? tpl.enabled !== false : !!v.enabled;
          tpl.totalQuantity = Number(v.totalQuantity || tpl.totalQuantity || 0);
          tpl.perAccountLimit = Number(v.perAccountLimit || tpl.perAccountLimit || 0);
          L.bumpVersion(tpl);
          L.audit(ctx.db, {
            module: MODULE, action: 'save-template', targetId: tpl.id, operator: ctx.operator, reason,
            before, after: { title: tpl.title, amount: tpl.amount, enabled: tpl.enabled },
            requestId: ctx.requestId, id: operationId,
          });
          ctx.save();
          return { template: templateDto(tpl), operationId };
        }

        // issue：批量发放
        L.requireFields(ctx.body, ['templateId', 'accountIds']);
        const tpl = ctx.db.hqCouponTemplates.find((t) => t.id === ctx.body.templateId);
        if (!tpl) throw L.err(L.ERR.NOT_FOUND, '优惠券模板不存在：' + ctx.body.templateId);
        L.checkVersion(ctx, tpl, ctx.body.version, '优惠券模板');
        const accountIds = ctx.body.accountIds;
        if (!Array.isArray(accountIds) || !accountIds.length) {
          throw L.err(L.ERR.INVALID_INPUT, 'accountIds 必须是非空数组');
        }
        if (tpl.totalQuantity > 0) {
          const remain = tpl.totalQuantity - Number(tpl.issuedQuantity || 0);
          if (accountIds.length > remain) {
            throw L.err(L.ERR.QUOTA_EXCEEDED, `发放数量超出剩余额度（剩余 ${remain} 张）`);
          }
        }
        if (tpl.perAccountLimit > 0) {
          for (const aid of accountIds) {
            const used = (ctx.db.hqUserCoupons || []).filter((c) => c.accountId === aid && c.templateId === tpl.id).length;
            if (used >= tpl.perAccountLimit) {
              throw L.err(L.ERR.QUOTA_EXCEEDED, `账号 ${aid} 已达每账号限领上限（${tpl.perAccountLimit} 张）`);
            }
          }
        }
        const couponIds = [];
        for (const aid of accountIds) {
          const rec = {
            id: L.nextId(ctx.db, 'hqcp'),
            templateId: tpl.id,
            templateVersion: Number(tpl.version || 1),
            accountId: aid,
            snapshot: {
              title: tpl.title, amount: tpl.amount, minAmount: tpl.minAmount,
              scope: tpl.scope, validFrom: tpl.validFrom, expiresAt: tpl.expiresAt,
            },
            status: 'available',
            reservedOrderId: null,
            usedOrderId: null,
            version: 1,
            createdAt: L.nowIso(),
          };
          ctx.db.hqUserCoupons.push(rec);
          couponIds.push(rec.id);
        }
        tpl.issuedQuantity = Number(tpl.issuedQuantity || 0) + couponIds.length;
        L.bumpVersion(tpl);
        L.audit(ctx.db, {
          module: MODULE, action: 'issue', targetId: tpl.id, operator: ctx.operator, reason,
          before: { issuedQuantity: tpl.issuedQuantity - couponIds.length },
          after: { issuedQuantity: tpl.issuedQuantity, count: couponIds.length },
          requestId: ctx.requestId, id: operationId,
        });
        ctx.save();
        return { templateId: tpl.id, couponIds, operationId };
      });
    },
  },
];

module.exports = { name: MODULE, code: CODE, title: TITLE, routes, templateDto, userCouponDto };

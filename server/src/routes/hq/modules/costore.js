/**
 * 脑商AI合伙人 · 总部后台 · HQ-24 共创店（Costore）
 *
 * 契约：《总部后台API需求文档.md》§26
 *
 * 库表对照：
 *   - 共创方案（后台专属）：db.hqCostorePlans
 *   - 共创申请（后台专属）：db.hqCostoreApplications
 *   - 既有合店（托管）：db.coStores（只读参考）
 *
 * 金额单位：元：monthlyFee / payableAmount / refund.amount / priceBoundary.referenceMonthlyFee。
 */

const L = require('../lib');

const MODULE = 'costore';
const CODE = 'HQ-24';
const TITLE = '共创店';

const APP_STATUS = ['PENDING_PAYMENT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'CANCELLED'];
const PAY_STATUS = ['NOT_STARTED', 'PENDING', 'PAID', 'CANCELLED'];
const REFUND_STATUS = ['PENDING', 'SUCCEEDED', 'FAILED'];
const CONTRACT_STATUS = ['NOT_SIGNED', 'PENDING_CONFIRMATION', 'SIGNED'];
const ENTITLEMENT_STATUS = ['NOT_OPEN', 'PENDING_CONFIRMATION', 'OPEN'];

function assertMoney(v, label) {
  const n = Number(v);
  if (!Number.isFinite(n)) throw L.err(L.ERR.INVALID_INPUT, `${label} 不是合法数字`);
  if (n < 0) throw L.err(L.ERR.INVALID_INPUT, `${label} 不能为负数`);
  if (Math.round(n * 100) !== n * 100) throw L.err(L.ERR.INVALID_INPUT, `${label} 最多保留两位小数`);
  return L.money(n);
}

function planDto(p) {
  return {
    planId: p.id,
    title: p.title || '',
    durationId: p.durationId || null,
    months: Number(p.months || 0),
    priceBoundary: {
      referenceMonthlyFee: L.money((p.priceBoundary && p.priceBoundary.referenceMonthlyFee) || p.referenceMonthlyFee || 0),
    },
    benefits: p.benefits || null,
    agreement: p.agreement || null,
    agreementVersion: Number(p.agreementVersion || 1),
    version: Number(p.version || 1),
  };
}

function applicationDto(a) {
  return {
    applicationId: a.id,
    accountId: a.accountId || null,
    applicantName: a.applicantName || null,
    storeId: a.storeId || null,
    storeName: a.storeName || null,
    planId: a.planId || null,
    monthlyFee: L.money(a.monthlyFee || 0),
    payableAmount: L.money(a.payableAmount || 0),
    orderId: a.orderId || null,
    applicationStatus: a.applicationStatus || 'PENDING_PAYMENT',
    paymentStatus: a.paymentStatus || 'NOT_STARTED',
    refundStatus: a.refundStatus === undefined ? null : a.refundStatus,
    contractStatus: a.contractStatus || 'NOT_SIGNED',
    entitlementStatus: a.entitlementStatus || 'NOT_OPEN',
    refund: a.refund || null,
    version: Number(a.version || 1),
    allowedActions: [
      ...(a.applicationStatus === 'PENDING_REVIEW' ? ['approve', 'reject'] : []),
      ...(a.refundStatus === 'FAILED' ? ['retry-refund'] : []),
    ],
  };
}

const routes = [
  // ── 申请分页 ──
  {
    module: MODULE,
    method: 'GET',
    path: '/costore/applications',
    async handler(ctx) {
      const paging = L.readPaging(ctx.query);
      const keyword = ctx.query.get('keyword') || '';
      const applicationStatus = ctx.query.get('applicationStatus') || '';
      let list = (ctx.db.hqCostoreApplications || []).slice();
      if (keyword) list = list.filter((a) => L.matchKeyword(keyword, a.id, a.accountId, a.applicantName, a.storeName));
      if (applicationStatus) list = list.filter((a) => (a.applicationStatus || 'PENDING_PAYMENT') === applicationStatus);
      list.sort((a, b) => String(b.id).localeCompare(String(a.id)));
      const all = ctx.db.hqCostoreApplications || [];
      const items = list.slice(paging.offset, paging.offset + paging.pageSize).map(applicationDto);
      return L.listData(items, list.length, paging.page, paging.pageSize, {
        total: all.length,
        pendingReview: all.filter((a) => a.applicationStatus === 'PENDING_REVIEW').length,
      });
    },
  },

  // ── 方案 plans、门店、是否允许退款重试 ──
  {
    module: MODULE,
    method: 'GET',
    path: '/costore/catalog',
    async handler(ctx) {
      const stores = [];
      const seen = new Set();
      for (const cs of ctx.db.coStores || []) {
        if (cs.store_id && !seen.has(cs.store_id)) {
          seen.add(cs.store_id);
          stores.push({ storeId: cs.store_id, name: cs.store_name || cs.store_id });
        }
      }
      for (const s of ctx.db.hqStores || []) {
        if (!seen.has(s.storeId)) {
          seen.add(s.storeId);
          stores.push({ storeId: s.storeId, name: s.name });
        }
      }
      const failedRefunds = (ctx.db.hqCostoreApplications || []).filter((a) => a.refundStatus === 'FAILED').length;
      return {
        plans: (ctx.db.hqCostorePlans || []).map(planDto),
        stores,
        allowRefundRetry: failedRefunds > 0,
        applicationStatuses: APP_STATUS.map((s) => ({ value: s, label: s })),
        paymentStatuses: PAY_STATUS.map((s) => ({ value: s, label: s })),
        refundStatuses: REFUND_STATUS.map((s) => ({ value: s, label: s })),
        contractStatuses: CONTRACT_STATUS.map((s) => ({ value: s, label: s })),
        entitlementStatuses: ENTITLEMENT_STATUS.map((s) => ({ value: s, label: s })),
        summary: { total: (ctx.db.hqCostoreApplications || []).length, failedRefunds },
      };
    },
  },

  // ── 详情 + 退款 + 审计 ──
  {
    module: MODULE,
    method: 'GET',
    path: '/costore/applications/:applicationId',
    async handler(ctx) {
      const a = (ctx.db.hqCostoreApplications || []).find((x) => x.id === ctx.params.applicationId);
      if (!a) throw L.err(L.ERR.NOT_FOUND, '共创申请不存在：' + ctx.params.applicationId);
      const audit = (ctx.db.hqAuditLogs || []).filter((x) => x.module === MODULE && x.targetId === a.id).slice(0, 20);
      return { application: applicationDto(a), refund: a.refund || null, audit };
    },
  },

  // ── save-plan / retry-refund ──
  {
    module: MODULE,
    method: 'POST',
    path: '/costore/mutate',
    async handler(ctx) {
      const { action } = ctx.body || {};
      L.requireFields(ctx.body, ['action']);
      const reason = L.requireReason(ctx.body, ctx.headerReason);
      L.ensureEnum(action, ['save-plan', 'retry-refund'], 'action');
      L.ensureCollections(ctx.db);

      return L.withIdempotency(ctx, () => {
        const operationId = L.nextId(ctx.db, 'hqop');

        if (action === 'save-plan') {
          L.requireFields(ctx.body, ['title']);
          let p = null;
          if (ctx.body.planId) {
            p = ctx.db.hqCostorePlans.find((x) => x.id === ctx.body.planId);
            if (!p) throw L.err(L.ERR.NOT_FOUND, '方案不存在：' + ctx.body.planId);
            L.checkVersion(ctx, p, ctx.body.version, '共创方案');
          } else {
            p = { id: L.nextId(ctx.db, 'hqcp'), version: 1 };
            ctx.db.hqCostorePlans.push(p);
          }
          const before = { title: p.title, months: p.months };
          p.title = String(ctx.body.title);
          p.durationId = ctx.body.durationId || p.durationId || null;
          p.months = Number(ctx.body.months || p.months || 0);
          if (ctx.body.referenceMonthlyFee !== undefined) {
            p.priceBoundary = { referenceMonthlyFee: assertMoney(ctx.body.referenceMonthlyFee, '参考月费') };
          }
          if (ctx.body.benefits !== undefined) p.benefits = ctx.body.benefits;
          if (ctx.body.agreement !== undefined) p.agreement = ctx.body.agreement;
          if (ctx.body.agreementVersion !== undefined) p.agreementVersion = Number(ctx.body.agreementVersion);
          L.bumpVersion(p);
          L.audit(ctx.db, {
            module: MODULE, action: 'save-plan', targetId: p.id, operator: ctx.operator, reason,
            before, after: { title: p.title, months: p.months }, requestId: ctx.requestId, id: operationId,
          });
          ctx.save();
          return { plan: planDto(p), operationId };
        }

        // retry-refund
        L.requireFields(ctx.body, ['applicationId']);
        const a = ctx.db.hqCostoreApplications.find((x) => x.id === ctx.body.applicationId);
        if (!a) throw L.err(L.ERR.NOT_FOUND, '共创申请不存在：' + ctx.body.applicationId);
        if (a.refundStatus !== 'FAILED') throw L.err(L.ERR.INVALID_STATE, '仅退款失败的申请可重试');
        const before = { refundStatus: a.refundStatus };
        a.refundStatus = 'PENDING';
        a.refund = Object.assign({}, a.refund || {}, {
          status: 'PENDING', amount: L.money((a.refund && a.refund.amount) || a.payableAmount || 0),
          retryReason: reason, retriedAt: L.nowIso(),
        });
        L.bumpVersion(a);
        L.audit(ctx.db, {
          module: MODULE, action: 'retry-refund', targetId: a.id, operator: ctx.operator, reason,
          before, after: { refundStatus: a.refundStatus }, requestId: ctx.requestId, id: operationId,
        });
        ctx.save();
        return { application: applicationDto(a), operationId };
      });
    },
  },
];

module.exports = { name: MODULE, code: CODE, title: TITLE, routes, planDto, applicationDto };

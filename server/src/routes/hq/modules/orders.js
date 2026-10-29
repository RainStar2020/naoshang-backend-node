/**
 * 脑商AI合伙人 · 总部后台 · HQ-13 订单（Orders）
 *
 * 契约：《总部后台API需求文档.md》§15
 *
 * 库表对照：db.orders（既有、托管）
 *
 * 双状态映射（前端重视 paymentStatus + fulfillmentStatus，库中多为单一 status）：
 *   - 套餐单（type 非 'product'）：
 *       paymentStatus    ← status === 'paid' ? PAID : (status === 'cancelled' ? CANCELLED : PENDING_PAYMENT)
 *       fulfillmentStatus← 'paid' ? (type==='package' ? NOT_REQUIRED : PENDING_DELIVERY) : PENDING_DELIVERY
 *   - 产品单（type === 'product'）：
 *       paymentStatus    ← status === 'paid' ? PAID : (status === 'cancelled' ? CANCELLED : PENDING_PAYMENT)
 *       fulfillmentStatus← verified ? DELIVERED : (status === 'paid' ? PENDING_DELIVERY : NOT_REQUIRED)
 *
 * 金额单位：元（库里已是元，直接透传）。
 */

const L = require('../lib');

const MODULE = 'orders';
const CODE = 'HQ-13';
const TITLE = '订单';

const PAYMENT_STATUS = ['PENDING_PAYMENT', 'PAID', 'CANCELLED', 'REFUNDING', 'REFUNDED'];
const FULFILLMENT_STATUS = ['PENDING_DELIVERY', 'DELIVERED', 'NOT_REQUIRED'];

/** 支付状态映射 */
function paymentStatusOf(o) {
  if (o.status === 'paid') return 'PAID';
  if (o.status === 'cancelled' || o.cancelled_at) return 'CANCELLED';
  if (o.status === 'refunding') return 'REFUNDING';
  if (o.status === 'refunded') return 'REFUNDED';
  return 'PENDING_PAYMENT';
}

/** 履约状态映射 */
function fulfillmentStatusOf(o) {
  if (o.verified) return 'DELIVERED';
  if (o.status !== 'paid') return 'NOT_REQUIRED';
  if (o.type === 'product' && (o.delivery_mode || '').toUpperCase() === 'VIRTUAL') return 'NOT_REQUIRED';
  return 'PENDING_DELIVERY';
}

/** 业务类型 */
function businessOf(o) {
  if (o.type === 'product') return 'MALL';
  if (o.skuId || o.productKey) return 'MALL';
  return 'BUSINESS';
}

function orderDto(o, opts) {
  const mask = !(opts && opts.reveal);
  const ps = paymentStatusOf(o);
  const fs = fulfillmentStatusOf(o);
  const paid = o.paid != null ? Number(o.paid) : (o.actual_paid != null ? Number(o.actual_paid) : null);
  const goodsAmount = o.paid != null ? L.money(o.paid) : L.money(o.actual_paid);
  return {
    orderId: o.id,
    orderNo: o.id,
    accountId: o.buyer_id || null,
    business: businessOf(o),
    type: o.type || 'package',
    productKey: o.productKey || null,
    productName: o.productName || null,
    skuId: o.skuId || null,
    skuLabel: o.skuLabel || null,
    quantity: Number(o.qty != null ? o.qty : o.quotaCount || 1),
    memberId: o.member_id || null,
    paymentStatus: ps,
    fulfillmentStatus: fs,
    goodsAmount,
    discountAmount: L.money(o.discountAmount || 0),
    payableAmount: L.money(o.total_payable != null ? o.total_payable : goodsAmount),
    paidAmount: paid === null ? null : L.money(paid),
    channel: o.channel || null,
    regionCode: o.regionCode || null,
    storeId: o.storeId || null,
    buyerPhone: mask ? L.maskPhone(o.buyerPhone) : (o.buyerPhone || null),
    createdAt: L.toIso(o.created_at),
    paidAt: L.toIso(o.paidAt || (o.status === 'paid' ? o.created_at : null)),
    version: Number(o.version || 1),
    allowedActions:
      ps === 'PAID'
        ? (fs === 'PENDING_DELIVERY' ? ['add-note', 'mark-fulfilled', 'close'] : ['add-note', 'close'])
        : (ps === 'PENDING_PAYMENT' ? ['cancel', 'add-note'] : ['add-note']),
  };
}

const routes = [
  // ── 订单分页 ──
  {
    module: MODULE,
    method: 'GET',
    path: '/orders',
    async handler(ctx) {
      const paging = L.readPaging(ctx.query);
      const keyword = ctx.query.get('keyword') || '';
      const paymentStatus = ctx.query.get('paymentStatus') || '';
      const fulfillmentStatus = ctx.query.get('fulfillmentStatus') || '';
      const business = ctx.query.get('business') || '';
      const accountId = ctx.query.get('accountId') || '';
      const from = ctx.query.get('from') || '';
      const to = ctx.query.get('to') || '';

      let list = (ctx.db.orders || []).slice();
      if (keyword) {
        list = list.filter((o) => {
          const u = ctx.db.users[o.buyer_id];
          return L.matchKeyword(keyword, o.id, o.productName, o.skuLabel, o.buyer_id, u && u.phone, u && u.name);
        });
      }
      if (paymentStatus) list = list.filter((o) => paymentStatusOf(o) === paymentStatus);
      if (fulfillmentStatus) list = list.filter((o) => fulfillmentStatusOf(o) === fulfillmentStatus);
      if (business) list = list.filter((o) => businessOf(o) === business);
      if (accountId) list = list.filter((o) => o.buyer_id === accountId);
      if (from) {
        const t = new Date(from).getTime();
        list = list.filter((o) => new Date(o.created_at).getTime() >= t);
      }
      if (to) {
        const t = new Date(to).getTime();
        list = list.filter((o) => new Date(o.created_at).getTime() <= t);
      }
      list.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

      const all = ctx.db.orders || [];
      const items = list.slice(paging.offset, paging.offset + paging.pageSize).map((o) => orderDto(o));
      return L.listData(items, list.length, paging.page, paging.pageSize, {
        total: all.length,
        paid: all.filter((o) => paymentStatusOf(o) === 'PAID').length,
        pending: all.filter((o) => paymentStatusOf(o) === 'PENDING_PAYMENT').length,
        gmv: L.money(all.filter((o) => paymentStatusOf(o) === 'PAID')
          .reduce((a, o) => a + (Number(o.paid != null ? o.paid : o.actual_paid) || 0), 0)),
      });
    },
  },

  // ── 状态/业务类型目录 ──
  {
    module: MODULE,
    method: 'GET',
    path: '/orders/catalog',
    async handler(ctx) {
      const all = ctx.db.orders || [];
      return {
        paymentStatuses: PAYMENT_STATUS.map((s) => ({ value: s, label: s })),
        fulfillmentStatuses: FULFILLMENT_STATUS.map((s) => ({ value: s, label: s })),
        businesses: [
          { value: 'MALL', label: '商城' },
          { value: 'MEMBERSHIP', label: '会员' },
          { value: 'BUSINESS', label: '业务' },
        ],
        actions: [
          { value: 'cancel', label: '取消' },
          { value: 'add-note', label: '加备注' },
          { value: 'close', label: '关闭' },
          { value: 'mark-fulfilled', label: '标记履约完成' },
        ],
        summary: {
          total: all.length,
          paid: all.filter((o) => paymentStatusOf(o) === 'PAID').length,
          pending: all.filter((o) => paymentStatusOf(o) === 'PENDING_PAYMENT').length,
        },
      };
    },
  },

  // ── 订单详情 ──
  {
    module: MODULE,
    method: 'GET',
    path: '/orders/:orderId',
    async handler(ctx) {
      const o = (ctx.db.orders || []).find((x) => x.id === ctx.params.orderId);
      if (!o) throw L.err(L.ERR.NOT_FOUND, '订单不存在：' + ctx.params.orderId);
      const u = ctx.db.users[o.buyer_id];
      const items = [{
        productId: o.productKey || o.packageTier || null,
        skuId: o.skuId || null,
        title: o.productName || o.packageTier || '',
        quantity: Number(o.qty != null ? o.qty : o.quotaCount || 1),
        price: L.money(o.unitPrice != null ? o.unitPrice : o.actual_paid),
        lineAmount: L.money(o.paid != null ? o.paid : o.actual_paid),
      }];
      const payment = (ctx.db.payments || []).find((p) => p.bizId === o.id) || null;
      const shipment = (ctx.db.hqShipments || []).find((s) => s.orderId === o.id) || null;
      const coupons = (ctx.db.coupons || []).filter((c) => c.usedOrderId === o.id);
      const audit = (ctx.db.hqAuditLogs || []).filter((a) => a.module === MODULE && a.targetId === o.id).slice(0, 20);
      return {
        order: orderDto(o, { reveal: true }),
        buyer: u ? { accountId: u.id, name: u.name, phone: u.phone, tier: u.tier } : null,
        items,
        payment,
        shipment,
        coupons,
        audit,
      };
    },
  },

  // ── 订单写操作 ──
  {
    module: MODULE,
    method: 'POST',
    path: '/orders/:orderId/mutate',
    async handler(ctx) {
      const { action, version } = ctx.body || {};
      L.requireFields(ctx.body, ['action']);
      const reason = L.requireReason(ctx.body, ctx.headerReason);
      L.ensureEnum(action, ['cancel', 'add-note', 'close', 'mark-fulfilled'], 'action');
      const o = (ctx.db.orders || []).find((x) => x.id === ctx.params.orderId);
      if (!o) throw L.err(L.ERR.NOT_FOUND, '订单不存在：' + ctx.params.orderId);
      L.checkVersion(ctx, o, version, '订单');
      const before = { status: o.status, note: o.note || null };

      return L.withIdempotency(ctx, () => {
        const operationId = L.nextId(ctx.db, 'hqop');

        if (action === 'cancel') {
          if (paymentStatusOf(o) === 'PAID') throw L.err(L.ERR.INVALID_STATE, '已支付订单不可直接取消，请走退款流程');
          if (o.status === 'cancelled') throw L.err(L.ERR.INVALID_STATE, '该订单已取消');
          o.status = 'cancelled';
          o.cancelled_at = L.nowMs();
          o.cancelled_by = ctx.operator ? ctx.operator.adminId : 'admin';
          o.cancel_reason = reason;
          // 回补库存（产品单）
          if (o.type === 'product' && o.skuId && !o.stock_restored) {
            const sku = (ctx.db.skus || []).find((s) => s.id === o.skuId);
            if (sku) {
              const qty = Number(o.skuQty || o.qty || 1);
              sku.stock = Number(sku.stock || 0) + qty;
              sku.updatedAt = L.nowMs();
              o.stock_restored = true;
              ctx.db.stockLedger = ctx.db.stockLedger || [];
              ctx.db.stockLedger.push({
                id: L.nextId(ctx.db, 'sl'), skuId: sku.id, delta: qty, reason: '订单取消回补',
                orderId: o.id, operatorId: ctx.operator ? ctx.operator.adminId : 'admin',
                at: L.nowMs(), balanceAfter: sku.stock,
              });
            }
          }
        } else if (action === 'add-note') {
          L.requireFields(ctx.body, ['note']);
          o.note = String(ctx.body.note);
        } else if (action === 'close') {
          if (o.status === 'closed') throw L.err(L.ERR.INVALID_STATE, '该订单已关闭');
          o.status = 'closed';
          o.closed_at = L.nowMs();
        } else if (action === 'mark-fulfilled') {
          if (paymentStatusOf(o) !== 'PAID') throw L.err(L.ERR.INVALID_STATE, '未支付订单不可标记履约');
          if (o.verified) throw L.err(L.ERR.INVALID_STATE, '该订单已履约');
          o.verified = true;
          o.verified_at = L.nowMs();
          o.verified_by = ctx.operator ? ctx.operator.adminId : 'admin';
        }
        L.bumpVersion(o);
        L.audit(ctx.db, {
          module: MODULE, action, targetId: o.id, operator: ctx.operator, reason,
          before, after: { status: o.status, note: o.note || null },
          requestId: ctx.requestId, id: operationId,
        });
        ctx.save();
        return { order: orderDto(o), operationId };
      });
    },
  },
];

module.exports = { name: MODULE, code: CODE, title: TITLE, routes, orderDto, paymentStatusOf, fulfillmentStatusOf };

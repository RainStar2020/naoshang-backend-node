/**
 * 脑商AI合伙人 · 总部后台 · HQ-12 履约发货（Delivery）
 *
 * 契约：《总部后台API需求文档.md》§14
 *
 * 库表对照：db.hqShipments（后台专属发货单）
 * 说明：本模块是**实物履约物流**，与分销升档无关。
 * 收件手机号属敏感字段，列表脱敏。
 */

const L = require('../lib');

const MODULE = 'delivery';
const CODE = 'HQ-12';
const TITLE = '履约发货';

const SHIPMENT_STATUS = ['PENDING', 'SHIPPED', 'DELIVERED', 'EXCEPTION'];

function shipmentDto(s, opts) {
  const mask = !(opts && opts.reveal);
  return {
    shipmentId: s.id,
    orderId: s.orderId || null,
    orderNo: s.orderNo || null,
    status: s.status || 'PENDING',
    carrier: s.carrier || null,
    trackingNo: s.trackingNo || null,
    receiverName: s.receiverName || null,
    receiverPhone: mask ? L.maskPhone(s.receiverPhone) : (s.receiverPhone || null),
    address: s.address || null,
    shippedAt: L.toIso(s.shippedAt),
    deliveredAt: L.toIso(s.deliveredAt),
    exceptionReason: s.exceptionReason || null,
    version: Number(s.version || 1),
    allowedActions:
      (s.status || 'PENDING') === 'PENDING'
        ? ['ship', 'flag-exception']
        : (s.status === 'SHIPPED' ? ['mark-delivered', 'flag-exception'] : []),
  };
}

const routes = [
  // ── 发货单分页 ──
  {
    module: MODULE,
    method: 'GET',
    path: '/delivery/shipments',
    async handler(ctx) {
      const paging = L.readPaging(ctx.query);
      const keyword = ctx.query.get('keyword') || '';
      const status = ctx.query.get('status') || '';
      let list = (ctx.db.hqShipments || []).slice();
      if (keyword) list = list.filter((s) => L.matchKeyword(keyword, s.id, s.orderId, s.orderNo, s.trackingNo));
      if (status) list = list.filter((s) => (s.status || 'PENDING') === status);
      list.sort((a, b) => String(b.id).localeCompare(String(a.id)));
      const all = ctx.db.hqShipments || [];
      const items = list.slice(paging.offset, paging.offset + paging.pageSize).map((s) => shipmentDto(s));
      return L.listData(items, list.length, paging.page, paging.pageSize, {
        total: all.length,
        pending: all.filter((s) => (s.status || 'PENDING') === 'PENDING').length,
        exception: all.filter((s) => s.status === 'EXCEPTION').length,
      });
    },
  },

  // ── 快递公司目录 ──
  {
    module: MODULE,
    method: 'GET',
    path: '/delivery/catalog',
    async handler(ctx) {
      return {
        carriers: [
          { value: 'SF', label: '顺丰速运' },
          { value: 'JD', label: '京东物流' },
          { value: 'YTO', label: '圆通速递' },
          { value: 'ZTO', label: '中通快递' },
          { value: 'YUNDA', label: '韵达快递' },
          { value: 'EMS', label: '中国邮政EMS' },
        ],
        statuses: SHIPMENT_STATUS.map((s) => ({ value: s, label: s })),
        summary: { total: (ctx.db.hqShipments || []).length },
      };
    },
  },

  // ── 发货单详情 ──
  {
    module: MODULE,
    method: 'GET',
    path: '/delivery/shipments/:shipmentId',
    async handler(ctx) {
      const s = (ctx.db.hqShipments || []).find((x) => x.id === ctx.params.shipmentId);
      if (!s) throw L.err(L.ERR.NOT_FOUND, '发货单不存在：' + ctx.params.shipmentId);
      const order = s.orderId ? (ctx.db.orders || []).find((o) => o.id === s.orderId) : null;
      return { shipment: shipmentDto(s, { reveal: true }), order };
    },
  },

  // ── 填写运单 / 发货 / 异常 ──
  {
    module: MODULE,
    method: 'POST',
    path: '/delivery/shipments/:shipmentId/mutate',
    async handler(ctx) {
      const { action, version } = ctx.body || {};
      L.requireFields(ctx.body, ['action']);
      const reason = L.requireReason(ctx.body, ctx.headerReason);
      L.ensureEnum(action, ['ship', 'mark-delivered', 'flag-exception', 'update-note'], 'action');
      const s = (ctx.db.hqShipments || []).find((x) => x.id === ctx.params.shipmentId);
      if (!s) throw L.err(L.ERR.NOT_FOUND, '发货单不存在：' + ctx.params.shipmentId);
      L.checkVersion(ctx, s, version, '发货单');
      const before = { status: s.status, carrier: s.carrier, trackingNo: s.trackingNo };

      return L.withIdempotency(ctx, () => {
        const operationId = L.nextId(ctx.db, 'hqop');

        if (action === 'ship') {
          if (s.status && s.status !== 'PENDING') throw L.err(L.ERR.INVALID_STATE, '该发货单已发货或已关闭');
          L.requireFields(ctx.body, ['carrier', 'trackingNo']);
          s.carrier = String(ctx.body.carrier);
          s.trackingNo = String(ctx.body.trackingNo);
          s.status = 'SHIPPED';
          s.shippedAt = L.nowIso();
        } else if (action === 'mark-delivered') {
          if (s.status !== 'SHIPPED') throw L.err(L.ERR.INVALID_STATE, '仅已发货的单据可标记送达');
          s.status = 'DELIVERED';
          s.deliveredAt = L.nowIso();
        } else if (action === 'flag-exception') {
          L.requireFields(ctx.body, ['exceptionReason']);
          s.status = 'EXCEPTION';
          s.exceptionReason = String(ctx.body.exceptionReason);
        } else if (action === 'update-note') {
          L.requireFields(ctx.body, ['note']);
          s.note = String(ctx.body.note);
        }
        L.bumpVersion(s);
        L.audit(ctx.db, {
          module: MODULE, action, targetId: s.id, operator: ctx.operator, reason,
          before, after: { status: s.status, carrier: s.carrier, trackingNo: s.trackingNo },
          requestId: ctx.requestId, id: operationId,
        });
        ctx.save();
        return { shipment: shipmentDto(s), operationId };
      });
    },
  },

  // ── 从订单创建发货单（附加能力）──
  {
    module: MODULE,
    method: 'POST',
    path: '/delivery/shipments',
    async handler(ctx) {
      const b = ctx.body || {};
      L.requireFields(b, ['orderId']);
      const reason = L.requireReason(b, ctx.headerReason);
      const order = (ctx.db.orders || []).find((o) => o.id === b.orderId);
      if (!order) throw L.err(L.ERR.NOT_FOUND, '订单不存在：' + b.orderId);
      L.ensureCollections(ctx.db);

      return L.withIdempotency(ctx, () => {
        const rec = {
          id: L.nextId(ctx.db, 'hqsh'),
          orderId: order.id,
          orderNo: order.id,
          status: 'PENDING',
          carrier: null,
          trackingNo: null,
          receiverName: b.receiverName || null,
          receiverPhone: b.receiverPhone || null,
          address: b.address || null,
          version: 1,
          createdAt: L.nowIso(),
        };
        ctx.db.hqShipments.push(rec);
        const operationId = L.nextId(ctx.db, 'hqop');
        L.audit(ctx.db, {
          module: MODULE, action: 'create', targetId: rec.id, operator: ctx.operator, reason,
          before: null, after: rec, requestId: ctx.requestId, id: operationId,
        });
        ctx.save();
        return { shipment: shipmentDto(rec), operationId };
      });
    },
  },
];

module.exports = { name: MODULE, code: CODE, title: TITLE, routes, shipmentDto };

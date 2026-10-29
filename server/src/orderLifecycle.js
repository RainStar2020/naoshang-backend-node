/**
 * 脑商AI合伙人 · 订单生命周期（P0-5 支付超时 / P0-6 线下交付核销，2026-10-26 拍板）
 *
 * ════════════════════════════════════════════════════════════════
 * 一、支付倒计时 + 超时自动取消（原型屏 156/161/164/167/170、157/162/165/168/171）
 * ════════════════════════════════════════════════════════════════
 *   · 待支付订单：status = 'PENDING_PAYMENT'，pay_expire_at = 下单时间 + 30 分钟（后台可配 settings.order.payTimeoutMinutes）
 *   · 详情/列表下发 remainSeconds（服务端算，前端只倒计时），归零即自动取消
 *   · 自动取消：status='CANCELLED'，cancel_reason='PAY_TIMEOUT'，cancelled_at，副文「支付超时，订单自动取消」
 *   · 主动取消：cancel_reason='USER_CANCEL'，与超时取消区分
 *   · 扫描入口：HTTP 请求惰性扫描（ensureAlive）+ 后台/定时任务 sweep
 *
 * ════════════════════════════════════════════════════════════════
 * 二、线下交付核销（原型屏 166/169、128/140）
 * ════════════════════════════════════════════════════════════════
 *   交付模式 delivery_mode：
 *     ONLINE_STORE  到店消费/取货（特色产品、行政费、集训营）
 *     ACTIVATION    下单后到店取激活码（软件卡、专栏课/虚拟）
 *     EXPRESS       快递发货（实物）
 *   核销：POST /stores/{storeId}/orders/{orderNo}/verify，凭 6 位核销码校验 → status='COMPLETED'
 *         激活码类商品同时下发「订单 → 激活码」绑定（activation_code）。
 */
const { round2 } = require('./commission');
const S = require('./store');
const STK = require('./stock');

const nowMs = () => Date.now();
const DEFAULT_MINUTES = 30;

/** 支付时限（分钟），跟随后台配置 */
function timeoutMinutes(db) {
  const s = db ? S.getSettings(db) : null;
  const m = s && s.order ? Number(s.order.payTimeoutMinutes) : NaN;
  return Number.isFinite(m) && m > 0 ? m : DEFAULT_MINUTES;
}

/** 订单是否待支付态 */
function isPending(order) {
  return !!order && ['PENDING_PAYMENT', 'PENDING', 'UNPAID', 'CREATED'].includes(order.status);
}

/** 置为待支付（下单时调用；返回订单本身） */
function markPending(db, order, { now = nowMs(), minutes } = {}) {
  const mm = minutes || timeoutMinutes(db);
  order.status = 'PENDING_PAYMENT';
  order.pay_expire_at = now + mm * 60000;
  order.pay_timeout_minutes = mm;
  order.created_at = order.created_at || now;
  return order;
}

/** 剩余秒数（非待支付态返回 0） */
function remainSeconds(order, now = nowMs()) {
  if (!isPending(order) || !order.pay_expire_at) return 0;
  return Math.max(0, Math.floor((order.pay_expire_at - now) / 1000));
}

/** 倒计时文案 mm:ss（前端可直接展示，也可自行格式化） */
function remainText(order, now = nowMs()) {
  const s = remainSeconds(order, now);
  if (!s) return null;
  const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const sec = s % 60;
  return [h, m, sec].map((n) => String(n).padStart(2, '0')).join(':');
}

/** 状态中文文案（含超时副文） */
function statusLabel(order) {
  if (!order) return null;
  const map = {
    PENDING_PAYMENT: '待支付', PAID: '已支付', paid: '已支付', COMPLETED: '已完成',
    CANCELLED: '已取消', REFUNDED: '已退款', PENDING: '待支付',
  };
  const label = map[order.status] || order.status;
  if (order.status === 'CANCELLED' && order.cancel_reason === 'PAY_TIMEOUT') return '已取消（支付超时，订单自动取消）';
  if (order.status === 'CANCELLED') return '已取消';
  return label;
}

/**
 * 订单当前允许的操作（前端按钮显隐的唯一依据）
 *
 * 口径与 cancel() 的保护保持一致：
 *   · 待支付 → 可支付、可取消（取消会回补 SKU 库存）
 *   · 已支付 → **不可取消**（需走退款），可确认收货
 *   · 已完成 / 已取消 / 已退款 → 无可执行动作
 *
 * 2026-10-27 新增：此前 h5 契约层硬编码 ['pay','cancel']，导致已付款订单
 *   也显示「取消订单」，用户点了钱不退、货不回补。
 */
function allowedActions(order) {
  if (!order) return [];
  const st = order.status;
  if (['PENDING_PAYMENT', 'PENDING', 'pending', 'UNPAID', 'CREATED'].includes(st)) return ['pay', 'cancel'];
  if (['PAID', 'paid'].includes(st)) return ['confirm-receipt'];
  if (st === 'COMPLETED') return [];
  if (['CANCELLED', 'REFUNDED'].includes(st)) return [];
  return ['pay', 'cancel'];
}

/** 主动取消 */
function cancel(order, { reason = 'USER_CANCEL', operatorId = null, now = nowMs(), note = null } = {}) {
  if (!order) throw new Error('订单不存在');
  if (['PAID', 'paid', 'COMPLETED'].includes(order.status)) throw new Error('已支付订单不可取消，请走退款');
  order.status = 'CANCELLED';
  order.cancel_reason = reason;
  order.cancelled_at = now;
  order.cancelled_by = operatorId || null;
  if (note) order.cancel_note = note;
  return order;
}

/**
 * 惰性扫描：把已过支付时限的待支付订单批量取消。
 * @returns {Array} 本次被取消的订单
 */
function sweep(db, { now = nowMs(), limit = 500 } = {}) {
  const settings = S.getSettings(db);
  if (settings.order && settings.order.autoExpireSweep === false) return [];
  const out = [];
  for (const o of db.orders) {
    if (out.length >= limit) break;
    if (!isPending(o) || !o.pay_expire_at) continue;
    if (o.pay_expire_at > now) continue;
    cancel(o, { reason: 'PAY_TIMEOUT', now });
    STK.restoreStockForOrder(db, o);   // SKU 库存回补（幂等）
    out.push(o);
  }
  return out;
}

/** 单笔惰性检查（详情/列表前调用，避免展示已超时还挂着倒计时的单） */
function ensureAlive(db, order, { now = nowMs() } = {}) {
  if (order && isPending(order) && order.pay_expire_at && order.pay_expire_at <= now) {
    cancel(order, { reason: 'PAY_TIMEOUT', now });
    STK.restoreStockForOrder(db, order);   // SKU 库存回补（幂等）
    return true;
  }
  return false;
}

/** 支付成功 → 置为已支付（清倒计时） */
function markPaid(order, { now = nowMs(), paymentId = null } = {}) {
  if (!order) return null;
  order.status = 'paid';
  order.paid_at = now;
  order.pay_expire_at = null;
  if (paymentId) order.payment_id = paymentId;
  return order;
}

// ─────────────── 线下交付 / 核销 ───────────────
/** 商品 → 交付模式与提示文案（按 productType，对齐原型） */
const DELIVERY_BY_KIND = {
  featured: { deliveryMode: 'ONLINE_STORE', activationMode: 'NONE', tipText: '该单为线下支付产品，请前往门店使用' },
  admin: { deliveryMode: 'ONLINE_STORE', activationMode: 'NONE', tipText: '该单为线下支付产品（行政费/集训营），请前往门店使用' },
  software: { deliveryMode: 'ACTIVATION', activationMode: 'CODE', tipText: '下单后联系门店获取激活码' },
  virtual: { deliveryMode: 'ACTIVATION', activationMode: 'CODE', tipText: '下单后联系门店获取激活码' },
  physical: { deliveryMode: 'EXPRESS', activationMode: 'NONE', tipText: '实物商品，支付后由门店/总部发货' },
};

function deliveryOf(kind) {
  return DELIVERY_BY_KIND[kind] || { deliveryMode: 'ONLINE_STORE', activationMode: 'NONE', tipText: '请前往门店核销使用' };
}

/** 生成 6 位数字核销码（确定性可复现：订单号 + 盐 → 便于线下口头报数） */
function verifyCodeOf(order) {
  if (order.verify_code) return order.verify_code;
  const seed = String(order.orderNo || order.id || '') + 'ns2026';
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 1000000;
  order.verify_code = String(100000 + (h % 900000));
  return order.verify_code;
}

/** 把交付字段挂到订单上（下单时调用） */
function attachDelivery(order, kind, { storeCode = null } = {}) {
  const d = deliveryOf(kind);
  order.delivery_mode = d.deliveryMode;
  order.activation_mode = d.activationMode;
  order.tip_text = d.tipText;
  order.delivery_store = storeCode || order.store_code || order.regionCode || null;
  order.verify_code = verifyCodeOf(order);
  order.verified = false;
  order.verified_at = null;
  order.verified_by = null;
  return order;
}

/**
 * 核销失败次数上限（前端反馈问题 8：失败次数限制未说明）
 * 同一订单连续核销失败达到上限 → 锁定该订单核销，需后台/客服介入解锁。
 * 成功核销一次即清零。
 */
const MAX_VERIFY_FAILURES = 5;

/** 记录一次核销失败；达上限则锁定 */
function recordVerifyFailure(order, now = nowMs()) {
  order.verify_fail_count = (order.verify_fail_count || 0) + 1;
  order.verify_last_fail_at = now;
  if (order.verify_fail_count >= MAX_VERIFY_FAILURES) {
    order.verify_locked = true;
    order.verify_locked_at = now;
  }
  return order.verify_fail_count;
}

/** 订单可核销？ */
function verifiable(order) {
  if (!order) return { ok: false, reason: '订单不存在' };
  if (order.verified) return { ok: false, reason: '该订单已核销' };
  if (order.verify_locked) return { ok: false, reason: `核销失败次数已达上限（${order.verify_fail_count} 次），订单核销已锁定，请联系总部` };
  if (['CANCELLED', 'REFUNDED'].includes(order.status)) return { ok: false, reason: '已取消/退款的订单不可核销' };
  if (isPending(order)) return { ok: false, reason: '订单待支付，暂不可核销' };
  if (order.delivery_mode === 'EXPRESS') return { ok: false, reason: '快递发货订单不走到店核销' };
  return { ok: true };
}

/**
 * 核销（线下交付）。
 *
 * 权限与边界（前端反馈问题 8）：
 *   · 调用方必须是 admin / coach / 该门店老板（鉴权在路由层 h5biz.js 完成）；
 *   · 未付款订单不可核销（isPending 拦截）；
 *   · 已核销订单不可重复核销（verified 拦截）；
 *   · 核销码必须匹配（6 位数字，确定性生成）；
 *   · 订单归属门店校验：总部下发的门店交付单允许任意门店核销；
 *   · 连续核销失败达 5 次 → 锁定该订单核销（需后台解锁）。
 * @param {object} db
 * @param {object} opt { storeId, orderNo, code, operatorId, now }
 * @returns {{order, activationCode, deliveryMode, verifiedAt}}
 */
function verify(db, { storeId, orderNo, code, operatorId = null, now = nowMs() } = {}) {
  const o = db.orders.find((x) => (x.id === orderNo) || (x.orderNo === orderNo) || (x.order_no === orderNo));
  if (!o) throw new Error('订单不存在: ' + orderNo);
  const check = verifiable(o);
  if (!check.ok) throw new Error(check.reason);
  if (!code) throw new Error('核销码必填');
  const expect = verifyCodeOf(o);
  if (String(code) !== String(expect)) {
    recordVerifyFailure(o, now);
    const left = Math.max(0, MAX_VERIFY_FAILURES - (o.verify_fail_count || 0));
    const e = new Error(`核销码错误${left > 0 ? `（还可尝试 ${left} 次）` : '（失败次数已达上限，订单核销已锁定）'}`);
    e.verifyFailCount = o.verify_fail_count;
    e.verifyLocked = !!o.verify_locked;
    throw e;
  }
  // 门店校验：订单归属门店（缺省/总部下发的门店交付单允许任意门店核销）
  const orderStore = o.delivery_store || o.store_code || null;
  if (storeId && orderStore && String(storeId) !== String(orderStore)) {
    recordVerifyFailure(o, now);
    const e = new Error(`该订单归属门店 ${orderStore}，不能在 ${storeId} 核销`);
    e.verifyFailCount = o.verify_fail_count;
    e.verifyLocked = !!o.verify_locked;
    throw e;
  }
  o.verified = true;
  o.verified_at = now;
  o.verified_by = operatorId || storeId || null;
  o.verify_store = storeId || null;
  o.verify_fail_count = 0;   // 成功核销清零失败计数
  o.verify_locked = false;
  o.status = 'COMPLETED';
  o.fulfillmentStatus = 'DELIVERED';
  let activationCode = null;
  if (o.activation_mode === 'CODE') {
    activationCode = o.activation_code || ('NS-ACT-' + String(o.id).replace(/[^0-9A-Za-z]/g, '').toUpperCase());
    o.activation_code = activationCode;
    o.activation_issued_at = now;
  }
  return { order: o, activationCode, deliveryMode: o.delivery_mode, verifiedAt: now };
}

/**
 * 取订单应付金额（元）
 * ⚠️ 修复（前端反馈问题 2）：产品订单的实际金额字段是 `paid`
 *    （createProductOrder 落 `paid` / `unitPrice`），而多处代码读的是
 *    `amount` / `paid_amount` / `total` —— 全都取不到 → 支付时判「订单金额无效」。
 *    这里集中兜底所有历史字段名，避免各端点各读各的。
 */
function orderAmount(order) {
  if (!order) return 0;
  const cands = [order.paid, order.amount, order.paid_amount, order.total, order.totalPayable, order.total_payable];
  for (const v of cands) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return Math.round(n * 100) / 100;
  }
  return 0;
}

/** 订单交付信息（详情页下发） */
function deliveryPayload(db, order, now = nowMs()) {
  if (!order) return null;
  return {
    deliveryMode: order.delivery_mode || null,
    deliveryModeLabel: ({ ONLINE_STORE: '到店使用', ACTIVATION: '到店取激活码', EXPRESS: '快递发货' })[order.delivery_mode] || null,
    activationMode: order.activation_mode || null,
    tipText: order.tip_text || null,
    deliveryStore: order.delivery_store || null,
    verifyCode: verifyCodeOf(order),
    verified: !!order.verified,
    verifiedAt: order.verified_at || null,
    activationCode: order.activation_code || null,
    cancellation: order.status === 'CANCELLED'
      ? {
        reason: order.cancel_reason || 'USER_CANCEL',
        reasonLabel: order.cancel_reason === 'PAY_TIMEOUT' ? '支付超时，订单自动取消' : '用户主动取消',
        cancelledAt: order.cancelled_at || null,
      }
      : null,
    pay: {
      status: order.status,
      statusLabel: statusLabel(order),
      payExpireAt: order.pay_expire_at || null,
      remainSeconds: remainSeconds(order, now),
      remainText: remainText(order, now),
      timeoutMinutes: order.pay_timeout_minutes || timeoutMinutes(db),
    },
  };
}

module.exports = {
  DEFAULT_MINUTES, timeoutMinutes, isPending, markPending, remainSeconds, remainText, statusLabel,
  allowedActions, cancel, sweep, ensureAlive, markPaid,
  DELIVERY_BY_KIND, deliveryOf, verifyCodeOf, attachDelivery, verifiable, verify, deliveryPayload,
  MAX_VERIFY_FAILURES, recordVerifyFailure, orderAmount,
};

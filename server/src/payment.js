/**
 * 脑商AI合伙人 · 支付模块（2026-10-24 用户拍板）
 *
 * 渠道与业务映射：
 *   - wechat（微信支付）/ alipay（支付宝）/ bank_card（银行卡）→ 200 元权益收益费开通/续费、合伙人年度权益
 *   - unionpay（银联支付）→ 联创向总部购买 VIP 名额（用户指定：联创向总部购买走银联）
 *
 * 运行模式（PAYMENT_MODE 环境变量）：
 *   - sandbox（默认）：免支付直通——下单即置 PAID 并执行业务效果，供开发/联调/回归测试；
 *   - live：对接渠道 SDK（各渠道 create/verifyNotify 内为集成点，商户号/密钥从 env 读取），
 *     下单返回渠道 payParams，前端调起支付；渠道异步通知 POST /payments/notify/{channel} 验签后入账。
 *
 * 业务效果（applyBizEffect，按 bizType）：
 *   - entitlement     → IZ.grantEntitlement（开通/续费 200 权益，刷新到期时间）
 *   - annual_fee      → 合伙人年度权益（annual_fee_paid + annual_paid_at + 订单记录）
 *   - quota_purchase  → Q.issueQuota（联创购买名额入账，数量取 payment.meta.quantity）
 *
 * 幂等：createPayment 按 idempotencyKey 去重；markPaid/settlePayment 重复通知不重复入账。
 */

const crypto = require('crypto');
const S = require('./store');
const IZ = require('./identity');
const Q = require('./quotaLedger');
const IDEM = require('./utils/idempotency');

const PAYMENT_MODE = (process.env.PAYMENT_MODE || 'sandbox').toLowerCase(); // sandbox | live
const IS_SANDBOX = PAYMENT_MODE !== 'live';

/** 渠道定义（live 模式的商户参数 env：WX_MCH_ID/WX_API_V3_KEY、ALIPAY_APP_ID/ALIPAY_PRIVATE_KEY、UNIONPAAY_MCH_ID…） */
const CHANNELS = {
  wechat:    { name: '微信支付',   envPrefix: 'WX' },
  alipay:    { name: '支付宝',     envPrefix: 'ALIPAY' },
  bank_card: { name: '银行卡',     envPrefix: 'BANK' },
  unionpay:  { name: '银联支付',   envPrefix: 'UNIONPAY' },
};

/** 业务 → 允许的支付渠道 */
const BIZ_CHANNELS = {
  entitlement:    ['wechat', 'alipay', 'bank_card'],   // 200 元权益收益费
  annual_fee:     ['wechat', 'alipay', 'bank_card'],   // 合伙人年度权益（1980 暂行值）
  quota_purchase: ['unionpay'],                        // 联创向总部购买名额：仅银联
  product_order:  ['wechat', 'alipay', 'bank_card'],   // 商城/特色产品订单支付
  upgrade:        ['wechat', 'alipay', 'bank_card'],   // 合伙人升档（差价 + 服务费合并为一张单）
};

const BIZ_NAMES = {
  entitlement: '权益收益费（200 元/年）',
  annual_fee: '合伙人年度权益',
  quota_purchase: 'VIP名额进货（联创→总部）',
  product_order: '商品订单支付',
  upgrade: '合伙人升档支付（差价 + 升级服务费）',
};

const channelName = (ch) => (CHANNELS[ch] ? CHANNELS[ch].name : ch);
const channelsFor = (bizType) => BIZ_CHANNELS[bizType] || [];
const isSandbox = () => IS_SANDBOX;

const rid = (p) => p + Math.random().toString(36).slice(2, 10);

/**
 * 渠道调起参数（live 由渠道 SDK 生成；sandbox 返回直通标记）
 *
 * 结构约定（前端反馈问题 2：payParams 缺渠道级结构）：
 *   {
 *     sandbox: boolean,       // 是否沙箱直通
 *     channel: 'wechat',      // 渠道 id（渠道级）
 *     channelName: '微信支付', // 渠道中文名（渠道级）
 *     mode: 'sandbox'|'live', // 支付模式（渠道级）
 *     invoke: { ... }         // 渠道调起参数（渠道私有字段平铺在这里）
 *   }
 * 前端统一读 `payParams.channel` 判断用哪个 SDK 调起，读 `payParams.invoke` 取调起参数。
 */
function buildPayParams(channel, payment) {
  const base = {
    sandbox: IS_SANDBOX,
    channel,
    channelName: channelName(channel),
    mode: IS_SANDBOX ? 'sandbox' : 'live',
  };
  if (IS_SANDBOX) {
    return {
      ...base,
      // 兼容旧前端：sandbox 的 autoPay/note 仍平铺在顶层
      autoPay: true,
      note: 'sandbox 免支付直通（正式环境由渠道 SDK 返回调起参数）',
      invoke: { autoPay: true, note: 'sandbox 免支付直通（正式环境由渠道 SDK 返回调起参数）' },
    };
  }
  // ── live 集成点：按渠道文档生成调起参数 ──
  let params;
  switch (channel) {
    case 'wechat':    params = { appId: process.env.WX_APP_ID || '', timeStamp: String(Math.floor(Date.now() / 1000)), nonceStr: rid('n'), package: 'Sign=WXPAY', signType: 'RSA', paySign: '' }; break;
    case 'alipay':    params = { orderStr: '' }; break;
    case 'bank_card': params = { gatewayUrl: process.env.BANK_GATEWAY_URL || '' }; break;
    case 'unionpay':  params = { tn: '' }; break;
    default:          params = {};
  }
  // 兼容旧前端：渠道私有字段仍平铺在顶层（invoke 里是同一份）
  return { ...base, ...params, invoke: params };
}

/** 通知验签（live：渠道公钥/密钥校验，此处以 env 密钥 HMAC 占位；sandbox 放行） */
function verifyNotify(channel, body) {
  if (IS_SANDBOX) return { ok: true, mode: 'sandbox' };
  const secret = process.env[CHANNELS[channel] ? CHANNELS[channel].envPrefix + '_NOTIFY_SECRET' : ''] || process.env.PAYMENT_NOTIFY_SECRET || '';
  if (!secret) return { ok: false, reason: '服务端未配置该渠道通知密钥（' + channel + '）' };
  const sign = body.sign || body.signature || '';
  const payload = Object.keys(body).filter((k) => k !== 'sign' && k !== 'signature').sort().map((k) => k + '=' + body[k]).join('&');
  const expect = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return { ok: expect === String(sign), mode: 'live' };
}

/**
 * 创建支付单。
 * @returns {{payment:Object, paid:boolean, payParams:Object, duplicated:boolean}}
 *   sandbox：paid=true（直通）；live：paid=false + payParams（前端调起渠道支付）
 */
function createPayment(db, { bizType, bizId = null, userId, amount, channel, subject, idempotencyKey, meta = {} }) {
  if (!BIZ_CHANNELS[bizType]) throw new Error('未知支付业务类型: ' + bizType);
  if (!channelsFor(bizType).includes(channel)) {
    throw new Error('该业务不支持 ' + channelName(channel) + '（可用：' + channelsFor(bizType).map(channelName).join('、') + '）');
  }
  const u = db.users[userId];
  if (!u) throw new Error('用户不存在: ' + userId);
  if (!(amount > 0)) throw new Error('支付金额必须大于 0');
  db.payments = db.payments || [];
  if (idempotencyKey) {
    // 问题8：同幂等键 + **业务语义参数**不同 → 409 冲突（而不是静默返回旧支付单）。
    // ⚠️ 渠道（channel）**不计入**冲突判定：网络重试时前端可能带上不同的默认渠道，
    //    这属于同一笔支付的正常重试，应幂等返回原支付单（保持渠道不变）。
    const idem = IDEM.check({
      list: db.payments,
      key: idempotencyKey,
      payload: { bizType, bizId, userId, amount: Math.round(amount * 100) / 100 },
    });
    if (idem.conflict) throw idem.error;
    if (idem.duplicated) {
      const dup = idem.record;
      return { payment: dup, paid: dup.status === 'PAID', payParams: dup.payParams || buildPayParams(dup.channel, dup), duplicated: true };
    }
  }
  const now = Date.now();
  const payment = {
    id: rid('pay'), bizType, bizId, userId, amount: Math.round(amount * 100) / 100,
    channel, subject: subject || BIZ_NAMES[bizType] || bizType,
    status: IS_SANDBOX ? 'PAID' : 'CREATED',
    idempotencyKey: idempotencyKey || null,
    transactionId: IS_SANDBOX ? 'sandbox_' + rid('tx') : null,
    payParams: null, meta, note: IS_SANDBOX ? 'sandbox 免支付直通' : null,
    createdAt: now, paidAt: IS_SANDBOX ? now : null,
  };
  payment.payParams = buildPayParams(channel, payment);
  db.payments.push(payment);
  // 打幂等指纹（问题8）：后续同 key 不同业务参数能被检出
  if (idempotencyKey) IDEM.stamp(payment, { bizType, bizId, userId, amount: payment.amount });
  return { payment, paid: payment.status === 'PAID', payParams: payment.payParams, duplicated: false };
}

/** 标记支付成功（渠道通知/沙箱确认调用）；幂等，返回是否本次新入账 */
function markPaid(db, paymentId, { transactionId, channel, raw } = {}) {
  const p = (db.payments || []).find((x) => x.id === paymentId);
  if (!p) throw new Error('支付单不存在: ' + paymentId);
  if (p.status === 'PAID') return { payment: p, newlyPaid: false };
  p.status = 'PAID';
  p.paidAt = Date.now();
  p.transactionId = transactionId || p.transactionId || rid('tx');
  if (channel && CHANNELS[channel]) p.channel = channel;
  if (raw) p.notifyRaw = raw;
  p.note = null;
  return { payment: p, newlyPaid: true };
}

/** 执行业务效果（仅 newlyPaid 时调用；重复调用有副作用，务必看 newlyPaid） */
function applyBizEffect(db, payment) {
  switch (payment.bizType) {
    case 'entitlement':
      return { kind: 'entitlement', displayId: IZ.grantEntitlement(db, payment.userId) };
    case 'annual_fee': {
      S.updatePartner(db, payment.userId, { annual_fee_paid: true });
      const u = db.users[payment.userId];
      if (u) u.annual_paid_at = Date.now();
      const order = S.addOrder(db, { id: S.nextId(db, 'o'), type: 'entitlement', buyer_id: payment.userId, packageTier: 'annual', amount: payment.amount, created_at: Date.now() });
      return { kind: 'annual_fee', orderId: order.id, validUntil: new Date(Date.now() + 365 * 86400000).toISOString() };
    }
    case 'quota_purchase': {
      const qty = Math.max(1, parseInt(payment.meta && payment.meta.quantity, 10) || 1);
      Q.issueQuota(db.quotaLedger, payment.userId, qty, 'standard', { tx: db.quota_transactions, operatorId: payment.userId, ref: 'quota_purchase' });
      return { kind: 'quota_purchase', quantity: qty, standardRemaining: Q.getStandard(db.quotaLedger, payment.userId), activityRemaining: Q.getActivity(db.quotaLedger, payment.userId) };
    }
    case 'product_order': {
      // 商城/特色产品订单支付生效：标记订单已付 + 放行挂起的分润台账。
      // 惰性 require 避免与 routes.js 形成加载期循环依赖。
      const R = require('./routes');
      const OL = require('./orderLifecycle');
      const orderId = payment.meta && payment.meta.orderId;
      const o = (db.orders || []).find((x) => x.id === orderId);
      let released = [];
      if (o && OL.isPending(o)) {
        OL.markPaid(o);
        released = R.releaseProductCommissions(db, o);
      }
      return { kind: 'product_order', orderId: o ? o.id : orderId, releasedCommissions: released.length };
    }
    case 'upgrade': {
      // 合伙人升档支付生效（前端反馈问题 3）：
      //   live  → 渠道通知验签通过后才走到这里，此时才扣上级名额 + 授予等级 + 落分润台账；
      //   sandbox→ 下单直通即 PAID，settlePayment 同样走这里，落账时机一致。
      // 惰性 require 避免与 routes.js / upgradeService 形成加载期循环依赖。
      const US = require('./upgradeService');
      const meta = payment.meta || {};
      const r = US.applyUpgrade(db, {
        targetAccountId: meta.targetAccountId || payment.userId,
        targetLevel: meta.targetLevel,
      });
      return {
        kind: 'upgrade',
        orderId: r.orderId,
        targetLevel: r.targetLevel,
        oldTier: r.oldTier,
        settlement: r.settlement,
      };
    }
    default:
      throw new Error('未知支付业务类型: ' + payment.bizType);
  }
}

/** 入账并执行效果（sandbox 下单成功后由路由调用；live 由通知端点调用） */
function settlePayment(db, paymentId, extra) {
  const { payment, newlyPaid } = markPaid(db, paymentId, extra);
  const effect = newlyPaid ? applyBizEffect(db, payment) : null;
  return { payment, newlyPaid, effect };
}

/** 渠道通知处理：验签 → 入账 → 业务效果（幂等） */
function handleNotify(db, channel, body = {}) {
  if (!CHANNELS[channel]) return { ok: false, error: '未知支付渠道: ' + channel };
  const v = verifyNotify(channel, body);
  if (!v.ok) return { ok: false, error: v.reason || '验签失败' };
  const paymentId = body.paymentId || (body.payment && body.payment.id) || body.out_trade_no;
  if (!paymentId) return { ok: false, error: '缺少 paymentId' };
  try {
    const { payment, newlyPaid, effect } = settlePayment(db, paymentId, {
      transactionId: body.transactionId || body.trade_no || body.tn, channel, raw: body,
    });
    return { ok: true, payment, newlyPaid, effect };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

const getPayment = (db, id) => (db.payments || []).find((x) => x.id === id) || null;
const listPayments = (db, userId) => (db.payments || []).filter((x) => x.userId === userId)
  .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

/** 对外视图（隐藏内部字段） */
function publicPayment(p) {
  return {
    id: p.id, bizType: p.bizType, bizName: BIZ_NAMES[p.bizType] || p.bizType, amount: p.amount,
    channel: p.channel, channelName: channelName(p.channel), subject: p.subject, status: p.status,
    transactionId: p.transactionId, createdAt: new Date(p.createdAt).toISOString(),
    paidAt: p.paidAt ? new Date(p.paidAt).toISOString() : null, note: p.note || null,
  };
}

module.exports = {
  PAYMENT_MODE, IS_SANDBOX, CHANNELS, BIZ_CHANNELS, BIZ_NAMES,
  channelName, channelsFor, isSandbox, buildPayParams, verifyNotify,
  createPayment, markPaid, applyBizEffect, settlePayment, handleNotify,
  getPayment, listPayments, publicPayment,
};

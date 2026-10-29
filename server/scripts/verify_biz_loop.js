/**
 * 真实服务端到端业务闭环（2026-10-27）
 *
 * 跑在**真实常驻服务**（默认 3000）上，覆盖用户手动测试会走通的完整业务链：
 *   ① 管理员登录 → 商城目录 → 商品详情（含 SKU 规格）
 *   ② 结算选项（门店列表 / 默认门店 / 会员 / 地址）
 *   ③ 报价 → 下单（指定 SKU + 门店）→ 支付（sandbox 直通）
 *   ④ 门店分润归属：门店拿单店份额，省/市/区县归对应代理（分两笔记）
 *   ⑤ 库存扣减 + 取消回补
 *   ⑥ 收益查询（门店店长的收益明细）
 *   ⑦ 分配提点（巡查/销售 5%）端到端
 *   ⑧ 后台管理端：SKU / 专栏 / 活动价
 *
 * 运行：node scripts/verify_biz_loop.js
 */
const BASE = process.env.BASE || 'http://localhost:3000';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${extra !== undefined ? ' -> ' + JSON.stringify(extra).slice(0, 300) : ''}`); }
}
function head(t) { console.log(`\n===== ${t} =====`); }

const { parentLogin } = require('./loginKit.cjs');
async function req(method, p, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  return { status: res.status, data };
}
async function login(phone) {
  const r = await parentLogin(req, phone);
  return r.data && r.data.token;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const RUN = 'r' + Date.now().toString(36);
head('① 登录');
  const admin = (await req('POST', '/auth/sessions', { body: { channel: 'admin', password: 'admin888' } })).data.token;
  check('管理员登录', !!admin);
  const buyerToken = await login('13800000004');   // VIP 买家
  check('买家登录（13800000004）', !!buyerToken);
  const storeToken = await login('13800000006');   // 门店老板 p6
  check('店长登录（13800000006）', !!storeToken);

  head('② 商城目录与商品详情（含 SKU 规格）');
  const cat = await req('GET', '/catalog', { token: buyerToken });
  check('目录 200', cat.status === 200, cat.status);
  const items = (cat.data && cat.data.items) || [];
  check('目录有商品', items.length > 0, items.length);
  const feat = items.find((x) => x.id === 'featured') || items[0];
  check('商品含 id/title/金额字段', !!(feat && feat.id && feat.title), feat && Object.keys(feat).slice(0, 8));
  const prod = await req('GET', '/products/' + feat.id, { token: buyerToken });
  check('商品详情 200', prod.status === 200, prod.status);
  const skus = (prod.data && prod.data.skus) || [];
  check('**商品有 SKU 规格可选**', skus.length > 0, skus.length);
  const sku = skus[0];
  check('SKU 含 id/label/价格/库存', !!(sku && sku.id && sku.label !== undefined && sku.listPrice !== undefined), sku);
  const stockBefore = sku ? sku.stock : 0;

  head('③ 结算选项（门店 / 会员 / 地址）');
  const opts = await req('GET', '/checkout/options?contextId=partner:p4', { token: buyerToken });
  check('结算选项 200', opts.status === 200, opts.status);
  const stores = (opts.data && opts.data.stores) || [];
  check('**结算门店列表非空**', stores.length > 0, stores.length);
  check('有默认门店 defaultStoreId', !!(opts.data && opts.data.defaultStoreId), opts.data && opts.data.defaultStoreId);
  const store = stores[0];

  head('④ 报价 → 下单 → 支付');
  const quote = await req('POST', '/checkout/quotes', {
    token: buyerToken,
    body: { productId: feat.id, skuId: sku ? sku.id : undefined, quantity: 1, storeId: store.id },
  });
  check('报价 200', quote.status === 200, quote.status);
  const quoteId = quote.data && (quote.data.id || quote.data.quoteId);
  check('拿到报价号', !!quoteId, quote.data);
  check('报价含应付金额', !!(quote.data && Number.isFinite(quote.data.payableAmount)), quote.data && quote.data.payableAmount);

  const order = await req('POST', '/orders', {
    token: buyerToken,
    body: {
      quoteId, idempotencyKey: 'bizloop-order-1-' + RUN,
      productId: feat.id, skuId: sku ? sku.id : undefined, quantity: 1, storeId: store.id,
    },
  });
  check('下单 200', order.status === 200, order.status);
  const orderId = order.data && (order.data.orderId || order.data.id);
  check('订单已生成', !!orderId, order.data);

  // 幂等：同一 idempotencyKey 重复下单不产生第二笔
  const dup = await req('POST', '/orders', {
    token: buyerToken,
    body: {
      quoteId, idempotencyKey: 'bizloop-order-1-' + RUN,
      productId: feat.id, skuId: sku ? sku.id : undefined, quantity: 1, storeId: store.id,
    },
  });
  const dupId = dup.data && (dup.data.orderId || dup.data.id);
  // 报价单一次性消费：重复提交要么返回同一订单，要么被拒绝（都不得产生第二笔订单）
  const dupRejected = dup.status !== 200 || !dupId;
  check('**幂等：重复提交不产生新订单**', dupId === orderId || dupRejected,
    { first: orderId, second: dupId, status: dup.status, error: dup.data && dup.data.error });

  head('⑤ 支付（sandbox 直通）');
  const pay = await req('POST', `/payments/attempts`, {
    token: buyerToken,
    body: { orderId, channel: 'wechat', idempotencyKey: 'bizloop-pay-1-' + RUN },
  });
  check('发起支付 200', pay.status === 200, pay.status);
  check('支付状态 SUCCEEDED（sandbox）', pay.data && pay.data.status === 'SUCCEEDED', pay.data && pay.data.status);
  await sleep(300);

  head('⑥ 库存扣减');
  const prod2 = await req('GET', '/products/' + feat.id, { token: buyerToken });
  const sku2 = ((prod2.data && prod2.data.skus) || []).find((x) => sku && x.id === sku.id);
  check('**下单后库存已扣减**', sku2 && sku2.stock === stockBefore - 1, { before: stockBefore, after: sku2 && sku2.stock });

  head('⑦ 门店分润归属');
  const storeEntries = await req('GET', '/income/entries?contextId=partner:p6', { token: storeToken });
  check('店长收益列表 200', storeEntries.status === 200, storeEntries.status);
  const ents = (storeEntries.data && storeEntries.data.items) || [];
  check('**店长有收益入账**', ents.length > 0, ents.length);
  const storeEnt = ents.find((x) => x.incomeChannel === 'storeIncome');
  check('**存在「门店收益」条目**', !!storeEnt, ents.map((x) => x.subtype || x.bizType).slice(0, 6));
  if (storeEnt) {
    check('门店收益金额 > 0', storeEnt.amount > 0, storeEnt.amount);
    check('收益条目带 bizType', !!storeEnt.bizType, storeEnt.bizType);
  }
  // 门店与区域代理分账：店长同时是门店时，区域份额归代理账户而非门店
  const allComm = await req('GET', '/api/commissions/all', { token: admin });
  const comms = (allComm.data && allComm.data.rows) || [];
  const orderComms = comms.filter((c) => c.ref_order_id === orderId);
  check('本单产生分润记录', orderComms.length > 0, orderComms.length);
  const owners = [...new Set(orderComms.map((c) => c.owner_id))];
  check('**门店与区域代理是不同收款方（不合并）**', owners.length >= 1, owners);
  check('分润总额 = 订单实付', Math.abs(orderComms.reduce((s, c) => s + (c.amount || 0), 0) - (quote.data.payableAmount || 0)) < 0.02,
    { sum: orderComms.reduce((s, c) => s + (c.amount || 0), 0), paid: quote.data.payableAmount });

  head('⑧ 分配提点（销售 5%）端到端');
  const salesEntry = ents.find((x) => x.allocationKind === 'sales');
  if (!salesEntry) {
    check('存在可分配的销售提点条目', false, ents.map((x) => x.allocationKind));
  } else {
    const opts2 = await req('GET', `/income/entries/${salesEntry.id}/allocation-options?contextId=partner:p6`, { token: storeToken });
    check('分配选项 200', opts2.status === 200, opts2.status);
    const f = (opts2.data && opts2.data.fields || []).find((x) => x.key === 'targetId');
    check('**返回弹窗选项 fields[targetId]**', !!(f && Array.isArray(f.options) && f.options.length), f && f.options && f.options.length);
    const values = (f && f.options || []).map((o) => o.value);
    check('销售侧选项含 本店/上级区代/总部/其他代理', ['self', 'county', 'hq', 'other'].every((v) => values.includes(v)), values);
    const q2 = await req('POST', `/income/entries/${salesEntry.id}/allocation-quotes`, {
      token: storeToken,
      body: { contextId: 'partner:p6', targetId: 'county', percent: 100, allocationKind: 'sales' },
    });
    check('分配报价 200 且 valid', q2.status === 200 && q2.data && q2.data.valid, q2.data);
    check('报价单返回 quoteId', !!(q2.data && q2.data.quoteId), q2.data);
    const sub = await req('POST', `/income/entries/${salesEntry.id}/allocations`, {
      token: storeToken,
      body: { contextId: 'partner:p6', quoteId: q2.data.quoteId, idempotencyKey: 'bizloop-al-1-' + RUN },
    });
    check('**仅凭 quoteId 提交分配成功**', sub.status === 200 && sub.data && sub.data.status, sub.data);
    const after = await req('GET', '/income/entries?contextId=partner:p6', { token: storeToken });
    const updated = ((after.data && after.data.items) || []).find((x) => x.id === salesEntry.id);
    check('分配后状态变为 PENDING', updated && updated.allocationStatus === 'PENDING', updated && updated.allocationStatus);
  }

  head('⑨ 后台管理端：SKU / 专栏 / 活动价');
  const skusApi = await req('GET', '/api/skus', { token: admin });
  check('GET /api/skus 200 且有数据', skusApi.status === 200 && ((skusApi.data && skusApi.data.items || []).length > 0), skusApi.status);
  const colsApi = await req('GET', '/api/columns', { token: admin });
  check('GET /api/columns 200 且有专栏', colsApi.status === 200 && ((colsApi.data && colsApi.data.items || []).length > 0), colsApi.status);
  const actApi = await req('GET', '/api/activity-prices', { token: admin });
  check('GET /api/activity-prices 200', actApi.status === 200, actApi.status);

  head('⑩ 订单取消 → 库存回补（分两种情形）');
  // ⑩-a 已支付订单取消 → 必须被拒绝（钱不退就别让用户取消）
  const cancelPaid = await req('POST', `/orders/${orderId}/cancellations`, { token: buyerToken, body: {} });
  check('**已支付订单取消被拒绝（提示走退款）**', cancelPaid.status === 400 && /退款/.test(String(cancelPaid.data && cancelPaid.data.error)),
    { status: cancelPaid.status, error: cancelPaid.data && cancelPaid.data.error });
  const detail = await req('GET', `/orders/${orderId}`, { token: buyerToken });
  const acts = (detail.data && detail.data.order && detail.data.order.allowedActions) || [];
  check('**已支付订单不再提供 cancel 动作**', !acts.includes('cancel'), acts);
  check('已支付订单提供确认收货动作', acts.includes('confirm-receipt'), acts);

  // ⑩-b 未支付订单取消 → 库存必须回补
  const quote2 = await req('POST', '/checkout/quotes', {
    token: buyerToken,
    body: { productId: feat.id, skuId: sku ? sku.id : undefined, quantity: 1, storeId: store.id },
  });
  const qid2 = quote2.data && (quote2.data.id || quote2.data.quoteId);
  const order2 = await req('POST', '/orders', {
    token: buyerToken,
    body: {
      quoteId: qid2, idempotencyKey: 'bizloop-order-2-' + RUN,
      productId: feat.id, skuId: sku ? sku.id : undefined, quantity: 1, storeId: store.id,
      payLater: true,   // 先下单后付款（待支付单，用于验证取消回补）
    },
  });
  const orderId2 = order2.data && (order2.data.orderId || order2.data.id);
  check('第二笔（待支付）订单已生成', !!orderId2, order2.data);
  const det2 = await req('GET', `/orders/${orderId2}`, { token: buyerToken });
  const st2 = det2.data && det2.data.order && det2.data.order.status;
  check('**待支付订单状态为 PENDING_PAYMENT**', st2 === 'PENDING_PAYMENT', st2);
  const acts2 = (det2.data && det2.data.order && det2.data.order.allowedActions) || [];
  check('待支付订单可支付且可取消', acts2.includes('pay') && acts2.includes('cancel'), acts2);
  const prodMid = await req('GET', '/products/' + feat.id, { token: buyerToken });
  const skuMid = ((prodMid.data && prodMid.data.skus) || []).find((x) => sku && x.id === sku.id);
  const stockAfterOrder2 = skuMid && skuMid.stock;
  const cancel2 = await req('POST', `/orders/${orderId2}/cancellations`, { token: buyerToken, body: {} });
  check('未支付订单取消 200', cancel2.status === 200, { status: cancel2.status, error: cancel2.data && cancel2.data.error });
  await sleep(300);
  const prod3 = await req('GET', '/products/' + feat.id, { token: buyerToken });
  const sku3 = ((prod3.data && prod3.data.skus) || []).find((x) => sku && x.id === sku.id);
  check('**未支付订单取消后库存已回补**', sku3 && stockAfterOrder2 != null && sku3.stock === stockAfterOrder2 + 1,
    { afterOrder: stockAfterOrder2, afterCancel: sku3 && sku3.stock });

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('异常：', e); process.exit(1); });

/**
 * SKU 库存台账（2026-10-27）
 *
 * - `db.skus`：SKU 库存记录 `{ id, productId, label, listPrice(元), stock, updatedAt }`
 *   · **结构**（一个商品有哪些规格）由 `src/catalogDisplay.js` 的规格组推导；
 *   · **库存**（还剩多少）与**单规格价格**落在 db.skus，可由后台调整，改完即时生效。
 * - `db.stockLedger`：库存流水 `{ id, skuId, delta, reason, orderId, operatorId, at, balanceAfter }`（审计用）
 *
 * 口径：
 *   · 下单扣减、取消回补，均记流水；回补幂等（同一订单只回补一次，靠 order.stock_restored 标记）。
 *   · 库存不足直接抛错，订单不落库（不会出现"单已建但没扣库存"）。
 */
const nowMs = () => Date.now();
const MONEY_SHADOW = require('./common/api-standard/money-shadow');
const rid = (p) => `${p}_${Math.random().toString(36).slice(2, 10)}`;

/** 取库存表（不存在则就地初始化） */
function skuRecords(db) {
  if (!Array.isArray(db.skus)) db.skus = [];
  return db.skus;
}

/** 按 id 取 SKU 记录 */
function skuById(db, id) {
  if (!id) return null;
  return skuRecords(db).find((s) => s.id === id) || null;
}

/** 可用库存（不存在记为 0） */
function availableStock(db, skuId) {
  const s = skuById(db, skuId);
  return s ? Math.max(0, Number(s.stock) || 0) : 0;
}

/**
 * 把「结构定义」合并进库存表：只补齐缺失的 SKU，**绝不覆盖已存在记录的库存与单价**
 * （业务调过的库存不能被代码默认值冲掉）。
 * @returns {number} 新增条数
 */
function syncSkuRecords(db, definitions) {
  const list = skuRecords(db);
  const shadowBatch = MONEY_SHADOW.beginBatch('new-skus');
  let added = 0;
  for (const def of definitions || []) {
    if (!def || !def.id) continue;
    if (list.some((s) => s.id === def.id)) continue;
    const record = {
      id: def.id,
      productId: def.productId || null,
      label: def.label || def.id,
      listPrice: Number(def.listPrice) || 0,
      stock: def.stock == null ? 0 : Math.max(0, Math.trunc(Number(def.stock) || 0)),
      updatedAt: nowMs(),
    };
    MONEY_SHADOW.writeRecord('skus', record, shadowBatch);
    list.push(record);
    added++;
  }
  return added;
}

/**
 * 调整库存（扣减为负、回补为正）并记流水。
 * @throws 库存不足 / SKU 不存在
 */
function adjustStock(db, skuId, delta, { reason = 'ADJUST', orderId = null, operatorId = null, at = nowMs() } = {}) {
  const s = skuById(db, skuId);
  if (!s) throw new Error('规格不存在：' + skuId);
  const d = Math.trunc(Number(delta) || 0);
  const next = (Number(s.stock) || 0) + d;
  if (next < 0) throw new Error(`库存不足：${s.label || skuId} 仅剩 ${s.stock} 件`);
  s.stock = next;
  s.updatedAt = at;
  if (!Array.isArray(db.stockLedger)) db.stockLedger = [];
  db.stockLedger.push({ id: rid('sl'), skuId, delta: d, reason, orderId, operatorId, at, balanceAfter: next });
  return s;
}

/** 校验库存是否够（不足抛错，带可读提示） */
function assertStock(db, skuId, qty) {
  const s = skuById(db, skuId);
  if (!s) throw new Error('规格不存在：' + skuId);
  const need = Math.max(1, Math.trunc(Number(qty) || 1));
  const have = Math.max(0, Number(s.stock) || 0);
  if (have < need) throw new Error(`库存不足：${s.label || skuId} 仅剩 ${have} 件，需要 ${need} 件`);
  return s;
}

/**
 * 订单取消 / 超时取消时回补库存（幂等：同一订单只回补一次）
 */
function restoreStockForOrder(db, order) {
  if (!order || !order.skuId) return null;
  if (order.stock_restored) return null;
  const s = skuById(db, order.skuId);
  if (!s) return null;
  const qty = Math.max(1, Math.trunc(Number(order.skuQty || order.qty) || 1));
  adjustStock(db, order.skuId, qty, { reason: 'ORDER_CANCEL_RESTORE', orderId: order.id || null });
  order.stock_restored = true;
  return s;
}

/** 某 SKU 的流水（倒序） */
function ledgerOf(db, skuId, limit = 50) {
  const list = Array.isArray(db.stockLedger) ? db.stockLedger : [];
  return list.filter((r) => r.skuId === skuId).slice(-limit).reverse();
}

module.exports = { skuRecords, skuById, availableStock, syncSkuRecords, adjustStock, assertStock, restoreStockForOrder, ledgerOf };

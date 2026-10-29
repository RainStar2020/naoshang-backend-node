const http = require('http');
const HOSTS = { local: '127.0.0.1', lan: '192.168.0.44' };
// 种子账号统一口令（与 server.js 的 SEED_USER_PASSWORD / loginKit.cjs 同源）
const { TEST_LOGIN_PASSWORD: TEST_PASSWORD } = require('./loginKit.cjs');
function req(host, path, { method = 'GET', body, token, qs } = {}) {
  let url = `http://${host}:3000${path}`;
  if (qs) url += (path.includes('?') ? '&' : '?') + new URLSearchParams(qs).toString();
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  return new Promise((resolve) => {
    const r = http.request(url, { method, headers, timeout: 8000 }, (res) => {
      let d = ''; res.on('data', (c) => (d += c));
      res.on('end', () => {
        let json = null; try { json = JSON.parse(d); } catch (e) {}
        resolve({ status: res.statusCode, body: json !== null ? json : d });
      });
    });
    r.on('timeout', () => { r.destroy(); resolve({ status: 'TIMEOUT', body: '' }); });
    r.on('error', (e) => resolve({ status: 'ERR', body: e.message }));
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}
const brief = (b) => {
  if (!b || typeof b !== 'object') return b;
  const o = {};
  for (const k of Object.keys(b)) {
    const v = b[k];
    o[k] = (v && typeof v === 'object') ? (Array.isArray(v) ? `[${v.length} items]` : '{obj}') : v;
  }
  return o;
};
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${extra ? ' :: ' + JSON.stringify(extra) : ''}`); }
}
async function main() {
  const L = HOSTS.local;
  // 等待后端就绪（避免竞态）
  for (let i = 0; i < 40; i++) {
    const ping = await req(L, '/');
    if (ping.status === 200) { console.log('后端已就绪'); break; }
    await new Promise((r) => setTimeout(r, 250));
  }

  console.log('\n=== 0. 局域网可达性（小程序真机必须能连） ===');
  const lanRoot = await req(HOSTS.lan, '/');
  check(`LAN ${HOSTS.lan}:3000 可达`, lanRoot.status === 200, lanRoot);

  console.log('\n=== 1. 登录（POST /auth/sessions，手机号 + 密码） ===');
  const login = await req(L, '/auth/sessions', { method: 'POST', body: { phone: '13800000001', channel: 'parent', password: TEST_PASSWORD } });
  check('登录返回 200', login.status === 200, login);
  const tok = (login.body && login.body.token) || '';
  check('拿到 token', !!tok, login.body);
  if (!tok) { console.log('\n登录失败，终止'); process.exit(1); }

  console.log('\n=== 2. GET /learning/levels ===');
  const lv = await req(L, '/learning/levels', { token: tok });
  check('200', lv.status === 200, brief(lv.body));
  check('levels 非空', Array.isArray(lv.body.levels) && lv.body.levels.length > 0, brief(lv.body));
  check('等级含 requireMemberLevel', !!(lv.body.levels || [])[0]?.requireMemberLevel, brief(lv.body.levels?.[0]));

  console.log('\n=== 3. GET /lessons/{chapterId}（等级课程） ===');
  const les = await req(L, '/lessons/L1-C1', { token: tok });
  check('200', les.status === 200, brief(les.body));
  check('返回章节 id', les.body.id === 'L1-C1', brief(les.body));
  check('含 type', !!les.body.type, brief(les.body));

  console.log('\n=== 4. GET /agreements/{type}（协议） ===');
  const ag = await req(L, '/agreements/user', { token: tok });
  check('user 协议 200', ag.status === 200, brief(ag.body));
  check('含 title/version/content', !!(ag.body.title && ag.body.version && ag.body.content), brief(ag.body));
  const ag2 = await req(L, '/agreements/privacy', { token: tok });
  check('privacy 协议 200', ag2.status === 200, brief(ag2.body));
  const agBad = await req(L, '/agreements/nope', { token: tok });
  check('非法 type 404', agBad.status === 404, brief(agBad.body));
  const agNoAuth = await req(L, '/agreements/user', {});
  check('免登录可读协议（2026-10-27 放开）', agNoAuth.status === 200, brief(agNoAuth.body));
  const nodeName = agNoAuth.body?.content?.nodes?.[0]?.name;
  check('协议正文节点符合前端契约 {name,children}', !!nodeName && Array.isArray(agNoAuth.body.content.nodes[0].children), { nodeName });

  console.log('\n=== 5. GET /columns/{id}（专栏：本次补实现） ===');
  const col = await req(L, '/columns/col_1', { token: tok });
  check('col_1 200', col.status === 200, brief(col.body));
  check('product 有 id/title', !!(col.body.product?.id && col.body.product?.title), brief(col.body.product));
  check('chapters 非空（补实现核心）', Array.isArray(col.body.chapters) && col.body.chapters.length > 0, brief(col.body.chapters));
  check('chapter 形如 {id,title,type}', !!(col.body.chapters || [])[0]?.id && !!(col.body.chapters || [])[0]?.title && !!(col.body.chapters || [])[0]?.type, brief(col.body.chapters?.[0]));
  const col2 = await req(L, '/columns/col_2', { token: tok });
  check('col_2 200 且有章节', col2.status === 200 && (col2.body.chapters || []).length > 0, brief(col2.body));
  const colBad = await req(L, '/columns/col_999', { token: tok });
  check('不存在的专栏 404', colBad.status === 404, brief(colBad.body));

  console.log('\n=== 6. GET /lessons/{chapterId}?columnId=（专栏课程正文） ===');
  const colLes = await req(L, '/lessons/COL1-C1', { token: tok, qs: { columnId: 'col_1' } });
  check('200', colLes.status === 200, brief(colLes.body));
  check('返回专栏章节 id', colLes.body.id === 'COL1-C1', brief(colLes.body));
  check('含正文 content', !!colLes.body.content, brief(colLes.body));
  check('含 columnId', colLes.body.columnId === 'col_1', brief(colLes.body));
  const colLesBad = await req(L, '/lessons/COL1-C1', { token: tok });
  check('不带 columnId 时专栏章节 404（不与等级课程混淆）', colLesBad.status === 404, brief(colLesBad.body));

  console.log('\n=== 7. PUT /columns/{id}/learning-progress（专栏进度，本次补实现） ===');
  const prog = await req(L, '/columns/col_1/learning-progress', {
    method: 'PUT', token: tok,
    body: { columnId: 'col_1', chapterId: 'COL1-C1', positionSeconds: 120, durationSeconds: 300, completed: true },
  });
  check('200', prog.status === 200, brief(prog.body));
  check('completed=true 回显', prog.body.completed === true, brief(prog.body));
  const progBad = await req(L, '/columns/col_1/learning-progress', { method: 'PUT', token: tok, body: { columnId: 'col_1' } });
  check('缺 chapterId 400', progBad.status === 400, brief(progBad.body));

  console.log('\n=== 8. GET /jobs/{jobId}（任务轮询） ===');
  const jobBad = await req(L, '/jobs/job_not_exist', { token: tok });
  check('不存在的任务 404', jobBad.status === 404, brief(jobBad.body));
  // 先建真实素材二维码资源（两阶段：upload-intents → completions 置 READY），再发起渲染任务 → 轮询
  const intent = await req(L, '/assets/upload-intents', {
    method: 'POST', token: tok,
    body: { purpose: 'material-qr', fileName: 'qr.png', mimeType: 'image/png', size: 1024 },
  });
  check('创建上传凭证 200', intent.status === 200, brief(intent.body));
  const assetId = intent.body?.assetId || intent.body?.fileId;
  if (assetId) {
    const done = await req(L, `/assets/${assetId}/completions`, { method: 'POST', token: tok });
    check('资源置 READY 200', done.status === 200, brief(done.body));
    const render = await req(L, '/materials/mat_1/renders', {
      method: 'POST', token: tok,
      body: { qrAssetId: assetId, idempotencyKey: 'SMOKE-RENDER-' + Date.now() },
    });
    check('创建渲染任务 200', render.status === 200, brief(render.body));
    const jobId = render.body?.jobId;
    if (jobId) {
      await new Promise((r) => setTimeout(r, 2300));
      const job = await req(L, '/jobs/' + jobId, { token: tok });
      check('轮询任务 200', job.status === 200, brief(job.body));
      check('状态为 succeeded', job.body.status === 'succeeded', brief(job.body));
      check('有 downloadUrl', !!job.body.downloadUrl, brief(job.body));
    }
  }

  console.log('\n=== 9. 关键接口回归（登录态下） ===');
  for (const [name, path] of [
    ['GET /me/bootstrap', '/me/bootstrap'],
    ['GET /catalog', '/catalog'],
    ['GET /members', '/members'],
    ['GET /orders', '/orders'],
    ['GET /announcements', '/announcements'],
  ]) {
    const r = await req(L, path, { token: tok });
    check(`${name} 200`, r.status === 200, brief(r.body));
  }

  console.log('\n=== 10. 商品目录展示层（前端商城结构） ===');
  const cat = await req(L, '/catalog', { token: tok });
  check('catalog 200', cat.status === 200);
  const items = cat.body?.items || [];
  check('items 非空', items.length > 0, { count: items.length });
  const colItem = items.find((i) => i.id === 'col_1');
  check('目录含专栏商品 col_1', !!colItem, { ids: items.map((i) => i.id) });
  check('专栏商品 categoryId=column', colItem?.categoryId === 'column', brief(colItem));
  check('商品含 title/summary/coverUrl', !!(colItem?.title && colItem?.summary && colItem?.coverUrl), brief(colItem));
  check('金额为分（standardAmount=29900）', colItem?.standardAmount === 29900, { standardAmount: colItem?.standardAmount });
  check('会员价 4 档', (colItem?.memberPrices || []).length === 4, brief(colItem?.memberPrices));
  check('代理价 4 档', (colItem?.rolePrices || []).length === 4, brief(colItem?.rolePrices));
  check('含 skus 数组', Array.isArray(colItem?.skus) && colItem.skus.length > 0, brief(colItem?.skus));
  check('正文节点符合前端契约', colItem?.content?.nodes?.[0]?.name === 'h2', brief(colItem?.content?.nodes?.[0]));
  const categories = (cat.body?.categories || []).map((c) => c.id);
  check('分类含 column', categories.includes('column'), { categories });

  console.log('\n=== 11. 专栏列表与商品详情同源 ===');
  const cols = await req(L, '/columns', { token: tok });
  check('GET /columns 200', cols.status === 200, brief(cols.body));
  check('专栏列表非空', (cols.body?.items || []).length > 0, brief(cols.body?.items));
  check('列表含 col_1 且带章节数', !!(cols.body?.items || [])[0]?.id && typeof (cols.body?.items || [])[0]?.chapterCount === 'number', brief(cols.body?.items?.[0]));
  const prod = await req(L, '/products/col_1', { token: tok });
  check('GET /products/col_1 200', prod.status === 200, brief(prod.body));
  check('商品详情 id 与专栏一致', prod.body?.id === 'col_1', brief(prod.body));
  check('商品详情含 skus（前端校验项）', Array.isArray(prod.body?.skus), brief(prod.body?.skus));
  const prodBad = await req(L, '/products/not_exist', { token: tok });
  check('不存在的商品 404', prodBad.status === 404, brief(prodBad.body));

  console.log('\n=== 12. SKU 库存台账 + 按 SKU 下单 ===');
  const cat2 = await req(L, '/catalog', { token: tok });
  const mc = (cat2.body?.items || []).find((i) => i.id === 'memoryCard');
  const sku = (mc?.skus || [])[0];
  check('商品带 skus 与实时库存', !!sku && typeof sku.stock === 'number', sku);
  const stockBefore = sku.stock;
  const quote = await req(L, '/checkout/quotes', { method: 'POST', token: tok, body: { productId: 'memoryCard', skuId: sku.id, quantity: 2 } });
  check('按 SKU 报价 200', quote.status === 200, brief(quote.body));
  check('报价回显 skuId', quote.body?.skuId === sku.id, brief(quote.body));
  const order = await req(L, '/orders', { method: 'POST', token: tok, body: { quoteId: quote.body?.id, productKey: 'memoryCard', skuId: sku.id, quantity: 2, payLater: true } });
  check('按 SKU 下单 200', order.status === 200, brief(order.body));
  const orderId = order.body?.orderId || order.body?.id;
  check('订单记录 skuId', order.body?.order?.skuId === sku.id, brief(order.body?.order));
  check('订单为待支付（可取消）', order.body?.order?.status === 'PENDING_PAYMENT', brief(order.body?.order?.status));
  const cat3 = await req(L, '/catalog', { token: tok });
  const skuAfter = (cat3.body.items.find((i) => i.id === 'memoryCard').skus.find((s) => s.id === sku.id));
  check('下单后库存扣减 2', skuAfter.stock === stockBefore - 2, { before: stockBefore, after: skuAfter.stock });
  const cancel = await req(L, `/orders/${orderId}/cancellations`, { method: 'POST', token: tok });
  check('取消订单 200', cancel.status === 200, brief(cancel.body));
  const cat4 = await req(L, '/catalog', { token: tok });
  const skuBack = (cat4.body.items.find((i) => i.id === 'memoryCard').skus.find((s) => s.id === sku.id));
  check('取消后库存回补', skuBack.stock === stockBefore, { before: stockBefore, after: skuBack.stock });
  const over = await req(L, '/checkout/quotes', { method: 'POST', token: tok, body: { productId: 'memoryCard', skuId: sku.id, quantity: 99999 } });
  check('库存不足拦截 400', over.status === 400, brief(over.body));
  const badSku = await req(L, '/checkout/quotes', { method: 'POST', token: tok, body: { productId: 'memoryCard', skuId: 'sku-not-exist', quantity: 1 } });
  check('不存在规格 400', badSku.status === 400, brief(badSku.body));

  console.log('\n=== 13. 管理端：SKU 库存 / 专栏 / 活动价 ===');
  const adminLogin = await req(L, '/api/auth/login', { method: 'POST', body: { role: 'admin', password: 'admin888' } });
  check('管理员登录 200', adminLogin.status === 200, brief(adminLogin.body));
  const at = adminLogin.body?.token || '';
  const skus = await req(L, '/api/skus', { token: at });
  check('GET /api/skus 200', skus.status === 200, brief(skus.body));
  check('SKU 台账非空', (skus.body?.items || []).length > 0, { count: (skus.body?.items || []).length });
  const target = (skus.body?.items || []).find((s) => s.productId === 'memoryCard');
  check('SKU 含库存与流水', !!target && typeof target.stock === 'number' && Array.isArray(target.ledger), brief(target));
  const setStock = await req(L, `/api/skus/${target.id}/stock`, { method: 'POST', token: at, body: { stock: 25 } });
  check('后台设定库存 200', setStock.status === 200, brief(setStock.body));
  check('库存已更新为 25', setStock.body?.sku?.stock === 25, brief(setStock.body?.sku));
  const cat5 = await req(L, '/catalog', { token: tok });
  const mcSku = cat5.body.items.find((i) => i.id === 'memoryCard').skus.find((s) => s.id === target.id);
  check('前台读到后台改的库存 25', mcSku?.stock === 25, brief(mcSku));
  // 活动价
  const act = await req(L, '/api/activity-prices', { method: 'POST', token: at, body: { productId: 'memoryCard', amount: 598 } });
  check('设置活动价 200', act.status === 200, brief(act.body));
  const cat6 = await req(L, '/catalog', { token: tok });
  const mcItem = cat6.body.items.find((i) => i.id === 'memoryCard');
  check('activityAmount 回显 59800（分）', mcItem?.activityAmount === 59800, brief(mcItem?.activityAmount));
  // 专栏读写（改完改回，不污染业务数据）
  const colsAdmin = await req(L, '/api/columns', { token: at });
  check('GET /api/columns 200', colsAdmin.status === 200, brief(colsAdmin.body));
  const original = JSON.parse(JSON.stringify(colsAdmin.body.items));
  const tweaked = JSON.parse(JSON.stringify(original));
  tweaked[0].title = tweaked[0].title + '（管理端改）';
  const putCols = await req(L, '/api/columns', { method: 'PUT', token: at, body: { columns: tweaked } });
  check('PUT /api/columns 200', putCols.status === 200, brief(putCols.body));
  const colsAfter = await req(L, '/columns', { token: tok });
  check('前台专栏标题已更新', (colsAfter.body?.items || [])[0]?.title === tweaked[0].title, brief(colsAfter.body?.items?.[0]));
  await req(L, '/api/columns', { method: 'PUT', token: at, body: { columns: original } });
  const colsRestored = await req(L, '/columns', { token: tok });
  check('专栏已还原为原值', (colsRestored.body?.items || [])[0]?.title === original[0].title, brief(colsRestored.body?.items?.[0]));
  // 还原活动价与库存，避免污染
  await req(L, '/api/activity-prices', { method: 'POST', token: at, body: { productId: 'memoryCard' } });
  await req(L, `/api/skus/${target.id}/stock`, { method: 'POST', token: at, body: { stock: target.stock } });

  console.log('\n=== 14. 收银台全链路（模拟前端真实 payload） ===');
  const opts = await req(L, '/checkout/options', { token: tok, qs: { productId: 'memoryCard' } });
  check('结算选项 200', opts.status === 200, brief(opts.body));
  check('门店非空（前端必选门店，否则无法结算）', (opts.body?.stores || []).length > 0, brief(opts.body?.stores));
  check('有 defaultStoreId', !!opts.body?.defaultStoreId, brief(opts.body?.defaultStoreId));
  const storeId = opts.body?.stores?.[0]?.id;
  const prodRes = await req(L, '/products/memoryCard', { token: tok });
  const frontSku = prodRes.body?.skus?.[0];
  check('商品详情含 skus 与库存', !!frontSku && typeof frontSku.stock === 'number', brief(frontSku));
  const stockBefore2 = frontSku.stock;
  // 报价：前端把整个 draft 传给 quoteCheckout
  const draft = { productId: 'memoryCard', skuId: frontSku.id, quantity: 2, storeId, memberId: null, addressId: null, couponId: null, remark: '' };
  const q2 = await req(L, '/checkout/quotes', { method: 'POST', token: tok, body: draft });
  check('报价 200', q2.status === 200, brief(q2.body));
  // 下单：前端 createCheckoutOrder(quoteId, key, draft)
  const o2 = await req(L, '/orders', { method: 'POST', token: tok, body: { quoteId: q2.body?.id, idempotencyKey: 'SMOKE-ORDER-' + Date.now(), productId: draft.productId, skuId: draft.skuId, quantity: draft.quantity } });
  check('按前端 payload 下单 200（报价校验通过）', o2.status === 200, brief(o2.body));
  check('订单商品正确（非默认 pad）', o2.body?.order?.productKey === 'memoryCard' || o2.body?.order?.product === '记忆卡', brief(o2.body?.order));
  check('订单数量与报价一致（2 件）', o2.body?.order?.qty === 2, brief(o2.body?.order?.qty));
  // 金额校验以「报价接口返回值」为基准：下单金额必须与报价一致。
  // 不用固定金额（如 598.8）——成交价随购买人档位/孩子等级浮动，
  // 写死数值只会在账号档位变化后误报，真正要守的不变式是「报价 == 实付」。
  const quotedAmount = q2.body?.payableAmount ?? q2.body?.goodsAmount;
  check('订单金额 = 报价金额（档位自适应）', quotedAmount != null && o2.body?.order?.paid === quotedAmount, { quoted: quotedAmount, paid: o2.body?.order?.paid });
  const quotedUnit = q2.body?.product?.unitPrice;
  check('报价金额 = 单价 × 数量', quotedUnit != null && quotedAmount === Math.round(quotedUnit * 2 * 100) / 100, { unit: quotedUnit, qty: 2, quoted: quotedAmount });
  const cat7 = await req(L, '/catalog', { token: tok });
  const skuNow = cat7.body.items.find((i) => i.id === 'memoryCard').skus.find((s) => s.id === frontSku.id);
  check('库存按 2 件扣减', skuNow.stock === stockBefore2 - 2, { before: stockBefore2, after: skuNow.stock });

  console.log(`\n══════ 结果：通过 ${pass} / 失败 ${fail} ══════\n`);
  process.exit(fail === 0 ? 0 : 1);
}
main();

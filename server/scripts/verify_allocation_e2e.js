/**
 * 分配提点弹窗 · 真实 HTTP 端到端（2026-10-27）
 *
 * 模拟小程序端真实操作路径：
 *   ① 店长在收益页看到一笔「销售 5%」→ 点「分配销售提点」
 *   ② GET  allocation-options → 取回弹窗选项（原型那几项收益方）
 *   ③ 选「上级区代」→ POST allocation-quotes（带 targetId 语义键）
 *   ④ POST allocations（只带 quoteId + idempotencyKey，不带 targets）
 *   ⑤ 查收益明细 → allocationStatus = PENDING
 *   ⑥ 选「其他代理」→ 填 ID → 报价成功
 *   ⑦ 选「其他代理」→ 不填 ID → 报错（前端据此提示「请输入巡查方ID」）
 *   ⑧ 区县负责人收到「巡查 5%」→ 选项为巡查那 5 项
 */
const BASE = process.env.BASE || 'http://localhost:3000';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${extra !== undefined ? ' -> ' + JSON.stringify(extra) : ''}`); }
}
function head(t) { console.log(`\n===== ${t} =====`); }

const { parentLogin } = require('./loginKit.cjs');
async function req(method, path, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  return { status: res.status, data };
}
async function login(phone) {
  const r = await parentLogin(req, phone);
  return r.data && r.data.token;
}
/** 管理员下单（走管理端接口，产出特色产品订单） */
async function adminOrder(body) {
  const r = await req('POST', '/api/order/product', { token: ADMIN, body });
  return r.data;
}

let ADMIN = null;

(async () => {
  // 管理员登录（家长/合伙人手机号 + 短信验证码，purpose=login；P2-2 起 parent 登录必须凭验证码）
  const adminLogin = await parentLogin(req, '13800000001');
  ADMIN = adminLogin.data && adminLogin.data.token;

  head('① 准备：管理员下单特色产品（门店交付），产生巡查 5% + 销售 5%');
  const order = await adminOrder({ buyerId: 'p4', productKey: 'featured', qty: 1, regionCode: '330110', deliveryType: 'store' });
  check('特色产品下单成功', !!order && !!order.order_id, order && order.order_id);

  head('② 店长（p6）查看收益：应有一笔「销售 5%」可分配');
  const storeToken = await login('13800000006');
  check('店长登录成功', !!storeToken);
  const storeEntries = await req('GET', '/income/entries?contextId=partner:p6', { token: storeToken });
  check('收益列表可取', storeEntries.status === 200);
  const items = storeEntries.data.items || [];
  const salesEntry = items.find((x) => x.allocationKind === 'sales');
  check('存在 allocationKind=sales 的明细', !!salesEntry, items.map((x) => x.allocationKind));
  check('对外 allocationKind 为 sales（不是 inspect）', salesEntry && salesEntry.allocationKind === 'sales', salesEntry && salesEntry.allocationKind);
  check('收益带 incomeChannel（门店收益/合店老板收益分离标记）', salesEntry && !!salesEntry.incomeChannel, salesEntry && salesEntry.incomeChannel);

  head('③ GET allocation-options：取回弹窗选项（原型那几项）');
  const opts = await req('GET', `/income/entries/${salesEntry.id}/allocation-options?contextId=partner:p6`, { token: storeToken });
  check('allocation-options 返回 200', opts.status === 200, opts.data);
  const field = (opts.data.fields || []).find((f) => f.key === 'targetId');
  check('返回 fields[targetId]（前端弹窗直接消费）', !!field, (opts.data.fields || []).map((f) => f.key));
  const optionLabels = (field && field.options || []).map((o) => o.label);
  check('销售侧选项 = 本店/上级区代/上级市代/上级省代/总部/其他代理',
    optionLabels.join('/') === '本店/上级区代/上级市代/上级省代/总部/其他代理', optionLabels);
  const otherOpt = (field.options || []).find((o) => o.value === 'other');
  check('「其他代理」标记 needsId', otherOpt && otherOpt.needsId === true, otherOpt);

  head('④ 选「上级区代」→ 报价 → 提交（只带 quoteId）');
  const quote = await req('POST', `/income/entries/${salesEntry.id}/allocation-quotes`, {
    token: storeToken,
    body: { contextId: 'partner:p6', targetId: 'county', percent: 100, allocationKind: 'sales' },
  });
  check('报价返回 valid=true', quote.status === 200 && quote.data.valid === true, quote.data);
  check('报价返回 quoteId', !!quote.data.quoteId || !!quote.data.id, quote.data && (quote.data.quoteId || quote.data.id));
  check('报价行解析为真实收款人（非语义键）', quote.data.rows && quote.data.rows.length === 1 && quote.data.rows[0].targetId !== 'county', quote.data.rows);

  const submit = await req('POST', `/income/entries/${salesEntry.id}/allocations`, {
    token: storeToken,
    body: { contextId: 'partner:p6', quoteId: quote.data.quoteId || quote.data.id, idempotencyKey: 'e2e-al-1' },
  });
  check('提交成功 status=PENDING_SETTLEMENT', submit.status === 200 && submit.data.status === 'PENDING_SETTLEMENT', submit.data);

  const after = await req('GET', `/income/entries/${salesEntry.id}?contextId=partner:p6`, { token: storeToken });
  check('分配后 allocationStatus=PENDING', after.data.allocationStatus === 'PENDING', after.data.allocationStatus);

  head('⑤ 「其他代理」：填 ID 成功 / 不填 ID 报错');
  const qOther = await req('POST', `/income/entries/${salesEntry.id}/allocation-quotes`, {
    token: storeToken,
    body: { contextId: 'partner:p6', targetId: 'other', percent: 100, allocationKind: 'sales', agentId: 'p5' },
  });
  check('填合法 ID → 报价有效', qOther.status === 200 && qOther.data.valid === true, qOther.data);
  check('受益人解析为该 ID', qOther.data.rows && qOther.data.rows[0] && qOther.data.rows[0].targetId === 'p5', qOther.data.rows);
  const qOtherBad = await req('POST', `/income/entries/${salesEntry.id}/allocation-quotes`, {
    token: storeToken,
    body: { contextId: 'partner:p6', targetId: 'other', percent: 100, allocationKind: 'sales' },
  });
  check('不填 ID → 报价无效并提示填 ID', qOtherBad.status === 200 && qOtherBad.data.valid === false
    && /销售方ID/.test((qOtherBad.data.errors || []).join('')), qOtherBad.data && qOtherBad.data.errors);

  head('⑥ 区县负责人（p5）查看「巡查 5%」：选项应为巡查那 5 项');
  const distToken = await login('13800000005');
  const distEntries = await req('GET', '/income/entries?contextId=partner:p5', { token: distToken });
  const inspectEntry = (distEntries.data.items || []).find((x) => x.allocationKind === 'inspection');
  check('存在 allocationKind=inspection 的明细', !!inspectEntry, (distEntries.data.items || []).map((x) => x.allocationKind));
  const iOpts = await req('GET', `/income/entries/${inspectEntry.id}/allocation-options?contextId=partner:p5`, { token: distToken });
  const iField = (iOpts.data.fields || []).find((f) => f.key === 'targetId');
  const iLabels = (iField && iField.options || []).map((o) => o.label);
  check('巡查侧选项 = 本人/上级市代/上级省代/总部/其他代理',
    iLabels.join('/') === '本人/上级市代/上级省代/总部/其他代理', iLabels);
  const iOther = (iField.options || []).find((o) => o.value === 'other');
  check('巡查侧「其他代理」也需填 ID', iOther && iOther.needsId === true, iOther);

  head('⑦ 巡查侧提交（选「上级省代」）');
  const iQuote = await req('POST', `/income/entries/${inspectEntry.id}/allocation-quotes`, {
    token: distToken,
    body: { contextId: 'partner:p5', targetId: 'province', percent: 100, allocationKind: 'inspection' },
  });
  check('巡查报价有效', iQuote.status === 200 && iQuote.data.valid === true, iQuote.data);
  const iSubmit = await req('POST', `/income/entries/${inspectEntry.id}/allocations`, {
    token: distToken,
    body: { contextId: 'partner:p5', quoteId: iQuote.data.quoteId || iQuote.data.id, idempotencyKey: 'e2e-al-2' },
  });
  check('巡查提交成功', iSubmit.status === 200 && iSubmit.data.status === 'PENDING_SETTLEMENT', iSubmit.data);

  head('⑧ 门店收益规则表接口');
  const rules = await req('GET', '/income/store-income-rules?contextId=partner:p6', { token: storeToken });
  check('规则表接口 200', rules.status === 200);
  // 2026-10-27：虚拟产品类型已废弃（AI软件卡→software 固定拿货价、陪练卡→featured），
  // 门店收益规则表由 5 类收敛为 4 类：physical / software / featured / admin
  check('覆盖 4 类商品（virtual 已废弃）', (rules.data.rules || []).length === 4, (rules.data.rules || []).map((r) => r.kind));
  const feat = (rules.data.rules || []).find((r) => r.kind === 'featured');
  check('特色产品含巡查/销售两个可分配池', feat && (feat.assignablePools || []).length === 2, feat && feat.assignablePools);
  check('收益线字典含门店收益与合店老板收益',
    (rules.data.incomeChannels || []).length === 2
    && rules.data.incomeChannels.some((c) => c.key === 'storeIncome')
    && rules.data.incomeChannels.some((c) => c.key === 'costoreOwnerIncome'), rules.data.incomeChannels);

  console.log(`\n${'='.repeat(50)}`);
  console.log(`通过 ${pass} / 失败 ${fail}`);
  console.log('='.repeat(50));
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.error('E2E 异常:', e); process.exit(1); });

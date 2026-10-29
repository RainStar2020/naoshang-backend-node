/**
 * 分配提点弹窗全链路回归（2026-10-27 用户原型截图确认）
 *
 * 原型要求：
 *   ①「分配巡查提点」收益方固定 5 项：本人 / 上级市代 / 上级省代 / 总部 / 其他代理
 *   ②「分配销售提点」收益方固定 6 项：本店 / 上级区代 / 上级市代 / 上级省代 / 总部 / 其他代理
 *   ③ 选「其他代理」必须填对应 ID（巡查方ID / 销售方ID），否则报错
 *   ④ 提交分配：前端只带 quoteId + idempotencyKey（不传 targets），服务端凭报价单还原方案
 *   ⑤ 对外 allocationKind 统一为 inspection / sales（前端据此显示标题与文案）
 *   ⑥ 语义键（self/city/province/county/hq/other）由后端解析成真实收款人
 */
const S = require('../src/store');
const R = require('../src/routes');
const ALC = require('../src/allocation');

let pass = 0, fail = 0;
function eq(label, actual, expected) {
  const ok = typeof expected === 'number' ? Math.abs(actual - expected) < 0.01 : actual === expected;
  if (ok) { pass++; console.log(`  ✓ ${label} = ${actual}`); }
  else { fail++; console.log(`  ✗ ${label} 实际=${actual} 期望=${expected}`); }
}
function ok(label, cond, extra) {
  if (cond) { pass++; console.log(`  ✓ ${label}${extra ? ' ' + extra : ''}`); }
  else { fail++; console.log(`  ✗ ${label}${extra ? ' ' + extra : ''}`); }
}
function head(t) { console.log(`\n===== ${t} =====`); }

/**
 * 构造层级区域：省 11 / 市 1101 / 区县 110101 / 单店 110101
 * p5 = 区县负责人（拿巡查 5%）；p6 = 店长（拿销售 5%）
 */
function buildDb() {
  const db = S.createDb();
  S.addUser(db, { id: 'p1', tier: 'cofounder', phone: '1' });
  S.addUser(db, { id: 'buyer', tier: 'vip', phone: '2', upline_id: 'p1' });
  S.addUser(db, { id: 'prov', tier: 'angel', phone: '3' });
  S.appointAgent(db, { partnerId: 'prov', regionType: 'province', regionCode: '11' });
  S.addUser(db, { id: 'city', tier: 'angel', phone: '4' });
  S.appointAgent(db, { partnerId: 'city', regionType: 'city', regionCode: '1101' });
  S.addUser(db, { id: 'dist', tier: 'private', phone: '5' });
  S.appointAgent(db, { partnerId: 'dist', regionType: 'district', regionCode: '110101' });
  S.addUser(db, { id: 'store', tier: 'angel', phone: '6' });
  S.appointAgent(db, { partnerId: 'store', regionType: 'store', regionCode: '110101' });
  return db;
}

/** 下单一笔特色产品，产生「区县巡查 5%」与「店长销售 5%」两笔可分配明细 */
function placeFeatured(db) {
  const r = R.createProductOrder(db, { buyerId: 'buyer', productKey: 'featured', qty: 1, storeId: '110101' });
  const inspect = db.commissions.find((c) => c.id === `po-${r.order_id}-featured_district_inspect`);
  const sales = db.commissions.find((c) => c.id === `po-${r.order_id}-featured_store_sales`);
  return { order: r, inspect, sales };
}

head('A. 巡查池：对外 allocationKind = inspection，语义选项固定 5 项');
{
  const db = buildDb();
  const { inspect } = placeFeatured(db);
  eq('巡查明细 kindOf = inspect（内部）', ALC.kindOf(inspect), 'inspect');
  eq('对外 allocationKind = inspection', ALC.publicKind(ALC.kindOf(inspect)), 'inspection');
  const cands = ALC.candidates(db, inspect);
  eq('巡查候选 5 项', cands.length, 5);
  eq('选项顺序：本人/上级市代/上级省代/总部/其他代理', cands.map((c) => c.label).join('/'), '本人/上级市代/上级省代/总部/其他代理');
  eq('选项 value 为语义键', cands.map((c) => c.value).join(','), 'self,city,province,hq,other');
  ok('「其他代理」标记需填 ID', cands.find((c) => c.value === 'other').needsId === true);
  ok('其余选项不需填 ID', cands.filter((c) => c.value !== 'other').every((c) => !c.needsId));
  ok('上级市代可解析到 city', cands.find((c) => c.value === 'city').name === 'city' || cands.find((c) => c.value === 'city').available === true);
  ok('上级省代可解析到 prov', cands.find((c) => c.value === 'province').available === true);
}

head('B. 销售池：对外 allocationKind = sales，语义选项固定 6 项');
{
  const db = buildDb();
  const { sales } = placeFeatured(db);
  eq('销售明细 kindOf = sales', ALC.kindOf(sales), 'sales');
  eq('对外 allocationKind = sales', ALC.publicKind(ALC.kindOf(sales)), 'sales');
  const cands = ALC.candidates(db, sales);
  eq('销售候选 6 项', cands.length, 6);
  eq('选项顺序：本店/上级区代/上级市代/上级省代/总部/其他代理', cands.map((c) => c.label).join('/'), '本店/上级区代/上级市代/上级省代/总部/其他代理');
  ok('「其他代理」标记需填 ID', cands.find((c) => c.value === 'other').needsId === true);
  ok('上级区代可解析到 dist', cands.find((c) => c.value === 'county').available === true);
}

head('C. 语义键解析成真实收款人');
{
  const db = buildDb();
  const { inspect, sales } = placeFeatured(db);
  // 巡查：本人 = 区县负责人本人
  let r = ALC.resolveSemanticTarget(db, inspect, 'inspect', 'self');
  ok('巡查「本人」→ 区县负责人 dist', r.ok && r.targetId === 'dist', JSON.stringify(r));
  r = ALC.resolveSemanticTarget(db, inspect, 'inspect', 'city');
  ok('巡查「上级市代」→ city', r.ok && r.targetId === 'city', JSON.stringify(r));
  r = ALC.resolveSemanticTarget(db, inspect, 'inspect', 'province');
  ok('巡查「上级省代」→ prov', r.ok && r.targetId === 'prov', JSON.stringify(r));
  r = ALC.resolveSemanticTarget(db, inspect, 'inspect', 'hq');
  ok('巡查「总部」→ HQ', r.ok && r.targetId === 'HQ', JSON.stringify(r));
  // 销售：本人 = 本店店长
  r = ALC.resolveSemanticTarget(db, sales, 'sales', 'self');
  ok('销售「本店」→ 店长 store', r.ok && r.targetId === 'store', JSON.stringify(r));
  r = ALC.resolveSemanticTarget(db, sales, 'sales', 'county');
  ok('销售「上级区代」→ dist', r.ok && r.targetId === 'dist', JSON.stringify(r));
  // 其他代理：需填 ID
  r = ALC.resolveSemanticTarget(db, inspect, 'inspect', 'other', null);
  ok('「其他代理」未填 ID → 报错', !r.ok && /巡查方ID/.test(r.reason || ''), r.reason);
  r = ALC.resolveSemanticTarget(db, sales, 'sales', 'other', null);
  ok('销售侧未填 ID → 报错「销售方ID」', !r.ok && /销售方ID/.test(r.reason || ''), r.reason);
  r = ALC.resolveSemanticTarget(db, inspect, 'inspect', 'other', 'prov');
  ok('「其他代理」填合法 ID → 解析成功', r.ok && r.targetId === 'prov', JSON.stringify(r));
  r = ALC.resolveSemanticTarget(db, inspect, 'inspect', 'other', 'ghost-x');
  ok('「其他代理」填不存在 ID → 报错', !r.ok && /受益人不存在/.test(r.reason || ''), r.reason);
  r = ALC.resolveSemanticTarget(db, inspect, 'inspect', 'kingdom');
  ok('非法语义键 → 报错', !r.ok, r.reason);
}

head('D. 报价：语义键 + 单一目标 100%');
{
  const db = buildDb();
  const { inspect } = placeFeatured(db);
  const q = ALC.quote(db, inspect, { targets: [{ targetId: 'city', percent: 100 }] });
  ok('报价有效', q.valid === true, JSON.stringify(q.errors));
  eq('解析后 1 行', q.rows.length, 1);
  eq('收款人 = city（不是语义键）', q.rows[0].targetId, 'city');
  eq('金额 = 全额', q.rows[0].amount, inspect.amount);
  eq('比例 = 100%', q.rows[0].percent, 100);
  // 「其他代理」缺 ID
  const q2 = ALC.quote(db, inspect, { targets: [{ targetId: 'other', percent: 100 }] });
  ok('「其他代理」缺 ID → 报价无效', q2.valid === false && /巡查方ID/.test(q2.errors.join('')), q2.errors.join('；'));
  // 合计不足 100%
  const q3 = ALC.quote(db, inspect, { targets: [{ targetId: 'city', percent: 60 }, { targetId: 'hq', percent: 30 }] });
  ok('合计非 100% → 报错', q3.valid === false && /100%/.test(q3.errors.join('')), q3.errors.join('；'));
}

head('E. 提交：仅凭 quoteId 还原方案（前端主路径）');
{
  const db = buildDb();
  const { inspect } = placeFeatured(db);
  // 报价单落库
  const quoteId = ALC.saveQuote(db, {
    entryId: inspect.id, userId: 'dist', kind: 'inspect',
    targets: [{ targetId: 'city', percent: 100 }],
    entryAmount: inspect.amount, rows: [], totalPercent: 100, totalAmount: inspect.amount,
  });
  ok('报价单可读取', !!ALC.getQuote(db, quoteId));
  // 提交时只给 quoteId（不传 targets）
  const r = ALC.submit(db, inspect, { quoteId, idempotencyKey: 'al-1', operatorId: 'dist' });
  eq('提交成功，状态 PENDING_SETTLEMENT', r.status, 'PENDING_SETTLEMENT');
  eq('分配记录 1 条', db.allocations.length, 1);
  eq('收款人 = city', db.allocations[0].rows[0].targetId, 'city');
  eq('明细 allocationStatus = PENDING', inspect.allocationStatus, 'PENDING');
  // 幂等：同 idempotencyKey 不重复
  const r2 = ALC.submit(db, inspect, { quoteId, idempotencyKey: 'al-1', operatorId: 'dist' });
  ok('幂等：重复提交不新增记录', r2.duplicated === true && db.allocations.length === 1);
  // 过期报价单
  const old = ALC.saveQuote(db, { entryId: inspect.id, userId: 'dist', kind: 'inspect', targets: [], entryAmount: 0, rows: [], totalPercent: 0, totalAmount: 0 });
  db.allocationQuotes.find((q) => q.id === old).expiresAt = Date.now() - 1;
  ok('过期报价单读不到', ALC.getQuote(db, old) === null);
}

head('F. 结算：分配后拆子佣金，父记录 withhold');
{
  const db = buildDb();
  const { inspect } = placeFeatured(db);
  const q = ALC.quote(db, inspect, { targets: [{ targetId: 'city', percent: 100 }] });
  ALC.submit(db, inspect, { targets: q.rows.map((r) => ({ targetId: r.targetId, percent: r.percent })), idempotencyKey: 'al-2', operatorId: 'dist' });
  const res = ALC.settle(db);
  eq('结算 1 笔', res.settled, 1);
  eq('生成子佣金 1 条', res.commissions.length, 1);
  eq('子佣金收款人 = city', res.commissions[0].owner_id, 'city');
  eq('子佣金金额 = 原额', res.commissions[0].amount, inspect.amount);
  ok('子佣金标记 allocationKind', res.commissions[0].allocationKind === 'inspect', res.commissions[0].allocationKind);
  ok('父记录 withhold（不可提现）', inspect.withhold === true);
  eq('父记录 allocationStatus = SETTLED', inspect.allocationStatus, 'SETTLED');
  // 结算后不可再分配
  const again = ALC.allocatable(db, inspect);
  ok('结算后不可再发起分配', again.ok === false, again.reason);
}

head('G. 结算后不可改：撤销与幂等边界');
{
  const db = buildDb();
  const { sales } = placeFeatured(db);
  const q = ALC.quote(db, sales, { targets: [{ targetId: 'self', percent: 100 }] });
  const r = ALC.submit(db, sales, { targets: [{ targetId: 'self', percent: 100 }], idempotencyKey: 'al-3', operatorId: 'store' });
  eq('销售池分配到本人 = 店长 store', db.allocations[0].rows[0].targetId, 'store');
  // 撤销（结算前）
  ALC.revoke(db, r.allocationId, { operatorId: 'store' });
  eq('撤销后 allocationStatus = NONE', sales.allocationStatus, 'NONE');
  ok('撤销后可重新分配', ALC.allocatable(db, sales).ok === true);
}

head('H. 老契约兼容：直接传用户 ID 仍可用');
{
  const db = buildDb();
  const { inspect } = placeFeatured(db);
  const q = ALC.quote(db, inspect, { targets: [{ targetId: 'dist', percent: 60 }, { targetId: 'HQ', percent: 40 }] });
  ok('老契约报价有效', q.valid === true, JSON.stringify(q.errors));
  eq('2 行', q.rows.length, 2);
  eq('收款人 1 = dist', q.rows[0].targetId, 'dist');
  eq('收款人 2 = HQ', q.rows[1].targetId, 'HQ');
  eq('合计 100%', q.totalPercent, 100);
}

console.log(`\n${'='.repeat(50)}`);
console.log(`通过 ${pass} / 失败 ${fail}`);
console.log('='.repeat(50));
process.exit(fail > 0 ? 1 : 0);

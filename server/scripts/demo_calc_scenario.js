/**
 * 脑商AI · 分润算法实算演示（供人工逐笔复核）
 *
 * 直接调用真实引擎（store.js / routes.createOrder / settlement.runSettlement），
 * 纯内存运行，不读写 data/db.json。
 *
 * 场景：10 个角色 + 4 笔正式交易 + 1 次月度结算 + 1 笔升级诊断单。
 * 运行：node scripts/demo_calc_scenario.js
 */
const S = require('../src/store');
const IZ = require('../src/identity');
const R = require('../src/routes');
const C = require('../src/commission');
const Q = require('../src/quotaLedger');
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const db = S.createDb();
const line = (c = '─') => console.log(c.repeat(78));

// ════════════════════════════════════════════════════════════════
// 一、角色设定
// ════════════════════════════════════════════════════════════════
const ROLES = [
  ['A', '甲·总部联创(持创始奖)', 'cofounder', null, 500, { is_founding: 'founding', daysSinceCofounder: 0 }],
  ['B', '乙·私董', 'private', 'A', 200, {}],
  ['C', '丙·天使', 'angel', 'B', 100, {}],
  ['D', '丁·VIP合伙人', 'vip', 'C', 50, {}],
  ['E', '戊·普通新用户', 'none', 'D', 0, {}],
  ['F', '己·天使+门店老板', 'angel', 'C', 100, {}],
  ['G', '辛·素人(后任区县代)', 'none', 'B', 100, {}],
  ['H', '辰·天使(丙的同级上级)', 'angel', 'C', 50, {}],
  ['I', '癸·普通新用户', 'none', 'F', 0, {}],
  ['J', '亥·普通新用户', 'none', 'H', 0, {}],
];
console.log('\n════════ 角色设定（编号=引擎实时派生） ════════');
for (const [id, name, tier, upline, quota, extra] of ROLES) {
  S.addUser(db, Object.assign({ id, name, phone: '139000000' + id.charCodeAt(0) % 10, tier, upline_id: upline }, extra));
  db.quotaLedger[id] = quota;
}
// 代理任命（不传开发人 → 不产生代理提成，只建身份）
// 结构化层级码 + 显式父链：省 33 → 市 3301 → 区县 330110 → 门店 330110-S1
// 省/市代由联创甲(A) 兼任（province/city 赠 cofounder，A 已是最高档，tier 不变）
S.appointAgent(db, { partnerId: 'A', regionType: 'province', regionCode: '33' }); // 省代（联创兼任，赠 cofounder 但 tier 已最高）
S.appointAgent(db, { partnerId: 'A', regionType: 'city', regionCode: '3301', parentCode: '33' }); // 市代（联创兼任）
S.appointAgent(db, { partnerId: 'G', regionType: 'district', regionCode: '330110', parentCode: '3301' }); // 区县代：赠私董
S.appointAgent(db, { partnerId: 'F', regionType: 'store', regionCode: '330110-S1', parentCode: '330110' }); // 单店代理：门店码，父级=区县码（门店码≠订单区县码，父链归集 2400 不掉总部）
function roleTable(tag) {
  console.log(`\n[${tag}]`);
  console.log('  ID  姓名                      档位      上级  名额   对外编号');
  for (const [id, name] of ROLES) {
    const u = db.users[id];
    const _q = db.quotaLedger[id]; const _qs = (_q && typeof _q === 'object') ? (_q.standard ?? 0) : _q;
    console.log(`  ${id}   ${name.padEnd(22)} ${String(u.tier).padEnd(9)} ${String(u.upline_id || '—').padEnd(5)} ${String(_qs).padStart(4)}   ${u.display_id}`);
  }
}
roleTable('任命代理后');

// ════════════════════════════════════════════════════════════════
// 二、交易（逐笔打印引擎原始输出）
// ════════════════════════════════════════════════════════════════
const W = C.WHOLESALE_PER_QUOTA;

function deal(no, narrate, input, expect) {
  const before = db.commissions.length;
  line('═');
  console.log(`交易 ${no}: ${narrate}`);
  console.log(`  引擎入参: ${JSON.stringify(input)}`);
  let r;
  try { r = R.createOrder(db, input); } catch (e) { console.log('  ❌ 下单失败:', e.message); return; }
  const o = db.orders[db.orders.length - 1];
  console.log(`  订单: ${o.id} | 买家 ${o.buyer_id}(${db.users[o.buyer_id].tier}) → 卖家 ${o.seller_id}(${db.users[o.seller_id].tier}) | 渠道 ${o.channel}`);
  console.log(`  实付 ${o.actual_paid} | 卖家拿货成本 ${o.sellerCost} | 消耗名额 ${o.quotaCount} | 供应差价 ${o.supply_spread} | 门店服务费 ${o.store_fee} | 总部费 ${o.hq_fee}`);
  console.log('  ── 落账佣金 ──');
  const fresh = db.commissions.slice(before);
  for (const c of fresh) {
    console.log(`    ${c.owner_id} ${String(db.users[c.owner_id].name).padEnd(20)} [${c.type}] ${String(c.amount).padStart(8)}  ${c.formula || c.note || ''}`);
  }
  // 闭环校验（平级奖已从供货上级级差中扣，与供货差价合计=差价链Σ，不再额外出账）
  const sum = fresh.reduce((s, c) => s + c.amount, 0);
  const parity = fresh.filter((c) => c.type === 'parity').reduce((s, c) => s + c.amount, 0);
  const chainSum = round2(sum);   // 含平级奖再分配：供货上级级差减少 = 平级奖发放，两抵后守恒
  const closed = round2(chainSum + o.hq_fee + o.store_fee);
  const gap = round2(o.actual_paid - closed);
  console.log(`  ── 闭环: 差价链Σ(含平级再分配)${chainSum} + 总部费 ${o.hq_fee} + 门店服务费 ${o.store_fee} = ${closed} vs 实付 ${o.actual_paid} → ${gap === 0 ? '✅ 分文不差' : '⚠️ 差 ' + gap}`);
  if (parity > 0) console.log(`     平级奖 ${parity} 已从供货上级级差中扣除（非额外出账）→ 差价链Σ 已含此再分配，总分发与实付一致`);
  console.log(`  卖家名额余额: ${r.quota_balance_after}${input.rawQuota != null ? ` | 买方名额余额: ${Q.getBalance(db.quotaLedger, o.buyer_id)}（补货入账 +${o.quotaCount}）` : ' | 买方为升级：消耗上级名额，不入账'}`);
  if (expect) console.log(`  手算预期: ${expect}`);
  return { order: o, commissions: fresh };
}

console.log('\n════════ 交易叙述与引擎实算 ════════');

deal('T1', '戊(新用户) 经上级丁(VIP) 购买「VIP合伙人整包」，零售 9980 元',
  { buyerId: 'E', packageTier: 'vip', oldTier: 'none' },
  '差价链 2000+480+520+480=3480，+总部 6500 = 9980');

deal('T2', '丙(天使) 向上级乙(私董) 批发补货 3 个「天使名额」，单价 7500，共 22500 元',
  { buyerId: 'C', packageTier: 'angel', oldTier: 'angel', rawQuota: 3 },
  '级联到总部：乙差价 (7500−6980)×3=1560，甲级差 (6980−6500)×3=1440，总部 6500×3=19500；丙名额 100→103');

deal('T3', '癸(新用户) 经门店老板己(天使·门店码 330110-S1，父级=区县码 330110) 购买「VIP整包」9980 元，区域码 330110',
  { buyerId: 'I', packageTier: 'vip', oldTier: 'none', regionCode: '330110' },
  '门店渠道：门店服务费 3000 单列，差价链 2480+0+520+480=3480');

deal('T4', '亥(新用户) 经辰(天使) 购买「天使整包」29800 元；辰与丙同为天使(同级链)',
  { buyerId: 'J', packageTier: 'angel', oldTier: 'none' },
  '辰差价7300 + 丙级差0 + 乙级差1560−平级奖418.8=1141.2 + 甲级差1440 = 10300（丙平级奖418.8=私董6980×2%×3，从乙级差扣），+总部 19500=29800');

roleTable('T1~T4 后');

// ════════════════════════════════════════════════════════════════
// 三、月度结算
// ════════════════════════════════════════════════════════════════
// 登记一家合店：戊(合店老板/VIP) 月费 698，无推荐人，上级=丁(非合店老板)
S.addCoStore(db, { owner_id: 'E', monthly_fee: 698, owners: [{ id: 'E', performance: 0 }], joinDate: undefined });
line('═');
console.log('月度结算（period=2026-10，含 T1~T4 四单 + 合店费一次性全额 4188）');
const st = R.runSettlement(db, { period: '2026-10' });
console.log(`\n  全平台当月 VIP 总量: ${st.totalVip}（T1=1, T2=3, T3=1, T4=3）`);
console.log(`  全球奖奖池 = 150 × ${st.totalVip} = ${st.globalPool}（一半均分 + 一半按团队业绩）`);
console.log('  ── 全球奖 ──');
for (const c of db.commissions.filter((x) => x.type === 'global')) console.log(`    ${c.owner_id} 甲: ${c.amount}（均分 600 + 业绩 600）`);
console.log('  ── 创始奖（按人各得全额，不拆分）──');
for (const c of db.commissions.filter((x) => x.type === 'founding')) console.log(`    ${c.owner_id} ${db.users[c.owner_id].name}: ${c.amount}  ${c.formula || ''}`);
console.log('  ── 门店服务费四级拆分（仅 T3 门店渠道 3000）──');
for (const c of db.commissions.filter((x) => x.type === 'agent')) console.log(`    ${c.owner_id === 'HQ' ? 'HQ(总部兜底)' : c.owner_id + ' ' + db.users[c.owner_id].name} [${c.region_type}] ${c.amount}`);
console.log('  ── 合店费一次性全额 4188（四场景·场景C：上级非合店老板）──');
for (const c of db.commissions.filter((x) => x.type === 'costore')) console.log(`    ${c.owner_id === 'HQ' ? 'HQ(总部)' : c.owner_id + ' ' + db.users[c.owner_id].name} [${c.subtype}] ${c.amount}  ${c.note || ''}`);
console.log(`\n  当月全量收益合计（含下单即时 + 结算）: ${st.allTotal}`);
console.log('  按类型:', JSON.stringify(st.allByType));

// ════════════════════════════════════════════════════════════════
// 四、诊断：零售模式「升级」闭环缺口
// ════════════════════════════════════════════════════════════════
console.log('\n════════ 诊断 T5：戊(VIP) 经丁升级「天使」—— 已按用户 2026-10-24 拍板落地（付差价 19820，闭环）════════');
const r6 = deal('T5', '戊(VIP合伙人) 经上级丁(VIP) 升级为天使，付「天使一口价29800 − 已付VIP9980 = 19820」差价',
  { buyerId: 'E', packageTier: 'angel', oldTier: 'vip' },
  '升级只付差价19820：丁差价3860 + 丙960 + 乙1040 + 甲960 + 总部费13000 = 19820 ✅（戊升TS0005）');

// ════════════════════════════════════════════════════════════════
// 五、每人收益汇总
// ════════════════════════════════════════════════════════════════
console.log('\n════════ 每人收益汇总（2026-10 全量）════════');
console.log('  ID  姓名                      收益合计   明细');
for (const [id, name] of ROLES) {
  const s = S.commissionSummary(db, id, { period: '2026-10' });
  const detail = Object.entries(s.byType).map(([t, v]) => `${t}:${v}`).join(' ');
  console.log(`  ${id}   ${name.padEnd(22)} ${String(s.total).padStart(8)}   ${detail || '—'}`);
}
const hqTotal = db.commissions.filter((c) => c.owner_id === 'HQ').reduce((s, c) => s + c.amount, 0);
console.log(`  HQ  总部(兜底+门店/合店分成)  ${round2(hqTotal).toString().padStart(8)}`);
roleTable('终态');

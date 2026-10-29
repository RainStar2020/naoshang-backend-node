#!/usr/bin/env node
/**
 * ════════════════════════════════════════════════════════════════════
 * 逐笔收益核对台账（人工对账工具）
 * ════════════════════════════════════════════════════════════════════
 * 用途：生成一份**干净可控**的测试场景 → 跑完整链路（下单→结算）→ 输出
 *       每一笔收益的「谁 / 什么类型 / 基数 / 比例 / 金额 / 计算公式」，
 *       供你用纸笔逐条手算比对，验证底层算法是否正确。
 *
 * 用法：
 *   node scripts/audit_ledger.js              # 用内置场景 A
 *   node scripts/audit_ledger.js --scenario=B # 换场景
 *   node scripts/audit_ledger.js --json       # 输出 JSON（便于二次处理）
 *   node scripts/audit_ledger.js --save       # 写入 docs/核对台账-<场景>.md
 *
 * 设计原则：
 *   1. 每个场景都**极简**，把所有变量写死在 SCENARIOS 里，你可以完全手算。
 *   2. 输出每笔收益都带 formula 字段（基数 × 比例 = 金额），一眼可验。
 *   3. 结算前后各做一次「资金闭环」校验：所有收益之和 = 总部应得。
 * ════════════════════════════════════════════════════════════════════
 */
const fs = require('fs');
const path = require('path');

const S = require('../src/store');
const R = require('../src/routes');
const SET = require('../src/settlement');
const C2 = require('../src/commission');

const T_CN = {
  supply: '供应差价', direct: '直推奖', rebuy: '复购奖', parity: '平级奖',
  global: '全球奖', founding: '创始奖', agent: '区域代理', costore: '合店费',
  region_vip: '区域奖', region_goods_diff: '商品级差', region_signing: '直推代理奖',
  region_admin_delivery: '行政费', region_costore: '合店提成', region_vip_partner: 'VIP合伙人奖',
};
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// ───────────── 场景定义（每个都做到可纯手算） ─────────────
const SCENARIOS = {
  /**
   * 场景 A：最小闭环 —— 1 个 VIP 订单，2 人链路
   * p1 联创(持创始奖) → p2 私董 → p3 天使 → p4 VIP
   * 代理：p3 兼单店代理（天使，D1-S1）；p2 兼区县代（私董，D1）
   * 订单：p4 向 p3 买 1 个 VIP（复购口径，因为 oldTier=vip）
   */
  A: {
    title: '场景A · 最小闭环（1 单 / 4 人 / 2 代理）',
    desc: '一条 VIP 订单贯穿 供应差价→平级奖→全球奖→创始奖→区域奖(省/市/区县/门店)，逐笔可手算',
    users: [
      { id: 'p1', name: '联创甲(持创始奖)', phone: '13800000001', tier: 'cofounder', is_founding: true, upline_id: null, quota: 100 },
      { id: 'p2', name: '私董乙(区县代)', phone: '13800000002', tier: 'private', is_founding: false, upline_id: 'p1', quota: 100 },
      { id: 'p3', name: '天使丙(单店代理)', phone: '13800000003', tier: 'angel', is_founding: false, upline_id: 'p2', quota: 100 },
      { id: 'p4', name: 'VIP丁', phone: '13800000004', tier: 'vip', is_founding: false, upline_id: 'p3', quota: 0 },
    ],
    orders: [
      { buyer_id: 'p4', packageTier: 'vip', oldTier: 'vip', quotaCount: 1, regionCode: 'D1', buyerIsNew: false },
    ],
    agents: [
      { partner_id: 'p2', region_type: 'district', region_code: 'D1' },
      { partner_id: 'p3', region_type: 'store', region_code: 'D1' },
    ],
    costores: [],
  },

  /**
   * 场景 B：新客直推 —— 重点验「直推奖 + 供应差价」两笔
   * p1 联创(持创始奖) → p2 私董 → p3 天使(新客，首次购买升 VIP)
   * 订单：p3 向 p2 买 VIP（buyerIsNew=true → 出直推奖）
   */
  B: {
    title: '场景B · 新客购买（验身份销售仅供货差价，无直推奖）',
    desc: 'p3 新客向 p2 购买 1 个 VIP：身份销售只产生供货差价 = 实付 − 拿货成本（直推奖已移除，仅产品提成/代理技术费保留直推）',
    users: [
      { id: 'p1', name: '联创甲(持创始奖)', phone: '13800000001', tier: 'cofounder', is_founding: true, upline_id: null, quota: 100 },
      { id: 'p2', name: '私董乙', phone: '13800000002', tier: 'private', is_founding: false, upline_id: 'p1', quota: 100 },
      { id: 'p3', name: '天使丙(新客)', phone: '13800000003', tier: 'angel', is_founding: false, upline_id: 'p2', quota: 0 },
    ],
    orders: [
      { buyer_id: 'p3', packageTier: 'vip', oldTier: 'vip', quotaCount: 1, regionCode: 'D1', buyerIsNew: true },
    ],
    agents: [],
    costores: [],
  },

  /**
   * 场景 C：含合店费 —— 验合店费 698 的固定三分拆分
   *   门店老板 p5（天使，合店主体）53% = 369.94
   *   推荐人 p3（天使，单店代理）  2% = 13.96（复购奖）
   *   合店店长分红池 p5           10% = 69.8（一半均分 + 一半业绩）
   *   总部体系 35% = 244.3（总部104.7 / 省13.96 / 市55.84 / 区县69.8）
   */
  C: {
    title: '场景C · 含合店费（验 698 固定三分结构）',
    desc: '1 个 VIP 订单 + 1 笔合店费 698（53% 门店老板 / 2% 推荐人复购奖 / 10% 分红池），共 16 笔收益',
    users: [
      { id: 'p1', name: '联创甲(持创始奖)', phone: '13800000001', tier: 'cofounder', is_founding: true, upline_id: null, quota: 100 },
      { id: 'p2', name: '私董乙(区县代)', phone: '13800000002', tier: 'private', is_founding: false, upline_id: 'p1', quota: 100 },
      { id: 'p3', name: '天使丙(单店代理)', phone: '13800000003', tier: 'angel', is_founding: false, upline_id: 'p2', quota: 100 },
      { id: 'p4', name: 'VIP丁(门店老板)', phone: '13800000004', tier: 'vip', is_founding: false, upline_id: 'p3', quota: 0 },
      { id: 'p5', name: '天使戊(合店老板)', phone: '13800000005', tier: 'angel', is_founding: false, upline_id: 'p3', quota: 0 },
    ],
    orders: [
      { buyer_id: 'p4', packageTier: 'vip', oldTier: 'vip', quotaCount: 1, regionCode: 'D1', buyerIsNew: false },
    ],
    agents: [
      { partner_id: 'p2', region_type: 'district', region_code: 'D1' },
      { partner_id: 'p3', region_type: 'store', region_code: 'D1' },
    ],
    costores: [
      { owner_id: 'p5', promoter_id: 'p3', monthly_fee: 698, ownerCount: 1, owners: [{ id: 'p5', feePerf: 698 }] },
    ],
  },
};

// ───────────── 构建与执行 ─────────────
function buildDb(sc) {
  const db = S.createDb();
  for (const u of sc.users) {
    S.addUser(db, {
      id: u.id, name: u.name, phone: u.phone, tier: u.tier,
      upline_id: u.upline_id || null,
      is_founding: u.is_founding ? 'founding' : 'none',
      teamVip: 0, annual_fee_paid: true,
    });
    db.quotaLedger[u.id] = u.quota || 0;
  }
  for (const a of sc.agents) {
    S.appointAgent(db, { partnerId: a.partner_id, regionType: a.region_type, regionCode: a.region_code });
  }
  for (const cs of sc.costores) {
    S.addCoStore(db, {
      id: 'cs_' + cs.owner_id, owner_id: cs.owner_id, promoter_id: cs.promoter_id || null,
      monthly_fee: cs.monthly_fee, referrer: cs.referrer || 'other',
      ownerCount: cs.ownerCount || 1, owners: cs.owners || [], partners: cs.owners || [],
      period: '2026-10',
    });
  }
  // 下单（身份销售仅即时产生 供应差价/平级奖；无直推/复购）
  for (const o of sc.orders) {
    R.createOrder(db, {
      buyerId: o.buyer_id, packageTier: o.packageTier, oldTier: o.oldTier,
      rawQuota: o.quotaCount, regionCode: o.regionCode, buyerIsNew: o.buyerIsNew !== false,
    });
  }
  return db;
}

function runSettlement(db, period = '2026-10') {
  const cofounderIds = Object.values(db.users).filter((u) => u.tier === 'cofounder').map((u) => u.id);
  const cofounders = S.annotateCofounders(db, cofounderIds);
  const founders = Object.values(db.users)
    .filter((u) => (u.tier === 'cofounder' && u.is_founding === 'founding') || u.tier === 'private')
    .map((u) => ({ id: u.id, tier: u.tier, foundingBonus: u.is_founding === 'founding' }));
  const orders = db.orders.filter((o) => o.packageTier);
  const costoreFees = db.coStores.map((cs) => ({
    id: cs.id, owner_id: cs.owner_id, promoter_id: cs.promoter_id,
    fee: cs.monthly_fee, ownerCount: cs.ownerCount,
    owners: cs.owners || cs.partners || [], partners: cs.partners || [],
  }));
  const res = SET.settleAll({ period, orders, cofounders, founders, costoreFees, agents: db.regionalAgents });
  res.commissions.forEach((c) => S.pushCommission(db, c));

  // 全量口径（与 /api/settle 一致）：结算新增 + 下单时已即时落账
  const periodRows = db.commissions.filter((c) => c.period === period);
  const allByType = {};
  let allTotal = 0;
  for (const c of periodRows) { allByType[c.type] = round2((allByType[c.type] || 0) + c.amount); allTotal += c.amount; }

  return {
    ...res.summary,
    period,
    settleTotal: round2(res.summary.total),
    settleByType: res.summary.byType,
    allTotal: round2(allTotal),
    allByType,
    allCount: periodRows.length,
    settleCount: res.commissions.length,
  };
}

/** 逐笔账目（按 收益人 → 类型 排序，便于按人核对） */
function buildLedger(db) {
  const rows = db.commissions.map((c) => ({
    id: c.id,
    owner_id: c.owner_id,
    owner_name: c.owner_id === 'HQ' ? '总部' : (db.users[c.owner_id] ? db.users[c.owner_id].name : c.owner_id),
    type: c.type,
    type_cn: T_CN[c.type] || c.type,
    base_amount: c.base_amount,
    rate: c.rate,
    amount: c.amount,
    ref: c.ref_order_id,
    formula: c.formula || (c.base_amount != null && c.rate != null
      ? `${round2(c.base_amount)} × ${(c.rate * 100).toFixed(2).replace(/\.?0+$/, '')}% = ${round2(c.amount)}`
      : `固定 ${round2(c.amount)}`),
  }));
  return rows;
}

function printReport(sc, db, summary, rows) {
  const L = [];
  const w = (s = '') => L.push(s);

  w('╔' + '═'.repeat(84) + '╗');
  w('║' + sc.title.padEnd(84) + '║');
  w('╚' + '═'.repeat(84) + '╝');
  w('');
  w('【场景说明】' + sc.desc);
  w('');

  w('━━━ 1. 参与人 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  w('ID    姓名                  等级       直接上级   名额余额  代理身份');
  for (const u of sc.users) {
    const ag = (sc.agents || []).find((a) => a.partner_id === u.id);
    w(`${(u.id || '').padEnd(6)}${(u.name || '').padEnd(21)}${(u.tier || '').padEnd(11)}${String(u.upline_id || '总部').padEnd(11)}${String(u.quota || 0).padEnd(9)}${ag ? ag.region_type + ' / ' + ag.region_code : '—'}`);
  }
  w('');

  w('━━━ 2. 订单 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  w('订单ID   买家  →  卖方      档位   名额  实付      拿货成本  供应差价  区域  新客');
  for (const o of db.orders) {
    const b = db.users[o.buyer_id], s = db.users[o.seller_id];
    w(`${(o.id || '').padEnd(9)}${String(o.buyer_id).padEnd(6)}→ ${String(o.seller_id).padEnd(9)}${String(o.packageTier).padEnd(7)}${String(o.quotaCount).padEnd(6)}${String(round2(o.actual_paid)).padEnd(10)}${String(round2(o.sellerCost)).padEnd(11)}${String(round2(o.supply_spread)).padEnd(10)}${String(o.regionCode || '').padEnd(6)}${o.buyer_id && o.buyerIsNew !== undefined ? (o.buyerIsNew ? '是' : '否') : '—'}`);
  }
  w('');
  if (db.coStores.length) {
    w('合店记录：');
    for (const cs of db.coStores) {
      w(`  ${cs.id}  老板=${cs.owner_id}  推荐人=${cs.promoter_id || '—'}  人数=${cs.ownerCount}  月费=${cs.monthly_fee}`);
      w(`    分配：总部15%=${C2.coStoreSplit(cs.monthly_fee).hq}  省2%=${C2.coStoreSplit(cs.monthly_fee).province}  市8%=${C2.coStoreSplit(cs.monthly_fee).city}  区县10%=${C2.coStoreSplit(cs.monthly_fee).district}`);
      w(`    门店老板53%=${C2.coStoreSplit(cs.monthly_fee).storeOwner}  推荐人2%=${C2.coStoreSplit(cs.monthly_fee).referrerRebate}  分红池10%=${C2.coStoreSplit(cs.monthly_fee).dividend}`);
    }
    w('');
  }

  w('━━━ 3. 结算概览 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  w(`结算月份      ${summary.period}`);
  w(`全平台 VIP    ${summary.totalVip} 个`);
  w(`全球奖池      ${round2(summary.globalPool)} 元 (= 150 × ${summary.totalVip})`);
  w(`本次结算新增  ${round2(summary.settleTotal)} 元（${summary.settleCount} 笔）`);
  w(`当月收益全量  ${round2(summary.allTotal)} 元（${summary.allCount} 笔，含下单即时收益）`);
  w('');
  w('按类型汇总（当月全量）：');
  for (const [k, v] of Object.entries(summary.allByType || {})) {
    w(`  ${(T_CN[k] || k).padEnd(12)} ${String(round2(v)).padStart(12)}`);
  }
  w('');

  w('━━━ 4. 逐笔收益明细（★ 请对照手算逐条核对） ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  w('');
  w('  #  收益人            姓名              类型            基数        比例      金额      计算公式');
  w('  ──────────────────────────────────────────────────────────────────────────────────────────────────');
  rows.forEach((r, i) => {
    const base = r.base_amount == null ? '—' : String(round2(r.base_amount));
    const rate = r.rate == null ? '—' : (Math.abs(r.rate) <= 1 ? (r.rate * 100).toFixed(2).replace(/\.?0+$/, '') + '%' : String(round2(r.rate)));
    w(`  ${String(i + 1).padEnd(3)}${String(r.owner_id).padEnd(17)}${(r.owner_name || '').padEnd(17)}${(r.type_cn || '').padEnd(15)}${base.padEnd(12)}${rate.padEnd(9)}${String(round2(r.amount)).padStart(9)}  ${r.formula}`);
  });
  w('  ──────────────────────────────────────────────────────────────────────────────────────────────────');
  w(`  合计 ${String(rows.length).padEnd(3)} 笔                                            ${String(round2(rows.reduce((s, r) => s + r.amount, 0))).padStart(9)}`);
  w('');

  w('━━━ 5. 按人汇总（★ 与你手算的「每人应得」对照） ━━━━━━━━━━━━━━━━━━━━━━━━━━');
  const byOwner = {};
  rows.forEach((r) => {
    byOwner[r.owner_id] = byOwner[r.owner_id] || { name: r.owner_name, items: [], total: 0 };
    byOwner[r.owner_id].items.push(r);
    byOwner[r.owner_id].total += r.amount;
  });
  for (const [oid, o] of Object.entries(byOwner)) {
    w(`  ${oid.padEnd(8)}${o.name.padEnd(20)}合计 ${round2(o.total).toString().padStart(11)}`);
    o.items.forEach((r) => w(`      · ${(r.type_cn || '').padEnd(12)} ${String(round2(r.amount)).padStart(10)}   ${r.formula}`));
  }
  w('');

  // 闭环校验
  w('━━━ 6. 闭环校验 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  const checks = [];
  const sum = round2(rows.reduce((s, r) => s + r.amount, 0));
  checks.push(['逐笔合计 = 当月全量 allTotal', sum === round2(summary.allTotal), `${sum} vs ${round2(summary.allTotal)}`]);
  checks.push(['逐笔合计 ≥ 本次结算新增 settleTotal', sum >= round2(summary.settleTotal) - 0.01, `${sum} ≥ ${round2(summary.settleTotal)}`]);

  const globalRows = rows.filter((r) => r.type === 'global');
  const globalSum = round2(globalRows.reduce((s, r) => s + r.amount, 0));
  checks.push(['全球奖实得合计 ≤ 奖池', globalSum <= round2(summary.globalPool) + 0.01, `${globalSum} ≤ ${round2(summary.globalPool)}`]);

  for (const o of db.orders) {
    const supply = rows.filter((r) => r.ref === o.id && r.type === 'supply');
    if (supply.length) {
      const amt = round2(supply[0].amount);
      const expect = round2(o.actual_paid - o.sellerCost);
      checks.push([`订单 ${o.id} 供应差价 = 实付−拿货成本`, amt === expect, `${amt} vs ${expect}`]);
    }
  }
  const agentRows = rows.filter((r) => r.type === 'agent');
  const agentSum = round2(agentRows.reduce((s, r) => s + r.amount, 0));
  const expectAgent = round2(db.orders.filter((o) => o.packageTier).reduce((s, o) => s + 3000 * (o.quotaCount || 1), 0));
  checks.push(['门店服务费拆分总额 = 3000×VIP数', agentSum === expectAgent, `${agentSum} vs ${expectAgent}`]);

  checks.forEach(([name, ok, detail]) => w(`  ${ok ? '✅' : '❌'} ${name.padEnd(38)} ${detail}`));
  w('');
  w('  提示：✅ 只说明「系统内部自洽」。算法是否符合业务口径，仍需你按 tp123 规则手算比对。');
  w('');

  return L.join('\n');
}

// ───────────── 主流程 ─────────────
const args = process.argv.slice(2);
const scenarioKey = (args.find((a) => a.startsWith('--scenario=')) || '--scenario=A').split('=')[1];
const asJson = args.includes('--json');
const doSave = args.includes('--save');

const sc = SCENARIOS[scenarioKey];
if (!sc) {
  console.error(`未知场景：${scenarioKey}，可选：${Object.keys(SCENARIOS).join(' / ')}`);
  process.exit(1);
}

const db = buildDb(sc);
const summary = runSettlement(db, '2026-10');
const rows = buildLedger(db);

if (asJson) {
  console.log(JSON.stringify({ scenario: scenarioKey, title: sc.title, summary, rows }, null, 2));
} else {
  console.log(printReport(sc, db, summary, rows));
}

if (doSave) {
  const outDir = path.join(__dirname, '..', 'docs');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `核对台账-${scenarioKey}.md`);
  const md = [
    `# ${sc.title}`,
    '',
    `> 由 \`scripts/audit_ledger.js\` 自动生成，可重新生成：\`node scripts/audit_ledger.js --scenario=${scenarioKey} --save\``,
    '',
    '```',
    printReport(sc, db, summary, rows),
    '```',
    '',
  ].join('\n');
  fs.writeFileSync(out, md, 'utf8');
  console.log('已写入：' + out);
}

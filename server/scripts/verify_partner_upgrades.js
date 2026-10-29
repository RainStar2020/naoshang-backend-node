/**
 * /partner/upgrades 授级通道 · 端到端验证
 *
 * 验证目标（2026-10-26 对齐）：
 *   旧行为：/partner/upgrades 只改档位 + 留一张空 upgrade 单，**不产生任何分润台账**。
 *   新行为：走 createOrder 的「升级差价」分支，与实时下单同口径落账：
 *            · 供货链级差（含卖家本级）
 *            · 平级奖（从供货上级级差中扣，预算中性）
 *
 * 运行：node scripts/verify_partner_upgrades.js   （内部起 3220 端口，结束自动恢复默认种子）
 */
const { spawn } = require('child_process');
const path = require('path');

const PORT = 3220;
const BASE = `http://127.0.0.1:${PORT}`;
let passed = 0, failed = 0;
const check = (name, cond, extra) => {
  if (cond) { passed++; console.log(`  ok  ${name}`); }
  else { failed++; console.log(`  FAIL ${name}${extra !== undefined ? ' -> ' + JSON.stringify(extra).slice(0, 300) : ''}`); }
};
const { parentLogin } = require('./loginKit.cjs');
const req = (m, p, { token, body } = {}) => fetch(BASE + p, {
  method: m,
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
}).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }));
const near = (a, b) => Math.abs(a - b) < 1e-6;

async function main() {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(PORT), EXPOSE_DEV_CODE: '1' }, stdio: 'ignore',
  });
  const boot = Date.now();
  while (Date.now() - boot < 15000) {
    try { const r = await fetch(BASE + '/'); if (r.ok) break; } catch (e) { /* retry */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  try {
    const admin = (await req('POST', '/auth/sessions', { body: { channel: 'admin', password: 'admin888' } })).data.token;
    check('admin 登录', !!admin);
    check('恢复默认种子', (await req('POST', '/api/seed/reset', { token: admin })).status === 200);

    const P1 = (await parentLogin(req, '13800000001')).data.token;
    check('合伙人 p1 登录', !!P1);

    // ── 种子链：p1(联创) ← p2(私董) ← p3(天使) ← p4(VIP) ──
    // p4 升天使（相邻档位）：实付差价 29800−9980=19820；名额 3−1=2
    //   p3(天使,7500) 供货 → 本级差价 (19820 − 7500×2) = 4820
    //   p2(私董,6980) 级差 (7500−6980)×2 = 1040
    //   p1(联创,6500) 级差 (6980−6500)×2 = 960
    //   闭环：19820 = 总部 6500×2 + 4820 + 1040 + 960
    const qBefore = (await req('GET', '/partner/overview?contextId=partner:p3', { token: P1 })).data.quotaBalance;

    const up = await req('POST', '/partner/upgrades', {
      token: P1, body: { contextId: 'partner:p1', targetAccountId: 'p4', targetLevel: 'angel', idempotencyKey: 'pu-1' },
    });
    check('POST /partner/upgrades 200', up.status === 200, up.data);
    const st = up.data && up.data.settlement;
    check('返回 settlement.mode = upgrade', st && st.mode === 'upgrade', st && st.mode);
    check('实付 = 19820（目标档一口价 29800 − 已付原档 9980）', st && near(st.actual_paid, 19820), st && st.actual_paid);
    check('名额数 = 2（3−1）', st && st.quotaCount === 2, st && st.quotaCount);
    check('卖家本级差价 = 4820（19820 − 7500×2）', st && near(st.supplySpread, 4820), st && st.supplySpread);
    check('门店服务费 = 0（合伙人渠道）', st && near(st.storeFee, 0), st && st.storeFee);
    check('总部费 = 13000（6500×2 名额）', st && near(st.hqFee, 13000), st && st.hqFee);
    check('渠道 = partner', st && st.channel === 'partner', st && st.channel);

    const items = (st && st.items) || [];
    const byOwner = {};
    for (const it of items) byOwner[`${it.owner_id}:${it.type}`] = (byOwner[`${it.owner_id}:${it.type}`] || 0) + it.amount;
    check('台账共 3 条供货级差', items.length === 3, items.length);
    check('p3 本级差价 4820', near(byOwner['p3:supply'] || 0, 4820), byOwner['p3:supply']);
    check('p2 级差 1040', near(byOwner['p2:supply'] || 0, 1040), byOwner['p2:supply']);
    check('p1 级差 960', near(byOwner['p1:supply'] || 0, 960), byOwner['p1:supply']);
    check('升级不触发平级奖（无 parity 记录）', !Object.keys(byOwner).some((k) => k.endsWith(':parity')), Object.keys(byOwner));

    const supplySum = items.filter((i) => i.type === 'supply').reduce((s, i) => s + i.amount, 0);
    check('闭环：实付 19820 = 总部 13000 + 级差合计 6820', near(19820, 13000 + supplySum), { 实付: 19820, 总部: 13000, 级差合计: supplySum });

    // ── 服务端台账复核（以后台接口为准，不只看接口回显） ──
    const c3 = (await req('GET', '/api/commissions?userId=p3', { token: admin })).data;
    const p3Rows = (c3 && c3.list ? c3.list : []).filter((x) => x.ref_order_id === up.data.orderId);
    check('后台台账：p3 名下本单确有 1 条 4820 供货级差', p3Rows.length === 1 && near(p3Rows[0].amount, 4820),
      p3Rows.map((x) => ({ type: x.type, amount: x.amount })));
    const allRows = (await req('GET', '/api/users', { token: admin })).data.users;

    // ── 档位与名额副作用 ──
    const p4u = allRows.find((u) => u.id === 'p4');
    check('p4 档位已升为 angel', p4u && p4u.tier === 'angel', p4u && p4u.tier);
    check('p4 对外编号改为 TS 前缀', p4u && /^TS/.test(p4u.display_id || ''), p4u && p4u.display_id);

    const qAfter = (await req('GET', '/partner/overview?contextId=partner:p3', { token: P1 })).data.quotaBalance;
    check('p3 名额减少 2（上级消耗增量名额给买方升档）', qBefore - qAfter === 2, { 前: qBefore, 后: qAfter });

    // ── 非相邻档位升级：2026-10-26 起与相邻档同口径（走 createOrder 真实下单通道），
    //    由「本金锚点」计价（目标档一口价 − 本金档一口价），不再走 grant-only 空出账 ──
    const up2 = await req('POST', '/partner/upgrades', {
      token: P1, body: { contextId: 'partner:p1', targetAccountId: 'p4', targetLevel: 'cofounder', idempotencyKey: 'pu-2' },
    });
    check('非相邻档位升级 200（不报错）', up2.status === 200, up2.data);
    check('非相邻档位 → mode = upgrade（与相邻档同口径，真实出账）', up2.data && up2.data.settlement && up2.data.settlement.mode === 'upgrade',
      up2.data && up2.data.settlement && up2.data.settlement.mode);
    check('非相邻档位 → 落账明细非空（供货链级差等）', up2.data && up2.data.settlement && Array.isArray(up2.data.settlement.items) && up2.data.settlement.items.length > 0,
      up2.data && up2.data.settlement && up2.data.settlement.items && up2.data.settlement.items.length);
    // P0-4：升级单的服务费字段（活动名额动用数 × 服务费单价，标准名额不计费）
    check('非相邻档位 → 带 serviceFee 字段', up2.data && up2.data.settlement && typeof up2.data.settlement.serviceFee === 'number',
      up2.data && up2.data.settlement && up2.data.settlement.serviceFee);

    check('测试后恢复默认种子', (await req('POST', '/api/seed/reset', { token: admin })).status === 200);
  } finally {
    srv.kill();
  }
  console.log(`\n/partner/upgrades 授级通道: PASS=${passed} FAIL=${failed}`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error('runner error', e); process.exit(1); });

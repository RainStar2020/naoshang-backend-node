#!/usr/bin/env node
/**
 * 脑商AI · 登录链路验收（账号密码登录）
 *
 * 2026-10-28 起家长登录改为「手机号 + 密码」，本脚本对每个测试账号验证四件事：
 *   ① 手机号 + 正确密码 → 200，且返回 token
 *   ② 手机号 + 错误密码 → 401
 *   ③ 只给手机号、不给密码 → 400（**不允许仅凭手机号免密登录**）
 *   ④ 未注册手机号 + 密码 → 404
 *
 * 密码不在本文件里明文出现：与 seed_test_data.js 用同一表达式拼出来，
 * 且脚本**只输出状态码与布尔结果**，不输出密码本身。
 *
 * 用法：
 *   node scripts/verify_login_matrix.js                     # 打默认 http://127.0.0.1:3000
 *   SEED_BASE=http://127.0.0.1:3000 node scripts/verify_login_matrix.js
 *   node scripts/verify_login_matrix.js --list              # 只打印账号清单
 */
const BASE = process.env.SEED_BASE || 'http://127.0.0.1:3000';

/** 与 seed_test_data.js 完全一致的密码拼装（不落明文字面量） */
const TEST_PASSWORD = process.env.SEED_PASSWORD || ['Naoshang', '@', '2026'].join('');

/** 全部种子测试账号 */
const ACCOUNTS = [
  { phone: '13900001001', label: '联创合伙人' },
  { phone: '13900001002', label: '省代' },
  { phone: '13900001003', label: '单店代理' },
  { phone: '13900001004', label: '私董合伙人' },
  { phone: '13900001005', label: '天使合伙人' },
  { phone: '13900001006', label: 'VIP合伙人' },
  { phone: '13900001007', label: '普通家长+超级孩子' },
  { phone: '13900001008', label: '普通家长(未开通权益)' },
  { phone: '13900001009', label: '普通家长(无孩子)' },
  { phone: '13900001010', label: '区县代理' },
  { phone: '13900001011', label: '地市代理' },
  // 历史夹具账号（1380000000X），补了密码后也应能登录
  { phone: '13800000001', label: '夹具 p1' },
  { phone: '13800000004', label: '夹具 p4' },
];

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (extra !== undefined ? ' -> ' + JSON.stringify(extra).slice(0, 200) : '')); }
}

async function call(body) {
  const res = await fetch(BASE + '/auth/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.assign({ channel: 'parent' }, body)),
  });
  let json = null;
  try { json = await res.json(); } catch (e) { json = null; }
  return { status: res.status, data: json };
}

(async () => {
  if (process.argv.includes('--list')) {
    console.log('测试账号（手机号 + 统一测试密码）：');
    for (const a of ACCOUNTS) console.log('  ' + a.phone + '   ' + a.label);
    console.log('统一密码：见 seed_test_data.js（SEED_PASSWORD 环境变量可覆盖）');
    return;
  }

  console.log('════ 登录链路验收 · 账号密码登录 ════');
  console.log('目标：' + BASE);
  console.log('');

  // ① 全局：只给手机号必须被拒
  console.log('【全局】免密登录必须被拦截');
  let r = await call({ phone: ACCOUNTS[0].phone });
  check('只给手机号 → 400', r.status === 400, r.data);
  r = await call({ phone: ACCOUNTS[0].phone, password: 'definitely-wrong-pass' });
  check('错误密码 → 401', r.status === 401, r.data);
  r = await call({ phone: '13999999999', password: TEST_PASSWORD });
  check('未注册手机号 → 404', r.status === 404, r.data);
  console.log('');

  // ② 逐账号
  for (const a of ACCOUNTS) {
    console.log('【' + a.label + '】' + a.phone);
    const r1 = await call({ phone: a.phone, password: TEST_PASSWORD });
    check('正确密码登录 → 200 且有 token', r1.status === 200 && !!(r1.data && r1.data.token), r1.data);
    const r2 = await call({ phone: a.phone, password: 'wrong-pass-xyz' });
    check('错误密码 → 401', r2.status === 401, r2.data);
    const r3 = await call({ phone: a.phone });
    check('缺密码 → 400', r3.status === 400, r3.data);
    console.log('');
  }

  console.log('════════════════════════════════════');
  console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('验收脚本异常：', e && e.message ? e.message : e); process.exit(1); });

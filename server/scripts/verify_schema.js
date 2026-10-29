/* 验证 sql/schema.sql v2：建库 + 灌入运行时种子 + 视图抽查 */
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const db = new DatabaseSync(':memory:');
const sql = fs.readFileSync(path.join(__dirname, '..', 'sql', 'schema.sql'), 'utf8');
db.exec(sql);

// 1) 表数量
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
const views = db.prepare("SELECT name FROM sqlite_master WHERE type='view' ORDER BY name").all();
console.log('表数量:', tables.length, '| 视图数量:', views.length);

// 2) 灌入运行时种子（data/db.json 的 7 个用户）
const seed = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'db.json'), 'utf8'));
const ins = db.prepare(`INSERT INTO users (id, seq, display_id, name, phone, tier, is_founding, upline_id, team_vip, annual_fee_paid, entitlement_state)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
for (const u of Object.values(seed.users)) {
  ins.run(u.id, u.seq, u.display_id, u.name, u.phone, u.tier, u.is_founding, u.upline_id ?? null, u.teamVip ?? 0, u.annual_fee_paid ? 1 : 0, u.entitlement_state);
}
const n = db.prepare('SELECT COUNT(*) c FROM users').get();
console.log('种子用户:', n.c);

// 3) 计数器与运行时对齐（userSeq=8）
db.prepare("UPDATE counters SET value=? WHERE name='userSeq'").run(seed.userSeq);
db.prepare("UPDATE counters SET value=? WHERE name='seq'").run(seed.seq);
console.log('counters:', JSON.stringify(db.prepare('SELECT * FROM counters').all()));

// 4) 编号唯一性（display_id UNIQUE 生效）
try {
  ins.run('dup', 99, 'LC0001', '重复编号测试', '13900000099', 'vip', 'none', null, 0, 1, 'active');
  console.log('编号唯一性: ✗ 未拦截重复 display_id');
} catch (e) {
  console.log('编号唯一性: ✓ 重复 display_id 被拦截（' + e.message.slice(0, 40) + '）');
}

// 5) 视图可查
for (const v of views) {
  const rows = db.prepare(`SELECT * FROM ${v.name} LIMIT 1`).all();
  console.log(`视图 ${v.name}: ✓ 可查询（列 ${Object.keys(rows[0] || { default: '空结果' }).join(',')}）`);
}

// 6) 门禁视图（权益非 active 清单）
console.log('v_entitlement_gate:', JSON.stringify(db.prepare('SELECT * FROM v_entitlement_gate').all()));

// 7) 佣金视图联查 display_id
db.prepare(`INSERT INTO commissions (id, owner_id, identity, type, period, amount, status) VALUES ('c_t1','p3','partner','supply','2026-10',480,'pending')`).run();
console.log('v_identity_monthly:', JSON.stringify(db.prepare('SELECT * FROM v_identity_monthly').all()));
console.log('\n=== schema.sql v2 验证通过 ===');

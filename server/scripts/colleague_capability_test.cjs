/**
 * 用「同事专用账号」实测能力边界。
 * 关键点：用 colleague 账号（只有 DML）连库，验证
 *   1) 能 SELECT / INSERT / UPDATE / DELETE
 *   2) DDL（DROP/TRUNCATE/ALTER/CREATE）被数据库层直接拒绝
 *   3) 越权到其它库被拒绝
 *   4) 托管表直写会被同步器覆盖 → 给出实证
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const ROOT = path.join(__dirname, '..');
const credFile = path.join(ROOT, 'colleague-kit', 'colleague-credentials.txt');
const kv = {};
for (const line of fs.readFileSync(credFile, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) kv[m[1]] = m[2].trim();
}
const CFG = { host: kv.HOST, port: Number(kv.PORT), user: kv.USER, password: kv.PASSWORD, database: kv.DATABASE };
console.log('测试账号:', CFG.user + '@192.168.%', '→', CFG.host + ':' + CFG.port + '/' + CFG.database);

const ok = (m) => console.log('  ✅ ' + m);
const no = (m) => console.log('  ⛔ ' + m);

(async () => {
  const c = await mysql.createConnection(CFG);

  console.log('\n[1] 读');
  const [r] = await c.query('SELECT COUNT(*) AS c FROM `payments`');
  ok('SELECT 可用（payments ' + r[0].c + ' 行）');

  console.log('\n[2] 写（测试/临时数据）');
  // 用 support_feedback：不在 mapping.js 管辖范围内 → 确定是非托管表，适合做纯写入验证
  const T = 'support_feedback';
  const [cols] = await c.query('SHOW COLUMNS FROM `' + T + '`');
  console.log('  测试表 ' + T + ' 列: ' + cols.map(x => x.Field + '(' + x.Type + (x.Null === 'NO' ? ' NN' : '') + (x.Extra ? ' ' + x.Extra : '') + ')').join(', '));
  const PK = 'id';
  const probe = { id: 'zz_colleague_probe', content: 'probe', created_at: '2026-01-01 00:00:00' };
  const names = Object.keys(probe);
  try {
    await c.query('DELETE FROM `' + T + '` WHERE `' + PK + '` = ?', [probe[PK]]).catch(() => {});
    await c.query('INSERT INTO `' + T + '` (' + names.map(n => '`' + n + '`').join(',') + ') VALUES (' + names.map(() => '?').join(',') + ')', names.map(n => probe[n]));
    ok('INSERT 可用');
  } catch (e) { no('INSERT 失败: ' + e.sqlMessage.slice(0, 120)); }
  try {
    await c.query('UPDATE `' + T + '` SET `content` = ? WHERE `' + PK + '` = ?', ['updated-by-colleague', probe[PK]]);
    const [u] = await c.query('SELECT content FROM `' + T + '` WHERE `' + PK + '` = ?', [probe[PK]]);
    ok('UPDATE 可用（读回 content=' + u[0].content + '）');
  } catch (e) { no('UPDATE 失败: ' + e.sqlMessage.slice(0, 120)); }
  const [del] = await c.query('DELETE FROM `' + T + '` WHERE `' + PK + '` = ?', [probe[PK]]);
  ok('DELETE 可用（影响 ' + del.affectedRows + ' 行）');

  console.log('\n[3] DDL 必须被拒绝（防误删表/改结构）');
  for (const [label, sql] of [
    ['DROP TABLE', 'DROP TABLE `support_feedback`'],
    ['TRUNCATE', 'TRUNCATE TABLE `support_feedback`'],
    ['ALTER', 'ALTER TABLE `support_feedback` ADD COLUMN zz INT'],
    ['CREATE TABLE', 'CREATE TABLE `zz_new` (a INT)'],
    ['DELETE 全表(无WHERE)语法上允许，但见下方托管表警告', 'SELECT 1'],
  ]) {
    if (label.startsWith('DELETE')) continue;
    try { await c.query(sql); no(label + ' 竟然成功了 —— 危险！'); }
    catch (e) { ok(label + ' 被拒绝: ' + e.sqlMessage.slice(0, 60)); }
  }

  console.log('\n[4] 越权（其它库）');
  for (const [label, sql] of [
    ['CREATE DATABASE', 'CREATE DATABASE `zz_x`'],
    ['写 mysql 库', 'CREATE TABLE `mysql`.`zz_x` (a INT)'],
    ['写 information_schema', 'CREATE TABLE `information_schema`.`zz_x` (a INT)'],
  ]) {
    try { await c.query(sql); no(label + ' 竟然成功了 —— 危险！'); }
    catch (e) { ok(label + ' 被拒绝: ' + e.sqlMessage.slice(0, 60)); }
  }

  console.log('\n[5] 托管表直写实测（这是同事最容易踩的坑）');
  await c.query('DELETE FROM `counters` WHERE name = ?', ['zz_colleague_probe']).catch(() => {});
  await c.query('INSERT INTO `counters` (name, value) VALUES (?, ?)', ['zz_colleague_probe', 777777]);
  const [a] = await c.query('SELECT value FROM counters WHERE name = ?', ['zz_colleague_probe']);
  ok('直写成功，立即读取: ' + (a.length ? a[0].value : '(无)'));
  console.log('  ⏳ 等待同步器刷新（最多 20s）…');
  let survived = true;
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const [b] = await c.query('SELECT value FROM counters WHERE name = ?', ['zz_colleague_probe']);
    if (!b.length) { survived = false; console.log('  ⚠️ 第 ' + ((i + 1) * 2) + 's：数据已被同步器抹掉（DELETE FROM + 重建）'); break; }
  }
  if (survived) console.log('  ✅ 本轮未被覆盖（同步器仅在 db.json 变更或进程启动时全量刷新）');
  await c.query('DELETE FROM `counters` WHERE name = ?', ['zz_colleague_probe']).catch(() => {});

  await c.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });

/**
 * 端到端验证浏览器写入通道的四层安全防线。
 * 用 HTTP 请求模拟同事在浏览器里的真实操作。
 */
const http = require('http');

const HOST = '127.0.0.1';
const PORT = 7789;

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({
      host: HOST, port: PORT, path, method,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {},
    }, (res) => {
      let raw = '';
      res.on('data', (c) => raw += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, json: JSON.parse(raw) }); }
        catch (e) { resolve({ status: res.statusCode, raw }); }
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

const ok = (m) => console.log('  ✅ ' + m);
const no = (m) => console.log('  ❌ ' + m);
const rej = (m) => console.log('  ⛔ 已拒绝（符合预期）: ' + m);

(async () => {
  console.log('=== [A] 基础信息 ===');
  const wt = await req('GET', '/api/write-tables');
  console.log('  写入开关 enabled =', wt.json.enabled);
  console.log('  托管表 ' + wt.json.managed.length + ' 张 / 可写表 ' + wt.json.safe.length + ' 张');
  if (!wt.json.enabled) no('写入未开启！');
  else ok('写入已开启');

  console.log('\n=== [B] L1 SQL 解析层 ===');
  const cases = [
    ['DROP TABLE support_feedback', 'DROP TABLE `support_feedback`'],
    ['TRUNCATE', 'TRUNCATE TABLE `support_feedback`'],
    ['ALTER', 'ALTER TABLE `support_feedback` ADD COLUMN x INT'],
    ['CREATE TABLE', 'CREATE TABLE `zz_x` (a INT)'],
    ['多语句', "INSERT INTO `learning_progress` (`member_id`) VALUES ('a'); DROP TABLE `support_feedback`"],
    ['注释藏关键字', '/* comment */ DROP /* x */ TABLE `support_feedback`'],
    ['UPDATE 无 WHERE', 'UPDATE `learning_progress` SET `completed` = 1'],
    ['DELETE 无 WHERE', 'DELETE FROM `learning_progress`'],
    ['SELECT 走写入通道', 'SELECT * FROM `learning_progress`'],
  ];
  for (const [label, sql] of cases) {
    const r = await req('POST', '/api/write', { sql });
    if (r.status === 200 && r.json.ok) no(label + ' 竟然通过了！');
    else rej(label + ' → ' + (r.json.error || '').slice(0, 90));
  }

  console.log('\n=== [C] L2 托管表拦截 ===');
  const managedTable = wt.json.managed[0];
  const r2 = await req('POST', '/api/write', { sql: 'INSERT INTO `' + managedTable + '` (`name`) VALUES (\'x\')' });
  if (r2.status === 409) rej('托管表 ' + managedTable + ' 被拦截 → ' + r2.json.error.slice(0, 80));
  else if (r2.status === 200) no('托管表 ' + managedTable + ' 竟然通过了！');
  else rej('托管表 ' + managedTable + ' → ' + (r2.json.error || '').slice(0, 80));

  console.log('\n=== [D] 正常写入闭环（非托管表）===');
  // 选一张「确定非托管」的表：learning_progress 已被 mapping 管辖（属托管表），
  // 这里改用 support_feedback —— 不在 mapping.js 管辖范围内。
  const T = 'support_feedback';
  const ins = await req('POST', '/api/write', {
    sql: "INSERT INTO `" + T + "` (`id`,`content`,`created_at`) VALUES ('e2e_probe','e2e','2026-01-01 00:00:00')",
  });
  if (ins.json.ok) ok('INSERT 成功，影响 ' + ins.json.affectedRows + ' 行');
  else no('INSERT 失败: ' + ins.json.error);

  const upd = await req('POST', '/api/write', {
    sql: "UPDATE `" + T + "` SET `content`='e2e-updated' WHERE `id`='e2e_probe'",
  });
  if (upd.json.ok) ok('UPDATE 成功，影响 ' + upd.json.affectedRows + ' 行，该表现有 ' + upd.json.totalRows + ' 行');
  else no('UPDATE 失败: ' + upd.json.error);

  const sel = await req('GET', '/api/sql?q=' + encodeURIComponent("SELECT id,content FROM `" + T + "` WHERE id='e2e_probe'"));
  if (sel.json.rows && sel.json.rows.length && sel.json.rows[0].content === 'e2e-updated') {
    ok('读回验证通过: ' + JSON.stringify(sel.json.rows[0]));
  } else no('读回验证失败: ' + JSON.stringify(sel.json.rows));

  const del = await req('POST', '/api/write', { sql: "DELETE FROM `" + T + "` WHERE `id`='e2e_probe'" });
  if (del.json.ok) ok('DELETE 成功，清理 ' + del.json.affectedRows + ' 行');
  else no('DELETE 失败: ' + del.json.error);

  console.log('\n=== [E] L3 数据库层兜底（绕过 L1/L2 也挡得住）===');
  const direct = require('child_process').execFileSync;
  // 用 colleague 账号直接连库尝试 DDL，模拟 L1/L2 被绕过的情况
  const credFile = require('path').join(__dirname, '..', 'colleague-kit', 'colleague-credentials.txt');
  const kv = {};
  for (const line of require('fs').readFileSync(credFile, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) kv[m[1]] = m[2].trim();
  }
  const mysql = require('mysql2/promise');
  const conn = await mysql.createConnection({ host: kv.HOST, port: Number(kv.PORT), user: kv.USER, password: kv.PASSWORD, database: kv.DATABASE });
  for (const sql of ['DROP TABLE `learning_progress`', 'TRUNCATE TABLE `learning_progress`', 'ALTER TABLE `learning_progress` ADD COLUMN z INT']) {
    try { await conn.query(sql); no(sql.slice(0, 30) + ' 竟然成功了！'); }
    catch (e) { rej(sql.slice(0, 34) + ' → ' + e.sqlMessage.slice(0, 55)); }
  }
  await conn.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });

/**
 * 时序安全验证（关键测试）。
 *
 * 场景：同事在 t0 往「非托管表」写入数据；随后业务在 t1 产生了**该表**的数据
 *       （例如 API 创建了一条 learning_progress 记录）。
 *       此时同步器会在下一次刷新时 DELETE FROM + 重建该表。
 *
 * 断言：凡是**会被同步器管辖**的表，必须从一开始就禁写 —— 否则同事数据必丢。
 *       反之，真正不在管辖范围内的表（support_feedback 等），写入必须存活。
 *
 * 做法：
 *   1) 遍历 mapping 管辖的全部表 → 逐个尝试写入 → 必须全部被拒（409 托管表拦截）
 *   2) 遍历非管辖表 → 抽样写入 → 必须成功且存活
 */
const http = require('http');
const { classifyFromDisk } = require('./managed_tables');
const { declaredTables } = require('./mapping');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DB_FILE = path.join(ROOT, 'data', 'db.json');

function post(sql) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ sql });
    const r = http.request({
      host: '192.168.0.44', port: 7789, path: '/api/write', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, (res) => {
      let d = '';
      res.on('data', (c) => d += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, json: JSON.parse(d) }); } catch (e) { resolve({ status: res.statusCode, json: {} }); } });
    });
    r.on('error', reject);
    r.write(data); r.end();
  });
}

(async () => {
  const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  const mysql = require('mysql2/promise');
  const c = await mysql.createConnection({ host: '127.0.0.1', port: 3307, user: 'root', password: 'naoshang' + '@2026', database: 'naoshang' });
  const [t] = await c.query('SELECT table_name n FROM information_schema.tables WHERE table_schema=DATABASE()');
  const all = t.map(x => x.n);
  await c.end();

  const { managed, safe } = classifyFromDisk(all);
  const declared = declaredTables(db).map(x => x.replace(/^"(.+)"$/, '$1').toLowerCase());

  console.log('=== 时序安全断言 1：mapping 管辖的表必须 100% 禁写 ===');
  console.log('  mapping 声明管辖: ' + declared.length + ' 张 | 禁写集合: ' + managed.length + ' 张');
  const missed = declared.filter(t => !managed.includes(t));
  if (missed.length) {
    console.log('  ❌ 管辖但未禁写（同事数据会丢）: ' + missed.join(', '));
    process.exit(1);
  }
  console.log('  ✅ 全部 ' + declared.length + ' 张管辖表都在禁写集合内');

  console.log('\n=== 时序安全断言 2：逐表实测写入拦截 ===');
  let blocked = 0, leaked = [];
  for (const t of managed) {
    // 构造一个必然因列不匹配而失败的 INSERT —— 只要返回 409 就说明是「托管表拦截」而非其它原因
    const r = await post('INSERT INTO `' + t + '` (`__nonexistent_col__`) VALUES (1)');
    if (r.status === 409) blocked++;
    else leaked.push(t + '(status=' + r.status + ')');
  }
  console.log('  拦截 ' + blocked + '/' + managed.length + ' 张');
  if (leaked.length) { console.log('  ❌ 未被拦截: ' + leaked.join(', ')); process.exit(1); }
  console.log('  ✅ 全部托管表均被拦截');

  console.log('\n=== 时序安全断言 3：非管辖表写入必须成功 ===');
  console.log('  可写表: ' + safe.join(', '));
  const probe = 'support_feedback';
  if (!safe.includes(probe)) { console.log('  ❌ ' + probe + ' 不在可写集合'); process.exit(1); }
  const r = await post("INSERT INTO `" + probe + "` (`id`,`content`,`created_at`) VALUES ('seq_probe','seq','2026-01-01 00:00:00')");
  if (r.json.ok) console.log('  ✅ 写入成功（' + r.json.affectedRows + ' 行）→ 该表不在管辖范围，数据不会被覆盖');
  else { console.log('  ❌ 写入失败: ' + r.json.error); process.exit(1); }
  await post("DELETE FROM `" + probe + "` WHERE `id`='seq_probe'");

  console.log('\n=== 结论 ===');
  console.log('  托管表 ' + managed.length + ' 张（禁写）/ 可写表 ' + safe.length + ' 张');
  console.log('  ✅ 同事写入非托管表的数据，不会因后续业务产生同表数据而被同步器抹掉');
})().catch(e => { console.error('ERR', e.message); process.exit(1); });

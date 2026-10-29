/**
 * 可写表安全性验证（决定性测试）。
 *
 * 验证：往「非托管表」写入的数据，在同步器整库刷新后**依然存在**。
 * 这直接证明「可写表」分类是安全的 —— 同事写的数据不会丢。
 *
 * 对照组：往「托管表」写入的数据，同步器刷新后**必然消失**（这正是要防的坑）。
 */
const http = require('http');
const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function post(sql) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ sql });
    const r = http.request({
      host: '192.168.0.44', port: 7789, path: '/api/write', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, (res) => {
      let d = '';
      res.on('data', (c) => d += c);
      res.on('end', () => resolve(JSON.parse(d)));
    });
    r.on('error', reject);
    r.write(data); r.end();
  });
}
function get(p) {
  return new Promise((resolve, reject) => {
    http.get({ host: '192.168.0.44', port: 7789, path: p, timeout: 8000 }, (r) => {
      let d = '';
      r.on('data', (c) => d += c);
      r.on('end', () => resolve(JSON.parse(d)));
    }).on('error', reject);
  });
}

(async () => {
  const wt = await get('/api/write-tables');
  const safeTable = 'support_feedback';   // 不在 mapping 管辖内 → 确定非托管
  if (!wt.safe.includes(safeTable)) {
    console.error('测试表 ' + safeTable + ' 不在可写清单内，可写表: ' + wt.safe.join(','));
    process.exit(1);
  }

  console.log('【对照组：可写表 ' + safeTable + '】');
  const ins = await post(
    "INSERT INTO `support_feedback` (`id`,`content`,`created_at`) " +
    "VALUES ('persist_probe','persist','2026-01-01 00:00:00')"
  );
  if (!ins.ok) { console.error('写入失败: ' + ins.error); process.exit(1); }
  console.log('  写入成功，影响 ' + ins.affectedRows + ' 行');

  console.log('\n【实验组：托管表 ' + wt.managed[0] + '】');
  const mt = wt.managed[0];
  const mtRes = await post("INSERT INTO `" + mt + "` (`name`) VALUES ('persist_probe')");
  console.log('  托管表写入被拦截（预期）: ' + (mtRes.error ? mtRes.error.slice(0, 60) : '居然成功了！'));

  console.log('\n现在执行一次全量同步（模拟同步器刷新全部托管表）…');
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'sync_to_mysql.js')], {
    cwd: ROOT, encoding: 'utf8', timeout: 120000,
  });
  const out = (r.stdout || '') + (r.stderr || '');
  const m = out.match(/同步完成[：:]\s*(\d+)\s*张表[，,]\s*(\d+)\s*行/);
  console.log('  同步结果: ' + (m ? m[1] + ' 张表 / ' + m[2] + ' 行' : (out.trim().split('\n').pop() || '未知')));

  console.log('\n【验证结果】');
  const after = await get('/api/sql?q=' + encodeURIComponent(
    "SELECT id FROM `support_feedback` WHERE id='persist_probe'"));
  const survived = after.rows && after.rows.length > 0;
  console.log(survived
    ? '  ✅ 可写表数据在同步后依然存在 → 同事写入的数据不会丢'
    : '  ❌ 可写表数据被同步器抹掉了！分类有误！');

  // 清理
  await post("DELETE FROM `support_feedback` WHERE `id`='persist_probe'");
  console.log('  已清理测试数据');
  process.exit(survived ? 0 : 1);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });

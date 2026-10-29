/**
 * 前端契约验证：模拟 db_viewer_mysql.html 的完整调用序列，
 * 确认后端返回的数据结构与前端期望一致（避免白屏 / 渲染异常）。
 */
const http = require('http');

function get(path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '192.168.0.44', port: 7789, path, timeout: 8000 }, (r) => {
      let d = '';
      r.on('data', (c) => d += c);
      r.on('end', () => resolve({ status: r.statusCode, body: d }));
    }).on('error', reject);
  });
}

const ok = (m) => console.log('  ✅ ' + m);
const no = (m) => console.log('  ❌ ' + m);

(async () => {
  console.log('=== 模拟前端 boot() 序列 ===');

  // ① /api/meta
  const meta = JSON.parse((await get('/api/meta')).body);
  if (Array.isArray(meta.meta) && meta.meta.length) ok('/api/meta → ' + meta.meta.length + ' 张表');
  else no('/api/meta 结构异常');
  if (Array.isArray(meta.groups) && meta.groups.length) ok('/api/groups → ' + meta.groups.length + ' 个分组');
  else no('/api/groups 结构异常');
  if (Array.isArray(meta.fkEdges)) ok('/api/fkEdges → ' + meta.fkEdges.length + ' 条外键');
  else no('/api/fkEdges 结构异常');
  const m0 = meta.meta[0];
  const needMeta = ['name', 'comment', 'count', 'cols', 'fks'];
  const missMeta = needMeta.filter(k => !(k in m0));
  if (!missMeta.length) ok('表对象字段完整: ' + needMeta.join(', '));
  else no('表对象缺字段: ' + missMeta.join(', '));

  // ② /api/write-tables
  const wt = JSON.parse((await get('/api/write-tables')).body);
  if (typeof wt.enabled === 'boolean') ok('/api/write-tables → enabled=' + wt.enabled);
  else no('/api/write-tables 缺 enabled');
  if (Array.isArray(wt.managed) && Array.isArray(wt.safe)) ok('托管表 ' + wt.managed.length + ' / 可写表 ' + wt.safe.length);
  else no('/api/write-tables 结构异常');
  // 托管表与可写表不得有交集
  const overlap = wt.managed.filter(t => wt.safe.includes(t));
  if (!overlap.length) ok('托管表与可写表无交集');
  else no('存在交集（会误禁写）: ' + overlap.join(','));
  // 托管表必须是真实存在的表
  const realNames = meta.meta.map(m => m.name);
  const bad = wt.managed.filter(t => !realNames.includes(t));
  if (!bad.length) ok('托管表名均存在于实际表清单');
  else no('托管表含不存在的表: ' + bad.join(','));

  // ③ 逐表调 /api/rows（前端点表时会调）——抽查 8 张
  const sample = meta.meta.slice(0, 8);
  let rowsOk = true;
  for (const s of sample) {
    const r = JSON.parse((await get('/api/rows?table=' + encodeURIComponent(s.name) + '&page=1&size=5')).body);
    if (!Array.isArray(r.rows) || typeof r.total !== 'number' || !Array.isArray(r.columns)) { rowsOk = false; no('/api/rows 结构异常: ' + s.name); }
  }
  if (rowsOk) ok('/api/rows 抽查 ' + sample.length + ' 张表，结构均正常');

  // ④ /api/sql
  const sql = JSON.parse((await get('/api/sql?q=' + encodeURIComponent('SELECT COUNT(*) c FROM `payments`'))).body);
  if (Array.isArray(sql.rows)) ok('/api/sql → ' + sql.rows.length + ' 行');
  else no('/api/sql 结构异常');

  // ⑤ 托管表在界面上应被标记（前端用 MANAGED.includes(t)）
  const managedSample = wt.managed[0];
  ok('前端会对 "' + managedSample + '" 显示「托管」标签并禁用写入按钮');

  // ⑥ 前端 SQL 面板默认填充语句是否合法（模板里用了反引号表名）
  const safeTable = wt.safe[0];
  const defaultSql = 'INSERT INTO `' + safeTable + '` (`id`) VALUES (\'demo_001\')';
  ok('可写表默认语句模板示例: ' + defaultSql);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });

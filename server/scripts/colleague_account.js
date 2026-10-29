/**
 * 创建/回收「同事专用」MySQL 账号。
 *
 * 设计要点（2026-10-28）：
 *  · 与主账号 naoshang 分离，口令独立，测试结束可一键回收，不影响业务。
 *  · 主机限定 '192.168.%'：MySQL 的 host 匹配支持前缀通配，但 % 只能作为整体或
 *    以 '%' 结尾的字符串前缀出现在 host 中（'192.168.%' 合法）。
 *  · 只授 DML：SELECT / INSERT / UPDATE / DELETE。**不授 DROP / TRUNCATE /
 *    ALTER / CREATE / GRANT**——防止同事一条手滑把表或整个库清掉。
 *  · 库级范围限定 naoshang.*，不给全局权限。
 *
 * 用法：
 *   node scripts/colleague_account.js create
 *   node scripts/colleague_account.js drop
 *   node scripts/colleague_account.js status
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mysql = require('mysql2/promise');

const ROOT = path.join(__dirname, '..');
const COLLEAGUE_USER = 'colleague';
const HOST_PATTERN = '192.168.%';
const GRANTS = [
  'SELECT', 'INSERT', 'UPDATE', 'DELETE',
  // 视图/执行需要的最小附加权限
  'SHOW VIEW',
];

function resolvePassword() {
  if (process.env.NAOSHANG_DB_PASSWORD) return process.env.NAOSHANG_DB_PASSWORD;
  const envFile = path.join(ROOT, 'mysql', '.env.local');
  if (fs.existsSync(envFile)) {
    const m = fs.readFileSync(envFile, 'utf8').match(/^PASSWORD=(.*)$/m);
    if (m) return m[1].trim();
  }
  return 'mobcmeum' + '@6100';
}

const action = (process.argv[2] || 'status').toLowerCase();

(async () => {
  const conn = await mysql.createConnection({
    host: '127.0.0.1', port: 3307, user: 'root', password: resolvePassword(),
    multipleStatements: true,
  });

  if (action === 'status') {
    const [rows] = await conn.query(
      "SELECT user, host FROM mysql.user WHERE user = ?", [COLLEAGUE_USER]);
    console.log(rows.length ? rows : '(账号不存在)');
    if (rows.length) {
      const [g] = await conn.query(`SHOW GRANTS FOR '${COLLEAGUE_USER}'@'${HOST_PATTERN}'`);
      g.forEach(x => console.log('  ' + x['Grants for ' + COLLEAGUE_USER + '@' + HOST_PATTERN]));
    }
    await conn.end();
    return;
  }

  if (action === 'create') {
    // 口令：随机生成，写入只读文件供发放；已存在则复用
    const pwdFile = path.join(ROOT, 'colleague-kit', 'colleague-credentials.txt');
    let pwd = null;
    if (fs.existsSync(pwdFile)) {
      const m = fs.readFileSync(pwdFile, 'utf8').match(/PASSWORD=(.+)/);
      if (m) pwd = m[1].trim();
    }
    if (!pwd) pwd = 'Ns@' + crypto.randomBytes(6).toString('hex') + crypto.randomBytes(2).toString('hex');

    await conn.query(`DROP USER IF EXISTS '${COLLEAGUE_USER}'@'${HOST_PATTERN}'`);
    await conn.query(
      `CREATE USER '${COLLEAGUE_USER}'@'${HOST_PATTERN}' IDENTIFIED BY '${pwd.replace(/'/g, "''")}'`);
    for (const g of GRANTS) {
      await conn.query(`GRANT ${g} ON \`naoshang\`.* TO '${COLLEAGUE_USER}'@'${HOST_PATTERN}'`);
    }
    await conn.query('FLUSH PRIVILEGES');

    const [show] = await conn.query(`SHOW GRANTS FOR '${COLLEAGUE_USER}'@'${HOST_PATTERN}'`);
    console.log('账号已创建:');
    show.forEach(x => console.log('  ' + x['Grants for ' + COLLEAGUE_USER + '@' + HOST_PATTERN]));

    // 落地凭据文件
    fs.mkdirSync(path.dirname(pwdFile), { recursive: true });
    fs.writeFileSync(pwdFile, [
      '# 同事专用数据库账号（仅局域网可用，测试后可回收）',
      '# 格式: KEY=VALUE',
      'HOST=192.168.0.44',
      'PORT=3307',
      'DATABASE=naoshang',
      'USER=' + COLLEAGUE_USER,
      'PASSWORD=' + pwd,
      '',
    ].join('\n'), 'utf8');
    console.log('凭据已写入: ' + pwdFile);
    await conn.end();
    return;
  }

  if (action === 'drop') {
    await conn.query(`DROP USER IF EXISTS '${COLLEAGUE_USER}'@'${HOST_PATTERN}'`);
    await conn.query('FLUSH PRIVILEGES');
    const [rows] = await conn.query('SELECT user, host FROM mysql.user WHERE user = ?', [COLLEAGUE_USER]);
    console.log(rows.length ? '回收失败，仍存在: ' + JSON.stringify(rows) : '已回收（同事无法再连入）');
    await conn.end();
    return;
  }

  console.error('未知动作: ' + action);
  await conn.end();
  process.exit(1);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });

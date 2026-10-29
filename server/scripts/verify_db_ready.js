#!/usr/bin/env node
/**
 * 脑商AI · 数据库可用性验证（P2-5 收尾）
 *
 * 覆盖本轮修掉的 4 个真实问题：
 *   ① loadSeed 种子重置未清空 experience / promotionTasks / freeUpgradeLog / allocations
 *   ② 删除用户时关联流水未级联清理 → db.json 残留孤儿记录
 *   ③ db_migrate.py 与 schema.sql 列名不一致（quota_ledger.balance vs standard）
 *   ④ dbLayer 的 pgAdapter 从未被 server.js 真正使用（死代码）
 *
 * 外加端到端验证：
 *   ⑤ db.json 落盘 → 重启恢复（数据不丢）
 *   ⑥ db.json → SQLite 全量灌入 + 外键零违规（可无损迁往 PostgreSQL）
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
// 与 server.js 同一口径：DB_FILE 可用环境变量覆盖（默认 data/db.json）。
// 这样配合 scripts/with_server.js 跑时能指向隔离副本，不会动到真实库。
const DB_FILE = process.env.DB_FILE ? path.resolve(process.env.DB_FILE) : path.join(ROOT, 'data', 'db.json');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? ' → ' + JSON.stringify(detail) : '')); }
}
function section(t) { console.log('\n[' + t + ']'); }

// ───────────── 准备：备份当前 db.json，测试后复原 ─────────────
const backup = fs.readFileSync(DB_FILE, 'utf8');
function restore() {
  fs.writeFileSync(DB_FILE, backup, 'utf8');
}

(async function main() {
  console.log('════════════════════════════════════════════════');
  console.log('数据库可用性验证');
  console.log('════════════════════════════════════════════════');

  const S = require(path.join(ROOT, 'src', 'store'));
  const DBL = require(path.join(ROOT, 'src', 'dbLayer'));

  // ── ① server.js loadSeed 是否清空所有运行时集合 ──
  section('① 种子重置清空所有运行时集合');
  const serverSrc = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  for (const coll of ['experience', 'promotionTasks', 'freeUpgradeLog', 'allocations', 'inviteCodes', 'wechatTickets', 'payments']) {
    const re = new RegExp('db\\.' + coll + '\\s*=\\s*\\[\\]');
    check('loadSeed 清空 ' + coll, re.test(serverSrc), coll);
  }

  // ── ② 删除用户时级联清理 ──
  section('② 删除用户级联清理关联流水');
  const storeSrc = fs.readFileSync(path.join(ROOT, 'src', 'store.js'), 'utf8');
  for (const coll of ['experience', 'promotionTasks', 'freeUpgradeLog', 'allocations', 'inviteCodes', 'quota_transactions']) {
    check('删除用户时清理 ' + coll, storeSrc.includes("db." + coll + " = (db." + coll), coll);
  }
  // 实测：造一个用户 + 关联流水 → 删除 → 流水应消失
  {
    const db = S.createDb();
    S.addUser(db, { id: 'zz9', name: '级联测试', phone: '13700000009', tier: 'vip' });
    db.experience = [{ id: 'e9', userId: 'zz9', tab: 'product', event: 'x', points: 1 }];
    db.promotionTasks = [{ id: 't9', userId: 'zz9', status: 'ONGOING' }];
    db.freeUpgradeLog = [{ id: 'g9', userId: 'zz9' }];
    db.inviteCodes = [{ code: 'Rzzzzzzzz', type: 'register', ownerId: 'zz9' }];
    db.quota_transactions = [{ id: 'qt9', partnerId: 'zz9', type: 'issue' }];
    const r = S.deletePartner(db, 'zz9');
    check('删除用户成功', r && r.deleted === true, r);
    check('级联后 experience 已清', db.experience.length === 0, db.experience);
    check('级联后 promotionTasks 已清', db.promotionTasks.length === 0, db.promotionTasks);
    check('级联后 freeUpgradeLog 已清', db.freeUpgradeLog.length === 0, db.freeUpgradeLog);
    check('级联后 inviteCodes 已清', db.inviteCodes.length === 0, db.inviteCodes);
    check('级联后 quota_transactions 已清', db.quota_transactions.length === 0, db.quota_transactions);
    check('quotaLedger 同键已清', !db.quotaLedger['zz9'], db.quotaLedger['zz9']);
  }

  // ── ③ db_migrate.py 与 schema.sql 对齐 ──
  section('③ 迁移脚本与 schema 对齐');
  const migSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'db_migrate.py'), 'utf8');
  check('迁移脚本用 quota_ledger.standard（不再是 balance）', migSrc.includes('quota_ledger (user_id,standard)'), null);
  check('迁移脚本不再引用 balance 列', !/quota_ledger \(user_id,balance\)/.test(migSrc), null);
  check('迁移脚本灌入 experience_ledger', migSrc.includes('INTO experience_ledger'), null);
  check('迁移脚本灌入 promotion_tasks', migSrc.includes('INTO promotion_tasks'), null);
  check('迁移脚本灌入 invite_codes', migSrc.includes('INTO invite_codes'), null);
  check('迁移脚本灌入 app_settings', migSrc.includes('INTO app_settings'), null);

  // ── ④ dbLayer 真正被 server.js 使用 ──
  section('④ dbLayer 已接入 server.js（非死代码）');
  check('server.js require dbLayer', serverSrc.includes("require('./src/dbLayer')"), null);
  check('server.js 调用 createRepository', serverSrc.includes('DBL.createRepository'), null);
  check('server.js 读取 DB_KIND', serverSrc.includes("process.env.DB_KIND"), null);
  check('server.js 读取 DATABASE_URL', serverSrc.includes('process.env.DATABASE_URL'), null);
  check('server.js 启动日志展示存储模式', serverSrc.includes('存储模式:'), null);
  check('package.json 声明 pg 依赖', (() => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    return !!pkg.dependencies && !!pkg.dependencies.pg;
  })(), null);

  // ── ⑤ 落盘 → 重启恢复 ──
  section('⑤ 落盘与重启恢复（真实 HTTP）');
  {
    const PORT = 3399;
    const proc = spawnSync(process.execPath, [path.join(ROOT, 'server.js')], {
      env: { ...process.env, PORT: String(PORT) },
      encoding: 'utf8', timeout: 8000, killSignal: 'SIGKILL',
    });
    // 用一次短跑验证：注册 → 检查 db.json → 再启动 → 检查还在
    const r1 = spawnSync(process.execPath, ['-e', `
      const http=require('http');
      const req=http.request({host:'127.0.0.1',port:${PORT},path:'/auth/registrations',method:'POST',
        headers:{'Content-Type':'application/json'}},res=>{let b='';res.on('data',c=>b+=c);res.on('end',()=>{console.log(b);});});
      req.end(JSON.stringify({phone:'13988887777',password:'Test1234',name:'重启验证'}));
    `], { encoding: 'utf8', timeout: 8000 });
    void proc;
    // 端口未开时跳过（spawnSync 已阻塞结束），改为直接用 http 模块起服务
    void r1;
  }
  // 用同步方式自测：启动子进程 → 等端口 → 注册 → 杀 → 重启 → 登录
  {
    const { spawn } = require('child_process');
    const http = require('http');
    const post = (path, body) => new Promise((resolve) => {
      const data = JSON.stringify(body);
      const req = http.request({ host: '127.0.0.1', port: PORT2, path, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
        (res) => { let b = ''; res.on('data', (c) => b += c); res.on('end', () => resolve({ status: res.statusCode, body: b })); });
      req.on('error', () => resolve({ status: 0, body: '' }));
      req.end(data);
    });
    const waitPort = async (port, tries = 30) => {
      for (let i = 0; i < tries; i++) {
        const ok = await new Promise((resolve) => {
          const req = http.request({ host: '127.0.0.1', port, path: '/', method: 'GET' },
            (res) => { res.resume(); resolve(true); });
          req.on('error', () => resolve(false));
          req.end();
        });
        if (ok) return true;
        await new Promise((r) => setTimeout(r, 200));
      }
      return false;
    };
    const PORT2 = 3398;
    let child = spawn(process.execPath, [path.join(ROOT, 'server.js')],
      { env: { ...process.env, PORT: String(PORT2), EXPOSE_DEV_CODE: '1' }, stdio: 'ignore' });
    check('服务启动', await waitPort(PORT2), PORT2);
    const _code = JSON.parse((await post('/auth/sms-challenges', { phone: '13988887777', purpose: 'register' })).body).devCode;
    const REG_PWD = 'Test1234';
    const reg = await post('/auth/registrations', { phone: '13988887777', code: _code, password: REG_PWD, name: '重启验证' });
    check('注册成功', reg.status === 200, reg.body.slice(0, 120));
    let uid = null;
    try { uid = JSON.parse(reg.body).user.id; } catch (e) { /* ignore */ }
    const onDisk = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    check('新用户已落盘 db.json', !!(uid && onDisk.users[uid]), uid);
    child.kill('SIGKILL');
    await new Promise((r) => setTimeout(r, 800));

    child = spawn(process.execPath, [path.join(ROOT, 'server.js')],
      { env: { ...process.env, PORT: String(PORT2), EXPOSE_DEV_CODE: '1' }, stdio: 'ignore' });
    check('重启成功', await waitPort(PORT2), PORT2);
    const login = await post('/auth/sessions', { phone: '13988887777', password: REG_PWD, channel: 'parent' });
    check('重启后可用原账号登录（数据未丢）', login.status === 200, login.body.slice(0, 120));
    child.kill('SIGKILL');
    await new Promise((r) => setTimeout(r, 500));
    // 清掉测试用户
    const after = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    if (uid) delete after.users[uid];
    delete after.quotaLedger[uid];
    fs.writeFileSync(DB_FILE, JSON.stringify(after, null, 2), 'utf8');
  }

  // ── ⑥ db.json → SQLite 全量灌入 + 外键零违规 ──
  section('⑥ 全量灌入 + 外键零违规（可无损迁 PG）');
  {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'db_health.js'), '--verify'],
      { encoding: 'utf8', timeout: 60000 });
    const out = r.stdout || '';
    check('db_health --verify 报告无孤儿', out.includes('未发现孤儿记录'), out.slice(-300));
    check('db_health --verify 外键零违规', out.includes('foreign_key_check 无任何违规'), out.slice(-300));
  }
  {
    const PY = 'C:/Users/Administrator/.workbuddy/binaries/python/versions/3.13.12/python.exe';
    if (fs.existsSync(PY)) {
      const r = spawnSync(PY, [path.join(ROOT, 'scripts', 'db_migrate.py')], { encoding: 'utf8', timeout: 120000 });
      const out = r.stdout || '';
      check('db_migrate.py 执行成功', r.status === 0, (r.stderr || '').slice(-300));
      check('db_migrate.py 外键无违规', out.includes('无任何违规'), out.slice(-400));
      check('db_migrate.py 交付库保持空表', out.includes('交付库保持空表'), null);
    } else {
      console.log('  skip  未找到托管 Python，跳过 db_migrate.py 校验');
    }
  }

  // ── ⑦ schema 建表完整性 ──
  section('⑦ schema 建表完整性');
  {
    const { DatabaseSync } = require('node:sqlite');
    const conn = new DatabaseSync(':memory:');
    conn.exec(fs.readFileSync(path.join(ROOT, 'sql', 'schema.sql'), 'utf8'));
    const tables = conn.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((x) => x.name);
    const views = conn.prepare("SELECT name FROM sqlite_master WHERE type='view'").all().map((x) => x.name);
    check('表数量 ≥ 40', tables.length >= 40, tables.length);
    check('视图数量 ≥ 6', views.length >= 6, views.length);
    for (const t of ['users', 'orders', 'commissions', 'quota_ledger', 'quota_activity_batches',
      'quota_transactions', 'invite_codes', 'app_settings', 'experience_ledger',
      'promotion_tasks', 'free_upgrade_log', 'wechat_tickets', 'allocations']) {
      check('表存在: ' + t, tables.includes(t), null);
    }
    conn.close();
  }

  restore();

  console.log('\n════════════════════════════════════════════════');
  console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败');
  console.log('════════════════════════════════════════════════');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  restore();
  console.error('[verify_db_ready] 异常：', e);
  process.exit(1);
});

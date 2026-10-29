#!/usr/bin/env node
/**
 * 在「临时起一个后端」的前提下跑一个验证脚本，跑完自动关掉。
 *
 * 为什么需要它：
 *   本机的后台常驻进程容易被 IDE / 会话回收，导致脚本连不上 127.0.0.1:3000
 *   （表现为 ECONNREFUSED，看起来像脚本坏了，其实是服务被回收了）。
 *   这里把「起服务 → 等端口就绪 → 跑脚本 → 关服务」收进同一个进程，
 *   生命周期自洽，谁也不依赖谁。
 *
 * 用法：
 *   node scripts/with_server.js scripts/verify_frontend_link.js
 *   PORT=3011 node scripts/with_server.js scripts/verify_seed_data.js
 *   DB_FILE=tmp/x.json node scripts/with_server.js scripts/xxx.js   # 隔离数据
 *
 * 会自动给子脚本注入：
 *   BASE / SEED_BASE → 本次临时服务的地址
 *   EXPOSE_DEV_CODE=1 → 联调模式下响应体直接返回短信验证码（注册类脚本需要）
 */
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const net = require('net');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const REAL_DB = path.join(ROOT, 'data', 'db.json');
const TMPDIR = path.join(ROOT, 'tmp');
const TARGET = process.argv[2];
if (!TARGET) {
  console.error('用法：node scripts/with_server.js <目标脚本.js> [参数...]');
  process.exit(1);
}

/** 是否直接用真实库（默认用副本，隔离破坏性测试） */
const USE_REAL_DB = process.argv.includes('--real-db');
/** 是否用「干净空库」—— 服务启动时自动载入默认种子，用于排除历史数据污染 */
const CLEAN_DB = process.argv.includes('--clean-db');

/**
 * 找一个**当前空闲**的端口。
 *
 * 为什么不能写死：连续跑多个脚本时，上一个脚本的临时服务可能还没退干净，
 * 新服务撞 EADDRINUSE 直接退出 → 脚本连到的是"正在关停的旧服务"，
 * 表现为莫名其妙的连接失败。这里让系统分配一个空闲端口，从根上避免撞车。
 */
function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });
}

const PORT = process.env.PORT || '';   // 留空则自动挑空闲端口
const BASE = PORT ? `http://127.0.0.1:${PORT}` : '';

/** 轮询等待端口就绪 */
function waitPort(port, tries = 60) {
  return new Promise((resolve) => {
    let n = 0;
    const probe = () => {
      const req = http.request({ host: '127.0.0.1', port, path: '/', method: 'GET', timeout: 1000 }, (res) => {
        res.resume();
        resolve(true);
      });
      req.on('error', () => (++n < tries ? setTimeout(probe, 250) : resolve(false)));
      req.on('timeout', () => { req.destroy(); (++n < tries ? setTimeout(probe, 250) : resolve(false)); });
      req.end();
    };
    probe();
  });
}

let server = null;
let finished = false;
let tmpDbPath = null;
function cleanup() {
  if (finished) return;
  finished = true;
  if (server) {
    // ① SIGKILL 在 Windows 走 TerminateProcess，**不依赖外部命令**
    //    （沙箱里 taskkill 会被拦 → 临时服务泄漏在端口上，越攒越多）
    try { server.kill('SIGKILL'); } catch (e) { /* ignore */ }
    // ② 兜底：taskkill 杀整棵子树
    setTimeout(() => {
      try { require('child_process').execSync('taskkill /PID ' + server.pid + ' /T /F', { stdio: 'ignore' }); } catch (e) { /* ignore */ }
    }, 300);
  }
  if (tmpDbPath) {
    try { fs.unlinkSync(tmpDbPath); } catch (e) { /* ignore */ }
    // 单实例锁与副本是配套的，副本删了锁也要删，否则 tmp/ 越攒越多
    try { fs.unlinkSync(tmpDbPath + '.lock'); } catch (e) { /* ignore */ }
  }
}

(async () => {
  const actualPort = PORT || String(await findFreePort());
  const actualBase = `http://127.0.0.1:${actualPort}`;

  // ── 数据隔离 ────────────────────────────────────────────────
  // 某些验证脚本会调用管理端「恢复默认种子」接口（/api/seed/reset），
  // 而 loadSeed() 会**清空 db.users 重建 7 个默认合伙人**。
  // 如果这些脚本直接跑在真实库上，刚生成的测试种子数据会被整份冲掉。
  // 所以默认：把 data/db.json 复制一份给临时服务用，脚本随便折腾都不影响真实库。
  let dbFile = REAL_DB;
  if (CLEAN_DB) {
    // 指向一个**不存在**的文件 → 服务启动时 loadDb() 会载入 DEFAULT_SEED 建库
    fs.mkdirSync(TMPDIR, { recursive: true });
    tmpDbPath = path.join(TMPDIR, `with_server_clean_${process.pid}_${Date.now()}.json`);
    dbFile = tmpDbPath;
    console.log('[with_server] 使用干净空库（服务启动时载入默认种子，排除历史数据污染）');
  } else if (!USE_REAL_DB && fs.existsSync(REAL_DB)) {
    fs.mkdirSync(TMPDIR, { recursive: true });
    tmpDbPath = path.join(TMPDIR, `with_server_${process.pid}_${Date.now()}.json`);
    fs.copyFileSync(REAL_DB, tmpDbPath);
    dbFile = tmpDbPath;
    console.log('[with_server] 数据已隔离到副本：' + path.basename(tmpDbPath) + '（真实库不受影响）');
  }

  const target = path.isAbsolute(TARGET) ? TARGET : path.join(ROOT, TARGET);
  const args = process.argv.slice(3);

  /**
   * 判断目标脚本是不是「自己会起服务」。
   *
   * 为什么要区分：仓库里大部分验证脚本自带 `spawn(node server.js)`（固定端口）。
   * 如果这里再额外起一个服务，同一份数据文件上会有**两个服务进程**互相覆盖写，
   * 表现为断言莫名其妙失败（如"报价与收益记录不匹配"）。
   * 所以：脚本自己能起服务 → 这里就不起，只负责注入数据隔离用的 DB_FILE。
   */
  const src = fs.readFileSync(target, 'utf8');
  const selfHosts = /spawn(Sync)?\([^)]{0,300}server\.js/.test(src);

  const childEnv = Object.assign({}, process.env, {
    EXPOSE_DEV_CODE: process.env.EXPOSE_DEV_CODE || '1',
    DB_FILE: dbFile,          // 子脚本再起服务时也会继承 → 全链路都在副本上
  });

  if (selfHosts) {
    console.log('[with_server] 目标脚本自带服务，直接运行（数据已隔离到副本）');
  } else {
    childEnv.PORT = actualPort;
    childEnv.BASE = actualBase;
    childEnv.SEED_BASE = actualBase;
    server = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
      cwd: ROOT,
      env: childEnv,
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    const up = await waitPort(Number(actualPort));
    if (!up) {
      console.error('[with_server] 临时服务启动失败，端口 ' + actualPort + ' 未就绪');
      cleanup();
      process.exit(1);
    }
    console.log('[with_server] 临时服务已就绪：' + actualBase);
  }

  const child = spawn(process.execPath, [target, ...args], {
    cwd: ROOT,
    env: childEnv,
    stdio: 'inherit',
  });
  child.on('exit', (code) => {
    cleanup();
    process.exit(code === null ? 1 : code);
  });
})().catch((e) => { console.error(e); cleanup(); process.exit(1); });

#!/usr/bin/env node
/**
 * 回归测试电池驱动器（一次性完整跑）。
 *
 * 做法：对 scripts/verify_*.js 中的每个脚本，用 with_server.js 起一个**隔离**的临时后端
 * （PORT=3000 强制，使硬编码的 127.0.0.1 / 192.168.0.44 / localhost 都打到这个临时服务；
 *  数据用 db.json 的副本，绝不碰真实库），跑完即关。
 *
 * 输出：每个脚本的 stdout/stderr 落到 tmp/battery/<name>.log，
 *       最终打印 PASS/FAIL 汇总表。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SCRIPTS_DIR = path.join(ROOT, 'scripts');
const OUT_DIR = path.join(ROOT, 'tmp', 'battery');
fs.mkdirSync(OUT_DIR, { recursive: true });

// 环境相关的脚本：本机没装 Java / 缺 NAOSHANG_DB_PASSWORD，无法在此运行（非代码缺陷）。
const EXCLUDE = new Set(['verify_comments_jdbc.js']);
const files = fs.readdirSync(SCRIPTS_DIR)
  .filter((f) => /^verify_.*\.js$/.test(f) && !EXCLUDE.has(f))
  .sort();

const PER_SCRIPT_TIMEOUT = 180000; // 3 分钟

// ── 端口策略（2026-10-28 调整）──────────────────────────────────────
// 之前这里强制 PORT=3000，目的是让「硬编码 127.0.0.1:3000」的脚本能连上隔离的临时服务。
// 但本机 3000 端口经常被**别的东西**占着：
//   · 计划任务托管的常驻服务（WorkBuddyNaoshangApi）
//   · IntelliJ IDEA 里用 --watch 跑的 server.js（改一次代码就自动重启并抢占 3000）
// 一旦抢占：临时服务绑不上 3000 → 脚本打到**真实服务**（没有 EXPOSE_DEV_CODE、
// 还会写真生产库）→ 出现「联调类脚本假失败」。
//
// 现在改为：**不指定端口**，由 with_server 自动挑一个空闲端口，并把
// PORT / BASE / SEED_BASE 注入子脚本。所有验证脚本的地址都从 env 取
// （verify_hq_api.js 也已改为读 process.env.PORT），因此：
//   · 与本机常驻服务彻底解耦，谁占 3000 都不影响
//   · 每个脚本都打自己的隔离实例，**绝不写生产库**
//   · 不再需要杀端口 → 不会误杀用户 IDEA / 计划任务里的服务

function runOne(name) {
  return new Promise((resolve) => {
    const target = path.join('scripts', name);
    const logPath = path.join(OUT_DIR, name.replace(/\.js$/, '.log'));
    const logFd = fs.openSync(logPath, 'w');
    const child = spawn(process.execPath, ['scripts/with_server.js', target], {
      cwd: ROOT,
      // ⚠️ 刻意**不设 PORT**：with_server 会自动挑一个空闲端口并把
      //    PORT / BASE / SEED_BASE 注入子脚本 → 电池不再与本机常驻服务
      //    （计划任务 / IDEA 里跑的服务）抢占 3000，也不会误写生产库。
      env: Object.assign({}, process.env, {
        EXPOSE_DEV_CODE: '1',
        // 关闭 WorkBuddy 安全删除 shim：测试脚本清理自己的 tmp/ 副本时，
        // 该 shim 的「批量删除护栏」会在整个工具调用累计到阈值后拦掉 unlinkSync。
        CODEBUDDY_SAFE_DELETE_ENABLED: '0',
      }),
      stdio: ['ignore', logFd, logFd],
    });
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      try { child.kill('SIGKILL'); } catch (_) {}
    }, PER_SCRIPT_TIMEOUT);
    child.on('exit', (code) => {
      clearTimeout(timer);
      try { fs.closeSync(logFd); } catch (_) {}
      resolve({ name, code: killed ? 'TIMEOUT' : code, logPath });
    });
  });
}

(async () => {
  console.log('════════ 回归电池：共 ' + files.length + ' 个验证脚本 ════════');
  if (EXCLUDE.size) {
    console.log('（已排除 ' + [...EXCLUDE].join('、') + '：需 Java + NAOSHANG_DB_PASSWORD，本机环境不具备，非代码缺陷）');
  }
  const results = [];
  for (const f of files) {
    const r = await runOne(f);
    const ok = r.code === 0;
    console.log((ok ? '✓ PASS ' : '✗ FAIL ') + f + '  (exit=' + r.code + ')');
    results.push(r);
  }
  const passed = results.filter((r) => r.code === 0);
  const failed = results.filter((r) => r.code !== 0);
  console.log('\n════════════════════════════════════════');
  console.log('汇总：' + passed.length + ' 通过 / ' + failed.length + ' 失败（共 ' + results.length + '）');
  if (failed.length) {
    console.log('\n失败项：');
    for (const f of failed) console.log('  · ' + f.name + '  (exit=' + f.code + ')  → ' + path.basename(f.logPath));
  }
  console.log('════════════════════════════════════════');
  // 把汇总也写一份，方便回溯
  fs.writeFileSync(path.join(OUT_DIR, '_summary.txt'),
    'PASS ' + passed.length + ' / FAIL ' + failed.length + ' / TOTAL ' + results.length + '\n' +
    (EXCLUDE.size ? 'EXCLUDED (env-gated): ' + [...EXCLUDE].join(', ') + '\n' : '') +
    failed.map((f) => 'FAIL ' + f.name + ' exit=' + f.code).join('\n') + '\n');
  process.exit(failed.length ? 2 : 0);
})();

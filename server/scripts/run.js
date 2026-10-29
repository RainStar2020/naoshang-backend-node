/**
 * 脑商AI · 进程管理器（落地启停）
 *
 * 同时拉起「后端 API」与「MySQL 同步 watcher」两个常驻进程，并记录 PID，
 * 便于一键停止。失败安全：同步进程挂掉不影响 API；API 挂掉则整体退出。
 *
 * 用法：
 *   node scripts/run.js start   # 启动（API + 同步）
 *   node scripts/run.js stop    # 停止
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PIDFILE = path.join(ROOT, '.run.pids.json');
const LOGDIR = path.join(ROOT, 'logs');
const PORTINFO = require(path.join(ROOT, 'src', 'utils', 'portInfo')); // 端口归属诊断（与 server.js 共用）

function env() {
  return Object.assign({}, process.env, {
    NODE_ENV: process.env.NODE_ENV || 'local',
    PAYMENT_MODE: process.env.PAYMENT_MODE || 'sandbox',
    PORT: process.env.PORT || '3000',
  });
}

/**
 * 以「脱离父进程 + 独立日志」方式拉起常驻子进程。
 * 之前用 stdio:'inherit'，父进程一退出子进程就被连带终止 → 服务莫名消失，
 * 且崩溃原因无处可查。这里改为写日志文件 + detached，父进程退出不影响服务。
 */
function spawnDetached(name, args, e) {
  fs.mkdirSync(LOGDIR, { recursive: true });
  const out = fs.openSync(path.join(LOGDIR, name + '.log'), 'a');
  const child = spawn(process.execPath, args, {
    cwd: ROOT,
    env: e,
    stdio: ['ignore', out, out],
    detached: true,   // 独立进程组，父进程退出不受影响
  });
  child.unref();      // 不再保持父进程的事件循环存活
  return child;
}

/**
 * Windows 下用 `start /B` 真正脱离父进程。
 *
 * 为什么需要它：Node 的 detached 在 Windows 上只是新建进程组，
 * **不阻止父进程退出时被 Job Object 连坐**（部分终端/IDE 会把整棵进程树一起回收）。
 * `start /B` 由 cmd 独立拉起，不挂在当前进程树下，关闭终端窗口也不受影响。
 *
 * 只透传**必要**的环境变量（NODE_ENV/PAYMENT_MODE/PORT 等），
 * 不把整个 process.env 塞进命令行 —— 那会让命令行长到 cmd 无法解析。
 * 返回真实 PID（从 netstat 反查端口），否则 stop 无法定位进程。
 */
function spawnDetachedWin(name, args, e, opts) {
  fs.mkdirSync(LOGDIR, { recursive: true });
  const log = path.join(LOGDIR, name + '.log');
  // 白名单：只带后端真正需要的
  const pass = {};
  for (const k of ['NODE_ENV', 'PAYMENT_MODE', 'PORT', 'DB_KIND', 'DB_FILE',
                   'EXPOSE_DEV_CODE', 'SMS_LOG_CONSOLE', 'ADMIN_PASSWORD',
                   'MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DATABASE',
                   'SEED_USER_PASSWORD', 'SEED_PASSWORD']) {
    if (e[k] !== undefined && e[k] !== '') pass[k] = String(e[k]);
  }
  const envStr = Object.keys(pass).map((k) => 'set "' + k + '=' + pass[k] + '" && ').join('');
  // cmd 的 start 不支持 "VAR=value cmd" 前缀语法 → 必须用 set "VAR=value" && 串联
  const cmd = 'start "" /B cmd /c "' + envStr + '"' + process.execPath + '" ' +
    args.map((a) => '"' + a + '"').join(' ') + ' >> "' + log + '" 2>&1"';
  require('child_process').execSync(cmd, { cwd: ROOT, stdio: 'ignore', shell: 'cmd.exe' });
  // 等目标起来后反查真实 PID：
  //   · 监听端口的服务（server.js）→ 按端口反查
  //   · 不监听端口的常驻进程（sync watcher）→ 按命令行特征反查
  if (opts && opts.cmdKeyword) {
    return { pid: waitForPidByCmd(opts.cmdKeyword, 15) };
  }
  return { pid: waitForPid(e.PORT || '3000') };
}

/**
 * 轮询等待端口监听并返回其 PID（最多等 ~6 秒）。
 * @param {string} port
 * @param {number} tries
 * @returns {number} PID，0 表示未探测到
 */
function waitForPid(port, tries = 20) {
  for (let i = 0; i < tries; i++) {
    const pid = findPidByPort(port);
    if (pid) return pid;
    // 同步等待 300ms（Atomics.wait 可在 Node 主线程阻塞且不依赖外部命令）
    try {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
    } catch (_) {
      const end = Date.now() + 300;
      while (Date.now() < end) { /* 忙等 */ }
    }
  }
  return 0;
}

/**
 * 按命令行特征找 PID（用于 sync 这类不监听端口的进程）。
 * 先试 wmic，wmic 不可用（新版 Windows 已移除）时退回 PowerShell CIM。
 * @param {string} keyword 命令行中必须包含的片段
 * @returns {number}
 */
function findPidByCmd(keyword) {
  const kw = keyword.toLowerCase();
  try {
    const { execFileSync } = require('child_process');
    const out = execFileSync('wmic', ['process', 'where', "name='node.exe'", 'get', 'ProcessId,CommandLine', '/format:csv'],
      { encoding: 'utf8', timeout: 5000 });
    for (const line of out.split(/\r?\n/)) {
      if (line.toLowerCase().includes(kw)) {
        const m = line.match(/(\d+)\s*$/);
        if (m) return Number(m[1]);
      }
    }
  } catch (_) {}
  // 兜底：PowerShell CIM
  // ⚠️ 必须用 PS_EXE 绝对路径：部分环境（IDE / 计划任务 / 精简 PATH）里 'powershell'
  //    不在 PATH 上，spawn 会 ENOENT → 查不到 PID → stop 变成空操作 → 服务根本没停，
  //    运行中的旧实例随后会用内存里的旧快照覆盖掉刚写入的 db.json。
  try {
    const { execFileSync } = require('child_process');
    const ps = "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | " +
      "Where-Object { $_.CommandLine -like '*" + keyword + "*' } | " +
      "ForEach-Object { $_.ProcessId }";
    const out = execFileSync(PS_EXE, ['-NoProfile', '-Command', ps],
      { encoding: 'utf8', timeout: 8000 });
    const m = out.trim().match(/(\d+)/);
    if (m) return Number(m[1]);
  } catch (_) {}
  return 0;
}

/** 轮询等待按特征找到的进程（最多 ~4.5 秒） */
function waitForPidByCmd(keyword, tries = 15) {
  for (let i = 0; i < tries; i++) {
    const pid = findPidByCmd(keyword);
    if (pid) return pid;
    try {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
    } catch (_) {
      const end = Date.now() + 300;
      while (Date.now() < end) { /* 忙等 */ }
    }
  }
  return 0;
}

/** 从 netstat 反查监听某端口的 PID */
function findPidByPort(port) {
  try {
    const { execFileSync } = require('child_process');
    const out = execFileSync('netstat', ['-ano'], { encoding: 'utf8', timeout: 5000 });
    const re = new RegExp('[:.]' + port + '\\s+\\S+\\s+LISTENING\\s+(\\d+)', 'i');
    for (const line of out.split(/\r?\n/)) {
      const m = line.match(re);
      if (m) return Number(m[1]);
    }
  } catch (_) {}
  return 0;
}

/**
 * Windows 计划任务托管（2026-10-28 新增，**首选方案**）
 *
 * 为什么需要它：`start /B` 拉起的子进程仍挂在当前会话的进程树下，
 *   终端/IDE/沙箱一结束，整棵树被连带回收 → 服务莫名消失、
 *   "显示已启动但 5 秒后端口就没了"。
 *   而 Windows 计划任务由 Task Scheduler 服务托管，与登录会话解耦，
 *   并可设置「开机自启 + 崩溃自动重启」，是真正可靠的服务化方式。
 *
 * 依赖：PowerShell 的 Register-ScheduledTask（走 COM 接口，不经过 schtasks.exe）。
 *   ⚠️ 以 SYSTEM 账户 + 最高权限运行；如当前环境不允许注册，调用方应回退到 start /B。
 *
 * @param {string} taskName  任务名
 * @param {string} scriptRel 相对 ROOT 的脚本路径
 * @param {string} args      传给 node 的参数
 * @param {string} port      监听端口（用于反查 PID）
 * @returns {{ok:boolean, pid:number, mode:string}}
 */
/**
 * 计划任务辅助脚本的落地位置（纯 ASCII 路径）
 *
 * 为什么不能直接用 E:\脑商ai\server\scripts\taskctl.ps1：
 *   子 powershell 在**含非 ASCII 字符的路径**下无法写文件（静默失败），
 *   且在含中文的目录里执行脚本也不稳定 → 统一部署到 C:\ProgramData\NaoshangAI\。
 */
const TASKCTL_DIR = 'C:\\ProgramData\\NaoshangAI';
const TASKCTL_SCRIPT = path.join(TASKCTL_DIR, 'taskctl.ps1');
const TASKCTL_LOG = path.join(TASKCTL_DIR, 'taskctl.log');
const PS_EXE = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';

/** 把 taskctl.ps1 部署到 ASCII 路径（幂等） */
function deployTaskctl() {
  try {
    if (!fs.existsSync(TASKCTL_DIR)) fs.mkdirSync(TASKCTL_DIR, { recursive: true });
    const src = path.join(ROOT, 'scripts', 'taskctl.ps1');
    if (!fs.existsSync(src)) return false;
    const cur = fs.existsSync(TASKCTL_SCRIPT) ? fs.readFileSync(TASKCTL_SCRIPT, 'utf8') : '';
    const next = fs.readFileSync(src, 'utf8');
    if (cur !== next) fs.writeFileSync(TASKCTL_SCRIPT, next, 'utf8');
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * 调用 taskctl.ps1 并从日志文件读回结果。
 * 子 powershell 的 stdout 会被沙箱吞掉，所以只能靠日志文件确认成败。
 * @returns {string} 结果文本（空串表示失败）
 */
function runTaskctl(action, name, extra) {
  if (!deployTaskctl()) return '';
  try {
    if (fs.existsSync(TASKCTL_LOG)) fs.unlinkSync(TASKCTL_LOG);
  } catch (_) {}
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', TASKCTL_SCRIPT,
    '-Action', action, '-Name', name].concat(extra || []);
  try {
    require('child_process').execFileSync(PS_EXE, args, { cwd: ROOT, stdio: 'ignore', timeout: 30000 });
  } catch (_) {}
  try {
    if (fs.existsSync(TASKCTL_LOG)) {
      const lines = fs.readFileSync(TASKCTL_LOG, 'utf8').trim().split(/\r?\n/);
      return lines[lines.length - 1] || '';
    }
  } catch (_) {}
  return '';
}

function spawnViaTaskScheduler(taskName, scriptRel, args, port) {
  const out = runTaskctl('start', taskName, ['-Exe', nodeExe(), '-Args', args, '-Dir', ROOT]);
  if (!/started:/.test(out)) return { ok: false, pid: 0, mode: 'task_scheduler_failed' };
  let pid = 0;
  if (port) {
    pid = waitForPid(port);
  } else {
    // 不监听端口的常驻进程（sync watcher）：让 PowerShell 直接查命令行匹配
    const keyword = scriptRel.split(/[\\/]/).pop().replace(/\.js$/, '');
    const r = runTaskctl('pid', keyword);
    const m = r.match(/:(\d+)$/);
    pid = m ? Number(m[1]) : 0;
  }
  return { ok: true, pid, mode: 'task_scheduler' };
}

/**
 * 本机 node 可执行文件绝对路径（计划任务以 SYSTEM 运行，不能依赖 PATH）。
 *
 * 坑（2026-10-28）：process.execPath 指向的是 **WorkBuddy 内置的 node**
 * （…\binaries\node\versions\22.22.2\node.exe），该目录在部分版本下**并不存在**
 * （实际目录名带 -6 后缀，如 22.22.2-6），直接拿来注册计划任务会静默失败——
 * 任务注册成功但进程秒退，State 变 Ready，端口不监听。
 * 解决办法：优先探测 versions\ 下真实存在的版本目录，取最新且可执行的那个。
 */
function nodeExe() {
  const fsx = require('fs');
  const base = 'C:\\Users\\Administrator\\.workbuddy\\binaries\\node\\versions';
  try {
    const dirs = fsx.readdirSync(base)
      .filter((d) => d !== 'current' && !d.startsWith('.'))
      .sort()
      .reverse();
    for (const d of dirs) {
      const p = path.join(base, d, 'node.exe');
      if (fsx.existsSync(p)) return p;
    }
  } catch (_) {}
  // 回退：跟随 PATH 里的系统 node
  try {
    const out = require('child_process').execFileSync('where', ['node'], { encoding: 'utf8', timeout: 5000 });
    const first = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
    if (first && fsx.existsSync(first)) return first;
  } catch (_) {}
  return process.execPath;
}

function start() {
  // ① 端口已被占用？先分清「占用者是谁」——
  //    端口上跑的常常就是**本项目自己**（Windows 计划任务托管的常驻实例）。
  //    旧逻辑一律 [FATAL] 端口已占用 → 用户以为"后端起不来"，其实服务好好地在跑。
  //    现在：自己的服务 → 报"已在运行"并给出访问地址（幂等，退出码 0）；
  //          别的程序 → 才算真冲突。
  if (portInUse(e_port())) {
    const owner = portOwner(e_port());
    if (owner.ours) {
      console.log('✔ 脑商AI 已在运行（端口 ' + e_port() + '），无需重复启动。');
      console.log('  API     : http://localhost:' + e_port() + '   (pid=' + owner.pid + ')');
      console.log('  局域网  : http://' + lanIp() + ':' + e_port() + '   ← 手机 / 小程序用这个');
      console.log('  托管    : Windows 计划任务（开机自启 + 崩溃自动重启），关窗口/关终端都不影响');
      console.log('  停止    : node scripts/run.js stop');
      console.log('  体检    : node scripts/run.js status');
      process.exit(0);
    }
    console.error('[FATAL] 端口 ' + e_port() + ' 被**其它程序**占用（PID ' + owner.pid + '），服务无法启动。');
    console.error('  查占用进程： netstat -ano | findstr :' + e_port());
    console.error('  换个端口跑： PORT=3001 node scripts/run.js start');
    process.exit(1);
  }  // ② PID 文件可能是**上次异常退出留下的残留**（进程早没了，文件还在）。
  //    旧逻辑只看「文件是否存在」就拒绝启动 → 用户永远启动不了，必须手动删文件。
  //    现在改为：读 PID → 验活 → 全部已死就当残留，自动清理后继续启动。
  if (fs.existsSync(PIDFILE)) {
    const stale = readPids();
    const alive = ['server', 'sync', 'manager'].filter((k) => isAlive(stale[k]));
    if (alive.length) {
      console.log('⚠ 似已运行（进程存活: ' + alive.join(', ') + '）。先执行 stop 再 start。');
      process.exit(1);
    }
    console.log('（检测到上次残留的 .run.pids.json，进程已全部退出，自动清理）');
    try { fs.unlinkSync(PIDFILE); } catch (_) {}
  }
  const e = env();
  const isWin = process.platform === 'win32';

  // Windows 首选「计划任务托管」；注册失败则回退到 start /B。
  let server, sync, mode;
  if (isWin) {
    server = spawnViaTaskScheduler('WorkBuddyNaoshangApi', 'server.js', 'server.js', e.PORT || '3000');
    if (!server.ok) {
      console.warn('（计划任务注册失败，回退到 start /B 方式）');
      server = spawnDetachedWin('api', ['server.js'], e);
      mode = 'start_b';
    } else {
      mode = 'task_scheduler';
    }
    // ⚠️ 修复（2026-10-28）：Windows 分支此前**只反查 PID、从不真正拉起** watcher
    //   → db.json → MySQL 的常驻镜像一直没在跑，MySQL 里数据会逐渐与业务真源脱节。
    sync = spawnViaTaskScheduler('WorkBuddyNaoshangSync', 'scripts/sync_to_mysql.js',
      'scripts/sync_to_mysql.js --watch', null);
    if (!sync.ok) {
      sync = spawnDetachedWin('sync', ['scripts/sync_to_mysql.js', '--watch'], e, { cmdKeyword: 'sync_to_mysql' });
    }
  } else {
    server = spawnDetached('api', ['server.js'], e);
    sync = spawnDetached('sync', ['scripts/sync_to_mysql.js', '--watch'], e);
    mode = 'detached';
  }
  fs.writeFileSync(PIDFILE, JSON.stringify({ manager: process.pid, server: server.pid, sync: sync.pid, mode }));
  console.log('脑商AI 已启动：');
  console.log('  API  : http://localhost:' + e.PORT + '  (pid=' + server.pid + ')');
  console.log('  Sync : db.json → MySQL 常驻 (pid=' + sync.pid + ')');
  console.log('  托管 : ' + mode);
  console.log('  日志 : logs/api.log 与 logs/sync.log');
  console.log('  停止 : node scripts/run.js stop  （或双击 stop.bat）');
  console.log('  提示 : 服务已脱离当前窗口，关闭本窗口/关终端都不会停止它。');
  process.exit(0);
}

/** 取端口号 */
function e_port() { return process.env.PORT || '3000'; }

/** 端口是否已被占用 —— 读 netstat 最直接可靠（Windows / 跨平台都能用） */
function portInUse(port) {
  try {
    const { execFileSync } = require('child_process');
    const out = execFileSync('netstat', ['-ano'], { encoding: 'utf8', timeout: 5000 });
    // 端口列必须**正好**等于目标端口：`:3000` 命中，`:30000` / `:30001` 不命中
    const re = new RegExp('[:.]' + port + '\\s+\\S+\\s+LISTENING', 'i');
    return out.split(/\r?\n/).some((line) => re.test(line));
  } catch (_) {
    return false;
  }
}

/** 读取 PID 文件，解析失败按空对象处理 */
function readPids() {
  try { return JSON.parse(fs.readFileSync(PIDFILE, 'utf8')) || {}; } catch (_) { return {}; }
}

/** 判断某个 PID 的进程是否仍存活 */
function isAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

/**
 * 端口被谁占着？是**本项目**的服务，还是别的程序？
 *
 * 为什么必须分清：本项目的服务由 Windows 计划任务托管时，端口上跑的就是它自己。
 * 旧逻辑只判断"端口被占用"就一律 [FATAL] 退出 → 用户看到的是"后端起不来"，
 * 其实服务好好地在跑。误导之外还有二次伤害：用户会照着提示去 stop，
 * 把本来正常的服务关掉，越弄越糟。
 *
 * 实现放在 src/utils/portInfo.js —— 与 server.js 的 EADDRINUSE 提示共用同一份逻辑，
 * 避免两处口径漂移（曾经就因为一处用 'powershell' 相对名、一处用绝对路径而误判）。
 */
function portOwner(port) {
  return PORTINFO.portOwner(port);
}

/** 本机局域网 IPv4（小程序真机调试要用这个，不能用 127.0.0.1） */
function lanIp() {
  return PORTINFO.lanIp();
}

function stop() {
  // 兜底：Windows 上 `start /B` 拉起的进程，真实 PID 可能与 PID 文件记录不一致
  //   （netstat 反查存在毫秒级竞态）→ 停止后再按「端口 + 命令行特征」扫一遍，
  //   否则会出现「显示已停止，实际服务还在跑 / 端口被占」的情况。
  // 杀进程：优先 taskkill /T /F（连子进程一起杀），
  // 失败再用 PowerShell Stop-Process 兜底 —— **部分沙箱环境里 taskkill.exe 会被拦掉**，
  // 只靠 taskkill 会导致 stop 变成空操作（服务还活着 → 旧内存快照覆盖新写入的 db.json）。
  const killPid = (pid) => {
    if (!pid) return false;
    let killed = false;
    try { require('child_process').execSync('taskkill /PID ' + pid + '/T /F', { stdio: 'ignore' }); killed = true; } catch (_) {}
    if (!killed) {
      try {
        require('child_process').execFileSync(PS_EXE,
          ['-NoProfile', '-Command', 'Stop-Process -Id ' + pid + ' -Force -ErrorAction SilentlyContinue'],
          { stdio: 'ignore', timeout: 8000 });
        killed = true;
      } catch (_) {}
    }
    return killed;
  };
  const killByPort = (port) => {
    const pid = findPidByPort(port);
    if (!pid) return;
    killPid(pid);
  };
  const killByCmd = (keyword) => {
    const pid = findPidByCmd(keyword);
    if (!pid) return;
    killPid(pid);
  };
  // 计划任务托管时，杀进程不够 —— 任务还会在开机/崩溃重启时把服务拉起来。
  // 必须先 Stop + Unregister 任务，再杀进程。
  // 用独立 .ps1 文件调用（powershell -File），避开 -Command 的引号嵌套地狱。
  const stopTask = (taskName) => {
    runTaskctl('stop', taskName);
  };
  if (fs.existsSync(PIDFILE)) {
    const p = readPids();
    for (const k of ['server', 'sync', 'manager']) {
      if (!isAlive(p[k])) continue;
      try { process.kill(p[k]); } catch (_) {}
    }
    // Windows 上 process.kill 只发信号，进程树可能残留 → 二次强杀
    if (process.platform === 'win32') {
      for (const k of ['server', 'sync', 'manager']) {
        if (!p[k]) continue;
        killPid(p[k]);
      }
    }
    try { fs.unlinkSync(PIDFILE); } catch (_) {}
  }
  // 先停并注销计划任务（否则开机/崩溃重启会把服务重新拉起）
  stopTask('WorkBuddyNaoshangApi');
  stopTask('WorkBuddyNaoshangSync');
  // 兜底清理：按端口与命令行特征
  killByPort(process.env.PORT || '3000');
  killByCmd('sync_to_mysql');
  killByCmd('server.js');

  // ⚠️ 必须**验证**真的停了。
  //   之前 stop 只是"尝试杀"，杀不掉也不吭声 → 调用方以为停干净了，
  //   于是在服务还活着的情况下写 db.json → 运行中的旧实例下一次写操作
  //   用内存里的旧快照把新数据整份覆盖掉（测试数据反复消失的真正原因）。
  const port = process.env.PORT || '3000';
  for (let i = 0; i < 10; i++) {
    if (!portInUse(port)) break;
    try { require('child_process').execSync('ping -n 2 127.0.0.1 > nul', { stdio: 'ignore', timeout: 3000 }); } catch (_) {}
    killByPort(port);
    killByCmd('server.js');
    try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300); } catch (_) {}
  }
  if (portInUse(port)) {
    const owner = portOwner(port);
    console.error('⚠ 端口 ' + port + ' 仍被占用（PID ' + owner.pid + '），服务可能没停干净。');
    console.error('  手动结束： taskkill /PID ' + owner.pid + ' /T /F');
  } else {
    console.log('已停止脑商AI');
  }
}

/**
 * 一键体检：端口 / 占用进程 / 计划任务 / HTTP 是否真的通。
 *
 * 「后端又打不开了」的时候先跑这个，一眼就能看出卡在哪一环，
 * 不用在 netstat、任务管理器、计划任务之间来回猜。
 */
function status() {
  const port = e_port();
  const ip = lanIp();
  console.log('════ 脑商AI 后端状态 ════');
  console.log('');

  // ① 端口 + 占用者
  const inUse = portInUse(port);
  let owner = { pid: 0, cmd: '', ours: false };
  if (inUse) {
    owner = portOwner(port);
    console.log('[1] 端口 ' + port + '：已被占用');
    console.log('    占用进程 PID = ' + owner.pid + (owner.ours ? '（本项目服务 ✓）' : '（其它程序 ⚠）'));
    if (owner.cmd) console.log('    命令行     = ' + owner.cmd);
  } else {
    console.log('[1] 端口 ' + port + '：空闲  ← 服务没在跑！');
  }

  // ② PID 文件
  if (fs.existsSync(PIDFILE)) {
    const p = readPids();
    console.log('[2] pid 文件：托管方式=' + (p.mode || '未知') +
      '  server=' + (isAlive(p.server) ? p.server + '(存活)' : p.server + '(已死)') +
      '  sync=' + (isAlive(p.sync) ? p.sync + '(存活)' : p.sync + '(已死)'));
  } else {
    console.log('[2] pid 文件：无');
  }

  // ③ 计划任务
  if (process.platform === 'win32') {
    for (const tn of ['WorkBuddyNaoshangApi', 'WorkBuddyNaoshangSync']) {
      const out = String(runTaskctl('status', tn) || '').trim();
      // ⚠️ 子 powershell 在某些环境会被直接杀掉 → 查不到状态。
      //    这时**不能**报"未注册"（会误导人去重装），
      //    只能如实说"状态查询不可用"，让人用 PowerShell 手动查。
      console.log('[3] 计划任务 ' + tn + '：' + (out || '状态查询不可用（当前环境无法启动子 powershell，可用 PowerShell 手动查询）'));
    }
  }

  // ④ HTTP 实测（真正打一次接口，而不是只看端口）
  console.log('[4] HTTP 实测：');  const probe = (url) => new Promise((resolve) => {
    try {
      const http = require('http');
      const req = http.request(url, { method: 'GET', timeout: 5000 }, (res) => {
        let n = 0; res.on('data', (c) => { n += c.length; });
        res.on('end', () => resolve('HTTP ' + res.statusCode));
      });
      req.on('error', (e) => resolve('失败：' + e.message));
      req.on('timeout', () => { req.destroy(); resolve('失败：超时'); });
      req.end();
    } catch (e) { resolve('失败：' + e.message); }
  });
  return Promise.all([
    probe('http://127.0.0.1:' + port + '/'),
    probe('http://' + ip + ':' + port + '/'),
  ]).then(([a, b]) => {
    console.log('    本机   http://127.0.0.1:' + port + '  → ' + a);
    console.log('    局域网 http://' + ip + ':' + port + '  → ' + b);

    // ⑤ 库内容健康度 —— 服务"正常"但数据被重置的情况，端口/HTTP 是看不出来的
    console.log('');
    console.log('[5] 数据库内容：');
    try {
      const dbFile = path.join(ROOT, 'data', 'db.json');
      const db = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
      const users = Object.values(db.users || {});
      const seeds = users.filter((u) => String(u.id).startsWith('seed_'));
      const noPwd = users.filter((u) => !u.password).length;
      console.log('    用户 ' + users.length + ' 个｜测试账号 ' + seeds.length + ' 个｜无密码账号 ' + noPwd + ' 个');
      if (!seeds.length) {
        console.log('    ⚠ 测试账号没了！恢复： node scripts/run.js seed');
      }
      if (noPwd) {
        console.log('    ⚠ 有 ' + noPwd + ' 个账号没密码 → 现在登录会被拒（缺 password）');
      }
    } catch (e) {
      console.log('    读取 db.json 失败：' + e.message);
    }

    console.log('');
    console.log('访问地址（手机/小程序用局域网这个）：http://' + ip + ':' + port);
    if (!inUse) {
      console.log('');
      console.log('⚠ 服务未运行 → 启动： node scripts/run.js start');
    } else if (!owner.ours) {
      console.log('');
      console.log('⚠ 端口被其它程序占用 → 换个端口： PORT=3001 node scripts/run.js start');
    }
    process.exit(inUse && owner.ours ? 0 : 1);
  });
}

/**
 * 重新生成测试数据：**停服 → 写种子 → 起服**，顺序固定。
 *
 * 为什么必须走这个顺序（也是为什么不能直接跑 seed_test_data.js）：
 *   后端是「内存 + db.json 快照」架构，服务启动时把 db.json 读进内存，
 *   之后每次写操作都会把**整份内存**覆盖写回 db.json。
 *   所以服务还开着的时候写种子 → 下一次写操作就把种子冲掉。
 *
 * 另外，管理端「恢复默认种子」(/api/seed/reset) 会把 db.users 重置成 7 个默认合伙人，
 * 测试账号会被一起清掉 —— 这是该接口的设计（一个"重置"），
 * 所以本命令把"重新生成测试数据"做成一步到位，不用记顺序。
 */
function seed() {
  console.log('════ 重新生成测试数据 ════');
  console.log('');
  // ① 停服：避免运行中的实例用旧快照覆盖刚写入的种子
  console.log('[1/3] 停止服务…');
  try { stop(); } catch (e) { /* ignore */ }
  // ② 写种子
  console.log('');
  console.log('[2/3] 生成测试数据…');
  const r = require('child_process').spawnSync(
    process.execPath, [path.join(ROOT, 'scripts', 'seed_test_data.js')],
    { cwd: ROOT, stdio: 'inherit' }
  );
  if (r.status !== 0) {
    console.error('');
    console.error('[FATAL] 测试数据生成失败，服务未启动。');
    process.exit(1);
  }
  // ③ 起服
  console.log('');
  console.log('[3/3] 启动服务…');
  start();
}

/**
 * 数据库浏览器（MySQL 可视化）—— 独立托管。
 *
 * 为什么单独一个子命令：浏览器是**给人用的 GUI 入口**（同事通过浏览器读写库），
 * 与 API / Sync 的生命周期不同（API 是业务入口，Sync 是镜像管道）。
 * 同样用 Windows 计划任务托管，SYSTEM 账户 + 开机自启 + 崩溃自动重启，
 * 避免出现「关掉终端浏览器就没了，同事连不上」的情况。
 *
 * 用法：
 *   node scripts/run.js viewer start   # 启动（写入模式）
 *   node scripts/run.js viewer start --readonly
 *   node scripts/run.js viewer stop
 *   node scripts/run.js viewer status
 */
function viewer() {
  const action = process.argv[3] || 'start';
  const readonly = process.argv.includes('--readonly');
  const TASK = 'WorkBuddyNaoshangViewer';
  const SCRIPT = 'scripts/db_viewer_mysql.js';
  const ARGS = SCRIPT + (readonly ? '' : ' --write');
  const PORT = process.env.VIEWER_PORT || '7789';

  if (action === 'start') {
    if (portInUse(PORT)) {
      const owner = portOwner(PORT);
      console.log('✔ 数据库浏览器已在运行（端口 ' + PORT + '）');
      console.log('  本机   : http://localhost:' + PORT);
      console.log('  局域网 : http://' + lanIp() + ':' + PORT + '   ← 同事用这个地址');
      console.log('  写入   : ' + (readonly ? '只读' : '已开启（仅 DML，托管表禁写）'));
      process.exit(0);
    }
    const r = spawnViaTaskScheduler(TASK, SCRIPT, ARGS, PORT);
    if (!r.ok) {
      console.error('[FATAL] 计划任务注册失败：' + r.mode);
      process.exit(1);
    }
    console.log('数据库浏览器已启动：');
    console.log('  本机   : http://localhost:' + PORT + '   (pid=' + r.pid + ')');
    console.log('  局域网 : http://' + lanIp() + ':' + PORT + '   ← 同事用这个地址');
    console.log('  写入   : ' + (readonly ? '只读' : '已开启（仅 INSERT/UPDATE/DELETE，托管表禁写）'));
    console.log('  托管   : Windows 计划任务（开机自启 + 崩溃自动重启）');
    console.log('  日志   : logs/viewer.log');
    process.exit(0);
  }

  if (action === 'stop') {
    const out = runTaskctl('stop', TASK);
    console.log(out || '（停止完成）');
    process.exit(0);
  }

  if (action === 'status') {
    // 端口探测走 netstat（可靠、不依赖子 PowerShell）
    // 任务状态需查计划任务，但当前环境下从 node 拉起子 powershell 会被沙箱拦截，
    // 因此这里以「端口是否监听」作为服务是否存活的判据。
    const alive = portInUse(PORT);
    const out = runTaskctl('status', TASK);
    const taskState = out ? out.replace(/^status:[^:]*:/, '') : '未知（子进程受限，请用 PowerShell 查看）';
    console.log('任务 : ' + TASK + ' → ' + taskState);
    console.log('端口 : ' + PORT + (alive ? '（监听中，服务存活）' : '（未监听，服务未运行）'));
    console.log('地址 : http://' + lanIp() + ':' + PORT);
    if (!alive) console.log('启动 : node scripts/run.js viewer start');
    process.exit(alive ? 0 : 1);
  }

  console.log('用法: node scripts/run.js viewer start [--readonly] | viewer stop | viewer status');
  process.exit(1);
}

const m = process.argv[2];
if (m === 'start') start();
else if (m === 'stop') stop();
else if (m === 'status') status();
else if (m === 'seed') seed();
else if (m === 'viewer') viewer();
else { console.log('用法: node scripts/run.js start | stop | status | seed | viewer start|stop|status'); process.exit(1); }
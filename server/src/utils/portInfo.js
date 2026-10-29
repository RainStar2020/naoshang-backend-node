/**
 * 端口归属诊断工具（2026-10-28）
 *
 * 背景：本项目的服务由 **Windows 计划任务**托管（开机自启 + 崩溃自动重启）。
 * 这带来一个高频误判 —— 端口 3000 上跑的就是本项目自己，
 * 但「再启一个实例」的人（尤其是从 IDEA 直接跑 node server.js 的）会看到
 * EADDRINUSE，然后被告知"端口被占用，服务无法启动"，
 * 于是以为后端挂了、其实它好好地在跑。更糟的是有人会照着提示去 stop，
 * 把正常运行的服务关掉。
 *
 * 所以这里提供两个能力：
 *   - portOwner(port)：端口被谁占着？是不是**本项目**的进程？
 *   - lanIp()        ：本机局域网 IPv4（手机/小程序调试要用，不能用 127.0.0.1）
 *
 * ⚠️ 踩坑提醒：调 PowerShell 必须用**绝对路径** PS_EXE。
 *    在 IDE / 计划任务 / 精简 PATH 的环境里，'powershell' 不在 PATH 上，
 *    直接 spawn 会 ENOENT → 查不到命令行 → 又会误判成"别的程序占用"。
 */
const { execFileSync } = require('node:child_process');

const PS_EXE = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';

/**
 * 端口被谁占着？
 * @param {string|number} port
 * @returns {{pid:number, cmd:string, ours:boolean}} ours=true 表示是本项目的进程
 */
function portOwner(port) {
  let pid = 0;
  try {
    const out = execFileSync('netstat', ['-ano'], { encoding: 'utf8', timeout: 5000 });
    // 端口列必须**正好**等于目标端口：`:3000` 命中，`:30000` / `:30001` 不命中
    const re = new RegExp('[:.]' + port + '\\s+\\S+\\s+LISTENING\\s+(\\d+)', 'i');
    for (const line of out.split(/\r?\n/)) {
      const m = line.match(re);
      if (m) { pid = Number(m[1]); break; }
    }
  } catch (e) { /* 查不到就当没占用 */ }
  if (!pid) return { pid: 0, cmd: '', ours: false };

  let cmd = '';
  try {
    const ps = 'Get-CimInstance Win32_Process -Filter "ProcessId=' + pid + '" | ForEach-Object { $_.CommandLine }';
    cmd = String(execFileSync(PS_EXE, ['-NoProfile', '-Command', ps], { encoding: 'utf8', timeout: 8000 }) || '').trim();
  } catch (e) { /* 查不到命令行就保守处理 */ }

  // 命令行是 node server.js / sync_to_mysql.js → 本项目的常驻进程
  const ours = /server\.js/i.test(cmd) || /sync_to_mysql/i.test(cmd);
  return { pid, cmd, ours };
}

/** 本机局域网 IPv4；取不到时回退 127.0.0.1 */
function lanIp() {
  try {
    const ps = "Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.PrefixOrigin -ne 'WellKnown' } | Select-Object -First 1 -ExpandProperty IPAddress";
    return String(execFileSync(PS_EXE, ['-NoProfile', '-Command', ps], { encoding: 'utf8', timeout: 8000 }) || '').trim() || '127.0.0.1';
  } catch (e) { return '127.0.0.1'; }
}

/**
 * 某个端口当前是否空闲（按 netstat 判断 LISTENING）。
 * ⚠️ 有毫秒级竞态：判断完到真正 bind 之间仍可能被抢 → listen 的 error 事件是兜底。
 */
function portFree(port) {
  try {
    const out = execFileSync('netstat', ['-ano'], { encoding: 'utf8', timeout: 5000 });
    // 端口列必须**正好**等于目标端口：`:3000` 命中，`:30000` / `:30001` 不命中
    const re = new RegExp('[:.]' + port + '\\s+\\S+\\s+LISTENING', 'i');
    return !out.split(/\r?\n/).some((line) => re.test(line));
  } catch (e) { return true; }  // 查不到就当空闲
}

module.exports = { portOwner, lanIp, portFree, PS_EXE };

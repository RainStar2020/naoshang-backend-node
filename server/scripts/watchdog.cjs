#!/usr/bin/env node
/**
 * NaoshangAI 端口守护（2026-10-28）
 *
 * 背景：后端由 Windows 计划任务 WorkBuddyNaoshangApi 托管，任务本身带
 *   「失败自动重启」(RestartCount 999 / RestartInterval 1min)。但该机制在
 *   **进程被外部杀死**（Stop-Process / taskkill / 崩溃 / OOM）时**不生效**：
 *   任务结果变成 0xFFFFFFFF (4294967295 = terminated)，调度器判定为
 *   「人为停止」→ 不再重排，NextRunTime 为空 → **后端永久停机**，
 *   小程序（连 http://<局域网IP>:3000）就再也连不上。
 *
 * 本守护每分钟跑一次，分三层自愈：
 *   ① 探 3000 端口是否真的在 LISTENING（不信任务状态，任务 Running 也可能进程已死）
 *   ② 不在 → 拉起计划任务（保留任务语义，崩溃后仍归计划任务管）
 *   ③ 仍不在 → 直接 spawn server.js 兜底（脱离父进程 + 写日志）
 *   ④ 全程写审计日志 C:\ProgramData\NaoshangAI\watchdog.log
 *
 * 为什么用 node 而不是 .ps1：本机沙箱会拦杀子 powershell.exe，脚本体根本不会执行；
 *   node 是本项目运行时，作为计划任务动作已被证明稳定可用。
 */
const net = require('net');
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const ROOT = 'E:\\脑商ai\\server';
const PORT = 3000;
const LOG = 'C:\\ProgramData\\NaoshangAI\\watchdog.log';
const TASK = 'WorkBuddyNaoshangApi';

function log(msg) {
  try { fs.appendFileSync(LOG, '[' + new Date().toISOString() + '] ' + msg + '\n'); } catch (e) { /* ignore */ }
}

/** 端口是否真的在监听（不是「连得上就算」） */
function listening(port, timeout = 1500) {
  return new Promise((resolve) => {
    const s = new net.Socket();
    let done = false;
    const fin = (v) => { if (done) return; done = true; try { s.destroy(); } catch (e) {} resolve(v); };
    s.setTimeout(timeout);
    s.once('connect', () => fin(true));
    s.once('timeout', () => fin(false));
    s.once('error', () => fin(false));
    s.connect(port, '127.0.0.1');
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  if (await listening(PORT)) {
    log('heartbeat: port ' + PORT + ' listening (OK)');
    process.exit(0);
  }
  log('port ' + PORT + ' DOWN -> recovering');

  // ① 先尝试拉起计划任务（保留「崩溃后仍归计划任务托管」的语义）
  try {
    execFileSync('schtasks.exe', ['/Run', '/TN', TASK], { stdio: 'ignore', timeout: 15000 });
    log('requested scheduled task start: ' + TASK);
  } catch (e) {
    log('schtasks start unavailable: ' + (e && e.message ? e.message : e));
  }
  for (let i = 0; i < 10; i++) {
    await sleep(2000);
    if (await listening(PORT)) { log('recovered via scheduled task after ~' + ((i + 1) * 2) + 's'); process.exit(0); }
  }

  // ② 兜底：直接拉起 server.js（脱离父进程，日志进 logs/api.log）
  try {
    fs.mkdirSync(path.join(ROOT, 'logs'), { recursive: true });
    const out = fs.openSync(path.join(ROOT, 'logs', 'api.log'), 'a');
    const child = spawn(process.execPath, ['server.js'], {
      cwd: ROOT,
      env: Object.assign({}, process.env, { PORT: String(PORT) }),
      stdio: ['ignore', out, out],
      detached: true,
    });
    child.unref();
    log('fallback: spawned server.js pid=' + child.pid);
  } catch (e) {
    log('fallback spawn failed: ' + (e && e.message ? e.message : e));
  }
  for (let i = 0; i < 10; i++) {
    await sleep(2000);
    if (await listening(PORT)) { log('recovered via fallback spawn'); process.exit(0); }
  }
  log('RECOVERY FAILED: port ' + PORT + ' still down');
  process.exit(1);
})();

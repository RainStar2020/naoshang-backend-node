@echo off
REM ============================================================
REM  脑商AI · Windows 计划任务注册（不依赖子 PowerShell）
REM
REM  用途：注册 / 停止 / 查询三个常驻服务
REM     WorkBuddyNaoshangApi     —— 业务 API (3000)
REM     WorkBuddyNaoshangSync    —— db.json → MySQL 镜像同步
REM     WorkBuddyNaoshangViewer  —— 数据库浏览器 (7789)
REM
REM  为什么不用 run.js：run.js 通过子 PowerShell 调 taskctl.ps1，
REM  在受限环境（沙箱 / 某些安全策略）下子进程会被拦截而静默失败。
REM  本脚本直接调用 schtasks.exe，不经过 PowerShell。
REM
REM  ⚠ schtasks 无法设置「工作目录」，因此任务启动时 CWD 是 %SystemRoot%\System32。
REM    所有脚本路径必须写成**绝对路径**，否则 node 找不到文件、秒退。
REM    需要 CWD=项目根 的场景（server.js 读相对路径的 data/db.json），
REM    改用 cmd /c "cd /d <根目录> && node <绝对路径>" 包装。
REM
REM  用法：
REM     注册全部   : 注册计划任务.bat install
REM     只注册某项: 注册计划任务.bat install api|sync|viewer
REM     停止全部   : 注册计划任务.bat stop
REM     查询状态   : 注册计划任务.bat status
REM ============================================================
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0.."

set "ROOT=%CD%"
set "SEED=%ROOT%\scripts"

REM ── 定位 node ──
set "NODEEXE="
if exist "C:\Users\Administrator\.workbuddy\binaries\node\versions\22.22.2-6\node.exe" (
  set "NODEEXE=C:\Users\Administrator\.workbuddy\binaries\node\versions\22.22.2-6\node.exe"
)
if not defined NODEEXE (
  for /f "delims=" %%i in ('where node 2^>nul') do (
    if not defined NODEEXE set "NODEEXE=%%i"
  )
)
if not defined NODEEXE (
  echo [错误] 未找到 node.exe。
  exit /b 1
)

if "%~1"=="status" goto :status
if "%~1"=="stop" goto :stop

REM ── install ──
set "SCOPE=%~1"
if not defined SCOPE set "SCOPE=all"
if /i "%SCOPE%"=="all" set "SCOPE=api sync viewer"

for %%S in (%SCOPE%) do (
  if /i "%%S"=="api" (
    schtasks /Create /TN "WorkBuddyNaoshangApi" /TR "cmd /c cd /d \"%ROOT%\" && \"%NODEEXE%\" server.js" /SC ONSTART /RU SYSTEM /RL HIGHEST /F >nul
    schtasks /Run /TN "WorkBuddyNaoshangApi" >nul
    echo [OK] WorkBuddyNaoshangApi ^(API 3000^) 已注册并启动
  )
  if /i "%%S"=="sync" (
    schtasks /Create /TN "WorkBuddyNaoshangSync" /TR "cmd /c cd /d \"%ROOT%\" && \"%NODEEXE%\" scripts\sync_to_mysql.js --watch" /SC ONSTART /RU SYSTEM /RL HIGHEST /F >nul
    schtasks /Run /TN "WorkBuddyNaoshangSync" >nul
    echo [OK] WorkBuddyNaoshangSync ^(db.json -^> MySQL 镜像^) 已注册并启动
  )
  if /i "%%S"=="viewer" (
    schtasks /Create /TN "WorkBuddyNaoshangViewer" /TR "cmd /c cd /d \"%ROOT%\" && \"%NODEEXE%\" scripts\db_viewer_mysql.js --write" /SC ONSTART /RU SYSTEM /RL HIGHEST /F >nul
    schtasks /Run /TN "WorkBuddyNaoshangViewer" >nul
    echo [OK] WorkBuddyNaoshangViewer ^(浏览器 7789^) 已注册并启动
  )
)
echo.
echo 当前工作目录: %ROOT%
echo 端口占用检查: netstat -ano ^| findstr ":3000 :3307 :7789"
exit /b 0

:stop
for %%T in (WorkBuddyNaoshangApi WorkBuddyNaoshangSync WorkBuddyNaoshangViewer) do (
  schtasks /End /TN %%T >nul 2>&1
  schtasks /Delete /TN %%T /F >nul 2>&1
  echo [OK] 已停止并注销 %%T
)
exit /b 0

:status
for %%T in (WorkBuddyNaoshangApi WorkBuddyNaoshangSync WorkBuddyNaoshangViewer) do (
  echo ---- %%T ----
  schtasks /Query /TN %%T /FO LIST 2>nul | findstr /C:"Status" /C:"Task To Run"
)
echo.
echo ---- 端口 ----
netstat -ano | findstr ":3000" | findstr "LISTENING" && echo "  3000 API 监听中" || echo "  3000 API 未监听"
netstat -ano | findstr ":3307" | findstr "LISTENING" && echo "  3307 MySQL 监听中" || echo "  3307 MySQL 未监听"
netstat -ano | findstr ":7789" | findstr "LISTENING" && echo "  7789 浏览器监听中" || echo "  7789 浏览器未监听"
exit /b 0

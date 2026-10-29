@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title 脑商AI - MySQL 数据库浏览器
cd /d "%~dp0.."

REM ==== 写入模式开关 ====
REM   不带参数    → 只读（默认，安全）
REM   --write    → 开启写入（非托管表可写，托管表禁写）
REM   --readonly → 强制只读（即使配置里有写入开关）
set "WRITE_FLAG="
if /i "%~1"=="--write" set "WRITE_FLAG=--write"
if /i "%~1"=="--readonly" set "WRITE_FLAG="

REM ==== check MySQL service ====
netstat -ano | findstr ":3307" | findstr "LISTENING" >nul
if errorlevel 1 (
  echo [WARN] MySQL 3307 not listening, trying to start MySQL8Naoshang...
  net start MySQL8Naoshang >nul 2>&1
  timeout /t 5 /nobreak >nul
)

REM ==== read db password ====
if "%NAOSHANG_DB_PASSWORD%"=="" (
  if exist "mysql\.env.local" (
    for /f "usebackq tokens=1,* delims==" %%a in ("mysql\.env.local") do (
      if "%%a"=="PASSWORD" set "NAOSHANG_DB_PASSWORD=%%b"
    )
  )
)

REM ==== LAN settings ====
REM listen host: 0.0.0.0 = reachable from same LAN; use 127.0.0.1 for local only
if "%NAOSHANG_VIEWER_HOST%"=="" set "NAOSHANG_VIEWER_HOST=0.0.0.0"
REM optional token: if set, open with ?t=<token>; leave empty for no-token LAN access
REM if "%NAOSHANG_VIEWER_TOKEN%"=="" set "NAOSHANG_VIEWER_TOKEN=your-secret-here"

REM ==== port 7789 already in use ? ====
netstat -ano | findstr ":7789" | findstr "LISTENING" >nul
if not errorlevel 1 (
  echo.
  echo [INFO] Port 7789 is already in use - an instance is already running.
  echo        请直接访问: http://192.168.0.44:7789
  echo.
  timeout /t 5 /nobreak >nul
  exit /b 0
)

REM ==== locate node ====
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
  echo [ERROR] 未找到 node.exe，请安装 Node.js 或修正本脚本的 NODEEXE 路径。
  pause
  exit /b 1
)

echo.
echo   脑商AI - MySQL 数据库浏览器
echo   本机  : http://localhost:7789
echo   局域网: http://192.168.0.44:7789
if defined WRITE_FLAG (
  echo   写入  : 已开启（非托管表可写；托管表禁止直写）
) else (
  echo   写入  : 只读（加 --write 参数可开启写入）
)
echo   停止  : 在此窗口按 Ctrl+C
echo.

"%NODEEXE%" scripts\db_viewer_mysql.js %WRITE_FLAG%

if errorlevel 1 (
  echo.
  echo [提示] 启动失败。若提示连接被拒绝，请先启动 MySQL 服务：net start MySQL8Naoshang
  echo.
  pause
)

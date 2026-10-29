@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 脑商AI 后端
echo 正在启动脑商AI（API + MySQL 同步）...
node scripts/run.js start
echo.
echo -----------------------------------------------
echo 启动命令已执行。服务由 Windows 计划任务托管，
echo **关掉本窗口 / 关掉终端都不会停止服务**，开机还会自启。
echo 若显示「已在运行」，说明服务本来就在跑，直接访问即可。
echo 体检： node scripts/run.js status
echo 停止： 双击 stop.bat
echo -----------------------------------------------
echo.
pause

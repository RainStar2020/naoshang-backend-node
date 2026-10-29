@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 脑商AI 停止
echo 正在停止脑商AI...
node scripts/run.js stop
echo.
echo 停止完成。若 3000 端口仍被占用，请在任务管理器结束 node.exe。
echo.
pause

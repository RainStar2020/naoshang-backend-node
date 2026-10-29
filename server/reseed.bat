@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 脑商AI 重新生成测试数据
echo 正在重新生成测试数据（自动完成：停服 → 写种子 → 起服）...
echo.
node scripts/run.js seed
echo.
echo -----------------------------------------------
echo 已完成。测试账号手机号 13900001001 ~ 13900001011
echo 统一密码见 seed_test_data.js（SEED_PASSWORD 可覆盖）
echo 体检： node scripts/run.js status
echo -----------------------------------------------
echo.
pause

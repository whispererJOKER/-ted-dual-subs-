@echo off
chcp 65001 >nul
cd /d %~dp0
rem ===== 阿里云百炼 paraformer 转发服务 一键启动 =====
rem 用法：双击本文件（位于 tools/dashscope-relay 下）。
rem 首次需先在本目录执行： npm install

if not exist "node_modules\ws" (
  echo [!] 未找到依赖，正在安装 ws ...
  call npm install
)

echo.
echo 正在启动转发服务（监听 127.0.0.1:8788）...
echo 扩展设置里的「转发地址」填： http://127.0.0.1:8788
echo 关闭本窗口即停止服务。
echo.
set PORT=8788
node relay.js

pause

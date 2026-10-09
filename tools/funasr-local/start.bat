@echo off
chcp 65001 >nul
cd /d %~dp0
rem ===== FunASR 本地识别服务 一键启动 =====
rem 用法：把本文件放在 tools/funasr-local 下双击运行。
rem 第一次需先按 README 建好 .venv 并 pip install -r requirements.txt

if not exist ".venv\Scripts\activate.bat" (
  echo [!] 未找到 .venv，请先执行：
  echo     py -3.11 -m venv .venv
  echo     .venv\Scripts\activate
  echo     pip install -r requirements.txt
  pause
  exit /b 1
)

call .venv\Scripts\activate.bat

rem ---- 参数：英文用 paraformer-en；中文用 paraformer-zh ----
set MODEL=paraformer-en
set DEVICE=cpu
rem 有 N 卡改成： set DEVICE=cuda:0
rem 想让它常驻、模型按需加载：在下面命令末尾加 --lazy

echo.
echo 正在启动 FunASR 本地识别服务（%MODEL% / %DEVICE%）...
echo 关闭本窗口即停止服务。
echo.
python server.py --model %MODEL% --device %DEVICE% --port 8000

pause

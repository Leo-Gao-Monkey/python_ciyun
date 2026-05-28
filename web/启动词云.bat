@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 词云 Kiosk 服务器

echo.
echo  正在启动词云 Kiosk 本地服务器...
echo.

where python >nul 2>&1
if errorlevel 1 (
    echo  [错误] 未找到 Python，请先安装 Python 3 并勾选 "Add to PATH"
    echo         下载: https://www.python.org/downloads/
    pause
    exit /b 1
)

echo  检查语音/分词依赖（首次可能需几分钟）...
python -m pip install -q jieba openai-whisper av 2>nul

echo  启动后台助手（供页面「启动本地服务」按钮使用）...
start "" /min pythonw "%~dp0launcher.py"
timeout /t 1 /nobreak >nul

python serve.py
if errorlevel 1 (
    echo.
    echo  [错误] 服务器启动失败
    pause
)

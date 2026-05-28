@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 安装词云本地服务（仅需运行一次）

echo.
echo  ========================================
echo    词云本地服务 - 一次性安装
echo  ========================================
echo.

where python >nul 2>&1
if errorlevel 1 (
    echo  [错误] 未找到 Python，请先安装并勾选 Add to PATH
    pause
    exit /b 1
)

echo  [1/3] 安装 Python 依赖...
python -m pip install -q jieba openai-whisper av
if errorlevel 1 (
    echo  [警告] 部分依赖安装失败，可稍后重试
)

echo  [2/3] 注册开机自启（后台启动助手）...
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "RUNNER=%STARTUP%\词云启动助手.bat"
(
  echo @echo off
  echo cd /d "%~dp0"
  echo start "" /min pythonw "%~dp0launcher.py"
) > "%RUNNER%"

echo  [3/3] 立即启动助手...
start "" /min pythonw "%~dp0launcher.py"
timeout /t 2 /nobreak >nul

echo.
echo  安装完成！
echo  - 启动助手已在后台运行（端口 8764）
echo  - 下次开机会自动启动助手
echo  - 在词云页面控制面板点击「启动本地服务」即可
echo.
echo  也可双击「启动词云.bat」手动启动完整服务器
echo.
pause

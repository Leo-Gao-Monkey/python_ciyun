@echo off
chcp 65001 >nul
cd /d "%~dp0"
set GIT="C:\Program Files\Git\cmd\git.exe"
set GIT_CURL_OPTS=-c http.lowSpeedLimit=1000 -c http.lowSpeedTime=30

echo ========================================
echo   词云项目 - 推送到 GitHub
echo ========================================
echo.

%GIT% status -sb
echo.

%GIT% %GIT_CURL_OPTS% push -u origin main
if %errorlevel% neq 0 (
  echo.
  echo [失败] 无法连接 GitHub，请检查：
  echo   1. 网络 / VPN 是否正常
  echo   2. 换手机热点后重试
  echo   3. 在 PowerShell 中手动执行：
  echo      cd "%~dp0"
  echo      %GIT% push origin main
  pause
  exit /b 1
)

echo.
echo [成功] 已推送到 GitHub
echo.
echo 约 1-2 分钟后 Pages 自动部署完成，访问：
echo   https://leo-gao-monkey.github.io/python_ciyun/
echo.
echo 验证是否最新：页脚应显示「版本 20260621」
echo 手动输入区应有彩色按钮：提取并追加 / 提取词汇 / 提交词汇
echo.
echo 若页面仍是旧版，请 Ctrl+F5 强制刷新或清除浏览器缓存
echo 部署进度：https://github.com/Leo-Gao-Monkey/python_ciyun/actions
pause

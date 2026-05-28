@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 正在推送到 GitHub...
"C:\Program Files\Git\cmd\git.exe" push origin main
if %errorlevel% equ 0 (
  echo.
  echo 推送成功！约 1-2 分钟后访问：
  echo https://leo-gao-monkey.github.io/python_ciyun/
  echo 手机请强制刷新或清除浏览器缓存
) else (
  echo.
  echo 推送失败，请检查网络/VPN 后重试，或用手机热点再运行本脚本
)
pause

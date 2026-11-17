@echo off
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0autostart.ps1" -Action install
echo.
echo  已设置开机自启动：下次登录 Windows 后自动运行服务（不弹浏览器）。
echo  现在就想启动，双击 deploy\run_server.bat 即可。
pause

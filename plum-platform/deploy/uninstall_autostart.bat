@echo off
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0autostart.ps1" -Action uninstall
echo.
echo  已取消开机自启动（已在运行的服务不受影响，按 Ctrl+C 停止）。
pause

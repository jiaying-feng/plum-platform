@echo off
chcp 65001 >nul
cd /d "%~dp0"
set PYTHONIOENCODING=utf-8
echo.
echo  ===== 重启青梅平台服务 =====
echo  用途：改完 ai.env 或代码后，双击本文件即可生效。
echo.
echo  [1/3] 停止 8080 端口上的旧服务...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"
timeout /t 2 /nobreak >nul
echo  [2/3] 启动服务（会最小化一个窗口，请勿关闭它）...
start "青梅平台服务" /min cmd /k "python start.py --no-browser"
timeout /t 6 /nobreak >nul
echo  [3/3] 检查服务...
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8080/health' -UseBasicParsing -TimeoutSec 5; if ($r.StatusCode -eq 200) { Write-Host '  服务已就绪 (200)' } } catch { Write-Host '  服务还没起来，请看最小化的窗口里的报错' }"
echo.
echo  门户：    http://127.0.0.1:8080/
echo  自检：    http://127.0.0.1:8080/api/ai/config
echo  问小梅：  http://127.0.0.1:8080/visitor  →  问小梅
echo.
echo  （本窗口 12 秒后自动关闭，服务窗口会保持最小化运行）
timeout /t 12 /nobreak >nul

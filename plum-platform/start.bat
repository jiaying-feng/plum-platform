@echo off
chcp 65001 >nul
cd /d "%~dp0"
set PYTHONIOENCODING=utf-8
title 青梅产业农商文旅综合平台
echo.
echo  正在准备运行环境...
python -m pip install -r requirements.txt -q --disable-pip-version-check
if errorlevel 1 (
  echo  依赖安装失败，请确认 Python 已加入 PATH。
  pause
  exit /b 1
)
echo  环境就绪，正在启动服务...
echo.
python start.py
pause

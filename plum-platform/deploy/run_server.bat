@echo off
chcp 65001 >nul
cd /d "%~dp0.."
set PYTHONIOENCODING=utf-8
title 青梅平台服务（开机自启动）
python -c "import flask" >nul 2>&1
if errorlevel 1 (
  echo  首次运行，安装基础依赖...
  python -m pip install -r requirements.txt -q --disable-pip-version-check
)
if exist "ai.env" (
  python -c "import pymysql" >nul 2>&1
  if errorlevel 1 (
    echo  安装 AI 扩展域可选依赖...
    python -m pip install -r requirements-ai.txt -q --disable-pip-version-check
  )
)
echo  服务地址 http://127.0.0.1:8080/  停止请在窗口按 Ctrl+C
python start.py --no-browser

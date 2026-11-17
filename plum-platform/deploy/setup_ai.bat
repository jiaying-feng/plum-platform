@echo off
chcp 65001 >nul
cd /d "%~dp0.."
echo ===== AI 问答扩展域 一键配置 =====
if not exist "ai.env" (
  copy /y "ai.env.example" "ai.env" >nul
  echo.
  echo  已生成 ai.env。请用记事本打开，填写：
  echo    LLM_ENABLED=1 / LLM_API_BASE / LLM_API_KEY / LLM_MODEL
  echo    MYSQL_ENABLED=1 / MYSQL_USER / MYSQL_PASSWORD
  echo  填好后重新运行本脚本完成依赖安装与建库。
  pause
  exit /b 0
)
echo  安装可选依赖（Flask + PyMySQL）...
python -m pip install -r requirements-ai.txt -q --disable-pip-version-check
if errorlevel 1 (
  echo  依赖安装失败，请检查网络或 Python 环境。
  pause
  exit /b 1
)
echo  初始化 MySQL 库表...
python tools\init_ai_db.py
echo.
echo  配置自检：启动服务后访问 http://127.0.0.1:8080/api/ai/config
pause

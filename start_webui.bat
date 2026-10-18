@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

set "PY=%~dp0.venv\Scripts\python.exe"
if exist "%PY%" goto run

where python >nul 2>nul
if errorlevel 1 (
  echo Python not found. Install Python 3.10+ or run this with the project venv.
  pause
  exit /b 1
)
set "PY=python"

:run
echo.
echo Starting DouK Web UI...
"%PY%" server.py %*
pause

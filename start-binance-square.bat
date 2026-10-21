@echo off
setlocal EnableExtensions

cd /d "%~dp0"
if not exist "%~dp0app\start-publisher.ps1" (
  echo Missing app\start-publisher.ps1
  pause
  exit /b 1
)

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0app\start-publisher.ps1"
set "exitCode=%ERRORLEVEL%"

if not "%exitCode%"=="0" (
  echo.
  echo Publisher exited with code %exitCode%.
  pause
)
exit /b %exitCode%

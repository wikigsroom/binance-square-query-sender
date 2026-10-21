@echo off
setlocal
cd /d "%~dp0.."
node app\src\index.mjs %*
endlocal

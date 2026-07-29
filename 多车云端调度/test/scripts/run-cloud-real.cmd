@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-cloud-real.ps1" %*
exit /b %errorlevel%

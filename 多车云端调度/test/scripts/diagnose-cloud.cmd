@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0diagnose-cloud.ps1" %*
exit /b %ERRORLEVEL%

@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Invoke-ImageSlideSetup.ps1" -Mode Apply -PluginRoot "%~dp0.."
set "RC=%ERRORLEVEL%"
echo.
if "%RC%"=="0" (echo PASS: setup completed.) else (echo FAIL: no unverified change was accepted. See the message above.)
pause
exit /b %RC%

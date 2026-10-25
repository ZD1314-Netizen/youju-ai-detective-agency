@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
if errorlevel 1 (
    echo.
    echo Startup failed. Check the message above or read the user guide.
    pause
    exit /b 1
)
endlocal

@echo off
title Trading Dashboard
cd /d "%~dp0.."
set "PATH=C:\Program Files\nodejs;%PATH%"

echo.
echo  Trading Dashboard - starting...
echo  (First launch after code changes may take 1-2 minutes to build.)
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch-dashboard.ps1"
set "ERR=%ERRORLEVEL%"

if not "%ERR%"=="0" (
  echo.
  echo  Launch failed. Open dashboard-server.log in the project folder for details.
  echo.
  pause
  exit /b %ERR%
)

echo.
echo  Opening http://localhost:3000/ in your browser...
start "" "http://localhost:3000/"
timeout /t 3 /nobreak >nul
exit /b 0

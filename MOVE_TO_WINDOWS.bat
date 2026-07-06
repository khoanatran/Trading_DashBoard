@echo off
echo Moving trading-dashboard to C:\dev\projects...
echo.

REM Create destination folder
if not exist "C:\dev\projects" mkdir "C:\dev\projects"

REM Move the project
move /Y "%~dp0" "C:\dev\projects\trading-dashboard"

echo.
echo Done! Project moved to C:\dev\projects\trading-dashboard
echo.
echo Next steps:
echo 1. Open WSL
echo 2. cd /mnt/c/dev/projects/trading-dashboard
echo 3. npm install
echo 4. npm run dev
echo.
pause


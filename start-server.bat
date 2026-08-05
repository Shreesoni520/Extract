@echo off
cd /d "%~dp0"

REM Auto-start MySQL if nothing is listening on 3306
netstat -ano | findstr ":3306" | findstr "LISTENING" >nul 2>&1
if errorlevel 1 (
  echo MySQL not detected on port 3306. Starting XAMPP MySQL...
  start "" "C:\xampp\mysql_start.bat"
  timeout /t 10 /nobreak >nul
)

cd /d "%~dp0"
echo Starting Shree's Extractions server...
set "PATH=C:\Program Files\nodejs;%PATH%"
"C:\Program Files\nodejs\node.exe" server\src\index.js
pause

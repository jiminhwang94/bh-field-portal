@echo off
REM Windows: 더블클릭하면 서버가 실행되고 브라우저가 열립니다.
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo python 을 찾을 수 없습니다. https://www.python.org 에서 설치 후 다시 실행하세요.
  pause
  exit /b 1
)

if "%PORT%"=="" set PORT=8787
start "" "http://localhost:%PORT%"
python server.py --port %PORT%

echo.
pause

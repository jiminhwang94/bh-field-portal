@echo off
REM 데이터 자동 백업 등록을 해제한다. 이미 만들어 둔 백업 파일은 지우지 않는다.
chcp 65001 >nul
set "TASK=BH현장포털_백업"

schtasks /query /tn "%TASK%" >nul 2>nul
if errorlevel 1 (
  echo 등록된 자동 백업이 없습니다.
  pause
  exit /b 0
)

schtasks /delete /tn "%TASK%" /f
echo.
echo [OK] 자동 백업을 해제했습니다. backups\ 폴더의 기존 백업은 그대로 있습니다.
pause

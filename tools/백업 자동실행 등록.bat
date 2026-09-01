@echo off
REM ============================================================
REM  데이터 자동 백업 등록 (Windows) — 더블클릭 한 번이면 끝
REM
REM  매일 저녁 7시에 data\ 폴더를 backups\날짜_시각\ 으로 복사한다.
REM  PC 가 꺼져 있었으면 켜진 뒤 곧바로 한 번 실행한다.
REM
REM  해제하려면: "백업 자동실행 해제.bat" 을 더블클릭
REM ============================================================
chcp 65001 >nul
setlocal

set "TASK=BH현장포털_백업"
set "PROJ=%~dp0.."
pushd "%PROJ%"
set "PROJ=%CD%"
popd

REM 파이썬 찾기 — py 런처를 먼저, 없으면 python
where py >nul 2>nul
if %errorlevel%==0 (
  set "PY=py -3"
) else (
  where python >nul 2>nul
  if errorlevel 1 (
    echo [!] python 을 찾을 수 없습니다. https://www.python.org 에서 설치 후 다시 실행하세요.
    pause
    exit /b 1
  )
  set "PY=python"
)

echo 프로젝트 : %PROJ%
echo 실행할 것: %PY% tools\backup.py
echo.

REM 기존 등록이 있으면 지우고 새로 만든다
schtasks /query /tn "%TASK%" >nul 2>nul
if %errorlevel%==0 (
  echo 기존 등록을 갱신합니다...
  schtasks /delete /tn "%TASK%" /f >nul
)

schtasks /create /tn "%TASK%" /tr "cmd /c cd /d \"%PROJ%\" && %PY% tools\backup.py >> \"%PROJ%\backups\backup.log\" 2>&1" /sc daily /st 19:00 /f
if errorlevel 1 (
  echo.
  echo [!] 등록에 실패했습니다. 이 파일을 마우스 오른쪽 클릭 - [관리자 권한으로 실행] 해 보세요.
  pause
  exit /b 1
)

echo.
echo [OK] 매일 저녁 7시에 자동 백업합니다.
echo      저장 위치 : %PROJ%\backups\
echo      기록      : %PROJ%\backups\backup.log
echo      보관 개수 : 최근 14개 (오래된 것은 자동 삭제)
echo.
echo 지금 한 번 시험 삼아 백업해 볼까요?
choice /c YN /n /m "실행하려면 Y, 건너뛰려면 N: "
if errorlevel 2 goto done
echo.
cd /d "%PROJ%"
%PY% tools\backup.py

:done
echo.
pause

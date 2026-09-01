@echo off
REM ============================================================
REM  사무실 밖에서도 가이드를 주고받게 한다 (Cloudflare Tunnel)
REM
REM  재고와 리포트는 이미 구글 시트를 거치므로 어디서든 됩니다.
REM  이 도구가 필요한 것은 **가이드·리포트 항목 설정** 하나뿐입니다.
REM  (그건 아직 사무실 서버를 거칩니다)
REM
REM  공유기 설정을 바꾸지 않고, 이 PC 에서 바깥으로 연결을 겁니다.
REM ============================================================
chcp 65001 >nul
setlocal

where cloudflared >nul 2>nul
if errorlevel 1 (
  echo cloudflared 가 없습니다. 설치할까요?
  choice /c YN /n /m "설치하려면 Y, 그만두려면 N: "
  if errorlevel 2 exit /b 0
  echo.
  winget install --id Cloudflare.cloudflared --silent --accept-package-agreements --accept-source-agreements
  if errorlevel 1 (
    echo [!] 설치에 실패했습니다. https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
    pause
    exit /b 1
  )
  echo.
  echo [OK] 설치했습니다. 이 창을 닫고 다시 실행해 주세요.
  pause
  exit /b 0
)

echo.
echo ┌──────────────────────────────────────────────────────────┐
echo │  임시 주소로 여는 중입니다 (계정 없이 바로 됩니다)       │
echo │                                                          │
echo │  아래에 https://....trycloudflare.com 주소가 나옵니다.    │
echo │  그 주소를 태블릿의                                      │
echo │  [설정 - 사무실 서버 주소] 에 넣으세요.                  │
echo │                                                          │
echo │  * 이 창을 닫으면 연결이 끊깁니다.                       │
echo │  * 임시 주소는 켤 때마다 바뀝니다.                       │
echo │    고정 주소가 필요하면 아래 문서를 보세요:              │
echo │    docs/외부접속.md                                      │
echo └──────────────────────────────────────────────────────────┘
echo.

cloudflared tunnel --url http://localhost:8787
pause

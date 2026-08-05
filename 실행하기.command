#!/bin/bash
# macOS: 더블클릭하면 서버가 실행되고 브라우저가 열립니다.
cd "$(dirname "$0")" || exit 1

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 를 찾을 수 없습니다. 'xcode-select --install' 로 설치하세요."
  read -r -p "엔터를 누르면 종료합니다..." _
  exit 1
fi

PORT="${PORT:-8787}"
( sleep 1.5; open "http://localhost:${PORT}" ) &
python3 server.py --port "${PORT}"

echo
read -r -p "서버가 종료되었습니다. 엔터를 누르면 창을 닫습니다..." _

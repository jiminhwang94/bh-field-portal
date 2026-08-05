#!/bin/bash
# macOS: 더블클릭하면 data/ 폴더를 backups/ 로 백업합니다.
cd "$(dirname "$0")" || exit 1
python3 tools/backup.py
echo
read -r -p "엔터를 누르면 창을 닫습니다..." _

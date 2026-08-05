#!/usr/bin/env python3
"""데이터 백업 — data/ 전체를 날짜별 폴더로 복사한다.

서버가 켜져 있는 상태에서도 안전하게 백업한다 (SQLite 백업 API 사용).

사용법:
    python3 tools/backup.py                    # 기본: <프로젝트>/backups 에 저장
    python3 tools/backup.py --dest /경로       # 다른 위치(외부 디스크·클라우드 폴더 등)
    python3 tools/backup.py --keep 30          # 최근 30개 보관 (기본 14)

자동 실행 (macOS/Linux, 매일 오후 7시):
    crontab -e 로 아래 한 줄 추가
    0 19 * * * cd "<프로젝트 경로>" && /usr/bin/python3 tools/backup.py >> backups/backup.log 2>&1
"""

import argparse
import os
import shutil
import sqlite3
import sys
import time

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
DEFAULT_DEST = os.path.join(BASE_DIR, "backups")


def copy_sqlite(src, dst):
    """서버가 쓰는 중이어도 일관된 사본을 만든다."""
    source = sqlite3.connect(f"file:{src}?mode=ro", uri=True, timeout=20)
    target = sqlite3.connect(dst)
    try:
        source.backup(target)
    finally:
        target.close()
        source.close()


def human(size):
    for unit in ("B", "KB", "MB", "GB"):
        if size < 1024:
            return f"{size:.1f}{unit}"
        size /= 1024
    return f"{size:.1f}TB"


def run(dest_root, keep):
    if not os.path.isdir(DATA_DIR):
        print(f"백업할 데이터가 없습니다: {DATA_DIR}")
        return 1

    stamp = time.strftime("%Y-%m-%d_%H%M")
    dest = os.path.join(dest_root, stamp)
    os.makedirs(dest, exist_ok=True)
    total = 0

    # 1) 공개본 + 각 기기 작업본 (SQLite 백업 API)
    for src in [os.path.join(DATA_DIR, "app.db")]:
        if os.path.isfile(src):
            out = os.path.join(dest, "app.db")
            copy_sqlite(src, out)
            total += os.path.getsize(out)
            print(f"  공개본     app.db  ({human(os.path.getsize(out))})")

    drafts = os.path.join(DATA_DIR, "drafts")
    if os.path.isdir(drafts):
        out_dir = os.path.join(dest, "drafts")
        os.makedirs(out_dir, exist_ok=True)
        count = 0
        for name in sorted(os.listdir(drafts)):
            if not name.endswith(".db"):
                continue
            copy_sqlite(os.path.join(drafts, name), os.path.join(out_dir, name))
            total += os.path.getsize(os.path.join(out_dir, name))
            count += 1
        print(f"  작업본     {count}개")

    # 2) 사진 등 업로드 파일
    media = os.path.join(DATA_DIR, "media")
    if os.path.isdir(media):
        out_dir = os.path.join(dest, "media")
        shutil.copytree(media, out_dir, dirs_exist_ok=True)
        files = 0
        for root, _dirs, names in os.walk(out_dir):
            for name in names:
                total += os.path.getsize(os.path.join(root, name))
                files += 1
        print(f"  업로드파일 {files}개")

    print(f"백업 완료 → {dest}  (총 {human(total)})")

    # 3) 오래된 백업 정리
    entries = sorted(
        name for name in os.listdir(dest_root)
        if os.path.isdir(os.path.join(dest_root, name)) and name[:4].isdigit()
    )
    removed = 0
    while len(entries) > keep:
        shutil.rmtree(os.path.join(dest_root, entries.pop(0)), ignore_errors=True)
        removed += 1
    if removed:
        print(f"오래된 백업 {removed}개 삭제 (최근 {keep}개 보관)")
    return 0


def main():
    parser = argparse.ArgumentParser(description="현장 포털 데이터 백업")
    parser.add_argument("--dest", default=DEFAULT_DEST, help="백업 저장 위치")
    parser.add_argument("--keep", type=int, default=14, help="보관할 백업 개수")
    args = parser.parse_args()
    os.makedirs(args.dest, exist_ok=True)
    print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] 백업 시작")
    sys.exit(run(args.dest, max(1, args.keep)))


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""사용하지 않는 사진 파일 정리.

가이드 단계·리포트 어디에서도 참조하지 않는 `data/media/` 파일을 삭제한다.
업로드 직후 파일을 지우지 않도록 최근 10분 이내 파일은 건너뛴다.

사용법:
    python3 tools/cleanup_media.py          # 정리 실행
    python3 tools/cleanup_media.py --dry    # 삭제 대상만 확인
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app import db  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description="고아 사진 파일 정리")
    parser.add_argument("--dry", action="store_true", help="삭제하지 않고 목록만 표시")
    args = parser.parse_args()

    db.init()
    used = db._referenced_media()          # noqa: SLF001 - 도구 스크립트
    files = [f for f in os.listdir(db.MEDIA_DIR)
             if os.path.isfile(os.path.join(db.MEDIA_DIR, f))]
    orphans = [f for f in files if f not in used]
    print(f"전체 {len(files)}개 · 참조됨 {len(files) - len(orphans)}개 · 미참조 {len(orphans)}개")

    if args.dry:
        for name in orphans:
            print("  (삭제 대상)", name)
        return

    result = db.cleanup_orphan_media()
    print(f"삭제 {result['deleted']}개 · 확보 {result['freedBytes'] / 1024:.1f}KB")
    print("※ 최근 10분 이내 업로드 파일은 안전을 위해 남겨둡니다.")


if __name__ == "__main__":
    main()

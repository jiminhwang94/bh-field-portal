"""오프라인 실행 보장 — 서비스워커 사전 캐시 목록 검사.

앱 화면 파일(js/css)을 하나라도 `web/sw.js` 의 SHELL 목록에 넣지 않으면,
인터넷이 없을 때 그 파일만 받지 못해 **앱이 아예 열리지 않는다.**
(실제로 v3.0 개발 중 net.js 누락으로 빈 화면이 나온 적이 있어 테스트로 고정한다)

실행: python3 tests/test_offline_shell.py
"""

import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, "web")
failures = []


def check(label, ok, detail=""):
    print(f"{'✅' if ok else '❌'} {label}" + (f" — {detail}" if detail else ""))
    if not ok:
        failures.append(label)


def shell_list() -> set:
    source = open(os.path.join(WEB, "sw.js"), encoding="utf-8").read()
    block = re.search(r"const SHELL = \[(.*?)\];", source, re.S)
    if not block:
        return set()
    return {m.group(1) for m in re.finditer(r"'\./([^']*)'", block.group(1))}


def js_and_css_files() -> set:
    out = set()
    for root, dirs, files in os.walk(WEB):
        dirs[:] = [d for d in dirs if d not in ("icons",)]
        for name in files:
            if not name.endswith((".js", ".css")):
                continue
            if name == "sw.js":
                continue        # 서비스워커 자신은 캐시 대상이 아니다
            rel = os.path.relpath(os.path.join(root, name), WEB)
            out.add(rel.replace(os.sep, "/"))
    return out


def imported_modules() -> set:
    """app.js 에서 시작해 import 로 이어지는 모듈을 모두 따라간다."""
    seen = set()
    queue = ["js/app.js"]
    while queue:
        rel = queue.pop()
        if rel in seen:
            continue
        path = os.path.join(WEB, rel)
        if not os.path.isfile(path):
            continue
        seen.add(rel)
        source = open(path, encoding="utf-8").read()
        for match in re.finditer(r"""from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]""",
                                 source):
            target = match.group(1) or match.group(2)
            if not target.startswith("."):
                continue
            base = os.path.dirname(os.path.join(WEB, rel))
            resolved = os.path.relpath(os.path.normpath(os.path.join(base, target)), WEB)
            queue.append(resolved.replace(os.sep, "/"))
    return seen


print("=" * 62)
print("오프라인 실행 보장 테스트 (서비스워커 사전 캐시 목록)")
print("=" * 62)

shell = shell_list()
check("SHELL 목록을 읽을 수 있다", bool(shell), f"{len(shell)}개")

files = js_and_css_files()
missing = sorted(files - shell)
check("모든 js/css 파일이 SHELL 목록에 있다", not missing,
      "빠짐: " + ", ".join(missing) if missing else f"{len(files)}개 확인")

# 실제로 import 로 이어지는 모듈은 하나라도 빠지면 앱이 열리지 않는다.
reachable = imported_modules()
critical = sorted(reachable - shell)
check("app.js 에서 이어지는 모듈이 모두 SHELL 에 있다", not critical,
      "빠짐: " + ", ".join(critical) if critical else f"{len(reachable)}개 확인")

stale = sorted(name for name in shell
               if name and not name.endswith("/")
               and not os.path.isfile(os.path.join(WEB, name)))
check("SHELL 목록에 없는 파일이 적혀 있지 않다", not stale,
      "없는 파일: " + ", ".join(stale) if stale else "")

check("index.html 과 시작 경로가 목록에 있다",
      "index.html" in shell and "" in shell)

version = re.search(r"const CACHE = '([^']+)'",
                    open(os.path.join(WEB, "sw.js"), encoding="utf-8").read())
check("캐시 이름에 버전이 붙어 있다 (새 버전 배포 시 갱신용)",
      bool(version) and version.group(1) != "bh-shell",
      version.group(1) if version else "")

print("=" * 62)
if failures:
    print(f"❌ 실패 {len(failures)}건: {', '.join(failures)}")
    sys.exit(1)
print("✅ 전부 통과 — 인터넷 없이도 앱이 열립니다.")

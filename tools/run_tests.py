"""검사 전부를 한 번에 — 개발 PC 와 GitHub(CI) 가 **같은 명령**을 쓴다.

tests/ 안의 test_*.py · test_*.mjs 를 모두 찾아 차례로 돌린다. 새 검사 파일을
만들면 따로 등록하지 않아도 여기와 CI 에서 함께 돈다 (예전에는 CI 목록에
적는 것을 잊으면 그 검사는 GitHub 에서 한 번도 돌지 않았다).

실행:  python tools/run_tests.py            (전부)
       python tools/run_tests.py guide sync (이름에 낱말이 든 것만)
       python tools/run_tests.py --e2e      (브라우저 검사까지 — tests/e2e)
"""
import os
import shutil
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TESTS = os.path.join(ROOT, "tests")


def find_node():
    """node 가 PATH 에 없어도 윈도우 기본 설치 자리를 본다."""
    found = shutil.which("node")
    if found:
        return found
    for guess in (r"C:\Program Files\nodejs\node.exe", "/usr/local/bin/node", "/opt/homebrew/bin/node"):
        if os.path.exists(guess):
            return guess
    return None


def main(argv):
    e2e = "--e2e" in argv
    words = [a for a in argv if not a.startswith("--")]
    node = find_node()
    files = sorted(f for f in os.listdir(TESTS)
                   if f.startswith("test_") and f.endswith((".py", ".mjs")))
    if words:
        files = [f for f in files if any(w in f for w in words)]

    env = dict(os.environ, PYTHONIOENCODING="utf-8")
    results = []
    for name in files:
        path = os.path.join(TESTS, name)
        if name.endswith(".py"):
            cmd = [sys.executable, path]
        else:
            if not node:
                results.append((name, None, 0.0, "node 를 찾지 못했습니다"))
                continue
            cmd = [node, path]
        start = time.time()
        proc = subprocess.run(cmd, cwd=ROOT, env=env, capture_output=True, text=True,
                              encoding="utf-8", errors="replace")
        took = time.time() - start
        tail = "\n".join((proc.stdout + proc.stderr).strip().splitlines()[-15:])
        results.append((name, proc.returncode == 0, took, tail))
        print(("  통과 " if proc.returncode == 0 else "  실패 ") + f"{name}  ({took:.1f}s)")

    if e2e:
        if not node:
            results.append(("e2e", None, 0.0, "node 를 찾지 못했습니다"))
        else:
            start = time.time()
            cli = os.path.join(ROOT, "node_modules", "@playwright", "test", "cli.js")
            proc = subprocess.run([node, cli, "test", "--reporter=line"], cwd=ROOT, env=env,
                                  capture_output=True, text=True, encoding="utf-8", errors="replace")
            tail = "\n".join((proc.stdout + proc.stderr).strip().splitlines()[-25:])
            results.append(("e2e (playwright)", proc.returncode == 0, time.time() - start, tail))
            print(("  통과 " if proc.returncode == 0 else "  실패 ") + "e2e (playwright)")

    bad = [r for r in results if r[1] is not True]
    print()
    print(f"검사 {len(results)}개 중 통과 {len(results) - len(bad)}개")
    for name, ok, _, tail in bad:
        print()
        print(f"── {name} {'(건너뜀)' if ok is None else ''}")
        print(tail)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

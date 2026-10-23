"""버전 올리기 · 배포 — 한 줄로.

버전은 세 곳에 적힌다. 손으로 고치면 하나씩 빠뜨린다 (실제로 sw.js 캐시 이름을 안 바꿔
태블릿이 옛 화면을 계속 봤다).
  web/js/version.js          APP_VERSION      — 앱이 보는 버전
  web/sw.js                  bh-shell-vX.Y.Z  — 바뀌어야 태블릿이 새 화면 파일을 받는다
  android/app/build.gradle   appVersionName   — APK 버전 (CI 가 여기서 읽는다)

쓰는 법:
  python tools/release.py 3.30.0            세 곳 바꾸기 + CHANGELOG 칸 + 검사 + 커밋
  python tools/release.py 3.30.0 --tag      ↑ + vX.Y.Z 태그 (main 에서만) → push 하면 APK 자동 빌드
  python tools/release.py --check           세 곳이 같은지만 본다 (CI · 검사가 쓴다)

태그를 올리면(git push origin v3.30.0) GitHub 가 APK 를 만들어 Releases · Dropbox · 시트
'앱 버전' 탭에 올린다 (.github/workflows/android.yml). google-apps-script.gs 는 main 에
합쳐질 때 따로 자동 배포된다 (.github/workflows/apps-script.yml).
"""
import datetime
import io
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FILES = {
    "version.js": (os.path.join("web", "js", "version.js"), r"APP_VERSION = '([0-9.]+)'", "APP_VERSION = '{v}'"),
    "sw.js": (os.path.join("web", "sw.js"), r"bh-shell-v([0-9.]+)", "bh-shell-v{v}"),
    "build.gradle": (os.path.join("android", "app", "build.gradle"), r'appVersionName = "([0-9.]+)"', 'appVersionName = "{v}"'),
}


def read(rel):
    return io.open(os.path.join(ROOT, rel), encoding="utf-8").read()


def write(rel, text):
    io.open(os.path.join(ROOT, rel), "w", encoding="utf-8", newline="\n").write(text)


def current():
    out = {}
    for name, (rel, pattern, _) in FILES.items():
        m = re.search(pattern, read(rel))
        out[name] = m.group(1) if m else None
    return out


def git(*args):
    return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, encoding="utf-8")


def main(argv):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    versions = current()
    if "--check" in argv:
        same = len(set(versions.values())) == 1 and None not in versions.values()
        print(("같음 " if same else "어긋남 ") + " · ".join(f"{k}={v}" for k, v in versions.items()))
        return 0 if same else 1

    args = [a for a in argv if not a.startswith("--")]
    if not args or not re.fullmatch(r"\d+\.\d+\.\d+", args[0]):
        print(__doc__)
        return 2
    new = args[0]
    old = versions["version.js"]
    for name, (rel, pattern, repl) in FILES.items():
        text = read(rel)
        text, n = re.subn(pattern, repl.format(v=new), text, count=1)
        if n != 1:
            print(f"{rel} 에서 버전 자리를 찾지 못했습니다.")
            return 1
        write(rel, text)
    print(f"버전 {old} → {new} (version.js · sw.js · build.gradle)")

    notes = read(os.path.join("web", "js", "patchnotes.js"))
    if f"version: '{new}'" not in notes:
        print(f"⚠ web/js/patchnotes.js 에 v{new} 패치 내용이 없습니다 — 현장 사람이 볼 짧은 문장을 맨 위에 더해 주세요.")

    changelog = read("CHANGELOG.md")
    if f"## [{new}]" not in changelog:
        today = datetime.date.today().isoformat()
        stub = f"## [{new}] - {today}\n> (한 줄 요약)\n\n### 바뀜\n- \n\n"
        anchor = re.search(r"^## \[\d", changelog, re.M)
        changelog = changelog[:anchor.start()] + stub + changelog[anchor.start():] if anchor else changelog + "\n" + stub
        write("CHANGELOG.md", changelog)
        print("CHANGELOG.md 에 빈 칸을 만들었습니다 — 바뀐 내용을 적어 주세요.")

    if "--skip-tests" not in argv:
        print("검사를 돌립니다…")
        code = subprocess.run([sys.executable, os.path.join(ROOT, "tools", "run_tests.py")], cwd=ROOT).returncode
        if code:
            print("검사가 실패해 커밋하지 않았습니다. 고친 뒤 다시 하세요 (버전 숫자는 이미 바뀌어 있습니다).")
            return code

    git("add", *[rel for rel, _, _ in FILES.values()], "CHANGELOG.md")
    msg = f"v{new} — 버전 올림\n\nversion.js · sw.js 캐시 · build.gradle 을 함께 바꿈 (tools/release.py)"
    r = git("commit", "-m", msg)
    print(r.stdout.strip() or r.stderr.strip())

    if "--tag" in argv:
        branch = git("rev-parse", "--abbrev-ref", "HEAD").stdout.strip()
        if branch != "main":
            print(f"태그는 main 에서만 붙입니다 (지금 {branch}). PR 을 합친 뒤 main 에서 --tag 로 다시 하세요.")
            return 0
        r = git("tag", "-a", f"v{new}", "-m", f"v{new}")
        print(r.stderr.strip() or f"태그 v{new} 를 붙였습니다.")
        print(f"이제: git push origin main && git push origin v{new}   (태그가 올라가면 APK 가 자동으로 만들어집니다)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

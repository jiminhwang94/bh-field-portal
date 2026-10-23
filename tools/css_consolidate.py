"""흩어진 선택자 모으기 — 화면 검사(스타일 지문)가 "같다" 고 확인한 것만 남긴다.

css_tidy.py 는 증명되는 것만 고친다. 그래도 남는 것(같은 선택자가 두세 곳)은
사이에 같은 속성 묶음을 쓰는 규칙이 있어 증명이 안 된다. 대부분은 실제로는 같은
요소에 안 걸리는 규칙이라 합쳐도 된다. 그것을 **실제 화면**으로 확인한다.

  1. 흩어진 선택자를 한꺼번에 첫 자리로 합친다 → 스타일 지문 비교
  2. 다르면 반으로 나눠 다시 (어느 것이 문제인지 좁힌다)
  3. 같다고 나온 것만 남긴다

실행: python tools/css_consolidate.py web/css/base.css  (v3.30 에서 한 파일이던 때 한 번 썼다)
(화면 서버 · 가짜 시트 서버를 Playwright 가 띄운다. 스타일 기준 파일이 있어야 한다)
"""
import io
import os
import shutil
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import css_tidy as t  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def scattered(text):
    rules = t.flatten(t.parse(text))
    seen = {}
    for ctx, r in rules:
        if r.decls():
            seen.setdefault((ctx, r.key), []).append(r)
    return [k for k, v in seen.items() if len(v) > 1]


def force_merge(text, keys):
    """keys 의 뒤 규칙들을 첫 규칙으로 옮긴다 (사이 규칙 검사 없이)."""
    nodes = t.parse(text)
    rules = t.flatten(nodes)
    for key in keys:
        group = [r for c, r in rules if (c, r.key) == key and r.decls()]
        first = group[0]
        for later in group[1:]:
            for d in later.decls():
                first.items.append(t.Decl(d.prop, d.value, d.important))
            later.items = [x for x in later.items if not isinstance(x, t.Decl)]
            later.dirty = first.dirty = True
    # 합친 뒤 같은 규칙 안에서 앞의 같은 속성은 죽은 선언 — 지운다
    for _, r in t.flatten(nodes):
        seen, drop = {}, set()
        for i, d in enumerate(r.items):
            if isinstance(d, t.Decl):
                if d.prop in seen and not any(x in d.value for x in t.RISKY):
                    drop.add(seen[d.prop])
                seen[d.prop] = i
        if drop:
            r.items = [d for i, d in enumerate(r.items) if i not in drop]
            r.dirty = True
    return t.render(nodes)


def node():
    return shutil.which("node") or r"C:\Program Files\nodejs\node.exe"


def same_styles():
    cli = os.path.join(ROOT, "node_modules", "@playwright", "test", "cli.js")
    proc = subprocess.run([node(), cli, "test", "styles", "--project=tablet", "--reporter=line"],
                          cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace")
    return proc.returncode == 0


def main(path):
    original = io.open(path, encoding="utf-8").read()
    keys = scattered(original)
    print(f"흩어진 선택자 {len(keys)}개")
    accepted = []

    def attempt(group):
        trial = force_merge(original, accepted + group)
        io.open(path, "w", encoding="utf-8", newline="\n").write(trial)
        ok = same_styles()
        print(f"  {'같음' if ok else '다름'}  {len(group)}개  {', '.join(k[1][:28] for k in group[:4])}{' …' if len(group) > 4 else ''}")
        return ok

    def solve(group):
        if not group:
            return
        if attempt(group):
            accepted.extend(group)
            return
        if len(group) == 1:
            return
        mid = len(group) // 2
        solve(group[:mid])
        solve(group[mid:])

    solve(keys)
    final = force_merge(original, accepted)
    io.open(path, "w", encoding="utf-8", newline="\n").write(final)
    print(f"모은 것 {len(accepted)} / {len(keys)} · 줄 수 {original.count(chr(10))} → {final.count(chr(10))}")
    left = [k for k in keys if k not in accepted]
    for ctx, key in left:
        print(f"  남김: {key}  {' '.join(ctx)}")


if __name__ == "__main__":
    main(sys.argv[1])

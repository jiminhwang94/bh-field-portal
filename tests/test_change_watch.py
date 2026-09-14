"""새 내용 알림 · 올렸다는 확인 — 화면은 건드리지 않고 알리는지.

자동 새로고침을 걷어낸 뒤(v3.22) ① 내 것이 올라갔다는 확인과 ② 남이 올린 새 내용이
있다는 사실이 보이지 않게 됐다. v3.24 는 5분마다 시트의 **바뀐 시각 한 줄만** 묻고
[새로고침] 에 점을 켠다. 자료를 저절로 받아 오거나 화면을 다시 그리면 6번 피드백이
되살아나므로, 그 선을 넘지 않는지 여기서 본다.

실행: python tests/test_change_watch.py
"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
fails = []


def read(*parts):
    return io.open(os.path.join(ROOT, *parts), encoding="utf-8").read()


def check(name, ok, detail=""):
    print(("  OK   " if ok else "  실패 ") + name + (("  - " + detail) if detail and not ok else ""))
    if not ok:
        fails.append(name)


changes = read("web", "js", "changes.js")
sync = read("web", "js", "sync.js")
syncnow = read("web", "js", "syncnow.js")
app = read("web", "js", "app.js")
css = read("web", "css", "app.css")
sw = read("web", "sw.js")
gs = read("google-apps-script.gs")

print("== 남이 올린 새 내용 — 점만 켠다")
check("시트에 바뀐 시각 한 줄만 묻는다", "callAppsScript({ changed: true }, 15000)" in changes
      and "function handleChanged(ss)" in gs and "getLastUpdated().toISOString()" in gs)
check("5분마다 · 앱으로 돌아올 때 · 인터넷이 돌아올 때", "const GAP_MS = 5 * 60 * 1000;" in changes
      and "visibilitychange" in changes and "sync.onNetChange(" in changes)
check("아는 시각과 다르면 [새로고침] 에 점", "hasNew = stamp !== known;" in changes
      and "btn.classList.toggle('has-new', hasNew);" in changes
      and ".btn-update.has-new::before" in css)
check("글자로도 말한다 — '새 내용 · 새로고침'", "'새 내용 · 새로고침'" in changes)
# 여기가 선이다. 자료를 받아 오거나 화면을 다시 그리면 6번 피드백이 되살아난다.
check("자료를 저절로 받지 않는다", "pullInventory" not in changes and "pullFields" not in changes
      and "pullGuides" not in changes and "runRefresh" not in changes)
check("화면을 다시 그리지 않는다", "hashchange" not in changes and "innerHTML" not in changes)
check("예전 Apps Script(시각을 안 줌)면 아무 표시도 하지 않는다", "if (!stamp) return hasNew;" in changes)

print()
print("== 내 것이 올라갔다는 확인")
check("자동 올리기가 무엇을 올렸는지 종류별로 센다", "result.sentByType[op.type]" in sync
      and "const before = await store.outbox();" in sync)
check("올린 뒤 한 줄 알림 — '시트에 올렸습니다 · 재고 2건'", "toast(`시트에 올렸습니다" in changes
      and "export function describeSent(byType)" in changes)
check("내 변경은 '새 내용' 으로 뜨지 않는다 (올린 뒤 시각을 아는 것으로)",
      "checkChanges({ absorb: true, keepNew: true });" in changes)
# 남의 변경으로 이미 점이 켜져 있을 때 내 올리기가 그 점을 꺼 버리면 안 된다.
check("이미 켜진 점은 내 올리기가 끄지 않는다", "if (keepNew && hasNew) return hasNew;" in changes)

print()
print("== 받으면 점이 꺼진다")
check("[새로고침] 을 마치면 지금 시각을 아는 것으로", "c.markSynced()" in syncnow
      and "export const markSynced = () => checkChanges({ absorb: true });" in changes)
check("받는 중(disabled)에는 버튼 글자를 건드리지 않는다", "if (!btn || btn.disabled) return;" in changes)

print()
print("== 올린 뒤 화면을 다시 그리던 옛 갈래가 없다")
net = read("web", "js", "net.js")
# 자동 올리기가 끝날 때마다 hashchange 를 던져 화면 전체를 다시 그렸다 — 적는 중 저절로 바뀌던 원인.
# (부팅 때 최신본을 받아 한 번 그리는 catchUpFromSheet 의 hashchange 는 그대로다 — 그건 부팅이다.)
check("올린 뒤 화면을 다시 그리지 않는다 (올리기 뒤 갈래는 칩만 맞춘다)",
      "sync.onNetChange(() => paint());" in net and "work.flushed" not in net)
check("옛 건수 알림이 없다 (changes.js 가 종류별로 말한다)", "건을 처리했습니다" not in net)

print()
print("== 붙어 있다")
check("부팅 때 시작한다", "c.initChangeWatch()" in app)
check("오프라인에서도 앱이 열린다 (캐시 목록)", "'./js/changes.js'" in sw)

print()
if fails:
    print("실패 %d건: %s" % (len(fails), ", ".join(fails)))
    sys.exit(1)
print("전부 통과 — 알리되 화면은 건드리지 않습니다.")

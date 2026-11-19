"""새 내용 알림 · 올렸다는 확인 — 화면은 건드리지 않고 알리는지.

자동 새로고침을 걷어낸 뒤(v3.22) ① 내 것이 올라갔다는 확인과 ② 남이 올린 새 내용이
있다는 사실이 보이지 않게 됐다. v3.24 는 5분마다 시트의 **바뀐 시각 한 줄만** 묻고
[새로고침] 에 점을 켠다. 자료를 저절로 받아 오거나 화면을 다시 그리면 6번 피드백이
되살아나므로, 그 선을 넘지 않는지 여기서 본다.

(43) 파일 이름 · 줄 모양에 묶이지 않는다 — 알림을 맡은 모듈은 initChangeWatch 를
정의한 파일로 찾고, 코드는 공백 · 따옴표를 따지지 않고 본다 (tests/_src.py).
시트 쪽(바뀐 시각 · 자료 안 딸려 옴)은 test_apps_script.mjs 가 실제로 돌려 본다.

실행: python tests/test_change_watch.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _src import body, calls, defines, has, has_re, has_selector, module_of, module_with  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(("  OK   " if ok else "  실패 ") + name + (("  - " + detail) if detail and not ok else ""))
    if not ok:
        fails.append(name)


# 알림을 맡은 모듈 — 옮기거나 나눠도 initChangeWatch 를 정의한 곳이 그곳이다.
watch = module_of("initChangeWatch")
check("알림 모듈이 있다 (initChangeWatch)", bool(watch))

print("== 남이 올린 새 내용 — 점만 켠다")
check("시트에 바뀐 시각 한 줄만 묻는다",
      any(has_re(r"changed\s*:\s*true", a) for a in calls("callAppsScript")))
check("5분마다 · 앱으로 돌아올 때 · 인터넷이 돌아올 때",
      has_re(r"5\s*\*\s*60\s*\*\s*1000|300000", watch)
      and "visibilitychange" in watch and "onNetChange(" in watch)
# [새로고침] 버튼을 그리는 곳 — 어느 파일로 옮겨도 버튼 id 를 쓴다
button = module_with("'btn-update'")
check("아는 시각과 다르면 [새로고침] 에 점",
      has_re(r"classList\.toggle\(\s*['\"]has-new['\"]", button)
      and has_selector(".btn-update.has-new"))
check("글자로도 말한다 — '새 내용 · 새로고침'", has("새 내용 · 새로고침"))
# 여기가 선이다. 자료를 받아 오거나 화면을 다시 그리면 6번 피드백이 되살아난다.
check("자료를 저절로 받지 않는다",
      bool(watch) and not has_re(r"pull(Inventory|Fields|Guides|Driving)|runRefresh", watch))
check("화면을 다시 그리지 않는다", bool(watch) and "hashchange" not in watch and "innerHTML" not in watch)
check("예전 Apps Script(시각을 안 줌)면 아무 표시도 하지 않는다",
      has_re(r"if\s*\(\s*!\s*(\w+)\s*\)\s*return\b", body("checkChanges")))

print()
print("== 내 것이 올라갔다는 확인")
check("자동 올리기가 무엇을 올렸는지 종류별로 센다", has_re(r"sentByType\s*\[\s*\w+\.type\s*\]"))
check("올린 뒤 한 줄 알림 — '시트에 올렸습니다 · 재고 2건'",
      has("시트에 올렸습니다") and defines("describeSent"))
check("내 변경은 '새 내용' 으로 뜨지 않는다 (올린 뒤 시각을 아는 것으로)",
      any("absorb" in a and "keepNew" in a for a in calls("checkChanges")))
# 남의 변경으로 이미 점이 켜져 있을 때 내 올리기가 그 점을 꺼 버리면 안 된다.
check("이미 켜진 점은 내 올리기가 끄지 않는다",
      has_re(r"if\s*\([^)]*keepNew[^)]*\)\s*return", body("checkChanges")))

print()
print("== 받으면 점이 꺼진다")
check("[새로고침] 을 마치면 지금 시각을 아는 것으로",
      bool(calls("markSynced")) and "absorb" in body("markSynced"))
check("받는 중(disabled)에는 버튼 글자를 건드리지 않는다",
      has_re(r"\.disabled\s*\)\s*return", button))

print()
print("== 올린 뒤 화면을 다시 그리던 옛 갈래가 없다")
# 자동 올리기가 끝날 때마다 hashchange 를 던져 화면 전체를 다시 그렸다 — 적는 중 저절로 바뀌던 원인.
# (부팅 때 최신본을 받아 한 번 그리는 catchUpFromSheet 의 hashchange 는 그대로다 — 그건 부팅이다.)
net_status = body("initNetStatus")
check("올린 뒤 화면을 다시 그리지 않는다 (올리기 뒤 갈래는 칩만 맞춘다)",
      "onNetChange(" in net_status and "hashchange" not in net_status and "flushed" not in net_status)
check("옛 건수 알림이 없다 (알림 모듈이 종류별로 말한다)", not has("건을 처리했습니다"))

print()
print("== 붙어 있다")
check("부팅 때 시작한다", bool(calls("initChangeWatch")))

print()
if fails:
    print("실패 %d건: %s" % (len(fails), ", ".join(fails)))
    sys.exit(1)
print("전부 통과 — 알리되 화면은 건드리지 않습니다.")

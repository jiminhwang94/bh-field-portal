# 로봇 현장 대응 포털 (Field Quick-Fix)

로봇 필드 엔지니어가 현장에서 쓰는 태블릿 앱입니다.
**장애 대응 가이드 → 현장 리포트 → 차량 재고 · 운행일지**를 한 흐름으로 처리하고,
기록은 팀 공용 **구글 스프레드시트**에, 사진 · 영상은 팀 **공유 드라이브**에 쌓입니다.

- 쓰는 사람: 필드 엔지니어(안드로이드 태블릿 · 폰에 APK 로 설치), 시트를 보는 사무실
- **오프라인에서도 거의 전부 동작** — 자료가 기기 안에 있고, 인터넷이 되면 저절로 올라갑니다
- 화면은 순수 HTML/CSS/JS (번들러 · 외부 라이브러리 없음), Pretendard 서체를 앱 안에 담았습니다

---

## 구조 한눈에

1. **앱** — `web/` 의 PWA. 안드로이드는 이 파일을 통째로 담은 WebView APK(`android/`)로 설치합니다.
2. **기기 저장소** — IndexedDB. 가이드 · 재고 · 리포트 · 사진이 여기 있고, 바꾼 것은 `outbox` 대기열에 쌓입니다.
3. **올리기는 자동** — 인터넷이 되면 대기열을 Apps Script 웹 앱으로 보냅니다. 상단 [새로고침] 은 *받기* 버튼입니다.
4. **서버** — `google-apps-script.gs` (스프레드시트에 붙은 Apps Script 웹 앱). main 에 합치면 자동 배포됩니다.
5. **자료 원본** — 구글 시트(월별 리포트 탭 · 가이드 · 재고 · 기기 · 변경기록 · 휴지통 …) + 공유 드라이브(첨부 · 매일 백업).

> 사무실 서버는 없습니다. `server.py` 는 개발 · 화면 검사(E2E)용으로 `web/` 파일만 내줍니다.

---

## 개발용으로 실행하기

필요한 것: **Python 3.10 이상**(표준 라이브러리만), **Node 24** (`.nvmrc`).

```bash
npm ci                                   # 처음 한 번 — 타입 검사기 · Playwright (개발 도구만)
python server.py                         # 화면 → http://localhost:8787
node tools/fake_sheet_server.mjs         # 가짜 시트 → http://127.0.0.1:8790/exec
```

- 윈도우는 `실행하기.bat`, 맥은 `실행하기.command` 를 더블클릭해도 `server.py` 가 뜹니다.
- 가짜 시트는 `google-apps-script.gs` 를 PC 에서 그대로 돌립니다 (`tests/fake_gas.mjs`).
  앱 **설정 → 테스트 모드** 에 위 주소를 넣고 켜면 팀 시트를 건드리지 않고 저장 · 삭제를 눌러 볼 수 있습니다.
  `--data fake-sheet.json` 을 붙이면 껐다 켜도 내용이 남습니다.
- 테스트 모드를 켜지 않으면 앱은 **팀 시트**에 붙습니다 (주소가 앱에 들어 있습니다). 조심하세요.

### 검사

```bash
python tools/run_tests.py                # 단위 · 계약 검사 전부 (CI 와 같은 명령)
python tools/run_tests.py guide sync     # 이름에 낱말이 든 것만
npm run e2e                              # 화면 검사 (Playwright) — 화면 서버 · 가짜 시트를 저절로 띄운다
python tools/run_tests.py --e2e          # 둘 다
```

- `tests/test_*.py` · `tests/test_*.mjs` 를 전부 찾아 돌립니다. 새 검사 파일은 따로 등록하지 않아도 됩니다.
- 윈도우 터미널에서 한글이 깨지면 `PYTHONIOENCODING=utf-8` 을 붙이세요.
- 개발 PC 의 화면 검사는 이미 깔린 **Edge** 를 씁니다 (CI 는 크로미움).

### 일하는 순서

브랜치 → PR → CI 가 초록이면 main 에 합칩니다. 버전을 올릴 때는 `python tools/release.py X.Y.Z` 한 줄,
태그와 APK 는 main 에 합쳐질 때 CI 가 만듭니다. 자세한 것은 [구조](docs/구조.md) · [운영](docs/운영.md).

---

## 문서

| 문서 | 누가 | 내용 |
|---|---|---|
| [docs/사용법.md](docs/사용법.md) | 필드 엔지니어 | 화면 · 리포트 쓰기 · 오프라인 · APK 설치와 업데이트 · [패치 내용] |
| [docs/운영.md](docs/운영.md) | 관리자 | 배포 · 되돌리기 · 매일 백업에서 살리기 · 서명 키 · 매일 상태 점검 · 휴지통 · 태블릿이 시트에 못 닿을 때 |
| [docs/구조.md](docs/구조.md) | 개발자 | 모듈 · IndexedDB · 올리기 흐름 · 시트 탭 · Apps Script 요청 · 파일 구조 · 검사 · 배포 흐름 |
| [CHANGELOG.md](CHANGELOG.md) | 모두 | 버전마다 바뀐 것 |
| [docs/archive/](docs/archive/) | — | 지난 계획 · 작업 일지 (기록용, 지금 코드와 다를 수 있음) |

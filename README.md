# 로봇 현장 대응 포털 (Field Quick-Fix)

로봇 필드 엔지니어의 **현장 셀프 장애 대응 → 차량 재고 관리 → 리포트 구글 시트 자동 기록**을
하나의 흐름으로 처리하는 태블릿/PC 웹 앱.

- 설치 프로그램·빌드 도구 없음. **Python 표준 라이브러리만** 사용 (3.10 에서 검증)
- 프런트엔드는 순수 HTML/CSS/JS (번들러 없음), 다크모드 자동
- 리포트는 **구글 스프레드시트**에 월별 시트로 기록 (사진은 시트에 **이미지로 삽입**)
- 데이터 변경은 **[⬆️ 업데이트]** 를 눌러야 모든 사용자에게 적용됨
- **온라인 전용** (인터넷 연결 상태에서 사용)

접속 주소: 서버를 띄운 PC 의 주소 (예: `http://localhost:8787`,
태블릿에서는 같은 Wi-Fi 의 `http://192.168.0.x:8787`) — 실행 시 터미널에 표시됩니다.

---

## 1. 실행

### macOS
`실행하기.command` 더블클릭. 또는:

```bash
python3 server.py
```

### Windows
`실행하기.bat` 더블클릭. 또는:

```bash
python server.py
```

옵션: `--port 9000` / `--host 127.0.0.1`(이 PC 전용) / `--https`(자체 서명 인증서 자동 생성)

### 도메인으로 접속하려면 (선택)
지금은 **PC 주소로 접속**합니다. `errorcode.beyondhoneycomb.com` 같은 도메인을 쓰려면
DNS 와 리버스 프록시 설정이 필요합니다(앱 코드는 그대로 사용 가능).

1. 서버를 상시 실행할 곳을 정한다 (사내 서버 또는 클라우드)
2. DNS 에 `errorcode` 레코드를 그 서버로 등록
3. 앞단에 HTTPS 리버스 프록시를 두고 `127.0.0.1:8787` 로 전달
   - Caddy 예시: `errorcode.beyondhoneycomb.com { reverse_proxy 127.0.0.1:8787 }`
4. 앱 `⚙️ 설정 → 서비스 주소` 에 그 도메인을 입력 (비워 두면 접속한 주소를 자동 사용)

---

## 2. 화면 구성

| 화면 | 경로 | 내용 |
|---|---|---|
| 메인 | `#/` | 통합 검색 + 카테고리 카드 3종 + 최근 수정 가이드 |
| 오류 코드 가이드 | `#/guides/ERROR_CODE` | 정량 측정 수치 기반 단계별 진단 |
| 하드웨어 교체 SOP | `#/guides/HARDWARE_SOP` | 공구, 분해/조립 순서, 토크값, 사진 |
| SW & 명령어 | `#/guides/SOFTWARE_CMD` | 펌웨어·캘리브레이션 명령어 + 원클릭 복사 |
| 가이드 작성/수정 | `#/guides/new/{타입}`, `#/guides/edit/{id}` | 현장에서 직접 생성·수정·삭제 |
| 차량 재고 | `#/inventory` | 차량 탭, `[-]/[+]` 수량 조절, 품목·차량 추가/삭제 |
| 항목 설정 | `#/fields` | 리포트 입력 항목 추가/수정/삭제/순서변경 |
| 새 현장 리포트 | `#/report/new` | 동적 폼 입력 → 구글 시트 업로드 |
| 리포트 이력 | `#/reports` | 업로드 상태 확인 및 재업로드 |
| 설정 | `#/settings` | 구글 시트 연결, 업데이트, 앱 설치, 서비스 주소 |

현장에서 쓰기 좋은 동작
- **단계 체크리스트**: 가이드 단계를 탭해 완료 체크 (기기에 저장)
- **명령어 복사**: 버튼 1회 터치 (HTTP 환경에서도 동작하는 폴백 포함)
- **리포트 임시보관**: 입력 즉시 기기에 저장 → 새로고침해도 복구
- **사진 촬영/첨부**: 태블릿 카메라 바로 호출

---

## 3. 구글 시트 연결 (한 번만 설정)

리포트는 공유 스프레드시트에 기록됩니다.
`https://docs.google.com/spreadsheets/d/1ywec2wKj0thmI0uPZeqNwCGpbD75TJ9s7Yc20iP_0z4/edit`

구글 Sheets API 는 OAuth/서비스 계정이 필요해 일반 팀원이 쓰기 어렵습니다.
그래서 **스프레드시트에 붙이는 Apps Script 웹 앱**으로 기록합니다 —
**구글 계정이나 토큰을 앱에 넣지 않습니다.** 스프레드시트 편집 권한만 있으면 됩니다.

1. 위 스프레드시트를 열고 **[확장 프로그램] → [Apps Script]**
2. 기본 코드를 지우고 프로젝트의 **`google-apps-script.gs`** 내용을 붙여넣고 저장
3. **[배포] → [새 배포] → 유형 [웹 앱]**
   - 실행 사용자: **나**
   - 액세스 권한: **모든 사용자** ← 반드시
4. **[배포]** → 권한 승인 → **웹 앱 URL 복사** (`.../exec` 로 끝남)
5. 앱 `⚙️ 설정 → 구글 시트 연결` 에 URL 붙여넣고 **[저장] → [연결 테스트]**

설정 화면의 **[📖 설치 방법]** 버튼에도 같은 안내가 있습니다.

### 기록 규칙
- **월마다 새 시트**를 만든다 (시트 이름 = `YYYY-MM`, 예: `2026-08`)
- **1행은 공백**
- **2행에 전체 항목명** (열 순서 = `🧩 항목 설정` 순서, 앞에 `작성일시`·`작성자` 2열)
- **3행부터** 리포트가 한 줄씩 쌓인다
- 항목 설정을 바꾸면 2행 헤더가 자동으로 갱신된다
- **사진은 링크가 아니라 이미지 자체가 해당 칸에 삽입된다.** 여러 장이면 가로로 나란히 배치되고
  행 높이가 자동으로 늘어난다. (앱이 사진 바이트를 보내고 스크립트가 `insertImage` 로 넣는다)
- 태블릿 사진은 업로드 전에 **최대 1600px / JPEG 로 자동 축소**된다 (4MB → 약 300KB).
  원본은 서버 `data/media/` 에 그대로 보관된다.
- 영상·PDF 는 시트에 넣을 수 없어 링크로 기록된다. 이때만 `서비스 주소`가 쓰인다.

동시에 여러 명이 올려도 줄이 섞이지 않도록 스크립트에 잠금(LockService)이 걸려 있습니다.

---

## 4. [⬆️ 업데이트] — 변경 내용을 모든 사용자에게 적용

가이드·차량 재고·항목 설정을 바꾸면 **내 화면에만** 반영됩니다.
상단 **[⬆️ 업데이트]** 를 눌러야 모든 사용자가 보는 내용이 됩니다.

| 상태 | 표시 |
|---|---|
| 모든 사용자와 같은 내용 | 회색 `업데이트` |
| 적용 안 된 내 변경 있음 | **노란색** `업데이트 ●` (깜빡임) |

- **다른 사람이 업데이트하면**, 내 변경이 없는 한 **자동으로 최신 내용을 받습니다.** (별도 버튼 없음)
- 내 변경이 있는 상태에서 다른 사람이 먼저 업데이트했다면, 업데이트 시 **경고**가 표시됩니다.
  (내 화면 내용이 최종본이 되므로) 필요하면 `⚙️ 설정 → [내 변경 버리고 최신 받기]` 를 쓰세요.
- **리포트는 개인 데이터**라 업데이트로 공유되지 않습니다. 팀 공유는 구글 시트가 담당합니다.

### 내부 구조
| 파일 | 역할 |
|---|---|
| `data/app.db` | **공개본** — 모든 사용자가 보는 확정 내용 |
| `data/drafts/<기기ID>.db` | **작업본** — 그 기기의 편집 중 내용 (공개본 복사로 생성) |

`[업데이트]` = 내 작업본의 공유 테이블(가이드·단계·차량·재고·항목)을 공개본으로 복사 + 버전 +1.
기기 구분은 브라우저가 보내는 `X-Device-Id` (최초 접속 시 자동 생성, localStorage 보관).

---

## 5. 앱으로 설치

`⚙️ 설정 → 📱 앱 설치` 의 **[📲 앱 설치하기]** 버튼을 누르면 설치됩니다.
설치하면 홈 화면 아이콘 · 전체화면으로 실행됩니다.

| 기기 | 방법 |
|---|---|
| Android 태블릿 / PC (Chrome·Edge) | 버튼을 누르면 설치창이 바로 뜸 |
| iPad / iPhone | 애플 정책상 **Safari → 공유 ⬆️ → [홈 화면에 추가]** (버튼을 누르면 안내가 나옴) |

⚠️ **Play 스토어 / App Store 에서 검색해 설치하는 앱이 아닙니다.**
`"Google Play AR 서비스 필요"` 류의 오류는 ARCore 를 쓰는 다른 앱의 메시지이며 이 앱과 무관합니다.
스토어에서 받은 앱은 삭제하고, 브라우저에서 위 방법으로 설치하세요.

---

## 6. 데이터 구조

| 테이블 | 내용 | 업데이트로 공유 |
|---|---|---|
| `guide_master` / `guide_step` | 가이드와 단계 (`commands` 는 JSON 문자열) | ✅ |
| `vehicle` | 차량 목록 | ✅ |
| `vehicle_inventory` | 차량별 재고 (`min_quantity` 이하 = 보충 필요) | ✅ |
| `report_field_config` | 리포트 입력 항목 (구글 시트 열 순서) | ✅ |
| `report` | 작성한 리포트 + 업로드 상태 | ❌ 기기별 |
| `media` | 업로드 사진 메타 | ❌ 기기별 |
| `app_setting` | 구글 시트 연결·서비스 주소(공통), 기기 이름(기기별) | 일부 |

### API 요약
```
GET    /api/meta                    GET  /api/version
GET    /api/state                   ← [업데이트] 버튼 상태 (+ 자동 최신 반영)
POST   /api/publish                 ← 내 작업본을 모든 사용자에게 적용
POST   /api/take-latest             ← 내 변경 버리고 최신 받기
GET    /api/guides?type=&q=         POST /api/guides
GET    /api/guides/{id}             PUT/DELETE /api/guides/{id}
GET    /api/vehicles                POST /api/vehicles
DELETE /api/vehicles/{name}
GET    /api/inventory?vehicle=      POST /api/inventory
PATCH  /api/inventory/{id}          DELETE /api/inventory/{id}
GET    /api/report-fields           POST /api/report-fields
PUT    /api/report-fields/{id}      DELETE /api/report-fields/{id}
POST   /api/report-fields/reorder
GET    /api/reports                 POST /api/reports
GET    /api/reports/{id}            PUT/DELETE /api/reports/{id}
POST   /api/reports/{id}/sheet      ← 구글 시트 업로드
GET    /api/settings                PUT  /api/settings
POST   /api/settings/sheets-test
POST   /api/media?filename=...      GET  /media/{filename}
```
모든 요청에 `X-Device-Id` 헤더가 함께 전송됩니다.

---

## 7. 파일 구조

```
코드/
├── server.py                  HTTP 서버 · 라우팅 · 정적 파일
├── app/
│   ├── db.py                  SQLite · 공개본/작업본 · 업데이트(publish)
│   ├── api.py                 REST 라우팅 · 입력 검증 · 업로드
│   └── sheets.py              구글 시트(Apps Script) 업로드
├── google-apps-script.gs      ★ 스프레드시트에 붙여넣는 기록 스크립트
├── web/
│   ├── index.html
│   ├── manifest.webmanifest   앱 설치 정보
│   ├── icons/                 앱 아이콘
│   ├── css/app.css
│   └── js/
│       ├── app.js             해시 라우터 + 메인/검색
│       ├── api.js             REST 래퍼 (기기 ID 부착)
│       ├── ui.js              토스트 · 모달 · 클립보드
│       ├── publish.js         [업데이트] 상태·실행
│       ├── share.js           리포트 텍스트/카카오톡 공유(보조)
│       ├── install.js         앱 설치 버튼
│       ├── update.js          앱 화면 코드 자동 갱신
│       └── views/             guides · inventory · fields · report · settings
├── data/                      app.db(공개본) · drafts/ · media/   ← 백업 대상
├── 실행하기.command            macOS 실행
└── 실행하기.bat                Windows 실행
```

---

## 8. 운영 참고

- **백업**: `data/` 폴더만 복사하면 전체 데이터가 보존된다.
- **초기화**: `data/` 를 삭제하고 다시 실행하면 샘플 가이드/재고/항목이 새로 생성된다.
- **작업본 정리**: `data/drafts/` 를 삭제하면 모든 기기가 공개본 기준으로 새로 시작한다.
- **보안**: 앱 자체에 로그인 기능이 없다. 도메인으로 공개할 때는 리버스 프록시에서
  기본 인증이나 사내망 제한을 두는 것을 권장한다.
- **업로드 제한**: 파일 1개당 40MB, 이미지/영상/음성/PDF 만 허용.
- **화면 코드 갱신**: 서버 코드가 바뀌면 태블릿이 다음 이동/복귀 시 자동으로 새로 받는다.

# 로컬 개발 환경 세팅 (Windows)

## 날짜
2026-08-25

## 요약
`jiminhwang94/bh-field-portal` 저장소를 Windows PC 에 클론하고, 배포 전 로컬에서 구현·검증할 수 있는 실행 환경을 구성했다.

## 수행 내용
- 클론 위치: `C:\Users\USER\Desktop\bh-field-portal`
- Python 미설치 상태 확인 (`python` 이 Windows 스토어 스텁으로만 존재) → winget 으로 **Python 3.12.10** 설치
  - 설치 경로: `C:\Users\USER\AppData\Local\Programs\Python\Python312\python.exe`
- `.claude/launch.json` 추가 — Claude Code 브라우저 프리뷰에서 `python server.py --port 8787` 로 서버 기동

## 프로젝트 특성 (README 기준)
- Python 표준 라이브러리만 사용 — pip 의존성 없음, 번들러 없음 (순수 HTML/CSS/JS)
- 실행: `python server.py` (또는 `실행하기.bat` 더블클릭), 기본 포트 8787
- 첫 실행 시 `data/app.db` 와 샘플 가이드/재고 데이터 자동 생성
- 초기화하려면 `data/` 폴더 삭제 후 재실행

## 검증
- 서버 기동 후 `http://localhost:8787` 접속 → 첫 실행 환영 모달 표시, 오류 코드 가이드 3건(샘플) 정상 렌더링
- 브라우저 콘솔 오류 없음
- 서버 로그의 `ConnectionAbortedError [WinError 10053]` 는 브라우저가 요청을 중간에 끊을 때 나는 무해한 로그

## 남은 일 / 참고
- 구글 시트 업로드를 쓰려면 README 3장의 Apps Script 웹 앱 배포 및 URL 설정 필요 (로컬 UI 작업에는 불필요)
- 새 터미널에서는 `python` 이 PATH 로 잡힘 (기존 열린 터미널은 재시작 필요)
- 같은 Desktop 의 `kuun_robot_managing` 은 별개 프로젝트 — 두 리포는 철저히 분리해서 관리한다.

// 설정 — 구글 시트 연결 · 업데이트(공개본) · 앱 설치
import { api, APP_VERSION } from '../api.js';
import { $, h, confirmDialog, copyText, loading, openSheet, toast } from '../ui.js';
import { isOnline } from '../sync.js';
import { formatBytes } from '../sheets.js';
import {
  canInstallDirectly, installApp, installStateLabel, isStandalone,
  showManualGuide,
} from '../install.js';
import {
  deviceName, getSyncState, syncSummaryText, refreshState, runSync,
  setDeviceName,
} from '../syncnow.js';

/**
 * 드라이브 남은 용량 안내.
 *
 * 사진·영상이 드라이브에 쌓이므로 용량이 차면 리포트가 조용히 안 올라간다.
 * 여유가 500MB 아래면 눈에 띄게 알린다.
 */
function driveLine(drive) {
  if (!drive || drive.free === null || drive.free === undefined) return '';
  const low = drive.free < 500 * 1048576;
  return `
    <p class="${low ? 'hint' : 'muted'}" style="margin:10px 0 0${low ? ';color:var(--color-danger);font-weight:600' : ''}">
      ${low ? '⚠️ ' : '💾 '}구글 드라이브 남은 공간
      <strong>${h(formatBytes(drive.free))}</strong>
      (전체 ${h(formatBytes(drive.limit))} 중 ${h(formatBytes(drive.used))} 사용)
      ${low ? '<br />공간이 부족하면 사진·영상이 올라가지 않습니다. 드라이브를 정리해 주세요.' : ''}
    </p>`;
}

export async function settingsView(view) {
  loading(view);
  const [settings, build] = await Promise.all([api.getSettings(), api.version()]);
  await refreshState();
  const state = getSyncState();
  const install = installStateLabel();
  const waiting = state.pending;
  // 기기에 담긴 자료 규모 — 예전에는 서버가 세어 주었는데, 이제 기기 안에서 직접 센다.
  const [guideCount, itemCount] = await Promise.all([
    api.listGuides().then((r) => r.items.length).catch(() => 0),
    api.listInventory().then((r) => r.items.length).catch(() => 0),
  ]);

  view.innerHTML = `
    <div id="pageRoot">
      <div class="page-head">
        <h1 class="page-head__title">설정</h1>
        <span class="page-head__meta">
          기기 ${h(deviceName() || '이름 없음')} · 앱 <span class="tnum">v${APP_VERSION}</span>
        </span>
      </div>

      <div class="settings-list">
      <form id="sheetsForm" autocomplete="off">
        <div class="panel">
          <h2 class="panel__title">구글 시트 연결</h2>
          <div class="row" style="gap:8px;margin-bottom:14px">
            <span class="badge ${settings.sheetsReady ? 'badge--ok' : 'badge--danger'}">
              ${settings.sheetsReady ? '연결됨' : '연결 필요'}
            </span>
            ${settings.spreadsheetUrl ? `<a class="badge" href="${h(settings.spreadsheetUrl)}"
               target="_blank" rel="noopener">스프레드시트 열기 ↗</a>` : ''}
          </div>

          <div class="field">
            <label>Apps Script 웹 앱 URL<span class="req">*</span></label>
            <input class="input mono" id="sWebapp" value="${h(settings.sheets_webapp_url)}"
                   placeholder="https://script.google.com/macros/s/.../exec"
                   autocapitalize="off" spellcheck="false" />
            <span class="hint">
              스프레드시트에 붙인 Apps Script 를 <strong>웹 앱</strong>으로 배포한 URL 입니다.
              아래 [설치 방법]을 참고하세요. (구글 계정·토큰을 앱에 넣지 않습니다)
            </span>
          </div>

          <div class="field">
            <label>스프레드시트 ID / 링크</label>
            <input class="input mono" id="sSheetId" value="${h(settings.sheets_spreadsheet_id)}"
                   placeholder="링크를 붙여넣으면 ID만 자동 추출" />
            <span class="hint">기록 위치 확인용입니다. 실제 기록은 위 웹 앱이 담당합니다.</span>
          </div>

          <p class="muted" style="margin:0 0 14px;font-size:.9rem;line-height:1.65">
            🚐 시트가 연결되어 있으면 <strong>차량 재고도 스프레드시트의 [차량재고] 탭과
            자동 동기화</strong>됩니다. 수량 변경은 즉시 시트에 기록되고,
            시트에서 직접 고친 내용(차량 이름·품목·수량)도 재고 화면을 열 때 반영됩니다.
          </p>

          <div class="form-actions">
            <button class="btn btn--ghost" data-act="sheets-help" type="button">📖 설치 방법</button>
            <button class="btn btn--ghost" data-act="sheets-test" type="button">연결 테스트</button>
            <button class="btn btn--primary" type="submit">저장</button>
          </div>
        </div>
      </form>

      <div class="panel" id="testResult" style="display:none"></div>

      <details class="panel panel--fold">
        <summary class="panel__title">기록 방식</summary>
        <ul class="muted" style="line-height:1.9;padding-left:20px;margin:0">
          <li>리포트를 업로드하면 <strong>월마다 새 시트</strong>가 만들어집니다. (시트 이름 = <span class="mono">YYYY-MM</span>)</li>
          <li><strong>1행은 비워 두고</strong>, <strong>2행에 항목명</strong>, <strong>3행부터</strong> 리포트가 한 줄씩 쌓입니다.</li>
          <li>열 순서는 <a class="link" href="#/fields">🧩 항목 설정</a> 순서를 그대로 따릅니다. (앞에 작성일시·작성자 2열)</li>
          <li><strong>사진·영상은 구글 드라이브</strong>의 [현장 리포트 첨부] 폴더에 저장되고,
              시트 칸에는 링크가 들어갑니다. 이력 화면에서 미리보기로 볼 수 있습니다.</li>
          <li>첨부 크기는 한 개 20MB, 리포트 하나당 25MB 까지입니다.</li>
        </ul>
      </details>

      <div class="panel">
        <h2 class="panel__title">리포트 항목 설정</h2>
        <p class="muted" style="margin:0 0 14px;line-height:1.65">
          리포트 입력 항목과 구글 시트 열 순서를 정합니다.
          <strong>항목은 팀 공통</strong>입니다 — 바꾸면 자동으로 시트의
          [리포트 항목] 탭을 통해 <strong>모든 기기가 같은 항목</strong>을 씁니다.
          항목이 바뀌면 그 달 리포트는 <strong>새 탭</strong>에 이어 쌓이고,
          이미 쌓인 줄은 그대로 남습니다.
        </p>
        <a class="btn btn--ghost" href="#/fields">항목 설정 열기</a>
      </div>

      <div class="panel">
        <h2 class="panel__title">새로고침 — 다른 사람 변경 받기</h2>
        <p class="muted" style="margin:0 0 14px;line-height:1.65">
          <strong>올리기는 자동</strong>입니다 — 재고·리포트·가이드·항목 변경은 인터넷이 되는
          순간 곧바로 시트로 올라갑니다 (오프라인이면 쌓였다가 연결되면 올라갑니다).
          이 버튼은 <strong>다른 사람이 바꾼 내용을 지금 받아오는</strong> 것입니다.
          앱으로 돌아올 때와 5분마다 자동으로도 받아옵니다.
        </p>
        <div class="row" style="gap:8px;margin-bottom:14px">
          <span class="badge ${state.failed ? 'badge--danger' : (waiting ? 'badge--warn' : 'badge--ok')}">
            ${state.failed ? `올리지 못한 것 ${waiting}건` : (waiting ? `올리는 중 ${waiting}건` : '시트와 같은 내용')}
          </span>
        </div>
        <p class="muted" style="margin:0 0 14px;font-size:.9rem">${h(syncSummaryText())}</p>
        <div class="row">
          <button class="btn ${waiting ? 'btn--pending' : 'btn-primary'}"
                  data-act="do-publish" type="button">새로고침</button>
        </div>

        <div class="divider"></div>
        <div class="field" style="margin-bottom:0">
          <label>내 이름 / 기기 이름</label>
          <input class="input" id="sDevice" value="${h(deviceName() || settings.device_name)}"
                 placeholder="예) 황지민" />
          <span class="hint">한 번 등록하면 계속 사용됩니다. 리포트에 작성자로 들어갑니다.</span>
        </div>
      </div>

      <details class="panel panel--fold">
        <summary class="panel__title">앱 설치 · 접속 주소</summary>
        <div class="row" style="gap:8px;margin-bottom:14px">
          <span class="badge">버전 v${h(build.version)}</span>
          <span class="badge mono">빌드 ${h(build.buildHash)}</span>
          <span class="badge ${install.ok ? 'badge--ok' : ''}">${h(install.text)}</span>
        </div>
        ${isStandalone() ? `
          <p class="muted" style="margin:0;line-height:1.65">
            이미 앱으로 설치되어 실행 중입니다. 화면 코드는 새 버전이 올라오면 자동으로 갱신됩니다.
          </p>`
        : `
          <div class="row">
            <button class="btn btn--primary" data-act="install" type="button">앱 설치하기</button>
            <button class="btn btn--ghost" data-act="install-help" type="button">설치 방법 보기</button>
          </div>
          <p class="muted" style="margin:14px 0 0;font-size:.9rem;line-height:1.65">
            ${canInstallDirectly()
              ? '버튼을 누르면 바로 설치됩니다.'
              : 'iPhone·iPad 는 Safari 의 [공유 → 홈 화면에 추가] 로 설치합니다.'}
            <br />⚠️ <strong>Play 스토어·앱 스토어에서 검색해 설치하는 앱이 아닙니다.</strong>
          </p>`}
        <div class="divider"></div>
        <p class="muted" style="margin:0;font-size:.9rem;line-height:1.65">
          접속 주소: <strong class="mono">${h(build.siteUrl || '-')}</strong>
          <button class="btn btn--sm btn--ghost" data-act="copy-url" type="button" style="margin-left:8px">주소 복사</button>
        </p>
      </details>

      <details class="panel panel--fold">
        <summary class="panel__title">오프라인 사용</summary>
        <div class="row" style="gap:8px;margin:14px 0">
          <span class="badge ${isOnline() ? 'badge--ok' : 'badge--warn'}">
            ${isOnline() ? '🟢 온라인' : '📴 오프라인'}
          </span>
          <span class="badge">기기 보관 가이드 ${guideCount}건</span>
          <span class="badge">재고 ${itemCount}종</span>
          ${settings.pendingCount ? `<span class="badge badge--warn">
            대기 작업 ${settings.pendingCount}건</span>` : ''}
        </div>
        <ul class="muted" style="line-height:1.9;padding-left:20px;margin:0">
          <li>가이드 열람·검색·수정, 리포트 작성, 재고 수정은 <strong>인터넷 없이 전부</strong> 됩니다.</li>
          <li>오프라인에서 누른 시트 업로드와 재고 수량 변경은 <strong>대기열에 쌓였다가
              연결되면 자동 처리</strong>됩니다.</li>
          <li><strong>올리기·받기</strong>는 인터넷만 되면
              <strong>어느 와이파이에서도</strong> 됩니다. 따로 등록할 주소는 없습니다.</li>
        </ul>
      </details>
      </div>
    </div>`;

  const root = $('#pageRoot');

  root.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;

    if (act === 'install') { await installApp(); return; }
    if (act === 'install-help') { showManualGuide(); return; }
    if (act === 'sheets-help') { openSheetsGuide(settings); return; }

    if (act === 'copy-url') {
      const ok = await copyText(build.siteUrl || '');
      toast(ok ? '주소를 복사했습니다.' : '복사에 실패했습니다.', ok ? 'ok' : 'err');
      return;
    }

    if (act === 'do-publish') {
      $('#sDevice').value.trim() && setDeviceName($('#sDevice').value.trim());
      await runSync(btn);
      settingsView(view);
      return;
    }
    if (act === 'sheets-test') {
      btn.disabled = true;
      btn.textContent = '테스트 중…';
      const box = $('#testResult');
      try {
        const result = await api.testSheets();
        box.style.display = 'block';
        box.innerHTML = `
          <h2 class="panel__title">연결 성공</h2>
          <p class="muted">스프레드시트: <strong>${h(result.spreadsheetName || '-')}</strong>
            ${result.spreadsheetUrl ? ` · <a class="link" href="${h(result.spreadsheetUrl)}" target="_blank" rel="noopener">열기 ↗</a>` : ''}</p>
          ${driveLine(result.drive)}
          ${(result.sheets || []).length ? `
            <div class="tag-list" style="margin-top:10px">
              ${result.sheets.map((name) => `<span class="badge">${h(name)}</span>`).join('')}
            </div>` : '<p class="muted">아직 시트가 없습니다. 첫 리포트를 올리면 이번 달 시트가 생성됩니다.</p>'}`;
        toast('구글 시트에 연결되었습니다.', 'ok');
      } catch (err) {
        box.style.display = 'block';
        box.innerHTML = `<h2 class="panel__title" style="color:var(--danger)">연결 실패</h2>
          <p class="muted" style="white-space:pre-wrap">${h(err.message)}</p>`;
        toast(err.message, 'err');
      }
      btn.disabled = false;
      btn.textContent = '연결 테스트';
    }
  });

  $('#sheetsForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const name = $('#sDevice').value.trim();
    setDeviceName(name);
    try {
      await api.saveSettings({
        sheets_webapp_url: $('#sWebapp').value.trim(),
        sheets_spreadsheet_id: $('#sSheetId').value.trim(),
        device_name: name,
      });
      toast('설정을 저장했습니다.', 'ok');
      settingsView(view);
    } catch (err) { toast(err.message, 'err'); }
  });
}

/** Apps Script 설치 안내 */
function openSheetsGuide(settings) {
  const sheetUrl = settings.spreadsheetUrl || '';
  const body = openSheet('구글 시트 연결 방법', `
    <p class="muted" style="margin:0 0 14px;line-height:1.7">
      구글 계정 정보를 앱에 넣지 않고, 스프레드시트에 <strong>기록 스크립트</strong>를 붙여
      그 주소로만 데이터를 보냅니다. 한 번만 설정하면 됩니다. (약 2분)
    </p>
    <ol style="line-height:2;padding-left:22px;margin:0">
      <li>${sheetUrl ? `<a class="link" href="${h(sheetUrl)}" target="_blank" rel="noopener">공유 스프레드시트 열기 ↗</a>` : '공유 스프레드시트를 엽니다'}</li>
      <li>메뉴 <strong>[확장 프로그램] → [Apps Script]</strong></li>
      <li>기존 코드를 지우고, 프로젝트 폴더의
          <span class="mono">google-apps-script.gs</span> 내용을 붙여넣고 저장</li>
      <li><strong>[배포] → [새 배포] → 유형 [웹 앱]</strong>
        <ul style="line-height:1.9">
          <li>실행 사용자: <strong>나</strong></li>
          <li>액세스 권한: <strong>모든 사용자</strong> ← 반드시</li>
        </ul>
      </li>
      <li>[배포] → 권한 승인 → <strong>웹 앱 URL 복사</strong>
          (<span class="mono">.../exec</span> 로 끝남)</li>
      <li>위 <strong>Apps Script 웹 앱 URL</strong> 칸에 붙여넣고 [저장] → [연결 테스트]</li>
    </ol>
    <div class="sub-card" style="margin-top:14px">
      <p class="muted" style="margin:0;font-size:.88rem;line-height:1.6">
        스프레드시트 <strong>편집 권한</strong>만 있으면 됩니다. 관리자 권한이나 API 키는 필요 없습니다.
      </p>
    </div>
    <div class="form-actions">
      <button class="btn btn--primary" type="button" data-act="close">확인</button>
    </div>`);
  return body;
}

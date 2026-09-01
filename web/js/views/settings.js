// 설정 — 구글 시트 연결 · 업데이트(공개본) · 앱 설치
import { api } from '../api.js';
import { $, h, confirmDialog, copyText, loading, openSheet, toast } from '../ui.js';
import { isOnline } from '../sync.js';
import {
  canInstallDirectly, installApp, installStateLabel, isStandalone,
  showManualGuide,
} from '../install.js';
import {
  deviceName, getSyncState, syncSummaryText, refreshState, runSync,
  runTakeLatest, setDeviceName,
} from '../syncnow.js';

export async function settingsView(view) {
  loading(view);
  const [settings, build] = await Promise.all([api.getSettings(), api.version()]);
  await refreshState();
  const state = getSyncState();
  const install = installStateLabel();
  const waiting = state.pending + (state.dirty ? 1 : 0);

  view.innerHTML = `
    <div id="pageRoot">
      <div class="page-head">
        <h1>⚙️ 설정</h1>
        <p>리포트를 팀 공유 스프레드시트로 올리기 위한 연결 정보와 앱 설정입니다.</p>
      </div>

      <form id="sheetsForm" autocomplete="off">
        <div class="panel">
          <h2 class="panel__title">📊 구글 시트 연결</h2>
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

          <div class="grid-2">
            <div class="field">
              <label>스프레드시트 ID / 링크</label>
              <input class="input mono" id="sSheetId" value="${h(settings.sheets_spreadsheet_id)}"
                     placeholder="링크를 붙여넣으면 ID만 자동 추출" />
              <span class="hint">기록 위치 확인용입니다. 실제 기록은 위 웹 앱이 담당합니다.</span>
            </div>
            <div class="field">
              <label>사무실 서버 주소</label>
              <input class="input mono" id="sSiteUrl" value="${h(settings.server_url)}"
                     placeholder="예) http://192.168.0.83:8787" autocapitalize="off"
                     spellcheck="false" />
              <span class="hint">
                <strong>[⬆️ 업데이트] 동기화에만</strong> 쓰입니다.
                브라우저로 접속했다면 비워 두세요(지금 주소 ${h(build.detectedUrl || '-')} 사용).
                <strong>APK 로 설치한 앱은 반드시 입력</strong>해야 팀과 내용을 주고받습니다.
                구글 시트 업로드는 이 주소와 무관하게 어디서나 됩니다.
              </span>
            </div>
          </div>

          <p class="muted" style="margin:0 0 14px;font-size:.9rem;line-height:1.65">
            🚐 시트가 연결되어 있으면 <strong>차량 재고도 스프레드시트의 [차량재고] 탭과
            자동 동기화</strong>됩니다. 수량 변경은 즉시 시트에 기록되고,
            시트에서 직접 고친 내용(차량 이름·품목·수량)도 재고 화면을 열 때 반영됩니다.
          </p>

          <div class="form-actions">
            <button class="btn btn--ghost" data-act="sheets-help" type="button">📖 설치 방법</button>
            <button class="btn btn--ghost" data-act="sheets-test" type="button">🔌 연결 테스트</button>
            <button class="btn btn--primary" type="submit">💾 저장</button>
          </div>
        </div>
      </form>

      <div class="panel" id="testResult" style="display:none"></div>

      <details class="panel panel--fold">
        <summary class="panel__title">📊 기록 방식</summary>
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
        <h2 class="panel__title">🧩 리포트 항목 설정</h2>
        <p class="muted" style="margin:0 0 14px;line-height:1.65">
          리포트 입력 항목과 구글 시트 열 순서를 정합니다.
        </p>
        <a class="btn btn--ghost" href="#/fields">🧩 항목 설정 열기</a>
      </div>

      <div class="panel">
        <h2 class="panel__title">⬆ 업데이트 (시트와 맞추기)</h2>
        <p class="muted" style="margin:0 0 14px;line-height:1.65">
          오프라인에서 작성한 리포트·재고 변경·이력 상태를 <strong>구글 시트로 올리고</strong>,
          이어서 <strong>시트의 최신 내용을 받아옵니다.</strong>
          현장에서 일하다 인터넷이 되는 곳에서 한 번만 누르면 됩니다.
        </p>
        <div class="row" style="gap:8px;margin-bottom:14px">
          <span class="badge ${waiting ? 'badge--warn' : 'badge--ok'}">
            ${waiting ? `올릴 내용 ${waiting}건` : '시트와 같은 내용'}
          </span>
        </div>
        <p class="muted" style="margin:0 0 14px;font-size:.9rem">${h(syncSummaryText())}</p>
        <div class="row">
          <button class="btn ${waiting ? 'btn--pending' : 'btn--ghost'}"
                  data-act="do-publish" type="button">⬆ 지금 맞추기</button>
          ${state.dirty ? `
            <button class="btn btn--danger" data-act="take-latest" type="button">
              내 가이드 변경 버리고 최신 받기
            </button>` : ''}
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
        <summary class="panel__title">📱 앱 설치 · 접속 주소</summary>
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
            <button class="btn btn--primary" data-act="install" type="button">📲 앱 설치하기</button>
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
        <summary class="panel__title">📴 오프라인 사용</summary>
        <div class="row" style="gap:8px;margin:14px 0">
          <span class="badge ${isOnline() ? 'badge--ok' : 'badge--warn'}">
            ${isOnline() ? '🟢 온라인' : '📴 오프라인'}
          </span>
          <span class="badge">기기 보관 가이드 ${state.summary.guides || 0}건</span>
          <span class="badge">재고 ${state.summary.inventoryItems || 0}종</span>
          ${settings.pendingCount ? `<span class="badge badge--warn">
            대기 작업 ${settings.pendingCount}건</span>` : ''}
        </div>
        <ul class="muted" style="line-height:1.9;padding-left:20px;margin:0">
          <li>가이드 열람·검색·수정, 리포트 작성, 재고 수정은 <strong>인터넷 없이 전부</strong> 됩니다.</li>
          <li>오프라인에서 누른 시트 업로드와 재고 수량 변경은 <strong>대기열에 쌓였다가
              연결되면 자동 처리</strong>됩니다.</li>
          <li><strong>[⬆️ 업데이트]</strong>(팀과 내용 주고받기)만 사무실 서버 연결이 필요합니다.</li>
        </ul>
        <div class="divider"></div>
        <button class="btn btn--ghost btn--sm" data-act="pull-now" type="button">
          📥 서버에서 최신 자료 받기
        </button>
      </details>
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
    if (act === 'take-latest' || act === 'pull-now') {
      await runTakeLatest(act === 'pull-now');
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
          <h2 class="panel__title">✅ 연결 성공</h2>
          <p class="muted">스프레드시트: <strong>${h(result.spreadsheetName || '-')}</strong>
            ${result.spreadsheetUrl ? ` · <a class="link" href="${h(result.spreadsheetUrl)}" target="_blank" rel="noopener">열기 ↗</a>` : ''}</p>
          ${(result.sheets || []).length ? `
            <div class="tag-list" style="margin-top:10px">
              ${result.sheets.map((name) => `<span class="badge">${h(name)}</span>`).join('')}
            </div>` : '<p class="muted">아직 시트가 없습니다. 첫 리포트를 올리면 이번 달 시트가 생성됩니다.</p>'}`;
        toast('구글 시트에 연결되었습니다.', 'ok');
      } catch (err) {
        box.style.display = 'block';
        box.innerHTML = `<h2 class="panel__title" style="color:var(--danger)">❌ 연결 실패</h2>
          <p class="muted" style="white-space:pre-wrap">${h(err.message)}</p>`;
        toast(err.message, 'err');
      }
      btn.disabled = false;
      btn.textContent = '🔌 연결 테스트';
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
        site_url: $('#sSiteUrl').value.trim(),
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

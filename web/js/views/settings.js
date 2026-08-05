// 설정 — 구글 시트 연결 · 업데이트(공개본) · 앱 설치
import { api } from '../api.js';
import { $, h, confirmDialog, copyText, loading, openSheet, toast } from '../ui.js';
import { recentCount } from '../recent.js';
import {
  canInstallDirectly, installApp, installStateLabel, isStandalone,
  showManualGuide,
} from '../install.js';
import {
  deviceName, getPublishState, publishSummaryText, refreshState, runPublish,
  runTakeLatest, setDeviceName,
} from '../publish.js';

export async function settingsView(view) {
  loading(view);
  const [settings, build] = await Promise.all([api.getSettings(), api.version()]);
  await refreshState();
  const state = getPublishState();
  const install = installStateLabel();

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
              <label>서비스 주소 (선택)</label>
              <input class="input mono" id="sSiteUrl" value="${h(settings.site_url)}"
                     placeholder="비우면 자동: ${h(build.detectedUrl || '-')}" />
              <span class="hint">
                비워 두면 <strong>지금 접속한 주소</strong>(${h(build.detectedUrl || '-')})를 자동으로 씁니다.
                영상처럼 시트에 삽입할 수 없는 첨부의 링크에만 사용됩니다.
              </span>
            </div>
          </div>

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
          <li><strong>촬영한 사진은 해당 칸에 이미지로 바로 삽입됩니다</strong> (링크 아님).
              여러 장이면 가로로 나란히 들어갑니다.</li>
          <li>영상·PDF 는 시트에 넣을 수 없어 링크로 기록됩니다.</li>
        </ul>
      </details>

      <div class="panel">
        <h2 class="panel__title">🧩 리포트 항목 설정</h2>
        <p class="muted" style="margin:0 0 14px;line-height:1.65">
          리포트 입력 항목과 구글 시트 열 순서를 정합니다.
        </p>
        <a class="btn btn--ghost" href="#/fields">🧩 항목 설정 열기</a>
      </div>

      <details class="panel panel--fold">
        <summary class="panel__title">🔒 접근 보호 (공용 PIN)</summary>
        <div class="row" style="gap:8px;margin:14px 0">
          <span class="badge ${settings.pinEnabled ? 'badge--ok' : 'badge--warn'}">
            ${settings.pinEnabled ? 'PIN 사용 중' : '보호 없음'}
          </span>
        </div>
        <p class="muted" style="margin:0 0 14px;line-height:1.65">
          PIN 을 정하면 접속 시 1회 입력해야 합니다(기기가 기억). 팀 전체가 같은 PIN 을 씁니다.
          비워서 저장하면 보호가 해제됩니다.
        </p>
        <div class="grid-2">
          <div class="field">
            <label>접근 PIN (숫자 4~12자리)</label>
            <input class="input mono" id="sPin" type="password" inputmode="numeric"
                   placeholder="${settings.pinEnabled ? '변경할 PIN 입력 (그대로 두면 유지)' : '예) 1234'}" />
          </div>
          <div class="field" style="align-self:end">
            <button class="btn btn--primary" data-act="save-pin" type="button">🔒 PIN 저장</button>
          </div>
        </div>
        ${settings.pinEnabled ? `
          <button class="btn btn--danger btn--sm" data-act="clear-pin" type="button">
            보호 해제
          </button>` : ''}
        <p class="muted" style="margin:12px 0 0;font-size:.86rem;line-height:1.6">
          PIN 을 잊었다면 서버 PC 에서 <span class="mono">python3 server.py --reset-pin</span> 으로 해제할 수 있습니다.
        </p>
      </details>

      <div class="panel">
        <h2 class="panel__title">⬆️ 업데이트 (모든 사용자에게 적용)</h2>
        <p class="muted" style="margin:0 0 14px;line-height:1.65">
          가이드·차량 재고·리포트 항목을 바꾸면 <strong>내 화면에만</strong> 반영됩니다.
          상단 <strong>[⬆️ 업데이트]</strong> 를 눌러야 모든 사용자가 보는 내용이 됩니다.
          다른 사람이 업데이트하면, 내 변경이 없는 한 자동으로 최신 내용을 받습니다.
        </p>
        <div class="row" style="gap:8px;margin-bottom:14px">
          <span class="badge ${state.hasLocalChanges ? 'badge--warn' : 'badge--ok'}">
            ${state.hasLocalChanges ? '적용 안 된 내 변경 있음' : '모든 사용자와 동일'}
          </span>
          <span class="badge">공개 버전 ${state.published.revision || 0}</span>
        </div>
        <p class="muted" style="margin:0 0 14px;font-size:.9rem">${h(publishSummaryText())}</p>
        <div class="row">
          <button class="btn ${state.hasLocalChanges ? 'btn--pending' : 'btn--ghost'}"
                  data-act="do-publish" type="button">⬆️ 업데이트</button>
          ${state.hasLocalChanges ? `
            <button class="btn btn--danger" data-act="take-latest" type="button">
              내 변경 버리고 최신 받기
            </button>` : ''}
        </div>

        <div class="divider"></div>
        <div class="field" style="margin-bottom:0">
          <label>내 이름 / 기기 이름</label>
          <input class="input" id="sDevice" value="${h(deviceName() || settings.device_name)}"
                 placeholder="예) 황지민" />
          <span class="hint">한 번 등록하면 계속 사용됩니다. 누가 업데이트했는지 표시됩니다.</span>
        </div>
        <p class="muted" style="margin:12px 0 0;font-size:.86rem;line-height:1.6">
          ※ 작성한 <strong>리포트</strong>는 내 기기에만 저장되며 다른 사용자에게 공유되지 않습니다.
          팀과 공유하려면 구글 시트로 업로드하세요.
        </p>
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
          <br />이 앱은 인터넷 연결 상태에서 사용합니다.
        </p>
        <div class="divider"></div>
        <p class="muted" style="margin:0;font-size:.9rem;line-height:1.65">
          📴 최근 본 가이드 <strong>${recentCount()}건</strong>이 이 기기에 보관되어 있어,
          연결이 끊겨도 열람할 수 있습니다.
        </p>
      </details>
    </div>`;

  const root = $('#pageRoot');

  root.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;

    if (act === 'save-pin' || act === 'clear-pin') {
      const pin = act === 'clear-pin' ? '' : $('#sPin').value.trim();
      if (act === 'save-pin' && !pin) {
        toast('저장할 PIN 을 입력하세요. (해제는 [보호 해제])', 'err');
        return;
      }
      if (act === 'clear-pin') {
        const ok = await confirmDialog('보호 해제',
          'PIN 없이 누구나 접속할 수 있게 됩니다. 사내망에서만 사용하세요.',
          '해제', true);
        if (!ok) return;
      }
      try {
        await api.saveSettings({ access_pin: pin });
        toast(pin ? 'PIN 을 저장했습니다. 팀에 공유하세요.' : '보호를 해제했습니다.', 'ok');
        settingsView(view);
      } catch (err) { toast(err.message, 'err'); }
      return;
    }

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
      await runPublish(btn);
      settingsView(view);
      return;
    }
    if (act === 'take-latest') {
      await runTakeLatest();
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

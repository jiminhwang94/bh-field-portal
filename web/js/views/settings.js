// 설정 — 구글 시트 연결 · 업데이트(공개본) · 앱 설치
import { api, APP_VERSION } from '../api.js';
import {
  settingsLine as updateSettingsLine, startUpdate, checkForUpdate,
  getInstallLink, loadInstallLink,
} from '../update.js';
import { connectionState, ensureSheetConnection } from '../connect.js';
import { testMode, enableTestMode, disableTestMode } from '../mode.js';

/** 주소 칸을 사람이 직접 열었는가 (이 화면에 머무는 동안만). */
let sheetFormOpen = false;
import { $, h, confirmDialog, copyText, loading, openSheet, toast } from '../ui.js';
import { isOnline } from '../sync.js';
import { formatBytes } from '../sheets.js';
import {
  canInstallDirectly, installApp, installStateLabel, isStandalone,
  showManualGuide,
} from '../install.js';
import {
  deviceName, getSyncState, syncSummaryText, refreshState, runRefresh,
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
      ${low ? '남은 공간 부족 — ' : ''}구글 드라이브 남은 공간
      <strong>${h(formatBytes(drive.free))}</strong>
      (전체 ${h(formatBytes(drive.limit))} 중 ${h(formatBytes(drive.used))} 사용)
      ${low ? '<br />공간이 부족하면 사진·영상이 올라가지 않습니다. 드라이브를 정리해 주세요.' : ''}
    </p>`;
}

/**
 * 팀원에게 보내 주는 APK 설치 주소.
 *
 * 이 주소는 **버전이 올라가도 바뀌지 않는다** — 빌드 자동화가 드라이브에 둔
 * 파일 하나의 내용만 갈아 끼우기 때문이다. 그래서 한 번 카톡으로 보내 두면
 * 그 사람은 언제 눌러도 그때의 최신 APK 를 받는다.
 */
function installLinkHtml(link) {
  if (!link || !link.installUrl) {
    return `
      <p class="muted" style="margin:0;font-size:.9rem;line-height:1.65">
        APK 설치 링크는 다음 빌드가 올라간 뒤에 여기 보입니다.
        <br />(구글 시트의 <strong>'앱 설치 링크'</strong> 탭에도 적힙니다)
      </p>`;
  }
  // 주소를 통째로 보여 주면 줄이 넘쳐 읽기 어렵다. 파일 부분만 줄여 보인다.
  const shown = link.installUrl.replace(/^https:\/\//, '').replace(/\/view.*$/, '');
  return `
    <p class="muted" style="margin:0;font-size:.9rem;line-height:1.65">
      APK 설치 링크 <span class="muted">(팀원에게 보내는 주소)</span><br />
      <a class="link mono" href="${h(link.installUrl)}" target="_blank"
         rel="noopener">${h(shown)} ↗</a>
      <button class="btn btn--sm btn--ghost" data-act="copy-install" type="button"
              style="margin-left:8px">링크 복사</button>
      <br />버전이 올라가도 <strong>이 주소는 바뀌지 않습니다.</strong>
      받은 사람은 누를 때마다 최신 APK 를 받습니다.
    </p>`;
}

export async function settingsView(view) {
  const updateLine = updateSettingsLine();
  await loadInstallLink();
  // 설정을 열었다는 건 "지금 상태를 보고 싶다" 는 뜻 — 4분 규칙을 건너뛰고 묻는다.
  checkForUpdate({ force: true }).then(() => {
    const line = document.getElementById('appUpdateLine');
    if (line) line.innerHTML = updateSettingsLine();
    const box = document.getElementById('installLinkBox');
    if (box) box.innerHTML = installLinkHtml(getInstallLink());
  }).catch(() => {});
  loading(view);
  const [settings, build, conn] = await Promise.all([
    api.getSettings(), api.version(), connectionState(),
  ]);
  // 주소 칸은 연결에 실패했을 때, 또는 사람이 직접 열었을 때만 보인다.
  const showSheetForm = Boolean(conn.error) || sheetFormOpen;
  await refreshState();
  const state = getSyncState();
  const install = installStateLabel();
  const waiting = state.pending;
  // 기기에 담긴 자료 규모 — 예전에는 서버가 세어 주었는데, 이제 기기 안에서 직접 센다.
  const [guideCount, itemCount] = await Promise.all([
    api.listGuides().then((r) => r.items.length).catch(() => 0),
    api.listInventory().then((r) => r.items.length).catch(() => 0),
  ]);
  const [attn, conflicts] = await Promise.all([
    api.attention().catch(() => ({ pending: 0, conflicts: 0, errors: 0, failed: '' })),
    api.guideConflicts().catch(() => []),
  ]);

  view.innerHTML = `
    <div id="pageRoot">
      <div class="page-head">
        <h1 class="page-head__title">설정</h1>
        <span class="page-head__meta">
          기기 ${h(deviceName() || '이름 없음')} · 앱 <span class="tnum">v${APP_VERSION}</span>
          <span id="appUpdateLine">${updateLine}</span>
        </span>
      </div>

      <div class="settings-list">
      ${checkPanelHtml(attn, conflicts)}
      <div class="panel" id="sheetPanel">
        <h2 class="panel__title">구글 시트</h2>
        <div class="row" style="gap:8px;margin-bottom:${showSheetForm ? '14px' : '0'};flex-wrap:wrap">
          <span class="badge ${conn.error ? 'badge--danger' : (conn.verifiedAt ? 'badge--ok' : '')}">
            ${conn.error ? '연결 안 됨' : (conn.verifiedAt ? '연결됨' : '확인 전')}
          </span>
          ${settings.spreadsheetUrl ? `<a class="badge" href="${h(settings.spreadsheetUrl)}"
             target="_blank" rel="noopener">스프레드시트 열기 ↗</a>` : ''}
          <span class="page-head__spacer"></span>
          <button class="btn btn-secondary btn--sm" data-act="sheet-recheck" type="button">다시 확인</button>
          ${showSheetForm ? '' : `<button class="btn btn--ghost btn--sm" data-act="show-sheet-form" type="button">주소 직접 입력</button>`}
        </div>
        ${conn.error ? `<p class="hint" style="color:var(--color-danger);margin:8px 0 0">${h(conn.error)}</p>` : ''}

        ${showSheetForm ? `
        <form id="sheetsForm" autocomplete="off">
          <div class="divider"></div>
          <div class="field">
            <label>Apps Script 웹 앱 URL</label>
            <input class="input mono" id="sWebapp" value="${h(settings.sheets_webapp_url)}"
                   placeholder="https://script.google.com/macros/s/.../exec"
                   autocapitalize="off" spellcheck="false" />
          </div>
          <div class="field">
            <label>스프레드시트 ID / 링크</label>
            <input class="input mono" id="sSheetId" value="${h(settings.sheets_spreadsheet_id)}"
                   placeholder="링크를 붙여넣으면 ID만 자동 추출" />
          </div>
          <div class="form-actions">
            <button class="btn btn--ghost" data-act="sheets-help" type="button">설치 방법</button>
            <button class="btn btn--ghost" data-act="sheets-test" type="button">연결 테스트</button>
            <button class="btn btn--primary" type="submit">저장</button>
          </div>
        </form>` : ''}
      </div>

      <div class="panel" id="testResult" style="display:none"></div>


      <div class="panel">
        <h2 class="panel__title">리포트 항목 설정</h2>
        <div class="row" style="gap:8px;flex-wrap:wrap">
          <a class="btn btn-secondary" href="#/fields">항목 설정 열기</a>
          <a class="btn btn-secondary" href="#/work">이슈 유형 정리</a>
        </div>
      </div>

      <div class="panel">
        <h2 class="panel__title">올리기 · 받기 상태</h2>
        ${state.failed || waiting ? `
        <div class="row" style="gap:8px;margin-bottom:14px">
          <span class="badge ${state.failed ? 'badge--danger' : 'badge--warn'}">
            ${state.failed ? `올리지 못한 것 ${waiting}건` : `올리는 중 ${waiting}건`}
          </span>
        </div>` : ''}
        <p class="muted" style="margin:0 0 14px;font-size:.9rem">${h(syncSummaryText())}</p>

        <div class="divider"></div>
        <div class="field" style="margin-bottom:0">
          <label>내 이름 / 기기 이름</label>
          <div class="row" style="gap:8px">
            <input class="input" id="sDevice" value="${h(deviceName() || settings.device_name)}"
                   placeholder="예) 황지민" style="flex:1" />
            <button class="btn btn--primary" data-act="save-name" type="button">등록</button>
          </div>
          <span class="hint" id="nameHint">
            ${deviceName() ? `등록됨 · <strong>${h(deviceName())}</strong>` : '아직 등록되지 않았습니다'}
          </span>
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
            <br /> <strong>Play 스토어·앱 스토어에서 검색해 설치하는 앱이 아닙니다.</strong>
          </p>`}
        <div class="divider"></div>
        <p class="muted" style="margin:0;font-size:.9rem;line-height:1.65">
          접속 주소: <strong class="mono">${h(build.siteUrl || '-')}</strong>
          <button class="btn btn--sm btn--ghost" data-act="copy-url" type="button" style="margin-left:8px">주소 복사</button>
        </p>
        <div class="divider"></div>
        <div id="installLinkBox">${installLinkHtml(getInstallLink())}</div>
      </details>

      <div class="panel" id="viewPanel">
        <h2 class="panel__title">보기</h2>
        <div class="row" style="gap:12px;align-items:center;flex-wrap:wrap">
          <button class="btn ${document.documentElement.getAttribute('data-contrast') === 'high' ? 'btn-dark' : 'btn-secondary'}"
                  data-act="toggle-contrast" type="button"
                  aria-pressed="${document.documentElement.getAttribute('data-contrast') === 'high'}">
            고대비 (야외 · 햇빛) ${document.documentElement.getAttribute('data-contrast') === 'high' ? '켜짐' : '꺼짐'}
          </button>
          <span class="muted">글자와 테두리를 진하게 — 햇빛 아래에서도 잘 보이게</span>
        </div>
      </div>

      <details class="panel panel--fold" id="trashPanel">
        <summary class="panel__title">휴지통 <span class="muted" style="font-weight:500">지운 가이드 · 리포트 되살리기</span></summary>
        <div id="trashBody" class="trash-body"><p class="muted">열면 시트에서 목록을 받아 옵니다.</p></div>
      </details>

      <details class="panel panel--fold" id="testPanel"${testMode() ? ' open' : ''}>
        <summary class="panel__title">테스트 모드 ${testMode() ? '<span class="badge badge--warn">켜짐</span>' : ''}</summary>
        <p class="muted" style="margin:14px 0;line-height:1.65">
          저장 · 삭제 · 상태 바꾸기를 <strong>팀 시트가 아닌 연습용 시트</strong>에서 눌러 봅니다.
          기기 안 자료도 따로 보관되어 진짜 리포트 · 가이드와 섞이지 않습니다.
          연습용 시트는 PC 에서 <span class="mono">node tools/fake_sheet_server.mjs</span> 를 켜거나,
          팀 시트를 복사해 만든 테스트용 Apps Script 주소를 씁니다.
        </p>
        <div class="field">
          <label for="sTestUrl">연습용 시트 주소</label>
          <input class="input mono" id="sTestUrl" value="${h((testMode() && testMode().url) || 'http://127.0.0.1:8790/exec')}"
                 autocapitalize="off" spellcheck="false" />
        </div>
        <div class="row" style="gap:8px">
          ${testMode()
            ? '<button class="btn btn-dark" data-act="test-off" type="button">테스트 모드 끄기 (팀 시트로 돌아가기)</button>'
            : '<button class="btn btn-secondary" data-act="test-on" type="button">테스트 모드 켜기</button>'}
        </div>
      </details>

      <details class="panel panel--fold">
        <summary class="panel__title">오프라인 사용</summary>
        <div class="row" style="gap:8px;margin:14px 0">
          <span class="badge ${isOnline() ? 'badge--ok' : 'badge--warn'}">
            ${isOnline() ? ' 온라인' : ' 오프라인'}
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

  /** 휴지통 — 펼칠 때 시트에서 받는다 (자주 안 쓰므로 미리 받지 않는다) */
  async function loadTrash() {
    const body = $('#trashBody');
    if (!body) return;
    if (!isOnline()) { body.innerHTML = '<p class="muted">인터넷에 연결되면 볼 수 있습니다.</p>'; return; }
    body.innerHTML = '<p class="muted">받는 중…</p>';
    try {
      const items = await api.listTrash();
      body.innerHTML = items.length ? `
        <div class="trash-rows">
          ${items.map((t) => `
            <div class="trash-row${t.restored ? ' is-done' : ''}">
              <span class="trash-row__kind" data-kind="${h(t.kind)}">${h(t.kind)}</span>
              <span class="trash-row__main">
                <b>${h(t.name)}</b>
                <span class="muted">${h(t.at)} · ${h(t.by)}${t.restored ? ` · 되살림 ${h(t.restored)}` : ''}</span>
              </span>
              ${t.restored ? '' : `<button class="btn btn-secondary btn--sm" data-act="trash-restore"
                 data-row="${t.row}" data-name="${h(t.name)}" type="button">되살리기</button>`}
            </div>`).join('')}
        </div>` : '<p class="muted">휴지통이 비어 있습니다.</p>';
    } catch (err) {
      body.innerHTML = `<p class="hint" style="color:var(--color-danger)">${h(err.message)}</p>`;
    }
  }
  const trashPanel = $('#trashPanel');
  if (trashPanel) trashPanel.addEventListener('toggle', () => { if (trashPanel.open) loadTrash(); });

  root.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;

    if (act === 'install') { await installApp(); return; }
    if (act === 'toggle-contrast') {
      const on = document.documentElement.getAttribute('data-contrast') !== 'high';
      if (on) document.documentElement.setAttribute('data-contrast', 'high');
      else document.documentElement.removeAttribute('data-contrast');
      try { if (on) localStorage.setItem('bh_contrast', 'high'); else localStorage.removeItem('bh_contrast'); } catch { /* 이번만 */ }
      settingsView(view);
      return;
    }
    if (act === 'conflict-mine' || act === 'conflict-theirs') {
      const keepMine = act === 'conflict-mine';
      btn.disabled = true;
      try {
        await api.resolveGuideConflict(btn.dataset.id, keepMine);
        toast(keepMine ? '내 것으로 올립니다.' : '남의 것을 그대로 둡니다.', 'ok');
        settingsView(view);
      } catch (err) { btn.disabled = false; toast(err.message, 'err'); }
      return;
    }
    if (act === 'send-errors') {
      btn.disabled = true;
      try {
        const n = await api.sendErrorsNow();
        toast(n ? `오류 ${n}건을 시트 '오류기록' 탭에 보냈습니다.` : '보낼 오류가 없습니다.', 'ok');
        settingsView(view);
      } catch (err) { btn.disabled = false; toast(err.message, 'err'); }
      return;
    }
    if (act === 'trash-restore') {
      const okGo = await confirmDialog('되살리기', `'${btn.dataset.name}' 을(를) 원래 자리로 되돌립니다.`, '되살리기');
      if (!okGo) return;
      btn.disabled = true;
      try {
        await api.restoreTrash(Number(btn.dataset.row));
        toast('되살렸습니다. [새로고침] 하면 이 기기에도 보입니다.', 'ok');
        loadTrash();
      } catch (err) { btn.disabled = false; toast(err.message, 'err'); }
      return;
    }
    if (act === 'test-on') {
      const url = $('#sTestUrl').value.trim();
      if (url && !/^https:\/\/|^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(url)) {
        toast('주소는 https:// 또는 http://127.0.0.1 로 시작해야 합니다.', 'err');
        return;
      }
      const okGo = await confirmDialog('테스트 모드 켜기',
        '연습용 저장소로 앱을 다시 엽니다. 진짜 자료는 그대로 두었다가 끄면 돌아옵니다.', '켜기');
      if (!okGo) return;
      enableTestMode(url);
      location.reload();
      return;
    }
    if (act === 'test-off') {
      disableTestMode();
      location.reload();
      return;
    }
    if (act === 'install-help') { showManualGuide(); return; }
    if (act === 'sheets-help') { openSheetsGuide(settings); return; }

    if (act === 'copy-url') {
      const ok = await copyText(build.siteUrl || '');
      toast(ok ? '주소를 복사했습니다.' : '복사에 실패했습니다.', ok ? 'ok' : 'err');
      return;
    }

    if (act === 'copy-install') {
      const link = getInstallLink();
      const ok = await copyText((link && link.installUrl) || '');
      toast(ok ? '설치 링크를 복사했습니다. 메시지로 보내면 바로 받을 수 있습니다.'
        : '복사에 실패했습니다.', ok ? 'ok' : 'err');
      return;
    }

    if (act === 'save-name') {
      // 예전에는 이 칸에 버튼이 없어서, 이름을 적어도 [새로고침] 이나 시트 카드의
      // [저장] 을 누르지 않으면 등록되지 않았다. 적고 화면을 나가면 사라졌다.
      const name = $('#sDevice').value.trim();
      if (!name) {
        toast('이름을 먼저 입력해 주세요.', 'err');
        $('#sDevice').focus();
        return;
      }
      setDeviceName(name);
      const hint = $('#nameHint');
      if (hint) hint.innerHTML = `등록됨 · <strong>${h(name)}</strong>`;
      // 화면 머리의 "기기 …" 표시도 함께 맞춘다 (다시 그리지 않고 그 부분만).
      const head = document.querySelector('.page-head__meta');
      if (head) head.innerHTML = head.innerHTML.replace(/기기 [^·]*·/, `기기 ${h(name)} ·`);
      toast(`'${name}' 으로 등록했습니다.`, 'ok');
      return;
    }

    if (act === 'app-update') { startUpdate(); return; }
    if (act === 'sheet-recheck') {
      btn.disabled = true;
      btn.textContent = '확인 중…';
      const result = await ensureSheetConnection({ force: true });
      if (result && result.error) toast(result.error, 'err');
      else if (!result) toast('오프라인입니다. 인터넷이 되는 곳에서 다시 눌러 주세요.', 'err');
      settingsView(view);
      return;
    }
    if (act === 'show-sheet-form') { sheetFormOpen = true; settingsView(view); return; }
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

  // 이름 칸에서 엔터를 눌러도 등록된다 (현장에서 키보드만으로 끝낼 수 있게).
  $('#sDevice').addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter') return;
    ev.preventDefault();
    /** @type {HTMLElement} */ (document.querySelector('[data-act="save-name"]')).click();
  });

  const sheetsForm = $('#sheetsForm');
  if (sheetsForm) sheetsForm.addEventListener('submit', async (ev) => {
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
    <div class="sub-card" style="margin-top:10px">
      <strong style="font-size:.92rem">사진을 더 빨리 보려면 (선택)</strong>
      <p class="muted" style="margin:6px 0 0;font-size:.88rem;line-height:1.65">
        Apps Script 화면 왼쪽 <strong>[서비스]</strong> → <strong>Drive API</strong> 를 추가해 두면,
        올린 사진을 '링크가 있는 누구나' 로 만들 수 있어 구글이 직접 그림을 보내 줍니다.
        추가하지 않아도 사진은 보입니다 — 시트를 거쳐 받아오므로 처음 한 번만 조금 느립니다.
      </p>
    </div>
    <div class="form-actions">
      <button class="btn btn--primary" type="button" data-act="close">확인</button>
    </div>`);
  return body;
}

/**
 * 확인할 것 — 사람이 손대야 하는 것만 모은다. 없으면 칸 자체가 없다.
 *  · 올리지 못한 것 (실패했거나 30분 넘게 남음)
 *  · 남이 먼저 고친 가이드 (내 것 / 남의 것 고르기)
 *  · 시트로 아직 못 보낸 현장 오류
 */
function checkPanelHtml(attn, conflicts) {
  const stuck = attn.pending && (attn.failed || attn.oldestMin >= 30);
  if (!stuck && !conflicts.length && !attn.errors) return '';
  return `
    <div class="panel panel--check" id="checkPanel">
      <h2 class="panel__title">확인할 것</h2>
      ${stuck ? `
        <div class="check-item" data-tone="bad">
          <b>올리지 못한 것 ${attn.pending}건</b>
          <span>${attn.failed ? h(attn.failed) : '30분 넘게 올라가지 않았습니다.'}
            위 [새로고침] 을 눌러 다시 올리거나, 상단 칩에서 무엇이 남았는지 봅니다.</span>
        </div>` : ''}
      ${conflicts.map((c) => `
        <div class="check-item" data-tone="warn">
          <b>남이 먼저 고친 가이드 — ${h(c.title)}</b>
          <span>${c.mine ? '내가 고친 내용' : '내가 지우려던 것'}을 올리기 전에 다른 사람이 먼저 고쳤습니다.
            지금 시트에는 남의 것이 있습니다.</span>
          <div class="check-item__acts">
            <button class="btn btn-secondary btn--sm" data-act="conflict-theirs" data-id="${h(c.id)}" type="button">남의 것 그대로</button>
            <button class="btn btn-dark btn--sm" data-act="conflict-mine" data-id="${h(c.id)}" type="button">${c.mine ? '내 것으로 덮기' : '그래도 지우기'}</button>
          </div>
        </div>`).join('')}
      ${attn.errors ? `
        <div class="check-item">
          <b>시트로 아직 못 보낸 오류 ${attn.errors}건</b>
          <span>연결되면 저절로 '오류기록' 탭으로 갑니다.</span>
          <div class="check-item__acts">
            <button class="btn btn-secondary btn--sm" data-act="send-errors" type="button">지금 보내기</button>
          </div>
        </div>` : ''}
    </div>`;
}

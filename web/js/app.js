// 해시 라우터 + 메인 화면
import { api } from './api.js';
import { $, h, CATEGORY, closeModal, errorView, loading, openSheet, toast } from './ui.js';
import { guideListView, guideDetailView, guideEditView, guideHubView } from './views/guides.js';
import { inventoryView } from './views/inventory.js';
import { drivingView } from './views/driving.js';
import { fieldsView } from './views/fields.js';
import { reportFormView, reportListView, reportDetailView } from './views/report.js';
import { settingsView } from './views/settings.js';
import { initSyncButton } from './syncnow.js';
import { initInstallBanner } from './install.js';
import { initNetStatus, ensureFirstData, catchUpFromSheet } from './net.js';
import { initUpdateBanner } from './update.js';

const view = $('#view');
const HEX = '[0-9a-f]{6,}';

const routes = [
  [/^\/?$/, mainView],
  [/^\/search$/, searchView],
  [/^\/guides$/, () => guideHubView(view)],        // 가이드 탭 — 종류 카드 + 목록
  [/^\/guides\/(ERROR_CODE|HARDWARE_SOP|SOFTWARE_CMD)$/, (m) => guideListView(view, m[1])],
  [/^\/guides\/new\/(ERROR_CODE|HARDWARE_SOP|SOFTWARE_CMD)$/, (m) => guideEditView(view, null, m[1])],
  [/^\/guides\/new$/, () => guideEditView(view, null, null)],   // 종류는 폼 안에서 고른다
  [new RegExp(`^/guides/edit/(${HEX})$`), (m) => guideEditView(view, m[1])],
  [new RegExp(`^/guides/(${HEX})$`), (m) => guideDetailView(view, m[1])],
  [/^\/inventory$/, () => inventoryView(view)],
  [/^\/driving$/, () => drivingView(view)],
  [/^\/fields$/, () => fieldsView(view)],
  // 같은 화면이지만 하는 일이 다르다 — 주소가 새 리포트인지 수정인지를 정한다.
  [/^\/report\/(new|edit)$/, () => reportFormView(view)],
  [/^\/reports$/, () => reportListView(view)],
  [new RegExp(`^/reports/(${HEX})$`), (m) => reportDetailView(view, m[1])],
  [/^\/settings$/, () => settingsView(view)],
];

function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, queryString] = raw.split('?');
  return { path: path || '/', query: new URLSearchParams(queryString || '') };
}

function paintTabs(path) {
  const active =
    path === '/' || path.startsWith('/search') ? 'home'
    : path.startsWith('/guides') ? 'guides'
    : path.startsWith('/inventory') ? 'inventory'
    : path.startsWith('/driving') ? 'driving'
    : path.startsWith('/report/new') ? 'new'
    : path.startsWith('/reports') ? 'reports'
    : path.startsWith('/settings') || path.startsWith('/fields') ? 'settings'
    : '';
  document.querySelectorAll('.tab').forEach((el) => {
    if (el.dataset.tab === active) el.setAttribute('aria-current', 'page');
    else el.removeAttribute('aria-current');
  });
}

/**
 * 상단바 오른쪽 — 새 리포트 화면에서는 [새로고침] 자리에 [구글 시트로 업로드] 가 온다.
 *
 * 업로드 버튼이 폼 맨 아래에만 있어 항목이 많으면 스크롤해 내려가야 보였다.
 * 그 화면에서 새로고침은 쓸 일이 거의 없으므로 자리를 내준다. 글자는 폼의
 * 실제 버튼에서 가져온다 (새 리포트 '구글 시트로 업로드' · 수정 '시트에 저장').
 */
function paintTopAction(path) {
  const onReport = path.startsWith('/report/');
  const action = $('#btn-topaction');
  const refresh = $('#btn-update');
  if (action) action.hidden = !onReport;
  if (refresh) refresh.hidden = onReport;
}

/**
 * 폼이 그려진 뒤 상단바 버튼을 폼의 버튼과 맞춘다 — 글자와 **눌림 여부**까지.
 *
 * 올리는 동안은 폼 쪽에서 둘 다 잠그는데, 화면을 떠났다 돌아왔을 때
 * 상단바 버튼만 잠긴 채로 남으면 다시는 못 누른다. 새 폼이 그려질 때마다
 * 폼 버튼 상태를 그대로 따라가게 해 그런 상태가 남지 않게 한다.
 */
function syncTopActionLabel() {
  const action = $('#btn-topaction');
  const submit = document.querySelector('#reportForm button[type=submit]');
  if (action && submit) {
    action.textContent = submit.textContent.trim();
    action.disabled = submit.disabled;
  }
}

async function render() {
  const { path, query } = parseHash();
  closeModal();   // 화면을 이동하면 열려 있던 모달/시트를 닫는다
  $('#backBtn').hidden = (path === '/' || path === '');
  paintTabs(path);
  paintTopAction(path);
  view.scrollTop = 0;
  for (const [pattern, handler] of routes) {
    const match = pattern.exec(path);
    if (match) {
      try {
        await handler(match, query);
        syncTopActionLabel();
      } catch (err) {
        console.error(err);
        errorView(view, err.message || '알 수 없는 오류가 발생했습니다.');
      }
      return;
    }
  }
  view.innerHTML = `<div class="empty">존재하지 않는 화면입니다.<br /><a class="link" href="#/">메인으로 돌아가기</a></div>`;
}

// ------------------------------------------------------------- 홈 (검색 우선)
//
// 현장에서 가장 먼저 하는 일이 "이 코드가 뭐지" 라서, 검색 입력대를 화면의 주인공으로 둔다.
// 자주 찾는 코드는 실제 가이드에서 뽑아 한 번 터치로 들어가게 한다.
async function mainView() {
  loading(view);
  const items = (await api.listGuides()).items;      // 전부 기기에 있다 (오프라인 OK)
  const drafts = (await api.listReports()).items.filter((r) => r.status !== 'UPLOADED');
  const pending = await api.pendingCount();
  const month = await monthSummary();

  const codes = items
    .filter((g) => g.categoryType === 'ERROR_CODE')
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
    .slice(0, 6);

  view.innerHTML = `
    <section class="search-block">
      <div class="kicker">무엇을 찾고 있습니까</div>
      <form class="search-row" id="searchForm" role="search">
        <input class="input" id="searchInput" type="search" autocomplete="off"
               enterkeyhint="search" aria-label="통합 검색"
               placeholder="오류 코드 · 부품명 · 증상 · 명령어" />
        <button class="btn btn-primary" type="submit">검색</button>
      </form>
    </section>

    ${codes.length ? `
      <section class="quick-block home-card">
        <div class="label">자주 찾는 코드</div>
        <div class="code-grid">
          ${codes.map((g) => `
            <a class="btn btn-secondary code-btn" href="#/guides/${g.id}"
               title="${h(g.summary || '')}">${h(g.codeOrTitle.split(' ')[0])}</a>`).join('')}
        </div>
      </section>` : ''}

    ${month ? `
      <section class="quick-block home-card">
        <div class="label">${h(month.name)} 처리 현황</div>
        <div class="home-stats">
          ${month.tiles.map((t) => `
            <a class="stat" data-track="${t.cls}" href="#/reports">
              <span class="stat__n tnum">${t.n}</span>
              <span class="stat__label">${h(t.label)}</span>
            </a>`).join('')}
        </div>
      </section>` : ''}

    `;

  $('#searchForm').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const q = $('#searchInput').value.trim();
    if (!q) { toast('검색어를 입력하세요.'); return; }
    location.hash = `#/search?q=${encodeURIComponent(q)}`;
  });
}

const SHORT = { ERROR_CODE: '', HARDWARE_SOP: 'SOP', SOFTWARE_CMD: 'CMD' };

/**
 * 이번 달 리포트를 상태별로 센다.
 *
 * 기기에 받아 둔 이력 사본만 본다 — 홈을 열 때마다 시트를 부르면 느리고,
 * 오프라인에서는 아예 안 된다. 사본이 없으면 이 구역을 통째로 감춘다.
 */
async function monthSummary() {
  try {
    const store = await import('./local/store.js');
    const d = new Date();
    const name = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const cached = await store.getMeta(`sheetReports:${name}`, null);
    if (!cached || !(cached.entries || []).length) return null;

    const order = ['조치 진행 중', '교체 예정', '모니터링', '조치 완료'];
    // 이력 화면의 상태 색과 같은 이름표 — 같은 뜻에 같은 색.
    const cls = { '조치 진행 중': 'doing', '교체 예정': 'swap', '모니터링': 'watch', '조치 완료': 'done' };
    const count = {};
    for (const entry of cached.entries) {
      count[entry.status] = (count[entry.status] || 0) + 1;
    }
    return {
      name,
      // 아직 안 끝난 것을 왼쪽에 둔다 — 홈에서 먼저 눈에 들어와야 하는 값이다.
      tiles: order.map((label) => ({
        label, n: count[label] || 0, open: label !== '조치 완료', cls: cls[label],
      })),
    };
  } catch {
    return null;
  }
}


function guideRow(guide) {
  const meta = CATEGORY[guide.categoryType] || { emoji: '', label: '' };
  return `
    <a class="item cat-${guide.categoryType}" href="#/guides/${guide.id}">
      <div style="font-size:1.4rem">${meta.emoji}</div>
      <div class="item__body">
        <div class="item__title">${h(guide.codeOrTitle)}</div>
        <div class="item__sub">${h(guide.summary || meta.label)}</div>
      </div>
      <span class="badge">${guide.stepCount || 0}단계</span>
      <span class="item__chevron">›</span>
    </a>`;
}

// ------------------------------------------------------------- 검색 결과
async function searchView(_match, query) {
  const q = query.get('q') || '';
  loading(view);
  const items = (await api.listGuides(null, q)).items;
  view.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-head__title">검색 결과</h1>
      </div>
      <span class="page-head__meta">"${h(q)}" · <span class="tnum">${items.length}</span>건 — 코드 · 요약 · 공구 · 단계 · 명령어를 전부 훑습니다</span>
    </div>
    <form class="search-row" id="searchForm" role="search">
      <input class="input" id="searchInput" type="search" value="${h(q)}"
             enterkeyhint="search" aria-label="통합 검색" />
      <button class="btn btn-primary" type="submit">재검색</button>
    </form>
    ${items.length ? `<div class="list">${items.map(guideRow).join('')}</div>`
      : '<div class="empty">일치하는 가이드가 없습니다.</div>'}`;
  $('#searchForm').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const next = $('#searchInput').value.trim();
    location.hash = next ? `#/search?q=${encodeURIComponent(next)}` : '#/';
  });
}

// ------------------------------------------------------------------ 부팅
$('#backBtn').addEventListener('click', () => {
  if (history.length > 1) history.back();
  else location.hash = '#/';
});

// 상단바의 [구글 시트로 업로드] — 폼 아래 버튼을 대신 눌러 준다.
// 저장 규칙(필수 칸·첨부 한도)은 폼 쪽 한 곳에만 있어야 어긋나지 않는다.
$('#btn-topaction').addEventListener('click', () => {
  const submit = document.querySelector('#reportForm button[type=submit]');
  if (!submit) return;
  if (submit.disabled) { toast('저장 중입니다. 잠시만 기다려 주세요.'); return; }
  submit.click();
});

window.addEventListener('hashchange', render);

// 화면을 **먼저** 띄운다. 시트에서 받아오는 일은 뒤에서 한다.
// 예전에는 시트 왕복 세 번이 끝나기를 기다렸다가 그려서, 앱을 열거나
// 웹 페이지를 새로고침하면 3~8초 동안 빈 화면이었다.
(async () => {
  const added = await ensureFirstData();   // 기기 안에서 끝나는 준비 (수십 ms)
  render();
  if (added) render();                     // 붙박이 항목이 방금 들어왔으면 한 번 더
  catchUpFromSheet();                      // 시트 최신본은 뒤에서 조용히
  // 시트 연결 — 주소가 비어 있으면 공용 주소를 적어 넣고, 처음이면 확인해 알린다.
  import('./connect.js').then((c) => c.ensureSheetConnection()).catch(() => {});
  // 남이 올린 새 내용이 있으면 [새로고침] 에 점 · 내 것이 올라가면 한 줄 알림.
  // 화면은 건드리지 않는다 — 받는 시점은 사람이 정한다.
  import('./changes.js').then((c) => c.initChangeWatch()).catch(() => {});
})();
registerServiceWorker();       // 오프라인에서 앱이 열리도록
initUpdateBanner();            // 새 버전 안내 띠 (지난번 받아 둔 정보로 먼저 그린다)
initNetStatus();               //  오프라인 표시 + 대기 작업 자동 처리
initSyncButton();
initInstallBanner();


/** 앱 화면 파일을 기기에 담아 두어 인터넷 없이도 앱이 열리게 한다. */
async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // http:// 로 접속하면 브라우저가 서비스워커를 막는다(localhost 는 예외).
  if (!window.isSecureContext) return;
  try {
    await navigator.serviceWorker.register('./sw.js', { scope: './' });
  } catch { /* 등록 실패해도 데이터는 기기에 있으므로 앱은 동작한다 */ }
}

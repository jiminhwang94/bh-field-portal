// 해시 라우터 + 메인 화면
import { api } from './api.js';
import { $, h, closeModal, errorView, loading, toast } from './ui.js';
import {
  guideListView, guideDetailView, guideEditView, guideHubView, guideModelView, modelHref,
  row as guideRow,
} from './views/guides.js';
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
  [/^\/guides$/, () => guideHubView(view)],        // 가이드 탭 — 로봇 고르기
  // 로봇 하나 — 종류(오류 코드 · 하드웨어 · SW) 셋과 그 목록
  [/^\/guides\/m\/([^/]+)(?:\/(ERROR_CODE|HARDWARE_SOP|SOFTWARE_CMD))?$/,
    (m) => guideModelView(view, decodeURIComponent(m[1]), m[2] || null)],
  [/^\/guides\/(ERROR_CODE|HARDWARE_SOP|SOFTWARE_CMD)$/, (m) => guideListView(view, m[1])],
  [/^\/guides\/new\/(ERROR_CODE|HARDWARE_SOP|SOFTWARE_CMD)$/,
    (m, q) => guideEditView(view, null, m[1], q.get('model'))],
  [/^\/guides\/new$/, (m, q) => guideEditView(view, null, null, q.get('model'))],   // 종류는 폼 안에서 고른다
  [new RegExp(`^/guides/edit/(${HEX})$`), (m) => guideEditView(view, m[1])],
  [new RegExp(`^/guides/(${HEX})$`), (m) => guideDetailView(view, m[1])],
  [/^\/inventory$/, () => inventoryView(view)],
  [/^\/driving$/, () => drivingView(view)],
  [/^\/fields$/, () => fieldsView(view)],
  // 같은 화면이지만 하는 일이 다르다 — 주소가 새 리포트인지 수정인지를 정한다.
  [/^\/report\/(new|edit)$/, () => reportFormView(view)],
  [/^\/reports$/, (m, q) => reportListView(view, q)],   // ?q= 검색어 · ?open= 바로 열 건
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
  paintNavBadge();
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

// ------------------------------------------------------------- 홈
//
// 현장에서 하는 일의 차례대로 세 칸만 둔다.
//   1. 새 리포트 쓰기 — 가장 크게. 올리지 않은 리포트가 있으면 같은 자리에 알린다.
//   2. 리포트 이력 — 검색 칸 + 이번 달 최근 기록. 누르면 이력에서 바로 그 건이 열린다.
//   3. 가이드 — 로봇(Gen.1 · Gen.2 · Zephyr …) 버튼. 오류 코드 검색도 여기서.
async function mainView() {
  loading(view);
  const guides = (await api.listGuides()).items;          // 전부 기기에 있다 (오프라인 OK)
  const models = await api.listGuideModels();
  const drafts = (await api.listReports()).items.filter((r) => r.status !== 'UPLOADED');
  const month = await monthEntries();

  const modelKeys = [...models];
  for (const g of guides) {
    const k = (g.robotModel || '').trim();
    if (k && !modelKeys.includes(k)) modelKeys.push(k);
  }
  const unassigned = guides.filter((g) => !(g.robotModel || '').trim()).length;

  const recent = month ? month.entries.slice(0, 6) : [];
  const open = month ? month.entries.filter((e) => e.status !== '조치 완료').length : 0;

  view.innerHTML = `
    <div class="home">
      <a class="home-new" href="#/report/new">
        <span class="home-new__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2h8l4 4v16H6z"/><path d="M12 11v6M9 14h6"/></svg>
        </span>
        <span class="home-new__text">
          <span class="home-new__title">새 리포트 쓰기</span>
          <span class="home-new__sub">${drafts.length
            ? `올리지 않은 리포트 <b class="tnum">${drafts.length}</b>건이 있습니다`
            : '사진 찍고 바로 구글 시트로'}</span>
        </span>
        <span class="home-new__go" aria-hidden="true">›</span>
      </a>

      <section class="home-panel home-hist" aria-labelledby="homeHistTitle">
        <div class="home-panel__head">
          <h2 id="homeHistTitle">리포트 이력</h2>
          ${month ? `<span class="home-panel__meta">${h(month.name)} · <span class="tnum">${month.entries.length}</span>건 · 진행 중 <span class="tnum">${open}</span></span>` : ''}
          <span class="spacer"></span>
          <a class="btn btn-secondary" href="#/reports">전체 이력</a>
        </div>
        <form class="home-search" id="histSearch" role="search">
          <input class="input" id="histSearchQ" type="search" autocomplete="off" enterkeyhint="search"
                 aria-label="이력 검색" placeholder="식당명 · 날짜로 이력 찾기 (미트로, 10-18)" />
          <button class="btn btn-primary" type="submit">찾기</button>
        </form>
        <div class="home-hist__rows">
          ${recent.length ? recent.map((e) => `
            <a class="hrow" href="#/reports?open=${encodeURIComponent(e.key)}">
              <span class="hrow__date tnum">${h((e.date || '').slice(5) || '-')}</span>
              <span class="hrow__main">
                <span class="hrow__store">${h(e.store || '(식당명 없음)')}</span>
                ${e.summary ? `<span class="hrow__sub">${h(e.summary)}</span>` : ''}
              </span>
              <span class="hrow__status" data-track="${TRACK_CLS[e.status] || 'doing'}">${h(e.status)}</span>
            </a>`).join('')
            : `<div class="empty">아직 받아 둔 이력이 없습니다.<br /><a class="link" href="#/reports">리포트 이력</a>을 한 번 열면 여기에 보입니다.</div>`}
        </div>
      </section>

      <section class="home-panel home-guides" aria-labelledby="homeGuideTitle">
        <div class="home-panel__head">
          <h2 id="homeGuideTitle">가이드</h2>
          <span class="home-panel__meta">로봇을 고르세요</span>
          <span class="spacer"></span>
          <a class="btn btn-secondary" href="#/guides">전체</a>
        </div>
        <div class="model-list">
          ${modelKeys.map((m) => `
            <a class="model-btn" href="${modelHref(m)}">
              <span class="model-btn__name">${h(m)}</span>
              <span class="model-btn__meta tnum">${guides.filter((g) => (g.robotModel || '').trim() === m).length}건</span>
            </a>`).join('')}
          ${unassigned ? `
            <a class="model-btn model-btn--none" href="${modelHref(null)}">
              <span class="model-btn__name">로봇 미지정</span>
              <span class="model-btn__meta tnum">${unassigned}건</span>
            </a>` : ''}
        </div>
        <form class="home-search" id="guideSearch" role="search">
          <input class="input" id="guideSearchQ" type="search" autocomplete="off" enterkeyhint="search"
                 aria-label="가이드 검색" placeholder="오류 코드 · 증상 검색" />
          <button class="btn btn-secondary" type="submit">검색</button>
        </form>
      </section>
    </div>`;

  $('#histSearch').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const q = $('#histSearchQ').value.trim();
    location.hash = q ? `#/reports?q=${encodeURIComponent(q)}` : '#/reports';
  });
  $('#guideSearch').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const q = $('#guideSearchQ').value.trim();
    if (!q) { toast('검색어를 입력하세요.'); return; }
    location.hash = `#/search?q=${encodeURIComponent(q)}`;
  });
}

/** 이력 화면의 상태 이름 → 색 이름표 (같은 뜻에 같은 색). */
const TRACK_CLS = { '조치 진행 중': 'doing', '교체 예정': 'swap', '모니터링': 'watch', '조치 완료': 'done' };

/**
 * 이번 달 이력 — 기기에 받아 둔 사본만 본다. 홈을 열 때마다 시트를 부르면 느리고,
 * 오프라인에서는 아예 안 된다. 사본이 없으면 null.
 */
async function monthEntries() {
  try {
    const store = await import('./local/store.js');
    const d = new Date();
    const name = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const cached = await store.getMeta(`sheetReports:${name}`, null);
    if (!cached || !(cached.entries || []).length) return null;
    const entries = [...cached.entries].sort((a, b) =>
      String(b.createdAt || b.date || '').localeCompare(String(a.createdAt || a.date || '')));
    return { name, entries };
  } catch {
    return null;
  }
}

/** 왼쪽 메뉴 [차량 재고] 옆 숫자 — 보충이 필요한 품목 수 (모든 차량). */
async function paintNavBadge() {
  const badge = document.getElementById('invBadge');
  if (!badge) return;
  try {
    const store = await import('./local/store.js');
    const low = (await store.listInventory())
      .filter((i) => i.minQuantity > 0 && i.quantity < i.minQuantity).length;
    badge.textContent = low;
    badge.hidden = !low;
    badge.setAttribute('aria-label', `보충 필요 ${low}건`);
  } catch {
    badge.hidden = true;
  }
}

// ------------------------------------------------------------- 검색 결과
async function searchView(_match, query) {
  const q = query.get('q') || '';
  loading(view);
  const items = (await api.listGuides(null, q)).items;
  view.innerHTML = `
    <div class="page-head">
      <a class="crumb" href="#/guides">가이드</a>
      <h1 class="page-head__title">검색 결과</h1>
      <span class="page-head__meta">"${h(q)}" · <span class="tnum">${items.length}</span>건 — 모든 로봇의 코드 · 요약 · 공구 · 단계 · 명령어</span>
    </div>
    <form class="search-row" id="searchForm" role="search">
      <input class="input" id="searchInput" type="search" value="${h(q)}"
             enterkeyhint="search" aria-label="가이드 검색" />
      <button class="btn btn-primary" type="submit">재검색</button>
    </form>
    ${items.length ? `<div class="rows">${items.map((g) => guideRow(g, true)).join('')}</div>`
      : '<div class="empty">일치하는 가이드가 없습니다.</div>'}`;
  $('#searchForm').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const next = $('#searchInput').value.trim();
    location.hash = next ? `#/search?q=${encodeURIComponent(next)}` : '#/guides';
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
// 재고 화면에서 수량을 바꾸면 왼쪽 메뉴의 [보충 필요] 숫자도 맞춘다.
window.addEventListener('bh-inventory-changed', paintNavBadge);

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

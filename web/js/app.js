// 해시 라우터 + 메인 화면
import { api } from './api.js';
import { $, h, closeModal, errorView, loading, openSheet, toast, when } from './ui.js';
import {
  guideAssignView, guideListView, guideHubView, guideModelView,
  modelHref,
  row as guideRow,
} from './views/guides.js';
import { guideDetailView, guideEditView } from './views/guide-page.js';
import { inventoryView } from './views/inventory.js';
import { drivingView } from './views/driving.js';
import { fieldsView } from './views/fields.js';
import { reportFormView } from './views/report.js';
import { reportListView, reportDetailView } from './views/history.js';
import { storeHistoryView } from './views/store.js';
import { statsView } from './views/stats.js';
import { workView } from './views/work.js';
import { settingsView } from './views/settings.js';
import { initSyncButton } from './syncnow.js';
import { PATCH_NOTES } from './patchnotes.js';
import { APP_VERSION } from './version.js';
import { initInstallBanner } from './install.js';
import { initNetStatus, ensureFirstData, catchUpFromSheet } from './net.js';
import { initUpdateBanner, initVersionGate } from './update.js';
import { initErrorLog } from './errlog.js';
import { paintTestBanner } from './mode.js';

const view = $('#view');
const HEX = '[0-9a-f]{6,}';

/** @type {Array<[RegExp, (match: RegExpExecArray, query: URLSearchParams) => any]>} */
const routes = [
  [/^\/?$/, mainView],
  [/^\/search$/, searchView],
  [/^\/store$/, (m, q) => storeHistoryView(view, q.get('name'))],   // 매장별 이력
  [/^\/stats$/, (m, q) => statsView(view, q)],                      // 통계
  [/^\/work$/, () => workView(view)],                               // 설정 → 작업 목록
  [/^\/guides$/, () => guideHubView(view)],        // 가이드 탭 — 로봇 고르기
  [/^\/guides\/assign$/, () => guideAssignView(view)],  // 로봇 한 번에 지정
  // 로봇 하나 — 종류(오류 코드 · 하드웨어 · SW) 셋과 그 목록
  [/^\/guides\/m\/([^/]+)(?:\/(ERROR_CODE|HARDWARE_SOP|SOFTWARE_CMD))?$/,
    (m) => guideModelView(view, decodeURIComponent(m[1]), m[2] || null)],
  [/^\/guides\/(ERROR_CODE|HARDWARE_SOP|SOFTWARE_CMD)$/, (m) => guideListView(view, m[1])],
  [/^\/guides\/new\/(ERROR_CODE|HARDWARE_SOP|SOFTWARE_CMD)$/,
    (m, q) => guideEditView(view, null, m[1], q.get('model'))],
  [/^\/guides\/new$/, (m, q) => guideEditView(view, null, null, q.get('model'))],   // 종류는 폼 안에서 고른다
  [new RegExp(`^/guides/edit/(${HEX})$`), (m) => guideEditView(view, m[1])],
  [new RegExp(`^/guides/(${HEX})$`), (m, q) => guideDetailView(view, m[1], q)],   // ?store=&serial= 이력에서 온 로봇
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
    : path.startsWith('/settings') || path.startsWith('/fields') || path.startsWith('/work') ? 'settings'
    : '';
  document.querySelectorAll('.tab').forEach((/** @type {HTMLElement} */ el) => {
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
  const submit = /** @type {HTMLButtonElement} */ (document.querySelector('#reportForm button[type=submit]'));
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

// ------------------------------------------------------------- 홈 (v3.35 A안 — 세 개의 문)
//
// 현장에서 중요한 차례가 곧 크기다 (팀 결정: 1 새 리포트 · 2 이력 · 3 가이드 · 4 운행일지 · 5 재고).
//   ┌ 새 리포트 (왼쪽 절반 전체) ┬ 리포트 이력 ┐
//   │  · 이어 쓰기 · 접수 대기    ├ 가이드      ┤
//   └ 운행일지 · 차량 재고 · 설정 (아래 작은 줄) ┘
// 설명을 읽지 않아도 무엇부터 누르는지 보이게 한다. 장갑으로 누르므로 문 전체가 버튼이다.
const ICON_SVG = (d, w = 1.8) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}"
  stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
const I = {
  report: 'M6 2.5h8l4 4V21.5H6zM12 10.5v7M8.5 14h7',
  hist: 'M3 7h7l2 2h9v11H3zM3 7V4h6v3',
  guide: 'M4 4h6a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H4zM20 4h-6a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h6z',
  log: 'M5 3h14v18H5zM8 8h8M8 12h8M8 16h5',
  truck: 'M2 6h11v10H2zM13 9h5l3 3.5V16h-8zM6.5 16a2 2 0 1 0 0 4a2 2 0 1 0 0-4M17 16a2 2 0 1 0 0 4a2 2 0 1 0 0-4',
  set: 'M4 7h16M4 12h16M4 17h16',
  go: 'M5 12h14M13 6l6 6-6 6',
  chev: 'm9 6 6 6-6 6',
  resume: 'M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5M20 12a8 8 0 0 1-14 5.3L4 15M4 20v-5h5',
  clock: 'M12 3.5a8.5 8.5 0 1 0 0 17a8.5 8.5 0 1 0 0-17M12 7.5V12l3 2',
};

async function mainView() {
  loading(view);
  const guides = (await api.listGuides()).items;          // 전부 기기에 있다 (오프라인 OK)
  const models = await api.listGuideModels();
  const drafts = (await api.listReports()).items.filter((r) => r.status === 'DRAFT');
  const unsent = (await api.listReports()).items.filter((r) => r.status !== 'UPLOADED' && r.status !== 'DRAFT');
  const numbers = await requestNumbers();
  const month = await monthEntries();
  const stock = await lowStock();
  const attn = await api.attention();
  const entries = month ? month.entries : [];
  const overdue = entries.filter((e) => e.status !== '조치 완료' && openDays(e) >= OVERDUE_DAYS);
  const alerts = [];
  if (attn.pending && (attn.failed || attn.oldestMin >= 30)) {
    alerts.push({ tone: 'bad', href: '#/settings', text: `올리지 못한 것 ${attn.pending}건`,
                  sub: attn.failed ? '올리기가 실패했습니다 — 눌러서 확인' : `가장 오래된 것 ${agoText(attn.oldestMin)}` });
  }
  if (attn.conflicts) {
    alerts.push({ tone: 'warn', href: '#/settings', text: `남이 먼저 고친 가이드 ${attn.conflicts}건`,
                  sub: '내 것 · 남의 것 중 고르세요' });
  }
  if (overdue.length) {
    alerts.push({ tone: 'warn', href: '#/reports?old=1', text: `${OVERDUE_DAYS}일 넘게 끝나지 않은 리포트 ${overdue.length}건`,
                  sub: overdue.slice(0, 3).map((e) => e.store).filter(Boolean).join(' · ') });
  }

  const robots = [...models];
  for (const g of guides) {
    const k = (g.robotModel || '').trim();
    if (k && !robots.includes(k)) robots.push(k);
  }
  const count = (s) => entries.filter((e) => e.status === s).length;
  const recent = entries[0];
  const draft = drafts[0];
  const stores = [...new Set(numbers.map((n) => n.store).filter(Boolean))];

  view.innerHTML = `
    <div class="home3${alerts.length ? ' home3--alert' : ''}">
      ${alerts.length ? `
        <div class="h2-alerts" role="status">
          ${alerts.map((a) => `
            <a class="h2-alert" data-tone="${a.tone}" href="${a.href}">
              <b>${h(a.text)}</b>${a.sub ? `<span>${h(a.sub)}</span>` : ''}<span class="h2-alert__go" aria-hidden="true">›</span>
            </a>`).join('')}
        </div>` : ''}

      <section class="door door--new" aria-label="새 리포트">
        <a class="door__main" href="#/report/new">
          <span class="door__icon">${ICON_SVG(I.report)}</span>
          <span class="door__title">새 리포트${ICON_SVG(I.go, 2.2)}</span>
          <span class="door__sub">접수 건을 누르면 매장이 채워집니다. 한 화면에 하나씩 묻습니다.</span>
        </a>
        <div class="door__queue">
          ${draft ? `
            <a class="door__row door__row--resume" href="#/report/new?draft=${h(draft.id)}">
              ${ICON_SVG(I.resume, 2.2)}<b>이어 쓰기 · ${h(draftStore(draft) || draft.title)}</b>
              <span>임시보관 · ${h(when(draft.updatedAt || draft.createdAt))}</span>${ICON_SVG(I.chev, 2.4)}
            </a>` : ''}
          ${numbers.length ? `
            <a class="door__row" href="#/report/new">
              <b>접수 대기 <span class="tnum">${numbers.length}</span>건</b>
              <span>${h(stores.slice(0, 2).join(' · '))}${stores.length > 2 ? ` 외 ${stores.length - 2}` : ''}</span>${ICON_SVG(I.chev, 2.4)}
            </a>` : ''}
          ${unsent.length ? `
            <a class="door__row" href="#/reports">
              <b>올리는 중 <span class="tnum">${unsent.length}</span>건</b><span>인터넷이 되면 자동으로 올라갑니다</span>${ICON_SVG(I.chev, 2.4)}
            </a>` : ''}
        </div>
      </section>

      <a class="door door--hist" href="#/reports">
        <span class="door__head"><span class="door__icon">${ICON_SVG(I.hist)}</span>
          <span class="door__title">리포트 이력</span>${ICON_SVG(I.chev, 2.2)}</span>
        <span class="door__sub">${recent
          ? `최근: ${h(recent.store || '(식당명 없음)')}${recent.summary ? ` · ${h(recent.summary)}` : ''} · ${h((recent.date || '').slice(5))}`
          : '어떤 문제였고 무엇을 했는지 카드로 봅니다'}</span>
        <span class="door__counts">
          <span data-track="doing"><i></i>진행 중<b class="tnum">${count('조치 진행 중')}</b></span>
          <span data-track="swap"><i></i>교체 예정<b class="tnum">${count('교체 예정')}</b></span>
          <span data-track="late"${overdue.length ? '' : ' class="is-zero"'}>${ICON_SVG(I.clock, 2.2)}${OVERDUE_DAYS}일 넘음<b class="tnum">${overdue.length}</b></span>
        </span>
      </a>

      <section class="door door--guide" aria-label="가이드">
        <a class="door__main" href="#/guides">
          <span class="door__head"><span class="door__icon">${ICON_SVG(I.guide)}</span>
            <span class="door__title">가이드</span>${ICON_SVG(I.chev, 2.2)}</span>
          <span class="door__sub">로봇을 고르고, 오류 코드나 증상으로 찾습니다</span>
        </a>
        <div class="door__robots">
          ${robots.slice(0, 4).map((m) => `
            <a class="door__robot" href="${modelHref(m)}">${h(m)}<b class="tnum">${guides.filter((g) => (g.robotModel || '').trim() === m).length}</b></a>`).join('')}
        </div>
      </section>

      <nav class="home3__more" aria-label="그 밖의 일">
        <a class="more-tile" href="#/driving">${ICON_SVG(I.log)}<b>운행일지</b><span>차량 운행 기록</span></a>
        <a class="more-tile" href="#/inventory">${ICON_SVG(I.truck)}<b>차량 재고</b><span>${stock.low ? '보충 필요' : '재고 충분'}</span>
          ${stock.low ? `<i class="more-tile__n tnum">${stock.low}</i>` : ''}</a>
        <a class="more-tile more-tile--icon" href="#/settings" aria-label="설정">${ICON_SVG(I.set)}</a>
      </nav>
    </div>`;
}

/** 임시보관 리포트의 매장 이름 (제목은 첫 칸 글자라 리포트 번호일 때가 많다) */
function draftStore(report) {
  const hit = (report.payload || []).find((v) => /매장|식당/.test(v.label || '') && String(v.value || '').trim());
  return hit ? String(hit.value).trim() : '';
}

/** 받아 둔 접수 목록 ('필드팀 요청') — 홈은 시트에 묻지 않는다 */
async function requestNumbers() {
  try {
    const { cachedRequestNumbers } = await import('./reportsheet.js');
    return (await cachedRequestNumbers()) || [];
  } catch {
    return [];
  }
}

/** 끝나지 않은 채 이만큼 지나면 홈 · 이력에서 눈에 띄게 알린다. */
const OVERDUE_DAYS = 7;
/** 작성한 날부터 며칠째인가 (작성일 = 1일째) */
function openDays(entry) {
  const at = new Date(String(entry.createdAt || entry.date || '').replace(' ', 'T'));
  if (Number.isNaN(at.getTime())) return 0;
  return Math.floor((Date.now() - at.getTime()) / 86400000) + 1;
}
const agoText = (min) => (min < 60 ? `${min}분 전` : min < 1440 ? `${Math.floor(min / 60)}시간 전` : `${Math.floor(min / 1440)}일 전`);

/** 보충이 필요한 품목 수와 그 차량 수 — 모든 차량. */
async function lowStock() {
  try {
    const store = await import('./local/store.js');
    const low = (await store.listInventory()).filter((i) => i.minQuantity > 0 && i.quantity < i.minQuantity);
    return { low: low.length, vehicles: new Set(low.map((i) => i.vehicleName)).size };
  } catch {
    return { low: 0, vehicles: 0 };
  }
}

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
  const submit = /** @type {HTMLButtonElement} */ (document.querySelector('#reportForm button[type=submit]'));
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
initErrorLog();                // 화면 오류를 모았다가 시트 '오류기록' 으로
paintTestBanner();             // 테스트 모드면 맨 위 노란 띠
initVersionGate();             // 시트가 요구하는 최소 버전보다 낮으면 화면을 덮는다
registerServiceWorker();       // 오프라인에서 앱이 열리도록
initUpdateBanner();            // 새 버전 안내 띠 (지난번 받아 둔 정보로 먼저 그린다)
initNetStatus();               //  오프라인 표시 + 대기 작업 자동 처리
initSyncButton();
initPatchButton();             // 새로고침 옆 [패치 내용]
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

// ------------------------------------------------------------- 패치 내용
//
// 새로고침 옆 [패치 내용] — 버전마다 바뀐 점을 날짜와 함께. 안 본 새 버전이 있으면 버튼에 점.
function patchDate(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text || ''));
  return m ? `${Number(m[2])}월 ${Number(m[3])}일` : String(text || '');
}

function initPatchButton() {
  const PATCH_SEEN_KEY = 'bh_patch_seen';   // 함수 안에 둔다 — 위에서 먼저 불리므로(맨 아래 const 는 아직 없다)
  const btn = document.getElementById('btn-patch');
  if (!btn) return;
  const paintDot = () => {
    let seen = '';
    try { seen = localStorage.getItem(PATCH_SEEN_KEY) || ''; } catch { /* 없으면 새것으로 본다 */ }
    btn.classList.toggle('has-new', seen !== APP_VERSION);
  };
  paintDot();
  btn.addEventListener('click', () => {
    openSheet('패치 내용', `
      <div class="patch-notes">
        ${PATCH_NOTES.map((n) => `
          <section class="patch-note${n.version === APP_VERSION ? ' is-current' : ''}">
            <h3 class="patch-note__head">
              <b>${h(patchDate(n.date))}</b> <span class="muted tnum">v${h(n.version)}</span>
              ${n.version === APP_VERSION ? '<span class="patch-note__now">지금 쓰는 버전</span>' : ''}
            </h3>
            <ul class="patch-note__list">${n.items.map((t) => `<li>${h(t)}</li>`).join('')}</ul>
          </section>`).join('')}
      </div>`);
    try { localStorage.setItem(PATCH_SEEN_KEY, APP_VERSION); } catch { /* 이번만 */ }
    paintDot();
  });
}

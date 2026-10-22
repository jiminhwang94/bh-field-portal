// 가이드 목록 / 상세 / 편집 (오류코드 · HW SOP · SW 명령어)
import { api } from '../api.js';
import {
  $, $$, h, CATEGORY, closeModal, confirmDialog, copyText, hydrateMedia, loading,
  openSheet, promptDialog, toast, when,
} from '../ui.js';

const DONE_KEY = (id) => `bh_steps_done_${id}`;

/**
 * 단계에 붙은 것이 영상인가.
 *
 * 단계는 주소 한 칸(`imageUrl`)만 들고 다닌다 — 시트도 그 한 칸으로 주고받는다.
 * 그래서 종류를 따로 담을 자리가 없다. 기기 안 파일은 이름에 확장자가 남고,
 * 드라이브 주소는 올릴 때 **`#video` 를 붙여** 표시해 둔다 (주소로는 아무 뜻이
 * 없어 링크는 그대로 열리고, 시트에 적혀도 눌러서 열린다).
 */
const VIDEO_MARK = '#video';
export const isStepVideo = (url) =>
  /#video$|\.(mp4|mov|m4v|webm|3gp)(\?|$)/i.test(String(url || ''));

/** 드라이브 주소에서 파일 id. 못 찾으면 빈 문자열. */
const driveIdOf = (url) =>
  (String(url || '').match(/\/d\/([A-Za-z0-9_-]{10,})/) || [])[1] || '';

/**
 * 단계에 붙은 사진·영상 한 조각.
 *
 * 드라이브에 올라간 영상은 `<video src>` 로 못 튼다 — 드라이브가 파일이 아니라
 * 재생기 페이지를 주기 때문이다. 그래서 재생기를 그대로 끼운다 (리포트 상세와
 * 같은 방법). 기기 안 영상은 파일이 있으니 그냥 튼다.
 */
function stepMediaHtml(url, cls, alt) {
  if (!url) return '';
  if (!isStepVideo(url)) {
    return `<img class="${cls}" data-media="${h(url)}" alt="${h(alt)}" loading="lazy" />`;
  }
  const id = driveIdOf(url);
  if (id) {
    return `<iframe class="${cls}" src="https://drive.google.com/file/d/${id}/preview"
                    allow="fullscreen" allowfullscreen title="${h(alt)}"></iframe>`;
  }
  return `<video class="${cls}" data-media="${h(url)}" controls playsinline></video>`;
}

/** 시트가 연결돼 있으면 가이드 사진도 드라이브에 올릴 수 있다. */
async function guideMediaEnabled() {
  const store = await import('../local/store.js');
  return store.sheetInventoryOn();
}

/**
 * 가이드 단계 사진·영상 하나를 드라이브에 올린다.
 *   <공유 드라이브>/가이드/<분류>/<제목>/사진|동영상/
 * 반환: 드라이브 주소 (영상이면 끝에 #video)
 */
async function uploadGuidePhoto(fileOrBlob, categoryType, title) {
  const { callAppsScript } = await import('../sheets.js');
  const data = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error('파일을 읽지 못했습니다.'));
    reader.readAsDataURL(fileOrBlob);
  });
  const result = await callAppsScript({
    guides: 'media',
    categoryType,
    title,
    files: [{
      filename: fileOrBlob.name || (isVideoFile(fileOrBlob) ? '단계영상.mp4' : '단계사진.jpg'),
      mimeType: fileOrBlob.type || (isVideoFile(fileOrBlob) ? 'video/mp4' : 'image/jpeg'),
      data,
    }],
  }, 180000);
  const url = (result.links || [])[0];
  if (!url) {
    const why = (result.skipped || [])[0];
    throw new Error(result.error || (why && why.reason) || '드라이브가 주소를 주지 않았습니다.');
  }
  // 드라이브 주소에는 확장자가 없다 — 영상이라는 표시를 남겨야 재생기로 연다.
  return isVideoFile(fileOrBlob) ? url + VIDEO_MARK : url;
}

const isVideoFile = (file) => String((file && file.type) || '').startsWith('video/');

// ---------------------------------------------------------------- 공통
//
// 가이드는 **로봇 → 종류 → 목록 → 상세** 차례로 찾아 들어간다.
// 같은 오류 코드라도 로봇(Gen.1 · Gen.2 · Zephyr …)마다 절차가 달라서다.
// 로봇이 정해지지 않은 예전 가이드는 '로봇 미지정' 에 모인다 (사라지지 않는다).
const NONE = '_none';
const NONE_LABEL = '로봇 미지정';
const CAT_SHORT = { ERROR_CODE: '오류 코드', HARDWARE_SOP: '하드웨어 교체', SOFTWARE_CMD: 'SW · 명령어' };
const CAT_ORDER = ['ERROR_CODE', 'HARDWARE_SOP', 'SOFTWARE_CMD'];
const LAST_CAT_KEY = 'bh_guide_cat';
const CAT_TINY = { ERROR_CODE: '오류', HARDWARE_SOP: '하드웨어', SOFTWARE_CMD: 'SW' };
const CAT_ICON = {
  ERROR_CODE: 'M12 8v5M12 16.5v.01M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18',
  HARDWARE_SOP: 'M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-.5-.5-2.5z',
  SOFTWARE_CMD: 'M4 6h16v12H4zM7 10l3 2-3 2M12 15h5',
};
const catIcon = (t) => `<svg class="cat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${CAT_ICON[t]}"/></svg>`;

/**
 * 로봇마다 색 — 목록에 놓인 차례로 정해진다 (같은 로봇은 어디서나 같은 색).
 * 목록에 없는 이름은 회색.
 */
const ROBOT_COLORS = ['#1e3d75', '#0e6e78', '#7a4a12', '#4a3a8c', '#2f5d2a', '#7a2e4a'];
export function robotColor(name, models) {
  const i = (models || []).indexOf(name);
  return i < 0 ? '#5a6270' : ROBOT_COLORS[i % ROBOT_COLORS.length];
}

const modelKey = (g) => (g.robotModel || '').trim() || NONE;
const modelLabel = (key) => (key === NONE ? NONE_LABEL : key);
export const modelHref = (key, cat = null) =>
  `#/guides/m/${encodeURIComponent(key || NONE)}${cat ? `/${cat}` : ''}`;

/** 오류 코드는 코드(E-101)와 제목을 나눠 보여 준다. 나머지는 제목만. */
function splitTitle(guide) {
  if (guide.categoryType !== 'ERROR_CODE') return { code: '', title: guide.codeOrTitle };
  const [first, ...rest] = guide.codeOrTitle.split(' ');
  return { code: first, title: rest.join(' ') || guide.codeOrTitle };
}

/** 로봇 이름 바꾸기 · 삭제 — 가이드 탭과 로봇 화면이 같은 창을 쓴다. */
async function openModelMenu(name, { onDone } = {}) {
  const all = (await api.listGuides()).items;
  const count = all.filter((g) => modelKey(g) === name).length;
  const body = openSheet(`${name} 관리`, `
    <div class="sheet-actions">
      <button class="btn btn-secondary" data-mact="rename" type="button">이름 바꾸기</button>
      <button class="btn btn--danger" data-mact="delete" type="button">로봇 삭제</button>
    </div>
    <p class="hint">가이드 ${count}건이 이 로봇에 있습니다. 삭제해도 가이드는 지우지 않고 '${NONE_LABEL}' 으로 옮깁니다.</p>`);
  body.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-mact]');
    if (!btn) return;
    if (btn.dataset.mact === 'rename') {
      const next = await promptDialog('로봇 이름 바꾸기', {
        label: `이 로봇의 가이드 ${count}건도 함께 옮겨집니다.`, value: name, okLabel: '바꾸기',
      });
      if (!next || next === name) return;
      try {
        await api.renameGuideModel(name, next);
        toast(`'${next}' 로 바꿨습니다.`, 'ok');
        if (onDone) onDone(next);
      } catch (err) { toast(err.message, 'err'); }
    }
    if (btn.dataset.mact === 'delete') {
      closeModal();
      const ok = await confirmDialog('로봇 삭제',
        `'${name}' 을 목록에서 지웁니다.\n가이드 ${count}건은 지우지 않고 '${NONE_LABEL}' 으로 옮깁니다.`,
        '삭제', true);
      if (!ok) return;
      try {
        await api.deleteGuideModel(name);
        toast(`'${name}' 을 지웠습니다.`, 'ok');
        if (onDone) onDone(null);
      } catch (err) { toast(err.message, 'err'); }
    }
  });
}

async function addModelFlow() {
  const name = await promptDialog('로봇 추가', {
    label: '가이드를 묶을 로봇 이름 — 팀 전체에 같이 보입니다.',
    placeholder: '예) Gen.3', okLabel: '추가',
  });
  if (!name) return null;
  try {
    await api.addGuideModel(name);
    toast(`'${name}' 을 추가했습니다.`, 'ok');
    return name;
  } catch (err) { toast(err.message, 'err'); return null; }
}

// ---------------------------------------------------------------- 목록 (종류 전체)
export async function guideListView(view, categoryType) {
  const meta = CATEGORY[categoryType];
  loading(view);
  // 가이드는 전부 기기에 있으므로 오프라인에서도 그대로 열린다.
  const items = (await api.listGuides(categoryType)).items;

  view.innerHTML = `
    <div class="page-head">
      <a class="crumb" href="#/guides">가이드</a>
      <h1 class="page-head__title">${h(meta.label)}</h1>
      <span class="page-head__meta"><span class="tnum">${items.length}</span>건 · 모든 로봇</span>
      <span class="page-head__spacer"></span>
      <a class="btn btn-primary" href="#/guides/new/${categoryType}">＋ 가이드 작성</a>
    </div>
    <div class="toolbar">
      <input class="input" id="filterInput" type="search"
             placeholder="코드 · 증상 검색" autocomplete="off" />
    </div>
    <div class="rows" id="guideList">
      ${items.length ? items.map((g) => row(g, true)).join('')
        : '<div class="empty">등록된 가이드가 없습니다. [＋ 가이드 작성]으로 추가하세요.</div>'}
    </div>`;

  $('#filterInput').addEventListener('input', (ev) => {
    const q = ev.target.value.trim().toLowerCase();
    const filtered = items.filter((g) =>
      `${g.codeOrTitle} ${g.summary} ${g.requiredTools} ${g.robotModel}`.toLowerCase().includes(q));
    $('#guideList').innerHTML = filtered.length
      ? filtered.map((g) => row(g, true)).join('')
      : '<div class="empty">필터 결과가 없습니다.</div>';
  });
}

// ---------------------------------------------------------------- 가이드 탭 — 로봇 띠 (D2)
//
// 로봇마다 가로 띠 하나. 왼쪽은 로봇 색 블록(이름 · 건수), 오른쪽은 종류 셋이
// 타일로 바로 놓여 있어 **한 번 눌러 그 종류 목록으로** 간다 (로봇 → 종류 두 번이 아니라).
// 맨 아래 '로봇 미지정' 띠에서 한 번에 지정하기로 넘어간다.
export async function guideHubView(view) {
  loading(view);
  const all = (await api.listGuides()).items;
  const models = await api.listGuideModels();
  const keys = [...models];
  // 목록에 없는 로봇 이름이 붙은 가이드(시트에서 손으로 적은 것 등)도 잃지 않는다.
  for (const g of all) {
    const k = modelKey(g);
    if (k !== NONE && !keys.includes(k)) keys.push(k);
  }
  const unassigned = all.filter((g) => modelKey(g) === NONE).length;

  const band = (key) => {
    const list = all.filter((g) => modelKey(g) === key);
    const last = list.reduce((m, g) => (g.updatedAt > m ? g.updatedAt : m), '');
    return `
      <section class="rband" style="--robot:${robotColor(key, models)}">
        <div class="rband__id">
          <a class="rband__main" href="${modelHref(key)}">
            <span class="rband__kicker">로봇</span>
            <span class="rband__name">${h(key)}</span>
            <span class="rband__meta">가이드 <span class="tnum">${list.length}</span>건${last ? ` · ${h(when(last, { time: false }))} 수정` : ''}</span>
          </a>
          ${models.includes(key) ? `
            <button class="rband__more" data-act="model-menu" data-name="${h(key)}" type="button"
                    aria-label="${h(key)} 이름 바꾸기 · 삭제">⋯</button>` : ''}
        </div>
        <div class="rband__cats">
          ${CAT_ORDER.map((t) => `
            <a class="rcat" data-cat="${t}" href="${modelHref(key, t)}">
              <span class="rcat__name">${catIcon(t)}${h(CAT_SHORT[t])}</span>
              <span class="rcat__foot"><b class="rcat__n tnum">${list.filter((g) => g.categoryType === t).length}</b><span>보기 ›</span></span>
            </a>`).join('')}
        </div>
      </section>`;
  };

  view.innerHTML = `
    <div id="pageRoot" class="page-stack">
      <div class="page-head">
        <h1 class="page-head__title">가이드</h1>
        <form class="page-search" id="guideSearch" role="search">
          <input class="input" id="guideSearchQ" type="search" autocomplete="off" enterkeyhint="search"
                 aria-label="가이드 검색" placeholder="오류 코드 · 증상 · 부품 검색" />
        </form>
        <span class="page-head__spacer"></span>
        <button class="btn btn-secondary" data-act="add-model" type="button">＋ 로봇</button>
        <a class="btn btn-primary" href="#/guides/new">＋ 가이드 작성</a>
      </div>
      <div class="rbands">
        ${keys.map(band).join('')}
        ${unassigned ? `
          <section class="rband rband--none">
            <span class="rband__q" aria-hidden="true">?</span>
            <span class="rband__text">
              <b>로봇 미지정 <span class="tnum">${unassigned}</span>건</b>
              <span>예전에 만든 가이드 — 골라서 한 번에 로봇을 정하세요</span>
            </span>
            <a class="btn btn-secondary" href="${modelHref(null)}">목록 보기</a>
            <a class="btn btn-dark" href="#/guides/assign">한 번에 지정하기</a>
          </section>` : ''}
      </div>
    </div>`;

  $('#guideSearch').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const q = $('#guideSearchQ').value.trim();
    if (!q) { toast('검색어를 입력하세요.'); return; }
    location.hash = `#/search?q=${encodeURIComponent(q)}`;
  });
  $('#pageRoot').addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-act]');
    if (!btn) return;
    if (btn.dataset.act === 'add-model') {
      if (await addModelFlow()) guideHubView(view);
    }
    if (btn.dataset.act === 'model-menu') {
      openModelMenu(btn.dataset.name, { onDone: () => { closeModal(); guideHubView(view); } });
    }
  });
}

// ---------------------------------------------------------------- 로봇 한 번에 지정
//
// 로봇 분류가 생기기 전에 만든 가이드는 전부 '로봇 미지정' 이다. 하나씩 [수정] 에
// 들어가 고르기에는 많아서, 여러 개를 골라 로봇 버튼 하나로 옮긴다.
// 기본은 미지정만 보이고, [전체] 로 바꾸면 이미 정한 것도 다시 옮길 수 있다.
export async function guideAssignView(view) {
  loading(view);
  const models = await api.listGuideModels();
  let all = (await api.listGuides()).items;
  let scope = all.some((g) => modelKey(g) === NONE) ? 'none' : 'all';
  const picked = new Set();

  const list = () => (scope === 'none' ? all.filter((g) => modelKey(g) === NONE) : all);

  function rowsHtml() {
    const rows = list();
    if (!rows.length) {
      return '<div class="empty">로봇이 정해지지 않은 가이드가 없습니다. 모두 정리됐습니다.</div>';
    }
    return rows.map((g) => {
      const { code, title } = splitTitle(g);
      const on = picked.has(g.id);
      return `
        <label class="pick-row${on ? ' is-on' : ''}">
          <input type="checkbox" class="pick-row__box" data-id="${g.id}" ${on ? 'checked' : ''} />
          <span class="pick-row__code tnum">${h(code || CAT_TINY[g.categoryType])}</span>
          <span class="pick-row__title">${h(title)}</span>
          <span class="pick-row__meta">${h(CAT_SHORT[g.categoryType])} · ${h(modelLabel(modelKey(g)))}</span>
        </label>`;
    }).join('');
  }

  function barHtml() {
    const n = picked.size;
    return `
      <span class="assign-bar__count"><b class="tnum">${n}</b>개 선택${n ? ' →' : ''}</span>
      <span class="assign-bar__hint">${n ? '어느 로봇으로 옮길까요?' : '위에서 가이드를 고르세요'}</span>
      <span class="spacer"></span>
      ${models.map((m, i) => `
        <button class="assign-bar__robot" data-act="assign" data-model="${h(m)}" type="button"
                style="--robot:${robotColor(m, models)}" ${n ? '' : 'disabled'}>${h(m)}</button>`).join('')}
      ${scope === 'all' ? `<button class="assign-bar__robot assign-bar__robot--none" data-act="assign" data-model=""
                type="button" ${n ? '' : 'disabled'}>미지정으로</button>` : ''}`;
  }

  function paint() {
    $('#assignRows').innerHTML = rowsHtml();
    $('#assignBar').innerHTML = barHtml();
    const none = all.filter((g) => modelKey(g) === NONE).length;
    view.querySelectorAll('[data-scope]').forEach((b) => {
      const on = b.dataset.scope === scope;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', String(on));
      b.querySelector('.tnum').textContent = b.dataset.scope === 'none' ? none : all.length;
    });
  }

  view.innerHTML = `
    <div id="pageRoot" class="page-stack">
      <div class="page-head">
        <a class="crumb" href="#/guides">가이드</a>
        <h1 class="page-head__title">로봇 한 번에 지정</h1>
        <span class="page-head__spacer"></span>
        <button class="inv-chip" data-scope="none" type="button">로봇 미지정 <span class="tnum">0</span></button>
        <button class="inv-chip" data-scope="all" type="button">전체 <span class="tnum">0</span></button>
        <button class="btn btn-secondary" data-act="select-all" type="button">모두 선택</button>
      </div>
      <section class="assign-list scroll" id="assignRows"></section>
      <div class="assign-bar" id="assignBar"></div>
    </div>`;
  paint();

  const root = $('#pageRoot');
  root.addEventListener('change', (ev) => {
    const box = ev.target.closest('.pick-row__box');
    if (!box) return;
    if (box.checked) picked.add(box.dataset.id); else picked.delete(box.dataset.id);
    box.closest('.pick-row').classList.toggle('is-on', box.checked);
    $('#assignBar').innerHTML = barHtml();
  });
  root.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-scope], [data-act]');
    if (!btn) return;
    if (btn.dataset.scope) { scope = btn.dataset.scope; picked.clear(); paint(); return; }
    if (btn.dataset.act === 'select-all') {
      const ids = list().map((g) => g.id);
      const every = ids.length && ids.every((id) => picked.has(id));
      ids.forEach((id) => (every ? picked.delete(id) : picked.add(id)));
      paint();
      return;
    }
    if (btn.dataset.act === 'assign') {
      const model = btn.dataset.model;
      const ids = [...picked];
      if (!ids.length) return;
      btn.disabled = true;
      try {
        const { moved } = await api.assignGuideModel(ids, model);
        toast(`가이드 ${moved}건을 '${model || NONE_LABEL}' 로 옮겼습니다.`, 'ok');
        all = (await api.listGuides()).items;
        picked.clear();
        if (scope === 'none' && !all.some((g) => modelKey(g) === NONE)) {
          location.hash = '#/guides';
          return;
        }
        paint();
      } catch (err) {
        toast(err.message, 'err');
        btn.disabled = false;
      }
    }
  });
}

// ---------------------------------------------------------------- 로봇 하나 — 종류 셋 + 목록
export async function guideModelView(view, key, categoryType) {
  loading(view);
  const all = (await api.listGuides()).items;
  const models = await api.listGuideModels();
  const mine = all.filter((g) => modelKey(g) === key);
  if (key !== NONE && !models.includes(key) && !mine.length) {
    view.innerHTML = `<div class="empty">'${h(key)}' 로봇을 찾을 수 없습니다.<br />
      <a class="link" href="#/guides">가이드로 돌아가기</a></div>`;
    return;
  }
  let type = categoryType || localStorage.getItem(LAST_CAT_KEY);
  if (!CAT_ORDER.includes(type)) type = CAT_ORDER[0];
  try { localStorage.setItem(LAST_CAT_KEY, type); } catch { /* 비공개 창 */ }
  let query = '';

  const ofType = (t) => mine.filter((g) => g.categoryType === t);
  const visible = () => {
    const q = query.trim().toLowerCase();
    return ofType(type).filter((g) => !q
      || `${g.codeOrTitle} ${g.summary} ${g.requiredTools}`.toLowerCase().includes(q));
  };
  const listHtml = () => {
    const list = visible();
    if (list.length) return list.map((g) => row(g, false)).join('');
    return `<div class="empty">${query.trim()
      ? `'${h(query.trim())}' 에 맞는 가이드가 없습니다.`
      : `${h(modelLabel(key))} · ${h(CAT_SHORT[type])} 가이드가 아직 없습니다.<br />[＋ 가이드 작성] 으로 추가하세요.`}</div>`;
  };
  const newHref = `#/guides/new/${type}${key === NONE ? '' : `?model=${encodeURIComponent(key)}`}`;

  view.innerHTML = `
    <div id="pageRoot" class="page-stack">
      <div class="page-head">
        <a class="crumb" href="#/guides">가이드</a>
        <h1 class="page-head__title">${h(modelLabel(key))}</h1>
        <span class="page-head__meta"><span class="tnum">${mine.length}</span>건</span>
        <span class="page-head__spacer"></span>
        ${models.includes(key) ? '<button class="btn btn-secondary" data-act="model-menu" type="button">로봇 관리</button>' : ''}
        <a class="btn btn-primary" href="${newHref}">＋ 가이드 작성</a>
      </div>
      <div class="guide-browse">
        <nav class="guide-cats" aria-label="가이드 종류">
          ${CAT_ORDER.map((t) => `
            <a class="guide-cat${t === type ? ' is-on' : ''}" data-cat="${t}" href="${modelHref(key, t)}"
               ${t === type ? 'aria-current="page"' : ''}>
              <span class="guide-cat__name">${catIcon(t)}${h(CAT_SHORT[t])}</span>
              <span class="guide-cat__count tnum">${ofType(t).length}</span>
            </a>`).join('')}
        </nav>
        <section class="guide-list">
          <input class="input" id="gq" type="search" autocomplete="off"
                 aria-label="${h(CAT_SHORT[type])} 검색"
                 placeholder="${h(modelLabel(key))} · ${h(CAT_SHORT[type])}에서 찾기" />
          <div class="rows scroll" id="gList">${listHtml()}</div>
        </section>
      </div>
    </div>`;

  const box = $('#gq');
  const paint = () => { $('#gList').innerHTML = listHtml(); };
  box.addEventListener('input', () => { query = box.value; paint(); });
  box.addEventListener('compositionend', () => { query = box.value; paint(); });
  $('#pageRoot').addEventListener('click', (ev) => {
    if (!ev.target.closest('[data-act="model-menu"]')) return;
    openModelMenu(key, {
      onDone: (next) => {
        closeModal();
        location.hash = next ? modelHref(next, type) : '#/guides';
      },
    });
  });
}

/**
 * 가이드 한 줄 — 코드 · 제목 · 요약 · (단계 수 · 공구 · 명령어 · 수정일).
 * withModel 이면 로봇·종류도 적는다 (검색처럼 여러 로봇이 섞일 때).
 */
export function row(guide, withModel = false) {
  const tools = (guide.requiredTools || '').split(',').map((t) => t.trim()).filter(Boolean);
  const bits = [
    withModel ? modelLabel(modelKey(guide)) : '',
    withModel ? CAT_SHORT[guide.categoryType] : '',
    `${guide.stepCount || 0}단계`,
    tools.length ? `공구 ${tools.length}` : '',
    (guide.commands && guide.commands.length) ? `명령어 ${guide.commands.length}` : '',
    guide.updatedAt ? when(guide.updatedAt, { time: false }) : '',
  ].filter(Boolean);
  const { code, title } = splitTitle(guide);
  return `
    <a class="row guide-row" href="#/guides/${guide.id}">
      ${code ? `<span class="row__code tnum">${h(code)}</span>` : ''}
      <span class="row__main">
        <span class="row__title">${h(title)}</span>
        ${guide.summary ? `<span class="row__meta">${h(guide.summary)}</span>` : ''}
        <span class="row__meta">${h(bits.join(' · '))}</span>
      </span>
      <span class="item__chevron" aria-hidden="true">›</span>
    </a>`;
}

// ---------------------------------------------------------------- 상세 — 한눈에
//
// 단계 전체 · 진행률 · 준비 공구 · 명령어를 한 화면에 둔다. 단계는 줄 전체가
// 버튼이라(장갑) 누르면 완료 체크되고, 위 막대가 바로 따라 찬다.
export async function guideDetailView(view, guideId) {
  loading(view);
  const guide = await api.getGuide(guideId);
  if (!guide) throw new Error('가이드를 찾을 수 없습니다.');
  const tools = (guide.requiredTools || '').split(',').map((t) => t.trim()).filter(Boolean);
  const key = modelKey(guide);
  const { code, title } = splitTitle(guide);
  let done = new Set();
  try {
    done = new Set(JSON.parse(localStorage.getItem(DONE_KEY(guideId)) || '[]'));
  } catch { /* 무시 */ }
  const total = guide.steps.length;

  view.innerHTML = `
    <div id="pageRoot" class="gd">
      <header class="gd-head">
        <nav class="gd-crumb" aria-label="위치">
          <a href="#/guides">가이드</a><span aria-hidden="true">›</span>
          <a href="${modelHref(key)}">${h(modelLabel(key))}</a><span aria-hidden="true">›</span>
          <a href="${modelHref(key, guide.categoryType)}">${h(CAT_SHORT[guide.categoryType] || '')}</a>
        </nav>
        <div class="gd-title">
          ${code ? `<span class="gd-code tnum">${h(code)}</span>` : ''}
          <h1 class="page-head__title">${h(title)}</h1>
        </div>
        ${guide.summary ? `<p class="gd-summary">${h(guide.summary)}</p>` : ''}
        <div class="gd-actions">
          <a class="btn btn-secondary" href="#/guides/edit/${guide.id}">수정</a>
          <button class="btn btn--danger" data-act="delete" type="button">삭제</button>
          <span class="spacer"></span>
          <a class="btn btn-primary" href="#/report/new">이 작업으로 리포트 쓰기</a>
        </div>
      </header>

      <div class="gd-body">
        <section class="gd-main" aria-label="단계">
          ${total ? `
            <div class="gd-progress">
              <span class="gd-progress__text"><b class="tnum" id="gdDone">${done.size}</b> / <span class="tnum">${total}</span> 단계 완료</span>
              <span class="gd-progress__bar"><i id="gdBar" style="width:${Math.round(done.size / total * 100)}%"></i></span>
              <button class="btn btn-secondary btn--sm" data-act="reset-check" type="button">처음부터</button>
            </div>
            <div class="steps gd-steps">${guide.steps.map((s, i) => stepHtml(s, i, done)).join('')}</div>`
          : '<div class="empty">등록된 단계가 없습니다. [수정]에서 단계를 추가하세요.</div>'}
        </section>

        <aside class="gd-side">
          <section class="gd-box">
            <h2 class="gd-box__title">준비 공구 · 부품</h2>
            ${tools.length ? `<div class="tag-list">${tools.map((t) => `<span class="chip">${h(t)}</span>`).join('')}</div>`
              : '<p class="hint">적힌 공구가 없습니다.</p>'}
          </section>
          ${guide.commands.length ? `
            <section class="gd-box">
              <h2 class="gd-box__title">명령어 — 누르면 복사</h2>
              ${guide.commands.map((c, i) => `
                <div class="cmd">
                  ${c.label ? `<div class="cmd__label">${h(c.label)}</div>` : ''}
                  <div class="cmd__row">
                    <pre class="cmd__code" id="cmd-${i}">${h(c.cmd)}</pre>
                    <button class="btn btn--primary" data-act="copy" data-target="cmd-${i}" type="button">복사</button>
                  </div>
                  ${c.desc ? `<p class="cmd__desc">${h(c.desc)}</p>` : ''}
                </div>`).join('')}
              ${guide.commands.length > 1 ? '<button class="btn btn-secondary btn--sm" data-act="copy-all" type="button">전체 복사</button>' : ''}
            </section>` : ''}
          <p class="gd-meta">${h(when(guide.updatedAt))} 수정</p>
        </aside>
      </div>
    </div>`;

  // 단계 사진은 기기 안에 있다 — 그린 뒤에 채워 넣는다.
  hydrateMedia(view);

  const paintProgress = () => {
    const n = $('#gdDone');
    const bar = $('#gdBar');
    if (n) n.textContent = done.size;
    if (bar) bar.style.width = `${total ? Math.round(done.size / total * 100) : 0}%`;
  };

  $('#pageRoot').addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;

    if (act === 'copy' || act === 'copy-all') {
      const text = act === 'copy'
        ? $('#' + btn.dataset.target).textContent
        : guide.commands.map((c) => c.cmd).join('\n');
      const ok = await copyText(text);
      toast(ok ? '클립보드에 복사했습니다.' : '복사에 실패했습니다. 길게 눌러 직접 복사하세요.',
        ok ? 'ok' : 'err');
    }
    if (act === 'toggle-step') {
      // 사진을 눌렀으면 단계 완료 체크가 아니라 사진을 크게 본다.
      // 영상(재생기·video)은 눌러도 크게 하지 않는다 — 그 누름은 재생 버튼이다.
      if (ev.target.classList.contains('step__img')) {
        if (ev.target.tagName === 'IMG') ev.target.classList.toggle('is-zoomed');
        return;
      }
      const el = btn.closest('.step');
      const idx = el.dataset.idx;
      if (done.has(idx)) { done.delete(idx); } else { done.add(idx); }
      el.classList.toggle('is-done', done.has(idx));
      el.setAttribute('aria-pressed', String(done.has(idx)));
      localStorage.setItem(DONE_KEY(guideId), JSON.stringify([...done]));
      paintProgress();
    }
    if (act === 'reset-check') {
      done.clear();
      localStorage.removeItem(DONE_KEY(guideId));
      $$('.step').forEach((el) => {
        el.classList.remove('is-done');
        el.setAttribute('aria-pressed', 'false');
      });
      paintProgress();
      toast('체크를 초기화했습니다.');
    }
    if (act === 'delete') {
      const ok = await confirmDialog('가이드 삭제',
        `"${guide.codeOrTitle}" 가이드와 모든 단계를 삭제합니다. 되돌릴 수 없습니다.`,
        '삭제', true);
      if (!ok) return;
      await api.deleteGuide(guide.id);
      toast('삭제했습니다.', 'ok');
      location.hash = modelHref(key, guide.categoryType);
    }
  });
}

function stepHtml(step, idx, done) {
  const isDone = done.has(String(idx));
  // 줄 전체가 버튼이다 — 장갑 낀 손으로 작은 체크 칸만 겨냥하기 어렵다.
  return `
    <button class="step ${isDone ? 'is-done' : ''}" data-idx="${idx}"
            data-act="toggle-step" type="button" aria-pressed="${isDone}">
      <span class="step__no">${step.stepOrder || idx + 1}</span>
      <span class="step__body">
        <span class="step__text">${h(step.instruction).replace(/\n/g, '<br />')}</span>
        ${step.expectedMetric ? `
          <span class="step__meta tag-list">
            ${step.expectedMetric.split(',').map((t) => t.trim()).filter(Boolean)
              .map((t) => `<span class="tag tag-accent">${h(t)}</span>`).join('')}
          </span>` : ''}
        ${stepMediaHtml(step.imageUrl, 'step__img', `단계 ${idx + 1} 참고 자료`)}
      </span>
      <span class="step__check" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
             stroke-linecap="round" stroke-linejoin="round">
          <path d="M4.5 12.5 9.5 17.5 19.5 7" />
        </svg>
      </span>
    </button>`;
}

// ---------------------------------------------------------------- 편집
export async function guideEditView(view, guideId, categoryType, presetModel = null) {
  const models = await api.listGuideModels();
  let state;
  if (guideId) {
    loading(view);
    const guide = await api.getGuide(guideId);
    state = {
      id: guide.id,
      categoryType: guide.categoryType,
      robotModel: guide.robotModel || '',
      codeOrTitle: guide.codeOrTitle,
      summary: guide.summary,
      requiredTools: guide.requiredTools,
      commands: guide.commands.length ? guide.commands : [],
      steps: guide.steps.map((s) => ({
        instruction: s.instruction,
        expectedMetric: s.expectedMetric || '',
        imageUrl: s.imageUrl || '',
      })),
    };
  } else {
    state = {
      id: null,
      categoryType: categoryType || 'ERROR_CODE',
      robotModel: presetModel || '',
      codeOrTitle: '',
      summary: '',
      requiredTools: '',
      commands: [],
      steps: [{ instruction: '', expectedMetric: '', imageUrl: '' }],
    };
  }

  /** 쉼표로 적은 공구 목록을 배열로. 빈 항목·중복은 버린다. */
  function splitTools(text) {
    const out = [];
    for (const raw of String(text || '').split(',')) {
      const t = raw.trim();
      if (t && !out.includes(t)) out.push(t);
    }
    return out;
  }

  /**
   * 단계마다 고를 수 있는 공구 칩.
   *
   * 고르는 값은 위 [준비 공구 · 부품] 에 적은 것에서만 나온다. 예전에는 이 자리가
   * '기준 수치' 자유 입력이었는데, 현장에서 그 단계에 무엇을 들고 가야 하는지가
   * 더 자주 필요했다. 저장은 예전 칸(expectedMetric)에 쉼표로 이어 담는다 —
   * 시트 열을 새로 만들지 않아도 되고, 예전 기록도 그대로 읽힌다.
   */
  function toolChips(step, idx) {
    const options = splitTools(state.requiredTools);
    if (!options.length) {
      return '<span class="hint">위 [준비 공구 · 부품] 에 먼저 적으면 여기서 고를 수 있습니다.</span>';
    }
    const chosen = splitTools(step.expectedMetric);
    return options.map((tool) => `
      <button type="button" class="filter-toggle${chosen.includes(tool) ? ' is-on' : ''}"
              data-act="toggle-tool" data-idx="${idx}" data-tool="${h(tool)}"
              aria-pressed="${chosen.includes(tool)}">${h(tool)}</button>`).join('');
  }

  /** 준비 공구에서 빠진 것은 단계 선택에서도 뺀다. */
  function pruneStepTools() {
    const options = splitTools(state.requiredTools);
    for (const step of state.steps) {
      const kept = splitTools(step.expectedMetric).filter((t) => options.includes(t));
      step.expectedMetric = kept.join(', ');
    }
  }

  /** 단계마다의 칩 영역만 다시 그린다. 숨은 칸도 함께 맞춘다. */
  function paintToolChips() {
    state.steps.forEach((step, i) => {
      const box = document.querySelector(`[data-tool-pick="${i}"]`);
      if (box) box.innerHTML = toolChips(step, i);
      const row = document.querySelector(`[data-step-row][data-idx="${i}"]`);
      const hidden = row && row.querySelector('[name=stepMetric]');
      if (hidden) hidden.value = step.expectedMetric || '';
    });
  }

  function collect() {
    const form = $('#guideForm');
    if (!form) return;
    state.categoryType = $('#gCategory').value;
    state.robotModel = $('#gModel').value;
    state.codeOrTitle = $('#gTitle').value;
    // 요약 칸은 없앴다. 예전 가이드가 갖고 있던 요약은 그대로 두고 저장한다
    // (시트의 '요약' 열도 그대로다 — 지우면 옛 기록이 사라진다).
    state.requiredTools = $('#gTools').value;
    state.commands = $$('[data-cmd-row]').map((rowEl) => ({
      label: $('[name=cmdLabel]', rowEl).value,
      cmd: $('[name=cmdText]', rowEl).value,
      desc: $('[name=cmdDesc]', rowEl).value,
    }));
    state.steps = $$('[data-step-row]').map((rowEl) => ({
      instruction: $('[name=stepText]', rowEl).value,
      expectedMetric: $('[name=stepMetric]', rowEl).value,
      imageUrl: $('[name=stepImage]', rowEl).value,
    }));
  }

  function render() {
    view.innerHTML = `
      <div class="page-head">
        <h1 class="page-head__title">${guideId ? '가이드 수정' : '새 가이드 작성'}</h1>
      </div>
      <form id="guideForm" autocomplete="off">
        <div class="panel">
          <div class="field">
            <label>로봇</label>
            <input type="hidden" id="gModel" value="${h(state.robotModel)}" />
            <div class="type-pick" data-pick="model">
              ${[...models, ...(state.robotModel && !models.includes(state.robotModel) ? [state.robotModel] : []), '']
                .map((m) => `
                <button class="btn btn-secondary${state.robotModel === m ? ' is-on' : ''}"
                        data-act="pick-model" data-model="${h(m)}" type="button"
                        aria-pressed="${state.robotModel === m}">${h(m || NONE_LABEL)}</button>`).join('')}
            </div>
          </div>
          <div class="field">
            <label>종류<span class="req">*</span></label>
            <!-- 홈의 [＋ 가이드 작성] 으로 바로 들어오면 여기서 고른다.
                 작은 선택칸 대신 손가락 크기의 버튼 셋 — 첫 칸에서 헤매지 않게. -->
            <input type="hidden" id="gCategory" value="${h(state.categoryType)}" />
            <div class="type-pick" data-pick="type">
              ${Object.entries(CATEGORY).map(([type, meta]) => `
                <button class="btn btn-secondary${state.categoryType === type ? ' is-on' : ''}"
                        data-act="pick-type" data-type="${type}" type="button"
                        aria-pressed="${state.categoryType === type}">${h(meta.label)}</button>`).join('')}
            </div>
          </div>
          <div class="field">
            <label>오류 코드 / 제목<span class="req">*</span></label>
            <input class="input" id="gTitle" value="${h(state.codeOrTitle)}"
                   placeholder="예) E-101 로더 모터 과전류" />
          </div>
          <div class="field">
            <label>준비 공구 · 부품</label>
            <input class="input" id="gTools" value="${h(state.requiredTools)}"
                   placeholder="쉼표로 구분 · 예) 멀티미터, 육각 렌치 3mm" />
          </div>
        </div>

        <div class="panel">
          <div class="row row--between" style="margin-bottom:12px">
            <h2 class="panel__title" style="margin:0">명령어 (${state.commands.length})</h2>
            <button class="btn btn--ghost btn--sm" data-act="add-cmd" type="button">＋ 명령어 추가</button>
          </div>
          <div class="stack">
            ${state.commands.map((c, i) => `
              <div class="sub-card" data-cmd-row data-idx="${i}">
                <div class="row row--between" style="margin-bottom:8px">
                  <strong>#${i + 1}</strong>
                  <button class="btn btn--danger btn--sm" data-act="del-cmd" data-idx="${i}" type="button">삭제</button>
                </div>
                <div class="field"><label>설명 라벨</label>
                  <input class="input" name="cmdLabel" value="${h(c.label || '')}" placeholder="예) 현재 버전 확인" /></div>
                <div class="field"><label>명령어</label>
                  <input class="input mono" name="cmdText" value="${h(c.cmd || '')}" placeholder="bhctl version" /></div>
                <div class="field" style="margin-bottom:0"><label>주의사항</label>
                  <input class="input" name="cmdDesc" value="${h(c.desc || '')}" placeholder="예) 진행 중 전원 차단 금지" /></div>
              </div>`).join('') || '<div class="empty">등록된 명령어가 없습니다.</div>'}
          </div>
        </div>

        <div class="panel">
          <div class="row row--between" style="margin-bottom:12px">
            <h2 class="panel__title" style="margin:0">단계 (${state.steps.length})</h2>
            <button class="btn btn--ghost btn--sm" data-act="add-step" type="button">＋ 단계 추가</button>
          </div>
          <div class="stack">
            ${state.steps.map((s, i) => `
              <div class="sub-card" data-step-row data-idx="${i}">
                <div class="row row--between" style="margin-bottom:8px">
                  <strong>STEP ${i + 1}</strong>
                  <div class="row" style="gap:6px">
                    <button class="btn btn--ghost btn--sm" data-act="up" data-idx="${i}" type="button" ${i === 0 ? 'disabled' : ''} aria-label="위로">↑</button>
                    <button class="btn btn--ghost btn--sm" data-act="down" data-idx="${i}" type="button" ${i === state.steps.length - 1 ? 'disabled' : ''} aria-label="아래로">↓</button>
                    <button class="btn btn--danger btn--sm" data-act="del-step" data-idx="${i}" type="button">삭제</button>
                  </div>
                </div>
                <div class="field"><label>작업 내용<span class="req">*</span></label>
                  <textarea class="textarea" name="stepText" placeholder="예) 모터 커넥터 CN3 양단 전압을 측정한다.">${h(s.instruction)}</textarea></div>
                <div class="field">
                  <label>필요 공구 · 부품</label>
                  <input type="hidden" name="stepMetric" value="${h(s.expectedMetric)}" />
                  <div class="tag-list" data-tool-pick="${i}">${toolChips(s, i)}</div>
                </div>
                <div class="field" style="margin-bottom:0">
                  <label>참고 사진 · 영상</label>
                  <input type="hidden" name="stepImage" value="${h(s.imageUrl)}" />
                  ${stepMediaHtml(s.imageUrl, 'step__img step__img--edit', '참고 자료')}
                  <div class="row" style="margin-top:8px">
                    <button class="btn btn--ghost btn--sm" data-act="step-capture" data-idx="${i}" type="button">사진 촬영</button>
                    <button class="btn btn--ghost btn--sm" data-act="step-record" data-idx="${i}" type="button">영상 촬영</button>
                    <button class="btn btn--ghost btn--sm" data-act="step-pick" data-idx="${i}" type="button">앨범 · 파일</button>
                    ${s.imageUrl ? `<button class="btn btn--danger btn--sm" data-act="clear-image" data-idx="${i}" type="button">첨부 제거</button>` : ''}
                  </div>
                  <span class="hint">영상 최대 20초</span>
                </div>
              </div>`).join('')}
          </div>
        </div>

        <div class="form-actions">
          <button class="btn btn--ghost" data-act="cancel" type="button">취소</button>
          <button class="btn btn--primary" type="submit">저장</button>
        </div>
      </form>
      <input type="file" id="stepCapture" accept="image/*" capture="environment" style="display:none" />
      <input type="file" id="stepRecord" accept="video/*" capture="environment" style="display:none" />
      <input type="file" id="stepPick" accept="image/*,video/*" style="display:none" />`;

    // 리스너는 매 렌더마다 새로 생성되는 form 에만 연결해 중복 등록을 막는다.
    const form = $('#guideForm');
    form.addEventListener('submit', save);
    form.addEventListener('click', onClick);

    // [준비 공구 · 부품] 을 고치면 단계의 고를 거리도 따라 바뀌어야 한다.
    // 글자를 칠 때마다 화면 전체를 다시 그리면 커서가 튀므로 칩만 다시 그린다.
    $('#gTools').addEventListener('input', () => {
      state.requiredTools = $('#gTools').value;
      pruneStepTools();
      paintToolChips();
    });

    hydrateMedia(view);
  }

  async function onClick(ev) {
    const btn = ev.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const idx = Number(btn.dataset.idx);

    if (act === 'toggle-tool') {
      collect();
      const step = state.steps[idx];
      const tool = btn.dataset.tool;
      const chosen = splitTools(step.expectedMetric);
      step.expectedMetric = (chosen.includes(tool)
        ? chosen.filter((t) => t !== tool)
        : [...chosen, tool]).join(', ');
      paintToolChips();
      return;
    }

    if (act === 'add-cmd') { collect(); state.commands.push({ label: '', cmd: '', desc: '' }); render(); }
    if (act === 'del-cmd') { collect(); state.commands.splice(idx, 1); render(); }
    if (act === 'add-step') { collect(); state.steps.push({ instruction: '', expectedMetric: '', imageUrl: '' }); render(); }
    if (act === 'del-step') {
      collect();
      state.steps.splice(idx, 1);
      if (!state.steps.length) state.steps.push({ instruction: '', expectedMetric: '', imageUrl: '' });
      render();
    }
    if (act === 'up' && idx > 0) {
      collect();
      [state.steps[idx - 1], state.steps[idx]] = [state.steps[idx], state.steps[idx - 1]];
      render();
    }
    if (act === 'down' && idx < state.steps.length - 1) {
      collect();
      [state.steps[idx + 1], state.steps[idx]] = [state.steps[idx], state.steps[idx + 1]];
      render();
    }
    if (act === 'pick-model') {
      $('#gModel').value = btn.dataset.model;
      $$('[data-pick="model"] .btn').forEach((b) => {
        const on = b === btn;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-pressed', String(on));
      });
      return;
    }
    if (act === 'pick-type') {
      $('#gCategory').value = btn.dataset.type;
      $$('[data-pick="type"] .btn').forEach((b) => {
        const on = b === btn;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-pressed', String(on));
      });
      return;
    }
    if (act === 'clear-image') { collect(); state.steps[idx].imageUrl = ''; render(); }
    // 리포트와 같은 세 가지 — 찍기(사진) · 찍기(영상) · 앨범에서 고르기.
    // 촬영은 capture 가 붙은 칸을 써야 카메라가 바로 열린다.
    if (act === 'step-capture' || act === 'step-record' || act === 'step-pick') {
      const input = $({ 'step-capture': '#stepCapture', 'step-record': '#stepRecord',
                        'step-pick': '#stepPick' }[act]);
      const label = btn.textContent;
      input.value = '';
      input.onchange = async () => {
        const file = input.files[0];
        if (!file) return;
        const kind = isVideoFile(file) ? '영상' : '사진';
        btn.disabled = true;
        btn.textContent = '올리는 중…';
        try {
          // 1) 기기에 먼저 담는다 — 오프라인에서도 바로 보인다.
          const media = await api.uploadMedia(file);
          collect();
          state.steps[idx].imageUrl = media.url;
          render();

          // 2) 시트가 연결돼 있으면 드라이브에도 올린다. 그래야 **다른 사람도**
          //    이걸 볼 수 있다 (기기 안 파일은 그 기기에만 있다).
          //    제목이 없으면 폴더 이름을 정할 수 없으니 저장할 때 올린다.
          const title = (state.codeOrTitle || '').trim();
          if (title && await guideMediaEnabled()) {
            try {
              const url = await uploadGuidePhoto(file, state.categoryType, title);
              collect();
              state.steps[idx].imageUrl = url;
              render();
              toast(`${kind}을 드라이브에 올렸습니다. 팀 전체가 볼 수 있습니다.`, 'ok');
            } catch (err) {
              toast(`${kind}은 이 기기에만 저장했습니다 — ${err.message}`, 'err');
            }
          } else {
            toast(title
              ? `${kind}을 첨부했습니다. (구글 시트 연결 시 팀에 공유됩니다)`
              : `${kind}을 첨부했습니다. 제목을 넣고 저장하면 팀에 공유됩니다.`, 'ok');
          }
        } catch (err) {
          toast(err.message, 'err');
          btn.disabled = false;
          btn.textContent = label;
        }
      };
      input.click();
    }
    if (act === 'cancel') {
      const ok = await confirmDialog('편집 취소', '저장하지 않은 내용은 사라집니다.', '나가기', true);
      if (ok) history.length > 1 ? history.back() : (location.hash = '#/');
    }
  }

  /**
   * 저장 직전에 기기 안에만 있는 단계 사진을 드라이브로 올린다.
   *
   * 사진을 붙일 때는 제목이 아직 없을 수 있고(새 가이드), 폴더 이름이 제목이라
   * 그때는 올릴 수가 없다. 제목이 확정되는 저장 시점에 한 번 더 챙긴다.
   */
  async function uploadPendingPhotos() {
    const title = (state.codeOrTitle || '').trim();
    if (!title || !(await guideMediaEnabled())) return;
    for (const step of state.steps) {
      const url = String(step.imageUrl || '');
      if (!url.startsWith('/media/')) continue;
      try {
        const blob = await (await import('../local/store.js'))
          .getMediaBlob(url.split('/').pop());
        if (!blob) continue;
        step.imageUrl = await uploadGuidePhoto(blob, state.categoryType, title);
      } catch { /* 못 올려도 기기에는 남는다 — 다음 저장에서 다시 시도한다 */ }
    }
  }

  async function save(ev) {
    ev.preventDefault();
    collect();
    await uploadPendingPhotos();
    if (!state.codeOrTitle.trim()) { toast('오류 코드 / 제목은 필수입니다.', 'err'); return; }
    const submitBtn = $('#guideForm button[type=submit]');
    submitBtn.disabled = true;
    submitBtn.textContent = '저장 중…';
    try {
      const payload = {
        categoryType: state.categoryType,
        robotModel: state.robotModel,
        codeOrTitle: state.codeOrTitle,
        summary: state.summary,
        requiredTools: state.requiredTools,
        commands: state.commands,
        steps: state.steps,
      };
      const saved = guideId
        ? await api.updateGuide(guideId, payload)
        : await api.createGuide(payload);
      toast('저장했습니다.', 'ok');
      location.hash = `#/guides/${saved.id}`;
    } catch (err) {
      toast(err.message, 'err');
      submitBtn.disabled = false;
      submitBtn.textContent = '저장';
    }
  }

  render();
}

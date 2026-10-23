// 가이드 탭 · 로봇 · 목록 · 로봇 한 번에 지정 (오류코드 · HW SOP · SW 명령어). 상세 · 편집은 views/guide-page.js
import { api } from '../api.js';
import {
  $, $$, h, CATEGORY, closeModal, confirmDialog, copyText, hydrateMedia, loading,
  openSheet, promptDialog, toast, when,
} from '../ui.js';

export const DONE_KEY = (id) => `bh_steps_done_${id}`;

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
export function stepMediaHtml(url, cls, alt) {
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
export async function guideMediaEnabled() {
  const store = await import('../local/store.js');
  return store.sheetInventoryOn();
}

/**
 * 가이드 단계 사진·영상 하나를 드라이브에 올린다.
 *   <공유 드라이브>/가이드/<분류>/<제목>/사진|동영상/
 * 반환: 드라이브 주소 (영상이면 끝에 #video)
 */
export async function uploadGuidePhoto(fileOrBlob, categoryType, title) {
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

export const isVideoFile = (file) => String((file && file.type) || '').startsWith('video/');

// ---------------------------------------------------------------- 공통
//
// 가이드는 **로봇 → 종류 → 목록 → 상세** 차례로 찾아 들어간다.
// 같은 오류 코드라도 로봇(Gen.1 · Gen.2 · Zephyr …)마다 절차가 달라서다.
// 로봇이 정해지지 않은 예전 가이드는 '로봇 미지정' 에 모인다 (사라지지 않는다).
const NONE = '_none';
export const NONE_LABEL = '로봇 미지정';
export const CAT_SHORT = { ERROR_CODE: '오류 코드', HARDWARE_SOP: '하드웨어 교체', SOFTWARE_CMD: 'SW · 명령어' };
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

export const modelKey = (g) => (g.robotModel || '').trim() || NONE;
export const modelLabel = (key) => (key === NONE ? NONE_LABEL : key);
export const modelHref = (key, cat = null) =>
  `#/guides/m/${encodeURIComponent(key || NONE)}${cat ? `/${cat}` : ''}`;

/** 오류 코드는 코드(E-101)와 제목을 나눠 보여 준다. 나머지는 제목만. */
export function splitTitle(guide) {
  if (guide.categoryType !== 'ERROR_CODE') return { code: '', title: guide.codeOrTitle };
  const [first, ...rest] = guide.codeOrTitle.split(' ');
  return { code: first, title: rest.join(' ') || guide.codeOrTitle };
}

/** 로봇 이름 바꾸기 · 삭제 — 가이드 탭과 로봇 화면이 같은 창을 쓴다. */
/**
 * @param {string} name
 * @param {{ onDone?: (next?: string) => void }} [opts]
 */
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
        <span class="row__meta">${h(bits.join(' · '))}</span>
      </span>
      <span class="item__chevron" aria-hidden="true">›</span>
    </a>`;
}

// 현장 리포트 작성 (동적 폼) / 구글 시트 업로드. 이력 · 상세는 views/history.js
import { api } from '../api.js';
import { MEDIA_FILE_LIMIT, MEDIA_TOTAL_LIMIT, MEDIA_FILE_LIMIT_TEXT, MEDIA_TOTAL_LIMIT_TEXT } from '../sheets.js';
import {
  $, closeModal, confirmDialog, copyText, h, hydrateMedia, loading, openSheet,
  toast, when,
} from '../ui.js';
import { reportToText, shareReport } from '../share.js';
import {
  cachedRequestNumbers, describeFiles, explain as explainError, findVisits,
  previewUrl, pullRequestNumbers, thumbUrl,
} from '../reportsheet.js';

import { ICON, SEED_KEY, trackOf, warnPrivateVideo } from './report-common.js';
import { showSheetEntry } from './history.js';
import { guidesForCode, parseParts, partsText } from '../insights.js';

// **작성 중 내용을 되살리지 않는다.**
//
// 예전에는 적는 대로 기기에 담아 두었다가 [새 리포트] 를 열 때 되살렸다.
// 그런데 이미 올린 리포트의 내용까지 되살아나, 끝난 건을 다시 쓰고 있는 것처럼
// 보였다. 새 리포트는 **언제나 빈 화면**에서 시작한다.
// 옛 버전이 남겨 둔 칸은 화면을 열 때 지운다.
const OLD_DRAFT_KEYS = ['bh_report_draft', 'bh_report_edit_draft'];

const ICON_CAMERA = ICON('<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>');
const ICON_VIDEO = ICON('<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/>');
const ICON_ALBUM = ICON('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m3 16 5-5 4 4 3-3 6 6"/><circle cx="16" cy="9" r="1.5"/>');

// ------------------------------------------------------------ 작성 화면
//
// 같은 화면이 두 가지 일을 한다. 무엇을 하는지는 **주소가 정한다.**
//   #/report/new  → 언제나 빈 새 리포트 (수정 내용이 새어 들어오지 않는다)
//   #/report/edit → 이력에서 [수정] 으로 들어온 경우에만
export async function reportFormView(view) {
  loading(view);
  const editMode = location.hash.replace(/^#/, '').split('?')[0] === '/report/edit';
  // 옛 버전이 담아 둔 작성 내용은 여기서 버린다 — 되살릴 일이 없다.
  for (const key of OLD_DRAFT_KEYS) localStorage.removeItem(key);
  const [{ items: fields }, settings] = await Promise.all([
    api.listFields(), api.getSettings(),
  ]);

  // { fieldId: { value: string, media: [{id,filename,url,mime,originalName}] } }
  let values = {};
  fields.forEach((f) => {
    if (!values[f.id]) values[f.id] = { value: '', media: [] };
    if (!Array.isArray(values[f.id].media)) values[f.id].media = [];
    // kept = 이미 시트/드라이브에 올라가 있는 첨부 (수정으로 들어왔을 때)
    if (!Array.isArray(values[f.id].kept)) values[f.id].kept = [];
  });

  // 이력 [수정] 이나 매장별 이력 [이 매장 새 리포트] 로 왔으면 아는 값을 미리 채운다.
  let seeded = null;
  try {
    seeded = JSON.parse(sessionStorage.getItem(SEED_KEY) || 'null');
  } catch { /* 무시 */ }
  // 고치는 중인 줄. **수정 화면일 때만** 존재하고, 이력에서 넘겨받는다.
  const editingLink = editMode ? ((seeded && seeded.sheetLink) || null) : null;

  // 주소로는 수정인데 고칠 줄을 모른다 — 이력을 거치지 않고 들어왔거나,
  // 수정 화면을 벗어났다 뒤로 돌아온 경우다. 이력으로 돌려보낸다
  // (모르는 채로 저장하면 같은 방문이 두 줄이 된다).
  if (editMode && !editingLink) {
    location.replace('#/reports');
    return;
  }

  if (seeded) {
    sessionStorage.removeItem(SEED_KEY);
    if (seeded.values) {
      // 고치기 — 시트에 있던 값을 항목 이름으로 맞춰 전부 채운다.
      const byLabel = new Map(seeded.values.map((v) => [v.label, v.value]));
      for (const f of fields) {
        const found = byLabel.get(f.fieldLabel);
        if (found !== undefined) values[f.id].value = found;
      }
      // 이미 올라가 있는 첨부는 그대로 들고 간다 (지우지 않는 한 유지).
      for (const link of seeded.links || []) {
        const field = fields.find((f) => f.fieldLabel === link.label)
          || fields.find((f) => f.fieldType === 'MEDIA');
        if (field) values[field.id].kept.push(link);
      }
    } else {
      // 새 방문 — 지난 기록에서 아는 것만 채운다.
      for (const f of fields) {
        const label = f.fieldLabel;
        if (seeded.store && (label.includes('식당') || label.includes('매장'))) {
          values[f.id].value = seeded.store;
        } else if (seeded.serial && label.includes('시리얼')) {
          values[f.id].value = seeded.serial;
        } else if (seeded.code && label.includes('오류 코드')) {
          values[f.id].value = seeded.code;
        }
      }
    }
  }

  // 지난 방문을 찾을 기준이 되는 항목 (식당명)
  const storeField = fields.find(
    (f) => f.fieldLabel.includes('식당') || f.fieldLabel.includes('매장'));

  // 리포트 번호는 소비자 앱 접수 건('필드팀 요청') 중에서 고른다.
  // 받아 둔 목록으로 먼저 그리고, 최신 목록은 화면을 그린 뒤에 받아 갈아 끼운다.
  const numberField = fields.find(
    (f) => f.fieldLabel.replace(/\s/g, '').includes('리포트번호'));
  // 오류 코드를 적으면 그 가이드를 바로 보여 준다 · 사용 부품은 차량 재고에서 고른다
  const codeField = fields.find((f) => f.fieldLabel.replace(/\s/g, '').includes('오류코드'));
  const partsField = fields.find((f) => f.fieldLabel.includes('부품'));
  const allGuides = codeField ? (await api.listGuides()).items : [];
  const inventory = partsField ? (await api.listInventory()).items : [];
  let reportNumbers = numberField ? await cachedRequestNumbers() : [];
  let manualNumber = false;   // '직접 입력…' 을 고른 뒤에는 목록으로 되돌리지 않는다

  const sheetsReady = !!settings.sheetsReady;
  let reportId = null;   // 저장 후 재업로드 대상

  function mediaTile(fieldId, media, idx) {
    const isVideo = (media.mime || '').startsWith('video/');
    return `
      <div class="media-tile">
        ${isVideo
          ? `<video data-media="${h(media.url)}" muted playsinline></video>`
          : `<img data-media="${h(media.url)}" alt="${h(media.originalName || '첨부')}" loading="lazy" />`}
        <button class="media-tile__del" data-act="del-media" data-field="${fieldId}" data-idx="${idx}" type="button" aria-label="첨부 삭제">✕</button>
        <div class="media-tile__name">${h(media.originalName || media.filename)}</div>
      </div>`;
  }

  /** 이미 드라이브에 있는 첨부 — 새로 올리지 않고 링크만 유지한다. */
  /**
   * 이미 올라가 있는 첨부.
   * 예전에는 <a> 안에 ✕ 버튼이 들어 있었다 — 링크 안의 버튼은 브라우저마다
   * 어느 쪽이 눌리는지 달라서 "인식 범위가 이상하다" 로 느껴졌다. 열기는 타일을
   * 덮는 링크 한 장, 지우기는 그 위에 따로 올린 버튼으로 나눈다.
   */
  function keptTile(fieldId, link, idx) {
    return `
      <div class="media-tile">
        ${link.id
          ? `<img src="${h(thumbUrl(link.id, 300))}" alt="${h(link.label)}"
                  loading="lazy" onerror="this.classList.add('is-broken')" />`
          : ''}
        <span class="media-tile__none">올라간 첨부</span>
        <a class="media-tile__open" href="${h(link.url)}" target="_blank" rel="noopener"
           aria-label="${h(link.label || '첨부')} 열기"></a>
        <button class="media-tile__del" data-act="del-kept" data-field="${fieldId}"
                data-idx="${idx}" type="button" aria-label="첨부 빼기">✕</button>
        <span class="media-tile__name">${h(link.label || '이미 올림')}</span>
      </div>`;
  }

  /**
   * 첨부 붙이기 — 카메라 · 비디오 · 앨범 타일 셋.
   * 예전에는 글자 버튼 셋이라 입력칸 사이에서 글자처럼 보였다. 첨부는 리포트에서
   * 가장 자주 하는 일인데 가장 약하게 그려져 있었다.
   */
  function mediaPickHtml(fieldId) {
    const tile = (act, label, icon) => `
      <button class="media-pick__tile" data-act="${act}" data-field="${fieldId}" type="button">
        ${icon}<span>${label}</span></button>`;
    return `<div class="media-pick">
      ${tile('capture', '사진 촬영', ICON_CAMERA)}
      ${tile('record', '영상 촬영', ICON_VIDEO)}
      ${tile('pick', '앨범 · 파일', ICON_ALBUM)}
    </div>`;
  }

  /**
   * 리포트 번호 셀렉트의 선택지.
   * 접수 목록에 없는 값(직접 적었거나 옛 리포트 수정)은 잃지 않게 위에 끼운다.
   */
  function numberOptionsHtml(current) {
    const cut = (t, n) => (t.length > n ? `${t.slice(0, n)}…` : t);
    const known = reportNumbers.some((it) => it.number === current);
    return `
      <option value="">선택하세요</option>
      ${current && !known
        ? `<option value="${h(current)}" selected>${h(current)} (직접 적음)</option>` : ''}
      ${reportNumbers.map((it) => {
        const text = [it.number, it.store].filter(Boolean).join(' · ')
          + (it.problem ? ` — ${cut(it.problem, 24)}` : '');
        return `<option value="${h(it.number)}" ${current === it.number ? 'selected' : ''}>${h(text)}</option>`;
      }).join('')}
      <option value="__manual__">직접 입력…</option>`;
  }

  /**
   * 목록이 바뀐 뒤 리포트 번호 칸을 다시 그린다 (그 칸 하나만).
   *
   * 목록과 화면이 어긋나면 안 된다. 고를 것이 없어졌는데 셀렉트가 남아 있으면
   * 골라도 매장명이 안 채워지고, 없는 번호를 고른 것처럼 보인다.
   * 적어 둔 값은 어느 쪽으로 바뀌든 지킨다.
   */
  function repaintNumberField() {
    if (!numberField) return;
    const el = view.querySelector(`[data-input="${numberField.id}"]`);
    const box = el && el.closest('.field');
    if (box) box.outerHTML = fieldHtml(numberField);   // 적어 둔 값은 values 에 있다
  }

  /** 번호를 고르면 그 접수의 매장명을 (매장명 칸이 비어 있을 때만) 같이 채운다. */
  function fillStoreFromNumber(number) {
    const item = reportNumbers.find((it) => it.number === number);
    if (!item || !item.store || !storeField) return;
    if (String(values[storeField.id].value || '').trim()) return;
    values[storeField.id].value = item.store;
    const el = view.querySelector(`[data-input="${storeField.id}"]`);
    if (el) el.value = item.store;
    paintPastVisits();
  }

  function fieldHtml(field) {
    const state = values[field.id];
    const label = `<label>${h(field.fieldLabel)}${field.isRequired ? '<span class="req">*</span>' : ''}</label>`;

    if (field.fieldType === 'MEDIA') {
      return `
        <div class="field field--wide" data-field-id="${field.id}">
          ${label}
          ${mediaPickHtml(field.id)}
          <span class="hint">첨부 ${state.kept.length + state.media.length}개 · 영상 최대 20초 · 파일 ${MEDIA_FILE_LIMIT_TEXT}</span>
          ${state.kept.length || state.media.length ? `
            <div class="media-grid">
              ${state.kept.map((l, i) => keptTile(field.id, l, i)).join('')}
              ${state.media.map((m, i) => mediaTile(field.id, m, i)).join('')}
            </div>` : ''}
        </div>`;
    }
    if (field.fieldType === 'TEXTAREA') {
      // 여러 줄 항목은 두 칸을 다 쓴다 (디자인의 .field--wide)
      return `<div class="field field--wide field--long">${label}
        <textarea class="input textarea textarea--long" data-input="${field.id}" placeholder="자세히 기록">${h(state.value)}</textarea></div>`;
    }
    // 리포트 번호 — 손으로 적지 않고 접수 목록에서 고른다 (목록이 없으면 입력칸).
    if (numberField && field.id === numberField.id && reportNumbers.length && !manualNumber) {
      return `<div class="field">${label}
        <select class="select" data-input="${field.id}">
          ${numberOptionsHtml(String(state.value || '').trim())}
        </select>
        <span class="hint">고르면 매장명이 채워집니다 · 접수 ${reportNumbers.length}건</span></div>`;
    }
    if (field.fieldType === 'DROPDOWN') {
      const opts = (field.options || '').split(',').map((o) => o.trim()).filter(Boolean);
      return `<div class="field">${label}
        <select class="select" data-input="${field.id}">
          <option value="">선택하세요</option>
          ${opts.map((o) => `<option value="${h(o)}" ${state.value === o ? 'selected' : ''}>${h(o)}</option>`).join('')}
        </select></div>`;
    }
    const type = field.fieldType === 'NUMBER' ? 'number' : 'text';
    return `<div class="field">${label}
      <input class="input" type="${type}" ${type === 'number' ? 'inputmode="decimal"' : ''}
             data-input="${field.id}" value="${h(state.value)}" /></div>`;
  }

  function render() {
    view.innerHTML = `
      <div id="pageRoot">
        <div class="page-head">
          <h1 class="page-head__title">${editingLink ? '리포트 수정' : '새 현장 리포트'}</h1>
          ${editingLink ? `<span class="page-head__meta">${h(editingLink.sheetName)} 시트 <span class="tnum">${editingLink.row}</span>행 수정</span>` : ''}
          <span class="page-head__spacer"></span>
          <a class="btn btn-secondary" href="#/fields">항목 설정</a>
        </div>

        <div id="pastVisits"></div>

        <form id="reportForm" class="report-form" autocomplete="off">
          ${fields.length ? `
            <div class="form-grid">${fields.map(fieldHtml).join('')}</div>

            <div class="form-actions">
              <span class="page-head__meta" style="margin-right:auto">
                ${sheetsReady ? ''
                  : '<span style="color:var(--color-danger);font-weight:600">구글 시트 연결이 아직 없습니다 — 설정에서 먼저 연결하세요</span>'}
              </span>
              <button class="btn btn-secondary" data-act="save-draft" type="button">임시보관</button>
              <button class="btn btn-primary" type="submit">${editingLink ? '시트에 저장' : '구글 시트로 업로드'}</button>
            </div>`
            : '<div class="empty">입력 항목이 없습니다. <a class="link" href="#/fields">항목 설정</a>에서 먼저 항목을 만드세요.</div>'}
        </form>

        <input type="file" id="mediaCapture" accept="image/*" capture="environment" style="display:none" />
        <input type="file" id="mediaRecord" accept="video/*" capture="environment" style="display:none" />
        <input type="file" id="mediaPick" accept="image/*,video/*,application/pdf" multiple style="display:none" />
      </div>`;

    const root = $('#pageRoot');
    root.addEventListener('click', onClick);
    hydrateMedia(view);        // 첨부 미리보기는 기기 안 파일에서 꺼낸다
    root.addEventListener('input', (ev) => {
      const id = ev.target.dataset.input;
      if (!id) return;
      values[id].value = ev.target.value;
      if (storeField && id === storeField.id) {
        clearTimeout(visitTimer);
        visitTimer = setTimeout(paintPastVisits, 350);
      }
      if (codeField && id === codeField.id) paintCodeHelper();
      if (partsField && id === partsField.id) paintPartsHelper();
    });
    root.addEventListener('change', (ev) => {
      const id = ev.target.dataset.input;
      if (!id) return;
      if (numberField && id === numberField.id && ev.target.value === '__manual__') {
        // 목록에 없는 번호를 적어야 할 때 — 셀렉트를 입력칸으로 바꾼다
        manualNumber = true;
        values[id].value = '';
        repaintNumberField();
        const inp = root.querySelector(`input[data-input="${id}"]`);
        if (inp) inp.focus();
        return;
      }
      values[id].value = ev.target.value;
      if (numberField && id === numberField.id) fillStoreFromNumber(ev.target.value);
    });
    $('#reportForm').addEventListener('submit', submit);
    paintPastVisits();
    mountHelpers();
  }

  // ─── 오류 코드 → 가이드 · 사용 부품 ← 차량 재고 ───────────────────────────
  const MY_VEHICLE_KEY = 'bh_my_vehicle';
  function fieldBox(field) {
    const input = field && document.querySelector(`#reportForm [data-input="${field.id}"]`);
    return input ? input.closest('.field') : null;
  }
  function mountHelpers() {
    const codeBox = fieldBox(codeField);
    if (codeBox && !codeBox.querySelector('.field-helper')) {
      codeBox.insertAdjacentHTML('beforeend', '<div class="field-helper" id="codeHelper"></div>');
      paintCodeHelper();
    }
    const partsBox = fieldBox(partsField);
    if (partsBox && inventory.length && !partsBox.querySelector('.field-helper')) {
      partsBox.classList.add('field--parts');      // 글자칸 대신 알약 + [부품 넣기]
      partsBox.insertAdjacentHTML('beforeend', '<div class="field-helper" id="partsHelper"></div>');
      paintPartsHelper();
    }
  }
  function paintCodeHelper() {
    const box = $('#codeHelper');
    if (!box || !codeField) return;
    const hits = guidesForCode(values[codeField.id].value, allGuides);
    box.innerHTML = hits.map((g) => `
      <button class="guide-hint" data-act="peek-guide" data-id="${h(g.id)}" type="button">
        <b>가이드</b> ${h(g.codeOrTitle)}${g.robotModel ? ` · ${h(g.robotModel)}` : ''} <span aria-hidden="true">보기 ›</span>
      </button>`).join('');
  }
  function myVehicle() {
    const names = [...new Set(inventory.map((i) => i.vehicleName))];
    const saved = localStorage.getItem(MY_VEHICLE_KEY);
    return names.includes(saved) ? saved : names[0] || '';
  }
  // ─── 사용 부품 (B안) — 칸에는 넣은 부품 알약만, [부품 넣기] 창에서 분류 · 수량을 고른다
  const PART_CATS_KEY = 'bh_report_part_cats';     // 리포트에 보일 재고 분류 (기기마다)
  const NO_CAT = '분류 없음';
  let sheetCat = '';
  let catPicking = false;
  const catOf = (i) => String(i.category || '').trim() || NO_CAT;
  function allCats() {
    const out = [];
    for (const i of inventory) if (!out.includes(catOf(i))) out.push(catOf(i));
    return out;
  }
  /** 내가 고른 분류. 아직 안 골랐으면 전부 */
  function shownCats() {
    let saved = [];
    try { saved = JSON.parse(localStorage.getItem(PART_CATS_KEY) || '[]') || []; } catch { saved = []; }
    const all = allCats();
    const mine = all.filter((c) => saved.includes(c));
    return mine.length ? mine : all;
  }
  function chosenParts() {
    return parseParts(values[partsField.id].value);
  }
  function setParts(list) {
    values[partsField.id].value = partsText(list.filter((x) => x.n > 0));
    const input = /** @type {HTMLInputElement} */ (document.querySelector(`#reportForm [data-input="${partsField.id}"]`));
    if (input) input.value = values[partsField.id].value;
    paintPartsHelper();
  }
  function changePart(name, delta) {
    const list = chosenParts();
    const hit = list.find((x) => x.name === name);
    if (hit) hit.n = Math.max(0, hit.n + delta);
    else if (delta > 0) list.push({ name, n: delta });
    setParts(list);
  }
  /** 칸 — 넣은 부품 알약(✕ 로 빼기) + [부품 넣기] */
  function paintPartsHelper() {
    const box = $('#partsHelper');
    if (!box || !partsField) return;
    const list = chosenParts();
    box.innerHTML = `
      <div class="parts-field">
        ${list.map((x) => `
          <span class="part-pill">${h(x.name)}${x.n > 1 ? ` <b class="tnum">×${x.n}</b>` : ''}
            <button class="part-pill__x" data-act="part-remove" data-part="${h(x.name)}" type="button"
                    aria-label="${h(x.name)} 빼기">✕</button></span>`).join('')}
        <button class="parts-add" data-act="open-parts" type="button">＋ 부품 넣기</button>
      </div>
      ${list.length ? `<span class="hint">올리면 ${h(myVehicle())} 재고에서 뺍니다</span>` : ''}`;
    const sheetBody = document.getElementById('partsSheet');
    if (sheetBody) paintPartsSheet(sheetBody);
  }
  /** [부품 넣기] 창 — 차량 · 분류 탭(고른 것만) · 품목마다 −/+ · 목록에 없는 부품 */
  function paintPartsSheet(body) {
    const vehicles = [...new Set(inventory.map((i) => i.vehicleName))];
    const car = myVehicle();
    const cats = shownCats();
    if (!cats.includes(sheetCat)) sheetCat = cats[0] || '';
    const counts = new Map(chosenParts().map((x) => [x.name, x.n]));
    const items = inventory.filter((i) => i.vehicleName === car && catOf(i) === sheetCat);
    const picked = (c) => inventory.some((i) => i.vehicleName === car && catOf(i) === c && counts.get(i.partName));
    body.innerHTML = `
      ${vehicles.length > 1 ? `<div class="ps-row">
        ${vehicles.map((v) => `<button class="ps-chip${v === car ? ' is-on' : ''}" data-act="pick-car" data-car="${h(v)}" type="button">${h(v)}</button>`).join('')}
      </div>` : `<p class="muted ps-car">${h(car)} 재고</p>`}
      ${catPicking ? `
        <div class="ps-cats">
          <p class="muted">리포트에 보일 분류를 고르세요 · 이 기기에만 저장됩니다</p>
          ${allCats().map((c) => `
            <label class="ps-check"><input type="checkbox" data-act="toggle-cat" data-cat="${h(c)}"
              ${shownCats().includes(c) && localStorage.getItem(PART_CATS_KEY) ? 'checked' : ''} /> ${h(c)}</label>`).join('')}
          <button class="btn btn-secondary btn--sm" data-act="cats-done" type="button">다 골랐어요</button>
        </div>` : `
        <div class="ps-tabs" role="tablist">
          ${cats.map((c) => `<button class="ps-tab${c === sheetCat ? ' is-on' : ''}" data-act="part-cat" data-cat="${h(c)}"
              role="tab" aria-selected="${c === sheetCat}" type="button">${h(c)}${picked(c) ? ' <i aria-hidden="true">●</i>' : ''}</button>`).join('')}
          <button class="ps-gear" data-act="cats-pick" type="button">보일 분류 고르기</button>
        </div>
        <div class="ps-list">
          ${items.length ? items.map((i) => {
            const n = counts.get(i.partName) || 0;
            const over = n > i.quantity;
            return `
              <div class="ps-item${n ? ' is-on' : ''}">
                <span class="ps-item__name">${h(i.partName)}
                  <small class="${over ? 'ps-over' : 'muted'}">재고 ${i.quantity}${over ? ' · 재고보다 많음' : ''}</small></span>
                <span class="ps-step">
                  <button data-act="part-dec" data-part="${h(i.partName)}" type="button" aria-label="${h(i.partName)} 하나 빼기" ${n ? '' : 'disabled'}>−</button>
                  <b class="tnum">${n}</b>
                  <button data-act="part-inc" data-part="${h(i.partName)}" type="button" aria-label="${h(i.partName)} 하나 넣기">+</button>
                </span>
              </div>`;
          }).join('') : '<p class="muted">이 분류에 품목이 없습니다.</p>'}
        </div>
        <div class="ps-free">
          <input class="input" id="partFree" placeholder="목록에 없는 부품 이름" autocomplete="off" />
          <button class="btn btn-secondary" data-act="part-free" type="button">넣기</button>
        </div>`}
      <button class="btn btn-primary btn--block" data-act="close" type="button">다 됐어요</button>`;
  }
  function openPartsSheet() {
    catPicking = false;
    openSheet('부품 넣기', '<div id="partsSheet" class="parts-sheet"></div>');
    const body = document.getElementById('partsSheet');
    paintPartsSheet(body);
    body.addEventListener('click', (ev) => {
      const btn = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (ev.target).closest('[data-act]'));
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === 'pick-car') { localStorage.setItem(MY_VEHICLE_KEY, btn.dataset.car); paintPartsHelper(); }
      if (act === 'part-cat') { sheetCat = btn.dataset.cat; paintPartsSheet(body); }
      if (act === 'part-inc') changePart(btn.dataset.part, 1);
      if (act === 'part-dec') changePart(btn.dataset.part, -1);
      if (act === 'cats-pick') { catPicking = true; paintPartsSheet(body); }
      if (act === 'cats-done') { catPicking = false; paintPartsSheet(body); }
      if (act === 'part-free') {
        const inp = /** @type {HTMLInputElement} */ (document.getElementById('partFree'));
        const name = inp.value.trim();
        if (name) changePart(name, 1);
      }
    });
    body.addEventListener('change', (ev) => {
      const box = /** @type {HTMLInputElement} */ (ev.target);
      if (box.dataset.act !== 'toggle-cat') return;
      const on = [...body.querySelectorAll('[data-act="toggle-cat"]')]
        .filter((x) => /** @type {HTMLInputElement} */ (x).checked).map((x) => /** @type {HTMLElement} */ (x).dataset.cat);
      try {
        if (on.length) localStorage.setItem(PART_CATS_KEY, JSON.stringify(on));
        else localStorage.removeItem(PART_CATS_KEY);       // 하나도 안 고르면 전부 보인다
      } catch { /* 이번만 */ }
    });
  }
  /** 새 리포트를 올릴 때 한 번만 — 고른 부품을 내 차량 재고에서 뺀다 */
  async function deductParts(reportId) {
    if (!partsField || editingLink) return;
    const doneKey = `bh_parts_done_${reportId}`;
    if (localStorage.getItem(doneKey)) return;
    const car = myVehicle();
    const used = parseParts(values[partsField.id].value);
    const moved = [];
    let low = 0;
    for (const p of used) {
      const item = inventory.find((i) => i.vehicleName === car && i.partName === p.name);
      if (!item) continue;
      const updated = await api.patchInventory(item.id, { delta: -p.n }).catch(() => null);
      if (!updated) continue;
      moved.push(`${p.name} ×${p.n}`);
      if (item.minQuantity > 0 && updated.quantity < item.minQuantity) low += 1;
    }
    localStorage.setItem(doneKey, '1');
    if (moved.length) {
      window.dispatchEvent(new Event('bh-inventory-changed'));
      toast(`재고에서 뺐습니다 (${car}): ${moved.join(', ')}${low ? ` · 보충 필요 ${low}건` : ''}`, 'ok');
    }
  }

  /**
   * 같은 식당의 지난 방문을 보여 준다.
   *
   * 이 부분만 갈아 끼운다 — 입력 칸을 다시 만들면 한글 조합이 깨진다.
   * (이력 검색창에서 겪은 것과 같은 문제)
   */
  let visitTimer = null;
  async function paintPastVisits() {
    const box = $('#pastVisits');
    if (!box || !storeField) return;
    const name = values[storeField.id].value;
    const visits = await findVisits(name, 3);
    if (!visits.length) { box.innerHTML = ''; return; }

    box.innerHTML = `
      <div class="panel">
        <h2 class="panel__title">${h(name)} · 지난 방문 ${visits.length}건</h2>
        <div class="list">
          ${visits.map((v) => {
            const t = trackOf(v.status);
            const attach = v.links.length
              ? ` · 첨부 <span class="tnum">${v.links.length}</span>` : '';
            return `
              <button class="item" data-act="visit" data-key="${h(v.key)}" type="button"
                      style="width:100%;text-align:left;background:none;border:0;font:inherit;color:inherit">
                <span class="item__body">
                  <span class="item__title">${h(v.date)} · ${h(v.code || '코드 없음')}</span>
                  <span class="item__sub">${h(v.summary || '-')}${attach}</span>
                </span>
                <span class="pill pill--${t.cls}">${h(v.status)}</span>
              </button>`;
          }).join('')}
        </div>
      </div>`;
    box.querySelectorAll('[data-act="visit"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const found = visits.find((v) => v.key === btn.dataset.key);
        if (found) showSheetEntry(found);
      });
    });
  }

  function collectPayload() {
    return fields.map((field) => ({
      fieldId: field.id,
      label: field.fieldLabel,
      type: field.fieldType,
      value: values[field.id].value,
      media: values[field.id].media,
      kept: values[field.id].kept,
    }));
  }

  function missingRequired() {
    return fields.filter((f) => {
      if (!f.isRequired) return false;
      return f.fieldType === 'MEDIA'
        ? values[f.id].media.length === 0
        : !String(values[f.id].value || '').trim();
    });
  }

  /**
   * 태블릿 사진은 3~5MB 나 되므로, 올리기 전에 가로/세로 최대 1600px 로 줄인다.
   * 화면 확인과 시트 삽입에는 충분하고 업로드가 훨씬 빨라진다.
   */
  async function shrinkImage(file) {
    if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;
    try {
      // 구형 태블릿에서 사진이 눕지 않도록 EXIF 방향을 반영한다
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      const max = 1600;
      const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
      if (scale === 1 && file.size < 1.2 * 1024 * 1024) return file;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close && bitmap.close();
      const blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', 0.85));
      if (!blob || blob.size >= file.size) return file;
      const name = (file.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg';
      return new File([blob], name, { type: 'image/jpeg' });
    } catch {
      return file;      // 변환 실패 시 원본 그대로
    }
  }

  /** 이 리포트에 이미 붙어 있는(아직 안 올린) 첨부의 합계 바이트 */
  function attachedBytes() {
    let total = 0;
    for (const state of Object.values(values)) {
      for (const m of state.media || []) total += Number(m.size) || 0;
    }
    return total;
  }

  const mb = (n) => `${Math.round(n / 1048576)}MB`;

  /**
   * 파일이 시트로 올라갈 수 있는 크기인지 **고르는 순간** 확인한다.
   * 넘으면 이유를 돌려준다. 예전에는 저장할 때 조용히 건너뛰어서, 현장에서
   * 찍은 동영상이 빠진 것을 사무실에서야 알았다.
   */
  function tooBigReason(file) {
    const isVideo = (file.type || '').startsWith('video/');
    const what = isVideo ? '이 동영상은' : '이 파일은';
    if (file.size > MEDIA_FILE_LIMIT) {
      return `${what} ${mb(file.size)} 라 올릴 수 없습니다 (파일당 ${MEDIA_FILE_LIMIT_TEXT} 까지).`
        + (isVideo ? ' 짧게 다시 찍거나 낮은 화질로 찍어 주세요.' : '');
    }
    if (attachedBytes() + file.size > MEDIA_TOTAL_LIMIT) {
      return `${what} 더하면 리포트 전체가 ${MEDIA_TOTAL_LIMIT_TEXT} 를 넘습니다`
        + ` (지금 ${mb(attachedBytes())} + ${mb(file.size)}). 첨부를 하나 빼거나 리포트를 나눠 주세요.`;
    }
    return '';
  }

  async function uploadFiles(fieldId, fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    let added = 0;
    for (const original of files) {
      try {
        // 사진은 먼저 줄인다 — 줄인 뒤 크기로 판단해야 공정하다.
        const file = await shrinkImage(original);
        const reason = tooBigReason(file);
        if (reason) { toast(reason, 'err'); continue; }
        const media = await api.uploadMedia(file);
        values[fieldId].media.push({
          id: media.id, filename: media.filename, url: media.url,
          mime: media.mime, originalName: media.originalName, size: media.size,
        });
        added += 1;
      } catch (err) {
        toast(`${original.name}: ${err.message}`, 'err');
      }
    }
    render();
    if (added) toast(`첨부 ${added}개를 붙였습니다.`, 'ok');
  }

  async function onClick(ev) {
    const btn = ev.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'peek-guide') { peekGuide(btn.dataset.id); return; }
    if (act === 'open-parts') { openPartsSheet(); return; }
    if (act === 'part-remove') {
      setParts(chosenParts().filter((x) => x.name !== btn.dataset.part));
      return;
    }

    if (act === 'capture' || act === 'record' || act === 'pick') {
      const input = $({ capture: '#mediaCapture', record: '#mediaRecord', pick: '#mediaPick' }[act]);
      input.value = '';
      input.onchange = () => uploadFiles(btn.dataset.field, input.files);
      input.click();
      return;
    }
    if (act === 'del-kept') {
      values[btn.dataset.field].kept.splice(Number(btn.dataset.idx), 1);
      render();
      return;
    }
    if (act === 'del-media') {
      values[btn.dataset.field].media.splice(Number(btn.dataset.idx), 1);
      render();
      return;
    }
    if (act === 'save-draft') {
      btn.disabled = true;
      const saved = await persist({ requireComplete: false });
      if (saved) {
        toast('기기에 저장했습니다. [이력] 에서 다시 열 수 있습니다.', 'ok');
      }
      btn.disabled = false;
      return;
    }

  }

  /**
   * 리포트를 서버에 저장한다. 반환: 저장된 리포트 객체 · 실패는 null
   */
  async function persist({ requireComplete }) {
    if (requireComplete) {
      const missing = missingRequired();
      if (missing.length) {
        toast(`필수 항목을 입력하세요: ${missing.map((f) => f.fieldLabel).join(', ')}`, 'err');
        return null;
      }
    }
    const payload = { values: collectPayload(), draft: !requireComplete,
                      sheetLink: editingLink };
    try {
      const saved = reportId
        ? await api.updateReport(reportId, payload)
        : await api.createReport(payload);
      reportId = saved.id;
      return saved;
    } catch (err) {
      toast(err.message, 'err');
      return null;
    }
  }

  /**
   * 올리기 버튼은 **두 곳**에 있다 — 폼 맨 아래와 상단바(#btn-topaction).
   * 둘은 같은 일을 하므로 늘 같은 모습이어야 한다. 예전에는 아래 것만
   * '올리는 중' 으로 바뀌어, 위 버튼은 멀쩡해 보이니 한 번 더 누르게 됐다.
   */
  const idleLabel = () => (editingLink ? '시트에 저장' : '구글 시트로 업로드');
  function setSubmitState(text, busy) {
    const buttons = [
      $('#reportForm button[type=submit]'),
      document.getElementById('btn-topaction'),
    ];
    for (const btn of buttons) {
      if (!btn) continue;
      btn.textContent = text;
      btn.disabled = busy;
    }
  }

  async function submit(ev) {
    ev.preventDefault();
    setSubmitState('저장 중…', true);
    const saved = await persist({ requireComplete: true });
    if (!saved) {
      setSubmitState(idleLabel(), false);
      return;
    }
    deductParts(saved.id).catch(() => {});      // 쓴 부품은 올리기 결과와 상관없이 재고에서 뺀다
    setSubmitState('구글 시트에 올리는 중…', true);
    // 첨부를 조각으로 올리는 동안 몇 번째인지 보여 준다 (LTE 에서 오래 걸려도 멈춘 게 아니다)
    const onProgress = (ev) => {
      const d = ev.detail || {};
      if (d.total) setSubmitState(`올리는 중 · ${d.label} ${Math.round((d.sent / d.total) * 100)}%`, true);
    };
    window.addEventListener('bh-upload-progress', onProgress);
    try {
      const result = await api.uploadReportToSheet(saved.id).finally(() => window.removeEventListener('bh-upload-progress', onProgress));
      if (result.queued) {
        // 오프라인 — 기기에 저장해 두었다가 연결되면 자동으로 올린다.
        toast('기기에 저장했습니다. 인터넷에 연결되면 자동으로 시트에 올립니다.', 'ok');
      } else {
        toast(`구글 시트 [${result.sheetName}] ${result.row}행에 기록했습니다.`
          + (result.media ? ` (첨부 ${result.media}개 공유 드라이브 저장)` : ''), 'ok');
        if (result.media && result.mediaShared === false) {
          toast('공유 드라이브에 닿지 못해 개인 드라이브에 저장했습니다. '
                + '설정에서 공유 드라이브 권한을 확인해 주세요.', 'err');
        }
        (result.mediaSkipped || []).forEach((s) =>
          toast(`첨부 제외: ${s.filename} (${s.reason})`, 'err'));
        warnPrivateVideo(result);
      }
      location.hash = `#/reports/${saved.id}`;
    } catch (err) {
      toast(err.message, 'err');
      toast('리포트는 저장되었습니다. [ 리포트]에서 다시 업로드할 수 있습니다.');
      location.hash = `#/reports/${saved.id}`;
    }
    setSubmitState(idleLabel(), false);
  }

  render();

  // 최신 접수 목록을 뒤에서 받아 그 칸만 갈아 끼운다 — 쓰던 화면은 건드리지 않는다.
  if (numberField && sheetsReady) {
    pullRequestNumbers().then((items) => {
      if (manualNumber) return;    // 직접 적고 있는 중이면 끼어들지 않는다
      reportNumbers = items;
      repaintNumberField();
    }).catch(() => {});            // 못 받아오면 받아 둔 목록 그대로 쓴다
  }
}

/** 쓰던 리포트를 두고 가이드를 창으로 본다 (화면을 옮기면 적던 내용이 사라진다) */
async function peekGuide(id) {
  const g = await api.getGuide(id).catch(() => null);
  if (!g) { toast('가이드를 찾지 못했습니다.', 'err'); return; }
  openSheet(g.codeOrTitle, `
    ${g.summary ? `<p class="hd-text">${h(g.summary)}</p>` : ''}
    ${g.requiredTools ? `<p class="muted">준비 · ${h(g.requiredTools)}</p>` : ''}
    <ol class="peek-steps">${(g.steps || []).map((st) => `<li>${h(st.instruction)}</li>`).join('')}</ol>
    ${(g.commands || []).length ? `<div class="peek-cmds">${g.commands.map((c) => `<code>${h(c.cmd)}</code>`).join('')}</div>` : ''}
    <p class="muted">가이드 전체는 리포트를 올린 뒤 [가이드] 에서 볼 수 있습니다.</p>`);
}

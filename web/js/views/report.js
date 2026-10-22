// 현장 리포트 작성 (동적 폼) · 이력 · 상세 / 구글 시트 업로드
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

// **작성 중 내용을 되살리지 않는다.**
//
// 예전에는 적는 대로 기기에 담아 두었다가 [새 리포트] 를 열 때 되살렸다.
// 그런데 이미 올린 리포트의 내용까지 되살아나, 끝난 건을 다시 쓰고 있는 것처럼
// 보였다. 새 리포트는 **언제나 빈 화면**에서 시작한다.
// 옛 버전이 남겨 둔 칸은 화면을 열 때 지운다.
const OLD_DRAFT_KEYS = ['bh_report_draft', 'bh_report_edit_draft'];
const SEED_KEY = 'bh_report_seed';   // 이력에서 [이어서 작성] 로 넘겨받는 값

const ICON = (paths) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
  stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const ICON_CAMERA = ICON('<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>');
const ICON_VIDEO = ICON('<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/>');
const ICON_ALBUM = ICON('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m3 16 5-5 4 4 3-3 6 6"/><circle cx="16" cy="9" r="1.5"/>');

/** 이력의 한 건을 새 리포트의 출발점으로 넘긴다. */
export function seedFromEntry(entry, { edit = false } = {}) {
  sessionStorage.setItem(SEED_KEY, JSON.stringify({
    store: entry.store || '', code: entry.code || '',
    serial: (entry.values.find((v) => v.label.includes('시리얼')) || {}).value || '',
    // 고치기로 들어왔으면 어느 줄을 고쳐 쓸지 함께 넘긴다.
    // 이게 없으면 저장할 때 같은 방문이 두 줄이 된다.
    sheetLink: edit ? { sheetName: entry.sheetName, row: entry.row } : null,
    values: edit ? entry.values : null,
    // 이미 올라가 있는 사진·영상. 이걸 안 넘기면 저장할 때 시트의 링크가
    // 빈 칸으로 덮여 **드라이브에는 있는데 리포트에서는 사라진다.**
    links: edit ? entry.links.map((l) => ({ label: l.label, url: l.url, id: l.id }))
                : null,
  }));
}

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

  // 이력에서 [이어서 작성] 으로 왔으면 아는 값을 미리 채운다.
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
      // 이어서 작성 — 아는 것만 채운다.
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
    setSubmitState('구글 시트에 올리는 중…', true);
    try {
      const result = await api.uploadReportToSheet(saved.id);
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

// ------------------------------------------------------------ 이력 목록
const STATUS = {
  DRAFT: ['badge', '저장됨 (업로드 안 함)'],
  QUEUED: ['badge badge--warn', '업로드 대기 (연결되면 자동)'],
  UPLOADED: ['badge badge--ok', '구글 시트 업로드 완료'],
  FAILED: ['badge badge--danger', '업로드 실패'],
};

/** 추적 상태 4종 — 시트 '상태' 열의 값과 1:1 로 맞춘다. */
const TRACK = [
  { value: '조치 완료',    short: '조치 완료', cls: 'done' },
  { value: '모니터링',     short: '모니터링',  cls: 'watch' },
  { value: '조치 진행 중', short: '진행 중',   cls: 'doing' },
  { value: '교체 예정',    short: '교체 예정', cls: 'swap' },
];
const trackOf = (value) => TRACK.find((t) => t.value === value) || TRACK[2];

/** 상태마다 모양이 다른 아이콘 — 색을 못 가려도 모양으로 읽힌다 (홈과 같은 그림). */
const STATUS_ICON = {
  doing: 'M21 12a9 9 0 1 1-3-6.7M21 3v6h-6',
  swap: 'M7 7h11l-3-3M17 17H6l3 3',
  watch: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6',
  done: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M8 12.5l2.5 2.5L16 9.5',
  all: 'M4 6h16M4 12h16M4 18h16',
};
const stIcon = (cls) => `<svg class="st-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${STATUS_ICON[cls]}"/></svg>`;

/** 끝나지 않은 건이 며칠째인가 — '오늘' · 'N일째'. 끝난 건은 빈 글자. */
function ageText(entry) {
  if (entry.status === '조치 완료') return '';
  const at = new Date(String(entry.createdAt || entry.date || '').replace(' ', 'T'));
  if (Number.isNaN(at.getTime())) return '';
  const days = Math.floor((Date.now() - at.getTime()) / 86400000);
  return days <= 0 ? '오늘' : `${days + 1}일째`;
}

/**
 * 동영상이 비공개로 남았으면 알린다.
 *
 * 사진은 공개가 막혀도 앱이 시트를 거쳐 바이트를 받아 그린다. 동영상은 너무
 * 커서 그 길을 못 쓰고 드라이브 재생기로만 본다. 드라이브 재생기는 파일이
 * 공개거나 보는 사람이 로그인돼 있어야 한다. 그래서 이 경우만 따로 말해 준다.
 */
function warnPrivateVideo(result) {
  if (!result || !result.mediaVideos || !result.mediaPrivate) return;
  toast('동영상이 다른 사람 화면에서 재생되지 않을 수 있습니다 — 드라이브 링크 공개가 '
        + '막혀 있습니다. 관리자에게 알려 주세요.', 'err');
}

/**
 * 드라이브 썸네일이 막힌 사진을 되살린다.
 *
 * `drive.google.com/thumbnail` 은 파일이 공개돼 있을 때만 그림을 준다.
 * 공유 드라이브는 조직 정책으로 링크 공개가 막힐 수 있어서, 그런 현장에서는
 * 사진이 전부 액박이 됐다. 그때는 Apps Script 로 바이트를 직접 받아 끼운다.
 * 한 번 받은 것은 기기에 남아 다음부터는 즉시 뜬다.
 */
function reviveBrokenThumbs(root) {
  const shots = [...root.querySelectorAll('img[data-drive]')]
    .filter((el) => !el.dataset.driveDone);
  if (!shots.length) return;
  import('../drivemedia.js').then(({ reviveImage }) => {
    for (const el of shots) {
      el.dataset.driveDone = '1';
      const size = el.dataset.driveSize === 'full' ? 'full' : 'thumb';
      const tryRevive = () => reviveImage(el, el.dataset.drive, size);
      // 이미 실패했으면 지금, 아직 받는 중이면 실패할 때.
      if (el.complete && !el.naturalWidth) tryRevive();
      else el.addEventListener('error', tryRevive, { once: true });
    }
  }).catch(() => { /* 못 불러와도 [드라이브에서 열기] 는 그대로 쓸 수 있다 */ });
}

/**
 * 시트 한 줄의 상세 — 현장에서 다시 볼 때 중요한 차례대로.
 *   로봇(모델 · 시리얼 · 오류 코드) → 증상 → 조치(+처리 결과) → 사진 · 영상
 *   → 그 밖의 항목(접힘) → 상태(맨 아래, 누르면 시트에 바로 기록) → 수정 · 이어서 · 삭제
 * 이력 화면 오른쪽 패널과 [지난 방문] 창이 같은 모양을 쓴다.
 */
const has = (label, ...words) => words.some((w) => String(label || '').includes(w));
/** 안 끝난 것을 앞에 — 이력의 상태 칩과 같은 차례. */
const STATUS_ORDER = ['조치 진행 중', '교체 예정', '모니터링', '조치 완료'];

function entryParts(entry) {
  const robot = [];
  const symptom = [];
  const action = [];
  const result = [];
  const rest = [];
  for (const v of entry.values || []) {
    if (has(v.label, '로봇', '시리얼') || has(v.label, '오류 코드')) robot.push(v);
    else if (has(v.label, '증상')) symptom.push(v);
    else if (has(v.label, '처리 결과', '결과')) result.push(v);
    else if (has(v.label, '조치')) action.push(v);
    else if (has(v.label, '식당', '매장')) continue;        // 제목에 이미 있다
    else rest.push(v);
  }
  return { robot, symptom, action, result, rest };
}

function entryDetailHtml(entry) {
  const p = entryParts(entry);
  const t = trackOf(entry.status);
  const ICON = {
    robot: 'M6 8h12v10H6zM9 8V5h6v3M9 12h.01M15 12h.01M10 15h4',
    symptom: 'M12 8v5M12 16.5v.01M12 3 2 20h20z',
    action: 'M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-.5-.5-2.5z',
    media: 'M4 8h3l2-3h6l2 3h3v11H4zM12 10.5a3 3 0 1 0 0 6a3 3 0 1 0 0-6',
  };
  const label = (sec, text) => `
    <span class="hd2-label"><span class="hd2-ico" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"
      stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="${ICON[sec]}"/></svg></span>${text}</span>`;
  const text = (list, empty) => (list.length
    ? list.map((v) => `<p class="hd-text">${h(v.value)}</p>`).join('')
    : `<p class="hd-text hd-text--empty">${empty}</p>`);
  const age = ageText(entry);
  return `
    <div class="hd2">
      <div class="hd2-head">
        <span class="hd2-head__text">
          <span class="hd-meta">${h([entry.sheetName, when(entry.createdAt || entry.date), entry.author]
            .filter((v) => v && v !== '-').join(' · '))}</span>
          <h2 class="hd-title">${h(entry.store || '(식당명 없음)')}</h2>
        </span>
        <span class="hd2-badge" data-track="${t.cls}">${stIcon(t.cls)}${h(entry.status)}${age ? ` · ${age}` : ''}</span>
      </div>

      <div class="hd2-row" data-sec="robot">
        ${label('robot', '로봇')}
        <div class="hd2-body">
          ${p.robot.length ? `<div class="hd-facts">
            ${p.robot.map((v) => `<span class="hd-fact"><span class="hd-fact__k">${h(v.label)}</span><b class="hd-fact__v">${h(v.value)}</b></span>`).join('')}
          </div>` : '<p class="hd-text hd-text--empty">적힌 로봇 정보가 없습니다.</p>'}
        </div>
      </div>
      <div class="hd2-row" data-sec="symptom">
        ${label('symptom', '증상')}
        <div class="hd2-body">${text(p.symptom, '적힌 증상이 없습니다.')}</div>
      </div>
      <div class="hd2-row" data-sec="action">
        ${label('action', '조치')}
        <div class="hd2-body">
          ${text(p.action, '적힌 조치가 없습니다.')}
          ${p.result.map((v) => `<span class="hd-result">${h(v.label)} · <b>${h(v.value)}</b></span>`).join('')}
        </div>
      </div>
      <div class="hd2-row" data-sec="media">
        ${label('media', `사진·영상<span class="tnum">${entry.links.length}</span>`)}
        <div class="hd2-body">
          ${entry.links.length ? `
            <div class="media-grid hd-media">
              ${entry.links.map((l, i) => `
                <button class="media-tile" data-act="view" data-idx="${i}" type="button"
                        style="padding:0;cursor:zoom-in" aria-label="${h(l.label)} 크게 보기">
                  ${l.id
                    ? `<img src="${h(thumbUrl(l.id, 400))}" alt="${h(l.label)}" loading="lazy"
                            data-drive="${h(l.id)}"
                            onerror="this.classList.add('is-broken')" />`
                    : ''}
                  <span class="media-tile__none">열어 보기</span>
                  <span class="media-tile__name">${h(l.label)}</span>
                </button>`).join('')}
            </div>` : '<p class="hd-text hd-text--empty">첨부가 없습니다.</p>'}
        </div>
      </div>

      ${p.rest.length ? `
        <details class="hd-more">
          <summary>그 밖의 항목&nbsp;<span class="tnum">${p.rest.length}</span></summary>
          <div class="hd-facts">
            ${p.rest.map((v) => `<span class="hd-fact"><span class="hd-fact__k">${h(v.label)}</span><b class="hd-fact__v">${h(v.value)}</b></span>`).join('')}
          </div>
        </details>` : ''}

      <section class="hd-status">
        <h3 class="hd-sec__title">상태 <span class="hd-status__note">누르면 시트에 바로 기록</span></h3>
        <div class="status-seg" role="group" aria-label="상태">
          ${STATUS_ORDER.map(trackOf).map((s) => `
            <button class="status-seg__btn${s.value === entry.status ? ' is-on' : ''}" data-act="set-status"
                    data-value="${h(s.value)}" data-track="${s.cls}" type="button"
                    aria-pressed="${s.value === entry.status}">${stIcon(s.cls)}${h(s.short)}</button>`).join('')}
        </div>
      </section>

      <div class="hist-actions">
        <button class="btn btn-secondary" data-act="edit" type="button">수정</button>
        <button class="btn btn-secondary" data-act="reuse" type="button">이어서 작성</button>
        <button class="btn btn--danger" data-act="delete" type="button">삭제</button>
      </div>
    </div>`;
}

/**
 * 상세의 버튼들. onStatus 는 상태를 바꾼 뒤(성공·실패 모두) 화면을 다시 그리는 일.
 * box 는 다시 그려져도 그대로인 바깥 칸이어야 한다 (이벤트를 한 번만 단다).
 */
function bindEntry(box, getEntry, { onStatus, inModal = false } = {}) {
  box.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-act]');
    if (!btn) return;
    const entry = getEntry();
    if (!entry) return;
    const act = btn.dataset.act;
    if (act === 'set-status') {
      const before = entry.status;
      const next = btn.dataset.value;
      if (next === before) return;
      entry.status = next;                 // 화면은 곧바로 반응한다
      if (onStatus) onStatus();
      try {
        const result = await api.setReportStatus(entry.sheetName, entry.row, next);
        toast(result.queued
          ? '오프라인입니다. 연결되면 시트에 반영합니다.'
          : `상태를 '${next}' 로 바꿨습니다.`, 'ok');
      } catch (err) {
        entry.status = before;             // 실패하면 되돌린다
        if (onStatus) onStatus();
        toast(err.message, 'err');
      }
    }
    if (act === 'reuse') {
      // 새 방문 — 아는 값만 채우고 시트에는 새 줄로 들어간다.
      localStorage.removeItem(NEW_DRAFT_KEY);
      seedFromEntry(entry);
      if (inModal) closeModal();
      location.hash = '#/report/new';
      toast('지난 기록을 바탕으로 새 리포트를 엽니다.', 'ok');
    }
    if (act === 'edit') {
      // 같은 방문을 고침 — 시트의 그 줄을 다시 쓴다.
      seedFromEntry(entry, { edit: true });
      if (inModal) closeModal();
      location.hash = '#/report/edit';
      toast('이 리포트를 고칩니다. 저장하면 같은 줄이 바뀝니다.', 'ok');
    }
    if (act === 'delete') {
      const ok = await confirmDialog(
        '구글 시트에서 삭제',
        [
          `${entry.store || '이 리포트'} · ${entry.date}`,
          '',
          '구글 시트에서 이 줄을 지웁니다. 팀 전체에서 사라집니다.',
          '되돌릴 수 없습니다.',
          '',
          '드라이브에 저장된 사진·영상은 지워지지 않습니다.',
        ].join(String.fromCharCode(10)),
        '시트에서 삭제', true);
      if (!ok) return;
      btn.disabled = true;
      btn.textContent = '지우는 중…';
      try {
        await api.deleteSheetReport(entry.sheetName, entry.row);
        closeModal();
        toast('구글 시트에서 지웠습니다.', 'ok');
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      } catch (err) {
        toast(err.message, 'err');
        btn.disabled = false;
        btn.textContent = '삭제';
      }
    }
    if (act === 'view') {
      openViewer(entry.links, Number(btn.dataset.idx));
    }
  });
}

/** 상세를 칸에 그린다 — 영상 표시 · 막힌 썸네일 되살리기까지. */
function paintEntry(box, entry) {
  box.innerHTML = entryDetailHtml(entry);
  markVideos(entry.links, box);
  reviveBrokenThumbs(box);
}

/**
 * 시트 한 줄의 상세를 창으로 보여 준다.
 * 좁은 화면의 이력과 새 리포트의 [지난 방문] 이 쓴다.
 */
export function showSheetEntry(entry) {
  const box = openSheet(entry.store || '리포트', '');
  paintEntry(box, entry);
  bindEntry(box, () => entry, { inModal: true, onStatus: () => paintEntry(box, entry) });
}


/** 첨부 중 영상인 것에 ▶ 표시를 붙인다 (알아 온 뒤 조용히 갱신). */
async function markVideos(links, root) {
  const ids = links.map((l) => l.id).filter(Boolean);
  if (!ids.length) return;
  let known;
  try { known = await describeFiles(ids); } catch { return; }
  links.forEach((l, i) => {
    const info = known[l.id];
    if (!info) return;
    l.isVideo = info.isVideo;
    if (info.name) l.name = info.name;
    if (!info.isVideo) return;
    const tile = root.querySelector(`[data-act="view"][data-idx="${i}"]`);
    if (tile && !tile.querySelector('.media-tile__play')) {
      const badge = document.createElement('span');
      badge.className = 'media-tile__play';
      badge.textContent = '▶';
      tile.appendChild(badge);
    }
  });
}

/**
 * 첨부 전체 화면 뷰어 — 좌우로 넘겨 본다.
 *
 * 드라이브를 새 창으로 여는 것보다 현장에서 빠르다.
 * 원본(드라이브)으로 나가는 길도 남겨 둔다.
 */
export function openViewer(links, start = 0) {
  let at = Math.max(0, Math.min(start, links.length - 1));

  const root = document.createElement('div');
  root.className = 'viewer';
  root.tabIndex = -1;
  document.body.appendChild(root);
  document.body.style.overflow = 'hidden';

  function close() {
    root.remove();
    document.body.style.overflow = '';
    document.removeEventListener('keydown', onKey);
  }
  function go(step) {
    at = (at + step + links.length) % links.length;
    draw();
  }
  function onKey(ev) {
    if (ev.key === 'Escape') close();
    if (ev.key === 'ArrowLeft') go(-1);
    if (ev.key === 'ArrowRight') go(1);
  }

  function draw() {
    const l = links[at];
    root.innerHTML = `
      <div class="viewer__bar">
        <span class="viewer__label">${l.isVideo ? ' ' : ''}${h(l.name || l.label)}</span>
        <span class="viewer__count tnum">${at + 1} / ${links.length}</span>
        <span class="spacer"></span>
        <a class="btn btn--ghost btn--sm" href="${h(l.url)}" target="_blank"
           rel="noopener">드라이브에서 열기 ↗</a>
        <button class="btn btn--ghost btn--icon" data-act="close" type="button"
                aria-label="닫기">✕</button>
      </div>
      <div class="viewer__stage">
        ${links.length > 1 ? '<button class="viewer__nav viewer__nav--prev" data-act="prev" type="button" aria-label="이전">‹</button>' : ''}
        ${!l.id
          ? '<div class="viewer__fallback">미리보기를 만들 수 없는 형식입니다.</div>'
          : l.isVideo
            // 영상은 드라이브 재생기를 그대로 띄운다. 사진처럼 한 장면만
            // 보여 주면 현장에서 확인할 수가 없다.
            ? `<iframe class="viewer__frame" src="${h(previewUrl(l.id))}"
                       allow="autoplay; fullscreen" allowfullscreen
                       title="${h(l.label)}"></iframe>`
            : `<img class="viewer__img" src="${h(thumbUrl(l.id, 1600))}" alt="${h(l.label)}"
                    data-drive="${h(l.id)}" data-drive-size="full"
                    onerror="this.classList.add('is-broken')" />
               <div class="viewer__fallback">사진을 불러오고 있습니다…<br />
                 오래 걸리면 위의 [드라이브에서 열기] 로 원본을 볼 수 있습니다.</div>`}
        ${links.length > 1 ? '<button class="viewer__nav viewer__nav--next" data-act="next" type="button" aria-label="다음">›</button>' : ''}
      </div>`;
    reviveBrokenThumbs(root);
  }

  root.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-act]');
    if (!btn) {
      if (ev.target === root || ev.target.classList.contains('viewer__stage')) close();
      return;
    }
    if (btn.dataset.act === 'close') close();
    if (btn.dataset.act === 'prev') go(-1);
    if (btn.dataset.act === 'next') go(1);
  });
  document.addEventListener('keydown', onKey);
  draw();
  root.focus();
}



/** 연도는 위 월 선택기에 이미 있으므로 줄에는 월-일만 보여 준다. */
const shortDate = (value) => {
  const text = String(value || '');
  return text.length >= 10 ? text.slice(5) : (text || '-');
};

/**
 * 이력 화면 — 구글 시트의 월별 탭이 원본이다.
 *
 * 왼쪽은 목록, 오른쪽은 고른 건의 상세(로봇 · 증상 · 조치 · 사진). 위쪽 칩이 상태별
 * 건수이자 필터다. 좁은 화면에서는 줄을 누르면 상세를 창으로 띄운다.
 * 주소의 ?q= 는 검색어, ?open= 은 바로 열 건 (홈의 최근 기록에서 넘어온다).
 */
const wideHist = () => window.matchMedia('(min-width: 1000px)').matches;

export async function reportListView(view, params = null) {
  loading(view);

  const settings = await api.getSettings();
  if (!settings.sheetsReady) {
    view.innerHTML = `
      <div class="page-head"><h1 class="page-head__title">리포트 이력</h1></div>
      <div class="empty">
        구글 시트 연결이 아직 설정되지 않았습니다.<br />
        <a class="link" href="#/settings">설정</a> 에서 웹 앱 URL 을 먼저 등록하세요.
      </div>`;
    return;
  }

  let months = await api.sheetMonths(false);
  const thisMonth = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  })();
  if (!months.length) months = [thisMonth];
  if (!months.includes(thisMonth)) months = [thisMonth, ...months];

  const openKey = params ? params.get('open') : null;
  let month = (openKey && months.includes(openKey.split('#')[0])) ? openKey.split('#')[0] : months[0];
  let data = { entries: [], fromCache: false, error: null };
  let filter = null;          // null = 전체
  let query = params ? (params.get('q') || '') : '';
  let localItems = [];
  let selectedKey = openKey;

  async function load({ refresh = true } = {}) {
    data = await api.sheetReports(month, refresh);
    const local = await api.listReports();
    // 아직 시트에 올라가지 않은 건은 따로 위에 보여 준다.
    localItems = (local.items || []).filter((r) => r.status !== 'UPLOADED');
  }

  function visible() {
    const q = query.trim().toLowerCase();
    return (data.entries || []).filter((e) => {
      if (filter && e.status !== filter) return false;
      if (!q) return true;
      return [e.store, e.date, e.createdAt, e.code, e.summary, e.author]
        .some((v) => String(v || '').toLowerCase().includes(q));
    });
  }

  function counts() {
    const out = {};
    TRACK.forEach((t) => { out[t.value] = 0; });
    (data.entries || []).forEach((e) => {
      if (out[e.status] !== undefined) out[e.status] += 1;
    });
    return out;
  }

  /** 상태 타일 — 전체 + 상태 넷. 상태마다 색이 다르고, 고르면 그 색으로 채운다. */
  function tilesHtml() {
    const c = counts();
    const order = STATUS_ORDER;
    const tile = (value, label, n, cls) => `
      <button class="hist-tile${filter === value ? ' is-on' : ''}" data-act="filter"
              data-value="${h(value || '')}" data-track="${cls}"
              type="button" aria-pressed="${filter === value}">
        <span class="hist-tile__label">${stIcon(cls)}${h(label)}</span>
        <b class="hist-tile__n tnum">${n}</b>
      </button>`;
    return `<div class="hist-chips hist-tiles" role="group" aria-label="상태로 거르기">
      ${tile(null, '전체', (data.entries || []).length, 'all')}
      ${order.map((v) => tile(v, trackOf(v).short, c[v], trackOf(v).cls)).join('')}
    </div>`;
  }

  function rowsHtml() {
    const list = visible();
    if (!list.length) {
      return `<div class="empty">${
        query || filter ? '조건에 맞는 리포트가 없습니다.' : '이 달에 기록된 리포트가 없습니다.'
      }</div>`;
    }
    return `<div class="hist-rows">
      ${list.map((e) => {
        const on = e.key === selectedKey;
        const detail = [e.code, e.summary].filter(Boolean).join(' · ');
        const t = trackOf(e.status);
        const age = ageText(e);
        return `
          <button class="hist-row${on ? ' is-on' : ''}" data-act="open" data-key="${h(e.key)}"
                  data-track="${t.cls}" type="button" aria-pressed="${on}">
            <span class="hist-row__top">
              <span class="hist-row__date tnum">${h(shortDate(e.date))}</span>
              <span class="hist-row__status">${stIcon(t.cls)}${h(t.short)}${age ? ` · ${age}` : ''}</span>
            </span>
            <span class="hist-row__store">${h(e.store || '(식당명 없음)')}</span>
            ${detail ? `<span class="hist-row__sub">${h(detail)}</span>` : ''}
          </button>`;
      }).join('')}
    </div>`;
  }

  function localHtml() {
    if (!localItems.length) return '';
    return `
      <div class="panel panel--warn">
        <strong>아직 시트에 올리지 않은 리포트 ${localItems.length}건</strong>
        <div class="list">
          ${localItems.map((r) => {
            const [cls, label] = STATUS[r.status] || STATUS.DRAFT;
            return `
              <a class="item" href="#/reports/${r.id}">
                <div class="item__body">
                  <div class="item__title">${h(r.title)}</div>
                  <div class="item__sub">${h(when(r.createdAt))}</div>
                </div>
                <span class="${cls}">${label}</span>
                <span class="item__chevron">›</span>
              </a>`;
          }).join('')}
        </div>
      </div>`;
  }

  function paintMeta() {
    const el = $('#histMeta');
    if (!el) return;
    const total = (data.entries || []).length;
    const shown = visible().length;
    el.textContent = (filter || query) ? `${shown} / ${total}건` : `${total}건`;

    const sync = $('#histSync');
    if (sync) {
      sync.textContent = data.fromCache
        ? '받아 둔 내용 표시 중' : `${new Date().toTimeString().slice(0, 5)} 수신`;
    }
  }

  /** 못 받아 왔으면 왜인지 화면에 적는다 — 그냥 비워 두면 원인을 알 수 없다. */
  function noticeHtml() {
    if (data.error && !data.entries.length) {
      return `<div class="hist-note hist-note--bad">시트에서 이력을 받지 못했습니다.
        <div style="margin-top:6px;white-space:pre-wrap;font-weight:400">${h(explainError(data.error))}</div>
      </div>`;
    }
    if (data.fromCache) {
      return '<div class="hist-note">연결이 안 돼 마지막으로 받아 둔 내용을 보여 줍니다.</div>';
    }
    return '';
  }

  const selected = () => (data.entries || []).find((e) => e.key === selectedKey) || null;

  function paintPanel() {
    const panel = $('#histPanel');
    if (!panel) return;
    const entry = selected();
    if (entry) paintEntry(panel, entry);
    else panel.innerHTML = '<div class="hist-panel__empty">왼쪽에서 리포트를 고르면<br />로봇 · 증상 · 조치 · 사진을 여기서 봅니다.</div>';
  }

  /**
   * 화면을 두 겹으로 나눈다.
   *  - 껍데기(renderShell): 검색창·월 선택기. **한 번만 만들고 다시 만들지 않는다.**
   *  - 알맹이(paint): 칩·목록·상세. 검색·필터 때마다 이 부분만 갈아 끼운다.
   *
   * 한 글자 칠 때마다 화면 전체를 다시 그리면 입력 칸이 새로 만들어져
   * 한글 조합이 끊긴다("옥동식" → "ㅇㅗㄱㄷㅗㅇㅅㅣㄱ"). 입력 칸을 그대로 두는 것이
   * 이 문제의 유일한 확실한 해결책이다.
   */
  function renderShell() {
    view.innerHTML = `
      <div id="pageRoot" class="page-stack">
        <div class="page-head">
          <h1 class="page-head__title">리포트 이력</h1>
          <span class="page-head__meta"><span id="histMeta"></span> · <span id="histSync"></span></span>
          <span class="page-head__spacer"></span>
          <select class="select" id="histMonth" aria-label="월 선택"></select>
          <button class="btn btn-secondary" data-act="refresh" type="button">시트에서 받기</button>
        </div>
        <div class="hist-filter">
          <div id="histTop"></div>
          <input class="input hist-search" id="histQ" type="search"
                 placeholder="식당명 · 날짜 (미트로, 08-22)" aria-label="이력 검색" />
        </div>
        <div class="hist-split">
          <section class="hist-list scroll" id="histBody"></section>
          <aside class="hist-panel" id="histPanel" aria-label="고른 리포트"></aside>
        </div>
      </div>`;

    const root = $('#pageRoot');
    root.addEventListener('click', onClick);
    root.addEventListener('change', onChange);
    bindEntry($('#histPanel'), selected, { onStatus: () => paint() });

    const box = $('#histQ');
    box.value = query;
    box.addEventListener('input', () => { query = box.value; paint(); });
    // 조합이 끝나는 순간에도 한 번 더 맞춘다 (일부 기기는 input 이 늦게 온다).
    box.addEventListener('compositionend', () => { query = box.value; paint(); });

    paintMonths();
  }

  function paintMonths() {
    const sel = $('#histMonth');
    if (!sel) return;
    sel.innerHTML = months
      .map((m) => `<option value="${h(m)}">${h(m)}</option>`).join('');
    sel.value = month;
  }

  function paint() {
    const top = $('#histTop');
    const body = $('#histBody');
    if (!top || !body) return;
    // 넓은 화면은 처음부터 한 건을 열어 둔다 — 오른쪽이 비어 있을 이유가 없다.
    if (wideHist() && !selected()) selectedKey = (visible()[0] || {}).key || null;
    top.innerHTML = tilesHtml();
    body.innerHTML = noticeHtml() + localHtml() + rowsHtml();
    paintMeta();
    paintPanel();
  }

  async function onClick(ev) {
    const btn = ev.target.closest('[data-act]');
    if (!btn || btn.closest('#histPanel')) return;     // 상세 안의 버튼은 bindEntry 가 맡는다
    const act = btn.dataset.act;

    if (act === 'filter') {
      const value = btn.dataset.value || null;
      filter = filter === value ? null : value;
      paint();
      return;
    }
    if (act === 'open') {
      selectedKey = btn.dataset.key;
      if (wideHist()) { paint(); return; }
      const entry = selected();
      if (entry) showSheetEntry(entry);
      return;
    }
    if (act === 'refresh') {
      btn.disabled = true;
      btn.textContent = '받는 중…';
      months = await api.sheetMonths(true);
      if (!months.includes(month)) months = [month, ...months];
      await load({ refresh: true });
      paintMonths();
      paint();
      btn.disabled = false;
      btn.textContent = '시트에서 받기';
      toast(data.fromCache ? '연결이 안 돼 기존 내용을 유지합니다.' : '시트에서 받았습니다.',
            data.fromCache ? 'err' : 'ok');
    }
  }

  async function onChange(ev) {
    const el = ev.target;
    if (el.id === 'histMonth') {
      month = el.value;
      filter = null;
      selectedKey = null;
      // 검색창을 살려 두기 위해 목록 자리에만 안내를 띄운다.
      const body = document.querySelector('#histBody');
      if (body) body.innerHTML = '<div class="skeleton">불러오는 중…</div>';
      await load({ refresh: true });
      paint();
    }
  }

  renderShell();
  paint();
  // 받아 둔 것이 있으면 그것으로 **먼저 보여 준다.** 시트에 다시 물어보는 데는
  // 몇 초가 걸리는데, 그 동안 빈 화면을 보고 기다릴 이유가 없다.
  await load({ refresh: false });
  paintMonths();
  paint();
  // 홈에서 한 건을 골라 왔으면 좁은 화면에서도 바로 연다.
  if (openKey && !wideHist() && selected()) showSheetEntry(selected());

  // 그런 다음 조용히 최신본을 받아 온다. 화면 전환을 여기서 붙잡지 않는다.
  //
  // 방금 받은 것은 다시 받지 않는다. 화면을 옮길 때마다 부르면 현장 LTE 에서
  // 왕복이 1~3초라, 들어간 화면이 잠시 뒤 한 번 더 그려져 덜컥거린다.
  const openedAt = month;
  const age = data.fetchedAt ? Date.now() - new Date(data.fetchedAt).getTime() : Infinity;
  if (age < 60000) return;

  const before = listSignature(data.entries);
  (async () => {
    try { await load({ refresh: true }); } catch { return; }
    // 그 사이 다른 화면으로 넘어갔거나 다른 달을 골랐으면 손대지 않는다.
    if (!view.querySelector('#histQ') || month !== openedAt) return;
    // 시트 내용이 그대로면 다시 그리지 않는다 — 괜히 화면이 깜빡인다.
    if (listSignature(data.entries) === before) return;
    paintMonths();
    paint();
  })();
}

/** 목록이 지난번과 같은지 비교할 때만 쓰는 짧은 요약. */
function listSignature(entries) {
  return (entries || [])
    .map((e) => [e.sheetName, e.row, e.status, e.store, e.createdAt,
                 (e.links || []).length].join('|'))
    .join(String.fromCharCode(10));
}

// ------------------------------------------------------------ 상세 화면
export async function reportDetailView(view, reportId) {
  loading(view);
  const [report, settings] = await Promise.all([
    api.getReport(reportId), api.getSettings(),
  ]);
  const sheetsReady = !!settings.sheetsReady;
  const [cls, label] = STATUS[report.status] || STATUS.DRAFT;

  view.innerHTML = `
    <div id="pageRoot">
      <div class="page-head">
        <div>
          <h1 class="page-head__title">${h(report.title)}</h1>
        </div>
        <span class="page-head__meta">
          <span class="${cls}">${label}</span> · ${h(when(report.createdAt))}
        </span>
        <span class="page-head__spacer"></span>
        ${report.sheetName ? `<p class="muted">구글 시트 <strong>${h(report.sheetName)}</strong> 시트 ${report.sheetRow || '-'}행
          ${settings.spreadsheetUrl ? `· <a class="link" href="${h(settings.spreadsheetUrl)}" target="_blank" rel="noopener">스프레드시트 열기 ↗</a>` : ''}</p>` : ''}
        ${report.errorMessage ? `<p style="color:var(--color-danger);white-space:pre-wrap">${h(report.errorMessage)}</p>` : ''}
      </div>

      <div class="row" style="margin-bottom:16px">
        <button class="btn btn--primary btn--sm" data-act="upload" type="button">
          ${report.status === 'UPLOADED' ? ' 구글 시트에 다시 업로드' : ' 구글 시트로 업로드'}
        </button>
        <button class="btn btn--ghost btn--sm" data-act="share" type="button">공유</button>
        <button class="btn btn--ghost btn--sm" data-act="copy" type="button">텍스트 복사</button>
        <div class="spacer"></div>
        <button class="btn btn--danger btn--sm" data-act="del" type="button">삭제</button>
      </div>

      <div class="panel">
        ${(report.payload || []).map((item) => `
          <div class="field">
            <label>${h(item.label)}</label>
            ${item.type === 'MEDIA'
              ? ((item.media || []).length
                ? `<div class="media-grid">${item.media.map((m) => `
                    <a class="media-tile" data-media="${h(m.url)}" href="#" target="_blank" rel="noopener">
                      ${(m.mime || '').startsWith('video/')
                        ? `<video data-media="${h(m.url)}" muted playsinline></video>`
                        : `<img data-media="${h(m.url)}" alt="${h(m.originalName || '')}" loading="lazy" />`}
                      <div class="media-tile__name">${h(m.originalName || m.filename)}</div>
                    </a>`).join('')}</div>`
                : '<p class="muted">첨부 없음</p>')
              : `<div class="sub-card" style="white-space:pre-wrap">${h(item.value || '-')}</div>`}
          </div>`).join('')}
      </div>
    </div>`;

  hydrateMedia(view);   // 첨부는 기기 안 파일에서 꺼낸다 (APK 에서 액박 방지)

  $('#pageRoot').addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;

    if (act === 'upload') {
      if (report.status === 'UPLOADED') {
        const ok = await confirmDialog('다시 업로드',
          '이미 업로드된 리포트입니다. 구글 시트에 같은 내용이 한 줄 더 추가됩니다.',
          '업로드', false);
        if (!ok) return;
      }
      btn.disabled = true;
      btn.textContent = '업로드 중…';
      try {
        const result = await api.uploadReportToSheet(report.id);
        if (result.queued) {
          toast('⏳ 대기열에 넣었습니다. 인터넷에 연결되면 자동으로 올립니다.', 'ok');
        } else {
          toast(`구글 시트 [${result.sheetName}] ${result.row}행에 기록했습니다.`
            + (result.media ? ` (첨부 ${result.media}개 드라이브 저장)` : ''), 'ok');
          (result.mediaSkipped || []).forEach((s) =>
            toast(`첨부 제외: ${s.filename} (${s.reason})`, 'err'));
          warnPrivateVideo(result);
        }
        reportDetailView(view, report.id);
      } catch (err) {
        toast(err.message, 'err');
        btn.disabled = false;
        btn.textContent = ' 구글 시트로 업로드';
      }
    }
    if (act === 'share') {
      await shareReport(report);
    }
    if (act === 'copy') {
      const ok = await copyText(reportToText(report));
      toast(ok ? '리포트 내용을 복사했습니다.' : '복사에 실패했습니다.', ok ? 'ok' : 'err');
    }
    if (act === 'del') {
      const ok = await confirmDialog('리포트 삭제',
        '이 리포트를 앱에서 삭제합니다. 이미 업로드된 구글 시트 내용은 남아 있습니다.',
        '삭제', true);
      if (!ok) return;
      await api.deleteReport(report.id);
      toast('삭제했습니다.', 'ok');
      location.hash = '#/reports';
    }
  });
}

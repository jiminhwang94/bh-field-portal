// 현장 리포트 작성 (동적 폼) / 구글 시트 업로드. 이력 · 상세는 views/history.js
import { api } from '../api.js';
import { MEDIA_FILE_LIMIT, MEDIA_TOTAL_LIMIT, MEDIA_FILE_LIMIT_TEXT, MEDIA_TOTAL_LIMIT_TEXT, preuploadMedia } from '../sheets.js';
import {
  $, closeModal, confirmDialog, copyText, h, hydrateMedia, loading, openSheet, promptDialog,
  toast, when,
} from '../ui.js';
import { reportToText, shareReport } from '../share.js';
import {
  cachedRequestNumbers, describeFiles, explain as explainError, findVisits,
  previewUrl, pullRequestNumbers, thumbUrl,
} from '../reportsheet.js';

import { ICON, SEED_KEY, pastMemoHtml, trackOf, warnPrivateVideo } from './report-common.js';
import { showSheetEntry } from './history.js';
import {
  guidesForCode, parseParts, partsText, findWorks, splitIssues, sameRobot, isIssueLabel,
  cachedEntries, isCodeShaped, normCode, robotPast, serialOf, valueOf,
  issueNames, mergeSymptom, freeSymptom, parse3c, build3c, pastPicks, CAUSE_UNKNOWN,
} from '../insights.js';

// ------------------------------------------------------------ 단계식 (v3.35 A안)
//
// 장갑 낀 현장에서 긴 입력 화면은 어디까지 썼는지 놓친다. 한 화면에 질문 하나씩 묻는다.
// 칸은 **항목 설정** 그대로다 — 이름표로 어느 단계에 둘지 정하고, 모르는 칸은 '조치 · 결과' 로 간다.
// 그래서 항목을 더하거나 이름을 바꿔도 단계가 저절로 따라온다.
// [한 번에 보기] 를 누르면 예전처럼 한 화면에 전부 (수정할 때는 처음부터 이쪽).
const MODE_KEY = 'bh_report_mode';
export const STEPS = [
  { key: 'visit', short: '접수 건', ask: '어느 접수 건인가요?', hint: '접수를 누르면 매장명이 채워집니다' },
  { key: 'robot', short: '로봇', ask: '어느 로봇인가요?', hint: '이 매장에서 본 로봇은 위에서 바로 고릅니다' },
  { key: 'problem', short: '증상', ask: '무엇이 문제인가요?', hint: '증상 칸에서 이슈 유형을 고르고, 오류 코드 · 덧붙일 말을 적습니다' },
  { key: 'photo', short: '사진', ask: '현장 사진을 찍으세요', hint: '사진 · 영상은 여러 장 붙일 수 있습니다' },
  { key: 'cause', short: '원인', ask: '왜 그랬나요?', hint: '증상마다 원인을 고릅니다 · 못 찾았으면 [원인 모름]' },
  { key: 'fix', short: '조치 · 결과', ask: '무엇을 했나요?', hint: '증상마다 조치를 고르고 처리 결과를 고릅니다' },
  { key: 'check', short: '확인', ask: '확인하고 올리기', hint: '빈 필수 칸은 [고치기] 로 그 단계로 갑니다' },
];
const squashLabel = (t) => String(t || '').replace(/\s/g, '');
/** 오늘 날짜로 만든 리포트 번호 예시 — 'P261028-01' (실제 번호는 올릴 때 시트가 차례를 매긴다) */
export function sampleReportNumber(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `P${p(date.getFullYear() % 100)}${p(date.getMonth() + 1)}${p(date.getDate())}-01`;
}
/** 이 칸은 몇 번째 단계에 묻나 — 이름표로 정한다 */
export function stepOf(field) {
  const l = squashLabel(field.fieldLabel);
  if (l.includes('리포트번호') || l.includes('고객사') || l.includes('매장') || l.includes('식당')) return 'visit';
  if (l.includes('시리얼') || l.includes('모델') || l.includes('로봇')) return 'robot';
  if (isIssueLabel(field.fieldLabel) || l.includes('오류코드') || l.includes('증상')) return 'problem';
  if (field.fieldType === 'MEDIA') return 'photo';
  if (l === '원인') return 'cause';
  return 'fix';
}
/** 고르기 칸은 선택지가 이만큼 이하면 큰 버튼으로, 넘으면 목록(셀렉트)으로 */
const CHOICE_MAX = 8;

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
  // 홈의 [이어 쓰기] — 기기에 임시보관된 리포트를 이어서 쓴다 (?draft=아이디)
  const draftId = editMode ? null
    : new URLSearchParams(location.hash.split('?')[1] || '').get('draft');
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
    // dropped = 고치며 ✕ 로 뺀 첨부 — 올리면 시트가 드라이브 휴지통으로 옮긴다 (v3.39)
    if (!Array.isArray(values[f.id].dropped)) values[f.id].dropped = [];
  });

  let reportId = null;   // 기기에 저장한 리포트 (임시보관 · 저절로 저장 · 올리기가 같은 것을 고친다)

  // [이어 쓰기] — 임시보관 리포트의 값 · 첨부를 그대로 채운다. 칸은 아이디로, 없으면 이름표로 맞춘다.
  if (draftId) {
    const draft = await api.getReport(draftId).catch(() => null);
    if (draft && draft.status === 'DRAFT') {
      reportId = draft.id;
      for (const item of draft.payload || []) {
        const f = fields.find((x) => x.id === item.fieldId) || fields.find((x) => x.fieldLabel === item.label);
        if (!f) continue;
        values[f.id].value = item.value || '';
        values[f.id].media = Array.isArray(item.media) ? item.media : [];
        values[f.id].kept = Array.isArray(item.kept) ? item.kept : [];
        values[f.id].dropped = Array.isArray(item.dropped) ? item.dropped : [];
      }
    }
  }

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
        } else if (seeded.model && label.replace(/\s/g, '').includes('로봇모델')) {
          values[f.id].value = seeded.model;
        } else if (seeded.action && label.includes('조치')) {
          values[f.id].value = seeded.action;     // 가이드에서 마친 단계 (v3.35)
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
  // 고객사 리포트 (v3.39) — 접수 카드는 이 칸에서 고른다. 이 칸이 있으면 리포트 번호는
  // 올릴 때 시트가 매긴다 (P + 작성일 + 차례). 없으면(옛 항목 구성) 예전처럼 번호 칸에서 고른다.
  const customerField = fields.find((f) => squashLabel(f.fieldLabel).includes('고객사'));
  const ticketField = customerField || numberField;
  const autoNumber = Boolean(customerField && numberField);
  // 오류 코드를 적으면 그 가이드를 바로 보여 준다 · 사용 부품은 차량 재고에서 고른다
  const codeField = fields.find((f) => f.fieldLabel.replace(/\s/g, '').includes('오류코드'));
  const partsField = fields.find((f) => f.fieldLabel.includes('부품'));
  // 이슈 유형 — 이슈 유형 목록에서 고른다 (v3.31~). 칸 이름 '이슈 유형' (예전 '작업')
  const workField = fields.find((f) => isIssueLabel(f.fieldLabel));
  const modelField = fields.find((f) => f.fieldLabel.replace(/\s/g, '').includes('로봇모델'));
  // 3C — 증상(이슈 유형을 이 칸 안에서 고른다) → 원인 → 조치 (v3.42)
  const symptomField = fields.find((f) => f.fieldLabel.includes('증상'));
  const causeField = fields.find((f) => squashLabel(f.fieldLabel) === '원인');
  const actionField = fields.find((f) => f.fieldLabel.includes('조치') && !squashLabel(f.fieldLabel).includes('처리'));
  // 이슈 유형 목록 (원인 · 조치 목록이 여기 있다) — 고르기 창에서 바뀌면 다시 읽는다
  let workList = workField ? await api.workList() : { cats: [], items: [] };
  const allGuides = codeField || workField ? (await api.listGuides()).items : [];
  const inventory = partsField ? (await api.listInventory()).items : [];
  let reportNumbers = ticketField ? await cachedRequestNumbers() : [];
  let manualNumber = false;   // '직접 입력…' 을 고른 뒤에는 목록으로 되돌리지 않는다

  const sheetsReady = !!settings.sheetsReady;

  // 단계식 상태
  const steps = STEPS.filter((s) => s.key === 'check' || fields.some((f) => stepOf(f) === s.key));
  let mode = 'step';
  try { if (editMode || localStorage.getItem(MODE_KEY) === 'all') mode = 'all'; } catch { /* 기본 단계식 */ }
  let stepAt = 0;
  let savedAt = '';           // 마지막으로 저절로 저장한 시각
  const serialField = fields.find((f) => f.fieldLabel.includes('시리얼'));
  // 같은 로봇의 지난 기록 — 최근 3달 **받아 둔** 이력 (시트에 묻지 않는다 · 뒤에서 한 번 읽는다)
  let pastEntries = [];
  cachedEntries(3).then((list) => { pastEntries = list; paintRobotHints(); repaint3c(); }).catch(() => {});

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
   * 목록이 바뀐 뒤 리포트 번호 칸을 다시 그린다 (그 칸 하나만).
   *
   * 목록과 화면이 어긋나면 안 된다. 고를 것이 없어졌는데 셀렉트가 남아 있으면
   * 골라도 매장명이 안 채워지고, 없는 번호를 고른 것처럼 보인다.
   * 적어 둔 값은 어느 쪽으로 바뀌든 지킨다.
   */
  function repaintNumberField() {
    if (!ticketField) return;
    const box = view.querySelector(`#reportForm [data-field-id="${ticketField.id}"]`);
    if (box) box.outerHTML = fieldHtml(ticketField);   // 적어 둔 값은 values 에 있다
  }

  /**
   * 고객사 리포트를 고르면 그 번호를 **리포트 번호로도** 쓴다 (v3.41). 고객사 리포트가 없으면
   * 리포트 번호를 비워 둔다 — 올릴 때 시트가 그날 쓰인 번호(이 달 탭 · 고객사 시트)를 보고
   * 다음 차례를 붙인다. 이미 시트에 올라간 리포트를 고칠 때 붙어 있던 번호는 바꾸지 않는다.
   */
  let numberFromCustomer = autoNumber && !editingLink
    && String(values[numberField.id].value || '').trim() !== ''
    && values[numberField.id].value === values[customerField.id].value;
  function syncNumberFromCustomer(prev) {
    if (!autoNumber) return;
    const now = String(values[numberField.id].value || '').trim();
    // 사람이 따로 정한 번호(또는 이미 붙은 번호)는 두고, 비었거나 앞서 고객사 번호를 따라간 것만 바꾼다
    if (now && !(numberFromCustomer && now === String(prev || '').trim())) return;
    const next = String(values[customerField.id].value || '').trim();
    values[numberField.id].value = next;
    numberFromCustomer = Boolean(next);
    const box = view.querySelector(`#reportForm [data-field-id="${numberField.id}"]`);
    if (box) box.outerHTML = fieldHtml(numberField);
  }

  /**
   * 리포트 번호 — 접수 건을 큰 카드로 고른다 (매장 · 번호 · 접수 내용).
   * 예전에는 셀렉트 한 줄이라 장갑으로 펼쳐 고르기 어려웠고, 매장이 잘려 보였다.
   */
  function ticketsHtml(field, current) {
    const cut = (t, n) => (t.length > n ? `${t.slice(0, n)}…` : t);
    const known = reportNumbers.some((it) => it.number === current);
    const tile = (number, store, problem) => `
      <button class="ticket${current === number ? ' is-on' : ''}" data-act="pick-number" data-value="${h(number)}"
              type="button" role="radio" aria-checked="${current === number}">
        <b class="ticket__store">${h(store || '(매장 없음)')}</b>
        <span class="ticket__no tnum">${h(number)}</span>
        ${problem ? `<span class="ticket__problem">${h(cut(problem, 44))}</span>` : ''}
      </button>`;
    return `
      <div class="ticket-grid" role="radiogroup" aria-label="${h(field.fieldLabel)}">
        ${autoNumber ? `<button class="ticket ticket--none${current ? '' : ' is-on'}" data-act="pick-number" data-value=""
            type="button" role="radio" aria-checked="${!current}">
            <b class="ticket__store">고객사 리포트 없음</b>
            <span class="ticket__problem">리포트 번호만 저절로 붙습니다</span></button>` : ''}
        ${current && !known ? tile(current, '직접 적은 번호', '') : ''}
        ${reportNumbers.map((it) => tile(it.number, it.store, it.problem)).join('')}
        <button class="ticket ticket--manual" data-act="pick-number" data-value="__manual__" type="button">직접 입력</button>
      </div>`;
  }

  /** 고르기 칸 — 큰 버튼 한 줄. 목록에 없는 옛 값은 잃지 않게 끝에 하나 더 둔다. */
  function choiceHtml(field, opts, current) {
    const extra = current && !opts.includes(current) ? [current] : [];
    return `
      <div class="choice-row" role="radiogroup" aria-label="${h(field.fieldLabel)}">
        ${[...opts, ...extra].map((o) => `
          <button class="choice-btn${current === o ? ' is-on' : ''}" data-act="choose" data-field="${field.id}"
                  data-value="${h(o)}" type="button" role="radio" aria-checked="${current === o}">${h(o)}</button>`).join('')}
      </div>`;
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
    paintRobotHints();
  }

  function fieldHtml(field) {
    const state = values[field.id];
    const label = `<label>${h(field.fieldLabel)}${field.isRequired ? '<span class="req">*</span>' : ''}</label>`;
    // 칸마다 단계 · 아이디를 단다 — 단계식은 지금 단계 칸만 보이고, 칸 찾기는 아이디로 한다
    const tag = `data-field-id="${field.id}" data-step="${stepOf(field)}"`;

    if (field.fieldType === 'MEDIA') {
      return `
        <div class="field field--wide field--media" ${tag}>
          ${label}
          ${mediaPickHtml(field.id)}
          <span class="hint">첨부 ${state.kept.length + state.media.length}개 · 영상 최대 1분 · 파일 ${MEDIA_FILE_LIMIT_TEXT}</span>
          ${state.kept.length || state.media.length ? `
            <div class="media-grid">
              ${state.kept.map((l, i) => keptTile(field.id, l, i)).join('')}
              ${state.media.map((m, i) => mediaTile(field.id, m, i)).join('')}
            </div>` : ''}
        </div>`;
    }
    // 이슈 유형 — 증상 칸 안에서 고른다. 값은 그대로 들고 다닌다 (시트 '이슈 유형' 칸)
    if (workField && symptomField && field.id === workField.id) {
      return `<div class="field" hidden ${tag}>${label}<input type="hidden" data-input="${field.id}" value="${h(state.value)}" /></div>`;
    }
    // 원인 · 조치 — 이슈를 골랐으면 증상마다 한 줄 (아니면 아래의 여러 줄 칸)
    if (is3c(field) && currentIssues().length) return c3Html(field, tag, label);
    if (symptomField && workField && field.id === symptomField.id) {
      return `<div class="field field--wide field--long" ${tag}>${label}
        <textarea class="input textarea textarea--long" data-input="${field.id}"
                  placeholder="덧붙일 말 — 언제부터 · 어떤 상황에서 (선택)">${h(freeSymptom(state.value, currentIssues()))}</textarea></div>`;
    }
    if (field.fieldType === 'TEXTAREA') {
      // 여러 줄 항목은 두 칸을 다 쓴다 (디자인의 .field--wide)
      return `<div class="field field--wide field--long" ${tag}>${label}
        <textarea class="input textarea textarea--long" data-input="${field.id}" placeholder="자세히 기록">${h(state.value)}</textarea></div>`;
    }
    // 리포트 번호 — 고객사 리포트 칸이 있으면 손대지 않는다. 올릴 때 시트가 매긴다 (v3.39).
    // 고치기로 들어왔으면 이미 붙은 번호를 보여 준다.
    if (autoNumber && field.id === numberField.id) {
      const now = String(state.value || '').trim();
      const why = numberFromCustomer ? '고른 고객사 리포트 번호를 그대로 씁니다'
        : now ? '이미 붙은 번호입니다'
          : `고객사 리포트가 없으면 올릴 때 그날 번호를 확인해 붙입니다 · 예) ${h(sampleReportNumber())}`;
      return `<div class="field field--auto-no" ${tag}>${label}
        <div class="auto-no"><b class="auto-no__value tnum">${h(now || '자동')}</b>
          <span class="auto-no__hint">${why}</span></div></div>`;
    }
    // 고객사 리포트(옛 구성에서는 리포트 번호) — 손으로 적지 않고 접수 목록에서 고른다 (목록이 없으면 입력칸).
    if (ticketField && field.id === ticketField.id && reportNumbers.length && !manualNumber) {
      return `<div class="field field--wide field--tickets" ${tag}>${label}
        ${ticketsHtml(field, String(state.value || '').trim())}
        <span class="hint">고르면 매장명이 채워집니다 · 접수 ${reportNumbers.length}건</span></div>`;
    }
    if (field.fieldType === 'DROPDOWN') {
      const opts = (field.options || '').split(',').map((o) => o.trim()).filter(Boolean);
      if (opts.length && opts.length <= CHOICE_MAX) {
        return `<div class="field field--choice" ${tag}>${label}${choiceHtml(field, opts, String(state.value || ''))}</div>`;
      }
      return `<div class="field" ${tag}>${label}
        <select class="select" data-input="${field.id}">
          <option value="">선택하세요</option>
          ${opts.map((o) => `<option value="${h(o)}" ${state.value === o ? 'selected' : ''}>${h(o)}</option>`).join('')}
        </select></div>`;
    }
    const type = field.fieldType === 'NUMBER' ? 'number' : 'text';
    return `<div class="field" ${tag}>${label}
      <input class="input" type="${type}" ${type === 'number' ? 'inputmode="decimal"' : ''}
             data-input="${field.id}" value="${h(state.value)}" /></div>`;
  }

  const cur = () => steps[Math.min(stepAt, steps.length - 1)];
  const stepMode = () => mode === 'step' && fields.length > 0;

  /** 단계 머리 — 진행 막대 · 지금까지 고른 것(누르면 그 단계로) · 질문 */
  function stepperHtml() {
    const s = cur();
    const v = (f) => (f ? String(values[f.id].value || '').trim() : '');
    const model = fields.find((f) => squashLabel(f.fieldLabel).includes('모델'));
    const ctx = [];
    if (stepAt > 0) {
      if (v(storeField)) ctx.push({ step: 'visit', text: v(storeField) });
      const robot = [v(model), v(serialField)].filter(Boolean).join(' · ');
      if (robot && stepAt > steps.findIndex((x) => x.key === 'robot')) ctx.push({ step: 'robot', text: robot });
      if (v(ticketField)) ctx.push({ step: 'visit', text: v(ticketField) });
    }
    return `
      <div class="wz-head">
        <ol class="wz-steps" aria-label="단계">
          ${steps.map((x, i) => `
            <li class="wz-step${i < stepAt ? ' is-done' : ''}${i === stepAt ? ' is-cur' : ''}">
              <button data-act="step-go" data-go="${x.key}" type="button"${i === stepAt ? ' aria-current="step"' : ''}>
                <i></i><span>${i + 1} ${h(x.short)}${i < stepAt ? ' ✓' : ''}</span></button>
            </li>`).join('')}
        </ol>
        ${ctx.length ? `<div class="wz-ctx">
          ${ctx.map((c) => `<button class="wz-ctx__chip" data-act="step-go" data-go="${c.step}" type="button">${h(c.text)}</button>`).join('')}
          <span class="hint">누르면 바꿉니다</span></div>` : ''}
        <div class="wz-ask"><h2>${h(s.ask)}</h2><span>${h(s.hint)}</span>
          <span class="wz-saved" id="wzSaved">${savedAt ? `저절로 저장됨 · ${h(savedAt)}` : ''}</span></div>
      </div>`;
  }

  /** 마지막 단계 — 단계마다 적은 것 · 빈 필수 칸 */
  function checkHtml() {
    const shown = (f) => {
      const st = values[f.id];
      if (f.fieldType === 'MEDIA') return st.media.length + st.kept.length ? `첨부 ${st.media.length + st.kept.length}개` : '';
      return String(st.value || '').trim();
    };
    return `
      <div class="wz-check" data-step="check">
        ${steps.filter((s) => s.key !== 'check').map((s) => {
          const list = fields.filter((f) => stepOf(f) === s.key);
          const missing = list.filter((f) => missingRequired().includes(f));
          return `
            <section class="wz-check__sec${missing.length ? ' is-missing' : ''}">
              <h3>${h(s.short)}${missing.length ? ` <em>필수 ${missing.length}칸 비어 있음</em>` : ''}</h3>
              <dl>${list.map((f) => `<dt>${h(f.fieldLabel)}</dt><dd${!shown(f) && f.isRequired ? ' class="is-empty"' : ''}>${
                shown(f) ? h(shown(f)) : (f.isRequired ? '비어 있음' : '—')}</dd>`).join('')}</dl>
              <button class="btn btn-secondary" data-act="step-go" data-go="${s.key}" type="button">고치기</button>
            </section>`;
        }).join('')}
      </div>`;
  }

  /** 단계식 아래 막대 — 이전 · 몇 번째 · 다음(마지막은 올리기). 올리기 버튼은 늘 하나만 있다 */
  function stepBarHtml() {
    const last = stepAt >= steps.length - 1;
    const next = steps[stepAt + 1];
    return `
      <div class="wz-bar">
        <button class="btn btn-secondary wz-bar__prev" data-act="step-prev" type="button"${stepAt === 0 ? ' disabled' : ''}>‹ 이전</button>
        <span class="wz-bar__count tnum">${stepAt + 1} / ${steps.length}</span>
        ${last
          ? `<button class="btn btn-secondary" data-act="save-draft" type="button">임시보관</button>
             <button class="btn btn-primary wz-bar__next" type="submit">${editingLink ? '시트에 저장' : '구글 시트로 업로드'}</button>`
          : `<button class="btn btn-primary wz-bar__next" data-act="step-next" type="button">다음 · ${h(next.short)} ›</button>
             <button type="submit" hidden>${editingLink ? '시트에 저장' : '구글 시트로 업로드'}</button>`}
      </div>`;
  }

  function render() {
    const step = stepMode();
    view.innerHTML = `
      <div id="pageRoot" class="rf" data-mode="${step ? 'step' : 'all'}" data-cur="${step ? cur().key : ''}">
        <div class="page-head">
          <h1 class="page-head__title">${editingLink ? '리포트 수정' : '새 현장 리포트'}</h1>
          ${editingLink ? `<span class="page-head__meta">${h(editingLink.sheetName)} 시트 <span class="tnum">${editingLink.row}</span>행 수정</span>` : ''}
          ${!sheetsReady ? '<span class="page-head__meta rf-warn">구글 시트 연결이 아직 없습니다 — 설정에서 먼저 연결하세요</span>' : ''}
          <span class="page-head__spacer"></span>
          ${fields.length ? `<button class="btn btn-secondary" data-act="toggle-mode" type="button">${step ? '한 번에 보기' : '단계로 보기'}</button>` : ''}
          <a class="btn btn-secondary" href="#/fields">항목 설정</a>
        </div>

        ${step ? stepperHtml() : ''}
        <div id="robotHints" data-step="robot"></div>
        <div id="pastRobot" data-step="problem"></div>
        <div id="pastVisits" data-step="visit"></div>

        <form id="reportForm" class="report-form" autocomplete="off">
          ${fields.length ? `
            <div class="form-grid">${fields.map(fieldHtml).join('')}</div>
            ${step ? checkHtml() + stepBarHtml() : `
            <div class="form-actions">
              <button class="btn btn-secondary" data-act="save-draft" type="button">임시보관</button>
              <button class="btn btn-primary" type="submit">${editingLink ? '시트에 저장' : '구글 시트로 업로드'}</button>
            </div>`}`
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
      const el = /** @type {HTMLInputElement} */ (ev.target);
      if (el.dataset.c3field) { edit3c(el.dataset.c3field, el.dataset.c3name || '', { memo: el.value }); return; }
      const id = el.dataset.input;
      if (!id) return;
      const prev = values[id].value;
      values[id].value = el.value;
      // 증상 칸 — 보이는 것은 덧붙일 말뿐, 시트에는 이슈 이름 줄 + 덧붙일 말로 간다
      if (symptomField && workField && id === symptomField.id) {
        values[id].value = mergeSymptom(el.value, [], currentIssues());
      }
      if (autoNumber && id === customerField.id) syncNumberFromCustomer(prev);
      if (storeField && id === storeField.id) {
        clearTimeout(visitTimer);
        visitTimer = setTimeout(paintPastVisits, 350);
      }
      if (codeField && id === codeField.id) { paintCodeHelper(); paintPastRobot(); }
      if (partsField && id === partsField.id) paintPartsHelper();
      if (serialField && id === serialField.id) {
        clearTimeout(robotTimer);
        robotTimer = setTimeout(paintRobotHints, 350);
      }
    });
    // 단계식에서 입력칸의 [Enter](자판의 '다음')는 올리기가 아니라 다음 단계다
    root.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter' || !stepMode() || ev.target.tagName !== 'INPUT' || ev.isComposing) return;
      ev.preventDefault();
      goStep(stepAt + 1);
    });
    root.addEventListener('change', (ev) => {
      const id = ev.target.dataset.input;
      if (!id) return;
      if (ticketField && id === ticketField.id && ev.target.value === '__manual__') {
        // 목록에 없는 번호를 적어야 할 때 — 셀렉트를 입력칸으로 바꾼다
        manualNumber = true;
        values[id].value = '';
        repaintNumberField();
        const inp = root.querySelector(`input[data-input="${id}"]`);
        if (inp) inp.focus();
        return;
      }
      values[id].value = ev.target.value;
      // 증상 칸 — 보이는 것은 덧붙일 말뿐이라, 여기서도 이슈 이름 줄을 앞에 붙여 둔다 (input 과 같은 규칙)
      if (symptomField && workField && id === symptomField.id) {
        values[id].value = mergeSymptom(ev.target.value, [], currentIssues());
      }
      if (ticketField && id === ticketField.id) fillStoreFromNumber(ev.target.value);
      if (modelField && id === modelField.id) paintWorkHelper();     // 그 로봇의 가이드로
    });
    $('#reportForm').addEventListener('submit', submit);
    paintPastVisits();
    paintRobotHints();
    mountHelpers();
  }

  /**
   * 단계를 옮긴다. 옮길 때마다 적은 것을 기기에 저절로 담는다 — 매장에서 다른 일을 하다
   * 돌아와도, 앱이 꺼져도 홈의 [이어 쓰기] 로 이어 쓴다.
   */
  function goStep(i) {
    const next = Math.max(0, Math.min(steps.length - 1, i));
    if (next === stepAt) return;
    stepAt = next;
    autosave();
    render();
    view.scrollTop = 0;
    window.scrollTo(0, 0);
  }

  async function autosave() {
    if (editingLink) return;      // 수정은 시트 줄을 고치는 일이라 기기 임시보관을 만들지 않는다
    const any = fields.some((f) => String(values[f.id].value || '').trim() || values[f.id].media.length);
    if (!any) return;
    const saved = await persist({ requireComplete: false });
    if (!saved) return;
    savedAt = new Date().toTimeString().slice(0, 5);
    const el = document.getElementById('wzSaved');
    if (el) el.textContent = `저절로 저장됨 · ${savedAt}`;
  }

  // ─── 로봇 단계 · 문제 단계의 '지난번' (v3.35) ─────────────────────────────
  let robotTimer = null;
  /** 이 매장에서 본 로봇 — 누르면 시리얼 · 모델이 한 번에 채워진다 */
  async function paintRobotHints() {
    const box = document.getElementById('robotHints');
    if (box) {
      const store = storeField ? String(values[storeField.id].value || '').trim() : '';
      const visits = store ? await findVisits(store, 12) : [];
      const seen = new Map();
      for (const e of visits) {
        const serial = serialOf(e);
        if (serial && !seen.has(serial)) seen.set(serial, valueOf(e, '모델'));
      }
      const mine = serialField ? String(values[serialField.id].value || '').trim() : '';
      box.innerHTML = seen.size ? `
        <div class="robot-hints">
          <span class="robot-hints__label">${h(store)}에서 본 로봇</span>
          ${[...seen].map(([serial, model]) => `
            <button class="robot-hint${mine === serial ? ' is-on' : ''}" data-act="pick-robot" data-serial="${h(serial)}"
                    data-model="${h(model)}" type="button"><b class="tnum">${h(serial)}</b>${model ? `<span>${h(model)}</span>` : ''}</button>`).join('')}
        </div>` : '';
    }
    paintPastRobot();
    paintCodeHelper();
  }

  /** 같은 로봇의 지난 기록 — 문제 단계 위에. 같은 코드가 또 나왔으면 맨 위 한 줄로 */
  function robotPastNow() {
    const serial = serialField ? String(values[serialField.id].value || '').trim() : '';
    return robotPast(pastEntries, serial);
  }
  function paintPastRobot() {
    const box = document.getElementById('pastRobot');
    if (!box) return;
    const past = robotPastNow();
    const code = codeField ? String(values[codeField.id].value || '').trim() : '';
    const same = isCodeShaped(code) ? past.filter((e) => normCode(e.code) === normCode(code)).length : 0;
    box.innerHTML = pastMemoHtml(past, { code, nth: same ? same + 1 : 0, link: false, max: 2 });
  }

  // ─── 오류 코드 → 가이드 · 사용 부품 ← 차량 재고 ───────────────────────────
  const MY_VEHICLE_KEY = 'bh_my_vehicle';
  function fieldBox(field) {
    return field ? document.querySelector(`#reportForm [data-field-id="${field.id}"]`) : null;
  }
  function mountHelpers() {
    const codeBox = fieldBox(codeField);
    if (codeBox && !codeBox.querySelector('.field-helper')) {
      codeBox.insertAdjacentHTML('beforeend', '<div class="field-helper" id="codeHelper"></div>');
      paintCodeHelper();
    }
    // 이슈 유형은 증상 칸 안에서 고른다 (v3.42) — 증상 칸이 없는 옛 구성만 따로 둔다
    const workBox = symptomField ? fieldBox(symptomField) : fieldBox(workField);
    if (workField && workBox && !workBox.querySelector('#workHelper')) {
      // 증상 칸은 덧붙일 말 칸을 살려 둔다 (옛 이슈 유형 칸은 글자칸 대신 고른 결과만)
      workBox.classList.add(symptomField ? 'field--symptom' : 'field--work');
      const label = workBox.querySelector('label');
      if (label) label.insertAdjacentHTML('afterend', '<div class="field-helper" id="workHelper"></div>');
      else workBox.insertAdjacentHTML('beforeend', '<div class="field-helper" id="workHelper"></div>');
      paintWorkHelper();
    }
    const partsBox = fieldBox(partsField);
    if (partsBox && inventory.length && !partsBox.querySelector('.field-helper')) {
      partsBox.classList.add('field--parts');      // 글자칸 대신 알약 + [부품 추가]
      partsBox.insertAdjacentHTML('beforeend', '<div class="field-helper" id="partsHelper"></div>');
      paintPartsHelper();
    }
  }
  /** 이슈 유형 칸 — 고른 것마다 한 줄(✕) · [이슈 유형 고르기] · 이어 둔 가이드. 여러 개 고를 수 있다 (v3.34) */
  async function paintWorkHelper() {
    const box = $('#workHelper');
    if (!box || !workField) return;
    const value = values[workField.id].value;
    const texts = splitIssues(value);
    const items = findWorks(value, await api.workList());
    const model = modelField ? values[modelField.id].value : '';
    const linked = allGuides.filter((g) => items.some((it) => it.guides.includes(g.id)));
    const mine = linked.filter((g) => !g.robotModel || !model || sameRobot(model, g.robotModel));
    box.innerHTML = `
      <div class="work-field">
        ${texts.map((t, i) => `<span class="work-pill" title="${h(t)}"><span>${h(t)}</span>
          <button class="part-pill__x" data-act="work-clear" data-i="${i}" type="button"
                  aria-label="${h(t.split('›').pop().trim())} 빼기">✕</button></span>`).join('')}
        <button class="parts-add" data-act="open-work" type="button">${texts.length ? '고치기 · 더 고르기' : '＋ 이슈 유형 고르기'}</button>
      </div>
      ${(mine.length ? mine : linked).map((g) => `
        <button class="guide-hint" data-act="peek-guide" data-id="${h(g.id)}" type="button">
          <b>가이드</b> ${h(g.codeOrTitle)}${g.robotModel ? ` · ${h(g.robotModel)}` : ''} <span aria-hidden="true">보기 ›</span>
        </button>`).join('')}`;
  }
  /** 칸에는 한 줄에 하나씩 — 시트 칸에서도 줄을 바꿔 보인다 */
  function setWork(paths) {
    const text = paths.join(String.fromCharCode(10));     // 줄바꿈 — 글자로 쓰면 편집 도구가 진짜 줄바꿈으로 바꾼다
    const before = issueNames(values[workField.id].value);
    values[workField.id].value = text;
    const input = /** @type {HTMLInputElement} */ (document.querySelector(`#reportForm [data-input="${workField.id}"]`));
    if (input) input.value = text;
    // 증상 칸 — 시트에는 고른 이슈 이름 줄 + 덧붙일 말 (화면에는 덧붙일 말만)
    if (symptomField) values[symptomField.id].value = mergeSymptom(values[symptomField.id].value, before, issueNames(text));
    paintWorkHelper();
    // 고르기 창에서 새 이슈를 만들었을 수 있다 — 목록을 다시 읽고 원인 · 조치 칸을 그 이슈로 다시 그린다
    api.workList().then((l) => { workList = l; repaint3c(); }).catch(() => repaint3c());
  }

  /** 지금 고른 이슈 이름들 (원인 · 조치 칸의 줄) */
  const currentIssues = () => (workField ? issueNames(values[workField.id].value) : []);

  // ─── 원인 · 조치 — 증상마다 한 줄, 그 이슈의 목록에서 고른다 (v3.42 · 3C) ───────
  const is3c = (field) => Boolean(field && workField && (field === causeField || field === actionField));
  const kindOf3c = (field) => (field === causeField ? '원인' : '조치');

  /** 이 이슈에서 고를 것 — 팀 목록 + 지난번에 고른 것 + 이번에 고른 것 (+ 원인 모름) */
  function optionsFor(field, name, picks) {
    const item = findWorks(name, workList)[0];
    const team = item ? (field === causeField ? item.causes : item.actions) || [] : [];
    const past = (pastPicks(pastEntries, [name], kindOf3c(field))[name]) || [];
    const all = [...team, ...past, ...picks];
    if (field === causeField) all.push(CAUSE_UNKNOWN);
    return [...new Set(all.filter(Boolean))];
  }

  function c3Html(field, tag, label) {
    const names = currentIssues();
    const { rows, extra } = parse3c(values[field.id].value, names);
    const multi = field === actionField;
    const rowHtml = (name, i) => {
      const r = rows[name];
      return `
        <div class="c3-row">
          <div class="c3-row__head"><span class="c3-row__no tnum">${i + 1}</span><b class="c3-row__name">${h(name)}</b></div>
          <div class="c3-chips" role="${multi ? 'group' : 'radiogroup'}" aria-label="${h(name)} ${kindOf3c(field)}">
            ${optionsFor(field, name, r.picks).map((o) => {
              const on = r.picks.includes(o);
              return `<button class="c3-chip${on ? ' is-on' : ''}${o === CAUSE_UNKNOWN ? ' c3-chip--unknown' : ''}" type="button"
                        data-act="c3-pick" data-field="${field.id}" data-name="${h(name)}" data-value="${h(o)}"
                        role="${multi ? 'checkbox' : 'radio'}" aria-checked="${on}">${h(o)}</button>`;
            }).join('')}
            <button class="c3-chip c3-chip--add" type="button" data-act="c3-add" data-field="${field.id}"
                    data-name="${h(name)}">＋ 직접</button>
          </div>
          ${multi ? `<input class="input c3-memo" type="text" data-c3field="${field.id}" data-c3name="${h(name)}"
                     value="${h(r.memo)}" placeholder="메모 (선택) — 예) CN3 빠져 있었음" />` : ''}
        </div>`;
    };
    return `<div class="field field--wide field--3c" ${tag}>${label}
      <div class="c3-rows">${names.map(rowHtml).join('')}</div>
      <textarea class="input textarea c3-extra" data-c3field="${field.id}" rows="2"
                placeholder="그 밖의 메모 (선택)">${h(extra)}</textarea></div>`;
  }

  /**
   * 증상 줄 하나를 고친다 — 고르기 (원인은 하나 · 조치는 여러 개) · 메모 · 그 밖의 메모
   * @param {string} fieldId
   * @param {string} name   증상(이슈) 이름. '' 이면 그 밖의 메모 칸
   * @param {{ pick?: string, memo?: string }} [change]
   */
  function edit3c(fieldId, name, { pick = '', memo = undefined } = {}) {
    const field = fields.find((f) => f.id === fieldId);
    if (!field) return;
    const names = currentIssues();
    const { rows, extra } = parse3c(values[field.id].value, names);
    if (!name) {                                       // 그 밖의 메모 칸
      values[field.id].value = build3c(rows, names, memo);
      return;
    }
    const r = rows[name] || (rows[name] = { picks: [], memo: '' });
    if (memo !== undefined) r.memo = memo.trim();
    if (pick) {
      const on = r.picks.includes(pick);
      if (field === causeField) r.picks = on ? [] : [pick];
      else r.picks = on ? r.picks.filter((x) => x !== pick) : [...r.picks, pick];
    }
    values[field.id].value = build3c(rows, names, extra);
  }

  /** 원인 · 조치 칸을 다시 그린다 (고른 이슈가 바뀌었을 때) */
  function repaint3c() {
    for (const field of [causeField, actionField]) {
      if (!field) continue;
      const box = view.querySelector(`#reportForm [data-field-id="${field.id}"]`);
      if (box) box.outerHTML = fieldHtml(field);
    }
  }

  function paintCodeHelper() {
    const box = $('#codeHelper');
    if (!box || !codeField) return;
    const now = String(values[codeField.id].value || '').trim();
    const hits = guidesForCode(now, allGuides);
    // 비어 있으면 이 로봇에서 지난번에 난 코드를 바로 고르게 한다 (자판 없이)
    const codes = now ? [] : [...new Set(robotPastNow().map((e) => e.code).filter(isCodeShaped))].slice(0, 3);
    box.innerHTML = codes.map((c) => `
      <button class="choice-btn choice-btn--hint" data-act="use-code" data-code="${h(c)}" type="button">${h(c)} · 이 로봇 지난번</button>`).join('')
      + hits.map((g) => `
      <button class="guide-hint" data-act="peek-guide" data-id="${h(g.id)}" type="button">
        <b>가이드</b> ${h(g.codeOrTitle)}${g.robotModel ? ` · ${h(g.robotModel)}` : ''} <span aria-hidden="true">보기 ›</span>
      </button>`).join('');
  }
  function myVehicle() {
    const names = [...new Set(inventory.map((i) => i.vehicleName))];
    const saved = localStorage.getItem(MY_VEHICLE_KEY);
    return names.includes(saved) ? saved : names[0] || '';
  }
  // ─── 사용 부품 (B안) — 칸에는 넣은 부품 알약만, [부품 추가] 창에서 분류 · 수량을 고른다
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
  /** 칸 — 넣은 부품 알약(✕ 로 빼기) + [부품 추가] */
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
        <button class="parts-add" data-act="open-parts" type="button">＋ 부품 추가</button>
      </div>
      ${list.length ? `<span class="hint">올리면 ${h(myVehicle())} 재고에서 뺍니다</span>` : ''}`;
    const sheetBody = document.getElementById('partsSheet');
    if (sheetBody) paintPartsSheet(sheetBody);
  }
  /** [부품 추가] 창 — 차량 · 분류 탭(고른 것만) · 품목마다 −/+ · 목록에 없는 부품 */
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
          <button class="btn btn-secondary btn--sm" data-act="cats-done" type="button">선택</button>
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
      <button class="btn btn-primary btn--block" data-act="close" type="button">추가</button>`;
  }
  function openPartsSheet() {
    catPicking = false;
    openSheet('부품 추가', '<div id="partsSheet" class="parts-sheet"></div>');
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
      dropped: values[field.id].dropped,
    }));
  }

  function missingRequired() {
    return fields.filter((f) => {
      if (!f.isRequired) return false;
      if (autoNumber && f.id === numberField.id) return false;        // 올릴 때 시트가 매긴다
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
        preuploadMedia(media.filename);     // 쓰는 동안 뒤에서 미리 올린다 — [업로드] 때는 마무리만 (v3.33)
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
    // ── 단계식 · 큰 버튼 고르기 (v3.35)
    if (act === 'step-next') { goStep(stepAt + 1); return; }
    if (act === 'step-prev') { goStep(stepAt - 1); return; }
    if (act === 'step-go') { goStep(steps.findIndex((s) => s.key === btn.dataset.go)); return; }
    if (act === 'toggle-mode') {
      mode = stepMode() ? 'all' : 'step';
      try { localStorage.setItem(MODE_KEY, mode); } catch { /* 이번만 */ }
      render();
      return;
    }
    if (act === 'pick-number') {
      const value = btn.dataset.value;
      if (value === '__manual__') {
        // 목록에 없는 번호를 적어야 할 때 — 카드 대신 입력칸
        manualNumber = true;
        values[ticketField.id].value = '';
        repaintNumberField();
        const inp = /** @type {HTMLInputElement} */ (view.querySelector(`input[data-input="${ticketField.id}"]`));
        if (inp) inp.focus();
        return;
      }
      const prev = values[ticketField.id].value;
      values[ticketField.id].value = value;
      repaintNumberField();
      syncNumberFromCustomer(prev);
      fillStoreFromNumber(value);
      return;
    }
    if (act === 'c3-pick') {
      edit3c(btn.dataset.field, btn.dataset.name || '', { pick: btn.dataset.value || '' });
      const field = fields.find((f) => f.id === btn.dataset.field);
      if (field) {
        const box = view.querySelector(`#reportForm [data-field-id="${field.id}"]`);
        if (box) box.outerHTML = fieldHtml(field);
      }
      return;
    }
    if (act === 'c3-add') {
      const field = fields.find((f) => f.id === btn.dataset.field);
      const name = btn.dataset.name || '';
      if (!field) return;
      const kind = kindOf3c(field);
      const text = String((await promptDialog(`${name} — ${kind} 직접 적기`, {
        label: `목록에 없는 ${kind}. 적으면 팀 목록에도 더해집니다.`, okLabel: '넣기',
      })) || '').trim();
      if (!text) return;
      edit3c(field.id, name, { pick: text });
      const item = findWorks(name, workList)[0];
      if (item) {
        api.learnWork(item.id, field === causeField ? { causes: [text] } : { actions: [text] })
          .then((l) => { workList = l; }).catch(() => {});
      }
      const box = view.querySelector(`#reportForm [data-field-id="${field.id}"]`);
      if (box) box.outerHTML = fieldHtml(field);
      return;
    }
    if (act === 'choose') {
      const id = btn.dataset.field;
      const value = values[id].value === btn.dataset.value ? '' : btn.dataset.value;   // 한 번 더 누르면 뺀다
      values[id].value = value;
      btn.parentElement.querySelectorAll('[data-act="choose"]').forEach((b) => {
        const on = /** @type {HTMLElement} */ (b).dataset.value === value;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-checked', String(on));
      });
      if (modelField && id === modelField.id) paintWorkHelper();     // 그 로봇의 가이드로
      return;
    }
    if (act === 'pick-robot') {
      if (serialField) values[serialField.id].value = btn.dataset.serial;
      if (modelField && btn.dataset.model) values[modelField.id].value = btn.dataset.model;
      render();
      return;
    }
    if (act === 'use-code') {
      values[codeField.id].value = btn.dataset.code;
      const inp = /** @type {HTMLInputElement} */ (view.querySelector(`[data-input="${codeField.id}"]`));
      if (inp) inp.value = btn.dataset.code;
      paintCodeHelper();
      paintPastRobot();
      return;
    }
    if (act === 'peek-guide') { peekGuide(btn.dataset.id); return; }
    if (act === 'open-parts') { openPartsSheet(); return; }
    if (act === 'open-work') {
      const { openWorkPicker } = await import('../workpicker.js');
      openWorkPicker({ value: values[workField.id].value, robotModel: modelField ? values[modelField.id].value : '',
                       onPick: async (paths) => {
                         // 목록에 없는 옛 글자(손으로 적은 것)는 지우지 않고 둔다 — ✕ 로만 뺀다
                         const list = await api.workList();
                         const keep = splitIssues(values[workField.id].value).filter((t) => !findWorks(t, list).length);
                         setWork([...keep, ...paths]);
                       } });
      return;
    }
    if (act === 'work-clear') {
      setWork(splitIssues(values[workField.id].value).filter((_, i) => i !== Number(btn.dataset.i)));
      return;
    }
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
      const [gone] = values[btn.dataset.field].kept.splice(Number(btn.dataset.idx), 1);
      if (gone) values[btn.dataset.field].dropped.push(gone);
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
        toast('기기에 저장했습니다. 홈의 [이어 쓰기] 로 다시 열 수 있습니다.', 'ok');
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
      // 단계식이면 빈 칸이 어느 단계인지 보이는 [확인] 단계로 데려간다
      if (stepMode() && missingRequired().length) goStep(steps.length - 1);
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
        toast((result.reportNumber ? `리포트 번호 ${result.reportNumber} · ` : '')
          + `구글 시트 [${result.sheetName}] ${result.row}행에 기록했습니다.`
          + (result.media ? ` (첨부 ${result.media}개 공유 드라이브 저장)` : '')
          + (result.mediaTrashed ? ` 뺀 사진·영상 ${result.mediaTrashed}개는 드라이브 휴지통으로 옮겼습니다.` : ''), 'ok');
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
  if (ticketField && sheetsReady) {
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
    ${g.requiredTools ? `<p class="muted">준비 · ${h(g.requiredTools)}</p>` : ''}
    <ol class="peek-steps">${(g.steps || []).map((st) => `<li>${h(st.instruction)}</li>`).join('')}</ol>
    ${(g.commands || []).length ? `<div class="peek-cmds">${g.commands.map((c) => `<code>${h(c.cmd)}</code>`).join('')}</div>` : ''}
    <p class="muted">가이드 전체는 리포트를 올린 뒤 [가이드] 에서 볼 수 있습니다.</p>`);
}

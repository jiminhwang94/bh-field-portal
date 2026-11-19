// 새 리포트 화면의 조각들 — 화면 상태를 쓰지 않는 것만 (v3.49)
//
// report.js 의 reportFormView 는 함수 하나가 1,450줄이었다. 그 안에서 화면 상태(values · 단계 …)를
// 쓰지 않는 그리기 · 날짜 · 사진 줄이기 · 크기 검사를 여기로 옮겼다. 같은 글자를 그대로 옮겼다.
import { MEDIA_FILE_LIMIT, MEDIA_TOTAL_LIMIT, MEDIA_FILE_LIMIT_TEXT, MEDIA_TOTAL_LIMIT_TEXT } from '../sheets.js';
import { thumbUrl } from '../reportsheet.js';
import { h } from '../ui.js';
import { ICON } from './report-common.js';

const ICON_CAMERA = ICON('<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>');
const ICON_VIDEO = ICON('<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/>');
const ICON_ALBUM = ICON('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m3 16 5-5 4 4 3-3 6 6"/><circle cx="16" cy="9" r="1.5"/>');

export function mediaTile(fieldId, media, idx) {
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
export function keptTile(fieldId, link, idx) {
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
export function mediaPickHtml(fieldId) {
  const tile = (act, label, icon) => `
    <button class="media-pick__tile" data-act="${act}" data-field="${fieldId}" type="button">
      ${icon}<span>${label}</span></button>`;
  return `<div class="media-pick">
    ${tile('capture', '사진 촬영', ICON_CAMERA)}
    ${tile('record', '영상 촬영', ICON_VIDEO)}
    ${tile('pick', '앨범 · 파일', ICON_ALBUM)}
  </div>`;
}

/** 고르기 칸 — 큰 버튼 한 줄. 목록에 없는 옛 값은 잃지 않게 끝에 하나 더 둔다. */
export function choiceHtml(field, opts, current) {
  const extra = current && !opts.includes(current) ? [current] : [];
  return `
    <div class="choice-row" role="radiogroup" aria-label="${h(field.fieldLabel)}">
      ${[...opts, ...extra].map((o) => `
        <button class="choice-btn${current === o ? ' is-on' : ''}" data-act="choose" data-field="${field.id}"
                data-value="${h(o)}" type="button" role="radio" aria-checked="${current === o}">${h(o)}</button>`).join('')}
    </div>`;
}

/** 지금 시각 'YYYY-MM-DDTHH:MM' (datetime-local 칸 모양) */
export const nowLocal = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
/** '2026-11-05T14:00' → '11월 5일 (목) 14:00' */
export const whenText = (v) => {
  const [d, t] = String(v).split('T');
  const [y, m, day] = d.split('-').map(Number);
  return `${m}월 ${day}일 (${WEEK[new Date(y, m - 1, day).getDay()]}) ${t || ''}`.trim();
};

/**
 * 태블릿 사진은 3~5MB 나 되므로, 올리기 전에 가로/세로 최대 1600px 로 줄인다.
 * 화면 확인과 시트 삽입에는 충분하고 업로드가 훨씬 빨라진다.
 */
export async function shrinkImage(file) {
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

const mb = (n) => `${Math.round(n / 1048576)}MB`;

/**
 * 파일이 시트로 올라갈 수 있는 크기인지 **고르는 순간** 확인한다.
 * 넘으면 이유를 돌려준다. 예전에는 저장할 때 조용히 건너뛰어서, 현장에서
 * 찍은 동영상이 빠진 것을 사무실에서야 알았다.
 */
export function tooBigReason(file, attached) {
  const isVideo = (file.type || '').startsWith('video/');
  const what = isVideo ? '이 동영상은' : '이 파일은';
  if (file.size > MEDIA_FILE_LIMIT) {
    return `${what} ${mb(file.size)} 라 올릴 수 없습니다 (파일당 ${MEDIA_FILE_LIMIT_TEXT} 까지).`
      + (isVideo ? ' 짧게 다시 찍거나 낮은 화질로 찍어 주세요.' : '');
  }
  if (attached + file.size > MEDIA_TOTAL_LIMIT) {
    return `${what} 더하면 리포트 전체가 ${MEDIA_TOTAL_LIMIT_TEXT} 를 넘습니다`
      + ` (지금 ${mb(attached)} + ${mb(file.size)}). 첨부를 하나 빼거나 리포트를 나눠 주세요.`;
  }
  return '';
}

// 리포트 작성 화면과 이력 화면이 함께 쓰는 것 — 상태 4종 · 아이콘 · 지난 기록을 새 리포트로 넘기기.
// (작성: views/report.js · 이력: views/history.js. 서로를 부르지 않게 공통은 여기 둔다)
import { h, toast } from '../ui.js';
import { normCode, pastStory } from '../insights.js';

export const SEED_KEY = 'bh_report_seed';   // [수정] · [이 매장 새 리포트] · 가이드 [리포트 쓰기] 가 넘기는 값

/**
 * '이 로봇 지난번' 메모 (v3.35) — 이력 상세 · 가이드 · 새 리포트가 같은 모양을 쓴다.
 *
 * 같은 오류 코드가 또 나왔으면 맨 위 한 줄로 먼저 말한다. 반복은 지난번 조치가
 * 근본 원인을 못 고쳤다는 신호라, 현장에서 가장 먼저 알아야 한다.
 *
 * @param {any[]} past  같은 로봇의 지난 기록 (robotPast 결과, 최근 것 먼저)
 * @param {{ code?: string, nth?: number, link?: boolean, max?: number }} [opts]
 *   nth  — 이번이 같은 코드로 몇 번째인가 (2 이상이면 경고 줄)
 *   link — 줄을 눌러 그 리포트로 가게 할지 (쓰는 중인 리포트 화면에서는 끈다)
 */
export function pastMemoHtml(past, { code = '', nth = 0, link = true, max = 3 } = {}) {
  if (!past || !past.length) return '';
  const same = code ? past.filter((e) => normCode(e.code) === normCode(code)) : [];
  const last = same[0] ? pastStory(same[0]) : null;
  const item = (e) => {
    const s = pastStory(e);
    const t = trackOf(e.status);
    const inner = `
      <span class="past__date tnum">${h(s.date || '-')}</span>
      <span class="past__body">
        <b>${s.code ? `<span class="past__code">${h(s.code)}</span> ` : ''}${h(s.symptom || '(증상 없음)')}</b>
        ${s.action ? `<span>${h(s.action)}</span>` : ''}
      </span>
      <span class="past__st" data-track="${t.cls}">${h(t.short)}</span>`;
    return link
      ? `<a class="past__item" href="#/reports?open=${encodeURIComponent(e.key)}">${inner}</a>`
      : `<div class="past__item">${inner}</div>`;
  };
  return `
    <section class="past" aria-label="이 로봇 지난번">
      <h3 class="past__title">이 로봇 지난번 <span class="tnum">${past.length}</span>건</h3>
      ${nth >= 2 ? `<p class="past__warn"><b>${h(code)} 이 로봇에서 ${nth}번째입니다.</b>${
        last && last.action ? ` 지난번 조치: ${h(last.action)}` : ''}</p>` : ''}
      <div class="past__list">${past.slice(0, max).map(item).join('')}</div>
    </section>`;
}

export const ICON = (paths) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
  stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

/** 이력의 한 건을 새 리포트의 출발점으로 넘긴다. */
export function seedFromEntry(entry, { edit = false } = {}) {
  sessionStorage.setItem(SEED_KEY, JSON.stringify({
    store: entry.store || '', code: entry.code || '',
    serial: (entry.values.find((v) => v.label.includes('시리얼')) || {}).value || '',
    // 고치기로 들어왔으면 어느 줄을 고쳐 쓸지 함께 넘긴다.
    // 이게 없으면 저장할 때 같은 방문이 두 줄이 된다.
    sheetLink: edit ? { sheetName: entry.sheetName, row: entry.row,
                        createdAt: entry.createdAt || '', store: entry.store || '' } : null,
    values: edit ? entry.values : null,
    // 이미 올라가 있는 사진·영상. 이걸 안 넘기면 저장할 때 시트의 링크가
    // 빈 칸으로 덮여 **드라이브에는 있는데 리포트에서는 사라진다.**
    links: edit ? entry.links.map((l) => ({ label: l.label, url: l.url, id: l.id }))
                : null,
  }));
}

/** 추적 상태 4종 — 시트 '상태' 열의 값과 1:1 로 맞춘다. */
export const TRACK = [
  { value: '조치 완료',    short: '조치 완료', cls: 'done' },
  { value: '모니터링',     short: '모니터링',  cls: 'watch' },
  { value: '조치 진행 중', short: '진행 중',   cls: 'doing' },
  { value: '교체 예정',    short: '교체 예정', cls: 'swap' },
];
export const trackOf = (value) => TRACK.find((t) => t.value === value) || TRACK[2];

/**
 * 동영상이 비공개로 남았으면 알린다.
 *
 * 사진은 공개가 막혀도 앱이 시트를 거쳐 바이트를 받아 그린다. 동영상은 너무
 * 커서 그 길을 못 쓰고 드라이브 재생기로만 본다. 드라이브 재생기는 파일이
 * 공개거나 보는 사람이 로그인돼 있어야 한다. 그래서 이 경우만 따로 말해 준다.
 */
export function warnPrivateVideo(result) {
  if (!result || !result.mediaVideos || !result.mediaPrivate) return;
  toast('동영상이 다른 사람 화면에서 재생되지 않을 수 있습니다 — 드라이브 링크 공개가 '
        + '막혀 있습니다. 관리자에게 알려 주세요.', 'err');
}

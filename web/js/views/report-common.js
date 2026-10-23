// 리포트 작성 화면과 이력 화면이 함께 쓰는 것 — 상태 4종 · 아이콘 · 지난 기록을 새 리포트로 넘기기.
// (작성: views/report.js · 이력: views/history.js. 서로를 부르지 않게 공통은 여기 둔다)
import { toast } from '../ui.js';

export const SEED_KEY = 'bh_report_seed';   // [수정] · [이 매장 새 리포트] 가 넘기는 값

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

// 기기에 담긴 사진을 화면에 띄울 때 만드는 blob: 주소를 돌려준다 (v3.49).
//
// URL.createObjectURL 로 만든 주소는 revokeObjectURL 을 부르기 전까지 사진 한 장 크기의
// 메모리를 붙잡는다. 예전에는 한 번도 돌려주지 않아, 이력 · 가이드를 오래 넘겨 보면
// 메모리가 계속 늘었다. 이제 주소를 그 <img> 에 묶어 두고, 그림이 화면에서 빠지면 돌려준다.

/** blob 주소 → 그 주소를 쓰는 요소 */
const live = new Map();
const SWEEP_AT = 40;              // 이만큼 쌓이면 한 번 훑는다

/** 화면에서 빠진 그림의 주소를 돌려준다. */
export function sweep() {
  for (const [url, el] of live) {
    if (el && el.isConnected) continue;
    URL.revokeObjectURL(url);
    live.delete(url);
  }
}

/**
 * 요소에 blob 주소를 건다. 그 요소가 쓰던 다른 blob 주소는 바로 돌려준다.
 * @param {HTMLImageElement|HTMLVideoElement|HTMLAnchorElement} el
 * @param {string} url
 */
export function attach(el, url) {
  if (!url || !url.startsWith('blob:')) return;
  for (const [old, owner] of live) {
    if (owner === el && old !== url) { URL.revokeObjectURL(old); live.delete(old); }
  }
  live.set(url, el);
  if (live.size > SWEEP_AT) sweep();
}

/** 지금 붙잡고 있는 주소 수 (시험용) */
export const liveCount = () => live.size;

if (typeof window !== 'undefined') {
  // 화면을 옮기면 그 전 화면의 그림은 모두 빠진다 — 그려질 틈을 두고 훑는다
  window.addEventListener('hashchange', () => setTimeout(sweep, 1500));
}

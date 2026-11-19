// 앱 안 [업데이트] — 새 버전이 있으면 상단에 띠를 띄우고, 누르면 받아 설치한다.
//
// 어디서 아나 — 빌드 자동화가 APK 를 Dropbox 에 올린 뒤 시트의 '앱 버전' 탭에
// 한 줄 적는다. 태블릿은 시트를 받아올 때(5분마다·[새로고침]) 함께 물어본다.
// 사람이 개입할 지점은 그 탭이다: '공개' 를 N 으로 바꾸면 안내가 멈춘다.
//
// 어떻게 받나 — APK 안이면 bhupdate:<주소> 로 안드로이드 쪽에 넘겨 시스템
// 다운로드 관리자가 받고 설치 화면을 연다.
//
// 브라우저(PC 의 http://localhost:8787 등)는 다르다 (v3.49). 화면 파일은 그 주소를 내주는
// 폴더에서 온다 — APK 를 받아 봐야 소용없다. 그래서 브라우저에서는 **그 폴더의 version.js** 를
// 물어, 지금 화면보다 새것이면 띠를 띄우고 [다시 열기] 로 옛 저장분(서비스 워커 캐시)을 비우고
// 다시 연다. 예전에는 [업데이트] 가 APK 를 새 탭으로 열 뿐이라, 눌러도 화면이 그대로였다.
import * as store from './local/store.js';
import { APP_VERSION } from './api.js';
import { callAppsScript } from './sheets.js';
import { isOnline, isPackagedApp } from './sync.js';
import { h, toast } from './ui.js';

const META_KEY = 'latestRelease';
// 사람에게 보내 주는 고정 설치 주소. 버전 정보와 따로 담는다 — 버전 줄이
// 비어 있어도(아직 안 적었어도) 주소는 알고 있어야 한다.
const LINK_KEY = 'installLink';
const SKIP_KEY = (v) => `bh_update_skip_${v}`;
const CHECK_GAP_MS = 4 * 60 * 1000;      // 5분 주기 새로고침보다 조금 짧게

let lastCheckAt = 0;
let current = null;
let installLink = null;
let served = '';                  // 브라우저 — 이 주소를 내주는 폴더의 버전 ('' = 모름)

/** '3.16.0' 과 '3.15.1' 을 숫자로 비교한다. 양수면 a 가 더 새롭다. */
export function compareVersions(a, b) {
  const pa = String(a || '').split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b || '').split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

/** 안드로이드 APK 안에서 돌고 있는가 (MainActivity 가 UA 에 표식을 붙인다). */
export const isApk = () => /FieldPortalAPK\//.test(navigator.userAgent);

/** 브라우저로 열었나 (APK 도 아니고 APK 안 화면 주소도 아니다) */
export const isBrowser = () => !isApk() && !isPackagedApp();

/** 이 정보가 지금 앱보다 새로운가 */
export function hasNewer(info) {
  if (isBrowser()) return Boolean(served) && compareVersions(served, APP_VERSION) > 0;
  return Boolean(info && info.url && compareVersions(info.version, APP_VERSION) > 0);
}

/** 브라우저 — 이 주소를 내주는 폴더의 화면 파일 버전 (저장분을 거치지 않고 직접 묻는다) */
export async function servedVersion() {
  try {
    const res = await fetch(`./js/version.js?v=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return '';
    const m = /APP_VERSION\s*=\s*'([0-9.]+)'/.exec(await res.text());
    return m ? m[1] : '';
  } catch {
    return '';
  }
}

/**
 * 브라우저 — 옛 화면 파일 저장분을 비우고 새로 연다.
 * 서비스 워커도 새것을 받게 한 뒤 다시 연다 (안 비우면 첫 번째 다시 열기는 옛 화면이었다).
 */
export async function reloadToNewest() {
  try {
    const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
    if (reg) await reg.update().catch(() => {});
  } catch { /* 서비스 워커가 없어도 아래는 된다 */ }
  try {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('bh-shell-')).map((k) => caches.delete(k)));
  } catch { /* 저장소를 못 열어도 다시 연다 */ }
  location.reload();
}

/**
 * 시트에 최신 버전을 물어본다. 4분 안에 물었으면 다시 묻지 않는다(force 제외).
 * 실패해도 조용하다 — 업데이트 안내는 있으면 좋은 것이고, 없어도 앱은 돈다.
 */
export async function checkForUpdate({ force = false } = {}) {
  // 브라우저는 시트가 아니라 이 주소의 폴더에 묻는다 (인터넷이 없어도 PC 서버는 닿는다)
  if (isBrowser()) {
    served = await servedVersion();
    paintBanner();
  }
  if (!isOnline()) return current;
  if (!force && Date.now() - lastCheckAt < CHECK_GAP_MS) return current;
  if (!(await store.sheetInventoryOn())) return current;
  lastCheckAt = Date.now();
  try {
    const r = await callAppsScript({ release: 'latest' }, 20000);
    if (r && typeof r.minVersion === 'string') applyMinVersion(r.minVersion);
    current = r && r.version
      ? { version: String(r.version), build: String(r.build || ''), url: String(r.url || ''),
          sizeMb: Number(r.sizeMb) || 0, notes: String(r.notes || ''),
          publishedAt: String(r.publishedAt || ''), checkedAt: new Date().toISOString() }
      : null;
    await store.setMeta(META_KEY, current);
    // 주소가 온 경우에만 갈아 끼운다. 예전 Apps Script 는 이 값을 안 주는데,
    // 그때 null 로 덮으면 알고 있던 주소를 잃는다.
    if (r && r.installUrl) {
      installLink = { installUrl: String(r.installUrl),
                      downloadUrl: String(r.downloadUrl || '') };
      await store.setMeta(LINK_KEY, installLink);
    }
    paintBanner();
  } catch {
    // 예전 Apps Script 이거나 잠시 안 닿음 — 다음 번에 다시 묻는다.
  }
  return current;
}

/** 상단 띠를 현재 정보에 맞춘다. 새 버전이 없거나 '나중에' 를 눌렀으면 숨긴다. */
export function paintBanner() {
  const el = document.getElementById('update-banner');
  if (!el) return;
  if (isBrowser()) {
    // 브라우저 — 폴더에 새 화면 파일이 있을 때만. '나중에' 없이 [다시 열기] 하나 (누르면 바로 끝난다)
    if (!hasNewer(current)) { el.hidden = true; return; }
    el.innerHTML = `
      <span class="update-banner__text">새 화면 <strong>v${h(served)}</strong> 이 있습니다 — 지금 화면은 v${h(APP_VERSION)}</span>
      <button class="btn btn--sm btn--primary" data-act="reload" type="button">다시 열기</button>`;
    el.hidden = false;
    return;
  }
  if (!hasNewer(current) || localStorage.getItem(SKIP_KEY(current.version))) {
    el.hidden = true;
    return;
  }
  const size = current.sizeMb ? ` · ${current.sizeMb}MB` : '';
  el.innerHTML = `
    <span class="update-banner__text">
      새 버전 <strong>v${h(current.version)}</strong> 이 있습니다${size}
      ${current.notes ? `<span class="update-banner__notes"> — ${h(current.notes)}</span>` : ''}
    </span>
    <button class="btn btn--sm btn--ghost" data-act="later" type="button">나중에</button>
    <button class="btn btn--sm btn--primary" data-act="update" type="button">업데이트</button>`;
  el.hidden = false;
}

/** [업데이트] — APK 안이면 안드로이드에 넘기고, 브라우저면 새 탭으로 연다. */
export function startUpdate(info = current) {
  if (isBrowser()) { reloadToNewest(); return; }
  if (!info || !info.url) return;
  if (isApk()) {
    location.href = `bhupdate:${encodeURIComponent(info.url)}`;
    toast('내려받기를 시작합니다. 끝나면 설치 화면이 열립니다.', 'ok');
    return;
  }
  window.open(info.url, '_blank', 'noopener');
}

/** 부팅 때 한 번 — 지난번에 받아 둔 정보로 띠를 그리고 버튼을 연결한다. */
export async function initUpdateBanner() {
  const el = document.getElementById('update-banner');
  if (!el) return;
  current = (await store.getMeta(META_KEY, null)) || null;
  paintBanner();
  // 브라우저 — 켤 때 한 번 폴더의 버전을 묻는다 (PC 서버만 닿으면 된다)
  if (isBrowser()) servedVersion().then((v) => { served = v; paintBanner(); }).catch(() => {});
  el.addEventListener('click', (ev) => {
    const btn = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (ev.target).closest('[data-act]'));
    if (btn && btn.dataset.act === 'reload') { reloadToNewest(); return; }
    if (!btn || !current) return;
    if (btn.dataset.act === 'update') startUpdate(current);
    if (btn.dataset.act === 'later') {
      // 이 버전에 대해서만 접는다 — 다음 버전이 나오면 다시 보인다.
      localStorage.setItem(SKIP_KEY(current.version), '1');
      el.hidden = true;
    }
  });
}

/**
 * 팀원에게 보내 주는 설치 주소 — 없으면 null.
 *
 * 이 주소는 드라이브 파일 하나를 가리킨다. 새 버전이 나오면 그 파일의
 * **내용만** 바뀌므로, 한 번 보낸 주소가 계속 최신 APK 를 준다.
 */
export function getInstallLink() {
  return installLink;
}

/** 기기에 담아 둔 설치 주소를 꺼낸다 (화면을 그리기 전에 한 번). */
export async function loadInstallLink() {
  if (!installLink) installLink = (await store.getMeta(LINK_KEY, null)) || null;
  return installLink;
}

/** 설정 화면 한 줄: "최신 v3.16.0 [업데이트]" 또는 "최신입니다". */
export function settingsLine() {
  if (isBrowser()) {
    // 브라우저 — 화면은 이 주소를 내주는 폴더에서 온다. 새로 나온 버전이 그 폴더에 없으면
    // 아무리 눌러도 안 바뀐다 — 그것을 알려 준다.
    if (hasNewer(current)) {
      return `· 이 주소에 새 화면 <strong>v${h(served)}</strong>
        <button class="btn btn--sm btn--primary" data-act="app-update" type="button"
                style="margin-left:6px">다시 열기</button>`;
    }
    if (current && current.version && served && compareVersions(current.version, served) > 0) {
      return `· 최신은 <strong>v${h(current.version)}</strong> — 이 주소를 내주는 PC 폴더가 v${h(served)} 입니다.
        그 폴더를 새로 받은 뒤(git pull) 다시 열면 바뀝니다.`;
    }
    return served ? '· 이 주소의 최신 화면입니다' : '';
  }
  if (!current || !current.version) return '';
  if (hasNewer(current)) {
    return `· 최신 <strong>v${h(current.version)}</strong>
      <button class="btn btn--sm btn--primary" data-act="app-update" type="button"
              style="margin-left:6px">업데이트</button>`;
  }
  return '· 최신입니다';
}


// ─────────────────────────────────────────────── 최소 버전 (기기 탭 B1)
//
// 시트를 바꾸는 방식이 달라지면(예: 수량을 '바뀐 만큼' 으로) 옛 앱이 계속 쓰면 안 될 때가
// 있다. 관리자가 시트 '기기' 탭 B1 에 최소 버전을 적으면, 그보다 낮은 앱은 화면을 덮고
// 업데이트를 요구한다. 올리지 못한 내용은 기기에 그대로 있다 (업데이트 뒤 올라간다).
const MIN_KEY = 'minVersion';

export async function applyMinVersion(min) {
  try {
    await store.setMeta(MIN_KEY, String(min || ''));
  } catch { /* 저장 실패해도 이번 화면은 그린다 */ }
  paintVersionGate(String(min || ''));
}

/** 부팅 때 — 지난번에 받아 둔 최소 버전으로 먼저 판단한다 (오프라인이어도). */
export async function initVersionGate() {
  try {
    paintVersionGate(String((await store.getMeta(MIN_KEY, '')) || ''));
  } catch { /* 없으면 막지 않는다 */ }
}

function paintVersionGate(min) {
  let gate = document.getElementById('version-gate');
  const tooOld = Boolean(min) && compareVersions(APP_VERSION, min) < 0;
  if (!tooOld) { if (gate) gate.remove(); return; }
  if (!gate) {
    gate = document.createElement('div');
    gate.id = 'version-gate';
    gate.className = 'version-gate';
    gate.setAttribute('role', 'alertdialog');
    gate.setAttribute('aria-modal', 'true');
    document.body.append(gate);
    gate.addEventListener('click', (ev) => {
      const btn = /** @type {HTMLElement} */ (ev.target).closest('[data-act]');
      if (!btn) return;
      if (current && hasNewer(current)) startUpdate(current);
      else location.reload();
    });
  }
  gate.innerHTML = `
    <div class="version-gate__box">
      <h2>앱 업데이트가 필요합니다</h2>
      <p>이 기기는 <b class="tnum">v${h(APP_VERSION)}</b> 입니다. 팀 시트가 <b class="tnum">v${h(min)}</b> 이상을 요구합니다.</p>
      <p class="muted">올리지 못한 리포트 · 재고 변경은 기기에 그대로 있습니다. 업데이트 뒤 자동으로 올라갑니다.</p>
      <button class="btn btn-primary" data-act="gate-update" type="button">
        ${current && hasNewer(current) ? `v${h(current.version)} 받기` : '다시 열기 (새 화면 받기)'}
      </button>
    </div>`;
}

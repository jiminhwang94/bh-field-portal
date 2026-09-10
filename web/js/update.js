// 앱 안 [업데이트] — 새 버전이 있으면 상단에 띠를 띄우고, 누르면 받아 설치한다.
//
// 어디서 아나 — 빌드 자동화가 APK 를 Dropbox 에 올린 뒤 시트의 '앱 버전' 탭에
// 한 줄 적는다. 태블릿은 시트를 받아올 때(5분마다·[새로고침]) 함께 물어본다.
// 사람이 개입할 지점은 그 탭이다: '공개' 를 N 으로 바꾸면 안내가 멈춘다.
//
// 어떻게 받나 — APK 안이면 bhupdate:<주소> 로 안드로이드 쪽에 넘겨 시스템
// 다운로드 관리자가 받고 설치 화면을 연다. 브라우저면 새 탭으로 연다.
import * as store from './local/store.js';
import { APP_VERSION } from './api.js';
import { callAppsScript } from './sheets.js';
import { isOnline } from './sync.js';
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

/** 이 정보가 지금 앱보다 새로운가 */
export function hasNewer(info) {
  return Boolean(info && info.url && compareVersions(info.version, APP_VERSION) > 0);
}

/**
 * 시트에 최신 버전을 물어본다. 4분 안에 물었으면 다시 묻지 않는다(force 제외).
 * 실패해도 조용하다 — 업데이트 안내는 있으면 좋은 것이고, 없어도 앱은 돈다.
 */
export async function checkForUpdate({ force = false } = {}) {
  if (!isOnline()) return current;
  if (!force && Date.now() - lastCheckAt < CHECK_GAP_MS) return current;
  if (!(await store.sheetInventoryOn())) return current;
  lastCheckAt = Date.now();
  try {
    const r = await callAppsScript({ release: 'latest' }, 20000);
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
  el.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-act]');
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
  if (!current || !current.version) return '';
  if (hasNewer(current)) {
    return `· 최신 <strong>v${h(current.version)}</strong>
      <button class="btn btn--sm btn--primary" data-act="app-update" type="button"
              style="margin-left:6px">업데이트</button>`;
  }
  return '· 최신입니다';
}

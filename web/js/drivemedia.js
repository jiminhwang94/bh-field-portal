// 드라이브 첨부를 **화면에 반드시 보이게** 하는 마지막 수단.
//
// 앱은 사진을 `drive.google.com/thumbnail?id=...` 로 그린다. 빠르고 공짜지만
// 파일이 '링크가 있는 누구나' 로 공개돼 있을 때만 그림을 준다. 구글 로그인
// 쿠키는 다른 사이트의 <img> 요청에 붙지 않기 때문이다(SameSite). 공유
// 드라이브는 조직 정책으로 링크 공개가 막혀 있을 수 있어서, 그런 현장에서는
// **올린 본인 화면에서도** 액박이 떴다.
//
// 그래서 그림이 실패하면 여기로 온다. Apps Script 웹 앱은 시트 주인 권한으로
// 돌아가므로 파일을 읽을 수 있다. 바이트를 받아 blob 으로 만들어 끼운다.
// 한 번 받은 것은 기기에 담아 두므로 다음부터는 즉시 뜨고 오프라인에서도 보인다.
import * as idb from './local/idb.js';
import { callAppsScript } from './sheets.js';

/** 기기에 담을 때 쓰는 이름. 크기별로 따로 담는다. */
const cacheName = (id, size) => `drive-${size}-${id}`;

/**
 * 한 번 본 드라이브 사진은 기기에 담아 둔다 (v3.43).
 *
 *  · 원본이 아니라 **화면 크기(가로 800px)** 만 담는다 — 장당 50KB 안팎.
 *  · 다 합쳐 1GB 를 넘으면 **가장 오래 안 본 것부터** 지운다.
 *  · 영상은 담지 않는다 (재생기를 끼우므로 담을 파일도 없다).
 *
 * `drive.google.com/thumbnail` 은 lh3 로 넘겨주는데, 넘겨주는 응답에 CORS 허락이 없어
 * 앱이 그림 내용을 꺼낼 수 없다. 넘겨받는 lh3 주소에는 허락(`*`)이 있어서 그쪽으로 바로 간다
 * — 한 번 덜 돌아가니 처음 볼 때도 조금 빠르다.
 */
export const PHOTO_CAP = 1024 * 1024 * 1024;
const PHOTO_WIDTH = 800;
const KEEP = 'photo';
export const photoUrl = (id) => `https://lh3.googleusercontent.com/d/${id}=w${PHOTO_WIDTH}`;
/** '마지막으로 본 때' 는 이만큼 지나야 다시 적는다 — 볼 때마다 저장소에 쓰지 않게 */
const TOUCH_EVERY = 6 * 60 * 60 * 1000;
const DRIVE_KEYS = () => IDBKeyRange.bound('drive-', 'drive-￿');

function touch(row) {
  if (Date.now() - (row.seenAt || 0) <= TOUCH_EVERY) return;
  idb.put('media', { ...row, seenAt: Date.now() }).catch(() => {});
}

/** 기기에 담긴 사진 주소. 없으면 빈 문자열. */
async function fromDevice(id) {
  for (const size of [KEEP, 'thumb']) {
    try {
      const row = await idb.get('media', cacheName(id, size));
      if (!row || !row.blob) continue;
      touch(row);
      return URL.createObjectURL(row.blob);
    } catch { return ''; }
  }
  return '';
}

/** 다 그려진 사진을 화면 크기 그대로 담는다. 못 담으면 조용히 넘어간다. */
async function keepShown(el, id) {
  if (!el.naturalWidth || String(el.src).startsWith('blob:')) return;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = el.naturalWidth;
    canvas.height = el.naturalHeight;
    canvas.getContext('2d').drawImage(el, 0, 0);
    /** @type {Blob|null} */
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.85));
    if (!blob) return;
    await idb.put('media', {
      filename: cacheName(id, KEEP), blob, mime: blob.type,
      originalName: '', size: blob.size, localOnly: true, seenAt: Date.now(),
    });
    trimSoon();
  } catch { /* 허락이 없거나 저장소가 꽉 찼다 — 이번 화면은 이미 보인다 */ }
}

/**
 * 드라이브 사진 `<img>` 하나를 채운다.
 *   기기에 있으면 즉시 → 없으면 lh3 로 받아 보여 주고 담는다 → 그것도 안 되면 Apps Script 로.
 * 끝내 못 받으면 사진 자리에 까닭을 적는다 (깨진 그림 대신).
 */
export async function showDrivePhoto(el, id) {
  const kept = await fromDevice(id);
  if (kept) { el.src = kept; return; }
  el.crossOrigin = 'anonymous';               // 허락을 받아야 다 그린 그림을 담을 수 있다
  el.addEventListener('load', () => { keepShown(el, id); }, { once: true });
  el.addEventListener('error', async () => {
    el.removeAttribute('crossorigin');
    const ok = await reviveImage(el, id, 'thumb').catch(() => false);
    if (!ok) missingPhoto(el);
  }, { once: true });
  el.src = photoUrl(id);
}

function missingPhoto(el) {
  const note = document.createElement('div');
  note.className = 'media-missing';
  note.textContent = navigator.onLine
    ? '사진을 불러오지 못했어요'
    : '이 사진은 아직 이 기기에 없어요 · 인터넷이 연결되면 보여요';
  el.replaceWith(note);
}

/** 기기에 담긴 사진이 차지하는 크기 (바이트) 와 장 수. */
export async function photoUsage() {
  const rows = await idb.getAll('media', null, DRIVE_KEYS());
  return {
    bytes: rows.reduce((sum, r) => sum + (r.size || (r.blob && r.blob.size) || 0), 0),
    count: rows.length,
  };
}

/**
 * 상한을 넘었으면 가장 오래 안 본 사진부터 지워 상한의 90% 까지 내린다.
 * 반환: 지운 장 수.
 */
export async function trimPhotos(cap = PHOTO_CAP) {
  const rows = await idb.getAll('media', null, DRIVE_KEYS());
  let total = rows.reduce((sum, r) => sum + (r.size || (r.blob && r.blob.size) || 0), 0);
  if (total <= cap) return 0;
  rows.sort((a, b) => (a.seenAt || 0) - (b.seenAt || 0));
  let removed = 0;
  for (const row of rows) {
    if (total <= cap * 0.9) break;
    await idb.remove('media', row.filename);
    total -= row.size || (row.blob && row.blob.size) || 0;
    removed += 1;
  }
  return removed;
}

let trimTimer = null;
/** 담을 때마다 세지 않고, 몰아서 한 번 센다. */
function trimSoon() {
  clearTimeout(trimTimer);
  trimTimer = setTimeout(() => { trimPhotos().catch(() => {}); }, 3000);
}

/** 기기에 담은 드라이브 사진을 모두 지운다 (설정 → [사진 비우기]). 다시 보면 또 받는다. */
export async function clearPhotos() {
  const rows = await idb.getAll('media', null, DRIVE_KEYS());
  for (const row of rows) await idb.remove('media', row.filename);
  return rows.length;
}

/** 같은 사진을 여러 곳에서 동시에 부를 때 요청이 겹치지 않게 한다. */
const inFlight = new Map();

/**
 * 드라이브 파일 하나를 볼 수 있는 주소로 바꾼다.
 *
 * @param {string} id     드라이브 파일 id
 * @param {'thumb'|'full'} size  목록용 작은 것 / 크게 보기
 * @returns {Promise<string>} blob 주소. 못 받으면 빈 문자열.
 */
export async function objectUrl(id, size = 'thumb') {
  if (!id) return '';
  const key = cacheName(id, size);

  // 1) 기기에 이미 있으면 그것을 쓴다 — 즉시, 오프라인에서도.
  try {
    const row = await idb.get('media', key);
    if (row && row.blob) { touch(row); return URL.createObjectURL(row.blob); }
  } catch { /* 저장소를 못 열어도 아래에서 받아 본다 */ }

  // 2) 같은 요청이 이미 날아가 있으면 그 결과를 함께 쓴다.
  if (inFlight.has(key)) return inFlight.get(key);

  const job = (async () => {
    try {
      const result = await callAppsScript({ drive: 'bytes', ids: [id], size }, 90000);
      const file = (result.files || [])[0];
      if (!file || !file.data) return '';
      const blob = base64ToBlob(file.data, file.mimeType || 'image/jpeg');
      try {
        await idb.put('media', {
          filename: key, blob, mime: blob.type,
          originalName: file.name || '', size: blob.size, localOnly: true, seenAt: Date.now(),
        });
        trimSoon();
      } catch { /* 담아 두지 못해도 이번 화면은 보인다 */ }
      return URL.createObjectURL(blob);
    } catch {
      return '';
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, job);
  return job;
}

/**
 * `<img>` 하나를 살린다. 드라이브 주소로 그리다 실패했을 때 부른다.
 * 성공하면 true.
 */
/** @param {'thumb'|'full'} [size] */
export async function reviveImage(el, id, size = 'thumb') {
  const url = await objectUrl(id, size);
  if (!url) return false;
  el.src = url;
  el.classList.remove('is-broken');
  return true;
}

function base64ToBlob(data, mime) {
  const raw = atob(data);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

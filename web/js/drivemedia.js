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
    if (row && row.blob) return URL.createObjectURL(row.blob);
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
          originalName: file.name || '', size: blob.size, localOnly: true,
        });
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

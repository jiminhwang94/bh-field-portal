// 첨부를 조각으로 올린다 — 끊겨도 받은 조각 다음부터 이어 올린다.
//
// 예전에는 사진 · 영상을 리포트와 **한 번의 요청**으로 보냈다. 현장 LTE 에서 20MB 영상을
// 보내다 끊기면 처음부터 다시 보냈고, 그 사이 앱을 닫으면 그만큼 날아갔다.
//
//  - 1.5MB 조각으로 나눠 보낸다. 조각마다 3번까지 다시 해 본다 (1초 · 3초 · 6초 쉬고)
//  - 보낸 조각 번호를 기기에 적어 둔다 → 다음에 다시 올릴 때 남은 조각만 보낸다
//  - 다 보내면 시트가 이어 붙여 드라이브에 파일 하나를 만든다. 그 주소를 리포트 칸에 쓴다
//  - 리포트 줄 올리기가 실패해도 이미 만든 파일은 다시 만들지 않는다 (드라이브에 같은 파일이 쌓이지 않는다)
//  - 시트(Apps Script)가 옛것이라 조각을 모르면, 예전처럼 한 번에 보낸다
import * as store from './local/store.js';

/** 3의 배수 바이트 — base64 를 그대로 이어 붙일 수 있다 */
export const CHUNK_BYTES = 3 * 512 * 1024;
const STATE = (key) => `upload:${key}`;

function newUploadId() {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}-${rand}`;
}

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error('파일을 읽지 못했습니다.'));
    reader.readAsDataURL(blob);
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** 오프라인 · 옛 시트는 다시 해 봐야 소용없다 — 바로 넘긴다 */
async function retry(fn, tries = [1000, 3000, 6000]) {
  for (let i = 0; ; i += 1) {
    try {
      return await fn();
    } catch (err) {
      if (err && (err.offline || err.unsupported) || i >= tries.length) throw err;
      await wait(tries[i]);
    }
  }
}

/** 화면에 진행 상황을 알린다 (작성 화면의 [올리는 중 …] 글자가 받는다) */
function progress(detail) {
  try { window.dispatchEvent(new CustomEvent('bh-upload-progress', { detail })); } catch { /* 없어도 된다 */ }
}

/**
 * 파일 하나를 조각으로 올리고 드라이브 주소를 받는다.
 * key — 기기 안 파일 이름 (같은 파일을 다시 올릴 때 이어 가는 열쇠)
 * @returns {Promise<{ url: string, id: string, public: boolean }>}
 */
export async function uploadResumable(blob, { key, filename, mimeType, storeName, dateText, label = '' }, call) {
  const saved = (await store.getMeta(STATE(key), null)) || null;
  let state = saved && saved.size === blob.size ? saved
    : { uploadId: newUploadId(), size: blob.size, done: [], url: '', id: '', public: true };
  if (state.url) return state;                          // 이미 드라이브에 있다
  const total = Math.max(1, Math.ceil(blob.size / CHUNK_BYTES));
  for (let i = 0; i < total; i += 1) {
    if (state.done.includes(i)) continue;
    const data = await blobToBase64(blob.slice(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES));
    await retry(() => call({ media: 'chunk', uploadId: state.uploadId, index: i, total, data }, 90000));
    state = { ...state, done: [...state.done, i] };
    await store.setMeta(STATE(key), state);
    progress({ label, sent: state.done.length, total });
  }
  let res;
  try {
    res = await retry(() => call({ media: 'finish', uploadId: state.uploadId, total, filename, mimeType,
                                   storeName, dateText }, 120000));
  } catch (err) {
    // 시트가 '빠진 조각' 을 말하면 그 조각만 다시 보내게 표시를 지운다
    const missing = err && err.missing;
    if (Array.isArray(missing)) {
      state = { ...state, done: state.done.filter((x) => !missing.includes(x)) };
      await store.setMeta(STATE(key), state);
    }
    throw err;
  }
  state = { ...state, url: res.url, id: res.id, public: res.public !== false };
  await store.setMeta(STATE(key), state);
  return state;
}

/** 리포트가 다 올라가면 이어 올리기 기록을 지운다 */
export async function forgetUploads(keys) {
  for (const key of keys) await store.setMeta(STATE(key), null);
}

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
//
// 빨리 올리기 (v3.33) — 예전에는 [업로드] 를 누른 뒤에야 한 장씩, 한 장에 두 번 오갔다.
//  - 붙이는 순간 뒤에서 조각을 미리 보낸다 (prefetchChunks). [업로드] 때는 마무리만 한다
//  - 조각 하나로 끝나는 작은 파일은 마무리 요청에 실어 **한 번에** 보낸다
//  - 사진 · 영상 조각을 **3개씩 동시에** 보낸다 (LANES)
//
// 조각 id (v3.36.1) — 시트는 조각을 이름으로 찾았는데, 드라이브 이름 찾기는 방금 만든 파일을
// 몇십 초 못 본다. 1분 영상을 다 보내자마자 마무리하면 '빠진 조각: 0,1,…,13' 이 났다.
//  - 조각마다 시트가 돌려준 파일 id 를 적어 두고 마무리에 함께 보낸다 (parts)
//  - 그래도 빠진 조각이 있다고 하면 그 조각만 다시 보내고 한 번 더 마무리한다
import * as store from './local/store.js';

/** 3의 배수 바이트 — base64 를 그대로 이어 붙일 수 있다 */
export const CHUNK_BYTES = 3 * 512 * 1024;
/** 동시에 보내는 요청 수 — 미리 올리기와 [업로드] 가 함께 쓴다 */
export const LANES = 3;
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

/** 오프라인 · 옛 시트 · 빠진 조각은 다시 해 봐야 소용없다 — 바로 넘긴다 */
async function retry(fn, tries = [1000, 3000, 6000]) {
  for (let i = 0; ; i += 1) {
    try {
      return await fn();
    } catch (err) {
      if (err && (err.offline || err.unsupported || Array.isArray(err.missing)) || i >= tries.length) throw err;
      await wait(tries[i]);
    }
  }
}

// 동시에 LANES 개까지만 보낸다. 끝난 자리는 기다리던 다음 요청에 그대로 넘긴다.
let busy = 0;
/** @type {Array<() => void>} */
const waiting = [];
async function lane(fn) {
  if (busy >= LANES) await new Promise((resolve) => waiting.push(() => resolve(undefined)));
  else busy += 1;
  try {
    return await fn();
  } finally {
    const next = waiting.shift();
    if (next) next(); else busy -= 1;
  }
}

/** 화면에 진행 상황을 알린다 (작성 화면의 [올리는 중 …] 글자가 받는다) */
function progress(detail) {
  try { window.dispatchEvent(new CustomEvent('bh-upload-progress', { detail })); } catch { /* 없어도 된다 */ }
}

async function loadState(key, blob) {
  const saved = (await store.getMeta(STATE(key), null)) || null;
  return saved && saved.size === blob.size ? saved
    : { uploadId: newUploadId(), size: blob.size, done: [], ids: {}, url: '', id: '', public: true };
}

const totalOf = (blob) => Math.max(1, Math.ceil(blob.size / CHUNK_BYTES));

/**
 * 아직 안 보낸 조각을 3개씩 동시에 보낸다. 하나가 끊겨도 나머지는 끝까지 보내 적어 두고,
 * 그다음 첫 오류를 던진다 (다음 번엔 끊긴 조각만).
 * @param {{ tries?: number[], label?: string }} [opts] tries — 다시 해 보기 전 쉬는 시간 (미리 올리기는 [] = 한 번만)
 */
async function sendChunks(blob, state, key, call, opts = {}) {
  const { tries, label = '' } = opts;
  const total = totalOf(blob);
  const todo = [];
  for (let i = 0; i < total; i += 1) if (!state.done.includes(i)) todo.push(i);
  const results = await Promise.allSettled(todo.map((i) => lane(async () => {
    const data = await blobToBase64(blob.slice(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES));
    const res = await retry(() => call({ media: 'chunk', uploadId: state.uploadId, index: i, total, data }, 90000), tries);
    state.ids = { ...(state.ids || {}), [i]: (res && res.fileId) || '' };
    state.done = [...state.done, i];
    await store.setMeta(STATE(key), { ...state });
    if (label) progress({ label, sent: state.done.length, total });
  })));
  const failed = results.find((r) => r.status === 'rejected');
  if (failed) throw /** @type {PromiseRejectedResult} */ (failed).reason;
}

/** 지금 미리 올리는 중인 파일 — [업로드] 가 같은 조각을 두 번 보내지 않게 기다린다 */
const inflight = new Map();

/**
 * 붙이는 순간 뒤에서 조각만 미리 보낸다 (마무리는 [업로드] 때 — 매장 · 날짜 폴더가 그때 정해진다).
 * 덤으로 하는 일이라 다시 해 보지 않는다. 끊기면 [업로드] 가 남은 조각을 보낸다.
 */
export function prefetchChunks(blob, { key }, call) {
  if (inflight.has(key)) return inflight.get(key);
  const job = (async () => {
    const state = await loadState(key, blob);
    if (state.url) return;
    await store.setMeta(STATE(key), state);          // uploadId 를 먼저 적어 둔다 — [업로드] 가 같은 것을 쓴다
    await sendChunks(blob, state, key, call, { tries: [] });
  })().finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}

/** 조각 하나짜리를 마무리 요청에 실어 보내는 것을 시트가 모르면(3.32 이전) 이번 실행 동안 끈다 */
let inlineUnsupported = false;

/**
 * 파일 하나를 조각으로 올리고 드라이브 주소를 받는다.
 * key — 기기 안 파일 이름 (같은 파일을 다시 올릴 때 이어 가는 열쇠)
 * @returns {Promise<{ url: string, id: string, public: boolean }>}
 */
export async function uploadResumable(blob, { key, filename, mimeType, storeName, dateText, label = '' }, call) {
  if (inflight.has(key)) await inflight.get(key).catch(() => { /* 남은 조각은 아래에서 */ });
  let state = await loadState(key, blob);
  if (state.url) return state;                          // 이미 드라이브에 있다
  const total = totalOf(blob);
  const finish = { media: 'finish', uploadId: state.uploadId, total, filename, mimeType, storeName, dateText };
  let res = null;
  if (total === 1 && !state.done.length && !inlineUnsupported) {
    // 작은 파일 — 조각 보내기 없이 한 번에
    const data = await blobToBase64(blob);
    try {
      res = await lane(() => retry(() => call({ ...finish, data }, 120000)));
    } catch (err) {
      if (!Array.isArray(err && err.missing)) throw err;
      inlineUnsupported = true;                         // 옛 시트는 data 를 모르고 '빠진 조각' 이라 답한다
    }
  }
  // 시트가 '빠진 조각' 을 말하면 그 조각만 다시 보내고 한 번 더 마무리한다
  for (let round = 0; !res; round += 1) {
    await sendChunks(blob, state, key, call, { label });
    const ids = state.ids || {};
    const parts = Array.from({ length: total }, (_, i) => ids[i] || '');
    try {
      res = await lane(() => retry(() => call({ ...finish, parts }, 120000)));
    } catch (err) {
      const missing = err && err.missing;
      if (!Array.isArray(missing)) throw err;
      const left = { ...ids };
      missing.forEach((x) => { delete left[x]; });
      state = { ...state, done: state.done.filter((x) => !missing.includes(x)), ids: left };
      await store.setMeta(STATE(key), state);
      if (round >= 1) throw err;
    }
  }
  state = { ...state, url: res.url, id: res.id, public: res.public !== false };
  await store.setMeta(STATE(key), state);
  if (label) progress({ label, sent: total, total });
  return state;
}

/** 리포트가 다 올라가면 이어 올리기 기록을 지운다 */
export async function forgetUploads(keys) {
  for (const key of keys) await store.setMeta(STATE(key), null);
}

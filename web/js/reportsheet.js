// 리포트 이력 — 구글 시트의 월별 탭을 읽어 오고, 상태 칸을 고쳐 쓴다.
//
// 시트가 원본이다. 앱은 마지막으로 읽어 온 내용을 기기에 담아 두었다가
// 오프라인이면 그것을 보여 준다. 상태 변경은 오프라인이면 대기열에 쌓았다가
// 연결될 때 시트에 반영한다.
import * as store from './local/store.js';
import { callAppsScript, STATUS_VALUES, DEFAULT_STATUS } from './sheets.js';

const CACHE_PREFIX = 'sheetReports:';
const MONTHS_KEY = 'sheetReportMonths';


export function isKnownStatus(value) {
  return STATUS_VALUES.includes(String(value || '').trim());
}

/**
 * 시트 한 줄을 화면이 쓰기 좋은 모양으로 바꾼다.
 *
 * 열 이름은 팀이 [항목 설정]에서 바꿀 수 있으므로 위치로 찾지 않고
 * 이름으로 찾는다. 못 찾으면 비워 두고 화면에서 대체 값을 쓴다.
 */
function toEntry(headers, row, sheetName) {
  const cells = row.cells || [];
  const get = (name) => {
    const index = headers.indexOf(name);
    return index < 0 ? '' : String(cells[index] || '').trim();
  };
  const findBy = (needle) => {
    for (let i = 0; i < headers.length; i += 1) {
      if (headers[i] && headers[i].includes(needle)) {
        return String(cells[i] || '').trim();
      }
    }
    return '';
  };

  // 작성일시·작성자·상태는 상세 화면 맨 위에 따로 보여 주므로 본문에서는 뺀다.
  const SHOWN_ABOVE = ['작성일시', '작성자', '상태'];
  const values = [];
  const links = [];
  for (let i = 0; i < headers.length; i += 1) {
    const label = headers[i];
    if (!label || SHOWN_ABOVE.includes(label)) continue;
    const value = String(cells[i] || '').trim();
    if (!value) continue;
    // 드라이브 링크가 든 칸은 첨부로 따로 모은다.
    if (value.includes('drive.google.com')) {
      value.split('\n').forEach((line) => {
        const url = line.trim();
        if (url.startsWith('http')) links.push({ label, url, id: driveId(url) });
      });
      continue;
    }
    values.push({ label, value });
  }

  const createdAt = get('작성일시');
  const status = get('상태');

  return {
    key: `${sheetName}#${row.row}`,
    sheetName,
    row: row.row,
    createdAt,
    date: createdAt.slice(0, 10),
    author: get('작성자'),
    store: findBy('식당') || findBy('매장'),
    code: findBy('오류 코드'),
    summary: findBy('증상') || findBy('조치'),
    status: isKnownStatus(status) ? status : DEFAULT_STATUS,
    statusRaw: status,
    values,
    links,
  };
}

/**
 * 그 식당의 지난 방문 기록을 찾는다 (최근 것부터).
 *
 * 같은 식당을 여러 번 가는 업무라, 새 리포트를 쓸 때 "지난번에 뭐 했더라" 를
 * 이력 화면으로 건너가지 않고 그 자리에서 보게 하려는 것이다.
 * 기기에 받아 둔 사본만 뒤지므로 오프라인에서도 동작하고, 네트워크를 쓰지 않는다.
 */
export async function findVisits(storeName, limit = 3) {
  const needle = String(storeName || '').trim().toLowerCase();
  if (needle.length < 2) return [];

  const months = ((await store.getMeta(MONTHS_KEY, [])) || []).slice(0, 6);
  const found = [];
  for (const month of months) {
    const cached = await store.getMeta(CACHE_PREFIX + month, null);
    for (const entry of (cached && cached.entries) || []) {
      if (String(entry.store || '').toLowerCase().includes(needle)) found.push(entry);
    }
    if (found.length >= limit * 3) break;      // 충분히 모였으면 더 뒤지지 않는다
  }
  found.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return found.slice(0, limit);
}

/**
 * 이력을 못 받아 온 이유를 사람 말로 바꾼다.
 *
 * 가장 흔한 경우가 **스프레드시트의 Apps Script 가 아직 예전 버전**인 것이다.
 * 예전 코드는 `reports` 요청을 모르기 때문에 리포트 기록 경로로 흘러가
 * "sheetName 이 없습니다" 같은 엉뚱한 답을 준다. 그대로 두면 화면이 그냥
 * 비어 보여서 원인을 알 수 없으므로, 이 경우를 짚어 알려 준다.
 */
export function explain(err) {
  const text = String((err && err.message) || err || '');
  if (!text) return '';
  if (text.includes('sheetName') || text.includes('알 수 없는 요청')
      || text.includes('row 가 비어')) {
    return '스프레드시트의 Apps Script 가 아직 예전 버전입니다.\n'
      + '[확장 프로그램 → Apps Script] 에서 최신 코드로 바꾸고 '
      + '[배포 → 배포 관리 → 기존 배포 수정(새 버전)] 으로 재배포하세요. '
      + '주소는 그대로 유지됩니다.';
  }
  if (text.includes('웹 앱 URL') || text.includes('로그인이 필요')) {
    return '웹 앱 URL 이 올바르지 않거나 액세스 권한이 "모든 사용자" 가 아닙니다.\n'
      + '[배포 관리] 에서 확인해 주세요.';
  }
  if (text.includes('권한')) return text;
  return text;
}

/** 드라이브 링크에서 파일 id 를 뽑는다 (썸네일 주소를 만들 때 쓴다). */
export function driveId(url) {
  const text = String(url || '');
  const byPath = text.match(/\/d\/([-\w]{20,})/);
  if (byPath) return byPath[1];
  const byQuery = text.match(/[?&]id=([-\w]{20,})/);
  return byQuery ? byQuery[1] : '';
}

/** 드라이브 파일의 미리보기 이미지 주소 (영상도 대표 장면이 나온다) */
export function thumbUrl(id, size = 220) {
  return id ? `https://drive.google.com/thumbnail?id=${id}&sz=w${size}` : '';
}

/**
 * 드라이브가 직접 그려 주는 미리보기 주소.
 * 영상은 여기서 **재생**되고, 사진은 원본 크기로 보인다.
 */
export function previewUrl(id) {
  return id ? `https://drive.google.com/file/d/${id}/preview` : '';
}

/**
 * 첨부가 사진인지 영상인지 알아 온다.
 *
 * 시트 칸에는 주소만 있어서 종류를 알 수 없다. 그대로 두면 영상도 사진처럼
 * 한 장면만 보이고 재생이 안 된다(실제로 그랬다).
 * 한 번 알아낸 것은 기기에 담아 두고 다시 묻지 않는다.
 */
const TYPE_KEY = 'driveFileTypes';

export async function describeFiles(ids) {
  const known = (await store.getMeta(TYPE_KEY, {})) || {};
  const missing = [...new Set(ids.filter((id) => id && !known[id]))];

  if (missing.length) {
    try {
      const result = await callAppsScript({ drive: 'info', ids: missing }, 30000);
      for (const file of result.files || []) {
        known[file.id] = { name: file.name || '', mimeType: file.mimeType || '',
                           isVideo: Boolean(file.isVideo) };
      }
      await store.setMeta(TYPE_KEY, known);
    } catch {
      // 예전 Apps Script 이거나 오프라인 — 사진으로 보고 넘어간다.
      for (const id of missing) known[id] = { name: '', mimeType: '', isVideo: false };
    }
  }
  return known;
}

// ------------------------------------------------------------- 월 목록

export async function listMonths({ refresh = false } = {}) {
  const cached = (await store.getMeta(MONTHS_KEY, [])) || [];
  if (!refresh && cached.length) return cached;
  try {
    const result = await callAppsScript({ reports: 'months' }, 30000);
    const months = (result.months || []).filter((m) => /^\d{4}-\d{2}$/.test(m));
    if (months.length) await store.setMeta(MONTHS_KEY, months);
    return months.length ? months : cached;
  } catch {
    return cached;        // 오프라인 — 마지막으로 받아 둔 목록
  }
}

// ------------------------------------------------------------- 월별 목록

/**
 * 그 달의 리포트를 가져온다.
 * 연결이 안 되면 마지막으로 받아 둔 내용을 그대로 돌려주고 offline 을 표시한다.
 */
export async function pullMonth(sheetName, { refresh = true } = {}) {
  const cacheKey = CACHE_PREFIX + sheetName;
  const cached = (await store.getMeta(cacheKey, null));

  if (!refresh && cached) return { ...cached, fromCache: true };

  try {
    const result = await callAppsScript(
      { reports: 'pull', sheetName }, 60000);
    const headers = (result.headers || []).map((x) => String(x || '').trim());
    const entries = (result.rows || []).map((row) => toEntry(headers, row, sheetName));
    // 최근 작성분이 위로. 시트에서 사람이 줄을 옮기거나 정렬해도
    // 화면 순서가 흔들리지 않도록 줄 번호가 아니라 작성일시로 맞춘다.
    entries.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const payload = { sheetName, headers, entries, fetchedAt: new Date().toISOString() };
    await store.setMeta(cacheKey, payload);
    return { ...payload, fromCache: false };
  } catch (err) {
    if (cached) return { ...cached, fromCache: true, error: err };
    return {
      sheetName, headers: [], entries: [], fetchedAt: null,
      fromCache: false, error: err,
    };
  }
}

// --------------------------------------------------------------- 상태 변경

/**
 * 상태를 바꾼다. 기기 안 사본을 먼저 고쳐 화면이 즉시 반응하게 하고,
 * 시트 반영은 온라인이면 바로, 아니면 대기열에 넣는다.
 */
export async function setStatus(sheetName, row, status) {
  if (!isKnownStatus(status)) throw new Error('알 수 없는 상태입니다.');

  const before = await cachedStatus(sheetName, row);
  await patchCache(sheetName, row, status);

  try {
    await callAppsScript({ reports: 'status', sheetName, row, status }, 30000);
    return { queued: false, status };
  } catch (err) {
    if (err && err.offline) {
      // 오프라인이면 기기 값을 그대로 두고, 연결될 때 시트에 올린다.
      await store.enqueue({ type: 'report-status', sheetName, row, status });
      return { queued: true, status };
    }
    // 시트에 못 쓴 값을 기기에 남겨 두면 다음에 열었을 때 거짓을 보여 준다.
    if (before !== null) await patchCache(sheetName, row, before);
    throw err;
  }
}

/** 기기 사본에 들어 있는 현재 상태 (없으면 null) */
async function cachedStatus(sheetName, row) {
  const cached = await store.getMeta(CACHE_PREFIX + sheetName, null);
  if (!cached) return null;
  const found = (cached.entries || []).find((e) => e.row === row);
  return found ? found.status : null;
}

/** 기기 사본의 상태 값을 고친다 (화면이 곧바로 새 값을 보여 주도록). */
async function patchCache(sheetName, row, status) {
  const cacheKey = CACHE_PREFIX + sheetName;
  const cached = await store.getMeta(cacheKey, null);
  if (!cached) return;
  const entries = (cached.entries || []).map((entry) => (
    entry.row === row ? { ...entry, status, statusRaw: status } : entry));
  await store.setMeta(cacheKey, { ...cached, entries });
}

/**
 * 시트에서 그 줄을 지운다.
 *
 * 지우면 아래 줄들의 번호가 하나씩 당겨지므로, 기기에 받아 둔 사본을 그대로 두면
 * 다음 상태 변경이 **엉뚱한 줄**에 적힌다. 그래서 그 달 사본을 비워
 * 다음에 화면을 열 때 새로 받아오게 한다.
 */
export async function removeEntry(sheetName, row) {
  const result = await callAppsScript(
    { reports: 'delete', sheetName, row }, 30000);
  await store.setMeta(CACHE_PREFIX + sheetName, null);
  return result;
}

/** 대기열에 쌓인 상태 변경을 시트에 반영한다 (sync.js 가 부른다). */
export async function pushStatusOps(ops) {
  for (const op of ops) {
    await callAppsScript({
      reports: 'status', sheetName: op.sheetName, row: op.row, status: op.status,
    }, 30000);
  }
  return { sent: ops.length };
}

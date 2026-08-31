// 리포트 이력 — 구글 시트의 월별 탭을 읽어 오고, 상태 칸을 고쳐 쓴다.
//
// 시트가 원본이다. 앱은 마지막으로 읽어 온 내용을 기기에 담아 두었다가
// 오프라인이면 그것을 보여 준다. 상태 변경은 오프라인이면 대기열에 쌓았다가
// 연결될 때 시트에 반영한다.
import * as store from './local/store.js';
import { callAppsScript, STATUS_VALUES, DEFAULT_STATUS } from './sheets.js';

const CACHE_PREFIX = 'sheetReports:';
const MONTHS_KEY = 'sheetReportMonths';

/** '2026-08' 처럼 이번 달 이름 */
export function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

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

  await patchCache(sheetName, row, status);

  const op = { type: 'report-status', sheetName, row, status };
  try {
    await callAppsScript({ reports: 'status', sheetName, row, status }, 30000);
    return { queued: false, status };
  } catch (err) {
    if (err && err.offline) {
      await store.enqueue(op);
      return { queued: true, status };
    }
    throw err;
  }
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

/** 대기열에 쌓인 상태 변경을 시트에 반영한다 (sync.js 가 부른다). */
export async function pushStatusOps(ops) {
  for (const op of ops) {
    await callAppsScript({
      reports: 'status', sheetName: op.sheetName, row: op.row, status: op.status,
    }, 30000);
  }
  return { sent: ops.length };
}

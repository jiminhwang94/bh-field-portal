// 구글 시트 업로드 — 기기에서 Apps Script 웹 앱으로 **직접** 보낸다.
//
// 사무실 서버를 거치지 않으므로 현장 LTE 에서도 업로드된다.
// (서버 app/sheets.py 의 전송 형식과 동일하게 맞춘다)
import * as store from './local/store.js';
import { serverRequest, isOnline, OfflineError } from './sync.js';

const META_HEADERS = ['작성일시', '작성자'];

/** 첨부는 드라이브에 저장한다 — 한 건당 20MB, 리포트 하나당 25MB 까지. */
const MEDIA_FILE_LIMIT = 20 * 1024 * 1024;
const MEDIA_TOTAL_LIMIT = 25 * 1024 * 1024;

/**
 * 이력 화면의 추적 상태 — 시트 맨 뒤 '상태' 열에 기록된다.
 *
 * 작성 화면의 [처리 결과]와는 다른 것이다.
 * 처리 결과 = 그날 현장에서 확정된 사실 (나중에 바뀌지 않는다)
 * 상태      = 지금 이 건이 어디까지 왔는가 (시간이 지나며 바뀐다)
 * 그래서 열을 따로 두고, 첫 값만 처리 결과에서 가져와 채운다.
 */
export const STATUS_HEADER = '상태';
export const STATUS_VALUES = ['조치 완료', '모니터링', '조치 진행 중', '교체 예정'];
export const DEFAULT_STATUS = '조치 진행 중';

const RESULT_TO_STATUS = {
  '완료': '조치 완료',
  '재방문 필요': '조치 진행 중',
  '부품 대기': '교체 예정',
  '모니터링': '모니터링',
};

/** 리포트에서 매장(식당) 이름을 찾는다 — 드라이브 폴더 이름으로 쓴다. */
function findStoreName(reportPayload) {
  for (const item of reportPayload || []) {
    const label = String(item.label || '');
    if (label.includes('식당') || label.includes('매장')) {
      const value = String(item.value || '').trim();
      if (value) return value;
    }
  }
  return '';
}

/** 작성 시 고른 [처리 결과]로 첫 상태를 정한다. 못 찾으면 '조치 진행 중'. */
export function seedStatus(reportPayload) {
  for (const item of reportPayload || []) {
    if (!String(item.label || '').includes('처리 결과')) continue;
    const mapped = RESULT_TO_STATUS[String(item.value || '').trim()];
    if (mapped) return mapped;
  }
  return DEFAULT_STATUS;
}

export class SheetsError extends Error {}

export function spreadsheetUrl(settings) {
  const id = (settings.sheetsSpreadsheetId || '').trim();
  return id ? `https://docs.google.com/spreadsheets/d/${id}/edit` : '';
}

export function extractSpreadsheetId(value) {
  const text = (value || '').trim();
  if (!text) return '';
  const marker = '/spreadsheets/d/';
  if (text.includes(marker)) {
    return text.split(marker)[1].split('/')[0].split('?')[0];
  }
  return text;
}

function monthSheetName(createdAt) {
  const text = (createdAt || '').trim();
  if (text.length >= 7 && text[4] === '-') return text.slice(0, 7);
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error('사진을 읽지 못했습니다.'));
    reader.readAsDataURL(blob);
  });
}

/**
 * 리포트를 시트 한 줄 + 드라이브 첨부로 만든다.
 *
 * 첨부(사진·영상·PDF)는 시트에 박아 넣지 않고 드라이브에 올린 뒤 칸에 링크만 남긴다.
 * 그래야 영상도 올라가고, 이력 화면이 그 링크로 썸네일을 그릴 수 있다.
 */
export async function buildPayload(report, fields, deviceName) {
  const labels = fields.map((f) => f.fieldLabel);
  const byLabel = new Map();
  for (const item of report.payload || []) {
    byLabel.set(item.label, item);
    if (item.label && !labels.includes(item.label)) labels.push(item.label);
  }

  const headers = [...META_HEADERS, ...labels, STATUS_HEADER];
  const row = [
    (report.createdAt || '').replace('T', ' '),
    (deviceName || '').trim() || '-',
  ];
  const media = [];
  const skipped = [];
  let budget = MEDIA_TOTAL_LIMIT;
  // 첨부는 공유 드라이브의 사진/동영상 → 매장 → 날짜 폴더로 들어간다.
  const storeName = findStoreName(report.payload);
  const dateText = (report.createdAt || '').slice(0, 10);

  for (let index = 0; index < labels.length; index += 1) {
    const column = META_HEADERS.length + index + 1;      // 1-based 열 번호
    const item = byLabel.get(labels[index]);
    if (!item) { row.push(''); continue; }
    if (item.type !== 'MEDIA') {
      row.push(item.value === null || item.value === undefined ? '' : String(item.value));
      continue;
    }
    for (const attachment of item.media || []) {
      const filename = (attachment.filename || '').replace(/^.*\//, '');
      if (!filename) continue;
      const blob = await store.getMediaBlob(filename);
      if (!blob) { skipped.push({ filename, reason: '기기에 파일 없음' }); continue; }
      if (blob.size > MEDIA_FILE_LIMIT) {
        skipped.push({ filename, reason: '파일 하나가 20MB 를 넘음' }); continue;
      }
      if (blob.size > budget) {
        skipped.push({ filename, reason: '리포트 전체 용량 25MB 초과' }); continue;
      }
      budget -= blob.size;
      media.push({
        column,
        filename: attachment.originalName || filename,
        mimeType: attachment.mime || blob.type || 'application/octet-stream',
        storeName,
        dateText,
        data: await blobToBase64(blob),
      });
    }
    row.push('');            // 링크는 Apps Script 가 드라이브에 올린 뒤 채운다
  }

  row.push(seedStatus(report.payload));

  return {
    sheetName: monthSheetName(report.createdAt),
    headers, row, media, mediaSkipped: skipped,
  };
}

/** Apps Script 로 직접 POST. 사전 요청(preflight)을 피하려고 text/plain 으로 보낸다. */
async function postDirect(endpoint, payload, timeout = 120000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  let res;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      redirect: 'follow',
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  const body = await res.text();
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new SheetsError(
        '구글이 접근을 거부했습니다 (권한).\n'
        + "Apps Script 배포 시 [액세스 권한]을 '모든 사용자'로 설정했는지 확인하세요.");
    }
    throw new SheetsError(`구글 시트 오류 ${res.status}: ${body.slice(0, 200)}`);
  }
  let result;
  try {
    result = JSON.parse(body);
  } catch {
    if (body.toLowerCase().includes('<html')) {
      throw new SheetsError(
        '웹 앱 URL 이 올바르지 않거나 로그인이 필요한 상태입니다.\n'
        + "Apps Script → [배포 관리]에서 '웹 앱' URL(/exec 로 끝남)을 복사하고, "
        + "액세스 권한을 '모든 사용자'로 설정하세요.");
    }
    throw new SheetsError(`구글 응답을 해석할 수 없습니다: ${body.slice(0, 200)}`);
  }
  if (!result.ok) {
    throw new SheetsError(`구글 시트 기록 실패: ${result.error || JSON.stringify(result)}`);
  }
  return result;
}

function checkEndpoint(endpoint) {
  if (!endpoint) {
    throw new SheetsError(
      '구글 시트 연결이 아직 설정되지 않았습니다.\n'
      + '[⚙️ 설정 → 구글 시트 연결]에서 Apps Script 웹 앱 URL 을 등록하세요.');
  }
  const local = endpoint.startsWith('http://localhost')
    || endpoint.startsWith('http://127.0.0.1');
  if (!endpoint.startsWith('https://') && !local) {
    throw new SheetsError('웹 앱 URL 은 https:// 로 시작해야 합니다.');
  }
}

/**
 * Apps Script 웹 앱 호출 — 어떤 payload 든 보낸다 (리포트·재고 동기화 공용).
 * 1순위 = 기기에서 구글로 직접, 실패하면 2순위 = 사무실 서버 경유.
 */
export async function callAppsScript(payload, timeout = 60000) {
  if (!isOnline()) {
    throw new OfflineError(
      '오프라인입니다. 인터넷에 연결되면 자동으로 처리됩니다.');
  }
  const settings = await store.getSettings();
  const endpoint = (settings.sheetsWebappUrl || '').trim();
  checkEndpoint(endpoint);
  try {
    return await postDirect(endpoint, payload, timeout);
  } catch (err) {
    if (err instanceof SheetsError) throw err;
    // 브라우저가 구글로의 직접 요청을 막은 경우 → 사무실 서버를 통해 보낸다.
    const result = await serverRequest('POST', '/api/sheets/relay',
                                       { endpoint, payload }, { timeout });
    if (!result || !result.ok) {
      throw new SheetsError(
        '구글 시트로 보내지 못했습니다. 인터넷 연결을 확인해 주세요.');
    }
    return result;
  }
}

/** 리포트를 시트에 올린다. */
export async function uploadReport(report) {
  const fields = await store.listFields();
  const deviceName = localStorage.getItem('bh_device_name') || '';
  const payload = await buildPayload(report, fields, deviceName);

  // 이미 시트에 있는 줄을 손보는 중이면 그 줄을 고쳐 쓴다.
  // 새로 올리면 같은 방문이 두 줄이 된다.
  const link = report.sheetLink;
  const editing = link && link.sheetName && link.row;
  const result = editing
    ? await callAppsScript({
      reports: 'update',
      sheetName: link.sheetName,
      row: link.row,
      headers: payload.headers,
      row_values: payload.row,
      media: payload.media,
    }, 120000)
    : await callAppsScript(payload, 120000);

  await store.markReport(report.id, {
    status: 'UPLOADED',
    sheetName: result.sheetName || payload.sheetName,
    sheetRow: result.row || null,
    errorMessage: null,
  });
  return {
    sheetName: result.sheetName || payload.sheetName,
    row: result.row,
    created: Boolean(result.created),
    media: Number(result.media || 0),
    mediaSkipped: [...payload.mediaSkipped, ...(result.mediaSkipped || [])],
    // 공유 드라이브에 못 닿으면 개인 드라이브로 간다 — 그대로 두면 안 되므로 알린다.
    mediaShared: result.mediaShared !== false,
    spreadsheetUrl: spreadsheetUrl(await store.getSettings()),
  };
}

/** 설정 화면의 [연결 테스트] */
export async function testConnection() {
  const settings = await store.getSettings();
  const result = await callAppsScript({ ping: true }, 30000);
  return {
    ok: true,
    spreadsheetName: result.spreadsheetName || '',
    spreadsheetUrl: result.spreadsheetUrl || spreadsheetUrl(settings),
    sheets: result.sheets || [],
    drive: result.drive || null,
  };
}

/** 사람이 읽는 용량 문자열 */
export function formatBytes(n) {
  if (n === null || n === undefined) return '-';
  const gb = n / 1073741824;
  if (gb >= 1) return `${gb.toFixed(1)}GB`;
  return `${Math.round(n / 1048576)}MB`;
}

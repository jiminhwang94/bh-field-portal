// 서버 REST API 래퍼
// 모든 요청에 기기 ID 를 함께 보낸다 (기기별 작업본을 구분하기 위함).
const DEVICE_KEY = 'bh_device_id';

function deviceId() {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = 'd' + Math.random().toString(36).slice(2, 10)
      + Math.random().toString(36).slice(2, 6);
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

let onUnauthorized = null;
export function setUnauthorizedHandler(fn) { onUnauthorized = fn; }

async function request(method, path, body) {
  const opts = { method, headers: { 'X-Device-Id': deviceId() },
                 credentials: 'same-origin' };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(path, opts);
  } catch {
    throw new Error('서버에 연결할 수 없습니다. 인터넷 연결을 확인하세요.');
  }
  const text = await res.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = null; }
  }
  if (!res.ok) {
    // PIN 이 새로 설정되었거나 만료된 경우 잠금 화면을 띄운다.
    if (res.status === 401 && onUnauthorized && !path.startsWith('/api/auth')) {
      onUnauthorized();
    }
    const error = new Error((data && data.error) || `요청 실패 (${res.status})`);
    error.status = res.status;
    throw error;
  }
  return data;
}

export const api = {
  deviceId,

  version: () => request('GET', '/api/version'),

  authStatus: () => request('GET', '/api/auth/status'),
  authLogin: (pin) => request('POST', '/api/auth', { pin }),
  meta: () => request('GET', '/api/meta'),

  // 업데이트(모든 사용자에게 적용)
  state: () => request('GET', '/api/state'),
  publish: (deviceName) => request('POST', '/api/publish', { deviceName }),
  takeLatest: () => request('POST', '/api/take-latest'),

  listGuides: (type, q) => {
    const params = new URLSearchParams();
    if (type) params.set('type', type);
    if (q) params.set('q', q);
    const qs = params.toString();
    return request('GET', `/api/guides${qs ? '?' + qs : ''}`);
  },
  getGuide: (id) => request('GET', `/api/guides/${id}`),
  createGuide: (payload) => request('POST', '/api/guides', payload),
  updateGuide: (id, payload) => request('PUT', `/api/guides/${id}`, payload),
  deleteGuide: (id) => request('DELETE', `/api/guides/${id}`),

  listVehicles: () => request('GET', '/api/vehicles'),
  addVehicle: (name) => request('POST', '/api/vehicles', { name }),
  deleteVehicle: (name) => request('DELETE', `/api/vehicles/${encodeURIComponent(name)}`),

  listInventory: (vehicle) => request(
    'GET', `/api/inventory${vehicle ? '?vehicle=' + encodeURIComponent(vehicle) : ''}`),
  addInventory: (payload) => request('POST', '/api/inventory', payload),
  patchInventory: (id, payload) => request('PATCH', `/api/inventory/${id}`, payload),
  deleteInventory: (id) => request('DELETE', `/api/inventory/${id}`),

  listFields: () => request('GET', '/api/report-fields'),
  createField: (payload) => request('POST', '/api/report-fields', payload),
  updateField: (id, payload) => request('PUT', `/api/report-fields/${id}`, payload),
  deleteField: (id) => request('DELETE', `/api/report-fields/${id}`),
  reorderFields: (ids) => request('POST', '/api/report-fields/reorder', { ids }),

  listReports: () => request('GET', '/api/reports'),
  getReport: (id) => request('GET', `/api/reports/${id}`),
  createReport: (payload) => request('POST', '/api/reports', payload),
  updateReport: (id, payload) => request('PUT', `/api/reports/${id}`, payload),
  deleteReport: (id) => request('DELETE', `/api/reports/${id}`),
  uploadReportToSheet: (id) => request('POST', `/api/reports/${id}/sheet`),

  getSettings: () => request('GET', '/api/settings'),
  saveSettings: (payload) => request('PUT', '/api/settings', payload),
  testSheets: () => request('POST', '/api/settings/sheets-test'),

  async uploadMedia(file) {
    const url = `/api/media?filename=${encodeURIComponent(file.name || 'upload')}`;
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
          'X-Device-Id': deviceId(),
        },
        body: file,
      });
    } catch {
      throw new Error('업로드 중 네트워크 오류가 발생했습니다.');
    }
    const text = await res.text();
    let data = null;
    if (text) { try { data = JSON.parse(text); } catch { data = null; } }
    if (!res.ok) throw new Error((data && data.error) || '업로드 실패');
    return data;
  },
};

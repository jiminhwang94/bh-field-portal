// 기기 저장소 — 리포트 · 사진.
// (store.js 가 전부 다시 내보낸다 — 밖에서는 store.js 만 부른다)
import * as idb from './idb.js';
import { testMode } from '../mode.js';
import { byText, newId, now } from './store-core.js';

// ------------------------------------------------------------- 리포트

const reportOut = (r) => ({
  id: r.id, title: r.title, payload: r.payload || [], status: r.status,
  sheetName: r.sheetName || null, sheetRow: r.sheetRow || null,
  // 이력에서 [이어서 작성] 으로 온 경우, 고쳐 쓸 시트 줄
  sheetLink: r.sheetLink || null,
  errorMessage: r.errorMessage || null,
  createdAt: r.createdAt, updatedAt: r.updatedAt,
});

export async function listReports(limit = 100) {
  const rows = await idb.getAll('reports');
  rows.sort((a, b) => byText(b.createdAt, a.createdAt));
  return rows.slice(0, limit).map(reportOut);
}

export async function getReport(id) {
  const row = await idb.get('reports', id);
  return row ? reportOut(row) : null;
}

export async function saveReport(payload, reportId = null) {
  const values = payload.values || [];
  let title = (payload.title || '').trim();
  if (!title) {
    for (const item of values) {
      if (['TEXT', 'TEXTAREA'].includes(item.type) && item.value) {
        title = String(item.value).split('\n')[0].slice(0, 80);
        break;
      }
    }
  }
  if (!title) title = `현장 리포트 ${now()}`;

  const stamp = now();
  const existing = reportId ? await idb.get('reports', reportId) : null;
  if (reportId && !existing) throw new Error('리포트를 찾을 수 없습니다.');

  const row = {
    id: reportId || newId(),
    title,
    payload: values,
    status: existing ? existing.status : 'DRAFT',
    sheetLink: payload.sheetLink !== undefined
      ? payload.sheetLink : (existing ? existing.sheetLink : null),
    sheetName: existing ? existing.sheetName : null,
    sheetRow: existing ? existing.sheetRow : null,
    errorMessage: existing ? existing.errorMessage : null,
    createdAt: existing ? existing.createdAt : stamp,
    updatedAt: stamp,
  };
  await idb.put('reports', row);        // 리포트는 기기 전용 — 시트에 올릴 때만 밖으로 나간다
  return reportOut(row);
}

export async function markReport(reportId, patch) {
  const row = await idb.get('reports', reportId);
  if (!row) return null;
  const next = { ...row, ...patch, updatedAt: now() };
  await idb.put('reports', next);
  return reportOut(next);
}

export async function deleteReport(id) {
  const row = await idb.get('reports', id);
  if (!row) return false;
  await idb.remove('reports', id);
  await pruneOrphanMedia();
  return true;
}

// --------------------------------------------------------------- 사진

/** 파일을 기기에 저장하고 서버와 동일한 모양의 정보를 돌려준다. */
export async function saveMedia(file) {
  const ext = (file.name || '').includes('.')
    ? '.' + file.name.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '')
    : ((file.type || '').startsWith('video/') ? '.mp4'
      : ((file.type || '').includes('png') ? '.png' : '.jpg'));
  const filename = `${Date.now().toString(36)}-${newId().slice(0, 8)}${ext}`;
  const row = {
    filename,
    blob: file,
    mime: file.type || 'application/octet-stream',
    originalName: file.name || 'upload',
    size: file.size || 0,
    createdAt: now(),
    localOnly: true,          // 아직 서버에 올리지 않음
  };
  await idb.put('media', row);
  return { id: filename, filename, originalName: row.originalName,
           mime: row.mime, size: row.size, url: `/media/${filename}` };
}

export async function getMediaBlob(filename) {
  const row = await idb.get('media', filename);
  return row ? row.blob : null;
}

/** 어디에서도 참조하지 않는 사진을 정리한다. */
export async function pruneOrphanMedia() {
  const used = new Set();
  for (const guide of await idb.getAll('guides')) {
    for (const step of guide.steps || []) {
      const url = step.imageUrl || '';
      if (url.startsWith('/media/')) used.add(url.slice('/media/'.length));
    }
  }
  for (const report of await idb.getAll('reports')) {
    for (const item of report.payload || []) {
      for (const media of item.media || []) {
        if (media.filename) used.add(media.filename.replace(/^.*\//, ''));
      }
    }
  }
  // 아직 저장하지 않은 작성 중 리포트의 첨부도 쓰이는 중이다.
  // (임시보관은 localStorage 에 있어 위 조회에 잡히지 않는다)
  try {
    const draft = JSON.parse(localStorage.getItem('bh_report_draft') || 'null');
    for (const entry of Object.values((draft && draft.values) || {})) {
      for (const media of (entry && entry.media) || []) {
        if (media.filename) used.add(media.filename.replace(/^.*\//, ''));
      }
    }
  } catch { /* 임시보관이 깨져 있으면 무시한다 */ }
  let deleted = 0;
  for (const media of await idb.getAll('media')) {
    if (used.has(media.filename)) continue;
    // 방금 올려 아직 리포트에 담기지 않은 파일은 남긴다(10분).
    const age = Date.now() - new Date(media.createdAt || 0).getTime();
    if (age < 600000) continue;
    await idb.remove('media', media.filename);
    deleted += 1;
  }
  return { deleted };
}

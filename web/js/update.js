// 앱 코드 자동 갱신
// 데이터 반영은 [업데이트] 가 담당하고, 이 모듈은 "앱 화면 코드"만 본다.
// 별도 업데이트 버튼 없이, 새 빌드가 감지되면 안전한 시점에 조용히 새로 받아온다.
import { api } from './api.js';

const CHECK_INTERVAL_MS = 3 * 60 * 1000;

let loaded = null;
let latest = null;
let pending = false;

export function getBuildInfo() {
  return { loaded, latest, hasUpdate: hasUpdate() };
}

function hasUpdate() {
  return !!(loaded && latest && latest.buildHash !== loaded.buildHash);
}

/** 지금 새로고침해도 사용자의 작업을 방해하지 않는지 판단. */
function safeToReload() {
  if (document.getElementById('modalRoot').innerHTML) return false;   // 모달 열림
  if (location.hash.startsWith('#/report/new')) return false;         // 리포트 작성 중
  if (location.hash.startsWith('#/guides/new')) return false;         // 가이드 작성 중
  if (location.hash.startsWith('#/guides/edit')) return false;
  const active = document.activeElement;
  if (active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) return false;
  return true;
}

export async function applyUpdate() {
  try {
    if (window.caches && caches.keys) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
  } catch { /* 캐시 API 미지원 환경은 무시 */ }
  const stamp = (latest && latest.buildHash) || Date.now();
  location.replace(`${location.pathname}?v=${stamp}${location.hash}`);
}

export async function checkForUpdate() {
  try {
    const info = await api.version();
    if (!loaded) loaded = info;
    latest = info;
    if (hasUpdate()) {
      pending = true;
      if (safeToReload()) applyUpdate();
    }
    return info;
  } catch {
    return null;
  }
}

export function initUpdateWatcher() {
  checkForUpdate();
  setInterval(checkForUpdate, CHECK_INTERVAL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkForUpdate();
  });
  // 작업을 마치고 화면을 옮길 때 보류 중인 갱신을 적용한다.
  window.addEventListener('hashchange', () => {
    if (pending && safeToReload()) applyUpdate();
  });
}

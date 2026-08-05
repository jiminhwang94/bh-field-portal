// 최근 본 가이드 기기 보관 (D-4)
// 서비스워커 없이 localStorage 만 사용한다. 신호가 끊겨도 "방금 보던 가이드"는 열린다.
const KEY = 'bh_recent_guides';
const LIMIT = 20;

function load() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function save(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, LIMIT)));
  } catch {
    // 저장 공간이 부족하면 절반만 남기고 재시도
    try {
      localStorage.setItem(KEY, JSON.stringify(list.slice(0, Math.floor(LIMIT / 2))));
    } catch { /* 포기 */ }
  }
}

/** 가이드 상세를 열 때마다 기기에 보관 (최근 20개, 최신 우선) */
export function rememberGuide(guide) {
  if (!guide || !guide.id) return;
  const list = load().filter((g) => g.id !== guide.id);
  list.unshift({ ...guide, __savedAt: new Date().toISOString() });
  save(list);
}

export function recentGuides() {
  return load();
}

export function recentGuide(id) {
  return load().find((g) => g.id === id) || null;
}

/** 오프라인 검색: 보관된 가이드에서 제목·요약·공구·명령어·단계 본문을 훑는다. */
export function searchRecent(query, type = null) {
  const needle = (query || '').trim().toLowerCase();
  return load().filter((guide) => {
    if (type && guide.categoryType !== type) return false;
    if (!needle) return true;
    const steps = (guide.steps || [])
      .map((s) => `${s.instruction || ''} ${s.expectedMetric || ''}`).join(' ');
    const haystack = [
      guide.codeOrTitle, guide.summary, guide.requiredTools,
      JSON.stringify(guide.commands || []), steps,
    ].join(' ').toLowerCase();
    return haystack.includes(needle);
  });
}

export function recentCount() {
  return load().length;
}

export function clearRecent() {
  localStorage.removeItem(KEY);
}

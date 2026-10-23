// 이력 · 가이드 · 재고를 서로 잇는 도우미 — 매장별 이력 · 통계 · 리포트↔가이드 · 사용 부품.
//
// 전부 **기기에 받아 둔 사본**으로 계산한다 (오프라인에서도 된다). 없는 달은 시트에서
// 한 번 받아 오고, 그 뒤로는 사본을 쓴다.
import { api } from './api.js';

/** 오류 코드 비교용 — 'E-101' · 'e101' · 'E 101' 을 같은 것으로 본다 */
export const normCode = (value) => String(value || '').toUpperCase().replace(/[\s_-]+/g, '').trim();

/** 오류 코드 가이드의 맨 앞 낱말이 코드다 ('E-101 로더 모터 과전류' → 'E-101') */
export const guideCode = (g) => String((g && g.codeOrTitle) || '').trim().split(/\s+/)[0] || '';

/** 리포트의 오류 코드에 맞는 가이드 (여러 개일 수 있다 — 로봇마다) */
export function guidesForCode(code, guides) {
  const want = normCode(code);
  if (want.length < 2) return [];
  return (guides || []).filter((g) => g.categoryType === 'ERROR_CODE' && normCode(guideCode(g)) === want);
}

/** 리포트 값 중 이름표에 낱말이 든 칸 ('로봇 모델' · '사용 부품' …) */
export function valueOf(entry, needle) {
  const hit = ((entry && entry.values) || []).find((v) => String(v.label || '').includes(needle));
  return hit ? String(hit.value || '').trim() : '';
}

/**
 * '사용 부품' 칸을 부품 목록으로 — '진공 패드 ×2, 가스게이지' · '패드 x2' · '패드 2개' 모두 읽는다.
 * @returns {{ name: string, n: number }[]}
 */
export function parseParts(text) {
  const out = new Map();
  for (const raw of String(text || '').split(/[,\n·/]+/)) {
    const t = raw.trim();
    if (!t) continue;
    const m = t.match(/^(.*?)\s*(?:[×xX*]\s*(\d+)|(\d+)\s*개)\s*$/);
    const name = (m ? m[1] : t).trim();
    const n = m ? Number(m[2] || m[3]) || 1 : 1;
    if (name) out.set(name, (out.get(name) || 0) + n);
  }
  return [...out].map(([name, n]) => ({ name, n }));
}

/** 부품 목록을 '사용 부품' 칸 글자로 (parseParts 의 반대) */
export const partsText = (list) => list.map((p) => (p.n > 1 ? `${p.name} ×${p.n}` : p.name)).join(', ');

/** 작성한 날부터 며칠째 (작성일 = 1일째) */
export function openDays(entry) {
  const at = new Date(String(entry.createdAt || entry.date || '').replace(' ', 'T'));
  if (Number.isNaN(at.getTime())) return 0;
  return Math.floor((Date.now() - at.getTime()) / 86400000) + 1;
}

const monthName = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/** 최근 n 달의 이름 (이번 달부터 거꾸로) */
export function recentMonths(n) {
  const out = [];
  const d = new Date();
  d.setDate(1);
  for (let i = 0; i < n; i += 1) {
    out.push(monthName(d));
    d.setMonth(d.getMonth() - 1);
  }
  return out;
}

/**
 * 최근 n 달의 이력을 모은다. 받아 둔 사본을 먼저 쓰고, 없는 달만 시트에서 받는다.
 * 시트에 그 달 탭이 없으면 빈 달로 친다.
 * @returns {Promise<{ entries: any[], months: string[], missing: string[] }>}
 */
export async function loadEntries(n = 3) {
  const all = (await api.sheetMonths(false).catch(() => [])) || [];
  const months = recentMonths(n).filter((m) => !all.length || all.includes(m) || m === recentMonths(1)[0]);
  const entries = [];
  const missing = [];
  for (const m of months) {
    try {
      const data = await api.sheetReports(m, false);
      if (data && data.error && !(data.entries || []).length) missing.push(m);
      entries.push(...((data && data.entries) || []));
    } catch {
      missing.push(m);
    }
  }
  entries.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  return { entries, months, missing };
}

/** 매장 이름 비교용 (띄어쓰기 · 대소문자 무시) */
export const storeKey = (name) => String(name || '').replace(/\s+/g, '').toLowerCase();

/** 개수 세기 → 많은 차례 [이름, 수] */
export function tally(items) {
  const m = new Map();
  for (const k of items) if (k) m.set(k, (m.get(k) || 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), 'ko'));
}

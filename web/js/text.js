// 글자 비교 도우미 — 여러 화면에 조금씩 다르게 다섯 벌 있던 것을 하나로 (v3.49)

/** 빈칸을 모두 뺀다 ('리포트 번호' → '리포트번호') — 항목 이름 · 같은 이름 맞추기 */
export const noSpace = (t) => String(t || '').replace(/\s/g, '');

/** 빈칸을 빼고 소문자로 ('Gen 1' → 'gen1') — 검색 · 비슷한 이름 찾기 */
export const fold = (t) => String(t || '').toLowerCase().replace(/\s+/g, '');

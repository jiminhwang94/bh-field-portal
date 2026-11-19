// 매일 상태 점검 결과를 사람이 읽는 글로 바꾼다 (.github/workflows/health.yml 이 부른다).
//
//   node tools/health_report.mjs health.json [오늘 YYYY-MM-DD]
//
// 문제가 있으면 글을 찍고 1 로 끝난다 → 워크플로가 GitHub 이슈로 알린다.
// 문제가 없으면 한 줄만 찍고 0.
import { readFileSync } from 'node:fs';

const file = process.argv[2] || 'health.json';
const today = process.argv[3] || new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);

let h;
try {
  h = JSON.parse(readFileSync(file, 'utf8'));
} catch {
  h = { ok: false, error: '서버 응답을 읽지 못했습니다 (JSON 이 아님 — 주소 · 배포 상태를 확인하세요)' };
}

const problems = [];
if (!h.ok) {
  problems.push(`서버가 답하지 않거나 오류를 냈습니다: ${h.error || '알 수 없음'}`);
} else {
  if (h.errors24h > 0) problems.push(`지난 24시간 기기 오류 **${h.errors24h}건** — 시트의 [오류기록] 탭을 보세요.`);
  if (h.devicesWithPending > 0) problems.push(`올리지 못한 것이 남은 기기 **${h.devicesWithPending}대** — 시트의 [기기] 탭 '올리지 못한 것' 칸을 보세요.`);
  const days = h.lastBackup ? Math.round((Date.parse(today) - Date.parse(h.lastBackup)) / 86400000) : null;
  if (days === null || days > 2) {
    problems.push(`매일 백업이 ${h.lastBackup ? `${days}일째` : '한 번도'} 안 됐습니다 (마지막: ${h.lastBackup || '없음'}). 백업은 태블릿이 앱을 켜 두어야 돕니다.`);
  }
}

if (!problems.length) {
  console.log(`이상 없음 · ${h.at} 기준 · 마지막 백업 ${h.lastBackup}`);
  process.exit(0);
}
console.log(`### 현장 포털 상태 점검 · ${today}\n`);
for (const p of problems) console.log(`- ${p}`);
console.log(`\n<sub>${h.at ? `${h.at} 기준 · ` : ''}매일 오전 8시 자동 점검 (.github/workflows/health.yml). 숫자만 받습니다 — 내용은 시트에서 보세요.</sub>`);
process.exit(1);

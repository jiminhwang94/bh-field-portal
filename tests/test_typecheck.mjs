/**
 * 타입 검사 — 화면 코드 전체를 TypeScript 검사기로 읽는다 (jsconfig.json).
 *
 * 빌드 단계는 없다. 코드는 그대로 브라우저에서 돈다. 검사기는 "없는 이름을 부른다",
 * "숫자 자리에 글자를 넣는다" 같은 실수를 실행 전에 잡는다. 처음 켰을 때 실제로
 * [이어서 작성] 버튼이 없는 이름(NEW_DRAFT_KEY)을 불러 아무 일도 안 하던 것을 잡았다.
 *
 * 실행: node tests/test_typecheck.mjs   (npm install 을 안 했으면 건너뛴다)
 */
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const tsc = join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
if (!existsSync(tsc)) {
  console.log('⏭  typescript 가 없어 건너뜁니다 (npm install 뒤에 돕니다)');
  process.exit(0);
}
const run = spawnSync(process.execPath, [tsc, '-p', 'jsconfig.json'], { cwd: ROOT, encoding: 'utf8' });
const out = `${run.stdout || ''}${run.stderr || ''}`.trim();
if (run.status !== 0) {
  console.log(out.split('\n').slice(0, 40).join('\n'));
  console.log(`❌ 타입 검사 실패 (${(out.match(/error TS/g) || []).length}건)`);
  process.exit(1);
}
console.log('✅ 타입 검사 통과 — web/js 전체');

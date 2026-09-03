/**
 * 화면 코드가 **브라우저에서 실제로 읽히는지** 확인한다.
 *
 * 왜 따로 있나 — `node --check` 를 믿을 수 없기 때문이다.
 * 문자열 한복판에 진짜 줄바꿈이 들어가 파일이 깨졌는데도
 * `node --check web/js/sheets.js` 는 **아무 말 없이 통과**했다.
 * 브라우저에서만 `SyntaxError: Invalid or unexpected token` 이 나고
 * 화면이 통째로 하얘진다 — 이 저장소에서 다섯 번 났다.
 *
 * 여기서는 파일을 **ES 모듈로 진짜 파싱**한다. 브라우저와 같은 방식이라
 * 깨진 문자열이 반드시 걸린다.
 *
 * 실행: node tests/test_js_parses.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const JS_DIR = join(ROOT, 'web', 'js');

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (name.endsWith('.js')) out.push(full);
  }
  return out;
}

const files = [...walk(JS_DIR), join(ROOT, 'web', 'sw.js')];
const failures = [];

console.log('='.repeat(62));
console.log('화면 코드가 브라우저에서 읽히는지 검사');
console.log('='.repeat(62));

for (const file of files) {
  const rel = relative(ROOT, file).replace(/\\/g, '/');
  const source = readFileSync(file, 'utf8');
  try {
    // sw.js 는 모듈이 아니라 일반 스크립트다.
    if (rel.endsWith('sw.js')) new vm.Script(source, { filename: rel });
    else new vm.SourceTextModule(source, { identifier: rel });
    console.log(`  OK   ${rel}`);
  } catch (err) {
    console.log(`  실패 ${rel}  — ${err.message}`);
    failures.push(rel);
  }
}

console.log('='.repeat(62));
if (failures.length) {
  console.log(`실패 ${failures.length}건: ${failures.join(', ')}`);
  console.log('문자열 한복판에 진짜 줄바꿈이 들어갔는지 확인하세요.');
  console.log("여러 줄 메시지는 배열 + join(String.fromCharCode(10)) 으로 만드세요.");
  process.exit(1);
}
console.log('전부 통과 — 브라우저가 읽을 수 있는 코드입니다.');

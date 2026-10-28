// 스타일 지문 — 화면마다 · 너비마다 요소의 계산된 스타일을 모아 기준과 비교한다.
//
// CSS 를 정리(파일 나누기 · 덮어쓰기 합치기)해도 **보이는 것은 하나도 안 바뀌어야** 한다.
// 기준 만들기:  STYLE_SNAPSHOT=write npx playwright test styles
// 비교:         npx playwright test styles     (기준 파일이 없으면 건너뛴다)
const fs = require('node:fs');
const path = require('node:path');
const { test, expect, openApp } = require('./fixtures.js');
const { seed, NOW, GUIDES } = require('./seed.js');

const FILE = path.join(__dirname, '.style-baseline.json');
const WIDTHS = [1400, 1180, 900, 375];
const SCREENS = [
  '#/', '#/report/new', '#/reports', '#/guides', '#/guides/assign', '#/guides/m/Gen.1/ERROR_CODE',
  `#/guides/${GUIDES[0].id}`, `#/guides/edit/${GUIDES[0].id}`, '#/driving', '#/inventory',
  '#/settings', '#/fields', '#/search?q=E',
];

// 보이는 모습을 정하는 속성만 (애니메이션 시간 같은 것은 뺀다)
const PROPS = ['display', 'position', 'width', 'height', 'margin', 'padding', 'border', 'border-radius',
  'background-color', 'background-image', 'color', 'font-size', 'font-weight', 'line-height', 'letter-spacing',
  'grid-template-columns', 'grid-template-rows', 'flex-direction', 'flex-wrap', 'gap', 'align-items',
  'justify-content', 'box-shadow', 'opacity', 'overflow', 'text-align', 'white-space', 'z-index', 'top', 'left',
  'outline', 'visibility', 'transform'];

async function fingerprint(page) {
  return page.evaluate((props) => {
    // 버전 숫자(v3.30.0 · 3.30.0)는 올릴 때마다 바뀐다 — 글자 폭이 달라져 스타일이 바뀐 것처럼
    // 보이지 않게 같은 글자로 덮고 잰다.
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      if (/\d+\.\d+\.\d+/.test(n.nodeValue)) n.nodeValue = n.nodeValue.replace(/\d+\.\d+\.\d+/g, '0.0.0');
    }
    const out = [];
    for (const el of document.querySelectorAll('body *')) {
      if (el.closest('svg') && el.tagName.toLowerCase() !== 'svg') continue;
      if (el.closest('.toast')) continue;     // 잠깐 떴다 사라지는 알림은 뺀다
      const cs = getComputedStyle(el);
      const id = `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}.${[...el.classList].join('.')}`;
      out.push(`${id} ${props.map((p) => cs.getPropertyValue(p)).join('|')}`);
    }
    return out;
  }, PROPS);
}

/**
 * 앱이 조용해질 때까지 기다린다 — 그래야 지문이 매번 같다.
 *
 * 화면을 연 뒤에도 앱은 뒤에서 움직인다: 접수 목록을 받아 카드를 갈아 끼우고(새 리포트),
 * 대기열을 올리며 상단바에 '올리는 중 N건' 칩을 띄웠다 숨기고, 알림을 몇 초 띄운다.
 * 그 사이에 재면 요소 수 · 상단바 빈칸 너비 · 알림 칸 높이가 실행마다 달라진다.
 * 그래서 ① 시트로 가는 요청이 다 끝나고 ② 칩이 숨고 알림이 사라진 뒤
 * ③ 지문을 두 번 연달아 떠서 같을 때 그 값을 쓴다.
 */
function trackRequests(page) {
  const inflight = new Set();
  let lastChange = Date.now();
  const done = (req) => { inflight.delete(req); lastChange = Date.now(); };
  page.on('request', (req) => { inflight.add(req); lastChange = Date.now(); });
  page.on('requestfinished', done);
  page.on('requestfailed', done);
  return {
    /** 요청이 하나도 없는 채로 quietMs 가 지날 때까지 */
    async idle(quietMs = 500, timeout = 15000) {
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        if (!inflight.size && Date.now() - lastChange >= quietMs) return;
        await page.waitForTimeout(100);
      }
      throw new Error(`요청이 끝나지 않습니다: ${[...inflight].map((r) => r.url()).join(', ')}`);
    },
  };
}

async function settledFingerprint(page, net) {
  let prev = null;
  for (let i = 0; i < 20; i++) {
    await net.idle();
    await expect(page.locator('#sync-chip')).toBeHidden({ timeout: 15000 });
    await expect(page.locator('#toasts .toast')).toHaveCount(0, { timeout: 15000 });
    const now = await fingerprint(page);
    if (prev && prev.join('\n') === now.join('\n')) return now;
    prev = now;
    await page.waitForTimeout(300);
  }
  throw new Error('화면이 멈추지 않습니다 — 지문이 계속 바뀝니다');
}

test('CSS 를 정리해도 계산된 스타일이 기준과 같다', async ({ page, sheet }) => {
  test.setTimeout(240_000);
  const writing = process.env.STYLE_SNAPSHOT === 'write';
  if (!writing && !fs.existsSync(FILE)) test.skip(true, '기준 파일이 없습니다');
  await seed(sheet);
  await page.clock.setFixedTime(NOW);
  const net = trackRequests(page);
  await openApp(page, '#/reports');             // 이력을 한 번 받아 둔다
  await expect(page.locator('.hist-row').first()).toBeVisible({ timeout: 15000 });
  await openApp(page, '#/inventory');
  await page.waitForTimeout(800);
  // 새 리포트 화면을 처음 열면 기본 이슈 유형을 대기열에 넣고(한 번만) 바로 올리지는 않는다.
  // 그대로 재면 그 뒤 화면마다 '올리는 중 1건' 칩이 떴다 말았다 한다 — 미리 열고 [새로고침] 으로 올려 둔다.
  // (새 리포트 화면에서는 그 자리에 업로드 버튼이 서므로 홈에서 누른다)
  await openApp(page, '#/report/new');
  await net.idle();
  await openApp(page, '#/');
  await page.locator('#btn-update').click();
  await expect(page.locator('#sync-chip')).toBeHidden({ timeout: 15000 });

  const result = {};
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 820 });
    for (const hash of SCREENS) {
      await page.goto(`/${hash}`);
      await expect(page.locator('#view')).not.toBeEmpty();
      result[`${width} ${hash}`] = await settledFingerprint(page, net);
    }
  }
  if (writing) {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(result, null, 0));
    return;
  }
  const base = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const diffs = [];
  for (const key of Object.keys(base)) {
    const a = base[key]; const b = result[key] || [];
    if (a.length !== b.length) { diffs.push(`${key}: 요소 수 ${a.length} → ${b.length}`); continue; }
    a.forEach((line, i) => { if (line !== b[i]) diffs.push(`${key}: ${line}\n    → ${b[i]}`); });
  }
  expect(diffs.slice(0, 15).join('\n')).toBe('');
});

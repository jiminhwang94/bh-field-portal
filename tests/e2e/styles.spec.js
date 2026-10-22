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

test('CSS 를 정리해도 계산된 스타일이 기준과 같다', async ({ page, sheet }) => {
  test.setTimeout(240_000);
  const writing = process.env.STYLE_SNAPSHOT === 'write';
  if (!writing && !fs.existsSync(FILE)) test.skip(true, '기준 파일이 없습니다');
  await seed(sheet);
  await page.clock.setFixedTime(NOW);
  await openApp(page, '#/reports');             // 이력을 한 번 받아 둔다
  await expect(page.locator('.hist-row').first()).toBeVisible({ timeout: 15000 });
  await openApp(page, '#/inventory');
  await page.waitForTimeout(800);

  const result = {};
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 820 });
    for (const hash of SCREENS) {
      await page.goto(`/${hash}`);
      await expect(page.locator('#view')).not.toBeEmpty();
      await page.waitForTimeout(400);
      result[`${width} ${hash}`] = await fingerprint(page);
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

/**
 * google-apps-script.gs 를 **실제로 실행해서** 검사한다.
 *
 * 이 파일은 구글 서버에서만 도는 코드라 여기서 돌려 볼 수 없었고, 그래서
 * 지금까지는 "같은 낱말을 쓰는지"만 확인했다(tests/test_report_history.py).
 * 그 사이 실제 버그가 두 번 통과했다.
 *
 *   - 헤더는 7칸인데 데이터는 6칸을 써서 setValues 가 예외를 던졌다.
 *     그 직전에 clearContents() 가 이미 실행돼 **탭이 비워진 채로 남았다.**
 *     가이드를 하나 고치면 그 분류 탭이 통째로 사라졌다.
 *   - ID 칸이 비어 있어 앱이 매번 "새 가이드"로 보고 복사본을 쌓았다.
 *     [업데이트] 를 누를 때마다 같은 가이드가 하나씩 늘었다.
 *
 * 가짜 SpreadsheetApp 을 만들어 실제 코드를 그대로 돌린다.
 * 실행: node tests/test_apps_script.mjs
 */
import { createFakeGas } from './fake_gas.mjs';
const failures = [];

function check(label, ok, detail = '') {
  console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(label);
}

// 가짜 SpreadsheetApp · DriveApp 등은 fake_gas.mjs 에 있다 (가짜 시트 서버와 함께 쓴다).
const env = createFakeGas();
const { gs, ss, call, findPath, fetchCalls, driveUpdates } = env;

console.log('='.repeat(62));
console.log('Apps Script 실제 실행 검사');
console.log('='.repeat(62));

// ─────────────────────────────────────────────── 가이드 왕복

const guides = [
  { id: 'g-aaa', categoryType: 'ERROR_CODE', codeOrTitle: 'E-101 로더 과전류',
    summary: '로더 축 과전류', requiredTools: '테스터',
    commands: [{ label: '상태 확인', cmd: 'bhctl status', desc: '먼저 확인' }],
    steps: [{ instruction: '커넥터를 확인한다', expectedMetric: '2.5V 이하' },
            { instruction: '벨트 장력을 재조정한다', expectedMetric: '' }],
    updatedAt: '2026-09-02T10:00:00' },
  { id: 'g-bbb', categoryType: 'HARDWARE_SOP', codeOrTitle: '그리퍼 패드 교체',
    summary: '패드 교체 절차', requiredTools: '육각 렌치',
    commands: [], steps: [{ instruction: '전원을 내린다', expectedMetric: '' }],
    updatedAt: '2026-09-02T10:05:00' },
];

let result = call({ guides: 'push', items: guides });
check('가이드를 시트에 쓸 수 있다 (칸 수가 맞는다)', result.ok === true,
      result.ok ? `${JSON.stringify(result.counts)}` : result.error);

const errSheet = ss.getSheetByName(gs.GUIDE_SHEETS.ERROR_CODE);
check('오류 코드 탭이 만들어졌다', !!errSheet);
check('탭이 비어 있지 않다 (쓰기 실패로 지워지지 않았다)',
      errSheet && errSheet.getLastRow() >= 3,
      errSheet ? `마지막 줄 ${errSheet.getLastRow()}` : '');

const header = errSheet.getRange(2, 1, 1, gs.GUIDE_HEADER.length).getValues()[0];
check('헤더에 ID 열이 있다', header.includes('ID(고치지 마세요)'), header.join(' · '));

const idCol = header.indexOf('ID(고치지 마세요)') + 1;
check('데이터 줄에 ID 가 실제로 적혀 있다',
      errSheet.getRange(3, idCol).getValue() === 'g-aaa',
      `읽은 값: "${errSheet.getRange(3, idCol).getValue()}"`);

// 되읽기
result = call({ guides: 'pull' });
check('가이드를 되읽을 수 있다', result.ok === true);
check('되읽은 건수가 같다', result.items.length === guides.length,
      `${result.items.length} / ${guides.length}`);

const back = result.items.find((g) => g.id === 'g-aaa');
check('되읽은 가이드의 ID 가 보존된다', !!back, back ? back.id : '못 찾음');
if (back) {
  check('제목이 보존된다', back.codeOrTitle === 'E-101 로더 과전류', back.codeOrTitle);
  check('명령어가 보존된다',
        back.commands.length === 1 && back.commands[0].cmd === 'bhctl status',
        JSON.stringify(back.commands));
  check('명령어 이름·설명이 보존된다',
        back.commands[0].label === '상태 확인' && back.commands[0].desc === '먼저 확인',
        JSON.stringify(back.commands[0]));
  check('단계가 보존된다 (번호는 떼고)',
        back.steps.length === 2 && back.steps[0].instruction === '커넥터를 확인한다',
        JSON.stringify(back.steps.map((s) => s.instruction)));
  check('기준값이 보존된다', back.steps[0].expectedMetric === '2.5V 이하',
        String(back.steps[0].expectedMetric));
}

// 여러 줄로 쓴 단계는 한 단계로 남는다 (예전: 줄마다 새 단계로 갈라졌다)
{
  const multi = [{ id: 'g-multi', categoryType: 'HARDWARE_SOP', robotModel: '', codeOrTitle: '여러 줄 단계',
    summary: '', requiredTools: '', commands: [], updatedAt: '',
    steps: [
      { instruction: '덮개를 연다\n나사 4개를 푼다\n1. 이 줄은 단계 안의 번호다', expectedMetric: '드라이버', imageUrl: '' },
      { instruction: '새 부품을 끼운다', expectedMetric: '', imageUrl: '' },
    ] }];
  call({ guides: 'push', items: multi });
  const got = call({ guides: 'pull' }).items.find((g) => g.id === 'g-multi');
  check('여러 줄 단계가 한 단계로 되읽힌다', !!got && got.steps.length === 2,
        got ? JSON.stringify(got.steps.map((s) => s.instruction)) : '못 찾음');
  check('여러 줄의 줄바꿈 · 단계 안 번호까지 그대로',
        !!got && got.steps[0].instruction === '덮개를 연다\n나사 4개를 푼다\n1. 이 줄은 단계 안의 번호다',
        got ? JSON.stringify(got.steps[0].instruction) : '');
  check('여러 줄 단계의 공구도 그대로', !!got && got.steps[0].expectedMetric === '드라이버',
        got ? String(got.steps[0].expectedMetric) : '');
  // 예전 Apps Script 가 적어 둔 칸('1. 첫 줄' 다음 번호 없는 줄)도 한 단계로 읽는다
  const prevActive = ss.active;
  const legacyTab = ss.insertSheet('여러 줄 옛 칸');
  legacyTab.getRange(1, 1, 3, 4).setValues([
    ['제목', '', '', ''], ['제목', '요약', '공구', '단계'],
    ['옛 가이드', '', '', '1. 덮개를 연다\n나사 4개를 푼다\n2. 새 부품을 끼운다'],
  ]);
  const legacy = gs.readGuideSheet(legacyTab, 'HARDWARE_SOP')[0];
  check('예전에 적힌 여러 줄 단계도 한 단계로 읽는다',
        !!legacy && legacy.steps.length === 2 && legacy.steps[0].instruction === '덮개를 연다\n나사 4개를 푼다',
        legacy ? JSON.stringify(legacy.steps.map((s) => s.instruction)) : '못 읽음');
  ss.deleteSheet(legacyTab);          // 아래 탭 순서 검사에 끼지 않게
  ss.setActiveSheet(prevActive);
}

// 한 건만 고쳐서 다시 올려도 나머지가 남아 있어야 한다
const edited = JSON.parse(JSON.stringify(guides));
edited[0].summary = '고친 요약';
result = call({ guides: 'push', items: edited });
check('가이드를 고쳐 다시 올릴 수 있다', result.ok === true, result.error || '');
result = call({ guides: 'pull' });
check('고친 뒤에도 가이드가 사라지지 않는다', result.items.length === guides.length,
      `${result.items.length}건 남음`);
check('고친 내용이 반영된다',
      (result.items.find((g) => g.id === 'g-aaa') || {}).summary === '고친 요약');

// 두 번 왕복해도 늘어나지 않는다 (중복 방지)
call({ guides: 'push', items: edited });
const twice = call({ guides: 'pull' });
check('여러 번 왕복해도 건수가 늘지 않는다', twice.items.length === guides.length,
      `${twice.items.length}건`);

// ─────────────────────────────────────────────── 가이드 로봇 분류

check('로봇 분류 탭이 없으면 models 는 null (아직 아무도 안 만듦)', twice.models === null,
      JSON.stringify(twice.models));
const withRobot = JSON.parse(JSON.stringify(edited));
withRobot[0].robotModel = 'Gen.1';
result = call({ guides: 'push', items: withRobot, models: ['Gen.1', 'Gen.2', 'Zephyr', 'Gen.1', ''] });
check('로봇 분류를 담아 올릴 수 있다', result.ok === true, result.error || '');
const robotHeader = errSheet.getRange(2, 1, 1, gs.GUIDE_HEADER.length).getValues()[0];
check('가이드 탭 맨 앞 열이 로봇이다', robotHeader[0] === '로봇', robotHeader.join(' · '));
result = call({ guides: 'pull' });
check('로봇 분류 목록을 되읽는다 (중복·빈 칸 없이)',
      JSON.stringify(result.models) === JSON.stringify(['Gen.1', 'Gen.2', 'Zephyr']),
      JSON.stringify(result.models));
check('가이드의 로봇이 보존된다',
      (result.items.find((g) => g.id === 'g-aaa') || {}).robotModel === 'Gen.1');
check('로봇 열이 생겨도 제목·단계가 그대로 읽힌다',
      (result.items.find((g) => g.id === 'g-aaa') || {}).codeOrTitle === 'E-101 로더 과전류'
      && (result.items.find((g) => g.id === 'g-aaa') || {}).steps.length === 2);
call({ guides: 'push', items: withRobot });
check('models 를 안 보내면 로봇 분류 탭을 건드리지 않는다',
      JSON.stringify(call({ guides: 'pull' }).models) === JSON.stringify(['Gen.1', 'Gen.2', 'Zephyr']));

// '로봇' 열이 없던 예전 배치의 탭도 그대로 읽힌다
const oldGuideTab = ss.insertSheet('예전 배치 가이드');
oldGuideTab.getRange(2, 1, 1, 8).setValues([['코드/제목', '요약', '필요 공구', '명령어', '단계', '수정일', '단계 사진', 'ID(고치지 마세요)']]);
oldGuideTab.getRange(3, 1, 1, 8).setValues([['E-900 예전 가이드', '예전 요약', '드라이버', 'bhctl reset', '1. 전원을 끈다', '2026-01-01 10:00', '', 'g-old']]);
const oldRows = gs.readGuideSheet(oldGuideTab, 'ERROR_CODE');
check('예전 배치 탭: 제목·요약·단계를 제자리에서 읽는다',
      oldRows.length === 1 && oldRows[0].codeOrTitle === 'E-900 예전 가이드'
      && oldRows[0].summary === '예전 요약' && oldRows[0].steps[0].instruction === '전원을 끈다'
      && oldRows[0].id === 'g-old',
      JSON.stringify(oldRows[0]));
check('예전 배치 탭: 로봇은 비어 있다', oldRows[0] && oldRows[0].robotModel === '');

// ─────────────────────────────────────────────── 리포트 이력

const HEADERS = ['작성일시', '작성자', '매장명', '오류 코드', '현장 사진', '상태'];
result = call({
  sheetName: '2026-09', headers: HEADERS,
  row: ['2026-09-02 10:00', '황지민', '미트로 강남점', 'E-101', '', '조치 진행 중'],
});
check('리포트를 기록할 수 있다', result.ok === true, result.error || `${result.row}행`);
const firstRow = result.row;

result = call({ reports: 'pull', sheetName: '2026-09' });
check('리포트를 되읽을 수 있다', result.ok === true && result.rows.length === 1,
      `${(result.rows || []).length}건`);

result = call({ reports: 'status', sheetName: '2026-09', row: firstRow,
                status: '조치 완료' });
check('상태를 고칠 수 있다', result.ok === true, result.error || '');
result = call({ reports: 'pull', sheetName: '2026-09' });
const statusIdx = result.headers.indexOf('상태');
check('고친 상태가 반영된다', result.rows[0].cells[statusIdx] === '조치 완료',
      result.rows[0].cells[statusIdx]);

// 이미 올린 줄을 고쳐 쓴다 (새 줄이 생기면 안 된다)
result = call({
  reports: 'update', sheetName: '2026-09', row: firstRow, headers: HEADERS,
  row_values: ['2026-09-02 10:00', '황지민', '미트로 강남점', 'E-204',
               '', '조치 완료'],
});
check('올린 리포트를 고쳐 쓸 수 있다', result.ok === true, result.error || '');
result = call({ reports: 'pull', sheetName: '2026-09' });
check('고쳐 써도 줄이 늘지 않는다', result.rows.length === 1,
      `${result.rows.length}건`);
check('고친 내용이 그 줄에 들어간다',
      result.rows[0].cells[HEADERS.indexOf('오류 코드')] === 'E-204',
      result.rows[0].cells[HEADERS.indexOf('오류 코드')]);
check('고쳐 쓴 뒤에도 상태가 남는다',
      result.rows[0].cells[HEADERS.indexOf('상태')] === '조치 완료');

// 두 줄일 때 가운데를 지워도 나머지가 남아야 한다
call({ sheetName: '2026-09', headers: HEADERS,
       row: ['2026-09-03 09:00', '황지민', '버거킹 판교점', 'E-330', '', '모니터링'] });
result = call({ reports: 'pull', sheetName: '2026-09' });
check('두 번째 리포트가 쌓인다', result.rows.length === 2, `${result.rows.length}건`);

const victim = result.rows[0].row;
result = call({ reports: 'delete', sheetName: '2026-09', row: victim });
check('올린 리포트를 지울 수 있다', result.ok === true, result.error || '');
result = call({ reports: 'pull', sheetName: '2026-09' });
check('지운 뒤 한 건만 남는다', result.rows.length === 1, `${result.rows.length}건`);
check('남은 것은 지우지 않은 쪽이다',
      result.rows[0].cells[HEADERS.indexOf('매장명')] === '버거킹 판교점',
      result.rows[0].cells[HEADERS.indexOf('매장명')]);
check('지운 뒤 줄 번호가 다시 매겨진다', result.rows[0].row === 3,
      `${result.rows[0].row}행`);

// 없는 줄을 지우려 하면 거절한다
result = call({ reports: 'delete', sheetName: '2026-09', row: 999 });
check('없는 줄 삭제는 거절한다', result.ok === false, result.error || '');

// ─────────────────────────────────────────────── 리포트 번호 목록
//
// 소비자 앱 시트의 [리포트] 탭에서 '필드팀 요청' 건만 골라 온다.

result = call({ reports: 'numbers' });
check('리포트 번호 목록을 받는다', result.ok === true, result.error || '');
check('필드팀 요청 + 아직 안 끝난 건만 온다 (현장 해결 · 빈 번호 · 조치 완료 제외)',
      result.items.length === 3
        && result.items.every((it) => it.number.startsWith('P2609')),
      JSON.stringify(result.items.map((it) => it.number)));
check("'진행 중' 인 건도 고를 수 있다 (띄어 써도 걸린다)",
      result.items.some((it) => it.number === 'P260915-07'));
check('콘솔에서 끝난 건은 빠진다',
      !result.items.some((it) => it.number === 'P260915-09'));
check("'콘솔상태' 처럼 붙여 쓴 열 이름도 찾는다",
      result.statusHeader === '콘솔상태', String(result.statusHeader));
check('최근 접수가 앞에 온다', result.items[0].number === 'P260915-07',
      result.items.map((it) => it.number).join(' · '));
const midItem = result.items.find((it) => it.number === 'P260914-01');
check('매장명과 문제 내용이 딸려 온다',
      midItem && midItem.store === '테스트' && midItem.problem === '멈춰 있어요',
      JSON.stringify(midItem));

// ─────────────────────────────────────────────── 리포트 항목 설정
//
// 항목은 팀 공통이라 [리포트 항목] 탭 하나에 둔다. 기기마다 같은 항목의 ID 가
// 달라질 수 있어, **이름이 같으면 같은 항목**으로 보고 한 줄만 남겨야 한다.
// (실제로 [로봇 모델] 이 선택지만 다른 두 줄로 갈라져 시트가 충돌했다.)

const FIELD_ITEMS = [
  { id: 'f-store', fieldLabel: '매장명', fieldType: 'TEXT', options: '', isRequired: true },
  { id: 'f-model-old', fieldLabel: '로봇 모델', fieldType: 'DROPDOWN',
    options: 'GEN.1,GEN.2(M12)', isRequired: true },
  { id: 'f-serial', fieldLabel: '로봇 시리얼', fieldType: 'TEXT', options: '', isRequired: true },
  // 다른 기기가 같은 항목을 다른 ID 로 올린 것 — 선택지가 더 최신이다
  { id: 'f-model-new', fieldLabel: '로봇모델', fieldType: 'DROPDOWN',
    options: 'GEN.1,GEN.2(M12),Frame', isRequired: true },
];
result = call({ fields: 'push', items: FIELD_ITEMS });
check('항목 설정을 올릴 수 있다', result.ok === true, result.error || '');
check('같은 이름은 한 줄로 합쳐 적는다 (4개 → 3개)', result.count === 3,
      `${result.count}개`);

result = call({ fields: 'pull' });
const fieldLabels = result.items.map((f) => f.fieldLabel);
check('되읽어도 같은 이름이 두 번 나오지 않는다',
      new Set(fieldLabels.map((l) => l.replace(/\s/g, ''))).size === fieldLabels.length,
      fieldLabels.join(' · '));
const modelField = result.items.find((f) => f.fieldLabel.replace(/\s/g, '') === '로봇모델');
check('합칠 때 나중 것(최신 선택지)이 남는다',
      modelField && modelField.options === 'GEN.1,GEN.2(M12),Frame',
      modelField && modelField.options);
check('자리는 처음 나온 곳을 지킨다 (열 순서가 안 흔들린다)',
      fieldLabels[1].replace(/\s/g, '') === '로봇모델', fieldLabels.join(' · '));

// 이미 중복이 쌓여 있는 탭을 손으로 만들어 두고, 읽을 때 합쳐지는지 본다
{
  const tab = ss.getSheetByName('리포트 항목');
  const dirty = [
    ['매장명', 'TEXT', '', 'Y', 'f-store'],
    ['로봇 모델', 'DROPDOWN', 'GEN.1', 'Y', 'f-model-old'],
    ['로봇 시리얼', 'TEXT', '', 'Y', 'f-serial'],
    ['로봇 모델', 'DROPDOWN', 'GEN.1,Frame', 'Y', 'f-model-new'],
  ];
  dirty.forEach((line, r) => line.forEach((v, c) => tab._set(r + 3, c + 1, v)));
  const healed = call({ fields: 'pull' });
  check('이미 갈라진 탭도 읽을 때 하나로 보여 준다', healed.items.length === 3,
        healed.items.map((f) => f.fieldLabel).join(' · '));
  check('합쳐진 순서 번호가 1부터 이어진다',
        healed.items.every((f, i) => f.displayOrder === i + 1),
        healed.items.map((f) => f.displayOrder).join(','));
}

// ─────────────────────────────────────────────── 첨부 저장 위치

result = call({
  sheetName: '2026-09', headers: HEADERS,
  row: ['2026-09-05 09:00', '황지민', '옥동식 서초점', 'E-101', '', '조치 진행 중'],
  media: [
    { column: 5, filename: '현장.jpg', mimeType: 'image/jpeg',
      storeName: '옥동식 서초점', dateText: '2026-09-05', data: 'AAA' },
    { column: 5, filename: '증상.mp4', mimeType: 'video/mp4',
      storeName: '옥동식 서초점', dateText: '2026-09-05', data: 'BBB' },
  ],
});
check('첨부와 함께 리포트를 올릴 수 있다', result.ok === true, result.error || '');
check('공유 드라이브에 저장했다 (개인 드라이브가 아니다)', result.mediaShared === true,
      `mediaShared=${result.mediaShared}`);
check('첨부 2개가 저장됐다', result.media === 2, String(result.media));

// 받은 폴더 바로 아래부터 시작한다 — 같은 이름 폴더를 또 만들면 안 된다.
check('받은 폴더 안에 같은 이름 폴더를 또 만들지 않는다',
      !findPath('필드팀 유지보수(이미지,동영상)'),
      [...env.driveTree.folders.keys()].join(' | '));
const photoDir = findPath('옥동식 서초점', '2026-09-05', '사진');
const videoDir = findPath('옥동식 서초점', '2026-09-05', '동영상');
check('매장 → 날짜 → 사진 순으로 폴더가 만들어진다', !!photoDir,
      photoDir ? photoDir.path : '없음');
check('매장 → 날짜 → 동영상 순으로 폴더가 만들어진다', !!videoDir,
      videoDir ? videoDir.path : '없음');
check('사진이 사진 폴더로 들어간다',
      !!photoDir && photoDir.files.length === 1
      && photoDir.files[0].name === '현장.jpg',
      photoDir ? photoDir.files.map((f) => f.name).join(',') : '');
check('영상이 동영상 폴더로 들어간다',
      !!videoDir && videoDir.files.length === 1
      && videoDir.files[0].name === '증상.mp4',
      videoDir ? videoDir.files.map((f) => f.name).join(',') : '');
check('사진과 영상이 섞이지 않는다',
      photoDir.files.every((f) => !f.mime.startsWith('video/'))
      && videoDir.files.every((f) => f.mime.startsWith('video/')));

// 같은 매장·같은 날 다시 올리면 폴더를 새로 만들지 않는다
call({
  sheetName: '2026-09', headers: HEADERS,
  row: ['2026-09-05 15:00', '황지민', '옥동식 서초점', 'E-204', '', '조치 완료'],
  media: [{ column: 5, filename: '추가.jpg', mimeType: 'image/jpeg',
            storeName: '옥동식 서초점', dateText: '2026-09-05', data: 'CCC' }],
});
check('같은 매장·같은 날은 폴더를 다시 만들지 않는다',
      findPath('옥동식 서초점').folders.size === 1
      && findPath('옥동식 서초점', '2026-09-05', '사진').files.length === 2,
      `날짜 폴더 ${findPath('옥동식 서초점').folders.size}개`);

// 폴더 이름에 못 쓰는 글자를 걸러낸다
call({
  sheetName: '2026-09', headers: HEADERS,
  row: ['2026-09-06 09:00', '황지민', 'A/B*점', '', '', '조치 완료'],
  media: [{ column: 5, filename: 'x.jpg', mimeType: 'image/jpeg',
            storeName: 'A/B*점', dateText: '2026-09-06', data: 'DDD' }],
});
check('폴더 이름에 못 쓰는 글자를 걸러낸다',
      [...env.driveTree.folders.keys()].some((n) => n === 'A B 점'),
      [...env.driveTree.folders.keys()].join(' | '));

// 첨부 종류 조회 — 영상인지 알 수 있어야 재생할 수 있다
const videoId = videoDir.files[0].id;
const photoId = photoDir.files[0].id;
result = call({ drive: 'info', ids: [videoId, photoId] });
check('첨부 종류를 알려 준다', result.ok === true);
check('영상을 영상으로 알려 준다',
      (result.files.find((f) => f.id === videoId) || {}).isVideo === true);
check('사진을 영상으로 잘못 보지 않는다',
      (result.files.find((f) => f.id === photoId) || {}).isVideo === false);

// 수정할 때 기존 첨부를 지키고 새 것만 덧붙인다
const NL = String.fromCharCode(10);
const splitLines = (cell) => String(cell).split(NL).filter(Boolean);
const MEDIA_HEADERS = ['작성일시', '작성자', '매장명', '현장 사진', '상태'];
result = call({
  sheetName: '2026-10', headers: MEDIA_HEADERS,
  row: ['2026-10-01 09:00', '황지민', '옥동식 서초점', '', '조치 진행 중'],
  media: [{ column: 4, filename: '첫사진.jpg', mimeType: 'image/jpeg',
            storeName: '옥동식 서초점', dateText: '2026-10-01', data: 'AAA' }],
});
const mediaRow = result.row;
result = call({ reports: 'pull', sheetName: '2026-10' });
const mediaCol = result.headers.indexOf('현장 사진');
const firstLinks = splitLines(result.rows[0].cells[mediaCol]);
check('첫 첨부가 칸에 적힌다', firstLinks.length === 1, `${firstLinks.length}개`);

// 앱은 기존 링크를 그대로 다시 적고, 새 것만 media 로 보낸다
const keptCell = firstLinks.join(NL);
result = call({
  reports: 'update', sheetName: '2026-10', row: mediaRow, headers: MEDIA_HEADERS,
  row_values: ['2026-10-01 09:00', '황지민', '옥동식 서초점', keptCell, '조치 완료'],
  media: [{ column: 4, filename: '추가영상.mp4', mimeType: 'video/mp4',
            storeName: '옥동식 서초점', dateText: '2026-10-01', data: 'BBB' }],
});
check('첨부를 더하며 수정할 수 있다', result.ok === true, result.error || '');
result = call({ reports: 'pull', sheetName: '2026-10' });
const afterLinks = splitLines(result.rows[0].cells[mediaCol]);
check('기존 첨부가 지워지지 않는다', afterLinks.includes(firstLinks[0]),
      `${afterLinks.length}개`);
check('새 첨부가 덧붙는다', afterLinks.length === 2, `${afterLinks.length}개`);
check('수정해도 줄이 늘지 않는다', result.rows.length === 1);

// 기존 첨부를 뺀 채로 저장하면 그것만 빠진다
result = call({
  reports: 'update', sheetName: '2026-10', row: mediaRow, headers: MEDIA_HEADERS,
  row_values: ['2026-10-01 09:00', '황지민', '옥동식 서초점', afterLinks[1], '조치 완료'],
});
result = call({ reports: 'pull', sheetName: '2026-10' });
const finalLinks = splitLines(result.rows[0].cells[mediaCol]);
check('뺀 첨부만 빠진다', finalLinks.length === 1 && finalLinks[0] === afterLinks[1],
      `${finalLinks.length}개`);

// ────────────────────────────────────────────────────────────────────
// 항목이 바뀌어도 표는 **하나**다 (v3.26)
//
// 예전에는 항목이 달라지면 탭 아래에 새 항목 줄을 만들었다. 항목을 하나만
// 더하거나 순서만 바꿔도 한 탭에 표가 여러 개 생겼다(실제로 그렇게 보였다).
// 이제 항목 **이름**으로 열을 맞춰 적는다. 새 항목은 제자리에 열이 생기고,
// 없어진 항목의 열은 옛 기록 보존을 위해 남는다.
// ────────────────────────────────────────────────────────────────────
const H1 = ['작성일시', '작성자', '식당명', '오류 코드', '상태'];
const H2 = ['작성일시', '작성자', '식당명', '오류 코드', '조치 내용', '상태'];  // 항목 추가
const H3 = ['작성일시', '작성자', '오류 코드', '식당명', '조치 내용', '상태'];  // 순서만 이동

call({ sheetName: '2099-01', headers: H1,
       row: ['2099-01-05 10:00', '김현장', '옥동식', 'E-1', '조치 완료'] });
call({ sheetName: '2099-01', headers: H1,
       row: ['2099-01-06 10:00', '김현장', '미트로', 'E-2', '조치 완료'] });

const tab = ss.getSheetByName('2099-01');
const headerRowsOf = (sheet) => {
  const rows = [];
  for (let r = 1; r <= sheet.getLastRow(); r += 1) {
    if (String(sheet.getRange(r, 1).getValue() || '').trim() === '작성일시') rows.push(r);
  }
  return rows;
};
const headerOf = (sheet) => {
  const line = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map((v) => String(v || '').trim());
  while (line.length && !line[line.length - 1]) line.pop();
  return line;
};
check('같은 항목이면 이어 붙인다', tab.getLastRow() === 4, `${tab.getLastRow()}행`);
check('항목 줄은 2행이다',
      tab.getRange(2, 1, 1, 1).getValues()[0][0] === '작성일시');

// 항목을 하나 더한 채로 올린다 → 표는 그대로 하나, 그 자리에 **열이 끼워진다**
const moved = call({ sheetName: '2099-01', headers: H2,
                     row: ['2099-01-07 10:00', '김현장', '한솔', 'E-3', '패드 교체', '모니터링'] });
check('탭을 새로 만들지 않는다', !ss.getSheetByName('2099-01 (2)'),
      ss.getSheets().map((x) => x.getName()).join(' | '));
check('응답의 탭 이름이 그대로다', moved.sheetName === '2099-01', String(moved.sheetName));
check('항목 줄은 여전히 하나다', headerRowsOf(tab).length === 1,
      headerRowsOf(tab).join(', '));
check('2행 항목 줄에 새 항목이 제자리에 끼워진다',
      headerOf(tab).join('|') === H2.join('|'), headerOf(tab).join('|'));
const stateCol = headerOf(tab).indexOf('상태') + 1;
check('옛 줄의 상태 값이 상태 열로 함께 옮겨진다',
      tab.getRange(3, stateCol).getValue() === '조치 완료',
      String(tab.getRange(3, stateCol).getValue()));
check('옛 줄의 새 항목 칸은 비어 있다',
      String(tab.getRange(3, headerOf(tab).indexOf('조치 내용') + 1).getValue() || '') === '');
check('새 줄은 새 항목 칸이 채워진다',
      tab.getRange(5, headerOf(tab).indexOf('조치 내용') + 1).getValue() === '패드 교체');

// 항목 **순서만** 바꿔 올리면 시트는 그대로 두고 값만 이름에 맞춰 적는다
call({ sheetName: '2099-01', headers: H3,
       row: ['2099-01-08 10:00', '김현장', 'E-4', '옥동식', '점검', '조치 완료'] });
check('순서 이동은 항목 줄을 만들지 않는다', headerRowsOf(tab).length === 1,
      headerRowsOf(tab).join(', '));
check('순서 이동은 시트 열 배치를 바꾸지 않는다',
      headerOf(tab).join('|') === H2.join('|'), headerOf(tab).join('|'));
check('값은 이름에 맞는 열로 들어간다',
      tab.getRange(6, headerOf(tab).indexOf('오류 코드') + 1).getValue() === 'E-4'
      && tab.getRange(6, headerOf(tab).indexOf('식당명') + 1).getValue() === '옥동식',
      `${tab.getRange(6, 4).getValue()} · ${tab.getRange(6, 3).getValue()}`);

// 읽으면 모든 줄이 같은 항목으로 온다
let read = call({ reports: 'pull', sheetName: '2099-01' });
check('네 줄이 모두 읽힌다', (read.rows || []).length === 4,
      `${(read.rows || []).length}줄`);
check('모든 줄의 항목이 하나로 같다',
      read.rows.every((r) => (r.headers || []).join('|') === H2.join('|')));
check('항목 줄은 자료로 읽지 않는다',
      read.rows.every((r) => r.cells[0] !== '작성일시'));

// 상태 변경도 합쳐진 항목 기준으로 제 칸에 적힌다
const newRow = read.rows[read.rows.length - 1];
const st = call({ reports: 'status', sheetName: '2099-01',
                  row: newRow.row, status: '교체 예정' });
check('상태를 합쳐진 항목 기준으로 적는다', st.ok === true && st.column === stateCol,
      `열 ${st.column} (기대 ${stateCol})`);
check('시트에 실제로 적혔다',
      tab.getRange(newRow.row, stateCol).getDisplayValues()[0][0] === '교체 예정',
      tab.getRange(newRow.row, stateCol).getDisplayValues()[0][0]);

// 월 목록은 여전히 한 달 하나
const months = call({ reports: 'months' }).months || [];
check('월 목록에 갈라진 탭이 없다', !months.some((m) => /\(\d+\)/.test(m)),
      months.join(' | '));

// ── 예전 판이 갈라 놓은 탭은 다음 업로드 때 표 하나로 합쳐진다 (자가 치유)
const splitTab = ss.insertSheet('2099-02');
splitTab.getRange(2, 1, 1, H1.length).setValues([H1]);
splitTab.getRange(3, 1, 1, H1.length).setValues(
  [['2099-02-01 09:00', 'ben', '옥동식', 'E-9', '조치 완료']]);
// 한 줄 띄우고 두 번째 항목 묶음 (옛 동작 그대로 흉내)
splitTab.getRange(5, 1, 1, H2.length).setValues([H2]);
splitTab.getRange(6, 1, 1, H2.length).setValues(
  [['2099-02-02 09:00', 'ben', '미트로', 'E-10',
    'https://drive.google.com/file/d/abc123abc123abc123abc/view', '모니터링']]);

call({ sheetName: '2099-02', headers: H2,
       row: ['2099-02-03 09:00', 'ben', '한솔', 'E-11', '점검', '조치 완료'] });
check('갈라졌던 탭의 항목 줄이 하나로 합쳐진다', headerRowsOf(splitTab).length === 1,
      headerRowsOf(splitTab).join(', '));
check('합쳐진 항목은 최신 순서를 따른다',
      headerOf(splitTab).join('|') === H2.join('|'), headerOf(splitTab).join('|'));
check('여백 줄 없이 이어 붙는다', splitTab.getLastRow() === 5, `${splitTab.getLastRow()}행`);
check('옛 줄 값이 이름 기준으로 옮겨진다',
      splitTab.getRange(3, headerOf(splitTab).indexOf('오류 코드') + 1).getValue() === 'E-9'
      && splitTab.getRange(4, headerOf(splitTab).indexOf('오류 코드') + 1).getValue() === 'E-10');
check('옛 줄의 드라이브 주소가 살아 있고 다시 링크가 된다',
      String(splitTab.getRange(4, headerOf(splitTab).indexOf('조치 내용') + 1).getValue())
        .includes('drive.google.com')
      && splitTab.links.has(`4,${headerOf(splitTab).indexOf('조치 내용') + 1}`),
      String(splitTab.getRange(4, headerOf(splitTab).indexOf('조치 내용') + 1).getValue()).slice(0, 60));
const readSplitTab = call({ reports: 'pull', sheetName: '2099-02' });
check('합쳐진 뒤 세 줄이 모두 읽힌다', (readSplitTab.rows || []).length === 3,
      `${(readSplitTab.rows || []).length}줄`);

// ────────────────────────────────────────────────────────────────────
// 가이드 단계 사진 — 드라이브 저장 + 시트로 공유 (v3.11)
// ────────────────────────────────────────────────────────────────────
const photo = call({
  guides: 'media',
  categoryType: 'ERROR_CODE',
  title: 'E-104 그리퍼 온도 센서',
  files: [{ filename: 'step1.jpg', mimeType: 'image/jpeg', data: 'AAAA' }],
});
check('가이드 사진을 드라이브에 올린다', photo.ok === true && (photo.links || []).length === 1,
      JSON.stringify(photo).slice(0, 120));
const gdir = findPath('가이드', '오류 코드 가이드', 'E-104 그리퍼 온도 센서', '사진');
check('경로가 가이드 → 분류 → 제목 → 사진 이다', !!gdir,
      gdir ? gdir.path : [...env.driveTree.folders.keys()].join(' | '));
check('그 폴더에 파일이 들어 있다', !!gdir && gdir.files.length === 1,
      gdir ? `${gdir.files.length}개` : '없음');

// 사진 주소가 시트에 실리고 다시 읽힌다
call({ guides: 'push', items: [{
  id: 'g1', categoryType: 'ERROR_CODE', codeOrTitle: 'E-104 그리퍼 온도 센서',
  summary: '온도 편차', requiredTools: '육각 3mm', commands: [],
  steps: [
    { instruction: '커버 분리', expectedMetric: '', imageUrl: photo.links[0] },
    { instruction: '저항 측정', expectedMetric: '1.8~2.2 kΩ', imageUrl: '' },
  ],
  updatedAt: '2099-01-09 10:00',
}] });
const photoGuide = (call({ guides: 'pull' }).items || [])
  .find((g) => g.codeOrTitle === 'E-104 그리퍼 온도 센서');
check('가이드가 다시 읽힌다', !!photoGuide);
check('1단계 사진 주소가 살아 있다', !!photoGuide && photoGuide.steps[0].imageUrl === photo.links[0],
      back ? String(photoGuide.steps[0].imageUrl) : '없음');
check('사진 없는 단계는 비어 있다', !!photoGuide && !photoGuide.steps[1].imageUrl,
      back ? String(photoGuide.steps[1].imageUrl) : '');
check('단계 순서가 지켜진다',
      !!photoGuide && photoGuide.steps.map((x) => x.instruction).join(' / ') === '커버 분리 / 저항 측정',
      back ? photoGuide.steps.map((x) => x.instruction).join(' / ') : '');
// 기기 안에만 있는 사진(/media/...)은 시트에 적지 않는다 — 남이 열 수 없다
call({ guides: 'push', items: [{
  id: 'g2', categoryType: 'ERROR_CODE', codeOrTitle: 'E-200 기기 전용 사진',
  summary: '', requiredTools: '', commands: [],
  steps: [{ instruction: '한 단계', expectedMetric: '', imageUrl: '/media/local.jpg' }],
  updatedAt: '2099-01-09 11:00',
}] });
const local = (call({ guides: 'pull' }).items || [])
  .find((g) => g.codeOrTitle === 'E-200 기기 전용 사진');
check('기기 안 사진은 시트에 적지 않는다', !!local && !local.steps[0].imageUrl,
      local ? String(local.steps[0].imageUrl) : '가이드 없음');

// ────────────────────────────────────────────────────────────────────
// 첨부 사진이 **모든 사람 화면에 보이는가** (v3.13)
//
// 왜 이 검사가 있나 — 현장에서 리포트를 올리니 사진이 드라이브에는 들어갔는데
// 앱에서는 전부 액박이 떴다. 원인은 두 가지가 겹친 것이었다.
//   1. 공유 드라이브는 조직 정책으로 '링크가 있는 누구나' 를 막는다.
//      그런데 예전 코드는 setSharing 실패를 조용히 삼켰다.
//   2. drive.google.com/thumbnail 은 파일이 공개일 때만 그림을 준다.
//      (구글 로그인 쿠키가 다른 사이트의 <img> 요청에 붙지 않는다)
//   → 그래서 올린 본인 화면에서도 안 보였다.
// 이제 실패를 감추지 않고, 바이트를 직접 내려주는 길을 둔다.
// ────────────────────────────────────────────────────────────────────
const PHOTO_FIELDS = ['작성일시', '작성자', '식당명', '증상', '현장 사진'];
const NEWLINE = String.fromCharCode(10);   // .gs 가 칸 안에서 줄을 잇는 글자
const shot = (name) => ({ filename: name, mimeType: 'image/jpeg',
                          data: 'AAAABBBB', column: 5,
                          storeName: '흥부골', dateText: '2099-03-01' });

// ── 링크 공개가 되는 현장 (개인 드라이브) ────────────────────────────
env.blockSharing = false;
const okShare = call({ sheetName: '2099-03', headers: PHOTO_FIELDS,
  row: ['2099-03-01 10:00', 'ben', '흥부골', '현장 테스트', ''],
  media: [shot('a.jpg'), shot('b.jpg')] });
check('사진 2장이 올라간다', okShare.media === 2, `${okShare.media}장`);
check('공개로 만들지 못한 사진이 없다', okShare.mediaPrivate === 0,
      `비공개 ${okShare.mediaPrivate}장`);

const photoTab = ss.getSheetByName('2099-03');
const photoCell = String(photoTab.getRange(okShare.row, 5).getValue() || '');
check('첨부 칸에 주소 2개가 적힌다', photoCell.split(NEWLINE).length === 2,
      photoCell.replace(/\n/g, ' | '));

// 여기가 핵심 — 검은 글씨가 아니라 **누를 수 있는 파란 링크**여야 한다
const cellLinks = photoTab.links.get(`${okShare.row},5`) || [];
check('첨부 칸이 눌러서 열 수 있는 링크다', cellLinks.length === 2,
      `링크 ${cellLinks.length}개`);
check('링크 주소가 드라이브 주소다',
      cellLinks.every((l) => String(l.url).indexOf('drive.google.com') >= 0),
      cellLinks.map((l) => l.url).join(' | '));
check('링크가 줄마다 따로 걸린다',
      cellLinks.length === 2 && cellLinks[0].end < cellLinks[1].start,
      JSON.stringify(cellLinks.map((l) => [l.start, l.end])));

// ── 링크 공개가 막힌 현장 (공유 드라이브 정책) ───────────────────────
env.blockSharing = true;
const blocked = call({ sheetName: '2099-03', headers: PHOTO_FIELDS,
  row: ['2099-03-02 10:00', 'ben', '흥부골', '정책 막힘', ''],
  media: [shot('c.jpg')] });
check('공개가 막혀도 사진은 올라간다', blocked.media === 1, `${blocked.media}장`);
check('공개 실패를 감추지 않고 알려 준다', blocked.mediaPrivate === 1,
      `비공개 ${blocked.mediaPrivate}장 (예전에는 0 으로 조용히 넘어갔다)`);

// 비공개 파일도 앱은 볼 수 있어야 한다 — 바이트를 직접 받는 길
const blockedCell = String(photoTab.getRange(blocked.row, 5).getValue() || '');
const blockedId = (blockedCell.match(/\/d\/([-\w]+)/) || [])[1];
check('막힌 사진의 파일 id 를 주소에서 뽑을 수 있다', !!blockedId, blockedCell);

const bytes = call({ drive: 'bytes', ids: [blockedId], size: 'thumb' });
const got = (bytes.files || [])[0];
check('비공개 사진도 바이트로 내려받을 수 있다',
      bytes.ok === true && got && !!got.data,
      JSON.stringify(bytes).slice(0, 140));
check('내려받은 것에 종류가 함께 온다', got && !!got.mimeType, got && got.mimeType);

const full = call({ drive: 'bytes', ids: [blockedId], size: 'full' });
check('크게 보기용 원본도 내려받는다', !!(full.files || [])[0].data,
      JSON.stringify(full.files[0]).slice(0, 120));

check('없는 파일을 물어도 터지지 않는다',
      call({ drive: 'bytes', ids: ['없는id'] }).ok === true);
check('한 번에 너무 많이 달라고 해도 잘라서 준다',
      (call({ drive: 'bytes', ids: new Array(40).fill(blockedId) }).files || []).length <= 12);

// ── 이미 올라간 사진 되살리기 ────────────────────────────────────────
env.blockSharing = true;
const cannot = call({ drive: 'repair', limit: 200 });
check('복구가 살펴본 파일 수를 알려 준다', cannot.checked > 0, `${cannot.checked}개`);
check('정책으로 막히면 못 바꿨다고 정직하게 말한다', cannot.failed > 0,
      `바꿈 ${cannot.fixed} · 못 바꿈 ${cannot.failed}`);

env.blockSharing = false;
const canFix = call({ drive: 'repair', limit: 200 });
check('정책이 풀리면 예전 사진을 공개로 바꾼다', canFix.fixed > 0,
      `바꿈 ${canFix.fixed} · 못 바꿈 ${canFix.failed}`);
check('두 번째 복구는 이미 공개인 것을 건드리지 않는다',
      call({ drive: 'repair', limit: 200 }).fixed === 0);

// ────────────────────────────────────────────────────────────────────
// 앱 버전 탭 — 빌드 자동화가 적고, 태블릿이 읽는다 (v3.16)
// ────────────────────────────────────────────────────────────────────
const noTab = call({ release: 'latest' });
check('앱 버전 탭이 없으면 빈 버전을 돌려준다 (오류 아님)', noTab.ok === true && noTab.version === '',
      JSON.stringify(noTab));

const pub1 = call({ release: 'publish', version: '3.16.0', build: '29',
                    url: 'https://www.dropbox.com/scl/fi/abc/FieldPortal-v3.16.0.apk?rlkey=x&dl=1',
                    sizeMb: 4.83, notes: '동영상 첨부 · 업데이트 띠' });
check('빌드 자동화가 버전을 적을 수 있다', pub1.ok === true && pub1.version === '3.16.0',
      JSON.stringify(pub1));
const relTab = ss.getSheetByName('앱 버전');
check('앱 버전 탭이 생기고 머리줄이 있다', !!relTab
      && relTab.getRange(1, 1, 1, 7).getValues()[0].join('|') === gs.RELEASE_HEADER.join('|'));
check('링크 칸이 눌러서 열 수 있는 링크다', (relTab.links.get(`${pub1.row},4`) || []).length === 1);
check('공개 칸은 기본 Y 다', relTab.getRange(pub1.row, 7).getValue() === 'Y');

const bad = call({ release: 'publish', version: 'v3.16', url: 'http://x' });
check('버전·주소 모양이 틀리면 거절한다', bad.ok === false, JSON.stringify(bad));

let latest = call({ release: 'latest' });
check('가장 높은 버전 하나를 돌려준다', latest.version === '3.16.0' && latest.build === '29'
      && latest.url.indexOf('dl=1') > 0 && latest.sizeMb === 4.8,
      JSON.stringify(latest));

// 더 높은 버전을 올리고, 그 뒤 낮은 버전을 올려도 높은 것이 이긴다
call({ release: 'publish', version: '3.17.0', build: '31', url: 'https://dl.example/3.17.0.apk' });
call({ release: 'publish', version: '3.16.5', build: '30', url: 'https://dl.example/3.16.5.apk' });
latest = call({ release: 'latest' });
check('줄 순서가 아니라 버전 숫자로 고른다', latest.version === '3.17.0', latest.version);
check('3.9 보다 3.17 이 크다 (글자 비교가 아니다)',
      gs.compareVersions('3.17.0', '3.9.0') > 0 && gs.compareVersions('3.9.0', '3.17.0') < 0);

// 사람이 개입하는 지점 — 공개를 N 으로 바꾸면 그 버전 안내가 멈춘다
const rows = relTab.getLastRow();
for (let r = 2; r <= rows; r += 1) {
  if (relTab.getRange(r, 1).getValue() === '3.17.0') relTab.getRange(r, 7).setValue('N');
}
latest = call({ release: 'latest' });
check("공개 칸을 N 으로 바꾸면 그 버전은 건너뛴다", latest.version === '3.16.5', latest.version);
check("공개 칸이 비어 있으면 공개로 본다", gs.isReleasePublic('') === true
      && gs.isReleasePublic('아니오') === false && gs.isReleasePublic('X') === false);


// ═══════════════════════════════════════════════════════════════════
// 앱 설치 링크 — 사람에게 보내 주는 주소는 **버전이 바뀌어도 그대로**
// ═══════════════════════════════════════════════════════════════════
console.log('');
console.log('── 앱 설치 링크 (고정 주소)');

const noLink = call({ release: 'latest' });
check('아직 만든 적이 없으면 빈 주소다 (오류가 아니다)',
      noLink.ok === true && noLink.installUrl === '');

const first = call({ release: 'install', version: '3.20.0', build: '42',
                     url: 'https://www.dropbox.com/scl/fi/abc/FieldPortal.apk?dl=1' });
check('설치용 APK 를 드라이브에 올린다', first.ok === true, JSON.stringify(first));
check('사람에게 보내는 주소가 /file/d/<ID>/view 모양이다',
      first.installUrl === `https://drive.google.com/file/d/${first.fileId}/view?usp=drive_link`,
      first.installUrl);
// uc?export=download 는 APK 에 '바이러스 검사 불가' 화면을 한 번 끼운다.
check('바로 내려받는 주소는 안내 화면을 거치지 않는 그 주소다',
      first.downloadUrl === 'https://drive.usercontent.google.com/download'
        + `?id=${first.fileId}&export=download&confirm=t`, first.downloadUrl);
check('링크가 있는 누구나 볼 수 있게 만든다', first.shared === true);
check('처음 만든 것임을 알려 준다 (주소가 지금 정해졌다)',
      first.created === true && first.linkChanged === false);
check('Dropbox 주소에서 받아 온다',
      fetchCalls.length === 1 && /dl=1$/.test(fetchCalls[0].url));

const apkDir = findPath('앱 설치 파일');
check('<공유 드라이브>/앱 설치 파일/ 에 둔다', !!apkDir && apkDir.files.length === 1);
check('파일 이름이 사람이 알아볼 이름이다',
      apkDir.files[0].getName() === '현장포털-설치.apk', apkDir.files[0].getName());

const linkTab = ss.getSheetByName('앱 설치 링크');
check('시트 탭에 주소를 적어 둔다',
      !!linkTab && linkTab.getRange(2, 1).getValue() === first.installUrl);
check('그 칸이 눌러서 열 수 있는 파란 링크다',
      (linkTab.links.get('2,1') || []).some((l) => l.url === first.installUrl));
check('파일 ID 도 적어 둔다 (시트만 보고도 되찾을 수 있게)',
      linkTab.getRange(2, 3).getValue() === first.fileId);

// ── 두 번째 배포 — **주소가 바뀌면 안 된다** ────────────────────────
env.fetchAnswer = { code: 200, bytes: new Array(3_200_000).fill(9) };
const second = call({ release: 'install', version: '3.21.0', build: '43',
                      url: 'https://www.dropbox.com/scl/fi/xyz/FieldPortal2.apk?dl=1' });
check('다음 버전도 올라간다', second.ok === true, JSON.stringify(second));
check('★ 주소가 그대로다 — 예전에 보낸 링크가 새 APK 를 준다',
      second.fileId === first.fileId && second.installUrl === first.installUrl,
      `${first.installUrl} → ${second.installUrl}`);
check('내용만 갈아 끼운다 (파일을 새로 만들지 않는다)',
      second.replaced === true && driveUpdates.length === 1
      && driveUpdates[0].bytes === 3_200_000);
check('파일이 하나뿐이다 (버전마다 쌓이지 않는다)', apkDir.files.length === 1);
check('시트의 버전 칸이 새 버전으로 바뀐다',
      linkTab.getRange(2, 5).getValue() === '3.21.0');

// ── 태블릿이 [설정] 에서 그 주소를 읽는다 ───────────────────────────
latest = call({ release: 'latest' });
check('latest 응답에 설치 주소가 함께 온다',
      latest.installUrl === first.installUrl && latest.downloadUrl === first.downloadUrl);

// ── dl=0 을 주면 미리보기 HTML 몇 KB 가 APK 인 척 올라간다 ──────────
env.fetchAnswer = { code: 200, bytes: new Array(4200).fill(60) };
const tiny = call({ release: 'install', version: '3.22.0',
                    url: 'https://www.dropbox.com/scl/fi/xyz/FieldPortal2.apk?dl=0' });
check('APK 가 아니라 미리보기 페이지면 거절한다',
      tiny.ok === false && /너무 작습니다/.test(tiny.error), JSON.stringify(tiny));
check('거절했으면 주소도 건드리지 않는다',
      call({ release: 'latest' }).installUrl === first.installUrl);

// ── 받아오지 못하면 있는 주소를 지키고 이유를 말한다 ────────────────
env.fetchAnswer = { code: 404, bytes: null };
const gone = call({ release: 'install', version: '3.22.0',
                    url: 'https://www.dropbox.com/scl/fi/none.apk?dl=1' });
check('내려받기가 실패하면 이유를 말한다',
      gone.ok === false && /404/.test(gone.error), JSON.stringify(gone));
check('실패해도 예전 주소는 살아 있다',
      call({ release: 'latest' }).installUrl === first.installUrl);

// ── 갈아 끼우지 못하면(고급 서비스 꺼짐) 새로 만들고 **말해 준다** ──
env.fetchAnswer = { code: 200, bytes: new Array(3_000_000).fill(1) };
env.driveUpdateFails = true;
const remade = call({ release: 'install', version: '3.23.0',
                      url: 'https://www.dropbox.com/scl/fi/abc/FieldPortal3.apk?dl=1' });
env.driveUpdateFails = false;
check('갈아 끼우지 못하면 새로 만들어서라도 올린다', remade.ok === true, JSON.stringify(remade));
check('그때는 linkChanged 로 알려 준다 (예전에 보낸 주소가 옛 APK 를 준다)',
      remade.replaced === false && remade.linkChanged === true
      && remade.created === false && remade.fileId !== first.fileId);
check('바뀐 주소를 시트에 다시 적는다',
      linkTab.getRange(2, 1).getValue() === remade.installUrl);

// ── 시트 탭을 지워도 주소를 잃지 않는다 ─────────────────────────────
linkTab.clearContents();
check('스크립트 속성에 파일 ID 가 남아 있다',
      call({ release: 'latest' }).installUrl === remade.installUrl);

// ── url 없이 base64 로 직접 보내도 된다 (사람이 손으로 돌릴 때) ─────
const byData = call({ release: 'install', version: '3.24.0', data: 'x'.repeat(300000) });
check('base64 로 보내도 올라간다', byData.ok === true, JSON.stringify(byData));
check('그래도 같은 주소를 지킨다', byData.installUrl === remade.installUrl);
check('주소가 없으면 무엇이 잘못됐는지 말한다',
      call({ release: 'install', version: '3.25.0' }).error.indexOf('https') >= 0);


// ═══════════════════════════════════════════════════════════════════
// 차량 운행 일지 — 차량마다 탭 하나, 법인 차량 운행 일지 서식 그대로
// ═══════════════════════════════════════════════════════════════════
console.log('');
console.log('── 차량 운행 일지');

const emptyLog = call({ driving: 'pull' });
check('아직 아무것도 없으면 빈 목록이다 (오류가 아니다)',
      emptyLog.ok === true && emptyLog.rows.length === 0
      && emptyLog.options.depts.length === 0);

const pushed = call({
  driving: 'push',
  vehicleName: '스타리아 1호차',
  info: { model: '현대 스타리아 3밴', plate: '845누5868' },
  rows: [
    { id: 'd1', date: '2026-09-14', weekday: '월', dept: 'BS', driverName: '홍길동',
      odoBefore: 15000, odoAfter: 15300, distance: 300,
      fromPlace: '언주사무실', toPlace: '흥부골', note: '정기 점검' },
    { id: 'd2', date: '2026-09-15', weekday: '화', dept: 'BS', driverName: '홍길동',
      odoBefore: 15300, odoAfter: 15420, distance: 120,
      fromPlace: '흥부골', toPlace: '언주사무실', note: '' },
  ],
});
check('차량마다 · 해마다 탭이 하나 생긴다',
      pushed.ok === true && pushed.sheetName === '운행일지 2026 스타리아 1호차', pushed.sheetName);

const logTab = ss.getSheetByName('운행일지 2026 스타리아 1호차');
check('맨 위가 서식 제목이다',
      logTab.getRange(1, 1).getValue() === '법 인 차 량 운 행 일 지');
check('법인명 · 사업자등록번호가 서식대로 들어간다',
      logTab.getRange(2, 2).getValue() === '비욘드허니컴'
      && logTab.getRange(2, 5).getValue() === '697-86-01767');
check('①차종 ②자동차등록번호가 머리에 있다',
      logTab.getRange(3, 2).getValue() === '현대 스타리아 3밴'
      && logTab.getRange(3, 5).getValue() === '845누5868');
check('사업연도가 기록의 연도를 따른다',
      logTab.getRange(3, 8).getValue() === '2026-01-01 ~ 2026-12-31');
check('건수와 주행거리 합계를 적어 둔다',
      logTab.getRange(4, 2).getValue() === 2 && logTab.getRange(4, 7).getValue() === 420);
check('머리줄이 서식의 ③~⑩ 그대로다',
      logTab.getRange(5, 1).getValue() === '③사용일자'
      && logTab.getRange(5, 5).getValue() === '⑤주행 전 계기판의 거리(㎞)'
      && logTab.getRange(5, 7).getValue() === '⑦주행거리(㎞)'
      && logTab.getRange(5, 8).getValue() === '⑧출발지'
      && logTab.getRange(5, 10).getValue() === '⑩비고');
check('자료는 6행부터 쌓인다',
      logTab.getRange(6, 1).getValue() === '2026-09-14'
      && logTab.getRange(6, 3).getValue() === 'BS'
      && logTab.getRange(7, 1).getValue() === '2026-09-15');

// ⑦ 은 앱이 뭐라 보내든 시트에서 다시 뺀다 — ⑤⑥⑦ 이 어긋나 보이면 안 된다.
call({
  driving: 'push',
  vehicleName: '스타리아 1호차',
  info: { model: '현대 스타리아 3밴', plate: '845누5868' },
  rows: [{ id: 'd1', date: '2026-09-14', dept: 'BS', driverName: '홍길동',
           odoBefore: 15000, odoAfter: 15300, distance: 99999,
           fromPlace: '언주사무실', toPlace: '흥부골', note: '' }],
});
check('⑦주행거리는 시트가 ⑥−⑤ 로 다시 센다 (틀린 값이 와도)',
      logTab.getRange(6, 7).getValue() === 300, logTab.getRange(6, 7).getValue());
check('줄을 지우고 올리면 옛 줄이 남지 않는다',
      logTab.getRange(7, 1).getValue() === '');

// 다시 읽기
let pulled = call({ driving: 'pull', vehicleName: '스타리아 1호차' });
check('읽으면 차량 이름이 함께 온다',
      pulled.rows.length === 1 && pulled.rows[0].vehicleName === '스타리아 1호차');
check('기록 ID 로 같은 줄을 알아본다', pulled.rows[0].id === 'd1');
check('①차종 ②등록번호도 함께 읽힌다',
      pulled.info['스타리아 1호차'].model === '현대 스타리아 3밴'
      && pulled.info['스타리아 1호차'].plate === '845누5868');

// 시트가 날짜로 바꿔 담은 칸도 읽어야 한다 (사람이 손으로 고치면 그렇게 된다)
logTab.getRange(6, 1).setValue(new Date(2026, 8, 14));
pulled = call({ driving: 'pull', vehicleName: '스타리아 1호차' });
check('시트가 날짜로 바꾼 칸도 YYYY-MM-DD 로 읽는다',
      pulled.rows.length === 1 && pulled.rows[0].date === '2026-09-14',
      JSON.stringify(pulled.rows[0] || {}));

// 차량이 둘이면 탭도 둘
call({ driving: 'push', vehicleName: '스타리아 2호차', info: {},
       rows: [{ id: 'e1', date: '2026-09-14', odoBefore: 200, odoAfter: 260,
                fromPlace: '본사', toPlace: '공장', note: '' }] });
check('차량이 늘면 탭도 는다', !!ss.getSheetByName('운행일지 2026 스타리아 2호차'));
const both = call({ driving: 'pull' });
check('차량을 안 고르면 전부 읽는다', both.rows.length === 2);
check('한 차량만 고르면 그 차량만 읽는다',
      call({ driving: 'pull', vehicleName: '스타리아 2호차' }).rows.length === 1);
check('한 차량을 올려도 다른 차량 탭은 건드리지 않는다',
      ss.getSheetByName('운행일지 2026 스타리아 1호차').getRange(6, 1).getValue() !== '');

// 부서 · 장소 선택지
call({ driving: 'options', depts: ['BS', '연구소'], places: ['언주사무실', '흥부골'] });
const optTab = ss.getSheetByName('운행일지 항목');
check('선택지는 탭 하나에 함께 둔다 (팀 공통)',
      !!optTab && optTab.getRange(2, 1).getValue() === '구분'
      && optTab.getRange(3, 1).getValue() === '부서'
      && optTab.getRange(3, 2).getValue() === 'BS');
const opts = call({ driving: 'pull' }).options;
check('부서와 장소를 갈라서 돌려준다',
      opts.depts.join(',') === 'BS,연구소' && opts.places.join(',') === '언주사무실,흥부골');
call({ driving: 'options', depts: ['BS'], places: [] });
check('지운 선택지는 시트에서도 빠진다',
      call({ driving: 'pull' }).options.depts.join(',') === 'BS'
      && call({ driving: 'pull' }).options.places.length === 0);

check('차량 이름이 없으면 무엇이 잘못됐는지 말한다',
      call({ driving: 'push', rows: [] }).error.indexOf('차량') >= 0);
// 줄이 하나도 없으면 빈 탭을 새로 만들지 않는다 — 탭만 늘어난다.
check('기록이 없으면 빈 탭을 만들지 않는다',
      call({ driving: 'push', vehicleName: '1/2호차', info: {}, rows: [] })
        .sheets.length === 0 && !ss.getSheetByName('운행일지 2026 1 2호차'));
check('탭 이름에 못 쓰는 글자는 바꿔서 만든다',
      call({ driving: 'push', vehicleName: '1/2호차', info: {},
             rows: [{ id: 'z1', date: '2026-01-05', odoBefore: 1, odoAfter: 2 }] })
        .sheetName === '운행일지 2026 1 2호차');

// ── 해가 바뀌면 새 탭 ────────────────────────────────────────────────
call({
  driving: 'push',
  vehicleName: '스타리아 1호차',
  info: { model: '현대 스타리아 3밴', plate: '845누5868' },
  rows: [
    { id: 'd1', date: '2026-09-14', odoBefore: 15000, odoAfter: 15300,
      fromPlace: '언주사무실', toPlace: '흥부골', note: '' },
    { id: 'd9', date: '2027-01-03', odoBefore: 20000, odoAfter: 20150,
      fromPlace: '언주사무실', toPlace: '판교', note: '새해 첫 운행' },
  ],
});
check('★ 해가 바뀌면 새 탭에 쌓인다',
      !!ss.getSheetByName('운행일지 2027 스타리아 1호차'));
check('지난해 탭은 그대로 남는다',
      ss.getSheetByName('운행일지 2026 스타리아 1호차').getRange(6, 1).getValue() === '2026-09-14');
check('새해 탭에는 그 해 것만 있다',
      ss.getSheetByName('운행일지 2027 스타리아 1호차').getRange(6, 1).getValue() === '2027-01-03'
      && ss.getSheetByName('운행일지 2027 스타리아 1호차').getRange(7, 1).getValue() === '');
check('사업연도도 탭마다 그 해로 적힌다',
      ss.getSheetByName('운행일지 2027 스타리아 1호차').getRange(3, 8).getValue()
        === '2027-01-01 ~ 2027-12-31');
check('합계도 그 해 것만 센다',
      ss.getSheetByName('운행일지 2027 스타리아 1호차').getRange(4, 7).getValue() === 150);
check('①차종 ②등록번호는 해마다 같이 적힌다',
      ss.getSheetByName('운행일지 2027 스타리아 1호차').getRange(3, 5).getValue() === '845누5868');
check('읽을 때는 두 해가 함께 온다',
      call({ driving: 'pull', vehicleName: '스타리아 1호차' }).rows.length === 2);
check('해를 고르면 그 해만 읽는다',
      call({ driving: 'pull', vehicleName: '스타리아 1호차', year: '2027' }).rows.length === 1);

// 지난해 줄을 모두 지우고 올리면 그 해 탭도 비워져야 한다 (옛 줄이 남으면 안 된다)
call({
  driving: 'push', vehicleName: '스타리아 1호차',
  info: { model: '현대 스타리아 3밴', plate: '845누5868' },
  rows: [{ id: 'd9', date: '2027-01-03', odoBefore: 20000, odoAfter: 20150,
           fromPlace: '언주사무실', toPlace: '판교', note: '' }],
});
check('지난해 줄을 지우면 그 해 탭도 비워진다',
      ss.getSheetByName('운행일지 2026 스타리아 1호차').getRange(6, 1).getValue() === ''
      && ss.getSheetByName('운행일지 2026 스타리아 1호차').getRange(4, 2).getValue() === 0);

// 연도를 붙이기 전에 만들어진 탭도 읽어야 한다 (v3.21 에서 만든 것)
const legacy = ss.insertSheet('운행일지 옛차량');
legacy.getRange(5, 1, 1, 11).setValues([['③사용일자', '요일', '④부서', '성명',
  '⑤주행 전 계기판의 거리(㎞)', '⑥주행 후 계기판의 거리(㎞)', '⑦주행거리(㎞)',
  '⑧출발지', '⑨도착지', '⑩비고', '기록 ID']]);
legacy.getRange(6, 1, 1, 11).setValues([['2026-05-02', '토', 'BS', '홍길동',
  100, 180, 80, '가', '나', '', 'old1']]);
check('연도 없이 만든 옛 탭도 읽는다',
      call({ driving: 'pull', vehicleName: '옛차량' }).rows.length === 1);


// ═══════════════════════════════════════════════════════════════════
// 바뀐 시각 — 태블릿이 5분마다 이것만 묻는다
// ═══════════════════════════════════════════════════════════════════
console.log('');
console.log('── 시트가 마지막으로 바뀐 시각');
const c1 = call({ changed: true });
check('시각을 ISO 로 돌려준다', c1.ok === true && /^2026-09-14T/.test(c1.changedAt), JSON.stringify(c1));
env.updatedAt = new Date(2026, 8, 14, 9, 5, 0);
const c2 = call({ changed: true });
check('시트가 바뀌면 시각도 바뀐다', c2.changedAt !== c1.changedAt);
check('자료는 딸려 오지 않는다 (가벼운 물음 — 최소 버전만 함께)', Object.keys(c2).sort().join(',') === 'changedAt,minVersion,ok', Object.keys(c2).join(','));


// ═══════════════════════════════════════════════════════════════════
// 탭 순서 — 사람이 정한 자리를 스크립트가 지킨다
// ═══════════════════════════════════════════════════════════════════
console.log('');
console.log('── 탭 순서 고정');
const order = () => ss.getSheets().map((s) => s.getName());
// 지금까지의 검사로 탭이 여럿 생겼다. 아무 요청이든 한 번 지나가면 정렬된다.
call({ fields: 'pull' });
const o1 = order();
check('리포트 월 탭이 맨 앞 · 최근 달이 첫 탭',
      /^\d{4}-\d{2}$/.test(o1[0]) && o1.filter((n) => /^\d{4}-\d{2}$/.test(n)).join(',')
        === o1.filter((n) => /^\d{4}-\d{2}$/.test(n)).sort().reverse().join(','), o1.join(' · '));
const gi = o1.indexOf('오류 코드 가이드');
check('가이드 셋이 월 탭 다음에 정해진 차례로',
      gi > 0 && o1[gi + 1] === '하드웨어 교체 SOP' && o1[gi + 2] === 'SW·명령어'
      && o1.slice(0, gi).every((n) => /^\d{4}-\d{2}$/.test(n)), o1.join(' · '));
// 가짜 시트에 없는 탭은 건너뛰고, 있는 것들끼리의 앞뒤만 본다.
const tail = ['차량재고', '운행일지 20', '운행일지 항목', '리포트 항목', '앱 설치 링크', '앱 버전']
  .map((n) => o1.findIndex((x) => x.startsWith(n))).filter((i) => i >= 0);
check('차량재고 → 운행일지 → 운행일지 항목 · 리포트 항목 · 앱 설치 링크 · 앱 버전 순',
      tail.length >= 3 && tail.every((v, i) => i === 0 || v > tail[i - 1]), o1.join(' · '));
const drv = o1.filter((n) => /^운행일지 \d{4} /.test(n));
check('운행일지는 새 해가 앞', drv.length >= 2 && drv[0].includes(' 2027 ') && drv[drv.length - 1].includes(' 2026 '), drv.join(' · '));

// 사람이 손으로 뒤섭어 놓았다 — 다음 요청 때 제자리로
ss._shuffle([...o1].reverse());
check('뒤섭인 상태다', order()[0] !== o1[0]);
call({ fields: 'pull' });
check('★ 손으로 옮겨도 다음 요청 때 제자리로 돌아온다', order().join(',') === o1.join(','), order().join(' · '));

// 새 달 탭은 만들 때부터 맨 앞
call({ sheetName: '2027-03', headers: ['작성일시', '작성자', '항목'], row: ['2027-03-01 09:00', '홍길동', 'x'] });
// 앞의 검사들이 2099 년 탭을 만들어 두었으므로 "맨 앞" 은 곧 "최근 달 차례의 제자리" 다.
const monthsNow = () => order().filter((n) => /^\d{4}-\d{2}$/.test(n));
check('새 달 탭이 월 탭 무리 안 제자리에 생긴다 (더 최근 달 바로 뒤)',
      order().indexOf('2027-03') === monthsNow().filter((m) => m > '2027-03').length
      && monthsNow().join(',') === [...monthsNow()].sort().reverse().join(','), order().slice(0, 4).join(' · '));
const settled = order();
ss._shuffle([...settled].reverse());
call({ changed: true });
check('5분마다 오는 가벼운 물음(changed)은 탭을 건드리지 않는다', order().join(',') !== settled.join(','));
call({ fields: 'pull' });
check('그 다음 요청이 다시 맞춘다', order().join(',') === settled.join(','));


// ═══════════════════════════════════════════════════════════════════
// 차량재고 — 분류 열 · 줄 순서 · 옛 배치 읽기 · 옛 앱이 올려도 분류를 지킨다
// ═══════════════════════════════════════════════════════════════════
console.log('');
console.log('── 차량재고 분류 · 순서');
const invTab = () => ss.getSheetByName('차량재고');
const invRows = () => { const sh = invTab(); const n = sh.getLastRow(); return n < 3 ? [] : sh.getRange(3, 1, n - 2, sh.getLastColumn()).getValues(); };
call({ inventory: 'push', vehicles: ['1호차', '2호차'], items: [
  { vehicleName: '1호차', partName: 'C to C 2m', category: '케이블', quantity: 0, minQuantity: 1 },
  { vehicleName: '2호차', partName: 'C to C 2m', category: '케이블', quantity: 2, minQuantity: 1 },
  { vehicleName: '1호차', partName: 'C to C 1m', category: '케이블', quantity: 3, minQuantity: 2 },
  { vehicleName: '2호차', partName: 'C to C 1m', category: '케이블', quantity: 1, minQuantity: 2 },
  { vehicleName: '1호차', partName: '진공 패드', category: '', quantity: 3, minQuantity: 2 },
  { vehicleName: '2호차', partName: '진공 패드', category: '', quantity: 3, minQuantity: 2 },
] });
check('머리줄이 부품명 · 분류 · 최소보유 · 차량… 이다',
      JSON.stringify(invTab().getRange(2, 1, 1, 5).getValues()[0]) === JSON.stringify(['부품명', '분류', '최소보유', '1호차', '2호차']));
check('줄 순서가 올린 순서 그대로다 (이름순으로 바꾸지 않는다)',
      invRows().map((r) => r[0]).join(',') === 'C to C 2m,C to C 1m,진공 패드', invRows().map((r) => r[0]).join(','));
check('분류가 적힌다', invRows()[0][1] === '케이블' && invRows()[2][1] === '');
const invPull = call({ inventory: 'pull' });
check('읽을 때 분류가 함께 온다 · 줄 순서 그대로',
      invPull.items[0].partName === 'C to C 2m' && invPull.items[0].category === '케이블'
      && invPull.items[invPull.items.length - 1].partName === '진공 패드' && invPull.items[invPull.items.length - 1].category === '');

// 예전 앱(분류를 모른다)이 올린다 — 분류와 순서를 지켜야 한다
call({ inventory: 'push', vehicles: ['1호차', '2호차'], items: [
  { vehicleName: '1호차', partName: 'C to C 1m', quantity: 5, minQuantity: 2 },
  { vehicleName: '1호차', partName: 'C to C 2m', quantity: 0, minQuantity: 1 },
  { vehicleName: '1호차', partName: '진공 패드', quantity: 3, minQuantity: 2 },
  { vehicleName: '1호차', partName: '새 부품', quantity: 1, minQuantity: 0 },
] });
check('★ 옛 앱이 올려도 분류가 지워지지 않는다', invRows()[0][1] === '케이블' && invRows()[1][1] === '케이블');
check('★ 옛 앱이 올려도 줄 순서가 흐트러지지 않는다 · 새 부품은 뒤에',
      invRows().map((r) => r[0]).join(',') === 'C to C 2m,C to C 1m,진공 패드,새 부품', invRows().map((r) => r[0]).join(','));
check('수량은 옛 앱 것이 반영된다', invRows()[1][3] === 5);

// 옛 배치(분류 열 없음) 탭도 읽는다
const legacyInv = ss.insertSheet('차량재고 옛것');
legacyInv.getRange(2, 1, 1, 3).setValues([['부품명', '최소보유', '1호차']]);
legacyInv.getRange(3, 1, 1, 3).setValues([['베어링', 2, 4]]);
const legacyRead = gs.readInventory(legacyInv);
check('옛 배치(분류 열 없음)도 읽는다', legacyRead.vehicles.join(',') === '1호차'
      && legacyRead.items[0].partName === '베어링' && legacyRead.items[0].minQuantity === 2
      && legacyRead.items[0].quantity === 4 && legacyRead.items[0].category === '');

// 수량 한 칸 고치기가 새 배치에서도 맞는 열을 찾는다
call({ inventory: 'qty', ops: [{ type: 'quantity', vehicleName: '2호차', partName: 'C to C 1m', quantity: 9 }] });
check('수량 고치기가 차량 열을 바로 찾는다 (분류 열을 차량으로 착각하지 않는다)', invRows()[1][4] === 9
      && invTab().getRange(2, 2).getValue() === '분류');
const rowsBefore = invRows().length;
const colsBefore = invTab().getLastColumn();
call({ inventory: 'qty', ops: [
  { type: 'quantity', vehicleName: '1호차', partName: '지워진 부품', quantity: 2 },
  { type: 'quantity', vehicleName: '지워진 차량', partName: 'C to C 1m', quantity: 5 },
] });
check('지워진 품목·차량의 늦은 [+] 는 줄·열을 되살리지 않는다',
      invRows().length === rowsBefore && invTab().getLastColumn() === colsBefore
      && !invRows().some((r) => r[0] === '지워진 부품'));

{ // 운영 검사는 이 블록 안에서만 이름을 쓴다
// ─────────────────────────────────────────────── 운영 (v3.30) — 백업 · 변경기록 · 휴지통 · 기기 · 오류
console.log('── 운영: 매일 백업');
const today = new Date();
const pad2 = (n) => String(n).padStart(2, '0');
const todayText = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`;
env.scriptProps.delete('LAST_BACKUP_DAY');
const backupDir = () => findPath('시트 백업');
// 30일 지난 옛 백업 하나를 미리 둔다 — 휴지통으로 가야 한다
call({ changed: true });
const oldBackup = backupDir().createFile({ name: '테스트 시트 백업 2000-01-01', mime: 'x', getBytes: () => [] });
env.scriptProps.delete('LAST_BACKUP_DAY');
call({ changed: true, device: '검사기기', app: '3.30.0', pending: 2 });
const backups = backupDir().files.filter((f) => f.name === `테스트 시트 백업 ${todayText}`);
check('5분 물음이 하루 한 번 스프레드시트를 복사해 둔다', backups.length >= 1, backupDir().files.map((f) => f.name).join(' | '));
call({ changed: true });
check('같은 날 두 번은 복사하지 않는다',
      backupDir().files.filter((f) => f.name === `테스트 시트 백업 ${todayText}` && !f.trashed).length === backups.length);
check('30일 지난 백업은 휴지통으로 (드라이브 휴지통에서 30일 더 되살릴 수 있다)', oldBackup.trashed === true);

console.log('── 운영: 기기 탭 · 최소 버전');
const devTab = () => ss.getSheetByName('기기');
const devRow = (name) => {
  const t = devTab(); const n = t.getLastRow();
  for (let r = 3; r <= n; r += 1) if (t.getRange(r, 1).getValue() === name) return t.getRange(r, 1, 1, 5).getValues()[0];
  return null;
};
check('5분 물음에 실린 기기 이름 · 버전 · 올리지 못한 건수가 기기 탭에 적힌다',
      devRow('검사기기') && devRow('검사기기')[1] === '3.30.0' && devRow('검사기기')[3] === 2,
      JSON.stringify(devRow('검사기기')));
check('최소 버전 칸이 비어 있으면 최소 버전도 빈 값', call({ changed: true }).minVersion === '');
devTab().getRange(1, 2).setValue('3.31.0');
check('기기 탭 B1 의 최소 버전을 5분 물음과 새 버전 물음이 함께 돌려준다',
      call({ changed: true }).minVersion === '3.31.0' && call({ release: 'latest' }).minVersion === '3.31.0');
devTab().getRange(1, 2).setValue('');

console.log('── 운영: 리포트 변경기록 · 휴지통 · 줄 확인');
const H = ['작성일시', '작성자', '매장명', '증상 요약', '조치 내용', '상태'];
const logTab = () => ss.getSheetByName('변경기록');
const logRows = () => { const t = logTab(); const n = t.getLastRow(); return n < 3 ? [] : t.getRange(3, 1, n - 2, 6).getValues(); };
call({ sheetName: '2099-07', headers: H, row: ['2099-07-01 09:00', '가', '첫째점', '소음', '조치1', '조치 진행 중'], device: '김현장', app: '3.30.0' });
call({ sheetName: '2099-07', headers: H, row: ['2099-07-02 09:00', '가', '둘째점', '멈춤', '조치2', '조치 진행 중'], device: '김현장', app: '3.30.0' });
call({ sheetName: '2099-07', headers: H, row: ['2099-07-03 09:00', '가', '셋째점', '센서', '조치3', '조치 진행 중'], device: '김현장', app: '3.30.0' });
const last = logRows()[logRows().length - 1];
check('리포트를 올리면 변경기록에 시각 · 기기 · 버전 · 무엇이 한 줄', last && last[1] === '김현장' && last[2] === '3.30.0'
      && last[3] === '리포트 추가' && String(last[5]).includes('셋째점'), JSON.stringify(last));

const month = () => ss.getSheetByName('2099-07');
const storeAt = (r) => month().getRange(r, 3).getValue();
// 다른 기기가 첫째 줄(3행)을 지워 줄이 한 칸씩 올라갔다고 하자. 이 기기는 아직 '셋째점 = 5행' 으로 알고 있다.
call({ reports: 'delete', sheetName: '2099-07', row: 3, expect: { createdAt: '2099-07-01 09:00', store: '첫째점' }, device: '박사무' });
check('줄 확인과 함께 지우면 그 줄이 지워진다', storeAt(3) === '둘째점' && storeAt(4) === '셋째점');
let res = call({ reports: 'status', sheetName: '2099-07', row: 5, status: '조치 완료',
                 expect: { createdAt: '2099-07-03 09:00', store: '셋째점' }, device: '김현장' });
check('★ 줄이 올라가 옛 줄 번호(5행)로 와도 같은 리포트(4행)를 찾아 상태를 바꾼다',
      res.ok === true && res.row === 4 && month().getRange(4, 6).getValue() === '조치 완료', JSON.stringify(res));
res = call({ reports: 'delete', sheetName: '2099-07', row: 4, expect: { createdAt: '2099-07-09 09:00', store: '없는점' } });
check('★ 맞는 줄이 없으면 엉뚱한 줄을 지우지 않고 멈춘다 (conflict)',
      res.ok === false && res.conflict === true && storeAt(3) === '둘째점' && storeAt(4) === '셋째점', JSON.stringify(res));
check('상태 변경은 바뀌기 전 → 후로 기록된다', logRows().some((r) => r[3] === '상태' && r[5] === '조치 진행 중 → 조치 완료'));

const trashTab = () => ss.getSheetByName('휴지통');
let trash = call({ trash: 'list' });
check('지운 리포트는 휴지통에 통째로 남는다', trash.ok && trash.items.length >= 1 && trash.items[0].kind === '리포트'
      && trash.items[0].name.includes('첫째점') && trash.items[0].by === '박사무', JSON.stringify(trash.items[0]));
res = call({ trash: 'restore', row: trash.items[0].row, device: '박사무' });
check('휴지통에서 되살리면 그 달 탭에 다시 들어간다', res.ok === true
      && [3, 4, 5].some((r) => storeAt(r) === '첫째점'), JSON.stringify(res));
check('되살린 것은 되살림 칸에 적혀 다시 되살릴 수 없다',
      call({ trash: 'restore', row: trash.items[0].row }).ok === false && call({ trash: 'list' }).items[0].restored !== '');

console.log('── 운영: 가이드 지우기 → 휴지통');
const keep = { id: 'g-keep', categoryType: 'HARDWARE_SOP', codeOrTitle: '남는 가이드', summary: '', requiredTools: '',
               commands: [], steps: [{ instruction: '하나', expectedMetric: '' }], updatedAt: '' };
const gone = { id: 'g-gone', categoryType: 'HARDWARE_SOP', codeOrTitle: '지울 가이드', summary: '요약', requiredTools: '',
               commands: [], steps: [{ instruction: '둘', expectedMetric: '' }], updatedAt: '' };
call({ guides: 'push', items: [keep, gone], device: '김현장' });
call({ guides: 'push', items: [keep], device: '이기사' });
trash = call({ trash: 'list' });
const gTrash = trash.items.find((t) => t.kind === '가이드' && t.name.includes('지울 가이드'));
check('★ 가이드를 지우면 누가 지웠는지와 함께 휴지통에 남는다 (예전엔 흔적이 없었다)', gTrash && gTrash.by === '이기사',
      JSON.stringify(trash.items.slice(0, 3)));
check('가이드 변경 요약이 변경기록에 남는다', logRows().some((r) => r[3] === '가이드' && String(r[5]).includes('삭제(휴지통): 지울 가이드')));
res = call({ trash: 'restore', row: gTrash.row });
const back = call({ guides: 'pull' }).items.find((g) => g.id === 'g-gone');
check('휴지통에서 되살린 가이드가 같은 ID 로 탭에 돌아온다', res.ok && back && back.summary === '요약');

console.log('── 운영: 재고 수량은 바뀐 만큼만 (다른 기기 변경과 합친다)');
call({ inventory: 'push', vehicles: ['합차'], items: [{ vehicleName: '합차', partName: '패드', category: '', quantity: 3, minQuantity: 0 }] });
const padQty = () => { const t = ss.getSheetByName('차량재고'); for (let r = 3; r <= t.getLastRow(); r += 1) if (t.getRange(r, 1).getValue() === '패드') return t.getRange(r, 4).getValue(); return null; };
// 다른 기기가 3 → 5 로 올렸다. 이 기기는 3 을 보고 [+] 한 번 (3 → 4)
call({ inventory: 'qty', ops: [{ type: 'quantity', vehicleName: '합차', partName: '패드', quantity: 5 }] });
call({ inventory: 'qty', ops: [{ type: 'quantity', vehicleName: '합차', partName: '패드', quantity: 4, before: 3, opId: 'op-1' }], device: '김현장' });
check('★ 두 기기가 같은 칸을 바꿔도 둘 다 반영된다 (3 → 다른 기기 +2 → 내 +1 = 6)', padQty() === 6, String(padQty()));
call({ inventory: 'qty', ops: [{ type: 'quantity', vehicleName: '합차', partName: '패드', quantity: 4, before: 3, opId: 'op-1' }] });
check('응답을 못 받아 같은 작업을 다시 보내도 두 번 더하지 않는다', padQty() === 6, String(padQty()));
call({ inventory: 'qty', ops: [{ type: 'quantity', vehicleName: '합차', partName: '패드', quantity: 6, before: 3, opId: 'op-1' }] });
check('같은 작업에 [+] 를 더 눌러 합쳐 보내면 새로 누른 만큼만 더한다 (4 → 6 이면 +2)', padQty() === 8, String(padQty()));
call({ inventory: 'qty', ops: [{ type: 'quantity', vehicleName: '합차', partName: '패드', quantity: 1 }] });
check('예전 앱(바꾸기 전 값 없음)은 예전처럼 그 값으로 적는다', padQty() === 1, String(padQty()));
check('수량 변경이 변경기록에 남는다 (부품 · 차량 전 → 후)', logRows().some((r) => r[3] === '재고 수량' && String(r[5]).includes('패드 · 합차 5→6')));

console.log('── 운영: 오류기록');
res = call({ errors: 'push', device: '김현장', app: '3.30.0', items: [
  { at: '2099-07-03 10:00', screen: '#/report/new', message: '업로드 실패: 시간 초과', detail: 'stack…' },
] });
const errTab = ss.getSheetByName('오류기록');
check('기기에서 모은 오류가 오류기록 탭에 쌓인다', res.ok && res.saved === 1 && errTab
      && errTab.getRange(3, 5).getValue() === '업로드 실패: 시간 초과' && errTab.getRange(3, 2).getValue() === '김현장');
check('마지막 오류가 기기 탭에도 보인다', String(devRow('김현장')[4]).includes('업로드 실패'));
const tabNames = ss.getSheets().map((x) => x.getName());
const opsAt = tabNames.indexOf('기기');
check('운영 탭은 알려진 탭 맨 뒤에 차례대로 모인다 (모르는 탭만 그 뒤)',
      tabNames.slice(opsAt, opsAt + 4).join(',') === '기기,변경기록,오류기록,휴지통'
      && tabNames.indexOf('앱 버전') < opsAt, tabNames.join(','));
}

{ // 첨부 조각 올리기 (v3.30)
  console.log('── 첨부 조각 올리기 — 끊겨도 이어 올린다');
  const parts = ['AAAA', 'BBBB', 'CCCC'];
  for (let i = 0; i < parts.length; i += 1) {
    const r = call({ media: 'chunk', uploadId: 'mzz-test1', index: i, total: 3, data: parts[i] });
    if (!r.ok) check(`조각 ${i} 를 받는다`, false, JSON.stringify(r));
  }
  call({ media: 'chunk', uploadId: 'mzz-test1', index: 1, total: 3, data: 'BBBB' });   // 같은 조각을 다시 (재시도)
  const chunkDir = findPath('업로드 조각 (자동 정리)');
  check('조각은 조각 폴더에 놓인다 · 다시 받은 조각은 새것 하나만 살아 있다',
        chunkDir && chunkDir.files.filter((f) => f.name === 'mzz-test1.1' && !f.trashed).length === 1);
  let r = call({ media: 'finish', uploadId: 'mzz-test2', total: 2, filename: 'x.jpg', mimeType: 'image/jpeg' });
  check('빠진 조각이 있으면 파일을 만들지 않고 어느 조각인지 알려 준다', r.ok === false && JSON.stringify(r.missing) === '[0,1]', JSON.stringify(r));
  r = call({ media: 'finish', uploadId: 'mzz-test1', total: 3, filename: '현장.jpg', mimeType: 'image/jpeg',
             storeName: '조각점', dateText: '2099-08-01' });
  const made = findPath('조각점', '2099-08-01', '사진');
  check('조각을 이어 붙여 매장 → 날짜 → 사진 폴더에 파일 하나를 만든다', r.ok === true && made
        && made.files.length === 1 && /drive\.google\.com/.test(r.url), JSON.stringify(r));
  check('붙인 파일의 내용은 조각을 차례대로 이은 것이다', made && made.files[0] && made.files[0].getBlob()._bytes._b64 === 'AAAABBBBCCCC',
        made && made.files[0] && JSON.stringify(made.files[0].getBlob()._bytes));
  check('다 붙인 조각은 지운다', chunkDir.files.filter((f) => f.name.startsWith('mzz-test1.') && !f.trashed).length === 0);
  const before = ss.getSheetByName('2099-09') ? ss.getSheetByName('2099-09').getLastRow() : 0;
  call({ sheetName: '2099-09', headers: ['작성일시', '매장명', '현장 사진', '상태'],
         row: ['2099-09-01 10:00', '조각점', r.url, '조치 진행 중'] });
  const tab = ss.getSheetByName('2099-09');
  check('미리 올린 첨부 주소도 시트에서 눌러 열리는 링크가 된다', tab.links.size > 0 && tab.getLastRow() > before);

  console.log('── 빨리 올리기 (v3.33) — 작은 파일은 한 번에 · 폴더 위치 기억 · 조각엔 탭 정리 없음');
  const fake = env;
  let sheetsAsked = 0;
  const getSheets = ss.getSheets.bind(ss);
  ss.getSheets = () => { sheetsAsked += 1; return getSheets(); };
  fake.driveCalls.byName = 0;
  r = call({ media: 'finish', uploadId: 'mzz-small', total: 1, data: 'DDDD', filename: '작은.jpg',
             mimeType: 'image/jpeg', storeName: '조각점', dateText: '2099-08-01', device: '김현장' });
  check('조각 하나짜리는 마무리 요청 한 번으로 파일이 된다', r.ok === true && made.files.length === 2
        && made.files[1].getBlob()._bytes._b64 === 'DDDD', JSON.stringify(r));
  check('한 번에 보낸 파일은 조각 폴더를 거치지 않는다', !chunkDir.files.some((f) => f.name.startsWith('mzz-small')));
  check('같은 매장 · 날짜 폴더는 기억해 둔 위치로 바로 간다 (이름으로 다시 찾지 않는다)', fake.driveCalls.byName === 0,
        `이름 찾기 ${fake.driveCalls.byName}번`);
  call({ media: 'chunk', uploadId: 'mzz-fast', index: 0, total: 1, data: 'EEEE', device: '김현장' });
  check('조각 · 마무리 요청은 탭 순서 맞추기를 건너뛴다 (재고 탭까지 읽지 않는다)', sheetsAsked === 0, `탭 목록 ${sheetsAsked}번`);
  ss.getSheets = getSheets;
  made.setTrashed(true);                                 // 누가 사진 폴더를 휴지통에 넣었다
  r = call({ media: 'finish', uploadId: 'mzz-small2', total: 1, data: 'FFFF', filename: '작은2.jpg',
             mimeType: 'image/jpeg', storeName: '조각점', dateText: '2099-08-01' });
  const again = findPath('조각점', '2099-08-01', '사진');
  check('기억한 폴더가 휴지통에 있으면 다시 찾아 만든다 (휴지통에 넣지 않는다)', r.ok === true && again && again !== made
        && !again.trashed && again.files.some((f) => f.getBlob()._bytes._b64 === 'FFFF'));
  r = call({ media: 'finish', uploadId: 'mzz-fast', total: 1, filename: '조각.jpg', mimeType: 'image/jpeg',
             storeName: '조각점', dateText: '2099-08-01' });
  check('미리 보낸 조각 하나는 data 없는 마무리로 붙는다', r.ok === true
        && again.files.some((f) => f.getBlob()._bytes._b64 === 'EEEE'), JSON.stringify(r));

  console.log('── 조각 id (v3.36.1) — 드라이브 이름 찾기가 방금 만든 조각을 못 봐도 붙는다');
  // 실제로 난 일: 1분 영상 조각 14개를 다 보내자마자 마무리 → '빠진 조각: 0,1,…,13'
  fake.searchLag = true;
  const lagParts = ['GGGG', 'HHHH', 'IIII'];
  const ids = lagParts.map((data, i) => call({ media: 'chunk', uploadId: 'mzz-lag', index: i, total: 3, data }).fileId);
  check('조각을 받으면 그 파일 id 를 돌려준다', ids.every((x) => typeof x === 'string' && x.length > 0), JSON.stringify(ids));
  r = call({ media: 'finish', uploadId: 'mzz-lag', total: 3, filename: '영상.mp4', mimeType: 'video/mp4',
             storeName: '조각점', dateText: '2099-08-02' });
  const video = findPath('조각점', '2099-08-02', '동영상');
  check('이름 찾기가 조각을 못 봐도 기억한 id 로 이어 붙인다', r.ok === true && video
        && video.files.some((f) => f.getBlob()._bytes._b64 === 'GGGGHHHHIIII'), JSON.stringify(r));
  check('다 붙인 조각은 지운다 (이름 찾기 없이)', chunkDir.files.filter((f) => f.name.startsWith('mzz-lag.') && !f.trashed).length === 0);

  // 캐시가 날아가도(시트 서버가 바뀜) 앱이 들고 온 id 로 붙는다
  const appIds = ['JJJJ', 'KKKK'].map((data, i) => call({ media: 'chunk', uploadId: 'mzz-lag2', index: i, total: 2, data }).fileId);
  env.scriptCache.clear();
  r = call({ media: 'finish', uploadId: 'mzz-lag2', total: 2, parts: appIds, filename: '영상2.mp4', mimeType: 'video/mp4',
             storeName: '조각점', dateText: '2099-08-02' });
  check('캐시가 비어도 앱이 보낸 조각 id 로 이어 붙인다', r.ok === true
        && video.files.some((f) => f.getBlob()._bytes._b64 === 'JJJJKKKK'), JSON.stringify(r));

  // 다시 보낸 조각 — 앞의 것은 기억한 id 로 지운다 (이름 찾기로는 안 보인다)
  call({ media: 'chunk', uploadId: 'mzz-lag3', index: 0, total: 1, data: 'LLLL' });
  call({ media: 'chunk', uploadId: 'mzz-lag3', index: 0, total: 1, data: 'LLLL' });
  check('같은 조각을 다시 받으면 앞의 것은 지운다 (검색이 늦어도)',
        chunkDir.files.filter((f) => f.name === 'mzz-lag3.0' && !f.trashed).length === 1);

  // 남의 파일 id 를 들이밀어도 읽지 않는다 — 이름이 그 조각 이름이어야 한다
  r = call({ media: 'finish', uploadId: 'mzz-lag4', total: 1, parts: [video.files[0].getId()],
             filename: 'x.mp4', mimeType: 'video/mp4' });
  check('이름이 다른 파일 id 는 조각으로 쓰지 않는다', r.ok === false && JSON.stringify(r.missing) === '[0]', JSON.stringify(r));
  check('정말 없는 조각은 조금 기다렸다 다시 찾아본 뒤 알린다', fake.sleptMs >= 6000, `${fake.sleptMs}ms`);
  fake.searchLag = false;
}

{ // 작업 목록 (v3.31)
  console.log('── 작업 목록 — 구분 › 대분류 › 세부 작업 · 바뀐 것만 올리기');
  let w = call({ work: 'pull' });
  check('탭이 없으면 없다고 말한다 (앱이 기본 대분류를 올린다)', w.ok && w.exists === false);
  // v3.31 이 만든 '작업 목록' 탭이 이미 있는 팀을 흉내 낸다 (머리줄만)
  { const legacy = ss.insertSheet('작업 목록'); legacy.getRange(2, 1).setValue('구분'); }
  w = call({ work: 'push', device: '김현장', ops: [
    { op: 'cat-add', kind: '로봇 이슈', name: '하드웨어 교체' },
    { op: 'cat-add', kind: '로봇 이슈', name: '유지 보수' },
    { op: 'cat-add', kind: '로봇 외 이슈', name: '네트워크 · 와이파이' },
    { op: 'item-upsert', item: { id: 'w1', kind: '로봇 이슈', cat: '하드웨어 교체', name: '로더 교체', aliases: [], guides: [] } },
    { op: 'item-upsert', item: { id: 'w2', kind: '로봇 이슈', cat: '하드웨어 교체', name: '팔 교체', aliases: [], guides: [], isNew: true } },
  ] });
  check('대분류 · 항목을 올리면 탭에 적힌다', w.ok && w.cats.length === 3 && w.items.length === 2,
        JSON.stringify({ cats: w.cats.length, items: w.items.length }));
  check('항목이 없는 대분류도 남는다 (유지 보수 · 네트워크)', w.cats.some((c) => c.name === '유지 보수')
        && w.cats.some((c) => c.kind === '로봇 외 이슈'));
  check('현장에서 새로 적은 것은 새 항목 표시', w.items.find((i) => i.id === 'w2').isNew === true);
  // 다른 기기가 동시에 하나 더 올린다 — 앞의 것을 지우지 않는다
  call({ work: 'push', ops: [{ op: 'item-upsert', item: { id: 'w3', kind: '로봇 외 이슈', cat: '네트워크 · 와이파이', name: '와이파이 재연결' } }] });
  // 합치기: 팔 교체 → 로더 교체 (별칭으로 남긴다)
  w = call({ work: 'push', ops: [
    { op: 'item-upsert', item: { id: 'w1', kind: '로봇 이슈', cat: '하드웨어 교체', name: '로더 교체', aliases: ['팔 교체'], guides: ['g-aaa'] } },
    { op: 'item-delete', id: 'w2' },
  ] });
  const loader = w.items.find((i) => i.id === 'w1');
  check('★ 합치기 — 팔 교체는 로더 교체의 별칭이 되고 항목은 하나', w.items.length === 2 && loader.aliases[0] === '팔 교체'
        && !w.items.some((i) => i.name === '팔 교체'), JSON.stringify(w.items));
  check('다른 기기가 올린 항목이 남아 있다 (통째로 덮지 않는다)', w.items.some((i) => i.name === '와이파이 재연결'));
  check('가이드를 이어 둘 수 있다', loader.guides[0] === 'g-aaa');
  w = call({ work: 'push', ops: [{ op: 'cat-rename', kind: '로봇 이슈', from: '하드웨어 교체', to: '부품 교체' }] });
  check('대분류 이름을 바꾸면 그 아래 항목도 따라간다', w.items.find((i) => i.id === 'w1').cat === '부품 교체'
        && !w.cats.some((c) => c.name === '하드웨어 교체'));
  w = call({ work: 'push', ops: [{ op: 'cat-delete', kind: '로봇 이슈', name: '부품 교체' }] });
  check('항목이 남은 대분류는 지우지 않는다', w.cats.some((c) => c.name === '부품 교체'));
  const tab = ss.getSheetByName('이슈 유형 목록');
  check('v3.31 의 "작업 목록" 탭은 "이슈 유형 목록" 으로 이름만 바뀐다 (내용 그대로)', !!tab && !ss.getSheetByName('작업 목록'));
  check('탭 머리줄 · 사람이 읽는 줄 (구분 | 대분류 | 세부 항목 | 별칭 …)',
        tab.getRange(2, 1).getValue() === '구분' && tab.getRange(3, 1).getValue() === '로봇 이슈');
  check('이슈 유형 목록 변경이 변경기록에 남는다', ss.getSheetByName('변경기록').getRange(3, 1, ss.getSheetByName('변경기록').getLastRow() - 2, 6)
        .getValues().some((r) => r[3] === '이슈 유형 목록'));
}

console.log('='.repeat(62));
if (failures.length) {
  console.log(`❌ 실패 ${failures.length}건: ${failures.join(', ')}`);
  process.exit(1);
}
console.log('✅ 전부 통과 — Apps Script 가 실제로 동작합니다.');

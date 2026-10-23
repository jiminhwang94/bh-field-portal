// 화면 검사용 예시 자료 — 가짜 시트에 넣고 앱이 받아 가게 한다.
// 늘 같은 자료 · 같은 시각이라 화면이 매번 똑같이 그려진다 (스타일 비교 · 스크린샷 비교용).

const NOW = new Date('2026-10-22T10:00:00+09:00');

const GUIDES = [
  { id: 'a1b2c3d4e5f60001', categoryType: 'ERROR_CODE', robotModel: 'Gen.1', codeOrTitle: 'E-101 로더 모터 과전류',
    summary: '로더 축 모터가 과전류로 멈춘다', requiredTools: '테스터, 육각 렌치',
    commands: [{ label: '상태 확인', cmd: 'bhctl status loader', desc: '먼저 확인' }],
    steps: [{ instruction: '전원을 내리고 커넥터 CN3 를 확인한다', expectedMetric: '테스터' },
            { instruction: '벨트 장력을 재조정한다', expectedMetric: '육각 렌치' }],
    updatedAt: '2026-10-20T10:00:00' },
  { id: 'a1b2c3d4e5f60002', categoryType: 'HARDWARE_SOP', robotModel: 'Gen.2', codeOrTitle: '그리퍼 패드 교체',
    summary: '패드가 닳으면 교체', requiredTools: '드라이버', commands: [],
    steps: [{ instruction: '패드를 분리한다', expectedMetric: '' }], updatedAt: '2026-10-19T10:00:00' },
  { id: 'a1b2c3d4e5f60003', categoryType: 'SOFTWARE_CMD', robotModel: '', codeOrTitle: 'OTA 설정 방법',
    summary: '펌웨어 수동 갱신', requiredTools: '', commands: [{ label: '갱신', cmd: 'bhctl ota --now', desc: '' }],
    steps: [{ instruction: '와이파이를 연결한다', expectedMetric: '' }], updatedAt: '2026-10-18T10:00:00' },
];

const INVENTORY = {
  vehicles: ['스타리아 5868', '스타리아 4373'],
  items: [
    { vehicleName: '스타리아 5868', partName: '그리퍼 실리콘 패드', category: '소모품', quantity: 1, minQuantity: 3 },
    { vehicleName: '스타리아 4373', partName: '그리퍼 실리콘 패드', category: '소모품', quantity: 5, minQuantity: 3 },
    { vehicleName: '스타리아 5868', partName: '가스게이지', category: '소모품', quantity: 3, minQuantity: 2 },
    { vehicleName: '스타리아 4373', partName: '가스게이지', category: '소모품', quantity: 2, minQuantity: 2 },
    { vehicleName: '스타리아 5868', partName: 'C to C 2m', category: '케이블', quantity: 2, minQuantity: 1 },
    { vehicleName: '스타리아 4373', partName: 'C to C 2m', category: '케이블', quantity: 0, minQuantity: 1 },
  ],
};

const REPORT_HEADERS = ['작성일시', '작성자', '리포트 번호', '매장명', '로봇 시리얼', '로봇 모델',
  '증상 요약', '조치 내용', '처리 결과', '현장 사진', '상태'];
const REPORTS = [
  ['2026-10-21 09:10', '검사봇', 'P261021-01', '옥동식 서초점', 'SN-0001', 'Gen.1(D1)',
   '로더가 멈춤', '커넥터 재체결', '모니터링', '', '조치 진행 중'],
  ['2026-10-19 14:20', '검사봇', 'P261019-02', '정숙성 샤로수', 'SN-0002', 'GEN.2(M12)',
   '바퀴 소음', '베어링 교체', '완료', '', '조치 완료'],
  ['2026-10-15 11:00', '검사봇', 'P261015-03', '홍기와 본점', 'SN-0003', 'Gen.1(D2)',
   '센서 오류 E-204', '센서 교체 예정', '부품 대기', '', '교체 예정'],
];

/** 가짜 시트에 예시 자료를 넣는다. sheet = fixtures 의 sheet */
async function seed(sheet) {
  await sheet.call({ guides: 'push', items: GUIDES });
  await sheet.call({ inventory: 'push', ...INVENTORY });
  for (const row of REPORTS) {
    await sheet.call({ sheetName: '2026-10', headers: REPORT_HEADERS, row });
  }
}

module.exports = { seed, NOW, GUIDES };

// 타입 검사용 — 브라우저가 실제로 주지만 표준 타입에 없는 것들 (실행되는 코드가 아니다).
interface Navigator {
  /** iOS Safari 홈 화면 앱 */
  standalone?: boolean;
}
interface Window {
  /** index.html 이 미리 받아 둔 설치 프롬프트 이벤트 */
  __bhInstallPrompt?: any;
}

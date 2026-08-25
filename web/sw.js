// 서비스 워커 — 오프라인에서도 앱 화면이 열리게 한다.
//
// 두 가지 일을 한다.
//  1) 앱 화면 파일(HTML/CSS/JS)을 캐시에 담아 두고 오프라인이면 캐시로 응답
//  2) /media/<파일명> 요청을 **기기 안 데이터베이스**의 사진으로 응답
//
// 데이터(가이드·재고·리포트)는 IndexedDB 에 있으므로 여기서 다루지 않는다.

const CACHE = 'bh-shell-v3.0.0';

// 앱을 여는 데 필요한 파일 전부.
// ⚠️ 화면 파일(js/css)을 추가하면 **이 목록에도 반드시 추가**해야 오프라인에서 열린다.
//    (tests/test_offline_shell.py 가 빠진 파일이 있는지 검사한다)
const SHELL = [
  './', './index.html', './css/app.css', './manifest.webmanifest',
  './js/app.js', './js/api.js', './js/sync.js', './js/sheets.js',
  './js/invsheet.js',
  './js/net.js', './js/auth.js', './js/install.js', './js/publish.js',
  './js/share.js', './js/ui.js', './js/update.js',
  './js/local/idb.js', './js/local/store.js',
  './js/views/guides.js', './js/views/inventory.js', './js/views/fields.js',
  './js/views/report.js', './js/views/settings.js',
  './icons/icon-192.png', './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // 파일 하나가 없어도 설치가 실패하지 않도록 개별로 담는다.
      .then((cache) => Promise.all(
        SHELL.map((url) => cache.add(url).catch(() => null))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key.startsWith('bh-shell-') && key !== CACHE)
          .map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

// ------------------------------------------------- 기기 안 사진 꺼내오기

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('bh-field-portal');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function mediaFromDevice(filename) {
  let db;
  try {
    db = await openDb();
  } catch {
    return null;
  }
  if (!db.objectStoreNames.contains('media')) return null;
  const row = await new Promise((resolve) => {
    const req = db.transaction('media', 'readonly').objectStore('media').get(filename);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
  if (!row || !row.blob) return null;
  return new Response(row.blob, {
    headers: {
      'Content-Type': row.mime || 'application/octet-stream',
      'Cache-Control': 'no-store',
    },
  });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;      // 구글 시트 전송 등은 그대로

  // 사진: 기기 안 저장본을 먼저 쓰고, 없으면 서버에서 받아 온다.
  if (url.pathname.startsWith('/media/')) {
    const filename = decodeURIComponent(url.pathname.slice('/media/'.length));
    event.respondWith(
      mediaFromDevice(filename)
        .then((res) => res || fetch(request))
        .catch(() => fetch(request)),
    );
    return;
  }

  // API 는 캐시하지 않는다 (오래된 값이 보이면 안 된다).
  if (url.pathname.startsWith('/api/')) return;

  // 화면 파일: 캐시 우선 + 뒤에서 갱신
  event.respondWith((async () => {
    const cached = await caches.match(request, { ignoreSearch: true });
    const network = fetch(request).then((res) => {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
      }
      return res;
    }).catch(() => null);

    if (cached) {
      network;                       // 갱신은 뒤에서 조용히
      return cached;
    }
    const fresh = await network;
    if (fresh) return fresh;
    // 화면 이동(네비게이션)인데 캐시가 없으면 첫 화면이라도 보여 준다.
    if (request.mode === 'navigate') {
      const shell = await caches.match('./index.html');
      if (shell) return shell;
    }
    return new Response('오프라인입니다.', {
      status: 503, headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    });
  })());
});

// JAZZIN Service Worker — シンプル版（CSP対応）
const CACHE_NAME = 'jazzin-v2';

// キャッシュする自サイトのファイルのみ
const STATIC_ASSETS = [
  '/index.html',
  '/event.html',
  '/confirm.html',
  '/checkin.html',
  '/mypage.html',
  '/ui/style.css',
  '/core/supabase.js',
  '/manifest.json',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 外部ドメインはすべてService Workerを通さず直接フェッチ
  if (url.origin !== self.location.origin) return;

  // config.jsは常に最新を取得
  if (url.pathname === '/config.js') return;

  // 自サイトのGETリクエストのみキャッシュ戦略を適用
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      const fetchPromise = fetch(event.request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
      // キャッシュがあればすぐ返し、バックグラウンドで更新
      return cached || fetchPromise;
    })
  );
});
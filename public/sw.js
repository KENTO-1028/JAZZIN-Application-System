// JAZZIN Service Worker v5
// レスポンスcloneのレースコンディション修正
const CACHE_NAME = 'jazzin-v5';

const PRECACHE = [
  '/ui/style.css',
  '/core/supabase.js',
  '/manifest.json',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE))
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

  // 外部ドメインは完全スルー（Supabase・Google Fonts・CDN等）
  if (url.origin !== self.location.origin) return;

  // クエリパラメータ付きURL（event.html?id=...）はスルー
  if (url.search) return;

  // config.jsはスルー（常に最新を取得）
  if (url.pathname === '/config.js') return;

  // GETのみ対象
  if (event.request.method !== 'GET') return;

  // HTMLページはネットワーク優先（キャッシュはフォールバックのみ）
  if (event.request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response.ok && response.type === 'basic') {
            // cloneを先に作ってからキャッシュへ（レースコンディション防止）
            const toCache = response.clone();
            event.waitUntil(
              caches.open(CACHE_NAME).then(cache => cache.put(event.request, toCache))
            );
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // CSS・JS等の静的ファイルはキャッシュ優先
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response.ok && response.type === 'basic') {
          // cloneを先に作ってからキャッシュへ（レースコンディション防止）
          const toCache = response.clone();
          event.waitUntil(
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, toCache))
          );
        }
        return response;
      });
    })
  );
});
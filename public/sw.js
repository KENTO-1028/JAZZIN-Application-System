// JAZZIN Service Worker v3 — リダイレクト対応版
const CACHE_NAME = 'jazzin-v3';

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

  // 外部ドメインはスルー
  if (url.origin !== self.location.origin) return;

  // config.jsは常に最新
  if (url.pathname === '/config.js') return;

  // GETのみ
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request, { redirect: 'follow' })
      .then(response => {
        // リダイレクトされたレスポンスはキャッシュしない
        if (!response.ok || response.type === 'opaqueredirect') return response;
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
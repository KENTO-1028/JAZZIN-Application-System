// JAZZIN Service Worker — Phase 8: PWA / オフライン耐性
const CACHE_NAME = 'jazzin-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/event.html',
  '/confirm.html',
  '/checkin.html',
  '/mypage.html',
  '/ui/style.css',
  '/core/supabase.js',
  '/config.js',
  '/assets/jazzin_logo.png',
];

// Install: 静的アセットをキャッシュ
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS.filter(url => !url.includes('config.js'))))
      .then(() => self.skipWaiting())
  );
});

// Activate: 古いキャッシュを削除
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Fetch: ネットワーク優先、失敗時キャッシュにフォールバック
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Supabase APIはキャッシュしない
  if (url.hostname.includes('supabase.co')) return;
  // config.jsはキャッシュしない（常に最新を取得）
  if (url.pathname === '/config.js') return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        // 成功したレスポンスをキャッシュに保存
        if (response.ok && event.request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
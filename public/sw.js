// JAZZIN Service Worker v6
// ✅ v5→v6: キャッシュバージョンを上げて、古い端末にこびりついた
//    古いキャッシュ（core/supabase.js の旧バージョンなど）を強制的に破棄する。
// ✅ CSS・JSの戦略を cache-first → stale-while-revalidate に変更。
//    これまでは一度キャッシュされたJS/CSSは「新しいSWがインストールされるまで」
//    ずっと古いまま使われ続けてしまい、デプロイしても一部の端末だけ
//    古いコード（＝古いAPIキー設定など）で動き続ける不具合の原因になっていた。
const CACHE_NAME = 'jazzin-v7';

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

  // ✅ CSS・JS等の静的ファイル：stale-while-revalidate
  //    キャッシュがあれば即座に返しつつ、裏側で最新版を取得してキャッシュを更新する。
  //    これにより「デプロイしたのに一部の端末だけ古いコードのまま」という
  //    問題が今後は起きなくなる（次回アクセス時には自動で最新化される）。
  event.respondWith(
    caches.open(CACHE_NAME).then(async cache => {
      const cached = await cache.match(event.request);

      const networkFetch = fetch(event.request).then(response => {
        if (response.ok && response.type === 'basic') {
          cache.put(event.request, response.clone());
        }
        return response;
      }).catch(() => null);

      // キャッシュがあればそれを即返す（体感速度優先）。無ければネットワークを待つ。
      return cached || (await networkFetch) || Response.error();
    })
  );
});
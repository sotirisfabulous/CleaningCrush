/* Cleaning Crush service worker
   - precaches the app shell on install
   - serves same-origin requests cache-first, refreshing the cache in the background
   - caches Google Fonts at runtime so the game looks right offline
   Bump CACHE when you ship new assets. */
const CACHE = 'cleaning-crush-v1';
const FONT_CACHE = 'cleaning-crush-fonts';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/audio.js',
  './js/fx.js',
  './js/game.js',
  './manifest.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== FONT_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Google Fonts: stale-while-revalidate in a separate long-lived cache
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.open(FONT_CACHE).then(async cache => {
        const hit = await cache.match(req);
        const net = fetch(req).then(res => { if (res.ok || res.type === 'opaque') cache.put(req, res.clone()); return res; }).catch(() => hit);
        return hit || net;
      })
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.open(CACHE).then(async cache => {
      const hit = await cache.match(req, { ignoreSearch: true });
      const net = fetch(req)
        .then(res => { if (res.ok) cache.put(req, res.clone()); return res; })
        .catch(() => (req.mode === 'navigate' ? cache.match('./index.html') : undefined));
      return hit || net;
    })
  );
});

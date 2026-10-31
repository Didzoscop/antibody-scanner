/* Service worker : rend l'app installable et utilisable hors ligne.
   Réseau d'abord (on récupère toujours la dernière version publiée), cache en secours. */
const CACHE = 'antibody-scanner-v5';
const ASSETS = ['./', 'index.html', 'engine.js', 'mascot.js', 'fonts/ByteBounce.ttf', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  // les vidéos de test (requêtes partielles) et les autres sites passent sans le cache
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.endsWith('.mp4')) return;
  // no-cache : on revalide toujours auprès du serveur (sinon le cache HTTP de GitHub Pages peut servir
  // une ancienne version pendant 10 minutes)
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});

// Offline cache for the collection's static files: a repeat launch opens
// straight from the phone, even on a bad network. The score server and
// online play are never cached.
//
// BUILD is replaced with the commit on deploy (.github/workflows/pages.yml).
// A new build gets a new cache; it takes over on the next launch, so files
// of one build are never mixed with another's.
'use strict';

const BUILD = '__BUILD__';
const CACHE = 'cartridge-' + BUILD;
// The menu, cached up front; everything else is cached the first time it is loaded.
const CORE = ['./', 'index.html', 'lib/ui.css', 'style.css', 'scores.css', 'config.js', 'menu.js', 'api.js', 'sw-register.js', 'lib/telegram-web-app.js', 'lib/wallet.js', 'lib/wallet.css', 'lib/server.js', 'lib/events.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(CORE.map((f) => c.add(f).catch(() => {})))));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('cartridge-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const scope = new URL(self.registration.scope);

function cacheable(req) {
  if (req.method !== 'GET') return false;
  const url = new URL(req.url);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return false;
  return !/\/(api|ws)\//.test(url.pathname);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (!cacheable(req)) return;
  // Launch parameters (?api=, ?room=) do not change the file.
  e.respondWith(caches.open(CACHE).then((c) => c.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => {
    if (res.ok && res.type === 'basic') c.put(req, res.clone());
    return res;
  }))));
});

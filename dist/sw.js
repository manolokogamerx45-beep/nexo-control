// Nexo service worker: makes the web app installable and usable without a connection.
// It stores the public shell, plus the operational bundle (code only) that a signed-in
// session downloaded. /api/ responses are never cached here: inventory data is kept by
// the page itself in IndexedDB and is erased when the user signs out.
'use strict';
const CACHE = 'nexo-shell-v7';
const SHELL = ['/', '/styles.css', '/auth.css', '/auth.js', '/theme.css', '/theme.js', '/offline.html', '/manifest.webmanifest',
  '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable-512.png', '/icons/apple-touch-icon.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(key => key.startsWith('nexo-') && key !== CACHE).map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});

self.addEventListener('message', event => {
  // Sent when the user signs out: the bundle must not outlive the session.
  if (event.data === 'forget') event.waitUntil(caches.open(CACHE).then(cache => cache.delete('/app.js')));
  // Sent by a signed-in page: the first visit loaded the bundle before this worker was in
  // control, so fetch it now (with the session cookie) to have it ready offline.
  if (event.data === 'warm') {
    event.waitUntil(fetch('/app.js', { credentials: 'same-origin' })
      .then(response => (response.ok ? put('/app.js', response) : null))
      .catch(() => {}));
  }
});

const put = (key, response) => caches.open(CACHE).then(cache => cache.put(key, response));

self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  if (url.pathname === '/app.js') {
    // Only a signed-in session can download it; keep that copy so the app opens offline.
    event.respondWith(fetch(request)
      .then(response => {
        if (response.ok) event.waitUntil(put('/app.js', response.clone()));
        else if (response.status === 401 || response.status === 403) event.waitUntil(caches.open(CACHE).then(cache => cache.delete('/app.js')));
        return response;
      })
      .catch(() => caches.match('/app.js').then(hit => hit || Response.error())));
    return;
  }
  if (request.mode === 'navigate') {
    // Always prefer the live page; the cached shell only covers a lost connection.
    event.respondWith(fetch(request)
      .then(response => {
        if (response.ok && url.pathname === '/') event.waitUntil(put('/', response.clone()));
        return response;
      })
      .catch(async () => (url.pathname === '/' && await caches.match('/')) || caches.match('/offline.html')));
    return;
  }
  if (!SHELL.includes(url.pathname)) return;
  // Network first keeps deployments visible immediately; the cache is the fallback.
  event.respondWith(fetch(request)
    .then(response => {
      if (response.ok) event.waitUntil(put(url.pathname, response.clone()));
      return response;
    })
    .catch(() => caches.match(url.pathname)));
});

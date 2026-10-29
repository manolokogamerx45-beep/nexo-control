// Nexo service worker: makes the web app installable and shows an offline page.
// Only the public shell is cached. /api/ responses and the session-protected
// app.js are never stored, so inventory data stays off the device.
'use strict';
const CACHE = 'nexo-shell-v1';
const SHELL = ['/styles.css', '/auth.css', '/auth.js', '/offline.html', '/manifest.webmanifest',
  '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable-512.png', '/icons/apple-touch-icon.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(key => key.startsWith('nexo-') && key !== CACHE).map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname === '/app.js') return;
  if (request.mode === 'navigate') {
    // Always prefer the live page; the cached shell only covers a lost connection.
    event.respondWith(fetch(request).catch(() => caches.match('/offline.html')));
    return;
  }
  if (!SHELL.includes(url.pathname)) return;
  // Network first keeps deployments visible immediately; the cache is the fallback.
  event.respondWith(fetch(request)
    .then(response => {
      if (response.ok) {
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE).then(cache => cache.put(url.pathname, copy)));
      }
      return response;
    })
    .catch(() => caches.match(url.pathname)));
});

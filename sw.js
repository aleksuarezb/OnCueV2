// OnCue service worker.
//
// BUMP THIS STRING ON EVERY DEPLOY. It is the entire cache-busting mechanism:
// a new value here creates a brand new cache, forces waiting service workers
// to activate immediately, and wipes every older cache so no device can get
// stuck showing a stale build.
const BUILD_ID = '2026-09-03T01-00-00';
const CACHE_NAME = 'oncue-cache-' + BUILD_ID;

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// Network-first: always try to fetch a fresh copy so a new deploy is visible
// the moment a device is online, even before the new SW has fully taken over.
// Fall back to the cache so the app still works offline on stage.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match('./index.html')))
  );
});

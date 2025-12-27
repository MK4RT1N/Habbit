const CACHE_NAME = 'habitflow-v2-dynamic'; // Updated
const ASSETS = [
    '/static/style.css',
    '/static/icon-192.png',
    '/static/icon-512.png'
    // app.js and index not hard-cached to force reload on dev
];

self.addEventListener('install', (event) => {
    self.skipWaiting(); // Force active
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS);
        })
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cache) => {
                    if (cache !== CACHE_NAME) {
                        return caches.delete(cache);
                    }
                })
            );
        })
    );
});

self.addEventListener('fetch', (event) => {
    // Network First strategy for dev (always try net, fallback to cache)
    event.respondWith(
        fetch(event.request)
            .catch(() => caches.match(event.request))
    );
});

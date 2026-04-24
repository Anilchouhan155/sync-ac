const CACHE_NAME = 'ac-sync-v3';
const STATIC_ASSETS = [
  '/manifest.json',
  '/mixkit-slot-machine-win-alert-1931.wav',
  '/apebble-fart.mp3',
  '/dragon-studio-thud.mp3',
  '/fackkk.mp3',
  '/goofy-car-horn.mp3',
  '/hehe-boy.mp3',
  '/isnt-that-amazing.mp3',
  '/sinister-laugh.mp3',
  '/watch-yo-jet-bro.mp3',
  '/what-meme.mp3',
  '/confirm-accept.mp3',
  '/confirm-affirmative.mp3',
  '/confirm-miraclei.mp3',
  '/confirm-universfield.mp3',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Delete old caches
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Navigation requests (HTML pages) — always network-first so updates show immediately
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Static audio/manifest — cache-first (these never change)
  if (STATIC_ASSETS.some((a) => url.pathname === a)) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request))
    );
    return;
  }

  // Everything else (JS/CSS bundles, API calls) — network-first
  event.respondWith(fetch(request).catch(() => caches.match(request)));
});

// Background push handler — fires even when app is closed
self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload;
  try { payload = event.data.json(); }
  catch { payload = { title: 'AC Sync', body: event.data.text() }; }

  event.waitUntil(
    self.registration.showNotification(payload.title || 'AC Sync', {
      body: payload.body || '',
      icon: 'https://cdn-icons-png.flaticon.com/512/2921/2921571.png',
      badge: 'https://cdn-icons-png.flaticon.com/512/2921/2921571.png',
      tag: 'ac-sync-update',
      renotify: true,
      data: { url: self.location.origin },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      const existing = clients.find((c) => c.url === event.notification.data?.url);
      if (existing) return existing.focus();
      return self.clients.openWindow(event.notification.data?.url || '/');
    })
  );
});

const CACHE = 'yoko-v1';

const STATIC_ASSETS = [
    '/analyzer.html',
    '/login.html',
    '/css/variables.css',
    '/css/layout.css',
    '/css/components.css',
    '/css/print.css',
    '/css/yoko.css',
    '/css/mobile.css',
    '/js/auth.js',
    '/js/state.js',
    '/js/constants.js',
    '/js/config.js',
    '/js/rankings.js',
    '/js/match-tracker.js',
    '/js/fetch.js',
    '/js/display-mystats.js',
    '/js/display-charts.js',
    '/js/tournaments.js',
    '/js/filter.js',
    '/js/compare.js',
    '/js/export.js',
    '/js/modal.js',
    '/js/theme.js',
    '/js/utils.js',
    '/js/yoko.js',
    '/js/player-profile.js',
    '/js/inspector.js',
    '/icons/icon.svg',
    '/manifest.json',
];

// ── Install: pre-cache all static assets ─────────────────────────────────────
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE)
            .then(cache => cache.addAll(STATIC_ASSETS))
            .then(() => self.skipWaiting())
    );
});

// ── Activate: clean up old caches ─────────────────────────────────────────────
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

// ── Fetch: cache-first for static, network-only for API ───────────────────────
self.addEventListener('fetch', event => {
    const { request } = event;
    const url = new URL(request.url);

    // Network-only: auth worker, Bandai proxy, Google Fonts (dynamic)
    if (
        url.hostname.includes('workers.dev') ||
        url.hostname.includes('bandai') ||
        url.hostname.includes('fonts.googleapis') ||
        url.hostname.includes('fonts.gstatic') ||
        url.pathname.startsWith('/my-matches') ||
        url.pathname.startsWith('/cache/') ||
        url.pathname.startsWith('/inbox') ||
        url.pathname.startsWith('/banner')
    ) {
        return; // Let browser handle normally
    }

    // Cache-first with network fallback for everything else
    event.respondWith(
        caches.match(request).then(cached => {
            if (cached) return cached;
            return fetch(request).then(response => {
                if (response.ok && request.method === 'GET') {
                    const clone = response.clone();
                    caches.open(CACHE).then(cache => cache.put(request, clone));
                }
                return response;
            });
        })
    );
});

// ── Push notifications (existing) ─────────────────────────────────────────────
self.addEventListener('push', event => {
    let data = { title: '[YOKO] One Piece TCG', body: 'Nova notificação' };
    try { if (event.data) Object.assign(data, JSON.parse(event.data.text())); } catch {}
    event.waitUntil(self.registration.showNotification(data.title, {
        body:     data.body,
        icon:     '/icons/icon.svg',
        badge:    '/icons/icon.svg',
        data:     { url: data.url || '/' },
        tag:      data.tag || 'yoko-push',
        renotify: true,
    }));
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    const url = event.notification.data?.url || '/';
    event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
        const c = cs.find(w => 'focus' in w);
        return c ? c.focus() : clients.openWindow(url);
    }));
});

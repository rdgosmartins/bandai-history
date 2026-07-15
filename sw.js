const CACHE = 'yoko-v4'; // bump força limpar o cache antigo (cache-first) de quem já visitou o site

// ── Install: activate immediately, sem pré-cache ──────────────────────────────
// cache.addAll() falha atomicamente se qualquer arquivo retornar erro;
// preferimos lazy caching via fetch handler, que é resiliente a falhas.
self.addEventListener('install', event => {
    event.waitUntil(self.skipWaiting());
});

// ── Activate: limpar caches antigos ──────────────────────────────────────────
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

// ── Fetch: estratégia depende do tipo de asset ────────────────────────────────
// Requests cross-origin (CDN, auth worker, Bandai proxy) ficam com o browser.
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // Só intercepta same-origin, método GET
    if (url.origin !== self.location.origin || event.request.method !== 'GET') return;

    // Rotas dinâmicas/auth — sem cache, sempre rede
    const noCachePaths = ['/my-matches', '/cache/', '/inbox', '/banner', '/auth', '/login'];
    if (noCachePaths.some(p => url.pathname.startsWith(p))) return;

    // HTML, JS, CSS e JSON são o "código" do app (admin.html, cards.json, etc.):
    // usamos network-first, para que um novo deploy apareça na hora para todo
    // mundo. O cache só é usado como fallback se a rede falhar (modo offline).
    // Isso evita telas presas numa versão antiga depois de um deploy — como o
    // admin.html mostrando só abas antigas para quem já tinha visitado o site.
    const isCodeOrData = event.request.mode === 'navigate' ||
        /\.(html|js|css|json)$/.test(url.pathname) || url.pathname === '/';

    if (isCodeOrData) {
        event.respondWith(
            fetch(event.request).then(response => {
                if (response.ok) {
                    const clone = response.clone();
                    caches.open(CACHE).then(c => c.put(event.request, clone));
                }
                return response;
            }).catch(() => caches.match(event.request))
        );
        return;
    }

    // Demais assets (imagens, ícones, fontes): cache-first com fallback para rede.
    // Esses raramente mudam, então vale economizar banda/latência.
    event.respondWith(
        caches.match(event.request).then(cached => {
            if (cached) return cached;
            return fetch(event.request).then(response => {
                if (response.ok) {
                    const clone = response.clone();
                    caches.open(CACHE).then(c => c.put(event.request, clone));
                }
                return response;
            }).catch(() => cached); // offline: retorna cache se disponível
        })
    );
});

// ── Push notifications ────────────────────────────────────────────────────────
self.addEventListener('push', event => {
    let data = { title: '[YOKO] One Piece TCG', body: 'Nova notificação' };
    try { if (event.data) Object.assign(data, JSON.parse(event.data.text())); } catch {}
    event.waitUntil(self.registration.showNotification(data.title, {
        body:     data.body,
        icon:     '/icons/icon-192.png',
        badge:    '/icons/icon-192.png',
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

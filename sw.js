self.addEventListener('push', event => {
    let data = { title: '[YOKO] One Piece TCG', body: 'Nova notificação' };
    try { if (event.data) Object.assign(data, JSON.parse(event.data.text())); } catch {}
    event.waitUntil(self.registration.showNotification(data.title, {
        body:      data.body,
        icon:      '/favicon.ico',
        badge:     '/favicon.ico',
        data:      { url: data.url || '/' },
        tag:       data.tag || 'yoko-push',
        renotify:  true,
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

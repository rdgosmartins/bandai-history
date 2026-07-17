const AUTH_BASE = 'https://bandai-history.rdgosmartins.workers.dev';

// Cópia local de apiFetch (também existe em utils.js) — necessária porque em
// algumas páginas (analyzer.html) o auth.js carrega no <head>, bem antes do
// utils.js (carregado perto do fim do <body>), e o código aqui embaixo roda
// imediatamente ao carregar. Sem isso, apiFetch ficaria undefined nesse meio-tempo.
function apiFetch(path, options = {}) {
    return fetch(AUTH_BASE + path, { credentials: 'include', ...options });
}

async function requireAuth({ requireAdmin = false } = {}) {
    try {
        const res = await apiFetch(`/auth/me`);
        if (!res.ok) { window.location.href = '/login.html'; return null; }
        const user = await res.json();
        if (user.status === 'pending')  { window.location.href = '/pending.html'; return null; }
        if (user.status === 'rejected') { window.location.href = '/login.html?error=rejected'; return null; }
        if (requireAdmin && user.role !== 'admin') { window.location.href = '/analyzer.html'; return null; }
        return user;
    } catch {
        window.location.href = '/login.html';
        return null;
    }
}

async function logout() {
    await apiFetch(`/auth/logout`, { method: 'POST' });
    window.location.href = '/login.html';
}

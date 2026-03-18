const AUTH_BASE = 'https://bandai-auth.rdgosmartins.workers.dev';

async function requireAuth({ requireAdmin = false } = {}) {
    try {
        const res = await fetch(`${AUTH_BASE}/auth/me`, { credentials: 'include' });
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
    await fetch(`${AUTH_BASE}/auth/logout`, { method: 'POST', credentials: 'include' });
    window.location.href = '/login.html';
}

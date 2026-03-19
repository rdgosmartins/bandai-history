/**
 * Bandai TCG Plus — Auth Worker
 * Handles Google OAuth, email/password auth, sessions (JWT + KV), and admin panel API.
 */

const ADMIN_EMAIL = 'rdgosmartins@gmail.com';

// ── CORS ─────────────────────────────────────────────────────────────────────

function corsHeaders(env, origin) {
    const allowed = env.ALLOWED_ORIGIN || '*';
    const o = (origin && origin === allowed) ? allowed : allowed;
    return {
        'Access-Control-Allow-Origin': o,
        'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Credentials': 'true',
    };
}

function preflight(env, origin) {
    return new Response(null, { status: 204, headers: corsHeaders(env, origin) });
}

function json(body, status = 200, cors = {}) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json', ...cors },
    });
}

function redirect(url, cors = {}) {
    return Response.redirect(url, 302);
}

// ── JWT (HS256 via Web Crypto) ────────────────────────────────────────────────

function b64url(buf) {
    return btoa(String.fromCharCode(...new Uint8Array(buf)))
        .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function b64urlStr(str) {
    return btoa(unescape(encodeURIComponent(str)))
        .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function signJWT(payload, secret) {
    const enc = new TextEncoder();
    const header = b64urlStr(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const body   = b64urlStr(JSON.stringify(payload));
    const input  = `${header}.${body}`;
    const key = await crypto.subtle.importKey(
        'raw', enc.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(input));
    return `${input}.${b64url(sig)}`;
}

async function verifyJWT(token, secret) {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const enc = new TextEncoder();
    const input = `${parts[0]}.${parts[1]}`;
    const key = await crypto.subtle.importKey(
        'raw', enc.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    );
    const sigBuf = Uint8Array.from(atob(parts[2].replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const ok = await crypto.subtle.verify('HMAC', key, sigBuf, enc.encode(input));
    if (!ok) return null;
    try {
        const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
        if (payload.exp < Math.floor(Date.now() / 1000)) return null;
        return payload;
    } catch { return null; }
}

function getCookie(request, name) {
    const header = request.headers.get('Cookie') || '';
    const match = header.split(';').map(c => c.trim()).find(c => c.startsWith(`${name}=`));
    return match ? match.slice(name.length + 1) : null;
}

function sessionCookie(token, maxAge = 604800) {
    return `__session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

// ── Password (PBKDF2-SHA-256) ─────────────────────────────────────────────────

async function hashPassword(password) {
    const enc  = new TextEncoder();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const km   = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt, hash: 'SHA-256', iterations: 100_000 }, km, 256
    );
    return `pbkdf2$${btoa(String.fromCharCode(...salt))}$${btoa(String.fromCharCode(...new Uint8Array(bits)))}`;
}

async function verifyPassword(password, stored) {
    const [, saltB64, hashB64] = stored.split('$');
    const enc  = new TextEncoder();
    const salt = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0));
    const km   = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt, hash: 'SHA-256', iterations: 100_000 }, km, 256
    );
    const derived   = btoa(String.fromCharCode(...new Uint8Array(bits)));
    return derived === hashB64;
}

// ── KV helpers ───────────────────────────────────────────────────────────────

async function getUser(env, id)          { const v = await env.AUTH_KV.get(`user:${id}`);      return v ? JSON.parse(v) : null; }
async function putUser(env, user)        { await env.AUTH_KV.put(`user:${user.id}`, JSON.stringify(user)); }
async function getUserByEmail(env, email){ const id = await env.AUTH_KV.get(`email:${email}`);  return id ? getUser(env, id) : null; }
async function getUserByGoogle(env, gid) { const id = await env.AUTH_KV.get(`google:${gid}`);   return id ? getUser(env, id) : null; }

async function appendIndex(env, key, id) {
    const raw = await env.AUTH_KV.get(key);
    const arr = raw ? JSON.parse(raw) : [];
    if (!arr.includes(id)) arr.push(id);
    await env.AUTH_KV.put(key, JSON.stringify(arr));
}

async function removeIndex(env, key, id) {
    const raw = await env.AUTH_KV.get(key);
    if (!raw) return;
    const arr = JSON.parse(raw).filter(i => i !== id);
    await env.AUTH_KV.put(key, JSON.stringify(arr));
}

function newUserId() { return 'usr_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16); }

function buildUser(id, email, displayName, method, extras = {}) {
    const isAdmin = email.toLowerCase() === ADMIN_EMAIL;
    return {
        id,
        email:       email.toLowerCase().trim(),
        displayName: displayName || email.split('@')[0],
        avatarUrl:   null,
        method,
        passwordHash: null,
        googleId:    null,
        status:      isAdmin ? 'approved' : 'pending',
        role:        isAdmin ? 'admin' : 'user',
        createdAt:   new Date().toISOString(),
        approvedAt:  isAdmin ? new Date().toISOString() : null,
        approvedBy:  null,
        ...extras,
    };
}

async function saveNewUser(env, user) {
    await putUser(env, user);
    await env.AUTH_KV.put(`email:${user.email}`, user.id);
    if (user.googleId) await env.AUTH_KV.put(`google:${user.googleId}`, user.id);
    await appendIndex(env, 'user_index', user.id);
    if (user.status === 'pending') await appendIndex(env, 'pending_index', user.id);
}

async function issueSession(env, user, cors) {
    const jti  = crypto.randomUUID();
    const now  = Math.floor(Date.now() / 1000);
    const payload = { sub: user.id, email: user.email, role: user.role, status: user.status, jti, iat: now, exp: now + 604800 };
    const token = await signJWT(payload, env.JWT_SECRET);
    await env.AUTH_KV.put(`session:${jti}`, '1', { expirationTtl: 604800 });
    return new Response(JSON.stringify({ ok: true, role: user.role }), {
        status: 200,
        headers: {
            'Content-Type': 'application/json',
            'Set-Cookie': sessionCookie(token),
            ...cors,
        },
    });
}

// ── Auth guard ────────────────────────────────────────────────────────────────

async function authenticate(request, env) {
    const token = getCookie(request, '__session');
    if (!token) return null;
    const payload = await verifyJWT(token, env.JWT_SECRET);
    if (!payload) return null;
    const sessionOk = await env.AUTH_KV.get(`session:${payload.jti}`);
    if (!sessionOk) return null;
    return getUser(env, payload.sub);
}

// ── Handlers ─────────────────────────────────────────────────────────────────

async function handleRegister(request, env, cors) {
    let body;
    try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, cors); }

    const { email, password, displayName } = body;
    if (!email || !password || password.length < 8)
        return json({ error: 'Email and password (min 8 chars) are required' }, 400, cors);

    const normalized = email.toLowerCase().trim();
    const existing   = await getUserByEmail(env, normalized);
    if (existing) return json({ error: 'Email already registered' }, 409, cors);

    const id   = newUserId();
    const hash = await hashPassword(password);
    const user = buildUser(id, normalized, displayName, 'email', { passwordHash: hash });
    await saveNewUser(env, user);

    return json({ ok: true, status: user.status }, 201, cors);
}

async function handleLogin(request, env, cors) {
    let body;
    try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, cors); }

    const { email, password } = body;
    if (!email || !password) return json({ error: 'Email and password are required' }, 400, cors);

    const user = await getUserByEmail(env, email.toLowerCase().trim());
    if (!user) return json({ error: 'Invalid email or password' }, 401, cors);

    if (!user.passwordHash)
        return json({ error: 'This account uses Google Sign-In. Please use the Google button.' }, 400, cors);

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) return json({ error: 'Invalid email or password' }, 401, cors);

    if (user.status === 'pending')  return json({ error: 'Your account is awaiting admin approval.' }, 403, cors);
    if (user.status === 'rejected') return json({ error: 'Your account has been rejected.' }, 403, cors);

    return issueSession(env, user, cors);
}

async function handleGoogleInit(request, env, cors) {
    const state = crypto.randomUUID();
    await env.AUTH_KV.put(`oauth_state:${state}`, '1', { expirationTtl: 600 });
    const params = new URLSearchParams({
        client_id:     env.GOOGLE_CLIENT_ID,
        redirect_uri:  `https://bandai-auth.rdgosmartins.workers.dev/auth/google/callback`,
        response_type: 'code',
        scope:         'openid email profile',
        state,
    });
    return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`, 302);
}

async function handleGoogleCallback(request, env, cors) {
    const url   = new URL(request.url);
    const code  = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');

    if (error || !code || !state)
        return Response.redirect('https://bandai-history.rdgosmartins.workers.dev/login.html?error=google_denied', 302);

    const stateOk = await env.AUTH_KV.get(`oauth_state:${state}`);
    if (!stateOk)
        return Response.redirect('https://bandai-history.rdgosmartins.workers.dev/login.html?error=invalid_state', 302);
    await env.AUTH_KV.delete(`oauth_state:${state}`);

    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            code,
            client_id:     env.GOOGLE_CLIENT_ID,
            client_secret: env.GOOGLE_CLIENT_SECRET,
            redirect_uri:  `https://bandai-auth.rdgosmartins.workers.dev/auth/google/callback`,
            grant_type:    'authorization_code',
        }),
    });
    if (!tokenRes.ok)
        return Response.redirect('https://bandai-history.rdgosmartins.workers.dev/login.html?error=google_token', 302);

    const { access_token } = await tokenRes.json();

    // Fetch user info
    const infoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
        headers: { Authorization: `Bearer ${access_token}` },
    });
    if (!infoRes.ok)
        return Response.redirect('https://bandai-history.rdgosmartins.workers.dev/login.html?error=google_userinfo', 302);

    const { sub: googleId, email, name, picture } = await infoRes.json();
    const normalized = email.toLowerCase().trim();

    // Upsert user
    let user = await getUserByGoogle(env, googleId) || await getUserByEmail(env, normalized);
    if (user) {
        // Link Google ID if needed
        if (!user.googleId) {
            user.googleId = googleId;
            user.avatarUrl = picture || user.avatarUrl;
            if (user.method === 'email') user.method = 'both';
            await putUser(env, user);
            await env.AUTH_KV.put(`google:${googleId}`, user.id);
        }
    } else {
        // New user via Google
        const id = newUserId();
        user = buildUser(id, normalized, name, 'google', { googleId, avatarUrl: picture });
        await saveNewUser(env, user);
    }

    if (user.status === 'pending')
        return Response.redirect('https://bandai-history.rdgosmartins.workers.dev/pending.html', 302);
    if (user.status === 'rejected')
        return Response.redirect('https://bandai-history.rdgosmartins.workers.dev/login.html?error=rejected', 302);

    // Issue session + redirect
    const jti  = crypto.randomUUID();
    const now  = Math.floor(Date.now() / 1000);
    const payload = { sub: user.id, email: user.email, role: user.role, status: user.status, jti, iat: now, exp: now + 604800 };
    const token = await signJWT(payload, env.JWT_SECRET);
    await env.AUTH_KV.put(`session:${jti}`, '1', { expirationTtl: 604800 });

    const dest = user.role === 'admin'
        ? 'https://bandai-history.rdgosmartins.workers.dev/admin.html'
        : 'https://bandai-history.rdgosmartins.workers.dev/analyzer.html';

    return new Response(null, {
        status: 302,
        headers: {
            Location:      dest,
            'Set-Cookie':  sessionCookie(token),
        },
    });
}

async function handleMe(request, env, cors) {
    const user = await authenticate(request, env);
    if (!user) return json({ error: 'Unauthorized' }, 401, cors);
    const { id, email, displayName, role, status } = user;
    const bandaiName  = user.profile?.bandaiName || null;
    const avatarUrl   = user.profile?.avatarCustom || user.avatarUrl || null;
    return json({ id, email, displayName, avatarUrl, role, status, bandaiName }, 200, cors);
}

async function handleLogout(request, env, cors) {
    const token = getCookie(request, '__session');
    if (token) {
        const payload = await verifyJWT(token, env.JWT_SECRET).catch(() => null);
        if (payload?.jti) await env.AUTH_KV.delete(`session:${payload.jti}`);
    }
    return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
            'Content-Type': 'application/json',
            'Set-Cookie': sessionCookie('', 0),
            ...cors,
        },
    });
}

async function handleAdminUsers(request, env, cors) {
    const user = await authenticate(request, env);
    if (!user || user.role !== 'admin') return json({ error: 'Forbidden' }, 403, cors);

    const pendingRaw = await env.AUTH_KV.get('pending_index');
    const allRaw     = await env.AUTH_KV.get('user_index');
    const pendingIds = pendingRaw ? JSON.parse(pendingRaw) : [];
    const allIds     = allRaw    ? JSON.parse(allRaw)     : [];

    const [pending, all] = await Promise.all([
        Promise.all(pendingIds.map(id => getUser(env, id))),
        Promise.all(allIds.map(id => getUser(env, id))),
    ]);

    const sanitize = u => u ? { id: u.id, email: u.email, displayName: u.displayName, avatarUrl: u.avatarUrl, method: u.method, status: u.status, role: u.role, createdAt: u.createdAt, profile: { bandaiName: u.profile?.bandaiName || null } } : null;
    return json({ pending: pending.filter(Boolean).map(sanitize), all: all.filter(Boolean).map(sanitize) }, 200, cors);
}

async function handleApprove(request, env, cors, id) {
    const actor = await authenticate(request, env);
    if (!actor || actor.role !== 'admin') return json({ error: 'Forbidden' }, 403, cors);

    const user = await getUser(env, id);
    if (!user) return json({ error: 'User not found' }, 404, cors);

    user.status     = 'approved';
    user.approvedAt = new Date().toISOString();
    user.approvedBy = actor.id;
    await putUser(env, user);
    await removeIndex(env, 'pending_index', id);

    return json({ ok: true }, 200, cors);
}

async function handleReject(request, env, cors, id) {
    const actor = await authenticate(request, env);
    if (!actor || actor.role !== 'admin') return json({ error: 'Forbidden' }, 403, cors);

    const user = await getUser(env, id);
    if (!user) return json({ error: 'User not found' }, 404, cors);

    user.status = 'rejected';
    await putUser(env, user);
    await removeIndex(env, 'pending_index', id);

    return json({ ok: true }, 200, cors);
}

// ── User Profile ──────────────────────────────────────────────────────────────

async function handleProfileGet(request, env, cors) {
    const user = await authenticate(request, env);
    if (!user) return json({ error: 'Unauthorized' }, 401, cors);
    return json({ profile: user.profile || {} }, 200, cors);
}

async function handleProfilePut(request, env, cors) {
    const user = await authenticate(request, env);
    if (!user) return json({ error: 'Unauthorized' }, 401, cors);
    const body = await request.json();
    const allowed = ['displayName', 'age', 'city', 'bio', 'favoriteDeck', 'bandaiName',
                     'playstyle', 'yearsPlaying', 'instagram', 'twitter', 'discord',
                     'whatsapp', 'youtube', 'twitch'];
    user.profile = user.profile || {};
    for (const k of allowed) {
        if (body[k] !== undefined) user.profile[k] = String(body[k]).slice(0, 512);
    }
    if (body.displayName) user.displayName = String(body.displayName).slice(0, 64);
    // Custom avatar: base64 data URL, max 150 KB
    if (body.avatarCustom !== undefined) {
        if (!body.avatarCustom) {
            delete user.profile.avatarCustom;
        } else if (String(body.avatarCustom).length <= 153600) {
            user.profile.avatarCustom = String(body.avatarCustom);
        }
    }
    await putUser(env, user);
    return json({ ok: true, profile: user.profile }, 200, cors);
}

// ── Public directory (users with bandaiName set) ──────────────────────────────

function publicProfile(u) {
    return {
        bandaiName:   u.profile?.bandaiName   || null,
        displayName:  u.displayName,
        avatarUrl:    u.profile?.avatarCustom || u.avatarUrl || null,
        city:         u.profile?.city         || null,
        bio:          u.profile?.bio          || null,
        playstyle:    u.profile?.playstyle    || null,
        yearsPlaying: u.profile?.yearsPlaying || null,
        favoriteDeck: u.profile?.favoriteDeck || null,
        instagram:    u.profile?.instagram    || null,
        twitter:      u.profile?.twitter      || null,
        discord:      u.profile?.discord      || null,
        whatsapp:     u.profile?.whatsapp      || null,
        youtube:      u.profile?.youtube      || null,
        twitch:       u.profile?.twitch       || null,
    };
}

async function handleDirectory(request, env, cors) {
    const user = await authenticate(request, env);
    if (!user) return json({ error: 'Unauthorized' }, 401, cors);
    const raw = await env.AUTH_KV.get('user_index');
    if (!raw) return json([], 200, cors);
    const ids   = JSON.parse(raw);
    const [users, badgesRaw] = await Promise.all([
        Promise.all(ids.map(id => getUser(env, id))),
        env.AUTH_KV.get('player_badges'),
    ]);
    const badgesMap = badgesRaw ? JSON.parse(badgesRaw) : {};
    const dir = users
        .filter(u => u && u.profile?.bandaiName)
        .map(u => ({ ...publicProfile(u), badges: badgesMap[u.bandaiId] || [] }));
    return json(dir, 200, cors);
}

async function handleProfileByName(request, env, cors, bandaiName) {
    const user = await authenticate(request, env);
    if (!user) return json({ error: 'Unauthorized' }, 401, cors);
    const raw = await env.AUTH_KV.get('user_index');
    if (!raw) return json({ error: 'Not found' }, 404, cors);
    const ids   = JSON.parse(raw);
    const [users, badgesRaw] = await Promise.all([
        Promise.all(ids.map(id => getUser(env, id))),
        env.AUTH_KV.get('player_badges'),
    ]);
    const target = users.find(u =>
        u?.profile?.bandaiName?.toLowerCase() === bandaiName.toLowerCase()
    );
    if (!target) return json({ error: 'Not found' }, 404, cors);
    const badgesMap = badgesRaw ? JSON.parse(badgesRaw) : {};
    return json({ ...publicProfile(target), badges: badgesMap[target.bandaiId] || [] }, 200, cors);
}

async function handlePlayerBadgesPut(request, env, cors) {
    const user = await authenticate(request, env);
    if (!user) return json({ error: 'Unauthorized' }, 401, cors);
    const { badges } = await request.json();
    if (!badges) return json({ error: 'missing badges' }, 400, cors);
    await env.AUTH_KV.put('player_badges', JSON.stringify(badges));
    return json({ ok: true }, 200, cors);
}

// ── Bandai Map ────────────────────────────────────────────────────────────────

async function handleBandaiMapGet(request, env, cors) {
    const user = await authenticate(request, env);
    if (!user) return json({ error: 'Unauthorized' }, 401, cors);
    const map = await env.AUTH_KV.get('bandai_map');
    return json({ map: map || '' }, 200, cors);
}

async function handleBandaiMapPut(request, env, cors) {
    const user = await authenticate(request, env);
    if (!user || user.role !== 'admin') return json({ error: 'Forbidden' }, 403, cors);
    const body = await request.json();
    const map = String(body.map || '').slice(0, 100000);
    await env.AUTH_KV.put('bandai_map', map);
    return json({ ok: true }, 200, cors);
}

// ── Admin: associate registered user ↔ bandai player ─────────────────────────

async function handleAdminAssociate(request, env, cors) {
    const actor = await authenticate(request, env);
    if (!actor || actor.role !== 'admin') return json({ error: 'Forbidden' }, 403, cors);
    const { userId, bandaiName } = await request.json();
    if (!userId || !bandaiName) return json({ error: 'userId and bandaiName required' }, 400, cors);
    const user = await getUser(env, userId);
    if (!user) return json({ error: 'User not found' }, 404, cors);
    user.profile = user.profile || {};
    user.profile.bandaiName = String(bandaiName).slice(0, 64);
    await putUser(env, user);
    return json({ ok: true }, 200, cors);
}

// ── Event Cache (KV, keyed by bandaiId) ───────────────────────────────────────

async function handleCacheGet(request, env, cors, bandaiId) {
    const user = await authenticate(request, env);
    if (!user) return json({ error: 'Unauthorized' }, 401, cors);
    const raw = await env.AUTH_KV.get('cache:' + bandaiId);
    if (!raw) return json({}, 200, cors);
    return new Response(raw, { status: 200, headers: { 'Content-Type': 'application/json', ...cors } });
}

async function handleCachePut(request, env, cors, bandaiId) {
    const user = await authenticate(request, env);
    if (!user) return json({ error: 'Unauthorized' }, 401, cors);
    const body = await request.text();
    // Merge: server cache + incoming, incoming wins (it has the freshest local events)
    let merged = {};
    const existing = await env.AUTH_KV.get('cache:' + bandaiId);
    if (existing) {
        try { merged = JSON.parse(existing); } catch {}
    }
    try {
        const incoming = JSON.parse(body);
        Object.assign(merged, incoming); // incoming keys overwrite
    } catch { return json({ error: 'Invalid JSON' }, 400, cors); }
    await env.AUTH_KV.put('cache:' + bandaiId, JSON.stringify(merged));
    return json({ ok: true, keys: Object.keys(merged).length }, 200, cors);
}

// ── Router ────────────────────────────────────────────────────────────────────

export default {
    async fetch(request, env) {
        const url    = new URL(request.url);
        const method = request.method;
        const path   = url.pathname;
        const origin = request.headers.get('Origin') || '';
        const cors   = corsHeaders(env, origin);

        if (method === 'OPTIONS') return preflight(env, origin);

        try {
            if (path === '/auth/google'          && method === 'GET')  return handleGoogleInit(request, env, cors);
            if (path === '/auth/google/callback' && method === 'GET')  return handleGoogleCallback(request, env, cors);
            if (path === '/auth/register'        && method === 'POST') return handleRegister(request, env, cors);
            if (path === '/auth/login'           && method === 'POST') return handleLogin(request, env, cors);
            if (path === '/auth/me'              && method === 'GET')  return handleMe(request, env, cors);
            if (path === '/auth/logout'          && method === 'POST') return handleLogout(request, env, cors);
            if (path === '/admin/users'          && method === 'GET')  return handleAdminUsers(request, env, cors);
            if (path === '/profile'              && method === 'GET')  return handleProfileGet(request, env, cors);
            if (path === '/profile'              && method === 'PUT')  return handleProfilePut(request, env, cors);
            if (path === '/directory'             && method === 'GET')  return handleDirectory(request, env, cors);
            if (path === '/bandai-map'           && method === 'GET')  return handleBandaiMapGet(request, env, cors);
            if (path === '/bandai-map'           && method === 'PUT')  return handleBandaiMapPut(request, env, cors);
            if (path === '/player-badges'        && method === 'PUT')  return handlePlayerBadgesPut(request, env, cors);
            if (path === '/admin/associate'      && method === 'POST') return handleAdminAssociate(request, env, cors);

            const approveMatch = path.match(/^\/admin\/approve\/(.+)$/);
            if (approveMatch && method === 'POST') return handleApprove(request, env, cors, approveMatch[1]);

            const rejectMatch = path.match(/^\/admin\/reject\/(.+)$/);
            if (rejectMatch  && method === 'POST') return handleReject(request, env, cors, rejectMatch[1]);

            const profileByNameMatch = path.match(/^\/profile\/by-name\/(.+)$/);
            if (profileByNameMatch && method === 'GET') return handleProfileByName(request, env, cors, decodeURIComponent(profileByNameMatch[1]));

            const cacheMatch = path.match(/^\/cache\/(.+)$/);
            if (cacheMatch && method === 'GET') return handleCacheGet(request, env, cors, cacheMatch[1]);
            if (cacheMatch && method === 'PUT') return handleCachePut(request, env, cors, cacheMatch[1]);

            return json({ error: 'Not found' }, 404, cors);
        } catch (err) {
            console.error(err);
            return json({ error: 'Internal server error' }, 500, cors);
        }
    },
};

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
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
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
    const user = await getUser(env, payload.sub);
    if (user?.status === 'suspended') return null;
    return user;
}

// ── Audit log ─────────────────────────────────────────────────────────────────

async function appendAuditLog(env, { actorId, actorName, action, targetId = '', targetName = '', detail = '' }) {
    const raw = await env.AUTH_KV.get('audit_log');
    const log = raw ? JSON.parse(raw) : [];
    log.unshift({ ts: new Date().toISOString(), actorId, actorName, action, targetId, targetName, detail });
    if (log.length > 500) log.length = 500;
    await env.AUTH_KV.put('audit_log', JSON.stringify(log));
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

async function handleSetRole(request, env, cors, id) {
    const actor = await authenticate(request, env);
    if (!actor || actor.role !== 'admin') return json({ error: 'Forbidden' }, 403, cors);
    const body = await request.json().catch(() => ({}));
    const role = body.role === 'admin' ? 'admin' : 'user';
    const user = await getUser(env, id);
    if (!user) return json({ error: 'User not found' }, 404, cors);
    user.role = role;
    await putUser(env, user);
    await appendAuditLog(env, { actorId: actor.id, actorName: actor.displayName, action: 'set_role', targetId: user.id, targetName: user.displayName, detail: role });
    return json({ ok: true, role }, 200, cors);
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
    await appendAuditLog(env, { actorId: actor.id, actorName: actor.displayName, action: 'approve', targetId: user.id, targetName: user.displayName });

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
    await appendAuditLog(env, { actorId: actor.id, actorName: actor.displayName, action: 'reject', targetId: user.id, targetName: user.displayName });

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

// ── Decks ─────────────────────────────────────────────────────────────────────

function newDeckId() { return 'deck_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12); }

async function getDecks(env, userId) {
    const raw = await env.AUTH_KV.get('decks:' + userId);
    return raw ? JSON.parse(raw) : [];
}
async function putDecks(env, userId, decks) {
    await env.AUTH_KV.put('decks:' + userId, JSON.stringify(decks));
}

async function handleDecksGet(request, env, cors) {
    const user = await authenticate(request, env);
    if (!user) return json({ error: 'Unauthorized' }, 401, cors);
    const decks = await getDecks(env, user.id);
    return json(decks, 200, cors);
}

async function handleDecksPost(request, env, cors) {
    const user = await authenticate(request, env);
    if (!user) return json({ error: 'Unauthorized' }, 401, cors);
    const body = await request.json();
    const { name, leader, cards, article, isPublic } = body;
    if (!name || !leader) return json({ error: 'name and leader are required' }, 400, cors);
    const decks = await getDecks(env, user.id);
    const deck = {
        id:        newDeckId(),
        name:      String(name).slice(0, 64),
        leader:    leader,   // { id, name, colors, image }
        cards:     Array.isArray(cards) ? cards : [],   // [{ id, name, image, qty, color, type }]
        article:   String(article || '').slice(0, 20000),
        isPublic:  !!isPublic,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
    decks.push(deck);
    await putDecks(env, user.id, decks);
    return json(deck, 201, cors);
}

async function handleDeckPut(request, env, cors, deckId) {
    const user = await authenticate(request, env);
    if (!user) return json({ error: 'Unauthorized' }, 401, cors);
    const body = await request.json();
    const decks = await getDecks(env, user.id);
    const idx = decks.findIndex(d => d.id === deckId);
    if (idx === -1) return json({ error: 'Deck not found' }, 404, cors);
    const d = decks[idx];
    if (body.name    !== undefined) d.name    = String(body.name).slice(0, 64);
    if (body.leader  !== undefined) d.leader  = body.leader;
    if (body.cards   !== undefined) d.cards   = Array.isArray(body.cards) ? body.cards : d.cards;
    if (body.article !== undefined) d.article = String(body.article).slice(0, 20000);
    if (body.isPublic !== undefined) d.isPublic = !!body.isPublic;
    d.updatedAt = new Date().toISOString();
    decks[idx] = d;
    await putDecks(env, user.id, decks);
    return json(d, 200, cors);
}

async function handleDeckDelete(request, env, cors, deckId) {
    const user = await authenticate(request, env);
    if (!user) return json({ error: 'Unauthorized' }, 401, cors);
    const decks = await getDecks(env, user.id);
    const filtered = decks.filter(d => d.id !== deckId);
    if (filtered.length === decks.length) return json({ error: 'Deck not found' }, 404, cors);
    await putDecks(env, user.id, filtered);
    return json({ ok: true }, 200, cors);
}

// ── Personal Match Log ────────────────────────────────────────────────────────

async function getMatches(env, userId) {
    const raw = await env.AUTH_KV.get('matches:' + userId);
    return raw ? JSON.parse(raw) : [];
}
async function putMatches(env, userId, matches) {
    await env.AUTH_KV.put('matches:' + userId, JSON.stringify(matches));
}
function newMatchId() { return 'mtch_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }

async function handleMatchesGet(request, env, cors) {
    const user = await authenticate(request, env);
    if (!user) return json({ error: 'Unauthorized' }, 401, cors);
    return json(await getMatches(env, user.id), 200, cors);
}

async function handleMatchesPost(request, env, cors) {
    const user = await authenticate(request, env);
    if (!user) return json({ error: 'Unauthorized' }, 401, cors);
    const body = await request.json();
    const { name, leaderId, date, set, type, bandaiEventId } = body;
    if (!name || !date) return json({ error: 'name and date are required' }, 400, cors);
    const match = {
        id:           newMatchId(),
        name:         String(name).slice(0, 80),
        leaderId:     leaderId || null,
        date:         String(date).slice(0, 10),
        set:          set   ? String(set).slice(0, 10)  : null,
        type:         type  ? String(type).slice(0, 30) : null,
        bandaiEventId: bandaiEventId ? String(bandaiEventId).slice(0, 32) : null,
        finalRank:    null,
        finalPoints:  null,
        finalStatus:  null,
        rounds:       [],
        createdAt:    new Date().toISOString(),
    };
    const matches = await getMatches(env, user.id);
    matches.unshift(match);
    await putMatches(env, user.id, matches);
    return json(match, 201, cors);
}

async function handleMatchPut(request, env, cors, matchId) {
    const user = await authenticate(request, env);
    if (!user) return json({ error: 'Unauthorized' }, 401, cors);
    const body = await request.json();
    const matches = await getMatches(env, user.id);
    const idx = matches.findIndex(m => m.id === matchId);
    if (idx === -1) return json({ error: 'Match not found' }, 404, cors);
    const m = matches[idx];
    if (body.name     !== undefined) m.name     = String(body.name).slice(0, 80);
    if (body.leaderId !== undefined) m.leaderId = body.leaderId;
    if (body.date     !== undefined) m.date     = String(body.date).slice(0, 10);
    if (body.set      !== undefined) m.set      = body.set ? String(body.set).slice(0, 10) : null;
    if (body.type     !== undefined) m.type     = body.type ? String(body.type).slice(0, 30) : null;
    if (body.rounds        !== undefined) m.rounds        = Array.isArray(body.rounds) ? body.rounds : m.rounds;
    if (body.bandaiEventId !== undefined) m.bandaiEventId = body.bandaiEventId ? String(body.bandaiEventId).slice(0, 32) : null;
    if (body.finalRank     !== undefined) m.finalRank     = body.finalRank != null ? Number(body.finalRank) : null;
    if (body.finalPoints   !== undefined) m.finalPoints   = body.finalPoints != null ? Number(body.finalPoints) : null;
    if (body.finalStatus   !== undefined) m.finalStatus   = body.finalStatus ? String(body.finalStatus).slice(0, 40) : null;
    matches[idx] = m;
    await putMatches(env, user.id, matches);
    return json(m, 200, cors);
}

async function handleMatchDelete(request, env, cors, matchId) {
    const user = await authenticate(request, env);
    if (!user) return json({ error: 'Unauthorized' }, 401, cors);
    const matches = await getMatches(env, user.id);
    const filtered = matches.filter(m => m.id !== matchId);
    if (filtered.length === matches.length) return json({ error: 'Match not found' }, 404, cors);
    await putMatches(env, user.id, filtered);
    return json({ ok: true }, 200, cors);
}

async function handlePublicMatches(request, env, cors, bandaiName) {
    const raw = await env.AUTH_KV.get('user_index');
    if (!raw) return json([], 200, cors);
    const ids = JSON.parse(raw);
    const users = await Promise.all(ids.map(id => getUser(env, id)));
    const target = users.find(u =>
        u?.profile?.bandaiName?.toLowerCase() === bandaiName.toLowerCase()
    );
    if (!target) return json([], 200, cors);
    return json(await getMatches(env, target.id), 200, cors);
}

// Public decks for a given bandaiName (used in view mode)
async function handlePublicDecks(request, env, cors, bandaiName) {
    const user = await authenticate(request, env);
    if (!user) return json({ error: 'Unauthorized' }, 401, cors);
    const raw = await env.AUTH_KV.get('user_index');
    if (!raw) return json([], 200, cors);
    const ids = JSON.parse(raw);
    const users = await Promise.all(ids.map(id => getUser(env, id)));
    const target = users.find(u =>
        u?.profile?.bandaiName?.toLowerCase() === bandaiName.toLowerCase()
    );
    if (!target) return json([], 200, cors);
    const decks = await getDecks(env, target.id);
    return json(decks.filter(d => d.isPublic), 200, cors);
}

async function handlePlayerBadgesPut(request, env, cors) {
    const user = await authenticate(request, env);
    if (!user) return json({ error: 'Unauthorized' }, 401, cors);
    const { badges } = await request.json();
    if (!badges) return json({ error: 'missing badges' }, 400, cors);
    await env.AUTH_KV.put('player_badges', JSON.stringify(badges));
    return json({ ok: true }, 200, cors);
}

// ── OPTCG API Proxy (avoids browser CORS restriction) ────────────────────────

async function handleOptcgProxy(request, env, cors) {
    const user = await authenticate(request, env);
    if (!user) return json({ error: 'Unauthorized' }, 401, cors);
    const url    = new URL(request.url);
    const subpath = url.searchParams.get('path') || '';
    const qs      = url.searchParams.get('qs')   || '';
    // Only allow known safe API sub-paths
    const allowed = ['sets/filtered', 'allSets', 'allSetCards', 'decks/filtered', 'allSTCards', 'allDonCards', 'don/filtered'];
    if (!allowed.some(a => subpath.startsWith(a))) return json({ error: 'Forbidden path' }, 403, cors);
    const apiUrl = `https://optcgapi.com/api/${subpath}${qs ? '?' + qs : ''}`;
    try {
        const r = await fetch(apiUrl, { headers: { 'Accept': 'application/json' } });
        const body = await r.text();
        return new Response(body, { status: r.status, headers: { 'Content-Type': 'application/json', ...cors } });
    } catch(e) {
        return json({ error: 'Upstream error' }, 502, cors);
    }
}

// ── Bandai Map ────────────────────────────────────────────────────────────────

async function handleBandaiMapGet(request, env, cors) {
    const user = await authenticate(request, env);
    if (!user) return json({ error: 'Unauthorized' }, 401, cors);
    const map = await env.AUTH_KV.get('bandai_map') || '';
    return json({ map }, 200, cors);
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

// ── Admin: User Management ────────────────────────────────────────────────────

async function handleSuspend(request, env, cors, id) {
    const actor = await authenticate(request, env);
    if (!actor || actor.role !== 'admin') return json({ error: 'Forbidden' }, 403, cors);
    const user = await getUser(env, id);
    if (!user) return json({ error: 'User not found' }, 404, cors);
    user.status = 'suspended';
    await putUser(env, user);
    await appendAuditLog(env, { actorId: actor.id, actorName: actor.displayName, action: 'suspend', targetId: user.id, targetName: user.displayName });
    return json({ ok: true }, 200, cors);
}

async function handleUnsuspend(request, env, cors, id) {
    const actor = await authenticate(request, env);
    if (!actor || actor.role !== 'admin') return json({ error: 'Forbidden' }, 403, cors);
    const user = await getUser(env, id);
    if (!user) return json({ error: 'User not found' }, 404, cors);
    user.status = 'approved';
    await putUser(env, user);
    await appendAuditLog(env, { actorId: actor.id, actorName: actor.displayName, action: 'unsuspend', targetId: user.id, targetName: user.displayName });
    return json({ ok: true }, 200, cors);
}

async function handleAdminEditUser(request, env, cors, id) {
    const actor = await authenticate(request, env);
    if (!actor || actor.role !== 'admin') return json({ error: 'Forbidden' }, 403, cors);
    const user = await getUser(env, id);
    if (!user) return json({ error: 'User not found' }, 404, cors);
    let body;
    try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, cors); }
    if (body.displayName !== undefined) user.displayName = String(body.displayName).slice(0, 64);
    if (body.email !== undefined) {
        const newEmail = String(body.email).toLowerCase().trim();
        if (newEmail !== user.email) {
            await env.AUTH_KV.delete(`email:${user.email}`);
            await env.AUTH_KV.put(`email:${newEmail}`, user.id);
            user.email = newEmail;
        }
    }
    await putUser(env, user);
    await appendAuditLog(env, { actorId: actor.id, actorName: actor.displayName, action: 'edit_user', targetId: user.id, targetName: user.displayName, detail: 'name/email updated' });
    return json({ ok: true }, 200, cors);
}

async function handleDeleteUser(request, env, cors, id) {
    const actor = await authenticate(request, env);
    if (!actor || actor.role !== 'admin') return json({ error: 'Forbidden' }, 403, cors);
    if (id === actor.id) return json({ error: 'Cannot delete yourself' }, 400, cors);
    const user = await getUser(env, id);
    if (!user) return json({ error: 'User not found' }, 404, cors);
    await env.AUTH_KV.delete(`user:${id}`);
    await env.AUTH_KV.delete(`email:${user.email}`);
    if (user.googleId) await env.AUTH_KV.delete(`google:${user.googleId}`);
    await removeIndex(env, 'user_index', id);
    await removeIndex(env, 'pending_index', id);
    await appendAuditLog(env, { actorId: actor.id, actorName: actor.displayName, action: 'delete_user', targetId: id, targetName: user.displayName });
    return json({ ok: true }, 200, cors);
}

async function handleAuditLog(request, env, cors) {
    const user = await authenticate(request, env);
    if (!user || user.role !== 'admin') return json({ error: 'Forbidden' }, 403, cors);
    const raw = await env.AUTH_KV.get('audit_log');
    return json(raw ? JSON.parse(raw) : [], 200, cors);
}

// ── Admin: Profile edit (any user) ───────────────────────────────────────────

async function handleAdminProfileEdit(request, env, cors, id) {
    const actor = await authenticate(request, env);
    if (!actor || actor.role !== 'admin') return json({ error: 'Forbidden' }, 403, cors);
    const user = await getUser(env, id);
    if (!user) return json({ error: 'User not found' }, 404, cors);
    let body;
    try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, cors); }
    user.profile = user.profile || {};
    if (body.displayName !== undefined) { user.displayName = String(body.displayName).slice(0, 64); user.profile.displayName = user.displayName; }
    if (body.bio !== undefined) user.profile.bio = String(body.bio).slice(0, 512);
    if (body.avatarCustom !== undefined) {
        if (!body.avatarCustom) delete user.profile.avatarCustom;
        else if (String(body.avatarCustom).length <= 153600) user.profile.avatarCustom = String(body.avatarCustom);
    }
    await putUser(env, user);
    await appendAuditLog(env, { actorId: actor.id, actorName: actor.displayName, action: 'edit_profile', targetId: user.id, targetName: user.displayName });
    return json({ ok: true }, 200, cors);
}

// ── Admin: Banner ─────────────────────────────────────────────────────────────

async function handleBannerGet(request, env, cors) {
    const raw = await env.AUTH_KV.get('global_banner');
    return json(raw ? JSON.parse(raw) : { message: null }, 200, cors);
}

async function handleBannerPut(request, env, cors) {
    const actor = await authenticate(request, env);
    if (!actor || actor.role !== 'admin') return json({ error: 'Forbidden' }, 403, cors);
    let body;
    try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, cors); }
    if (!body.message) {
        await env.AUTH_KV.delete('global_banner');
        return json({ ok: true, cleared: true }, 200, cors);
    }
    const banner = {
        message:   String(body.message).slice(0, 300),
        type:      ['info', 'warning', 'success'].includes(body.type) ? body.type : 'info',
        createdBy: actor.displayName,
        createdAt: new Date().toISOString(),
    };
    await env.AUTH_KV.put('global_banner', JSON.stringify(banner));
    return json({ ok: true, banner }, 200, cors);
}

// ── Web Push / VAPID ─────────────────────────────────────────────────────────
function _b64u(buf) {
    return btoa(String.fromCharCode(...new Uint8Array(buf instanceof ArrayBuffer ? buf : buf.buffer)))
        .replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
}
function _b64uDec(s) {
    s = s.replace(/-/g,'+').replace(/_/g,'/'); while (s.length%4) s+='=';
    return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}
function _concat(...arrs) {
    const out = new Uint8Array(arrs.reduce((n,a)=>n+a.length,0));
    let i=0; for (const a of arrs){out.set(a,i);i+=a.length;} return out;
}
async function _hmac(key, data) {
    const k = await crypto.subtle.importKey('raw', key, {name:'HMAC',hash:'SHA-256'}, false, ['sign']);
    return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}
async function _vapidJwt(env, audience) {
    const privJwk = JSON.parse(env.VAPID_PRIVATE_KEY_JWK);
    const key = await crypto.subtle.importKey('jwk', privJwk, {name:'ECDSA',namedCurve:'P-256'}, false, ['sign']);
    const te  = new TextEncoder();
    const hdr = _b64u(te.encode(JSON.stringify({typ:'JWT',alg:'ES256'})));
    const pay = _b64u(te.encode(JSON.stringify({aud:audience, exp:Math.floor(Date.now()/1000)+43200, sub:'mailto:admin@bandai.local'})));
    const sig = await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'}, key, te.encode(`${hdr}.${pay}`));
    return `${hdr}.${pay}.${_b64u(sig)}`;
}
async function _encryptPush(subscription, payloadStr) {
    const { keys: { p256dh, auth: authB64 } } = subscription;
    const uaPub      = _b64uDec(p256dh);
    const authSecret = _b64uDec(authB64);
    const plaintext  = new TextEncoder().encode(payloadStr);
    const asPair   = await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'}, true, ['deriveBits']);
    const asPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', asPair.publicKey));
    const uaKey    = await crypto.subtle.importKey('raw', uaPub, {name:'ECDH',namedCurve:'P-256'}, false, []);
    const ikmRaw   = new Uint8Array(await crypto.subtle.deriveBits({name:'ECDH',public:uaKey}, asPair.privateKey, 256));
    const ikmKey   = await crypto.subtle.importKey('raw', ikmRaw, 'HKDF', false, ['deriveBits']);
    const keyInfo  = _concat(new TextEncoder().encode('WebPush: info\0'), uaPub, asPubRaw);
    const prkKey   = new Uint8Array(await crypto.subtle.deriveBits(
        {name:'HKDF',hash:'SHA-256',salt:authSecret,info:keyInfo}, ikmKey, 256));
    const salt  = crypto.getRandomValues(new Uint8Array(16));
    const prk   = await _hmac(salt, prkKey);
    const cek   = (await _hmac(prk, _concat(new TextEncoder().encode('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0,16);
    const nonce = (await _hmac(prk, _concat(new TextEncoder().encode('Content-Encoding: nonce\0'),     new Uint8Array([1])))).slice(0,12);
    const rs     = 4096;
    const padded = _concat(plaintext, new Uint8Array([2]), new Uint8Array(rs - 16 - 1 - plaintext.length));
    const aesKey = await crypto.subtle.importKey('raw', cek, {name:'AES-GCM'}, false, ['encrypt']);
    const ct     = new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce}, aesKey, padded));
    const rs4    = new Uint8Array(4); new DataView(rs4.buffer).setUint32(0, rs, false);
    return _concat(salt, rs4, new Uint8Array([asPubRaw.length]), asPubRaw, ct);
}
async function _sendPushToUser(env, userId, payload) {
    const raw = await env.AUTH_KV.get(`push_sub:${userId}`);
    if (!raw) return;
    const sub = JSON.parse(raw);
    try {
        const url = new URL(sub.endpoint);
        const jwt = await _vapidJwt(env, `${url.protocol}//${url.host}`);
        const body = await _encryptPush(sub, JSON.stringify(payload));
        const res  = await fetch(sub.endpoint, {
            method: 'POST',
            headers: {
                'Authorization':    `vapid t=${jwt},k=${env.VAPID_PUBLIC_KEY}`,
                'Content-Type':     'application/octet-stream',
                'Content-Encoding': 'aes128gcm',
                'TTL':              '86400',
            },
            body,
        });
        if (res.status === 410 || res.status === 404) {
            await env.AUTH_KV.delete(`push_sub:${userId}`);
            const raw2 = await env.AUTH_KV.get('push_sub_index');
            const idx  = raw2 ? JSON.parse(raw2) : [];
            await env.AUTH_KV.put('push_sub_index', JSON.stringify(idx.filter(id => id !== userId)));
        }
    } catch {}
}
async function _broadcastPush(env, payload) {
    const raw = await env.AUTH_KV.get('push_sub_index');
    if (!raw) return;
    const ids = JSON.parse(raw);
    await Promise.all(ids.map(id => _sendPushToUser(env, id, payload)));
}

async function handlePushSubscribe(request, env, cors) {
    const user = await authenticate(request, env);
    if (!user) return json({ error: 'Unauthorized' }, 401, cors);
    let body; try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, cors); }
    if (!body?.endpoint || !body?.keys?.p256dh || !body?.keys?.auth)
        return json({ error: 'Invalid subscription' }, 400, cors);
    await env.AUTH_KV.put(`push_sub:${user.id}`, JSON.stringify(body));
    const rawIdx = await env.AUTH_KV.get('push_sub_index');
    const idx    = rawIdx ? JSON.parse(rawIdx) : [];
    if (!idx.includes(user.id)) { idx.push(user.id); await env.AUTH_KV.put('push_sub_index', JSON.stringify(idx)); }
    return json({ ok: true }, 200, cors);
}
async function handlePushUnsubscribe(request, env, cors) {
    const user = await authenticate(request, env);
    if (!user) return json({ error: 'Unauthorized' }, 401, cors);
    await env.AUTH_KV.delete(`push_sub:${user.id}`);
    const rawIdx = await env.AUTH_KV.get('push_sub_index');
    const idx    = rawIdx ? JSON.parse(rawIdx) : [];
    await env.AUTH_KV.put('push_sub_index', JSON.stringify(idx.filter(id => id !== user.id)));
    return json({ ok: true }, 200, cors);
}

// ── Admin: Inbox / Messages ───────────────────────────────────────────────────

async function handleSendMessage(request, env, cors, targetId) {
    const actor = await authenticate(request, env);
    if (!actor || actor.role !== 'admin') return json({ error: 'Forbidden' }, 403, cors);
    const target = await getUser(env, targetId);
    if (!target) return json({ error: 'User not found' }, 404, cors);
    let body;
    try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, cors); }
    if (!body.message) return json({ error: 'message required' }, 400, cors);
    const key = `inbox:${targetId}`;
    const raw = await env.AUTH_KV.get(key);
    const inbox = raw ? JSON.parse(raw) : [];
    inbox.unshift({ id: crypto.randomUUID(), fromName: actor.displayName, message: String(body.message).slice(0, 1000), createdAt: new Date().toISOString(), read: false });
    if (inbox.length > 50) inbox.length = 50;
    await env.AUTH_KV.put(key, JSON.stringify(inbox));
    return json({ ok: true }, 200, cors);
}

async function handleInboxGet(request, env, cors) {
    const user = await authenticate(request, env);
    if (!user) return json({ error: 'Unauthorized' }, 401, cors);
    const raw = await env.AUTH_KV.get(`inbox:${user.id}`);
    return json(raw ? JSON.parse(raw) : [], 200, cors);
}

async function handleInboxRead(request, env, cors, msgId) {
    const user = await authenticate(request, env);
    if (!user) return json({ error: 'Unauthorized' }, 401, cors);
    const key = `inbox:${user.id}`;
    const raw = await env.AUTH_KV.get(key);
    if (!raw) return json({ ok: true }, 200, cors);
    const inbox = JSON.parse(raw).map(m => m.id === msgId ? { ...m, read: true } : m);
    await env.AUTH_KV.put(key, JSON.stringify(inbox));
    return json({ ok: true }, 200, cors);
}

// ── Admin: Decks moderation ───────────────────────────────────────────────────

async function handleAdminDecksGet(request, env, cors) {
    const actor = await authenticate(request, env);
    if (!actor || actor.role !== 'admin') return json({ error: 'Forbidden' }, 403, cors);
    const raw  = await env.AUTH_KV.get('user_index');
    const ids  = raw ? JSON.parse(raw) : [];
    const results = [];
    await Promise.all(ids.map(async uid => {
        const dRaw = await env.AUTH_KV.get(`decks:${uid}`);
        if (!dRaw) return;
        const decks = JSON.parse(dRaw).filter(d => d.isPublic);
        if (decks.length) results.push({ userId: uid, decks });
    }));
    return json(results, 200, cors);
}

async function handleAdminDeckDelete(request, env, cors, userId, deckId) {
    const actor = await authenticate(request, env);
    if (!actor || actor.role !== 'admin') return json({ error: 'Forbidden' }, 403, cors);
    const key = `decks:${userId}`;
    const raw = await env.AUTH_KV.get(key);
    if (!raw) return json({ error: 'Not found' }, 404, cors);
    const decks = JSON.parse(raw).filter(d => d.id !== deckId);
    await env.AUTH_KV.put(key, JSON.stringify(decks));
    await appendAuditLog(env, { actorId: actor.id, actorName: actor.displayName, action: 'delete_deck', targetId: deckId, targetName: userId });
    return json({ ok: true }, 200, cors);
}

// ── Tournament: Clone / Reopen / Export ──────────────────────────────────────

async function handleTournamentClone(request, env, cors, id) {
    const actor = await authenticate(request, env);
    if (!actor || actor.role !== 'admin') return json({ error: 'Forbidden' }, 403, cors);
    const src = await getTournament(env, id);
    if (!src) return json({ error: 'Not found' }, 404, cors);
    let body;
    try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, cors); }
    if (!body.name || !body.date) return json({ error: 'name e date são obrigatórios' }, 400, cors);
    const t = {
        id:              newTournamentId(),
        name:            String(body.name).slice(0, 128),
        date:            String(body.date).slice(0, 10),
        format:          src.format,
        matchFormat:     src.matchFormat,
        topCutSize:      src.topCutSize,
        swissTopCutSize: src.swissTopCutSize,
        phase:           src.format === 'swiss_top_cut' ? 'swiss' : undefined,
        status:          'pending',
        circuitId:       src.circuitId || null,
        participants:    (src.participants || []).map(p => ({ id: p.id, name: p.name, isGuest: p.isGuest })),
        rounds:          [],
        placements:      [],
        createdAt:       new Date().toISOString(),
        createdBy:       actor.id,
        clonedFrom:      src.id,
    };
    await putTournament(env, t);
    await appendIndex(env, 'tournament_index', t.id);
    await appendAuditLog(env, { actorId: actor.id, actorName: actor.displayName, action: 'clone_tournament', targetId: t.id, targetName: t.name, detail: `cloned from ${src.name}` });
    return json(t, 201, cors);
}

async function handleReopenRound(request, env, cors, id) {
    const actor = await authenticate(request, env);
    if (!actor || actor.role !== 'admin') return json({ error: 'Forbidden' }, 403, cors);
    const t = await getTournament(env, id);
    if (!t) return json({ error: 'Not found' }, 404, cors);
    if (!t.rounds || !t.rounds.length) return json({ error: 'No rounds' }, 400, cors);
    t.rounds[t.rounds.length - 1].complete = false;
    await putTournament(env, t);
    await appendAuditLog(env, { actorId: actor.id, actorName: actor.displayName, action: 'reopen_round', targetId: t.id, targetName: t.name });
    return json({ ok: true }, 200, cors);
}

async function handleTournamentExport(request, env, cors, id) {
    const actor = await authenticate(request, env);
    if (!actor || actor.role !== 'admin') return json({ error: 'Forbidden' }, 403, cors);
    const t = await getTournament(env, id);
    if (!t) return json({ error: 'Not found' }, 404, cors);
    return json(t, 200, cors);
}

// ── Circuit: Manual points / Close ────────────────────────────────────────────

async function handleCircuitManualPoints(request, env, cors, id) {
    const actor = await authenticate(request, env);
    if (!actor || actor.role !== 'admin') return json({ error: 'Forbidden' }, 403, cors);
    const c = await getCircuit(env, id);
    if (!c) return json({ error: 'Not found' }, 404, cors);
    let body;
    try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, cors); }
    if (!body.participantId || body.points == null) return json({ error: 'participantId e points obrigatórios' }, 400, cors);
    c.manualPoints = c.manualPoints || [];
    c.manualPoints.push({
        participantId:   String(body.participantId).slice(0, 64),
        participantName: String(body.participantName || body.participantId).slice(0, 64),
        points:          Number(body.points),
        reason:          String(body.reason || '').slice(0, 256),
        addedBy:         actor.displayName,
        addedAt:         new Date().toISOString(),
    });
    await putCircuit(env, c);
    return json({ ok: true }, 200, cors);
}

async function handleCircuitClose(request, env, cors, id) {
    const actor = await authenticate(request, env);
    if (!actor || actor.role !== 'admin') return json({ error: 'Forbidden' }, 403, cors);
    const c = await getCircuit(env, id);
    if (!c) return json({ error: 'Not found' }, 404, cors);
    c.status   = 'closed';
    c.closedAt = new Date().toISOString();
    await putCircuit(env, c);
    await appendAuditLog(env, { actorId: actor.id, actorName: actor.displayName, action: 'close_circuit', targetId: c.id, targetName: c.name });
    return json({ ok: true }, 200, cors);
}

// ── Circuits ─────────────────────────────────────────────────────────────────

function newCircuitId() { return 'crc_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12); }

async function getCircuit(env, id) {
    const raw = await env.AUTH_KV.get(`circuit:${id}`);
    return raw ? JSON.parse(raw) : null;
}

async function putCircuit(env, c) {
    await env.AUTH_KV.put(`circuit:${c.id}`, JSON.stringify(c));
}

async function handleCircuitsGet(request, env, cors) {
    const user = await authenticate(request, env);
    if (!user) return json({ error: 'Unauthorized' }, 401, cors);
    const raw  = await env.AUTH_KV.get('circuit_index');
    const ids  = raw ? JSON.parse(raw) : [];
    const list = (await Promise.all(ids.map(id => getCircuit(env, id)))).filter(Boolean);
    list.sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));
    return json(list, 200, cors);
}

async function handleCircuitsPost(request, env, cors) {
    const user = await authenticate(request, env);
    if (!user || user.role !== 'admin') return json({ error: 'Forbidden' }, 403, cors);
    let body;
    try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, cors); }

    const { name, season, startDate, endDate, pointTable, winBonus } = body;
    if (!name) return json({ error: 'name é obrigatório' }, 400, cors);

    const c = {
        id:         newCircuitId(),
        name:       String(name).slice(0, 128),
        season:     season ? String(season).slice(0, 64) : null,
        startDate:  startDate ? String(startDate).slice(0, 10) : null,
        endDate:    endDate   ? String(endDate).slice(0, 10)   : null,
        pointTable:   pointTable && typeof pointTable === 'object' ? pointTable : { 1: 10, 2: 7, 3: 5, 4: 5, '5-8': 3, default: 1 },
        winBonus:     winBonus != null ? Number(winBonus) : 0,
        participants: Array.isArray(body.participants)
            ? body.participants.slice(0, 256).map(p => ({ id: String(p.id || '').slice(0, 64), name: String(p.name || '').slice(0, 64) }))
            : [],
        createdAt:    new Date().toISOString(),
    };

    await putCircuit(env, c);
    await appendIndex(env, 'circuit_index', c.id);
    await appendAuditLog(env, { actorId: user.id, actorName: user.displayName, action: 'create_circuit', targetId: c.id, targetName: c.name });
    return json(c, 201, cors);
}

async function handleCircuitPut(request, env, cors, id) {
    const user = await authenticate(request, env);
    if (!user || user.role !== 'admin') return json({ error: 'Forbidden' }, 403, cors);
    const c = await getCircuit(env, id);
    if (!c) return json({ error: 'Not found' }, 404, cors);

    let body;
    try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, cors); }

    if (body.name      !== undefined) c.name      = String(body.name).slice(0, 128);
    if (body.season    !== undefined) c.season    = body.season ? String(body.season).slice(0, 64) : null;
    if (body.startDate !== undefined) c.startDate = body.startDate ? String(body.startDate).slice(0, 10) : null;
    if (body.endDate   !== undefined) c.endDate   = body.endDate   ? String(body.endDate).slice(0, 10)   : null;
    if (body.pointTable !== undefined && typeof body.pointTable === 'object') c.pointTable = body.pointTable;
    if (body.winBonus  !== undefined) c.winBonus  = Number(body.winBonus);
    if (body.participants !== undefined) c.participants = Array.isArray(body.participants)
        ? body.participants.slice(0, 256).map(p => ({ id: String(p.id || '').slice(0, 64), name: String(p.name || '').slice(0, 64) }))
        : [];

    await putCircuit(env, c);
    return json(c, 200, cors);
}

async function handleCircuitDelete(request, env, cors, id) {
    const user = await authenticate(request, env);
    if (!user || user.role !== 'admin') return json({ error: 'Forbidden' }, 403, cors);
    const c = await getCircuit(env, id);
    if (!c) return json({ error: 'Not found' }, 404, cors);

    await env.AUTH_KV.delete(`circuit:${id}`);
    await removeIndex(env, 'circuit_index', id);
    await appendAuditLog(env, { actorId: user.id, actorName: user.displayName, action: 'delete_circuit', targetId: id, targetName: c.name });
    return json({ ok: true }, 200, cors);
}

// ── Tournaments ───────────────────────────────────────────────────────────────

function newTournamentId() { return 'trn_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12); }

async function getTournament(env, id) {
    const raw = await env.AUTH_KV.get(`tournament:${id}`);
    return raw ? JSON.parse(raw) : null;
}

async function putTournament(env, t) {
    await env.AUTH_KV.put(`tournament:${t.id}`, JSON.stringify(t));
}

async function handleTournamentsGet(request, env, cors) {
    const user = await authenticate(request, env);
    if (!user) return json({ error: 'Unauthorized' }, 401, cors);
    const raw  = await env.AUTH_KV.get('tournament_index');
    const ids  = raw ? JSON.parse(raw) : [];
    const list = (await Promise.all(ids.map(id => getTournament(env, id)))).filter(Boolean);
    // Sort newest first
    list.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    return json(list, 200, cors);
}

async function handleTournamentsPost(request, env, cors) {
    const user = await authenticate(request, env);
    if (!user || user.role !== 'admin') return json({ error: 'Forbidden' }, 403, cors);
    let body;
    try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, cors); }

    const { name, date, format, matchFormat, rounds, topCutSize, swissTopCutSize, participants, circuitId } = body;
    if (!name || !date || !format) return json({ error: 'name, date e format são obrigatórios' }, 400, cors);
    if (!['swiss', 'round_robin', 'top_cut', 'swiss_top_cut'].includes(format)) return json({ error: 'format inválido' }, 400, cors);

    const t = {
        id:          newTournamentId(),
        name:        String(name).slice(0, 128),
        date:        String(date).slice(0, 10),
        format,
        matchFormat: ['md1', 'md3', 'md5'].includes(matchFormat) ? matchFormat : 'md3',
        rounds:      undefined,
        topCutSize: format === 'top_cut'
                        ? ([4, 8, 16].includes(Number(topCutSize)) ? Number(topCutSize) : 8)
                        : undefined,
        swissTopCutSize: format === 'swiss_top_cut'
                        ? ([4, 8, 16].includes(Number(swissTopCutSize)) ? Number(swissTopCutSize) : 8)
                        : undefined,
        phase: format === 'swiss_top_cut' ? 'swiss' : undefined,
        status:     'pending',
        circuitId:  circuitId || null,
        participants: Array.isArray(participants)
            ? participants.slice(0, 256).map(p => ({
                id:      String(p.id   || '').slice(0, 64),
                name:    String(p.name || '').slice(0, 64),
                isGuest: !!p.isGuest,
              }))
            : [],
        createdAt: new Date().toISOString(),
        createdBy: user.id,
    };

    await putTournament(env, t);
    await appendIndex(env, 'tournament_index', t.id);
    await appendAuditLog(env, { actorId: user.id, actorName: user.displayName, action: 'create_tournament', targetId: t.id, targetName: t.name });
    return json(t, 201, cors);
}

// ── Tournament: helpers ───────────────────────────────────────────────────────

function _computeStandings(t) {
    const map = {};
    for (const p of (t.participants || [])) {
        map[p.id] = { id: p.id, name: p.name, wins: 0, losses: 0, gw: 0, gl: 0, opponents: [] };
    }
    for (const round of (t.rounds || [])) {
        for (const pair of round.pairings) {
            if (!pair.result) continue;
            const { winnerId, p1GameWins: p1g = 0, p2GameWins: p2g = 0 } = pair.result;
            const loserId = winnerId === pair.p1Id ? pair.p2Id : pair.p1Id;
            if (map[winnerId]) {
                map[winnerId].wins++;
                map[winnerId].gw += winnerId === pair.p1Id ? p1g : p2g;
                map[winnerId].gl += winnerId === pair.p1Id ? p2g : p1g;
                if (loserId !== 'BYE') map[winnerId].opponents.push(loserId);
            }
            if (map[loserId]) {
                map[loserId].losses++;
                map[loserId].gw += loserId === pair.p1Id ? p1g : p2g;
                map[loserId].gl += loserId === pair.p1Id ? p2g : p1g;
                if (winnerId !== 'BYE') map[loserId].opponents.push(winnerId);
            }
        }
    }
    // Compute OMW%: average of each opponent's match win rate (min 33%)
    const standings = Object.values(map);
    for (const s of standings) {
        if (!s.opponents.length) { s.omwPct = 0.33; continue; }
        const rates = s.opponents.map(opId => {
            const op = map[opId];
            if (!op) return 0.33;
            const total = op.wins + op.losses;
            if (!total) return 0.33;
            return Math.max(0.33, op.wins / total);
        });
        s.omwPct = rates.reduce((a, b) => a + b, 0) / rates.length;
        delete s.opponents;
    }
    return standings.sort((a, b) =>
        b.wins - a.wins || a.losses - b.losses || b.omwPct - a.omwPct || b.gw - a.gw
    );
}

function _swissPairings(participants, rounds) {
    participants = participants.filter(p => !p.dropped);
    const wins   = {};
    const played = {};
    for (const p of participants) wins[p.id] = 0;
    for (const r of rounds) {
        for (const pair of r.pairings) {
            if (pair.result?.winnerId) wins[pair.result.winnerId] = (wins[pair.result.winnerId] || 0) + 1;
            const key = [pair.p1Id, pair.p2Id].sort().join('|');
            played[key] = true;
        }
    }
    const sorted = [...participants].sort((a, b) => (wins[b.id] || 0) - (wins[a.id] || 0));
    const result = [];
    const used   = new Set();
    for (let i = 0; i < sorted.length; i++) {
        if (used.has(sorted[i].id)) continue;
        const p1 = sorted[i];
        let found = false;
        for (let j = i + 1; j < sorted.length; j++) {
            if (used.has(sorted[j].id)) continue;
            const p2  = sorted[j];
            const key = [p1.id, p2.id].sort().join('|');
            if (!played[key]) {
                result.push({ p1Id: p1.id, p2Id: p2.id });
                used.add(p1.id); used.add(p2.id); found = true; break;
            }
        }
        if (!found) {
            for (let j = i + 1; j < sorted.length; j++) {
                if (!used.has(sorted[j].id)) {
                    result.push({ p1Id: p1.id, p2Id: sorted[j].id });
                    used.add(p1.id); used.add(sorted[j].id); found = true; break;
                }
            }
        }
        if (!found && !used.has(p1.id)) {
            result.push({ p1Id: p1.id, p2Id: 'BYE' });
            used.add(p1.id);
        }
    }
    return result;
}

function _roundRobinRounds(participants) {
    const ids = participants.map(p => p.id);
    if (ids.length % 2 === 1) ids.push('BYE');
    const n        = ids.length;
    const rounds   = [];
    const fixed    = ids[0];
    const rotating = ids.slice(1);
    for (let r = 0; r < n - 1; r++) {
        const circle   = [fixed, ...rotating];
        const pairings = [];
        for (let i = 0; i < n / 2; i++) {
            const p1Id = circle[i];
            const p2Id = circle[n - 1 - i];
            const isBye = p1Id === 'BYE' || p2Id === 'BYE';
            pairings.push({
                id: `r${r + 1}p${i}`,
                p1Id,
                p2Id,
                result: isBye ? { winnerId: p1Id === 'BYE' ? p2Id : p1Id, p1GameWins: 2, p2GameWins: 0 } : null,
            });
        }
        rounds.push({ number: r + 1, pairings, complete: pairings.every(p => p.result !== null) });
        rotating.push(rotating.shift());
    }
    return rounds;
}

function _topCutPairings(participants, standings, topCutSize, existingRounds) {
    if (!existingRounds.length) {
        const seeded = standings.slice(0, topCutSize);
        const pairs  = [];
        for (let i = 0; i < seeded.length / 2; i++)
            pairs.push({ p1Id: seeded[i].id, p2Id: seeded[seeded.length - 1 - i].id });
        return pairs;
    }
    const last    = existingRounds[existingRounds.length - 1];
    const winners = last.pairings.map(p => p.result?.winnerId).filter(Boolean);
    const pairs   = [];
    for (let i = 0; i < winners.length; i += 2)
        pairs.push({ p1Id: winners[i], p2Id: winners[i + 1] });
    return pairs;
}

// ── Tournament: CRUD + round management ──────────────────────────────────────

async function handleTournamentGet(request, env, cors, id) {
    const user = await authenticate(request, env);
    if (!user) return json({ error: 'Unauthorized' }, 401, cors);
    const t = await getTournament(env, id);
    if (!t) return json({ error: 'Not found' }, 404, cors);
    return json(t, 200, cors);
}

async function handleGenerateRound(request, env, cors, id) {
    const user = await authenticate(request, env);
    if (!user || user.role !== 'admin') return json({ error: 'Forbidden' }, 403, cors);
    const t = await getTournament(env, id);
    if (!t) return json({ error: 'Not found' }, 404, cors);
    if (t.status === 'completed') return json({ error: 'Torneio já encerrado' }, 400, cors);

    t.rounds = t.rounds || [];
    const last = t.rounds[t.rounds.length - 1];
    if (last && !last.complete) return json({ error: 'Rodada atual ainda não encerrada' }, 400, cors);

    t.status = 'in_progress';

    if (t.format === 'round_robin') {
        if (t.rounds.length) return json({ error: 'Rodadas já geradas' }, 400, cors);
        t.rounds = _roundRobinRounds(t.participants);
        await putTournament(env, t);
        _broadcastPush(env, { title: `🏆 ${t.name}`, body: `Rodada 1 aberta! Verifique sua mesa.`, url: '/', tag: `round-${t.id}` }).catch(() => {});
        return json(t, 200, cors);
    }

    // Swiss: check termination before generating
    if (t.format === 'swiss' && t.rounds.length > 0) {
        const standings  = _computeStandings(t);
        const undefeated = standings.filter(s => s.losses === 0);
        if (undefeated.length <= 1) {
            t.status = 'completed';
            await putTournament(env, t);
            return json(t, 200, cors);
        }
    }

    // Swiss→TopCut hybrid: check swiss termination, then pivot to top cut
    if (t.format === 'swiss_top_cut') {
        if (t.phase === 'swiss' && t.rounds.length > 0) {
            const standings  = _computeStandings(t);
            const undefeated = standings.filter(s => s.losses === 0);
            if (undefeated.length <= 1) {
                // Transition to top cut phase
                t.phase = 'top_cut';
            }
        }
        const roundNumber = t.rounds.length + 1;
        let rawPairs;
        if (t.phase === 'swiss') {
            rawPairs = _swissPairings(t.participants, t.rounds);
        } else {
            // top_cut phase: use swiss_top_cut rounds so far as "existing top cut rounds"
            const topCutRounds = t.rounds.filter(r => r.isTopCut);
            const standings = _computeStandings(t);
            rawPairs = _topCutPairings(t.participants, standings, t.swissTopCutSize, topCutRounds);
        }
        const pairings = rawPairs.map((p, i) => {
            const isBye = p.p2Id === 'BYE';
            return {
                id:       `r${roundNumber}p${i}`,
                p1Id:     p.p1Id,
                p2Id:     p.p2Id,
                isTopCut: t.phase === 'top_cut',
                result:   isBye ? { winnerId: p.p1Id, p1GameWins: 2, p2GameWins: 0 } : null,
            };
        });
        const newRound = { number: roundNumber, pairings, isTopCut: t.phase === 'top_cut', complete: pairings.every(p => p.result !== null) };
        t.rounds.push(newRound);
        await putTournament(env, t);
        _broadcastPush(env, { title: `🏆 ${t.name}`, body: `Rodada ${roundNumber} aberta! Verifique sua mesa.`, url: '/', tag: `round-${t.id}` }).catch(() => {});
        return json(t, 200, cors);
    }

    const roundNumber = t.rounds.length + 1;
    let rawPairs;
    if (t.format === 'swiss') {
        rawPairs = _swissPairings(t.participants, t.rounds);
    } else {
        const standings = _computeStandings(t);
        rawPairs = _topCutPairings(t.participants, standings, t.topCutSize, t.rounds);
    }

    const pairings = rawPairs.map((p, i) => {
        const isBye = p.p2Id === 'BYE';
        return {
            id:     `r${roundNumber}p${i}`,
            p1Id:   p.p1Id,
            p2Id:   p.p2Id,
            result: isBye ? { winnerId: p.p1Id, p1GameWins: 2, p2GameWins: 0 } : null,
        };
    });

    const newRound = { number: roundNumber, pairings, complete: pairings.every(p => p.result !== null) };
    t.rounds.push(newRound);
    await putTournament(env, t);
    _broadcastPush(env, { title: `🏆 ${t.name}`, body: `Rodada ${roundNumber} aberta! Verifique sua mesa.`, url: '/', tag: `round-${t.id}` }).catch(() => {});
    return json(t, 200, cors);
}

async function handleRecordResult(request, env, cors, id) {
    const user = await authenticate(request, env);
    if (!user || user.role !== 'admin') return json({ error: 'Forbidden' }, 403, cors);
    const t = await getTournament(env, id);
    if (!t) return json({ error: 'Not found' }, 404, cors);

    let body;
    try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, cors); }
    const { roundNumber, pairingId, winnerId, p1GameWins, p2GameWins, timeExtension } = body;

    const round = (t.rounds || []).find(r => r.number === roundNumber);
    if (!round) return json({ error: 'Rodada não encontrada' }, 404, cors);
    const pair  = round.pairings.find(p => p.id === pairingId);
    if (!pair)  return json({ error: 'Partida não encontrada' }, 404, cors);
    if (winnerId !== pair.p1Id && winnerId !== pair.p2Id)
        return json({ error: 'Vencedor inválido' }, 400, cors);

    pair.result = { winnerId, p1GameWins: Number(p1GameWins) || 0, p2GameWins: Number(p2GameWins) || 0 };
    if (timeExtension && Number(timeExtension) > 0) {
        t.timeExtensions = t.timeExtensions || {};
        t.timeExtensions[pairingId] = Number(timeExtension);
    }
    round.complete = round.pairings.every(p => p.result !== null);

    if (round.complete) {
        if (t.format === 'swiss') {
            const standings  = _computeStandings(t);
            const undefeated = standings.filter(s => s.losses === 0);
            if (undefeated.length <= 1) t.status = 'completed';
        } else if (t.format === 'round_robin') {
            if (t.rounds.every(r => r.complete)) t.status = 'completed';
        } else if (t.format === 'top_cut') {
            if (round.pairings.length === 1) t.status = 'completed';
        } else if (t.format === 'swiss_top_cut') {
            if (round.isTopCut && round.pairings.length === 1) t.status = 'completed';
        }
    }

    await putTournament(env, t);
    return json(t, 200, cors);
}

async function handleParticipantPut(request, env, cors, id, participantId) {
    const user = await authenticate(request, env);
    if (!user || user.role !== 'admin') return json({ error: 'Forbidden' }, 403, cors);
    const t = await getTournament(env, id);
    if (!t) return json({ error: 'Not found' }, 404, cors);

    let body;
    try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, cors); }

    const participant = (t.participants || []).find(p => p.id === participantId);
    if (!participant) return json({ error: 'Participant not found' }, 404, cors);

    if (body.leaderId !== undefined) {
        participant.leaderId = String(body.leaderId || '').slice(0, 32) || undefined;
    }
    if (body.checkedIn !== undefined) {
        participant.checkedIn = !!body.checkedIn;
    }

    await putTournament(env, t);
    return json(t, 200, cors);
}

async function handleTournamentPut(request, env, cors, id) {
    const user = await authenticate(request, env);
    if (!user || user.role !== 'admin') return json({ error: 'Forbidden' }, 403, cors);
    const t = await getTournament(env, id);
    if (!t) return json({ error: 'Not found' }, 404, cors);

    let body;
    try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, cors); }

    if (body.name      !== undefined) t.name      = String(body.name).slice(0, 128);
    if (body.date      !== undefined) t.date      = String(body.date).slice(0, 10);
    if (body.matchFormat !== undefined) t.matchFormat = ['md1', 'md3', 'md5'].includes(body.matchFormat) ? body.matchFormat : t.matchFormat;
    if (body.circuitId !== undefined) t.circuitId = body.circuitId || null;

    // Only allow changing format/topCutSize if no rounds have been generated
    const hasRounds = t.rounds && t.rounds.length > 0;
    if (!hasRounds) {
        if (body.format !== undefined && ['swiss', 'round_robin', 'top_cut', 'swiss_top_cut'].includes(body.format)) {
            t.format = body.format;
            if (body.format === 'swiss_top_cut' && !t.phase) t.phase = 'swiss';
        }
        if (body.topCutSize !== undefined && t.format === 'top_cut') {
            t.topCutSize = [4, 8, 16].includes(Number(body.topCutSize)) ? Number(body.topCutSize) : t.topCutSize;
        }
        if (body.swissTopCutSize !== undefined && t.format === 'swiss_top_cut') {
            t.swissTopCutSize = [4, 8, 16].includes(Number(body.swissTopCutSize)) ? Number(body.swissTopCutSize) : t.swissTopCutSize;
        }
    }

    await putTournament(env, t);
    return json(t, 200, cors);
}

async function handleTournamentDelete(request, env, cors, id) {
    const user = await authenticate(request, env);
    if (!user || user.role !== 'admin') return json({ error: 'Forbidden' }, 403, cors);
    const t = await getTournament(env, id);
    if (!t) return json({ error: 'Not found' }, 404, cors);

    await env.AUTH_KV.delete(`tournament:${id}`);
    await removeIndex(env, 'tournament_index', id);
    await appendAuditLog(env, { actorId: user.id, actorName: user.displayName, action: 'delete_tournament', targetId: id, targetName: t.name });
    return json({ ok: true }, 200, cors);
}

async function handleDropPlayer(request, env, cors, id, participantId) {
    const user = await authenticate(request, env);
    if (!user || user.role !== 'admin') return json({ error: 'Forbidden' }, 403, cors);
    const t = await getTournament(env, id);
    if (!t) return json({ error: 'Not found' }, 404, cors);

    const participant = (t.participants || []).find(p => p.id === participantId);
    if (!participant) return json({ error: 'Participant not found' }, 404, cors);
    if (participant.dropped) return json({ error: 'Participant already dropped' }, 400, cors);

    participant.dropped = true;

    // For round_robin: forfeit all pending pairings involving this participant
    if (t.format === 'round_robin') {
        for (const round of (t.rounds || [])) {
            for (const pair of round.pairings) {
                if (pair.result !== null) continue;
                if (pair.p1Id === participantId || pair.p2Id === participantId) {
                    const opponentId = pair.p1Id === participantId ? pair.p2Id : pair.p1Id;
                    const opponentIsP1 = pair.p2Id === participantId;
                    pair.result = {
                        winnerId:    opponentId,
                        p1GameWins:  opponentIsP1 ? 2 : 0,
                        p2GameWins:  opponentIsP1 ? 0 : 2,
                    };
                }
            }
            round.complete = round.pairings.every(p => p.result !== null);
        }
        // Check if tournament is now complete
        if (t.rounds.length && t.rounds.every(r => r.complete)) {
            t.status = 'completed';
        }
    }

    // For top_cut: same — forfeit pending pairings (opponent advances)
    if (t.format === 'top_cut') {
        for (const round of (t.rounds || [])) {
            for (const pair of round.pairings) {
                if (pair.result !== null) continue;
                if (pair.p1Id === participantId || pair.p2Id === participantId) {
                    const opponentId = pair.p1Id === participantId ? pair.p2Id : pair.p1Id;
                    const opponentIsP1 = pair.p2Id === participantId;
                    pair.result = {
                        winnerId:    opponentId,
                        p1GameWins:  opponentIsP1 ? 2 : 0,
                        p2GameWins:  opponentIsP1 ? 0 : 2,
                    };
                }
            }
            round.complete = round.pairings.every(p => p.result !== null);
        }
        const lastRound = t.rounds[t.rounds.length - 1];
        if (lastRound && lastRound.complete && lastRound.pairings.length === 1) {
            t.status = 'completed';
        }
    }

    // Swiss: dropped participant is excluded from future _swissPairings by filtering t.participants
    // No changes to existing rounds needed

    await putTournament(env, t);
    return json(t, 200, cors);
}

async function handleTimerPut(request, env, cors, id) {
    const user = await authenticate(request, env);
    if (!user || user.role !== 'admin') return json({ error: 'Forbidden' }, 403, cors);
    const t = await getTournament(env, id);
    if (!t) return json({ error: 'Not found' }, 404, cors);

    let body;
    try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, cors); }
    const { action } = body;

    if (action === 'start') {
        t.currentTimerStart = new Date().toISOString();
    } else if (action === 'stop' || action === 'reset') {
        t.currentTimerStart = null;
    } else {
        return json({ error: 'action must be start|stop|reset' }, 400, cors);
    }

    await putTournament(env, t);
    return json(t, 200, cors);
}

async function handlePlacements(request, env, cors, id) {
    const user = await authenticate(request, env);
    if (!user || user.role !== 'admin') return json({ error: 'Forbidden' }, 403, cors);
    const t = await getTournament(env, id);
    if (!t) return json({ error: 'Not found' }, 404, cors);

    let body;
    try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, cors); }
    const { placements } = body;
    if (!Array.isArray(placements)) return json({ error: 'placements array required' }, 400, cors);

    t.placements = placements.map(p => ({
        participantId: String(p.participantId || '').slice(0, 64),
        place:         Number(p.place) || 0,
        prize:         String(p.prize || '').slice(0, 128),
    }));
    t.status = 'completed';

    // Auto-assign badges to registered (non-guest) players in top 4
    const badgesRaw = await env.AUTH_KV.get('player_badges');
    const badgesMap = badgesRaw ? JSON.parse(badgesRaw) : {};
    const allIds    = JSON.parse((await env.AUTH_KV.get('user_index')) || '[]');
    const allUsers  = (await Promise.all(allIds.map(uid => getUser(env, uid)))).filter(Boolean);

    const placeLabel = { 1: 'Campeão', 2: '2º Lugar', 3: '3º/4º Lugar', 4: '3º/4º Lugar' };
    for (const pl of t.placements) {
        if (pl.place > 4) continue;
        const participant = (t.participants || []).find(p => p.id === pl.participantId);
        if (!participant || participant.isGuest) continue;
        // Match by participant.id (which equals bandaiName for registered players)
        const regUser = allUsers.find(u => u.profile?.bandaiName?.toLowerCase() === participant.id.toLowerCase());
        if (!regUser) continue;
        const badgeKey = regUser.profile.bandaiName;
        badgesMap[badgeKey] = badgesMap[badgeKey] || [];
        const badge = `${placeLabel[pl.place] || `Top ${pl.place}`} · ${t.name} · ${t.date}`;
        if (!badgesMap[badgeKey].includes(badge)) badgesMap[badgeKey].push(badge);
    }
    await env.AUTH_KV.put('player_badges', JSON.stringify(badgesMap));

    await putTournament(env, t);
    return json(t, 200, cors);
}

async function handleCircuitConfigGet(request, env, cors) {
    const user = await authenticate(request, env);
    if (!user) return json({ error: 'Unauthorized' }, 401, cors);
    const raw = await env.AUTH_KV.get('circuit_config');
    return json(raw ? JSON.parse(raw) : null, 200, cors);
}

async function handleCircuitConfigPut(request, env, cors) {
    const user = await authenticate(request, env);
    if (!user || user.role !== 'admin') return json({ error: 'Forbidden' }, 403, cors);
    let body;
    try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, cors); }
    await env.AUTH_KV.put('circuit_config', JSON.stringify(body));
    return json({ ok: true }, 200, cors);
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
            if (path === '/decks'                && method === 'GET')  return handleDecksGet(request, env, cors);
            if (path === '/decks'                && method === 'POST') return handleDecksPost(request, env, cors);

            const deckMatch = path.match(/^\/decks\/([^/]+)$/);
            if (deckMatch && method === 'PUT')    return handleDeckPut(request, env, cors, deckMatch[1]);
            if (deckMatch && method === 'DELETE') return handleDeckDelete(request, env, cors, deckMatch[1]);

            const publicDecksMatch = path.match(/^\/decks\/public\/(.+)$/);
            if (publicDecksMatch && method === 'GET') return handlePublicDecks(request, env, cors, decodeURIComponent(publicDecksMatch[1]));

            if (path === '/my-matches'           && method === 'GET')  return handleMatchesGet(request, env, cors);
            if (path === '/my-matches'           && method === 'POST') return handleMatchesPost(request, env, cors);

            const matchIdMatch = path.match(/^\/my-matches\/([^/]+)$/);
            if (matchIdMatch && method === 'PUT')    return handleMatchPut(request, env, cors, matchIdMatch[1]);
            if (matchIdMatch && method === 'DELETE') return handleMatchDelete(request, env, cors, matchIdMatch[1]);

            const publicMatchesMatch = path.match(/^\/matches-by-name\/(.+)$/);
            if (publicMatchesMatch && method === 'GET') return handlePublicMatches(request, env, cors, decodeURIComponent(publicMatchesMatch[1]));

            if (path === '/push/subscribe'  && method === 'POST')   return handlePushSubscribe(request, env, cors);
            if (path === '/push/subscribe'  && method === 'DELETE') return handlePushUnsubscribe(request, env, cors);

            if (path === '/banner'          && method === 'GET') return handleBannerGet(request, env, cors);
            if (path === '/admin/banner'    && method === 'PUT') return handleBannerPut(request, env, cors);
            if (path === '/admin/audit-log' && method === 'GET') return handleAuditLog(request, env, cors);
            if (path === '/admin/decks'     && method === 'GET') return handleAdminDecksGet(request, env, cors);
            if (path === '/inbox'           && method === 'GET') return handleInboxGet(request, env, cors);

            const inboxReadMatch = path.match(/^\/inbox\/([^/]+)\/read$/);
            if (inboxReadMatch && method === 'POST') return handleInboxRead(request, env, cors, inboxReadMatch[1]);

            const sendMsgMatch = path.match(/^\/admin\/message\/(.+)$/);
            if (sendMsgMatch && method === 'POST') return handleSendMessage(request, env, cors, sendMsgMatch[1]);

            const suspendMatch = path.match(/^\/admin\/suspend\/(.+)$/);
            if (suspendMatch && method === 'POST') return handleSuspend(request, env, cors, suspendMatch[1]);

            const unsuspendMatch = path.match(/^\/admin\/unsuspend\/(.+)$/);
            if (unsuspendMatch && method === 'POST') return handleUnsuspend(request, env, cors, unsuspendMatch[1]);

            const adminEditUserMatch = path.match(/^\/admin\/users\/(.+)$/);
            if (adminEditUserMatch && method === 'PUT')    return handleAdminEditUser(request, env, cors, adminEditUserMatch[1]);
            if (adminEditUserMatch && method === 'DELETE') return handleDeleteUser(request, env, cors, adminEditUserMatch[1]);

            const adminProfileMatch = path.match(/^\/admin\/profile\/(.+)$/);
            if (adminProfileMatch && method === 'PUT') return handleAdminProfileEdit(request, env, cors, adminProfileMatch[1]);

            const adminDeckDeleteMatch = path.match(/^\/admin\/decks\/([^/]+)\/([^/]+)$/);
            if (adminDeckDeleteMatch && method === 'DELETE') return handleAdminDeckDelete(request, env, cors, adminDeckDeleteMatch[1], adminDeckDeleteMatch[2]);

            const approveMatch = path.match(/^\/admin\/approve\/(.+)$/);
            if (approveMatch && method === 'POST') return handleApprove(request, env, cors, approveMatch[1]);

            const setRoleMatch = path.match(/^\/admin\/set-role\/(.+)$/);
            if (setRoleMatch && method === 'POST') return handleSetRole(request, env, cors, setRoleMatch[1]);

            const rejectMatch = path.match(/^\/admin\/reject\/(.+)$/);
            if (rejectMatch  && method === 'POST') return handleReject(request, env, cors, rejectMatch[1]);

            const profileByNameMatch = path.match(/^\/profile\/by-name\/(.+)$/);
            if (profileByNameMatch && method === 'GET') return handleProfileByName(request, env, cors, decodeURIComponent(profileByNameMatch[1]));

            if (path === '/optcg-proxy' && method === 'GET') return handleOptcgProxy(request, env, cors);

            if (path === '/tournaments' && method === 'GET')  return handleTournamentsGet(request, env, cors);
            if (path === '/tournaments' && method === 'POST') return handleTournamentsPost(request, env, cors);

            const trnMatch = path.match(/^\/tournaments\/([^/]+)$/);
            if (trnMatch && method === 'GET')    return handleTournamentGet(request, env, cors, trnMatch[1]);
            if (trnMatch && method === 'PUT')    return handleTournamentPut(request, env, cors, trnMatch[1]);
            if (trnMatch && method === 'DELETE') return handleTournamentDelete(request, env, cors, trnMatch[1]);

            const dropMatch = path.match(/^\/tournaments\/([^/]+)\/drop\/([^/]+)$/);
            if (dropMatch && method === 'POST') return handleDropPlayer(request, env, cors, dropMatch[1], dropMatch[2]);

            const participantMatch = path.match(/^\/tournaments\/([^/]+)\/participant\/([^/]+)$/);
            if (participantMatch && method === 'PUT') return handleParticipantPut(request, env, cors, participantMatch[1], participantMatch[2]);

            const trnGenMatch = path.match(/^\/tournaments\/([^/]+)\/generate-round$/);
            if (trnGenMatch && method === 'POST') return handleGenerateRound(request, env, cors, trnGenMatch[1]);

            const trnResMatch = path.match(/^\/tournaments\/([^/]+)\/result$/);
            if (trnResMatch && method === 'POST') return handleRecordResult(request, env, cors, trnResMatch[1]);

            const trnTimerMatch = path.match(/^\/tournaments\/([^/]+)\/timer$/);
            if (trnTimerMatch && method === 'PUT') return handleTimerPut(request, env, cors, trnTimerMatch[1]);

            const trnPlacementsMatch = path.match(/^\/tournaments\/([^/]+)\/placements$/);
            if (trnPlacementsMatch && method === 'POST') return handlePlacements(request, env, cors, trnPlacementsMatch[1]);

            const trnCloneMatch = path.match(/^\/tournaments\/([^/]+)\/clone$/);
            if (trnCloneMatch && method === 'POST') return handleTournamentClone(request, env, cors, trnCloneMatch[1]);

            const trnReopenMatch = path.match(/^\/tournaments\/([^/]+)\/reopen-round$/);
            if (trnReopenMatch && method === 'POST') return handleReopenRound(request, env, cors, trnReopenMatch[1]);

            const trnExportMatch = path.match(/^\/tournaments\/([^/]+)\/export$/);
            if (trnExportMatch && method === 'GET') return handleTournamentExport(request, env, cors, trnExportMatch[1]);

            if (path === '/circuits' && method === 'GET')  return handleCircuitsGet(request, env, cors);
            if (path === '/circuits' && method === 'POST') return handleCircuitsPost(request, env, cors);
            const circuitIdMatch = path.match(/^\/circuits\/([^/]+)$/);
            if (circuitIdMatch && method === 'PUT')    return handleCircuitPut(request, env, cors, circuitIdMatch[1]);
            if (circuitIdMatch && method === 'DELETE') return handleCircuitDelete(request, env, cors, circuitIdMatch[1]);

            const circuitManualPtsMatch = path.match(/^\/circuits\/([^/]+)\/manual-points$/);
            if (circuitManualPtsMatch && method === 'POST') return handleCircuitManualPoints(request, env, cors, circuitManualPtsMatch[1]);

            const circuitCloseMatch = path.match(/^\/circuits\/([^/]+)\/close$/);
            if (circuitCloseMatch && method === 'POST') return handleCircuitClose(request, env, cors, circuitCloseMatch[1]);

            if (path === '/circuit-config' && method === 'GET') return handleCircuitConfigGet(request, env, cors);
            if (path === '/circuit-config' && method === 'PUT') return handleCircuitConfigPut(request, env, cors);

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

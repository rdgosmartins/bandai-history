// ── File / parse ───────────────────────────────────────────────────────────

function parseMapText(text) {
    const users = [];
    const nameMap = {};

    for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // Split only on the first two colons so the JWT (which has no colons) is safe
        // Format: Name:BandaiID  OR  Name:BandaiID:BearerToken
        const firstColon  = trimmed.indexOf(':');
        if (firstColon === -1) continue;
        const secondColon = trimmed.indexOf(':', firstColon + 1);

        const name     = trimmed.slice(0, firstColon).trim();
        const bandaiId = secondColon === -1
            ? trimmed.slice(firstColon + 1).trim()
            : trimmed.slice(firstColon + 1, secondColon).trim();
        const token    = secondColon !== -1 ? trimmed.slice(secondColon + 1).trim() : null;

        if (!name || !bandaiId) continue;
        nameMap[bandaiId] = name;
        if (token) users.push({ name, bandaiId, token });
    }

    return { users, nameMap };
}

function applyParsed({ users, nameMap }) {
    App.usersWithToken = users;
    App.usernameMap    = nameMap;

    const select = document.getElementById('userSelect');
    const status = document.getElementById('fileStatus');

    if (users.length === 0) {
        select.innerHTML = '<option value="">— no users with bearer tokens found —</option>';
        select.disabled = true;
        status.className = 'file-status warn';
        status.textContent = `${Object.keys(nameMap).length} players loaded — add a token to a user entry to enable fetching`;
        document.getElementById('fetchBtn').disabled = true;
        return;
    }

    select.innerHTML = '<option value="">— select a user —</option>';
    for (let i = 0; i < users.length; i++) {
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = users[i].name;
        select.appendChild(opt);
    }
    if (users.length === 1) select.selectedIndex = 1;
    select.disabled = false;

    const total = Object.keys(nameMap).length;
    status.className = 'file-status ok';
    status.textContent = `${total} players loaded — ${users.length} with token`;

    document.getElementById('syncAllBtn').disabled = users.length < 2;

    onUserChange();
}

function loadMapFile(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        document.getElementById('usernameMap').value = e.target.result;
        applyParsed(parseMapText(e.target.result));
        const status = document.getElementById('fileStatus');
        status.textContent = status.textContent.replace('loaded', `loaded · ${file.name}`);
    };
    reader.readAsText(file);
}

function parsePasted() {
    const text = document.getElementById('usernameMap').value;
    applyParsed(parseMapText(text));
}

function onUserChange() {
    const idx = document.getElementById('userSelect').value;
    document.getElementById('fetchBtn').disabled = (idx === '');
    if (idx === '') {
        document.getElementById('cacheBar').style.display = 'none';
        document.getElementById('loadCacheBtn').disabled = true;
        return;
    }
    const user = App.usersWithToken[parseInt(idx)];
    const cache = loadCache(user.bandaiId);
    const hasCache = Object.keys(cache).length > 0;
    document.getElementById('loadCacheBtn').disabled = !hasCache;
    updateCacheBar(user.bandaiId);
}

// ── Cache (localStorage, keyed per Bandai ID) ──────────────────────────────

function cacheKey(bandaiId) { return CACHE_PREFIX + bandaiId; }

function loadCache(bandaiId) {
    try {
        const raw = localStorage.getItem(cacheKey(bandaiId));
        return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
}

function saveCache(bandaiId, cache) {
    try {
        localStorage.setItem(cacheKey(bandaiId), JSON.stringify(cache));
    } catch (e) {
        console.warn('localStorage write failed — cache not saved:', e);
    }
    // Push to shared KV cache (fire-and-forget — all sessions benefit)
    fetch(`${AUTH_BASE}/cache/${bandaiId}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cache),
    }).catch(() => {});
}

// Pulls KV cache for a bandaiId and merges into localStorage.
// Local entries win in case of conflict (most recently fetched device wins).
async function pullServerCache(bandaiId) {
    try {
        const r = await fetch(`${AUTH_BASE}/cache/${bandaiId}`, { credentials: 'include' });
        if (!r.ok) return;
        const serverCache = await r.json();
        if (!serverCache || !Object.keys(serverCache).length) return;
        const localCache = loadCache(bandaiId);
        const merged = { ...serverCache, ...localCache };
        localStorage.setItem(cacheKey(bandaiId), JSON.stringify(merged));
        console.log(`[Cache] Merged ${Object.keys(serverCache).length} server events for ${bandaiId} (local: ${Object.keys(localCache).length}, merged: ${Object.keys(merged).length})`);
    } catch (e) {
        console.warn('[Cache] Could not pull server cache:', e);
    }
}

function clearCacheForUser(bandaiId) {
    localStorage.removeItem(cacheKey(bandaiId));
}

function updateCacheBar(bandaiId) {
    const cache   = loadCache(bandaiId);
    const count   = Object.keys(cache).length;
    const bar     = document.getElementById('cacheBar');
    const inner   = document.getElementById('cacheBarInner');
    const text    = document.getElementById('cacheBarText');
    bar.style.display = '';
    if (count === 0) {
        inner.className = 'cache-bar';
        text.innerHTML  = 'No cached data yet — first run will fetch everything.';
    } else {
        inner.className = 'cache-bar has-cache';
        text.innerHTML  = `<strong>${count}</strong> events cached locally.`;
    }
}

function confirmClearCache() {
    const idx  = document.getElementById('userSelect').value;
    if (idx === '') return;
    const user = App.usersWithToken[parseInt(idx)];
    if (!confirm(`Clear all cached events for ${user.name}?\nNext run will re-fetch everything from the API.`)) return;
    clearCacheForUser(user.bandaiId);
    updateCacheBar(user.bandaiId);
}

// Called by "Sync new events only" — just runs fetchAndAnalyze (cache is automatic)
function refreshCache() { fetchAndAnalyze(); }

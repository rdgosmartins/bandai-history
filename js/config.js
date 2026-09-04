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

// Puxa o cache de eventos de TODOS os bandaiIds já sincronizados por qualquer
// pessoa do time (endpoint /cache-all) e mescla no localStorage deste navegador.
// Isso é o que faz o Global Rankings (e qualquer outra tela que use loadCache())
// mostrar dados de todo mundo, mesmo em um dispositivo que nunca rodou "Sync All" —
// antes disso, cada navegador só via os players que ELE MESMO tinha sincronizado.
let _allCachePromise = null;
let _cacheStorageWarning = false;
const _memoryCaches = {};
const CACHE_STORAGE_WARNING_TEXT = 'Local storage is full; new cache writes stay in memory until you free space.';

function _persistCacheSnapshot(bandaiId, cache, source) {
    const normalized = normalizeCacheMap(cache);
    try {
        localStorage.setItem(cacheKey(bandaiId), JSON.stringify(normalized));
        delete _memoryCaches[bandaiId];
        if (Object.keys(_memoryCaches).length === 0) _cacheStorageWarning = false;
    } catch (e) {
        _cacheStorageWarning = true;
        _memoryCaches[bandaiId] = normalized;
        console.warn(`[Cache] ${source} localStorage write failed — keeping cache in memory:`, e);
    }
    return normalized;
}

function _loadMemoryCache(bandaiId) {
    return normalizeCacheMap(_memoryCaches[bandaiId] || {});
}

function _cacheWarningHtml() {
    return _cacheStorageWarning
        ? ` <span class="cache-warning">${CACHE_STORAGE_WARNING_TEXT}</span>`
        : '';
}

async function loadAllCachesFromServer({ force = false } = {}) {
    if (_allCachePromise && !force) return _allCachePromise;
    _allCachePromise = (async () => {
        try {
            const r = await apiFetch(`/cache-all`);
            if (!r.ok) return;
            const all = await r.json(); // { bandaiId: { eventId: eventData, ... }, ... }
            for (const [bandaiId, serverCache] of Object.entries(all || {})) {
                if (!serverCache || !Object.keys(serverCache).length) continue;
                const localCache = normalizeCacheMap(loadCache(bandaiId));
                const normalizedServer = normalizeCacheMap(serverCache);
                const merged = {};
                for (const eventId of new Set([...Object.keys(localCache), ...Object.keys(normalizedServer)])) {
                    merged[eventId] = mergeEventRecords(localCache[eventId], normalizedServer[eventId]);
                }
                _persistCacheSnapshot(bandaiId, merged, 'cache-all');
            }
            console.log(`[Cache] cache-all mesclado: ${Object.keys(all || {}).length} jogadores.`);
        } catch (e) {
            console.warn('[Cache] Falha ao carregar /cache-all do servidor:', e);
        }
    })();
    return _allCachePromise;
}

function _toNumber(value) {
    if (value == null || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function _toBool(value) {
    if (value === true || value === 1 || value === '1') return true;
    if (value === false || value === 0 || value === '0') return false;
    const text = String(value ?? '').trim().toLowerCase();
    if (['true', 'win', 'won', 'yes', 'y'].includes(text)) return true;
    if (['false', 'loss', 'lose', 'lost', 'no', 'n'].includes(text)) return false;
    return null;
}

function normalizeRoundRecord(round) {
    if (!round || typeof round !== 'object') return null;
    const opponentUsers = Array.isArray(round.opponent_users)
        ? round.opponent_users
        : round.opponent_users
            ? [round.opponent_users]
            : [];
    return {
        ...round,
        is_win: _toBool(round.is_win ?? round.won ?? round.result ?? round.outcome),
        win_count: _toNumber(round.win_count ?? round.winCount ?? round.game_win_count ?? round.games_won),
        lose_count: _toNumber(round.lose_count ?? round.loseCount ?? round.game_lose_count ?? round.games_lost),
        opponent_users: opponentUsers.map(opp => {
            if (!opp || typeof opp !== 'object') return opp;
            return {
                ...opp,
                membership_number: opp.membership_number ?? opp.member_number ?? opp.member_no ?? opp.player_id ?? opp.bandaiId ?? opp.id ?? null,
                player_name: opp.player_name ?? opp.name ?? opp.nickname ?? opp.user_name ?? null,
            };
        }).filter(Boolean),
    };
}

function normalizeEventRecord(entry) {
    if (!entry || typeof entry !== 'object') return entry;
    const roundCandidates = [entry.rounds, entry.event?.rounds, entry.history?.rounds].filter(Array.isArray);
    let rawRounds = [];
    for (const candidate of roundCandidates) {
        if (candidate.length > rawRounds.length) rawRounds = candidate;
    }
    const rounds = rawRounds.map(normalizeRoundRecord).filter(Boolean);
    return {
        ...entry,
        rounds,
        event: entry.event && typeof entry.event === 'object'
            ? { ...entry.event, rounds: Array.isArray(entry.event.rounds) ? entry.event.rounds.map(normalizeRoundRecord).filter(Boolean) : entry.event.rounds }
            : entry.event,
        history: entry.history && typeof entry.history === 'object'
            ? { ...entry.history, rounds: Array.isArray(entry.history.rounds) ? entry.history.rounds.map(normalizeRoundRecord).filter(Boolean) : entry.history.rounds }
            : entry.history,
    };
}

function normalizeCacheMap(cache) {
    const out = {};
    for (const [eventId, entry] of Object.entries(cache || {})) {
        out[eventId] = normalizeEventRecord(entry);
    }
    return out;
}

function mergeEventRecords(localEntry, serverEntry) {
    const local = normalizeEventRecord(localEntry);
    const server = normalizeEventRecord(serverEntry);
    const merged = { ...local, ...server };
    const localRounds = Array.isArray(local?.rounds) ? local.rounds : [];
    const serverRounds = Array.isArray(server?.rounds) ? server.rounds : [];
    if (serverRounds.length === 0 && localRounds.length > 0) {
        merged.rounds = localRounds;
    } else if (serverRounds.length > 0 && localRounds.length === 0) {
        merged.rounds = serverRounds;
    } else if (serverRounds.length > 0 && localRounds.length > 0) {
        merged.rounds = serverRounds.length >= localRounds.length ? serverRounds : localRounds;
    } else {
        merged.rounds = [];
    }
    return merged;
}

// ── Cache (localStorage, keyed per Bandai ID) ──────────────────────────────

function cacheKey(bandaiId) { return CACHE_PREFIX + bandaiId; }

function loadCache(bandaiId) {
    const memoryCache = _loadMemoryCache(bandaiId);
    try {
        const raw = localStorage.getItem(cacheKey(bandaiId));
        const localCache = raw ? JSON.parse(raw) : {};
        const normalizedLocal = normalizeCacheMap(localCache);
        const normalizedMemory = normalizeCacheMap(memoryCache);

        if (Object.keys(normalizedMemory).length === 0) return normalizedLocal;
        if (Object.keys(normalizedLocal).length === 0) return normalizedMemory;

        const merged = {};
        for (const eventId of new Set([...Object.keys(normalizedLocal), ...Object.keys(normalizedMemory)])) {
            merged[eventId] = mergeEventRecords(normalizedLocal[eventId], normalizedMemory[eventId]);
        }
        return merged;
    } catch {
        return memoryCache;
    }
}

function saveCache(bandaiId, cache) {
    const normalized = _persistCacheSnapshot(bandaiId, cache, 'saveCache');
    // Push to shared KV cache (fire-and-forget — all sessions benefit)
    fetch(`${AUTH_BASE}/cache/${bandaiId}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(normalized),
    }).catch(() => {});
}

// Pulls KV cache for a bandaiId and merges into localStorage.
// Local entries win in case of conflict (most recently fetched device wins).
async function pullServerCache(bandaiId) {
    const ac = new AbortController();
    const t  = setTimeout(() => ac.abort(), 10_000);
    try {
        const r = await apiFetch(`/cache/${bandaiId}`, { signal: ac.signal });
        clearTimeout(t);
        if (!r.ok) return;
        const serverCache = await r.json();
        if (!serverCache || !Object.keys(serverCache).length) return;
        const localCache = loadCache(bandaiId);
        // Prefer the entry that carries more normalized rounds, so partial server
        // payloads do not replace a richer local record with metadata-only data.
        const normalizedLocal = normalizeCacheMap(localCache);
        const normalizedServer = normalizeCacheMap(serverCache);
        const merged = {};
        for (const eventId of new Set([...Object.keys(normalizedLocal), ...Object.keys(normalizedServer)])) {
            merged[eventId] = mergeEventRecords(normalizedLocal[eventId], normalizedServer[eventId]);
        }
        _persistCacheSnapshot(bandaiId, merged, 'pullServerCache');
        console.log(`[Cache] Merged ${Object.keys(serverCache).length} server events for ${bandaiId} (local: ${Object.keys(localCache).length}, merged: ${Object.keys(merged).length})`);
    } catch (e) {
        clearTimeout(t);
        if (e.name !== 'AbortError') console.warn('[Cache] Could not pull server cache:', e);
    }
}

function clearCacheForUser(bandaiId) {
    localStorage.removeItem(cacheKey(bandaiId));
    delete _memoryCaches[bandaiId];
    if (Object.keys(_memoryCaches).length === 0) _cacheStorageWarning = false;
}

function updateCacheBar(bandaiId) {
    const cache   = loadCache(bandaiId);
    const count   = Object.keys(cache).length;
    const bar     = document.getElementById('cacheBar');
    const inner   = document.getElementById('cacheBarInner');
    const text    = document.getElementById('cacheBarText');
    const warning = _cacheWarningHtml();
    bar.style.display = '';
    if (count === 0) {
        inner.className = 'cache-bar';
        text.innerHTML  = `No cached data yet — first run will fetch everything.${warning}`;
    } else {
        inner.className = 'cache-bar has-cache';
        text.innerHTML  = `<strong>${count}</strong> events cached locally.${warning}`;
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

// Leaders locked per user email (lowercase). These users cannot change their favorite leader.
const LOCKED_LEADERS = {
    'paulogabriel8b@gmail.com': 'OP04-040', // Queen — Blue/Yellow
};

const COLOR_MAP = {
    'red':    'pill-red',    'green':  'pill-green',
    'blue':   'pill-blue',   'purple': 'pill-purple',
    'black':  'pill-black',  'yellow': 'pill-yellow',
};

// Nomes de "arco" exibidos no optgroup, só por estética — opcional.
// Sets que não estiverem aqui aparecem com o próprio código (ex: "OP-16").
// Nenhuma entrada aqui é necessária para o funcionamento: cards.json já traz
// automaticamente qualquer set novo (OP16, OP17...) assim que for atualizado.
const SET_STORY_NAMES = {
    'OP01': 'OP-01 · Romance Dawn', 'OP02': 'OP-02 · Paramount War',
    'OP03': 'OP-03 · Pillars of Strength', 'OP04': 'OP-04 · Kingdoms of Intrigue',
    'OP05': 'OP-05 · Awakening of the New Era', 'OP06': 'OP-06 · Wings of the Captain',
    'OP07': 'OP-07 · 500 Years in the Future', 'OP08': 'OP-08 · Two Legends',
    'OP09': 'OP-09 · Emperors in the New World', 'OP10': 'OP-10 · Royal Blood',
    'OP11': 'OP-11 · A Fist of Divine Speed', 'OP12': 'OP-12 · Legacy of the Master',
    'OP13': 'OP-13 · Carrying On His Will', 'OP14': "OP-14 · The Azure Sea's Seven",
    'OP15': "OP-15 · Adventure on KAMI's Island",
    'OP16': 'OP-16 · The Time of Battle',
    'EB01': 'EB-01 · Memorial Collection', 'EB02': 'EB-02 · Anime 25th Collection',
    'EB03': 'EB-03 · One Piece Heroines Edition', 'EB04': 'EB-04 · Egghead Crisis',
    'ST':   'ST · Starter Decks',
};

function _setPrefixFromId(id) {
    const m = /^([A-Za-z]+\d+)-/.exec(id || '');
    return m ? m[1] : (id || '');
}

function _setSortKey(prefix) {
    const m = /^([A-Za-z]+)(\d+)$/.exec(prefix || '');
    return m ? [m[1], parseInt(m[2], 10)] : [prefix || '', 0];
}

function _compareSetPrefixes(a, b) {
    const [famA, numA] = _setSortKey(a), [famB, numB] = _setSortKey(b);
    if (famA !== famB) return famA.localeCompare(famB);
    return numA - numB;
}

// Popula o <select id="favoriteDeck"> a partir de /cards.json (mesma base local
// usada pelo OPTCG Agent e Deck Mapping). Sets novos aparecem automaticamente.
async function populateFavoriteDeckOptions() {
    const sel = document.getElementById('favoriteDeck');
    if (!sel) return;
    try {
        const r = await fetch('/cards.json');
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const all = await r.json();
        const leaders = all.filter(c => c.t === 'Leader');

        const groups = new Map(); // prefix -> [{id, name, color}]
        for (const c of leaders) {
            const prefix = _setPrefixFromId(c.id);
            const groupKey = prefix.startsWith('ST') ? 'ST' : prefix;
            if (!groups.has(groupKey)) groups.set(groupKey, []);
            groups.get(groupKey).push({
                id: c.id,
                name: (c.n || c.id).replace(/\s*\(\d+\)\s*$/, ''),
                color: c.c || '',
            });
        }

        const orderedKeys = [...groups.keys()].sort((a, b) => {
            // ST sempre por último, os demais em ordem cronológica pelo código
            if (a === 'ST' && b !== 'ST') return 1;
            if (b === 'ST' && a !== 'ST') return -1;
            return _compareSetPrefixes(a, b);
        });

        let html = '<option value="">— Select a leader —</option>';
        for (const key of orderedKeys) {
            const label = SET_STORY_NAMES[key] || key.replace(/^([A-Za-z]+)(\d+)$/, '$1-$2');
            const opts = groups.get(key)
                .sort((a, b) => a.id.localeCompare(b.id))
                .map(l => `<option value="${l.id}">${l.name} — ${l.id}${l.color ? ` (${l.color})` : ''}</option>`)
                .join('');
            html += `<optgroup label="${label}">${opts}</optgroup>`;
        }
        sel.innerHTML = html;
    } catch (e) {
        console.warn('[Profile] Falha ao carregar líderes de /cards.json', e);
    }
}

function onLeaderChange(id) {
    const img     = document.getElementById('leaderImg');
    const ph      = document.getElementById('leaderPlaceholder');
    const nameBadge = document.getElementById('leaderNameBadge');
    const idBadge   = document.getElementById('leaderIdBadge');
    const pills     = document.getElementById('leaderColorPills');

    if (!id) {
        img.style.display = 'none'; ph.style.display = '';
        nameBadge.textContent = '—'; idBadge.style.display = 'none'; pills.innerHTML = '';
        return;
    }

    // Extract name and colors from the selected option text
    const sel = document.getElementById('favoriteDeck');
    const optText = sel.options[sel.selectedIndex].text; // e.g. "Roronoa Zoro — OP01-001 (Red)"
    const nameMatch = optText.match(/^(.+?)\s+—/);
    const colorMatch = optText.match(/\(([^)]+)\)$/);
    const name = nameMatch ? nameMatch[1] : id;
    const colors = colorMatch ? colorMatch[1].split('/') : [];

    nameBadge.textContent = name;
    idBadge.textContent = id; idBadge.style.display = 'inline-block';
    pills.innerHTML = colors.map(c =>
        `<span class="color-pill ${COLOR_MAP[c.toLowerCase().trim()] || ''}">${c.trim()}</span>`
    ).join('');

    ph.style.display = 'none';
    img.style.display = 'block';
    img.style.cssText = 'width:120px;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.18);margin:0 auto .75rem;display:block;opacity:0;transition:opacity .3s;';
    img.src = `https://optcgapi.com/media/static/Card_Images/${id}.jpg`;
    img.onload  = () => { img.style.opacity = '1'; };
    img.onerror = () => { img.style.display = 'none'; ph.style.display = ''; };
}

let _lockedDeck    = null; // set during init, used in saveProfile()
let _avatarCustom  = null; // base64 data URL of uploaded avatar (null = unchanged)
let _isViewMode    = false;

function setAvatarDisplay(src, initials) {
    const ring = document.getElementById('avatarRing');
    const ini  = document.getElementById('avatarInitials');
    if (src) {
        ini.innerHTML = `<img src="${src}" alt="" style="width:80px;height:80px;border-radius:50%;object-fit:cover;">`;
    } else {
        ini.textContent = initials || '?';
    }
}

function onAvatarFile(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
        const img = new Image();
        img.onload = () => {
            const SIZE = 200;
            const canvas = document.createElement('canvas');
            canvas.width = SIZE; canvas.height = SIZE;
            const ctx = canvas.getContext('2d');
            // Center-crop to square
            const min = Math.min(img.width, img.height);
            const sx  = (img.width  - min) / 2;
            const sy  = (img.height - min) / 2;
            ctx.drawImage(img, sx, sy, min, min, 0, 0, SIZE, SIZE);
            _avatarCustom = canvas.toDataURL('image/jpeg', 0.78);
            setAvatarDisplay(_avatarCustom, null);
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
    // Reset input so same file can be picked again
    event.target.value = '';
}

(async () => {
    await populateFavoriteDeckOptions();
    const user = await requireAuth();
    if (!user) return;

    // Check view mode (?view=BandaiName)
    const viewName = new URLSearchParams(window.location.search).get('view');
    _isViewMode = !!viewName;

    if (_isViewMode) {
        document.querySelector('main').classList.add('view-mode');
        document.querySelector('.pg-header h1').textContent = viewName + "'s Profile";
        document.getElementById('avatarFileInput').disabled = true;
        document.getElementById('avatarRingLabel').style.pointerEvents = 'none';
        document.getElementById('avatarRingLabel').style.cursor = 'default';
    }

    // Locked leader by email (only applies in edit mode)
    _lockedDeck = _isViewMode ? null : (LOCKED_LEADERS[(user.email || '').toLowerCase()] || null);

    const url = _isViewMode
        ? AUTH_BASE + '/profile/by-name/' + encodeURIComponent(viewName)
        : AUTH_BASE + '/my-profile';

    try {
        const r = await fetch(url, { credentials: 'include' });
        if (!r.ok) return;
        const data = await r.json();
        const p = _isViewMode ? data : (data.profile || {});

        const displayName = _isViewMode ? (p.displayName || viewName) : (p.displayName || user.displayName || '');
        const email       = _isViewMode ? '' : (user.email || '');
        const avatarSrc   = _isViewMode ? p.avatarUrl : (p.avatarCustom || user.avatarUrl || null);
        const initials    = displayName.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase() || '?';

        setAvatarDisplay(avatarSrc, initials);
        document.getElementById('avatarName').textContent  = displayName || '—';
        document.getElementById('avatarEmail').textContent = email;

        if (!_isViewMode) document.getElementById('displayName').value = displayName;
        document.getElementById('age').value          = p.age          || '';
        document.getElementById('city').value         = p.city         || '';
        document.getElementById('bio').value          = p.bio          || '';
        document.getElementById('bandaiName').value   = p.bandaiName   || '';
        document.getElementById('yearsPlaying').value = p.yearsPlaying || '';
        document.getElementById('playstyle').value    = p.playstyle    || '';
        document.getElementById('instagram').value    = p.instagram    || '';
        document.getElementById('twitter').value      = p.twitter      || '';
        document.getElementById('discord').value      = p.discord      || '';
        document.getElementById('whatsapp').value     = p.whatsapp     || '';
        document.getElementById('youtube').value      = p.youtube      || '';
        document.getElementById('twitch').value       = p.twitch       || '';

        const lockedDeck = _lockedDeck;
        const deckValue  = lockedDeck || p.favoriteDeck || '';
        if (deckValue) {
            document.getElementById('favoriteDeck').value = deckValue;
            onLeaderChange(deckValue);
        }
        if (lockedDeck) {
            const sel = document.getElementById('favoriteDeck');
            sel.disabled = true;
            sel.title = 'Your favorite leader is set by the team and cannot be changed.';
        }

        // Badges (only in view mode — data comes from /profile/by-name which includes badges)
        if (_isViewMode && p.badges && p.badges.length) {
            const section = document.getElementById('badgesSection');
            const grid    = document.getElementById('badgeGrid');
            grid.innerHTML = p.badges.map(b => `
                <div class="badge-card ${b.type}">
                    <span class="badge-icon">${b.icon}</span>
                    <div class="badge-info">
                        <span class="badge-label">${b.label}</span>
                        <span class="badge-stat">${b.stat}</span>
                    </div>
                </div>`).join('');
            section.style.display = 'block';
        }

        // In view mode, hide builder actions and load match history
        if (_isViewMode) {
            const dbSaved = document.getElementById('dbSavedSection');
            if (dbSaved) dbSaved.style.display = 'none';
            loadPublicMatches(viewName);
        }
    } catch(e) {}
})();
// ── Profile Tab switcher ─────────────────────────────────────────────────────
function switchProfileTab(tab) {
    document.querySelectorAll('.profile-tab').forEach((b, i) => {
        b.classList.toggle('active', (i === 0 && tab === 'profile') || (i === 1 && tab === 'decks'));
    });
    document.getElementById('tabProfile').classList.toggle('active', tab === 'profile');
    document.getElementById('tabDecks').classList.toggle('active', tab === 'decks');
    if (tab === 'decks' && !_isViewMode && !_dbLoaded) dbInitBuilder();
    if (tab === 'decks' && _isViewMode && !_dbViewLoaded) dbLoadPublic();
}

// ── Deck Builder ─────────────────────────────────────────────────────────────
// Route all optcgapi calls through our CF Worker proxy (avoids browser CORS block)
function optcgFetch(subpath, qs) {
    const params = new URLSearchParams({ path: subpath });
    if (qs) params.set('qs', qs);
    return fetch(AUTH_BASE + '/optcg-proxy?' + params, { credentials: 'include' })
        .then(r => r.ok ? r.json() : Promise.reject(r));
}
const COLOR_ORDER = ['Red','Green','Blue','Purple','Black','Yellow'];

let _dbLoaded     = false;   // init done
let _dbViewLoaded = false;
let _dbDecks      = [];      // all user decks from server
let _dbCurrentId  = null;    // deck being edited
let _dbLeader     = null;    // { id, name, colors, image }
let _dbCards      = [];      // [{ id, name, image, qty, color, type }]
let _dbSearchTimer = null;

// Initialise builder: populate leader grid + load sets + user decks
async function dbInitBuilder() {
    _dbLoaded = true;
    // Populate leader grid from the existing <select id="favoriteDeck"> options
    dbPopulateLeaderGrid();
    // Load sets for the filter dropdown via proxy
    try {
        const sets = await optcgFetch('allSets');
        if (Array.isArray(sets)) {
            const sel = document.getElementById('dbSearchSet');
            sets.forEach(s => {
                const opt = document.createElement('option');
                opt.value = s.set_id;
                opt.textContent = `${s.set_id} · ${s.set_name}`;
                sel.appendChild(opt);
            });
        }
    } catch {}
    // Load user decks
    await dbLoadDecks();
}

// Build leader grid from the TCG-Info dropdown (same source as Favorite Leader section)
function dbPopulateLeaderGrid(filter) {
    const grid = document.getElementById('dbLeaderGrid');
    const sel  = document.getElementById('favoriteDeck');
    if (!sel) { grid.innerHTML = '<div class="db-empty-msg">Leader list unavailable.</div>'; return; }

    const q = (filter || '').toLowerCase();
    const leaders = [];
    for (const opt of sel.options) {
        if (!opt.value) continue;
        const text = opt.text; // e.g. "Roronoa Zoro — OP01-001 (Red)"
        const nameMatch  = text.match(/^(.+?)\s+—/);
        const colorMatch = text.match(/\(([^)]+)\)$/);
        const name   = nameMatch  ? nameMatch[1].trim()  : opt.value;
        const colors = colorMatch ? colorMatch[1].split('/').map(c => c.trim()) : [];
        if (q && !name.toLowerCase().includes(q) && !opt.value.toLowerCase().includes(q)) continue;
        leaders.push({ id: opt.value, name, colors });
    }

    if (!leaders.length) {
        grid.innerHTML = '<div class="db-empty-msg">No leaders found.</div>';
        return;
    }
    grid.innerHTML = '';
    leaders.forEach(l => {
        const isSelected = _dbLeader?.id === l.id;
        const div = document.createElement('div');
        div.className = 'db-card leader-card-thumb' + (isSelected ? ' selected' : '');
        div.title = `${l.name} (${l.colors.join('/')})`;
        div.innerHTML = `<img src="https://optcgapi.com/media/static/Card_Images/${l.id}.jpg" alt="${_esc(l.name)}" loading="lazy" onerror="this.closest('.db-card').style.display='none'">`
            + (isSelected ? `<span class="db-card-qty">✓</span>` : '');
        div.onclick = () => dbSetLeader({ card_image_id: l.id, card_name: l.name, card_color: l.colors.join('/'), card_image: `https://optcgapi.com/media/static/Card_Images/${l.id}.jpg` });
        grid.appendChild(div);
    });
}

async function dbLoadDecks() {
    try {
        const r = await fetch(AUTH_BASE + '/decks', { credentials: 'include' });
        if (!r.ok) return;
        _dbDecks = await r.json();
    } catch { _dbDecks = []; }
    dbRenderSavedList();
}

function dbRenderSavedList() {
    const list = document.getElementById('dbSavedList');
    const none = document.getElementById('dbNoDecks');
    if (!_dbDecks.length) {
        none.style.display = '';
        list.innerHTML = '';
        list.appendChild(none);
        return;
    }
    none.style.display = 'none';
    list.innerHTML = _dbDecks.map(d => {
        const leaderId = d.leader?.id || '';
        const imgSrc = leaderId ? `https://optcgapi.com/media/static/Card_Images/${leaderId}.jpg` : '';
        const total = (d.cards || []).reduce((s,c) => s + (c.qty||1), 0) + (d.leader ? 1 : 0);
        return `<div class="db-saved-item ${d.id === _dbCurrentId ? 'active' : ''}" onclick="dbEditDeck('${d.id}')">
            ${imgSrc ? `<img src="${imgSrc}" alt="" onerror="this.style.display='none'">` : ''}
            <span class="db-saved-name">${_esc(d.name)}</span>
            <span class="db-saved-count">${total}/51 · ${d.isPublic ? '🌐' : '🔒'}</span>
            <button class="db-saved-del" onclick="event.stopPropagation();dbDeleteDeck('${d.id}')" title="Delete">🗑</button>
        </div>`;
    }).join('');
}

function dbNewDeck() {
    _dbCurrentId = null;
    _dbLeader = null;
    _dbCards = [];
    document.getElementById('dbDeckName').value = '';
    document.getElementById('dbLeaderSearchName').value = '';
    dbPopulateLeaderGrid();
    document.getElementById('dbArticle').innerHTML = '';
    document.getElementById('dbIsPublic').checked = false;
    document.getElementById('dbBuilder').style.display = '';
    dbRenderLeaderSlot();
    dbRenderDeckList();
    dbUpdateCount();
    dbRenderSavedList();
    // Switch to decks tab if not already
    switchProfileTab('decks');
}

function dbEditDeck(id) {
    const deck = _dbDecks.find(d => d.id === id);
    if (!deck) return;
    _dbCurrentId = id;
    _dbLeader = deck.leader || null;
    _dbCards = JSON.parse(JSON.stringify(deck.cards || []));
    document.getElementById('dbDeckName').value = deck.name || '';
    document.getElementById('dbArticle').innerHTML = deck.article || '';
    document.getElementById('dbIsPublic').checked = !!deck.isPublic;
    document.getElementById('dbBuilder').style.display = '';
    dbRenderLeaderSlot();
    dbRenderDeckList();
    dbUpdateCount();
    dbRenderSavedList();
}

async function dbDeleteDeck(id) {
    if (!confirm('Delete this deck?')) return;
    try {
        await fetch(AUTH_BASE + '/decks/' + id, { method: 'DELETE', credentials: 'include' });
    } catch {}
    if (_dbCurrentId === id) {
        _dbCurrentId = null; _dbLeader = null; _dbCards = [];
        document.getElementById('dbBuilder').style.display = 'none';
    }
    await dbLoadDecks();
}

// ── Leader search (client-side filter from existing leader dropdown) ──────────
let _dbLeaderTimer = null;

function dbLeaderSearchDebounce() {
    clearTimeout(_dbLeaderTimer);
    _dbLeaderTimer = setTimeout(dbLeaderSearch, 200);
}

function dbLeaderSearch() {
    const q = document.getElementById('dbLeaderSearchName').value.trim();
    dbPopulateLeaderGrid(q);
}

function dbSetLeader(card) {
    const id = card.card_image_id || card.card_set_id;
    const colors = (card.card_color || '').split('/').map(c => c.trim()).filter(Boolean);
    _dbLeader = { id, name: card.card_name, colors, image: card.card_image };
    dbRenderLeaderSlot();
    dbUpdateCount();
    // Refresh grid to show/remove checkmark
    dbPopulateLeaderGrid(document.getElementById('dbLeaderSearchName').value.trim());
    // Reaplica a busca já restrita às cores do novo líder — sem isso, resultados
    // de cores incompatíveis podiam ficar visíveis na grid até a próxima busca manual.
    dbSearch();
}

// ── Pill toggle ───────────────────────────────────────────────────────────────
function dbTogglePill(btn) {
    btn.classList.toggle('active');
    dbSearchDebounce();
}

function dbGetSelectedPills(kind) {
    return [...document.querySelectorAll(`.db-filter-pill[data-kind="${kind}"].active`)]
        .map(b => b.dataset.val);
}

// ── Card search ───────────────────────────────────────────────────────────────
function dbSearchDebounce() {
    clearTimeout(_dbSearchTimer);
    _dbSearchTimer = setTimeout(dbSearch, 450);
}

async function dbSearch() {
    const name   = document.getElementById('dbSearchName').value.trim();
    const pillColors = dbGetSelectedPills('color');
    const types  = dbGetSelectedPills('type');
    const set    = document.getElementById('dbSearchSet').value;

    // Se há um líder selecionado, a busca fica restrita às cores dele —
    // a menos que o usuário tenha marcado manualmente algum pill de cor,
    // que aí funciona como um refinamento dentro dessa restrição.
    const leaderColors = _dbLeader ? _dbLeader.colors.map(c => c.toLowerCase()) : [];
    const colors = pillColors.length ? pillColors : leaderColors;

    if (!name && !colors.length && !types.length && !set) {
        document.getElementById('dbCardGrid').innerHTML = '<div class="db-empty-msg">Search by name or select color/type filters.</div>';
        return;
    }

    const grid = document.getElementById('dbCardGrid');
    grid.innerHTML = '<div class="db-loading-msg">Loading…</div>';

    // Build one request per (color × type) combination
    // Empty arrays mean "no filter for that dimension" → use [''] as placeholder
    const colorList = colors.length ? colors : [''];
    const typeList  = types.length  ? types  : [''];

    // One proxy call per (color × type) combination — run in parallel
    const calls = [];
    for (const color of colorList) {
        for (const type of typeList) {
            if (!name && !color && !type && !set) continue;
            const qs = new URLSearchParams();
            if (name)  qs.set('card_name',  name);
            if (color) qs.set('card_color', color);
            if (type)  qs.set('card_type',  type);
            if (set)   qs.set('set_id',     set);
            calls.push(optcgFetch('sets/filtered', qs.toString()).catch(() => []));
        }
    }

    try {
        const results  = await Promise.all(calls);
        const allCards = results.flat();
        if (!allCards.length || allCards[0]?.error) {
            grid.innerHTML = '<div class="db-empty-msg">No cards found.</div>';
            return;
        }
        // Deduplicate: keep base art only (drop parallels)
        const seen = new Set();
        const unique = allCards.filter(c => {
            const baseId = (c.card_image_id || c.card_set_id || '').replace(/_p\d+$/, '');
            if (seen.has(baseId)) return false;
            seen.add(baseId); return true;
        });
        dbRenderCardGrid(unique, leaderColors);
    } catch {
        grid.innerHTML = '<div class="db-empty-msg">Error loading cards. Try again.</div>';
    }
}

function dbRenderCardGrid(cards, leaderColors = []) {
    const grid = document.getElementById('dbCardGrid');
    grid.innerHTML = '';
    // Filter out Leaders from the card grid — leaders are handled separately
    let nonLeaders = cards.filter(c => (c.card_type || '').toLowerCase() !== 'leader');
    // Segurança extra: mesmo que a API retorne algo fora do filtro de cor
    // (ou o parâmetro de cor não seja respeitado do outro lado), garantimos
    // aqui no cliente que só cartas compatíveis com o líder aparecem.
    if (leaderColors.length) {
        nonLeaders = nonLeaders.filter(c => {
            const cardColors = (c.card_color || '').split('/').map(s => s.trim().toLowerCase());
            return cardColors.some(cc => leaderColors.includes(cc));
        });
    }
    if (!nonLeaders.length) {
        grid.innerHTML = '<div class="db-empty-msg">No cards found.<br><small>Leaders are searched in the section above.</small></div>';
        return;
    }
    nonLeaders.forEach(card => {
        const id  = card.card_image_id || card.card_set_id;
        const qty = _dbCards.find(c => c.id === id)?.qty || 0;
        const maxed = qty >= 4;
        const div = document.createElement('div');
        div.className = 'db-card' + (maxed ? ' maxed' : '');
        div.title = card.card_name;
        div.innerHTML = `<img src="${card.card_image}" alt="${_esc(card.card_name)}" loading="lazy">`
            + (qty > 0 ? `<span class="db-card-qty">x${qty}</span>` : '');
        div.onclick = () => dbAddCard(card);
        grid.appendChild(div);
    });
}

function dbAddCard(card) {
    const id = card.card_image_id || card.card_set_id;

    // Enforce color rules if leader is set
    if (_dbLeader) {
        const leaderColors = _dbLeader.colors.map(c => c.toLowerCase());
        const cardColors = (card.card_color || '').split('/').map(c => c.trim().toLowerCase());
        const allowed = cardColors.some(cc => leaderColors.includes(cc));
        if (!allowed) {
            dbSetStatus(`⚠ ${card.card_name} colors (${card.card_color}) don't match leader (${_dbLeader.colors.join('/')})`, 'err');
            setTimeout(() => dbSetStatus('', ''), 2500);
            return;
        }
    }

    const existing = _dbCards.find(c => c.id === id);
    if (existing) {
        if (existing.qty >= 4) return;
        existing.qty++;
    } else {
        _dbCards.push({ id, name: card.card_name, image: card.card_image, qty: 1, color: card.card_color, type: card.card_type });
    }
    dbRenderDeckList();
    dbUpdateCount();
    dbSearch(); // refresh grid qty badges
}

function dbChangeQty(id, delta) {
    const idx = _dbCards.findIndex(c => c.id === id);
    if (idx === -1) return;
    _dbCards[idx].qty = Math.max(0, Math.min(4, _dbCards[idx].qty + delta));
    if (_dbCards[idx].qty === 0) _dbCards.splice(idx, 1);
    dbRenderDeckList();
    dbUpdateCount();
}

function dbRenderLeaderSlot() {
    const slot = document.getElementById('dbLeaderSlot');
    if (!_dbLeader) {
        slot.className = 'db-leader-empty';
        slot.innerHTML = 'No leader selected — search for a Leader card and click it.';
        document.getElementById('dbLeaderColors').innerHTML = '';
        return;
    }
    slot.className = 'db-leader-slot';
    const colorHtml = _dbLeader.colors.map(c =>
        `<span class="color-pill ${COLOR_MAP[c.toLowerCase()] || ''}">${c}</span>`
    ).join('');
    slot.innerHTML = `<img src="${_dbLeader.image}" alt="" onerror="this.style.display='none'">
        <div class="db-leader-info">
            <div class="db-leader-name">${_esc(_dbLeader.name)}</div>
            <div class="db-leader-sub">${_esc(_dbLeader.id)}</div>
        </div>
        <button class="db-leader-clear" onclick="dbClearLeader()" title="Remove leader">&#10005;</button>`;
    document.getElementById('dbLeaderColors').innerHTML = colorHtml;
}

function dbClearLeader() {
    _dbLeader = null;
    dbRenderLeaderSlot();
    dbUpdateCount();
    dbPopulateLeaderGrid(document.getElementById('dbLeaderSearchName').value.trim());
    dbSearch();
}

function dbRenderDeckList() {
    const list = document.getElementById('dbDeckList');
    if (!_dbCards.length) {
        list.innerHTML = '<div class="db-deck-empty">Your deck is empty.</div>';
        return;
    }
    list.innerHTML = _dbCards.map(c => `
        <div class="db-deck-row">
            <img src="${c.image}" alt="" onerror="this.style.display='none'">
            <span class="db-deck-row-name" title="${_esc(c.name)}">${_esc(c.name)}</span>
            <div class="db-deck-row-qty">
                <button class="db-qty-btn" onclick="dbChangeQty('${c.id}',-1)">−</button>
                <span class="db-qty-num">${c.qty}</span>
                <button class="db-qty-btn" onclick="dbChangeQty('${c.id}',1)" ${c.qty>=4?'disabled':''}>+</button>
            </div>
        </div>`).join('');
}

function dbUpdateCount() {
    const total = _dbCards.reduce((s,c) => s + c.qty, 0) + (_dbLeader ? 1 : 0);
    const badge = document.getElementById('dbDeckCount');
    badge.textContent = total;
    badge.className = 'db-count-badge' + (total > 51 ? ' over' : '');
}

function dbSetStatus(msg, cls) {
    const el = document.getElementById('dbSaveStatus');
    el.textContent = msg; el.className = 'db-save-status ' + (cls || '');
}

async function dbSaveDeck() {
    const name = document.getElementById('dbDeckName').value.trim();
    if (!name) { dbSetStatus('Please enter a deck name.', 'err'); return; }
    if (!_dbLeader) { dbSetStatus('Please select a leader first.', 'err'); return; }
    const total = _dbCards.reduce((s,c) => s+c.qty, 0) + 1;
    if (total !== 51) { dbSetStatus(`Deck must have exactly 51 cards (1 leader + 50). Currently: ${total}.`, 'err'); return; }

    document.getElementById('dbSaveBtn').disabled = true;
    dbSetStatus('Saving…', '');

    const payload = {
        name,
        leader: _dbLeader,
        cards: _dbCards,
        article: document.getElementById('dbArticle').innerHTML,
        isPublic: document.getElementById('dbIsPublic').checked,
    };

    try {
        const url = _dbCurrentId
            ? AUTH_BASE + '/decks/' + _dbCurrentId
            : AUTH_BASE + '/decks';
        const r = await fetch(url, {
            method: _dbCurrentId ? 'PUT' : 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!r.ok) throw new Error((await r.json().catch(()=>({}))).error || r.status);
        const saved = await r.json();
        if (!_dbCurrentId) _dbCurrentId = saved.id;
        dbSetStatus('Deck saved!', 'ok');
        await dbLoadDecks();
    } catch(e) {
        dbSetStatus('Error: ' + e.message, 'err');
    } finally {
        document.getElementById('dbSaveBtn').disabled = false;
        setTimeout(() => dbSetStatus('', ''), 4000);
    }
}

function dbExec(cmd, val) {
    document.getElementById('dbArticle').focus();
    document.execCommand(cmd, false, val || null);
}

function _esc(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── View mode: match history ─────────────────────────────────────────────────
async function loadPublicMatches(viewName) {
    const section = document.getElementById('matchHistorySection');
    const listEl  = document.getElementById('matchHistoryList');
    if (!section || !listEl) return;
    section.style.display = 'block';
    try {
        const r = await fetch(AUTH_BASE + '/matches-by-name/' + encodeURIComponent(viewName), { credentials: 'include' });
        if (!r.ok) { listEl.innerHTML = ''; section.style.display = 'none'; return; }
        const matches = await r.json();
        if (!matches.length) { listEl.innerHTML = '<p style="color:var(--muted);text-align:center;padding:1rem 0;font-size:.88rem;">No matches logged yet.</p>'; return; }
        listEl.innerHTML = matches.slice(0, 20).map(m => {
            const { w, l } = _mlScoreProfile(m.rounds);
            const scoreColor = w > l ? '#28a745' : (l > w ? '#dc3545' : '#6c757d');
            const imgSrc = m.leaderId ? `https://optcgapi.com/media/static/Card_Images/${m.leaderId}.jpg` : '';
            const tags = [
                m.set  ? `<span class="pm-badge yonkou" style="font-size:.68rem;">${m.set}</span>`  : '',
                m.type ? `<span class="pm-badge shichi" style="font-size:.68rem;">${m.type}</span>` : '',
            ].filter(Boolean).join(' ');
            const roundRows = m.rounds.slice(0, 8).map((r2, i) => {
                if (r2.type === 'bye') return `<span style="font-size:.72rem;color:var(--muted);">R${i+1}:BYE</span>`;
                const icon = r2.won === true ? '✅' : (r2.won === false ? '❌' : '—');
                return `<span style="font-size:.8rem;" title="Round ${i+1}">${icon}</span>`;
            }).join(' ');
            return `<div style="display:flex;gap:.75rem;align-items:center;padding:.6rem 0;border-bottom:1px solid var(--border,#dee2e6);">
                ${imgSrc ? `<img src="${imgSrc}" style="width:40px;height:40px;object-fit:cover;border-radius:5px;flex-shrink:0;" onerror="this.style.display='none'">` : ''}
                <div style="flex:1;min-width:0;">
                    <div style="font-weight:600;font-size:.88rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${_esc(m.name)}</div>
                    <div style="font-size:.74rem;color:var(--muted);">${m.date} ${tags}</div>
                    <div style="margin-top:.2rem;">${roundRows}</div>
                </div>
                <span style="font-weight:700;font-size:.9rem;color:${scoreColor};flex-shrink:0;">${w}–${l}</span>
            </div>`;
        }).join('');
    } catch { section.style.display = 'none'; }
}
function _mlScoreProfile(rounds) {
    let w = 0, l = 0;
    for (const r of (rounds || [])) { if (r.won === true) w++; else if (r.won === false) l++; }
    return { w, l };
}

// ── View mode: public decks ───────────────────────────────────────────────────
async function dbLoadPublic() {
    _dbViewLoaded = true;
    const viewName = new URLSearchParams(window.location.search).get('view');
    if (!viewName) return;
    try {
        const r = await fetch(AUTH_BASE + '/decks/public/' + encodeURIComponent(viewName), { credentials: 'include' });
        if (!r.ok) return;
        const decks = await r.json();
        const section = document.getElementById('dbPublicSection');
        const list = document.getElementById('dbPublicList');
        if (!decks.length) {
            list.innerHTML = '<div class="db-empty-msg">No public decks yet.</div>';
        } else {
            list.innerHTML = decks.map(d => {
                const leaderId = d.leader?.id || '';
                const colors = (d.leader?.colors || []).map(c =>
                    `<span class="color-pill ${COLOR_MAP[c.toLowerCase()]||''}">${c}</span>`
                ).join('');
                const total = (d.cards||[]).reduce((s,c)=>s+c.qty,0) + (d.leader?1:0);
                const excerpt = d.article ? d.article.replace(/<[^>]*>/g,'').slice(0,120) : '';
                return `<div class="deck-card-item" onclick='openDeckModal(${JSON.stringify(d)})'>
                    <div class="deck-card-inner">
                        <div class="deck-card-leader">
                            ${leaderId ? `<img src="https://optcgapi.com/media/static/Card_Images/${leaderId}.jpg" alt="" onerror="this.style.display='none'">` : ''}
                        </div>
                        <div class="deck-card-body">
                            <div class="deck-card-name">${_esc(d.name)}</div>
                            <div class="deck-card-meta">
                                <span>${total}/51 cards</span>
                                <span>${_esc(d.leader?.name || '')}</span>
                            </div>
                            <div class="deck-card-colors">${colors}</div>
                            ${excerpt ? `<div class="deck-card-excerpt">${_esc(excerpt)}</div>` : ''}
                        </div>
                    </div>
                </div>`;
            }).join('');
        }
        section.style.display = 'block';
        document.getElementById('dbSavedSection').style.display = 'none';
        document.getElementById('dbBuilder').style.display = 'none';
    } catch {}
}

function openDeckModal(deck) {
    const leaderId = deck.leader?.id || '';
    const colors = (deck.leader?.colors || []).map(c =>
        `<span class="color-pill ${COLOR_MAP[c.toLowerCase()]||''}">${c}</span>`
    ).join('');
    const total = (deck.cards||[]).reduce((s,c)=>s+c.qty,0) + (deck.leader?1:0);

    document.getElementById('dmLeaderImg').src = leaderId
        ? `https://optcgapi.com/media/static/Card_Images/${leaderId}.jpg` : '';
    document.getElementById('dmDeckName').textContent = deck.name;
    document.getElementById('dmDeckSub').textContent = `${total}/51 cards · ${deck.leader?.name||''}`;
    document.getElementById('dmColors').innerHTML = colors;

    // Card grid: leader first, then rest
    const allCards = [];
    if (deck.leader) allCards.push({ id: deck.leader.id, image: deck.leader.image || `https://optcgapi.com/media/static/Card_Images/${deck.leader.id}.jpg`, qty: 1, isLeader: true });
    (deck.cards||[]).forEach(c => allCards.push(c));
    document.getElementById('dmCardGrid').innerHTML = allCards.map(c => `
        <div class="deck-modal-card">
            <img src="${c.image || `https://optcgapi.com/media/static/Card_Images/${c.id}.jpg`}" alt="" loading="lazy" onerror="this.style.display='none'">
            <span class="deck-modal-card-qty">${c.isLeader ? 'L' : 'x'+c.qty}</span>
        </div>`).join('');

    const art = document.getElementById('dmArticle');
    if (deck.article && deck.article.trim()) {
        art.style.display = '';
        art.innerHTML = '<h2>About this deck</h2>' + deck.article;
    } else {
        art.style.display = 'none';
    }

    document.getElementById('deckViewModal').style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

function closeDeckModal() {
    document.getElementById('deckViewModal').style.display = 'none';
    document.body.style.overflow = '';
}

async function saveProfile() {
    const btn = document.getElementById('saveBtn');
    const status = document.getElementById('saveStatus');
    btn.disabled = true;
    status.textContent = 'Saving…'; status.className = 'save-status wait';

    const bandaiName  = document.getElementById('bandaiName').value.trim();
    const payload = {
        displayName:  document.getElementById('displayName').value.trim(),
        age:          document.getElementById('age').value,
        city:         document.getElementById('city').value.trim(),
        bio:          document.getElementById('bio').value.trim(),
        bandaiName,
        favoriteDeck: _lockedDeck || document.getElementById('favoriteDeck').value,
        playstyle:    document.getElementById('playstyle').value.trim(),
        yearsPlaying: document.getElementById('yearsPlaying').value,
        instagram:    document.getElementById('instagram').value.trim(),
        twitter:      document.getElementById('twitter').value.trim(),
        discord:      document.getElementById('discord').value.trim(),
        whatsapp:     document.getElementById('whatsapp').value.trim(),
        youtube:      document.getElementById('youtube').value.trim(),
        twitch:       document.getElementById('twitch').value.trim(),
    };
    // Only send avatarCustom when explicitly changed this session
    // (null = unchanged — omitting it prevents the worker from deleting the saved photo)
    if (_avatarCustom !== null) payload.avatarCustom = _avatarCustom;

    try {
        const r = await fetch(`${AUTH_BASE}/my-profile`, {
            method: 'PUT', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (r.ok) {
            status.textContent = 'Changes saved!'; status.className = 'save-status ok';
            if (_avatarCustom) _avatarCustom = null; // committed — no longer "pending"
            if (payload.displayName) {
                document.getElementById('avatarName').textContent = payload.displayName;
            }
        } else {
            const err = await r.json().catch(()=>({}));
            status.textContent = 'Error: ' + (err.error || r.status); status.className = 'save-status err';
        }
    } catch(e) {
        status.textContent = 'Network error.'; status.className = 'save-status err';
    } finally {
        btn.disabled = false;
        setTimeout(() => { status.textContent = ''; status.className = 'save-status'; }, 4000);
    }
}

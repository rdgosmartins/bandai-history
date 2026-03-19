// ── Global Rankings ────────────────────────────────────────────────────────

function switchTab(tab) {
    document.getElementById('results').style.display      = tab === 'my-stats' ? '' : 'none';
    document.getElementById('rankingsTab').style.display  = tab === 'rankings' ? '' : 'none';
    document.getElementById('profileTab').style.display   = tab === 'profile'  ? '' : 'none';
    document.getElementById('yokoTab').style.display      = tab === 'yoko'     ? '' : 'none';
    document.getElementById('tabMyStats').classList.toggle('active',  tab === 'my-stats');
    document.getElementById('tabRankings').classList.toggle('active', tab === 'rankings');
    document.getElementById('tabProfile').classList.toggle('active',  tab === 'profile');
    document.getElementById('tabYoko').classList.toggle('active',     tab === 'yoko');
    if (tab === 'rankings') buildGlobalRankings();
    if (tab === 'profile')  { buildProfileSelect(); loadPlayerProfile(); }
    if (tab === 'yoko')     { renderYokoBadges(); loadYokoTab(); }
}


// ── Rankings filter state ───────────────────────────────────────────────────

function _getRankDateRange() {
    const now   = new Date();
    const today = now.toISOString().slice(0, 10);

    if (App.rankDatePreset === 'custom') {
        const from = document.getElementById('rankDateFrom')?.value || null;
        const to   = document.getElementById('rankDateTo')?.value   || null;
        return { from, to };
    }

    const startOf = (d, unit) => {
        const r = new Date(d);
        if (unit === 'month') { r.setDate(1); }
        if (unit === 'year')  { r.setMonth(0); r.setDate(1); }
        return r.toISOString().slice(0, 10);
    };
    const sub = (d, days) => { const r = new Date(d); r.setDate(r.getDate() - days); return r.toISOString().slice(0, 10); };

    switch (App.rankDatePreset) {
        case '7d':         return { from: sub(now, 7),   to: today };
        case '30d':        return { from: sub(now, 30),  to: today };
        case '90d':        return { from: sub(now, 90),  to: today };
        case 'this-month': return { from: startOf(now, 'month'), to: today };
        case 'last-month': {
            const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            const lme = new Date(now.getFullYear(), now.getMonth(), 0);
            return { from: lm.toISOString().slice(0, 10), to: lme.toISOString().slice(0, 10) };
        }
        case 'this-year':  return { from: startOf(now, 'year'), to: today };
        default:           return { from: null, to: null }; // all time
    }
}

function onRankDatePreset(btn) {
    App.rankDatePreset = btn.dataset.preset;
    document.querySelectorAll('#rankDatePresetChips .chip').forEach(c =>
        c.classList.toggle('active', c === btn));
    const customRow = document.getElementById('rankCustomDateRow');
    if (customRow) customRow.style.display = App.rankDatePreset === 'custom' ? 'flex' : 'none';
    applyRankingsFilter();
}

function _getRankSelectedPeriods() {
    const chips = [...document.querySelectorAll('#rankPeriodChips .chip:not(.chip-all)')];
    // Returns { active, known } — known = all periods that have a chip (active or not)
    return {
        active:  new Set(chips.filter(c =>  c.classList.contains('active')).map(c => c.dataset.period)),
        known:   new Set(chips.map(c => c.dataset.period))
    };
}

function _getRankSelectedYears() {
    const chips = document.querySelectorAll('#rankYearChips .chip');
    return new Set([...chips].filter(c => c.classList.contains('active')).map(c => c.dataset.year));
}

// Filter a single user's event array using the rankings filter state
function _applyRankFilter(events) {
    const { active: activePeriods, known: knownPeriods } = _getRankSelectedPeriods();
    const years         = _getRankSelectedYears();
    const { from, to }  = _getRankDateRange();
    return events.filter(ev => {
        if (!ev?.rounds) return false;
        if (ev._start_datetime) {
            const dateStr = ev._start_datetime.slice(0, 10);
            const year    = dateStr.slice(0, 4);
            if (years.size > 0 && !years.has(year)) return false;
            // Only filter by period if the event's period has a chip — unknown periods pass through
            if (knownPeriods.size > 0) {
                const period = getPeriodForDate(ev._start_datetime);
                if (knownPeriods.has(period) && !activePeriods.has(period)) return false;
            }
            if (from && dateStr < from) return false;
            if (to   && dateStr > to)   return false;
        }
        if (App.rankStore && ev._store_name !== App.rankStore) return false;
        if (App.rankRegionalsOnly) {
            const dateStr = ev._start_datetime ? ev._start_datetime.slice(0, 10) : null;
            if (!dateStr || !REGIONALS.some(reg => reg.date === dateStr)) return false;
        }
        return true;
    });
}

function toggleRankRegionalsOnly() {
    App.rankRegionalsOnly = !App.rankRegionalsOnly;
    const btn = document.getElementById('rankRegionalsOnlyBtn');
    if (btn) btn.classList.toggle('active', App.rankRegionalsOnly);
    applyRankingsFilter();
}

function onRankYearChip(btn) {
    btn.classList.toggle('active');
    applyRankingsFilter();
}

function onRankStoreChange() {
    App.rankStore = document.getElementById('rankStoreSelect').value || null;
    applyRankingsFilter();
}

function clearRankStoreFilter() {
    App.rankStore = null;
    document.getElementById('rankStoreSelect').value = '';
    applyRankingsFilter();
}

function clearRankFilters() {
    App.rankStore          = null;
    App.rankDatePreset     = 'all';
    App.rankRegionalsOnly  = false;
    const rankRegBtn = document.getElementById('rankRegionalsOnlyBtn');
    if (rankRegBtn) rankRegBtn.classList.remove('active');
    document.getElementById('rankStoreSelect').value = '';
    // Activate all year chips
    document.querySelectorAll('#rankYearChips .chip').forEach(c => c.classList.add('active'));
    // Activate all period chips
    document.querySelectorAll('#rankPeriodChips .chip').forEach(c => c.classList.add('active'));
    // Reset date preset to "All Time"
    document.querySelectorAll('#rankDatePresetChips .chip').forEach(c =>
        c.classList.toggle('active', c.dataset.preset === 'all'));
    const customRow = document.getElementById('rankCustomDateRow');
    if (customRow) customRow.style.display = 'none';
    applyRankingsFilter();
}

function _buildRankFilterChips(allEvents) {
    const periodsWithData = new Set();
    for (const ev of allEvents) {
        if (!ev?._start_datetime) continue;
        periodsWithData.add(getPeriodForDate(ev._start_datetime));
    }

    const container = document.getElementById('rankPeriodChips');
    container.innerHTML = '';

    const allChip = document.createElement('button');
    allChip.className = 'chip chip-all active';
    allChip.textContent = 'All Collections';
    allChip.dataset.period = 'all';
    allChip.onclick = () => {
        const indiv = [...container.querySelectorAll('.chip:not(.chip-all)')];
        const allOn = indiv.every(c => c.classList.contains('active'));
        indiv.forEach(c => c.classList.toggle('active', !allOn));
        allChip.classList.toggle('active', !allOn);
        applyRankingsFilter();
    };
    container.appendChild(allChip);

    for (const p of SET_PERIODS) {
        if (!periodsWithData.has(p.name)) continue;
        const chip = document.createElement('button');
        chip.className = 'chip active';
        chip.textContent = p.name.split(' · ')[0];
        chip.title = p.name;
        chip.dataset.period = p.name;
        chip.onclick = () => {
            chip.classList.toggle('active');
            const indiv = [...container.querySelectorAll('.chip:not(.chip-all)')];
            allChip.classList.toggle('active', indiv.every(c => c.classList.contains('active')));
            applyRankingsFilter();
        };
        container.appendChild(chip);
    }
}

function _buildRankStoreDropdown(allEvents) {
    const stores = new Set(allEvents.map(ev => ev._store_name).filter(Boolean));
    const sel = document.getElementById('rankStoreSelect');
    sel.innerHTML = '<option value="">— all stores —</option>';
    [...stores].sort((a, b) => a.localeCompare(b)).forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        sel.appendChild(opt);
    });
    if (App.rankStore && stores.has(App.rankStore)) sel.value = App.rankStore;
    else App.rankStore = null;
}

function _updateRankFilterSummary(allUsers, filteredUsers) {
    const totalEvs    = allUsers.reduce((s, u) => s + u.events.length, 0);
    const filteredEvs = filteredUsers.reduce((s, u) => s + u.events.length, 0);
    const el = document.getElementById('rankFilterSummary');
    if (!el) return;
    el.textContent = filteredEvs < totalEvs
        ? `Showing ${filteredEvs} of ${totalEvs} events`
        : `All ${totalEvs} events`;
}

function applyRankingsFilter() {
    const allUsers = App.usersWithToken.map(u => ({
        ...u,
        events: Object.values(loadCache(u.bandaiId) || {})
    })).filter(u => u.events.length > 0);

    // Rebuild filter chips from full unfiltered pool so new periods (e.g. OP-14)
    // are always represented even when navigating to the tab after new data is fetched.
    const allEvents = allUsers.flatMap(u => u.events);
    _buildRankFilterChips(allEvents);

    const filteredUsers = allUsers.map(u => ({
        ...u,
        events: _applyRankFilter(u.events)
    })).filter(u => u.events.length > 0); // drop players with zero events under current filter

    // Build a set of "date|store" keys from non-restricted players' filtered events.
    const isRestricted = u => RESTRICTED_TO_SHARED.some(n => u.name.toLowerCase().includes(n));
    const sharedKeys = new Set(
        filteredUsers
            .filter(u => !isRestricted(u))
            .flatMap(u => u.events.map(ev => {
                const date  = ev._start_datetime ? ev._start_datetime.slice(0, 10) : null;
                const store = ev._store_name ?? '';
                return date ? `${date}|${store}` : null;
            }).filter(Boolean))
    );

    // For restricted players, keep only events that share a key with another mapped player.
    const finalUsers = filteredUsers.map(u => {
        if (!isRestricted(u)) return u;
        return {
            ...u,
            events: u.events.filter(ev => {
                const date  = ev._start_datetime ? ev._start_datetime.slice(0, 10) : null;
                const store = ev._store_name ?? '';
                return date && sharedKeys.has(`${date}|${store}`);
            })
        };
    }).filter(u => u.events.length > 0); // drop restricted players with no matching events

    _updateRankFilterSummary(allUsers, finalUsers);
    renderWinRateTimeline(finalUsers);
    renderMostActive(finalUsers);
    renderEliteFour(finalUsers);
    renderLeaderboard(finalUsers);
    renderH2HMatrix(finalUsers);
    renderCommunityOpponents(finalUsers);
    renderStoreActivity(finalUsers);
    renderStoreLeaderboard(finalUsers);
    _populateStoreH2HSelect(finalUsers);
    const storeH2HCard = document.getElementById('storeH2HCard');
    if (storeH2HCard) storeH2HCard.style.display = finalUsers.length > 0 ? 'block' : 'none';
}

function buildGlobalRankings() {
    const allUsers = App.usersWithToken.map(u => ({
        ...u,
        events: Object.values(loadCache(u.bandaiId) || {})
    })).filter(u => u.events.length > 0);

    if (allUsers.length === 0) {
        ['leaderboardBody','rankH2H'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = '<p style="color:var(--muted);padding:1rem 0;">No cached data found. Fetch at least one user first.</p>';
        });
        return;
    }

    // Build filter controls from the full (unfiltered) event pool
    const allEvents = allUsers.flatMap(u => u.events);
    _buildRankFilterChips(allEvents);
    _buildRankStoreDropdown(allEvents);

    // Apply any active filters, then render
    applyRankingsFilter();
}

// ── Avatar helper ────────────────────────────────────────────────────────────
// Returns the inner HTML for an avatar div.
// If a photo exists at Resources/player-picture/<bandaiId>.jpeg it overlays the initials;
// onerror removes it so the fallback gradient + initials shows instead.
function _playerAvatar(bandaiId, name) {
    const ini = name.trim().split(/\s+/).map(w => w[0].toUpperCase()).slice(0, 2).join('');
    return `<img class="avatar-photo" src="Resources/player-picture/${bandaiId}.jpeg" alt="" onerror="this.remove()">${ini}`;
}

// ── Most Active Players ─────────────────────────────────────────────────────
function renderMostActive(allUsers) {
    const card = document.getElementById('mostActiveCard');
    if (!card) return;

    const rows = allUsers.map(u => {
        let w = 0, l = 0;
        for (const ev of u.events) {
            if (!ev?.rounds) continue;
            for (const r of ev.rounds) { if (r.is_win) w++; else l++; }
        }
        return { name: u.name, bandaiId: u.bandaiId, tournaments: u.events.length, rounds: w + l, w, l };
    }).sort((a, b) => b.tournaments - a.tournaments || b.rounds - a.rounds);

    if (rows.length === 0) { card.style.display = 'none'; return; }
    card.style.display = 'block';

    const medals = ['🥇', '🥈', '🥉'];
    const tbody = document.getElementById('mostActiveBody');
    tbody.innerHTML = rows.map((r, i) => `
        <tr>
            <td class="td-num">${medals[i] ?? (i + 1)}</td>
            <td><div class="player-cell"><div class="table-avatar">${_playerAvatar(r.bandaiId, r.name)}</div><strong>${playerNameLink(r.name)}</strong></div></td>
            <td class="td-num" style="color:var(--accent);font-weight:700;">${r.tournaments}</td>
            <td class="td-num">${r.rounds}</td>
            <td class="td-num" style="color:var(--win)">${r.w}</td>
            <td class="td-num" style="color:var(--loss)">${r.l}</td>
        </tr>`).join('');
}

// ── Elite Four ──────────────────────────────────────────────────────────────
function renderEliteFour(allUsers) {
    const card = document.getElementById('eliteFourCard');
    const grid = document.getElementById('eliteFourGrid');
    if (!card || !grid) return;

    // Aggregate wins per user
    const rows = allUsers.map(u => {
        let w = 0, l = 0, pts = 0;
        for (const ev of u.events) {
            if (!ev?.rounds) continue;
            for (const r of ev.rounds) { if (r.is_win) w++; else l++; }
            const mp = ev._match_points ?? (ev.user?.match_point != null ? Number(ev.user.match_point) : null);
            if (mp != null) pts += mp;
        }
        const total = w + l;
        const pct   = total > 0 ? (w / total * 100) : 0;
        return { name: u.name, bandaiId: u.bandaiId, w, l, total, pct, pts, events: u.events.length };
    }).sort((a, b) => b.pct - a.pct || b.total - a.total).slice(0, 4);

    if (rows.length === 0) { card.style.display = 'none'; return; }
    card.style.display = 'block';

    const medals  = ['🥇', '🥈', '🥉', '4️⃣'];

    grid.innerHTML = `<div class="elite-four-grid">${rows.map((p, i) => `
        <div class="elite-card" data-pos="${i + 1}">
            <div class="elite-rank-badge">${medals[i]}</div>
            <div class="elite-avatar">${_playerAvatar(p.bandaiId, p.name)}</div>
            <div class="elite-name">${playerNameLink(p.name)}</div>
            <div class="elite-wins">${p.pct.toFixed(1)}%</div>
            <div class="elite-wins-lbl">Win Rate</div>
            <div class="elite-sub">${p.w}W &middot; ${p.l}L &middot; ${p.events} event${p.events !== 1 ? 's' : ''}</div>
        </div>`).join('')}
    </div>`;
}

// ── A: Overall Leaderboard ──────────────────────────────────────────────────

function setPodiumSort(mode) {
    App.podiumSort = mode;
    document.querySelectorAll('.podium-sort-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.sort === mode);
    });
    if (App.lastLeaderboardUsers) renderLeaderboard(App.lastLeaderboardUsers);
}

function renderLeaderboard(allUsers) {
    App.lastLeaderboardUsers = allUsers;
    const tbody  = document.getElementById('leaderboardBody');
    const podium = document.getElementById('podium');
    if (!tbody) return;

    const rows = allUsers.map(u => {
        let w = 0, l = 0, pts = 0, ranks = [];
        for (const ev of u.events) {
            // Rounds — win/loss counting
            if (ev?.rounds) {
                for (const r of ev.rounds) { if (r.is_win) w++; else l++; }
            }
            // Rank — use preprocessed field, fall back to raw API field for older cached events
            const rank = ev._rank ?? ev.user?.rank ?? null;
            if (rank != null) ranks.push(Number(rank));
            // Match points — same fallback pattern
            const mp = ev._match_points ?? (ev.user?.match_point != null ? Number(ev.user.match_point) : null);
            if (mp != null) pts += mp;
        }
        const total = w + l;
        const pct   = total ? (w / total * 100) : 0;
        const avgRank  = ranks.length ? (ranks.reduce((a,b)=>a+b,0) / ranks.length) : null;
        const bestRank = ranks.length ? Math.min(...ranks) : null;
        return { name: u.name, bandaiId: u.bandaiId, w, l, total, pct, tournaments: u.events.length, avgRank, bestRank, pts };
    });

    // Sort by the active criterion
    const sorters = {
        pct:     (a, b) => b.pct - a.pct || b.total - a.total,
        wins:    (a, b) => b.w - a.w || b.pct - a.pct,
        pts:     (a, b) => b.pts - a.pts || b.pct - a.pct,
        avgRank: (a, b) => {
            // lower avg rank number = better; nulls go last
            if (a.avgRank == null && b.avgRank == null) return 0;
            if (a.avgRank == null) return 1;
            if (b.avgRank == null) return -1;
            return a.avgRank - b.avgRank;
        },
    };
    rows.sort(sorters[App.podiumSort] ?? sorters.pct);

    // ── Podium graphic (top 5) ──────────────────────────────────────────────
    if (podium) {
        const top = rows.slice(0, 5);
        if (top.length === 0) {
            podium.innerHTML = '';
        } else {
            // Classic podium visual order: 4th · 2nd · 1st · 3rd · 5th
            // (only use positions that exist)
            const displayOrder = [3, 1, 0, 2, 4].filter(i => i < top.length);
            const medals = ['🥇','🥈','🥉','',''];

            // Primary stat shown in large text — matches the active sort
            const primaryStat = p => {
                switch (App.podiumSort) {
                    case 'wins':    return `${p.w}W`;
                    case 'pts':     return `${p.pts} pts`;
                    case 'avgRank': return p.avgRank != null ? `#${p.avgRank.toFixed(1)}` : '—';
                    default:        return `${p.pct.toFixed(1)}%`;
                }
            };

            const slots = displayOrder.map(i => {
                const p   = top[i];
                const pos = i + 1; // 1-based rank
                return `
                <div class="podium-slot" data-pos="${pos}">
                    <div class="podium-avatar">
                        ${_playerAvatar(p.bandaiId, p.name)}
                        ${medals[i] ? `<span class="podium-medal">${medals[i]}</span>` : ''}
                    </div>
                    <div class="podium-name" title="${p.name}">${playerNameLink(p.name)}</div>
                    <div class="podium-pct">${primaryStat(p)}</div>
                    <div class="podium-sub">${p.w}W · ${p.l}L · ${p.pct.toFixed(1)}%<br>${p.tournaments} event${p.tournaments !== 1 ? 's' : ''}</div>
                    <div class="podium-bar">#${pos}</div>
                </div>`;
            }).join('');

            podium.innerHTML = `
                <div class="podium-stage">${slots}</div>
                <div class="podium-floor"></div>`;
        }
    }

    // ── Leaderboard table ───────────────────────────────────────────────────
    const medals = ['🥇','🥈','🥉'];
    tbody.innerHTML = rows.map((r, i) => `
        <tr>
            <td class="td-num">${medals[i] ?? (i+1)}</td>
            <td><div class="player-cell"><div class="table-avatar">${_playerAvatar(r.bandaiId, r.name)}</div><strong>${playerNameLink(r.name)}</strong></div></td>
            <td class="td-num" style="color:var(--win)">${r.w}</td>
            <td class="td-num" style="color:var(--loss)">${r.l}</td>
            <td class="td-pct" style="color:var(--accent)">${r.pct.toFixed(1)}%</td>
            <td class="td-num">${r.tournaments}</td>
            <td class="td-num">${r.avgRank != null ? r.avgRank.toFixed(1) : '—'}</td>
            <td class="td-num">${r.bestRank != null ? '#' + r.bestRank : '—'}</td>
            <td class="td-num">${r.pts}</td>
        </tr>`).join('');
}

// ── B: Head-to-Head Matrix ──────────────────────────────────────────────────
function renderH2HMatrix(allUsers) {
    const container = document.getElementById('rankH2H');
    if (!container) return;
    if (allUsers.length < 2) {
        container.innerHTML = '<p style="color:var(--muted);">Need at least 2 players with cached data.</p>';
        return;
    }

    // Build bandaiId → index map
    const idxMap = {};
    allUsers.forEach((u, i) => { idxMap[u.bandaiId] = i; });

    // matrix[i][j] = { w: wins by i against j, l: losses by i against j }
    const n = allUsers.length;
    const matrix = Array.from({length: n}, () => Array.from({length: n}, () => ({w:0,l:0})));

    for (let i = 0; i < n; i++) {
        const u = allUsers[i];
        for (const ev of u.events) {
            if (!ev?.rounds) continue;
            for (const r of ev.rounds) {
                const oppId = r.opponent_users?.[0]?.membership_number;
                if (!oppId || !(oppId in idxMap)) continue;
                const j = idxMap[oppId];
                if (i === j) continue;
                if (r.is_win) matrix[i][j].w++; else matrix[i][j].l++;
            }
        }
    }

    // Render table
    const headerCells = allUsers.map(u =>
        `<th style="padding:0.45rem 0.6rem;background:linear-gradient(135deg,var(--primary),#3d5472);color:white;font-family:'Cinzel',serif;font-size:0.7rem;text-align:center;white-space:nowrap;">${u.name}</th>`
    ).join('');

    const bodyRows = allUsers.map((u, i) => {
        const cells = allUsers.map((_, j) => {
            if (i === j) return `<td class="h2h-self">—</td>`;
            const {w, l} = matrix[i][j];
            if (w === 0 && l === 0) return `<td style="color:var(--muted);text-align:center;">-</td>`;
            const cls = w > l ? 'h2h-win' : (l > w ? 'h2h-loss' : '');
            return `<td class="${cls}">${w}–${l}</td>`;
        }).join('');
        return `<tr><td class="h2h-label">${playerNameLink(u.name)}</td>${cells}</tr>`;
    }).join('');

    container.innerHTML = `
        <table class="h2h-table">
            <thead><tr>
                <th style="padding:0.45rem 0.6rem;background:linear-gradient(135deg,var(--primary),#3d5472);color:white;font-family:'Cinzel',serif;font-size:0.7rem;">vs ↓</th>
                ${headerCells}
            </tr></thead>
            <tbody>${bodyRows}</tbody>
        </table>`;
}

// ── D: Community Opponents ──────────────────────────────────────────────────
function renderCommunityOpponents(allUsers) {
    const card = document.getElementById('communityOppCard');
    if (!card) return;
    const trackedIds = new Set(allUsers.map(u => u.bandaiId));
    const oppCount   = {};

    for (const u of allUsers) {
        for (const ev of u.events) {
            if (!ev?.rounds) continue;
            for (const r of ev.rounds) {
                const pid   = r.opponent_users?.[0]?.membership_number;
                const pName = r.opponent_users?.[0]?.player_name?.trim();
                if (!pid || trackedIds.has(pid)) continue;
                if (pName && !App.usernameMap[pid]) App.usernameMap[pid] = pName;
                if (!oppCount[pid]) oppCount[pid] = { matches: 0, players: new Set() };
                oppCount[pid].matches++;
                oppCount[pid].players.add(u.bandaiId);
            }
        }
    }

    const top = Object.entries(oppCount)
        .sort((a, b) => b[1].matches - a[1].matches)
        .slice(0, 20);

    if (top.length === 0) { card.style.display = 'none'; return; }
    card.style.display = 'block';

    const tbody = document.getElementById('communityOppBody');
    tbody.innerHTML = '';
    for (const [pid, data] of top) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${App.usernameMap[pid] || pid}</td>
            <td class="td-num">${data.matches}</td>
            <td class="td-num">${data.players.size}</td>`;
        tbody.appendChild(tr);
    }
}

// ── E: Store Activity Map ───────────────────────────────────────────────────
function renderStoreActivity(allUsers) {
    const card = document.getElementById('storeActivityCard');
    if (!card) return;

    // storeMap[storeName] = { events: N, players: Set<name>, w: N, l: N }
    const storeMap = {};
    for (const u of allUsers) {
        const visitedStores = new Set();
        for (const ev of u.events) {
            if (!ev._store_name) continue;
            const s = ev._store_name;
            if (!storeMap[s]) storeMap[s] = { events: 0, players: new Set(), w: 0, l: 0 };
            storeMap[s].events++;
            storeMap[s].players.add(u.name);
            visitedStores.add(s);
            if (ev?.rounds) {
                for (const r of ev.rounds) { if (r.is_win) storeMap[s].w++; else storeMap[s].l++; }
            }
        }
    }

    const entries = Object.entries(storeMap).sort((a, b) => b[1].events - a[1].events);
    if (entries.length === 0) { card.style.display = 'none'; return; }
    card.style.display = 'block';

    const tbody = document.getElementById('storeActivityBody');
    tbody.innerHTML = '';
    for (const [name, s] of entries) {
        const t   = s.w + s.l;
        const pct = t > 0 ? (s.w / t * 100).toFixed(1) + '%' : '—';
        const pctColor = t > 0 ? (s.w / t >= 0.5 ? 'var(--win)' : 'var(--loss)') : 'var(--muted)';
        const playerList = [...s.players].sort().join(', ');
        const tr = document.createElement('tr');
        tr.style.cursor = 'pointer';
        tr.title = 'Players: ' + playerList;
        tr.innerHTML = `<td>${name}</td>
            <td class="td-num">${s.events}</td>
            <td class="td-num" title="${playerList}">${s.players.size}</td>
            <td class="td-pct" style="color:${pctColor}">${pct}</td>`;
        // Expand player list on click
        tr.onclick = () => {
            const next = tr.nextElementSibling;
            if (next && next.classList.contains('store-expand-row')) { next.remove(); return; }
            const expRow = document.createElement('tr');
            expRow.className = 'store-expand-row';
            expRow.innerHTML = `<td colspan="4" style="font-size:0.8rem;color:var(--muted);padding:0.4rem 0.75rem 0.75rem;">
                <strong>Players:</strong> ${playerList}</td>`;
            tr.after(expRow);
        };
        tbody.appendChild(tr);
    }
}

// ── F: Store Leaderboard ────────────────────────────────────────────────────
function renderStoreLeaderboard(allUsers) {
    const card = document.getElementById('storeLeaderCard');
    if (!card) return;

    // Per store, per player: { w, l, events }
    const storePlayerMap = {};
    for (const u of allUsers) {
        for (const ev of u.events) {
            if (!ev._store_name || !ev?.rounds) continue;
            const s = ev._store_name;
            if (!storePlayerMap[s]) storePlayerMap[s] = {};
            if (!storePlayerMap[s][u.name]) storePlayerMap[s][u.name] = { w: 0, l: 0, events: 0 };
            storePlayerMap[s][u.name].events++;
            for (const r of ev.rounds) { if (r.is_win) storePlayerMap[s][u.name].w++; else storePlayerMap[s][u.name].l++; }
        }
    }

    const rows = [];
    for (const [store, players] of Object.entries(storePlayerMap)) {
        const qualified = Object.entries(players).filter(([, p]) => p.w + p.l >= 2);
        if (qualified.length === 0) continue;
        const [topName, topP] = qualified.sort((a, b) => {
            const pa = a[1].w / (a[1].w + a[1].l), pb = b[1].w / (b[1].w + b[1].l);
            return pb - pa || b[1].w - a[1].w;
        })[0];
        const t   = topP.w + topP.l;
        const pct = (topP.w / t * 100).toFixed(1);
        rows.push({ store, topName, pct: parseFloat(pct), pctStr: pct + '%', w: topP.w, l: topP.l, events: topP.events });
    }
    rows.sort((a, b) => b.pct - a.pct || b.w - a.w);

    if (rows.length === 0) { card.style.display = 'none'; return; }
    card.style.display = 'block';

    const tbody = document.getElementById('storeLeaderBody');
    tbody.innerHTML = '';
    for (const r of rows) {
        const color = r.pct >= 50 ? 'var(--win)' : 'var(--loss)';
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${r.store}</td>
            <td><strong>${playerNameLink(r.topName)}</strong></td>
            <td class="td-pct" style="color:${color}">${r.pctStr}</td>
            <td class="td-num" style="color:var(--win)">${r.w}</td>
            <td class="td-num" style="color:var(--loss)">${r.l}</td>
            <td class="td-num">${r.events}</td>`;
        tbody.appendChild(tr);
    }
}

// ── G: Head-to-Head by Store ────────────────────────────────────────────────

function renderStoreH2H() {
    const sel   = document.getElementById('storeH2HSelect');
    const store = sel?.value;
    const container = document.getElementById('storeH2HMatrix');
    if (!container) return;
    if (!store) { container.innerHTML = ''; return; }

    // Filter each user's events to the selected store
    const filtered = App.storeH2HUsers.map(u => ({
        ...u,
        events: u.events.filter(ev => ev._store_name === store)
    })).filter(u => u.events.length > 0);

    if (filtered.length < 2) {
        container.innerHTML = '<p style="color:var(--muted);">Need at least 2 players with data at this store.</p>';
        return;
    }

    // Build H2H matrix using the same logic as renderH2HMatrix
    const n = filtered.length;
    const idxMap = {};
    filtered.forEach((u, i) => { idxMap[u.bandaiId] = i; });
    const matrix = Array.from({length: n}, () => Array.from({length: n}, () => ({w:0,l:0})));

    for (let i = 0; i < n; i++) {
        for (const ev of filtered[i].events) {
            if (!ev?.rounds) continue;
            for (const r of ev.rounds) {
                const oppId = r.opponent_users?.[0]?.membership_number;
                if (oppId == null || !(oppId in idxMap)) continue;
                const j = idxMap[oppId];
                if (r.is_win) matrix[i][j].w++; else matrix[i][j].l++;
            }
        }
    }

    // Render compact H2H table
    let html = '<div class="table-wrap"><table class="h2h-table"><thead><tr><th>↓ vs →</th>';
    for (const u of filtered) html += `<th>${u.name}</th>`;
    html += '</tr></thead><tbody>';
    for (let i = 0; i < n; i++) {
        html += `<tr><td><strong>${filtered[i].name}</strong></td>`;
        for (let j = 0; j < n; j++) {
            if (i === j) { html += '<td style="background:var(--border);"></td>'; continue; }
            const { w, l } = matrix[i][j];
            const t = w + l;
            const color = t === 0 ? 'var(--muted)' : w > l ? 'var(--win)' : w < l ? 'var(--loss)' : 'var(--accent)';
            html += `<td class="td-num" style="color:${color}">${t > 0 ? w+'-'+l : '—'}</td>`;
        }
        html += '</tr>';
    }
    html += '</tbody></table></div>';
    container.innerHTML = html;
}

function _populateStoreH2HSelect(allUsers) {
    const stores = new Set();
    for (const u of allUsers) for (const ev of u.events) if (ev._store_name) stores.add(ev._store_name);
    const sel = document.getElementById('storeH2HSelect');
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = '<option value="">— select a store —</option>';
    [...stores].sort().forEach(s => {
        const opt = document.createElement('option');
        opt.value = opt.textContent = s;
        if (s === prev) opt.selected = true;
        sel.appendChild(opt);
    });
    App.storeH2HUsers = allUsers;
    renderStoreH2H();
}

// ── Win Rate Timeline ────────────────────────────────────────────────────────
function renderWinRateTimeline(allUsers) {
    const card = document.getElementById('winRateTimelineCard');
    if (!card) return;
    if (allUsers.length === 0) { card.style.display = 'none'; return; }

    // Build sorted unified date list across all users
    const allDates = new Set();
    for (const u of allUsers) {
        for (const ev of u.events) {
            if (ev._start_datetime) allDates.add(ev._start_datetime.slice(0, 10));
        }
    }
    const sortedDates = [...allDates].sort();
    if (sortedDates.length === 0) { card.style.display = 'none'; return; }
    card.style.display = 'block';

    const datasets = allUsers.map((u, idx) => {
        const evsByDate = {};
        for (const ev of u.events) {
            if (!ev._start_datetime || !ev.rounds) continue;
            const d = ev._start_datetime.slice(0, 10);
            if (!evsByDate[d]) evsByDate[d] = [];
            evsByDate[d].push(ev);
        }
        let cumW = 0, cumL = 0;
        const data = sortedDates.map(date => {
            const evs = evsByDate[date] || [];
            for (const ev of evs) {
                for (const r of ev.rounds) { if (r.is_win) cumW++; else cumL++; }
            }
            const t = cumW + cumL;
            return t > 0 ? parseFloat((cumW / t * 100).toFixed(1)) : null;
        });
        const color = PALETTE[idx % PALETTE.length];
        return {
            label: u.name,
            data,
            borderColor: color,
            backgroundColor: color + '22',
            borderWidth: 2,
            pointRadius: 2,
            tension: 0.3,
            spanGaps: true,
        };
    });

    const canvasId = 'chartWinRateTimeline';
    if (App.charts[canvasId]) { App.charts[canvasId].destroy(); delete App.charts[canvasId]; }
    const ctx = document.getElementById(canvasId)?.getContext('2d');
    if (!ctx) return;

    App.charts[canvasId] = new Chart(ctx, {
        type: 'line',
        data: { labels: sortedDates, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { labels: { color: 'var(--text)', font: { size: 12 } } },
                tooltip: {
                    callbacks: {
                        label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y != null ? ctx.parsed.y.toFixed(1) + '%' : '—'}`
                    }
                }
            },
            scales: {
                x: { ticks: { color: 'var(--muted)', maxTicksLimit: 12 }, grid: { color: 'var(--border)' } },
                y: {
                    min: 0, max: 100,
                    ticks: { color: 'var(--muted)', callback: v => v + '%' },
                    grid: { color: 'var(--border)' }
                }
            }
        }
    });
}

// ── Export Rankings CSV ──────────────────────────────────────────────────────
function exportRankingsCSV() {
    const rows = [['Rank', 'Player', 'W', 'L', 'Win%', 'Tournaments', 'Avg Rank', 'Best Rank', 'Match Pts']];
    const tbody = document.getElementById('leaderboardBody');
    if (!tbody) return;
    [...tbody.querySelectorAll('tr')].forEach((tr, i) => {
        const cells = [...tr.querySelectorAll('td')].map(td => td.textContent.trim());
        if (cells.length) rows.push([(i + 1), ...cells.slice(1)]);
    });
    const csv = rows.map(r => r.map(v => {
        const s = String(v ?? '');
        return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(',')).join('\r\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'rankings.csv';
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── Competitive Badges ────────────────────────────────────────────────────────
// Rei dos Piratas  : best win rate of each completed year  (unlocks after Dec 31)
// Yonkou          : top 4 win rate of the last completed month
// Shichibukai     : positions 5–11 win rate of the last completed month
// Almirante       : player with the best rank ever achieved at a Regional event

function computeCompetitiveBadges() {
    const MIN_ROUNDS_YEAR  = 20;
    const MIN_ROUNDS_MONTH = 5;
    const now = new Date();

    // Build per-player event lists from cache
    const players = App.usersWithToken.map(user => {
        const evs = Object.values(loadCache(user.bandaiId))
            .filter(ev => ev?.rounds && ev._start_datetime);
        return { user, evs };
    }).filter(p => p.evs.length > 0);

    if (!players.length) {
        App.competitiveBadges = { reiDosPiratas: {}, yonkou: [], shichibukai: [], month: null };
        return;
    }

    // ── Rei dos Piratas ──────────────────────────────────────────────────────
    const yearSet = new Set();
    for (const { evs } of players)
        for (const ev of evs)
            yearSet.add(new Date(ev._start_datetime).getFullYear());

    const reiDosPiratas = {};
    for (const year of yearSet) {
        // Badge only available after Dec 31 of that year (i.e. Jan 1 of year+1)
        if (now < new Date(year + 1, 0, 1)) continue;

        const ranked = [];
        for (const { user, evs } of players) {
            const yEvs = evs.filter(ev => new Date(ev._start_datetime).getFullYear() === year);
            let w = 0, l = 0;
            for (const ev of yEvs) for (const r of ev.rounds) r.is_win ? w++ : l++;
            const total = w + l;
            if (total < MIN_ROUNDS_YEAR) continue;
            ranked.push({ bandaiId: user.bandaiId, name: user.name, winRate: w / total, w, l, total });
        }
        ranked.sort((a, b) => b.winRate - a.winRate || b.total - a.total);
        if (ranked.length) reiDosPiratas[year] = ranked[0];
    }

    // ── Yonkou & Shichibukai — current month (live) + history ────────────────
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    // Rank players for a given month string
    const rankMonth = (m, minRounds) => {
        const ranked = [];
        for (const { user, evs } of players) {
            const mEvs = evs.filter(ev => ev._start_datetime.startsWith(m));
            let w = 0, l = 0;
            for (const ev of mEvs) for (const r of ev.rounds) r.is_win ? w++ : l++;
            const total = w + l;
            if (total < minRounds) continue;
            ranked.push({ bandaiId: user.bandaiId, name: user.name, winRate: w / total, w, l, total });
        }
        ranked.sort((a, b) => b.winRate - a.winRate || b.total - a.total);
        return ranked;
    };

    // Current month rankings (no minimum — show everyone playing this month)
    const mRanked     = rankMonth(currentMonth, 1);
    const latestMonth = currentMonth;

    // History: all fully-completed past months (strictly before current month)
    const allMonths = new Set();
    for (const { evs } of players)
        for (const ev of evs) allMonths.add(ev._start_datetime.slice(0, 7));

    const pastMonths = [...allMonths].filter(m => m < currentMonth).sort().reverse();

    const history = pastMonths.map(m => {
        const ranked = rankMonth(m, MIN_ROUNDS_MONTH);
        return {
            month: m,
            rankings: ranked,
            yonkou:      ranked.slice(0, 4).map(p => p.bandaiId),
            shichibukai: ranked.slice(4, 11).map(p => p.bandaiId),
        };
    }).filter(entry => entry.rankings.length > 0);

    // ── Almirante de Frota (best Regional placement ever) ────────────────────
    // Match by BOTH date AND event name to avoid false positives from regular
    // tournaments that happened to fall on the same day as a Regional.
    const _isRegionalEv = ev => {
        const d    = ev._start_datetime?.slice(0, 10);
        const name = (ev._event_name ?? '').toLowerCase();
        return REGIONALS.some(r => {
            if (r.date !== d) return false;
            // Accept if the stored event name contains a meaningful word from the Regional name
            const keywords = r.name.toLowerCase().split(/\s+/).filter(w => w.length > 4);
            return keywords.some(kw => name.includes(kw));
        });
    };
    const regionalCandidates = [];

    for (const { user, evs } of players) {
        const regEvs = evs.filter(ev => _isRegionalEv(ev) && ev._rank != null);
        if (!regEvs.length) continue;

        // Best rank (lowest number), tiebreak: most Regional appearances, then most Regional wins
        const bestRank   = Math.min(...regEvs.map(ev => ev._rank));
        const appearances = regEvs.length;
        let regW = 0;
        for (const ev of regEvs) for (const r of ev.rounds) { if (r.is_win) regW++; }

        const bestEv = regEvs.find(ev => ev._rank === bestRank);
        const eventName = bestEv?._event_name ?? bestEv?.event?.series_title ?? null;

        regionalCandidates.push({ bandaiId: user.bandaiId, name: user.name, bestRank, appearances, regW, eventName });
    }

    // Sort: best rank asc, tiebreak by appearances desc, then regional wins desc
    regionalCandidates.sort((a, b) => a.bestRank - b.bestRank || b.appearances - a.appearances || b.regW - a.regW);
    const almirante = regionalCandidates[0] ?? null;

    App.competitiveBadges = {
        reiDosPiratas,
        yonkou:        mRanked.slice(0, 4).map(p => p.bandaiId),
        shichibukai:   mRanked.slice(4, 11).map(p => p.bandaiId),
        month:         latestMonth,
        monthRankings: mRanked,
        history,                        // [{ month, rankings, yonkou, shichibukai }] desc
        almirante,
        regionalLeaderboard: regionalCandidates, // all candidates sorted by bestRank
    };
}

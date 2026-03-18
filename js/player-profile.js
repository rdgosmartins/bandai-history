// ── Player Profile Tab ───────────────────────────────────────────────────────

function _computeAchievementBadges(evs, totalW, totalL) {
    const total     = totalW + totalL;
    const allRounds = evs.flatMap(ev => ev.rounds || []);
    const streaks   = computeStreaks(evs);

    const monthCount = {};
    for (const ev of evs) {
        const m = ev._start_datetime.slice(0, 7);
        monthCount[m] = (monthCount[m] || 0) + 1;
    }
    const maxMonth = Math.max(0, ...Object.values(monthCount));

    let bestEvWinPct = 0;
    for (const ev of evs) {
        let w = 0, l = 0;
        for (const r of ev.rounds) { if (r.is_win) w++; else l++; }
        const t = w + l;
        if (t > 0 && (w / t) > bestEvWinPct) bestEvWinPct = w / t;
    }

    const perfectEvs = evs.filter(ev => ev.rounds.every(r => r.is_win)).length;
    const top4 = evs.filter(ev => {
        const rank = ev._rank ?? ev.user?.rank ?? null;
        return rank != null && Number(rank) <= 4;
    }).length;
    const stores = new Set(evs.map(ev => ev._store_name).filter(Boolean));

    const defs = [
        { icon: '⚔️',  title: 'First Blood',         desc: 'Win your first match',              unlocked: totalW >= 1 },
        { icon: '🎯',  title: 'Grinder',              desc: 'Play 10 tournaments',               unlocked: evs.length >= 10 },
        { icon: '🏆',  title: 'Veteran',              desc: 'Play 50 tournaments',               unlocked: evs.length >= 50 },
        { icon: '💯',  title: 'Supernova',            desc: 'Accumulate 100 wins',               unlocked: totalW >= 100 },
        { icon: '✨',  title: 'Flawless',             desc: 'Win every match in a tournament',   unlocked: perfectEvs >= 1 },
        { icon: '🌟',  title: 'Untouchable',          desc: '5 tournaments with no losses',      unlocked: perfectEvs >= 5 },
        { icon: '🥇',  title: 'Podium',               desc: 'Finish Top 4 in a tournament',      unlocked: top4 >= 1 },
        { icon: '👑',  title: 'Royalty',              desc: '5 Top 4 finishes',                  unlocked: top4 >= 5 },
        { icon: '🔥',  title: 'On Fire',              desc: 'Win 5 rounds in a row',             unlocked: streaks.bestWin >= 5 },
        { icon: '🌋',  title: 'Unstoppable',          desc: 'Win 10 rounds in a row',            unlocked: streaks.bestWin >= 10 },
        { icon: '🗺️',  title: 'Road Warrior',         desc: 'Play at 5 different stores',        unlocked: stores.size >= 5 },
        { icon: '🌍',  title: 'Conqueror of Raftel',  desc: 'Play at 10 different stores',       unlocked: stores.size >= 10 },
        { icon: '📅',  title: 'Monthly Obsession',    desc: '4 tournaments in a single month',   unlocked: maxMonth >= 4 },
        { icon: '⚡',  title: 'Round Machine',        desc: 'Play 500 rounds total',             unlocked: total >= 500 },
        { icon: '🌐',  title: 'Regionals Veteran',    desc: 'Attend a Regional event',           unlocked: evs.some(ev => {
            const d = ev._start_datetime?.slice(0, 10);
            return d && REGIONALS.some(r => r.date === d);
        })},
    ];

    return defs.filter(b => b.unlocked);
}

function buildProfileSelect() {
    const sel = document.getElementById('profilePlayerSelect');
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = '<option value="">— select a player —</option>';

    // All players in the map, sorted by name
    const entries = Object.entries(App.usernameMap)
        .sort((a, b) => a[1].localeCompare(b[1]));

    for (const [bandaiId, name] of entries) {
        const opt = document.createElement('option');
        opt.value = bandaiId;
        opt.textContent = name;
        if (bandaiId === prev) opt.selected = true;
        sel.appendChild(opt);
    }
}

function loadPlayerProfile() {
    const bandaiId = document.getElementById('profilePlayerSelect').value;
    const content  = document.getElementById('profileContent');
    if (!bandaiId) { content.innerHTML = ''; return; }

    const name   = App.usernameMap[bandaiId] || bandaiId;
    const cached = Object.values(loadCache(bandaiId) || {});

    if (cached.length > 0) {
        content.innerHTML = _renderFullProfile(bandaiId, name, cached);
    } else {
        content.innerHTML = _renderOpponentProfile(bandaiId, name);
    }
}

// ── Full profile (player has cached event data) ──────────────────────────────

function _renderFullProfile(bandaiId, name, eventData) {
    const evs = eventData.filter(ev => ev?.rounds);
    evs.sort((a, b) => (a._start_datetime || '').localeCompare(b._start_datetime || ''));

    let totalW = 0, totalL = 0, pts = 0;
    const ranks = [];

    for (const ev of evs) {
        for (const r of ev.rounds) { if (r.is_win) totalW++; else totalL++; }
        const rank = ev._rank ?? ev.user?.rank ?? null;
        if (rank != null) ranks.push(Number(rank));
        const mp = ev._match_points ?? (ev.user?.match_point != null ? Number(ev.user.match_point) : null);
        if (mp != null) pts += mp;
    }

    const total    = totalW + totalL;
    const winPct   = total > 0 ? (totalW / total * 100).toFixed(1) : '0.0';
    const bestRank = ranks.length ? Math.min(...ranks) : null;
    const avgRank  = ranks.length ? (ranks.reduce((a, b) => a + b, 0) / ranks.length).toFixed(1) : null;

    // Recent form — last 5 events
    const recentEvs = [...evs].slice(-5).reverse();
    const recentHtml = recentEvs.map(ev => {
        let w = 0, l = 0;
        for (const r of ev.rounds) { if (r.is_win) w++; else l++; }
        const pct = (w + l) > 0 ? ((w / (w + l)) * 100).toFixed(0) : 0;
        const color = pct >= 50 ? 'var(--win)' : 'var(--loss)';
        const date = ev._start_datetime ? ev._start_datetime.slice(0, 10) : '';
        return `<div class="profile-recent-event">
            <div class="profile-event-date">${date}</div>
            <div class="profile-event-name" title="${ev._event_name ?? ''}">${ev._event_name ?? 'Event'}</div>
            <div class="profile-event-record" style="color:${color}">${w}W–${l}L (${pct}%)</div>
        </div>`;
    }).join('');

    // H2H vs other tracked users
    const trackedUsers = App.usersWithToken.filter(u => u.bandaiId !== bandaiId);
    const h2hRows = trackedUsers.map(opp => {
        const oppCache = Object.values(loadCache(opp.bandaiId) || {});
        let w = 0, l = 0;
        for (const ev of oppCache) {
            if (!ev?.rounds) continue;
            for (const r of ev.rounds) {
                const pid = r.opponent_users?.[0]?.membership_number;
                if (pid !== bandaiId) continue;
                if (r.is_win) l++; else w++; // from profile player's perspective
            }
        }
        if (w + l === 0) return null;
        const t = w + l;
        const pct = (w / t * 100).toFixed(1);
        const color = parseFloat(pct) >= 50 ? 'var(--win)' : 'var(--loss)';
        return `<tr>
            <td><div class="player-cell">
                <div class="table-avatar">${_playerAvatar(opp.bandaiId, opp.name)}</div>
                <strong>${opp.name}</strong>
            </div></td>
            <td class="td-num" style="color:var(--win)">${w}</td>
            <td class="td-num" style="color:var(--loss)">${l}</td>
            <td class="td-num">${t}</td>
            <td class="td-pct" style="color:${color}">${pct}%</td>
        </tr>`;
    }).filter(Boolean).join('');

    // Store breakdown
    const storeMap = {};
    for (const ev of evs) {
        const s = ev._store_name;
        if (!s) continue;
        if (!storeMap[s]) storeMap[s] = { w: 0, l: 0, events: 0 };
        storeMap[s].events++;
        for (const r of ev.rounds) { if (r.is_win) storeMap[s].w++; else storeMap[s].l++; }
    }
    const storeRows = Object.entries(storeMap)
        .sort((a, b) => b[1].events - a[1].events)
        .map(([store, s]) => {
            const t = s.w + s.l;
            const pct = t > 0 ? (s.w / t * 100).toFixed(1) : '0.0';
            const color = parseFloat(pct) >= 50 ? 'var(--win)' : 'var(--loss)';
            return `<tr>
                <td>${store}</td>
                <td class="td-num">${s.events}</td>
                <td class="td-num" style="color:var(--win)">${s.w}</td>
                <td class="td-num" style="color:var(--loss)">${s.l}</td>
                <td class="td-pct" style="color:${color}">${pct}%</td>
            </tr>`;
        }).join('');

    const avatarDiv = `<div class="profile-avatar">${_playerAvatar(bandaiId, name)}</div>`;

    // ── Competitive titles this player holds ─────────────────────────────────
    computeCompetitiveBadges();
    const cb     = App.competitiveBadges;
    const titles = [];

    if (cb) {
        const fmtMonth = ym => {
            const [y, m] = ym.split('-');
            return new Date(+y, +m - 1).toLocaleString('default', { month: 'short', year: 'numeric' });
        };

        // Rei dos Piratas (all years)
        for (const [year, winner] of Object.entries(cb.reiDosPiratas)) {
            if (winner.bandaiId === bandaiId)
                titles.push({ icon: '☠️', label: 'Rei dos Piratas', sub: year, cls: 'title-rei' });
        }
        // Yonkou
        if (cb.yonkou.includes(bandaiId))
            titles.push({ icon: '🐉', label: 'Yonkou', sub: fmtMonth(cb.month), cls: 'title-yonkou' });
        // Shichibukai
        if (cb.shichibukai.includes(bandaiId))
            titles.push({ icon: '⚔️', label: 'Shichibukai', sub: fmtMonth(cb.month), cls: 'title-shichi' });
        // Almirante
        if (cb.almirante?.bandaiId === bandaiId)
            titles.push({ icon: '⚓', label: 'Almirante de Frota', sub: `#${cb.almirante.bestRank} at Regionals`, cls: 'title-almirante' });
    }

    const titlesHtml = titles.length ? `
        <div class="profile-titles-row">
            ${titles.map(t => `
                <div class="profile-title-chip ${t.cls}">
                    <span class="profile-title-icon">${t.icon}</span>
                    <div class="profile-title-text">
                        <span class="profile-title-name">${t.label}</span>
                        <span class="profile-title-sub">${t.sub}</span>
                    </div>
                </div>`).join('')}
        </div>` : '';

    // ── Individual achievement badges (unlocked only) ─────────────────────────
    const unlockedBadges = _computeAchievementBadges(evs, totalW, totalL);
    const achievHtml = unlockedBadges.length ? `
        <div class="profile-achieve-row">
            ${unlockedBadges.map(b => `
                <div class="profile-achieve-chip" title="${b.desc}">
                    <span class="profile-achieve-icon">${b.icon}</span>
                    <span class="profile-achieve-name">${b.title}</span>
                </div>`).join('')}
        </div>` : '';

    return `
        ${titlesHtml}
        ${achievHtml}

        <div class="profile-header">
            ${avatarDiv}
            <div class="profile-header-info">
                <div class="profile-name">${name}</div>
                <div class="profile-bandai-id" style="font-size:0.75rem;color:var(--muted);">${bandaiId}</div>
                <span class="profile-badge profile-badge-full">Full Data</span>
            </div>
        </div>

        <div class="stat-grid" style="margin:1.5rem 0 1rem;">
            <div class="stat-box"><div class="val w-val">${totalW}</div><div class="lbl">Wins</div></div>
            <div class="stat-box"><div class="val l-val">${totalL}</div><div class="lbl">Losses</div></div>
            <div class="stat-box"><div class="val pct-val">${winPct}%</div><div class="lbl">Win Rate</div></div>
            <div class="stat-box"><div class="val t-val">${evs.length}</div><div class="lbl">Tournaments</div></div>
            <div class="stat-box"><div class="val">${bestRank != null ? '#' + bestRank : '—'}</div><div class="lbl">Best Rank</div></div>
            <div class="stat-box"><div class="val">${avgRank != null ? '#' + avgRank : '—'}</div><div class="lbl">Avg Rank</div></div>
            <div class="stat-box"><div class="val">${pts}</div><div class="lbl">Match Pts</div></div>
        </div>

        ${recentHtml ? `
        <h3 class="profile-section-title">Recent Form (last 5)</h3>
        <div class="profile-recent-list">${recentHtml}</div>` : ''}

        ${h2hRows ? `
        <h3 class="profile-section-title">Head-to-Head vs Tracked Players</h3>
        <div class="table-wrap">
            <table>
                <thead><tr><th>Opponent</th><th>W</th><th>L</th><th>Total</th><th>Win%</th></tr></thead>
                <tbody>${h2hRows}</tbody>
            </table>
        </div>` : ''}

        ${storeRows ? `
        <h3 class="profile-section-title">Store Breakdown</h3>
        <div class="table-wrap">
            <table>
                <thead><tr><th>Store</th><th>Events</th><th>W</th><th>L</th><th>Win%</th></tr></thead>
                <tbody>${storeRows}</tbody>
            </table>
        </div>` : ''}
    `;
}

// ── Opponent profile (no cached data — derived from facing tracked players) ──

function _renderOpponentProfile(bandaiId, name) {
    const trackedUsers = App.usersWithToken;

    // Collect all rounds where this player appeared as opponent
    let wins = 0, losses = 0;
    const facedBy   = {};  // bandaiId → { name, w, l }
    const storeSet  = new Set();
    let lastSeen    = null;

    for (const u of trackedUsers) {
        const cached = Object.values(loadCache(u.bandaiId) || {});
        for (const ev of cached) {
            if (!ev?.rounds) continue;
            for (const r of ev.rounds) {
                const pid = r.opponent_users?.[0]?.membership_number;
                if (pid !== bandaiId) continue;
                // from profile player's perspective: flip win/loss
                if (r.is_win) losses++; else wins++;
                if (!facedBy[u.bandaiId]) facedBy[u.bandaiId] = { name: u.name, bandaiId: u.bandaiId, w: 0, l: 0 };
                if (r.is_win) facedBy[u.bandaiId].l++; else facedBy[u.bandaiId].w++;
                if (ev._store_name) storeSet.add(ev._store_name);
                const d = ev._start_datetime?.slice(0, 10);
                if (d && (!lastSeen || d > lastSeen)) lastSeen = d;
            }
        }
    }

    const total  = wins + losses;
    const winPct = total > 0 ? (wins / total * 100).toFixed(1) : '0.0';

    if (total === 0) {
        return `
            <div class="profile-header">
                <div class="profile-avatar">${_playerAvatar(bandaiId, name)}</div>
                <div class="profile-header-info">
                    <div class="profile-name">${name}</div>
                    <div style="font-size:0.75rem;color:var(--muted);">${bandaiId}</div>
                    <span class="profile-badge profile-badge-opponent">No match data found</span>
                </div>
            </div>`;
    }

    const facedRows = Object.values(facedBy).sort((a, b) => (b.w + b.l) - (a.w + a.l)).map(f => {
        const t = f.w + f.l;
        const pct = (f.w / t * 100).toFixed(1);
        const color = parseFloat(pct) >= 50 ? 'var(--win)' : 'var(--loss)';
        return `<tr>
            <td><div class="player-cell">
                <div class="table-avatar">${_playerAvatar(f.bandaiId, f.name)}</div>
                <strong>${f.name}</strong>
            </div></td>
            <td class="td-num" style="color:var(--win)">${f.w}</td>
            <td class="td-num" style="color:var(--loss)">${f.l}</td>
            <td class="td-num">${t}</td>
            <td class="td-pct" style="color:${color}">${pct}%</td>
        </tr>`;
    }).join('');

    const storesHtml = [...storeSet].sort().map(s =>
        `<span class="chip" style="cursor:default;">${s}</span>`).join('');

    return `
        <div class="profile-header">
            <div class="profile-avatar">${_playerAvatar(bandaiId, name)}</div>
            <div class="profile-header-info">
                <div class="profile-name">${name}</div>
                <div style="font-size:0.75rem;color:var(--muted);">${bandaiId}</div>
                <span class="profile-badge profile-badge-opponent">Opponent Data</span>
                ${lastSeen ? `<div style="font-size:0.72rem;color:var(--muted);margin-top:0.3rem;">Last seen: ${lastSeen}</div>` : ''}
            </div>
        </div>

        <div class="stat-grid" style="margin:1.5rem 0 1rem;">
            <div class="stat-box"><div class="val w-val">${wins}</div><div class="lbl">Wins</div></div>
            <div class="stat-box"><div class="val l-val">${losses}</div><div class="lbl">Losses</div></div>
            <div class="stat-box"><div class="val pct-val">${winPct}%</div><div class="lbl">Win Rate</div></div>
            <div class="stat-box"><div class="val t-val">${total}</div><div class="lbl">Total Rounds</div></div>
            <div class="stat-box"><div class="val">${Object.keys(facedBy).length}</div><div class="lbl">Tracked Players Faced</div></div>
        </div>

        ${facedRows ? `
        <h3 class="profile-section-title">Record vs Tracked Players</h3>
        <div class="table-wrap">
            <table>
                <thead><tr><th>Player</th><th>W</th><th>L</th><th>Total</th><th>Win%</th></tr></thead>
                <tbody>${facedRows}</tbody>
            </table>
        </div>` : ''}

        ${storesHtml ? `
        <h3 class="profile-section-title">Stores seen at</h3>
        <div class="chip-row" style="margin-top:0.5rem;">${storesHtml}</div>` : ''}
    `;
}

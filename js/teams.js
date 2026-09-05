// ── Teams / Worst Generation ────────────────────────────────────────────────
// Team registry is the single source of truth on the backend (user.teamId).
// This module derives team membership from the loaded directory + username map,
// then builds standings and team-vs-team H2H from the same cached rounds that
// power the Global Rankings tab.
//
// Requires: state.js, constants.js, utils.js, config.js, rankings.js (globals),
//           display-charts.js (destroyChart).

// ---------------------------------------------------------------------------
// Registry helpers
// ---------------------------------------------------------------------------

function teamUnassignedId() { return '__none__'; }

// Rebuild team lookups from the current team registry + profile directory.
// Every directory entry carries teamId, so we map bandaiName_lower → teamId.
function rebuildTeamLookups() {
    App.teamById = {};
    for (const t of App.teams || []) App.teamById[t.id] = t;
    const byBandai = {};
    for (const entry of Object.values(App.profileDirectory || {})) {
        if (entry && entry.teamId && entry.bandaiName) {
            byBandai[String(entry.bandaiName).toLowerCase()] = entry.teamId;
        }
    }
    App.teamByBandaiId = byBandai;
    return App.teamByBandaiId;
}

// Map a bandaiId (as it appears in rounds) to a team id, using the username map
// to resolve the id to a name, then the directory to resolve the name to a team.
function teamIdForBandaiId(bandaiId) {
    if (bandaiId == null) return null;
    const name = (App.usernameMap && App.usernameMap[bandaiId]) || null;
    if (!name) return null;
    return (App.teamByBandaiId || {})[String(name).toLowerCase()] || null;
}

function teamDisplay(teamId) {
    if (!teamId || teamId === teamUnassignedId()) return null;
    return App.teamById[teamId] || null;
}

// Fetch /teams and rebuild lookups. Returns the loaded array.
async function loadTeams() {
    try {
        const res = await fetch(`${AUTH_BASE}/teams`, { credentials: 'include' });
        if (!res.ok) return App.teams || [];
        const teams = await res.json();
        App.teams = Array.isArray(teams) ? teams : [];
        App.teamVersion++;
        rebuildTeamLookups();
    } catch (e) {
        console.warn('[Teams] Falha ao carregar /teams:', e);
    }
    return App.teams;
}

// ---------------------------------------------------------------------------
// Analytics — derived from cached rounds (mirrors rankings data flow)
// ---------------------------------------------------------------------------

// Build the same user/event view the rankings tab uses, then aggregate into
// per-team results and a team-vs-team matrix. Dedup mirrored caches so the
// same confrontation is counted once.
function buildTeamAnalytics() {
    rebuildTeamLookups();

    const allUsers = App.usersWithToken.map(u => ({
        ...u,
        events: Object.values(loadCache(u.bandaiId) || {})
            .filter(ev => ev?.rounds && ev.rounds.length > 0)
    })).filter(u => u.events.length > 0);

    // Honor the active rankings filter (periods/years/date/store/regionals).
    const filteredUsers = allUsers.map(u => ({
        ...u,
        events: _applyRankFilter(u.events)
    })).filter(u => u.events.length > 0);

    // teamId → aggregate
    const results = {};
    // ordered team list (registry order) plus the unassigned bucket
    const order = (App.teams || []).map(t => t.id);
    if (!order.includes(teamUnassignedId())) order.push(teamUnassignedId());
    for (const id of order) {
        results[id] = { teamId: id, w: 0, l: 0, events: 0, members: new Set(), memberCount: 0 };
    }

    // teamIdA → { teamIdB → { w, l } } — symmetric tracking with dedupe
    const h2h = {};
    const h2hOf = (a, b) => {
        if (!h2h[a]) h2h[a] = {};
        if (!h2h[a][b]) h2h[a][b] = { w: 0, l: 0 };
        return h2h[a][b];
    };

    // Confrontation dedupe: a round between (pidA, pidB) may appear in both
    // players' mirrored caches. Key on the unordered pair + event id so we count
    // it once. Best-effort — only works when we can recover both sides.
    const seenPairs = new Set();

    const pairKey = (a, b, eventId) => {
        const [x, y] = [String(a), String(b)].sort();
        return `${x}|${y}|${eventId}`;
    };

    let unassignedMembers = new Set();

    for (const u of filteredUsers) {
        for (const ev of u.events) {
            const eventId = ev.id || ev.event?.id || ev._event_id || null;
            for (const r of ev.rounds || []) {
                const meId   = u.bandaiId;
                const oppId  = r.opponent_users?.[0]?.membership_number;
                if (!oppId) continue;

                const myTeam   = teamIdForBandaiId(meId) || teamUnassignedId();
                const oppTeam  = teamIdForBandaiId(oppId) || teamUnassignedId();

                results[myTeam].events++;
                results[myTeam].members.add(meId);
                if (myTeam === teamUnassignedId()) unassignedMembers.add(meId);
                if (r.is_win) results[myTeam].w++; else results[myTeam].l++;

                // Team-vs-team tracking. Each confrontation appears once (in the
                // first player's cache we traverse). We record it symmetrically so
                // the matrix is order-independent regardless of which side's
                // mirrored cache runs first.
                if (myTeam !== oppTeam) {
                    const key = eventId ? pairKey(myTeam, oppTeam, eventId) : null;
                    if (key && seenPairs.has(key)) continue;
                    if (key) seenPairs.add(key);
                    const ab = h2hOf(myTeam, oppTeam);   // row=myTeam
                    const ba = h2hOf(oppTeam, myTeam);   // row=oppTeam
                    if (r.is_win) { ab.w++; ba.l++; } else { ab.l++; ba.w++; }
                }
            }
        }
    }

    for (const id of Object.keys(results)) {
        results[id].members = results[id].members.size
            ? [...results[id].members]
            : [];
        results[id].memberCount = results[id].members.length;
    }

    App.teamResults = results;
    App.teamH2H = h2h;

    return {
        results,
        h2h,
        order,
        unassignedCount: unassignedMembers.size,
        filteredCount: filteredUsers.length,
    };
}

// ---------------------------------------------------------------------------
// Rendering — Worst Generation tab
// ---------------------------------------------------------------------------

function renderWorstGeneration() {
    const tab = document.getElementById('worstGenTab');
    if (!tab) return;

    const data = buildTeamAnalytics();
    const teams = (App.teams || []).filter(t =>
        data.results[t.id] && data.results[t.id].memberCount > 0
    );

    // Summary strip
    const teamCount = teams.length;
    const unassignedCount = data.results[teamUnassignedId()]?.memberCount || 0;
    const totalPlayers = teamCount + unassignedCount;
    const totalMatches = Object.values(data.results).reduce((s, r) => s + r.w + r.l, 0);

    const summary = document.getElementById('worstGenSummary');
    if (summary) {
        summary.innerHTML = [
            _wgStat(`${teamCount}`, 'Teams'),
            _wgStat(`${totalPlayers}`, 'Players'),
            _wgStat(`${totalMatches}`, 'Matches'),
            _wgStat(`${totalPlayers ? Math.round(totalMatches / totalPlayers) : 0}`, 'Avg matches'),
        ].join('');
    }

    const tbody = document.getElementById('worstGenTableBody');
    if (tbody) {
        const sorted = teams
            .sort((a, b) => _wgSort(a, b, data.results));
        if (sorted.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="padding:1rem 0;color:var(--muted);text-align:center;">No teams have cached matches yet. Assign users to teams from the Admin panel.</td></tr>';
        } else {
            tbody.innerHTML = sorted.map((t, i) => _wgRow(t, i, data.results)).join('');
        }
    } else {
        // fallback: render into a simple container
    }

    renderTeamH2H(data);
}

function _wgSort(a, b, results) {
    const ra = results[a.id], rb = results[b.id];
    const pa = ra.w + ra.l ? ra.w / (ra.w + ra.l) : 0;
    const pb = rb.w + rb.l ? rb.w / (rb.w + rb.l) : 0;
    return pb - pa || (rb.w + rb.l) - (ra.w + ra.l);
}

function _wgRow(t, i, results) {
    const r = results[t.id];
    const total = r.w + r.l;
    const pct = total ? (r.w / total * 100) : 0;
    const color = t.color || '#3b82f6';
    const icon = t.icon || '🏴‍☠️';
    return `
        <tr>
            <td style="padding:0.45rem 0.6rem;text-align:center;font-weight:600;">${i + 1}</td>
            <td style="padding:0.45rem 0.6rem;">
                <div style="display:flex;align-items:center;gap:0.5rem;">
                    <span style="width:22px;height:22px;border-radius:6px;display:inline-flex;align-items:center;justify-content:center;background:${color};color:#fff;font-size:0.85rem;flex:none;">${icon}</span>
                    <strong>${_esc(t.name)}</strong>
                </div>
            </td>
            <td style="padding:0.45rem 0.6rem;text-align:center;">${r.memberCount}</td>
            <td style="padding:0.45rem 0.6rem;text-align:center;">${r.events}</td>
            <td style="padding:0.45rem 0.6rem;text-align:center;color:#22c55e;">${r.w}</td>
            <td style="padding:0.45rem 0.6rem;text-align:center;color:#ef4444;">${r.l}</td>
            <td style="padding:0.45rem 0.6rem;text-align:center;font-weight:700;">${pct.toFixed(1)}%</td>
        </tr>`;
}

function renderTeamH2H(data) {
    const container = document.getElementById('worstGenH2H');
    if (!container) return;
    const teamIds = (App.teams || []).map(t => t.id).filter(id =>
        data.results[id] && data.results[id].memberCount > 0
    );
    if (teamIds.length < 2) {
        container.innerHTML = '<p style="color:var(--muted);">Need at least 2 teams with cached matches to show head-to-head.</p>';
        return;
    }
    const idxMap = {};
    teamIds.forEach((id, i) => { idxMap[id] = i; });
    const n = teamIds.length;
    const matrix = Array.from({length: n}, () => Array.from({length: n}, () => ({w:0,l:0})));
    for (let i = 0; i < n; i++) {
        const a = teamIds[i];
        for (let j = 0; j < n; j++) {
            const b = teamIds[j];
            if (i === j) continue;
            const ab = data.h2h?.[a]?.[b];
            matrix[i][j].w = ab?.w || 0;
            matrix[i][j].l = ab?.l || 0;
        }
    }
    const headerCells = teamIds.map(id => {
        const t = App.teamById[id];
        return `<th style="padding:0.45rem 0.6rem;background:linear-gradient(135deg,var(--primary),#3d5472);color:white;font-family:'Cinzel',serif;font-size:0.7rem;text-align:center;white-space:nowrap;">${_esc(t?.name || id)}</th>`;
    }).join('');
    const bodyRows = teamIds.map((a, i) => {
        const t = App.teamById[a];
        const cells = teamIds.map((__, j) => {
            if (i === j) return `<td class="h2h-self">—</td>`;
            const {w, l} = matrix[i][j];
            if (w === 0 && l === 0) return `<td style="color:var(--muted);text-align:center;">-</td>`;
            const cls = w > l ? 'h2h-win' : (l > w ? 'h2h-loss' : '');
            return `<td class="${cls}">${w}–${l}</td>`;
        }).join('');
        const color = t?.color || '#3b82f6';
        const icon = t?.icon || '🏴‍☠️';
        return `<tr><td class="h2h-label"><span style="display:inline-flex;align-items:center;gap:0.35rem;"><span style="width:16px;height:16px;border-radius:4px;display:inline-flex;align-items:center;justify-content:center;background:${color};color:#fff;font-size:0.7rem;flex:none;">${icon}</span>${_esc(t?.name || a)}</span></td>${cells}</tr>`;
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

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function _wgStat(value, label) {
    return `<div class="stat-box" style="flex:1;min-width:120px;text-align:center;padding:0.9rem 1rem;background:var(--card);border:1px solid var(--border);border-radius:10px;">
        <div style="font-size:1.5rem;font-weight:700;font-family:'Cinzel',serif;color:var(--primary);">${value}</div>
        <div style="font-size:0.72rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.06em;">${label}</div>
    </div>`;
}

function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
        {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]
    ));
}

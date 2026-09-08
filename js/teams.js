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

function _wgResolveUsers(sourceUsers) {
    if (Array.isArray(sourceUsers)) return sourceUsers;
    if (sourceUsers && Array.isArray(sourceUsers.finalUsers)) return sourceUsers.finalUsers;

    if (typeof buildRankingsFilteredSnapshot === 'function') {
        try {
            const snapshot = buildRankingsFilteredSnapshot();
            if (snapshot && Array.isArray(snapshot.finalUsers)) return snapshot.finalUsers;
        } catch (e) {
            console.warn('[Teams] Failed to reuse rankings snapshot:', e);
        }
    }

    const allUsers = App.usersWithToken.map(u => ({
        ...u,
        events: Object.values(loadCache(u.bandaiId) || {})
            .filter(ev => ev?.rounds && ev.rounds.length > 0)
    })).filter(u => u.events.length > 0);

    return allUsers.map(u => ({
        ...u,
        events: _applyRankFilter(u.events)
    })).filter(u => u.events.length > 0);
}

function _wgParseColor(color) {
    const value = String(color || '').trim();
    if (!value) return { r: 0, g: 0, b: 0 };
    if (value.startsWith('#')) {
        const hex = value.slice(1);
        if (hex.length === 3) {
            return {
                r: parseInt(hex[0] + hex[0], 16),
                g: parseInt(hex[1] + hex[1], 16),
                b: parseInt(hex[2] + hex[2], 16),
            };
        }
        if (hex.length >= 6) {
            return {
                r: parseInt(hex.slice(0, 2), 16),
                g: parseInt(hex.slice(2, 4), 16),
                b: parseInt(hex.slice(4, 6), 16),
            };
        }
    }
    const m = value.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
    if (m) {
        return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) };
    }
    return { r: 0, g: 0, b: 0 };
}

function _wgMixColor(a, b, t, alpha = 0.88) {
    const c1 = _wgParseColor(a);
    const c2 = _wgParseColor(b);
    const mix = x => Math.round(c1[x] + (c2[x] - c1[x]) * Math.max(0, Math.min(1, t)));
    return `rgba(${mix('r')}, ${mix('g')}, ${mix('b')}, ${alpha})`;
}

function _wgThemeColors() {
    const root = getComputedStyle(document.documentElement);
    return {
        accent: (root.getPropertyValue('--accent').trim() || '#048A81'),
        win:    (root.getPropertyValue('--win').trim()    || '#28a745'),
        loss:   (root.getPropertyValue('--loss').trim()   || '#dc3545'),
        primary:(root.getPropertyValue('--primary').trim()|| '#2E4057'),
        muted:  (root.getPropertyValue('--muted').trim()  || '#6c757d'),
    };
}

function _wgHeatColor(pct, alpha = 0.86) {
    if (pct == null || Number.isNaN(pct)) return 'rgba(148, 163, 184, 0.14)';
    return _wgMixColor(_wgThemeColors().loss, _wgThemeColors().win, pct / 100, alpha);
}

function _wgRgba(color, alpha = 0.88) {
    const { r, g, b } = _wgParseColor(color);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function _wgBuildTrend(matches, teamIds) {
    const relevantTeams = new Set((teamIds || []).filter(Boolean));
    const dayMap = new Map();

    for (const match of matches || []) {
        const date = match?.date || null;
        if (!date) continue;
        let bucket = dayMap.get(date);
        if (!bucket) {
            bucket = { date, matches: [] };
            dayMap.set(date, bucket);
        }
        bucket.matches.push(match);
    }

    const days = [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date));
    const labels = [];
    const cumulative = [];
    const rolling = [];
    const totals = [];
    const activeCounts = [];
    const ROLLING_N = 5;
    const teamStats = new Map();
    const dailyAverages = [];

    const _avgTeamRate = () => {
        let sum = 0;
        let count = 0;
        for (const teamId of relevantTeams) {
            const stats = teamStats.get(teamId);
            const total = stats ? stats.w + stats.l : 0;
            if (!total) continue;
            sum += (stats.w / total) * 100;
            count++;
        }
        return count ? parseFloat((sum / count).toFixed(1)) : null;
    };

    for (const day of days) {
        for (const match of day.matches) {
            if (match.winnerId && relevantTeams.has(match.winnerId)) {
                if (!teamStats.has(match.winnerId)) teamStats.set(match.winnerId, { w: 0, l: 0 });
                teamStats.get(match.winnerId).w++;
            }
            if (match.loserId && relevantTeams.has(match.loserId)) {
                if (!teamStats.has(match.loserId)) teamStats.set(match.loserId, { w: 0, l: 0 });
                teamStats.get(match.loserId).l++;
            }
        }

        const avg = _avgTeamRate();
        labels.push(fmtDate(day.date));
        cumulative.push(avg);
        dailyAverages.push(avg);
        totals.push(day.matches.length);
        activeCounts.push([...relevantTeams].filter(teamId => {
            const stats = teamStats.get(teamId);
            return stats && (stats.w + stats.l > 0);
        }).length);

        const windowVals = dailyAverages.slice(Math.max(0, dailyAverages.length - ROLLING_N)).filter(v => v != null);
        rolling.push(windowVals.length ? parseFloat((windowVals.reduce((s, v) => s + v, 0) / windowVals.length).toFixed(1)) : null);
    }

    return { days, labels, cumulative, rolling, totals, activeCounts, rollingWindow: ROLLING_N };
}

function buildTeamAnalytics(finalUsers) {
    rebuildTeamLookups();

    const filteredUsers = _wgResolveUsers(finalUsers);

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

    const trend = _wgBuildTrend(filteredUsers);

    App.teamResults = results;
    App.teamH2H = h2h;

    return {
        results,
        h2h,
        order,
        trend,
        unassignedCount: unassignedMembers.size,
        filteredCount: filteredUsers.length,
    };
}

// ---------------------------------------------------------------------------
// Rendering — Worst Generation tab
// ---------------------------------------------------------------------------

function destroyWorstGenerationCharts() {
    destroyChart('wgStandings');
    destroyChart('wgTrend');
    destroyChart('wgH2H');
}

function _wgVisibleTeams(data) {
    return (App.teams || []).filter(t =>
        data.results[t.id] && data.results[t.id].memberCount > 0
    );
}

function renderWorstGenerationStandingsChart(data, sortedTeams) {
    const wrap = document.getElementById('worstGenStandingsWrap');
    const canvas = document.getElementById('chartWorstStandings');
    if (!canvas) return;
    destroyChart('wgStandings');
    if (!sortedTeams || sortedTeams.length === 0) {
        if (wrap) wrap.style.display = 'none';
        return;
    }
    if (wrap) wrap.style.display = '';

    const theme = _wgThemeColors();
    const labels = sortedTeams.map(t => t.name);
    const wins = sortedTeams.map(t => data.results[t.id].w);
    const losses = sortedTeams.map(t => data.results[t.id].l);

    App.charts['wgStandings'] = new Chart(canvas, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                { label: 'Wins', data: wins, backgroundColor: theme.win + 'cc', borderRadius: 4 },
                { label: 'Losses', data: losses, backgroundColor: theme.loss + 'cc', borderRadius: 4 },
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            indexAxis: 'y',
            scales: {
                x: {
                    stacked: true,
                    beginAtZero: true,
                    ticks: { precision: 0, font: { size: 10 }, color: theme.muted },
                    grid: { color: '#eee' }
                },
                y: {
                    stacked: true,
                    ticks: { font: { size: 10 }, color: theme.muted },
                    grid: { display: false }
                }
            },
            plugins: {
                legend: { position: 'bottom', labels: { font: { size: 11 }, color: theme.muted } },
                tooltip: {
                    callbacks: {
                        title: items => `Team: ${items[0].label}`,
                        label: ctx => `${ctx.dataset.label}: ${ctx.parsed.x}`,
                        footer: items => {
                            const team = sortedTeams[items[0].dataIndex];
                            const r = data.results[team.id];
                            const total = r.w + r.l;
                            const pct = total ? (r.w / total * 100).toFixed(1) : '0.0';
                            return [`Total matches: ${total}`, `Win rate: ${pct}%`];
                        }
                    }
                }
            }
        }
    });
}

function renderWorstGenerationTrendChart(data) {
    const canvas = document.getElementById('chartWorstTrend');
    if (!canvas) return;
    destroyChart('wgTrend');

    const trend = data.trend || {};
    if (!trend.labels || trend.labels.length === 0) return;

    const theme = _wgThemeColors();
    const pointRadius = trend.labels.length > 40 ? 0 : 3;

    App.charts['wgTrend'] = new Chart(canvas, {
        type: 'line',
        data: {
            labels: trend.labels,
            datasets: [
                {
                    label: 'Cumulative Win %',
                    data: trend.cumulative,
                    borderColor: theme.accent,
                    backgroundColor: theme.accent + '22',
                    fill: true,
                    tension: 0.3,
                    pointRadius,
                    pointHoverRadius: 5,
                    borderWidth: 2
                },
                {
                    label: `Rolling ${trend.rollingWindow || 5} Win %`,
                    data: trend.rolling,
                    borderColor: theme.primary,
                    backgroundColor: 'transparent',
                    fill: false,
                    tension: 0.3,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    borderWidth: 1.5,
                    borderDash: [5, 3]
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    ticks: {
                        font: { size: 9 },
                        color: theme.muted,
                        maxTicksLimit: 12,
                        maxRotation: 45
                    },
                    grid: { display: false }
                },
                y: {
                    min: 0,
                    max: 100,
                    ticks: {
                        callback: v => `${v}%`,
                        font: { size: 10 },
                        color: theme.muted
                    },
                    grid: { color: '#eee' }
                }
            },
            plugins: {
                legend: { position: 'bottom', labels: { font: { size: 11 }, color: theme.muted } },
                tooltip: {
                    callbacks: {
                        title: items => `Day: ${items[0].label}`,
                        label: ctx => {
                            if (ctx.datasetIndex === 0) {
                                return ` Cumulative: ${ctx.parsed.y}% (${trend.totals[ctx.dataIndex]} matches)`;
                            }
                            return ` Rolling ${trend.rollingWindow || 5}: ${ctx.parsed.y ?? '—'}%`;
                        }
                    }
                }
            }
        }
    });
}

function renderWorstGenerationH2HChart(data) {
    const canvas = document.getElementById('chartWorstH2H');
    if (!canvas) return;
    destroyChart('wgH2H');

    const visibleTeams = _wgVisibleTeams(data);
    if (visibleTeams.length < 2) return;

    const theme = _wgThemeColors();
    const teamNames = visibleTeams.map(t => t.name);
    const teamIds = visibleTeams.map(t => t.id);
    const cells = [];
    const teamCount = teamIds.length;
    const cellSize = ctx => {
        const area = ctx.chart.chartArea;
        if (!area) return 20;
        const side = Math.min(area.width / teamCount, area.height / teamCount);
        return Math.max(18, Math.min(34, side - 2));
    };

    for (let y = 0; y < teamCount; y++) {
        for (let x = 0; x < teamCount; x++) {
            const rowId = teamIds[y];
            const colId = teamIds[x];
            const rowName = teamNames[y];
            const colName = teamNames[x];
            if (rowId === colId) {
                cells.push({ x: colName, y: rowName, v: null, w: 0, l: 0, total: 0, self: true, rowId, colId });
                continue;
            }
            const matchup = data.h2h?.[rowId]?.[colId] || { w: 0, l: 0 };
            const total = matchup.w + matchup.l;
            cells.push({
                x: colName,
                y: rowName,
                v: total ? (matchup.w / total * 100) : null,
                w: matchup.w,
                l: matchup.l,
                total,
                self: false,
                rowId,
                colId,
            });
        }
    }

    App.charts['wgH2H'] = new Chart(canvas, {
        type: 'matrix',
        data: {
            datasets: [{
                label: 'Matchup win rate',
                data: cells,
                parsing: false,
                borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.9)',
                width: cellSize,
                height: cellSize,
                backgroundColor: ctx => {
                    const raw = ctx.raw || {};
                    if (raw.self) return 'rgba(148, 163, 184, 0.18)';
                    if (!raw.total) return 'rgba(148, 163, 184, 0.10)';
                    return _wgHeatColor(raw.v, 0.9);
                }
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            parsing: false,
            scales: {
                x: {
                    type: 'category',
                    labels: teamNames,
                    offset: true,
                    ticks: {
                        color: theme.muted,
                        font: { size: 9 },
                        autoSkip: false,
                        maxRotation: 45,
                        minRotation: 45
                    },
                    grid: { display: false }
                },
                y: {
                    type: 'category',
                    labels: teamNames,
                    offset: true,
                    reverse: true,
                    ticks: {
                        color: theme.muted,
                        font: { size: 9 },
                        autoSkip: false
                    },
                    grid: { display: false }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        title: items => {
                            const raw = items[0].raw || {};
                            return raw.self ? raw.y : `${raw.y} vs ${raw.x}`;
                        },
                        label: ctx => {
                            const raw = ctx.raw || {};
                            if (raw.self) return ' Same team';
                            if (!raw.total) return ' No matches';
                            return ` ${raw.w}W · ${raw.l}L · ${raw.v.toFixed(1)}% win rate`;
                        }
                    }
                }
            }
        }
    });
}

function renderWorstGeneration(finalUsers) {
    const tab = document.getElementById('worstGenTab');
    if (!tab) return;

    destroyWorstGenerationCharts();

    const data = buildTeamAnalytics(finalUsers);
    const visibleTeams = _wgVisibleTeams(data);
    const sortedTeams = [...visibleTeams].sort((a, b) => _wgSort(a, b, data.results));

    // Summary strip
    const teamCount = visibleTeams.length;
    const totalPlayers = data.filteredCount || 0;
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

    const standingsNote = document.getElementById('worstGenStandingsNote');
    if (standingsNote) {
        standingsNote.textContent = teamCount > 0
            ? 'Stacked wins and losses by team, sorted by win rate.'
            : 'No teams have cached matches yet. Assign users to teams from the Admin panel.';
    }

    const trendNote = document.getElementById('worstGenTrendNote');
    if (trendNote) {
        trendNote.textContent = data.trend?.labels?.length
            ? 'Cumulative and rolling win-rate lines across the filtered team snapshot.'
            : 'No chronological team activity found under the current filters.';
    }

    const h2hNote = document.getElementById('worstGenH2HNote');
    if (h2hNote) {
        h2hNote.textContent = teamCount >= 2
            ? 'Each cell shows the win rate for one team against another in the filtered snapshot.'
            : 'Need at least 2 teams with cached matches to show the heatmap.';
    }

    const tbody = document.getElementById('worstGenTableBody');
    if (tbody) {
        if (sortedTeams.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="padding:1rem 0;color:var(--muted);text-align:center;">No teams have cached matches yet. Assign users to teams from the Admin panel.</td></tr>';
        } else {
            tbody.innerHTML = sortedTeams.map((t, i) => _wgRow(t, i, data.results)).join('');
        }
    }

    renderWorstGenerationStandingsChart(data, sortedTeams);
    renderWorstGenerationTrendChart(data);
    renderWorstGenerationH2HChart(data);
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

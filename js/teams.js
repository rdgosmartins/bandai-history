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

    const allUsers = App.usersWithToken.map(u => ({
        ...u,
        events: Object.values(loadCache(u.bandaiId) || {})
            .filter(ev => ev?.rounds && ev.rounds.length > 0)
    })).filter(u => u.events.length > 0);

    if (typeof buildRankingsFilteredSnapshot === 'function') {
        try {
            const snapshot = buildRankingsFilteredSnapshot();
            if (snapshot && Array.isArray(snapshot.finalUsers) && snapshot.finalUsers.length > 0) {
                return snapshot.finalUsers;
            }
            if (snapshot && Array.isArray(snapshot.allUsers) && snapshot.allUsers.length > 0) {
                return snapshot.allUsers;
            }
        } catch (e) {
            console.warn('[Teams] Failed to reuse rankings snapshot:', e);
        }
    }

    return allUsers;
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
        filteredUsers,
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

async function renderWorstGeneration(finalUsers) {
    const tab = document.getElementById('worstGenTab');
    if (!tab) return;

    _wgEnsureBindings();
    destroyWorstGenerationCharts();

    const data = buildTeamAnalytics(finalUsers);
    App.lastWorstGenerationData = data;
    App.lastWorstGenerationUsers = Array.isArray(finalUsers) ? finalUsers : App.lastWorstGenerationUsers;

    if (!App.teamDashboardHydrated) {
        _wgHydrateFromUrl(data);
    }

    const visibleTeams = _wgVisibleTeams(data);
    const sortedTeams = _wgFilteredTeams(data);
    const compareCandidates = [...visibleTeams].sort((a, b) => a.name.localeCompare(b.name, 'en'));

    // Summary strip
    const teamCount = visibleTeams.length;
    const filteredCount = sortedTeams.length;
    const totalPlayers = data.filteredCount || 0;
    const totalMatches = Object.values(data.results).reduce((s, r) => s + r.w + r.l, 0);

    const summary = document.getElementById('worstGenSummary');
    if (summary) {
        summary.innerHTML = [
            _wgStat(`${teamCount}`, 'Teams'),
            _wgStat(`${filteredCount}`, 'Filtered'),
            _wgStat(`${totalPlayers}`, 'Players'),
            _wgStat(`${totalMatches}`, 'Matches'),
        ].join('');
    }

    const standingsNote = document.getElementById('worstGenStandingsNote');
    if (standingsNote) {
        standingsNote.textContent = teamCount > 0
            ? (filteredCount !== teamCount
                ? 'Filtered snapshot of team standings, sorted by the selected metric.'
                : 'Stacked wins and losses by team, sorted by the selected metric.')
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
            tbody.innerHTML = '<tr><td colspan="7" style="padding:1rem 0;color:var(--muted);text-align:center;">No teams match the current filters.</td></tr>';
        } else {
            tbody.innerHTML = sortedTeams.map((t, i) => _wgRow(t, i, data.results)).join('');
        }
    }

    _wgRenderWorstGenControls(compareCandidates);
    _wgRenderHoverCard(data);
    _wgRenderComparePanel(data);
    renderWorstGenerationStandingsChart(data, sortedTeams.length ? sortedTeams : visibleTeams);
    renderWorstGenerationTrendChart(data);
    renderWorstGenerationH2HChart(data);
    renderTeamH2H(data);
    _wgSetDetailTab(App.teamDetailTab || 'general');
    await _wgRenderTeamDetailModal(data);
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
    const isSelected = App.teamSelectedId === t.id;
    const isHovered = App.teamHoverId === t.id;
    const isCompare = App.teamCompareId === t.id;
    const rowBg = isSelected ? 'rgba(4,138,129,.08)' : (isHovered ? 'rgba(4,138,129,.04)' : 'transparent');
    const rowBorder = isSelected ? 'inset 0 0 0 1px rgba(4,138,129,.22)' : 'none';
    const nameSuffix = isSelected ? ' · selected' : (isCompare ? ' · compare' : '');
    return `
        <tr data-team-id="${_esc(t.id)}"
            style="cursor:pointer;background:${rowBg};box-shadow:${rowBorder};transition:background .15s ease, box-shadow .15s ease;"
            onclick='openWorstGenTeam(${JSON.stringify(String(t.id))})'
            onmouseenter='hoverWorstGenTeam(${JSON.stringify(String(t.id))})'
            onmouseleave='unhoverWorstGenTeam(${JSON.stringify(String(t.id))})'
            onkeydown='if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openWorstGenTeam(${JSON.stringify(String(t.id))}); }'
            tabindex="0"
            role="button"
            aria-label="Open team ${_esc(t.name)}">
            <td style="padding:0.45rem 0.6rem;text-align:center;font-weight:600;">${i + 1}${isSelected ? ' ★' : ''}</td>
            <td style="padding:0.45rem 0.6rem;">
                <div style="display:flex;align-items:center;gap:0.5rem;">
                    <span style="width:22px;height:22px;border-radius:6px;display:inline-flex;align-items:center;justify-content:center;background:${color};color:#fff;font-size:0.85rem;flex:none;">${icon}</span>
                    <strong>${_esc(t.name)}${nameSuffix}</strong>
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

function _wgTeamName(teamId) {
    return App.teamById?.[teamId]?.name || teamId || '—';
}

function _wgTeamIcon(teamId) {
    return App.teamById?.[teamId]?.icon || '🏴‍☠️';
}

function _wgTeamColor(teamId) {
    return App.teamById?.[teamId]?.color || '#3b82f6';
}

function _wgTeamSearchText(team, data) {
    const r = data.results?.[team.id] || { members: [] };
    const memberText = (r.members || []).map(id => {
        const display = App.usernameMap?.[id] || '';
        return `${id} ${display}`;
    }).join(' ');
    return `${team.id} ${team.name} ${memberText}`.toLowerCase();
}

function _wgTeamMembers(data, teamId) {
    const members = [];
    for (const u of data.filteredUsers || []) {
        if ((teamIdForBandaiId(u.bandaiId) || teamUnassignedId()) !== teamId) continue;
        let w = 0;
        let l = 0;
        let events = 0;
        let lastActive = null;
        for (const ev of u.events || []) {
            events++;
            if (ev._start_datetime) {
                const dt = new Date(ev._start_datetime).getTime();
                if (!lastActive || dt > lastActive) lastActive = dt;
            }
            for (const r of ev.rounds || []) {
                if (r.is_win) w++; else l++;
            }
        }
        const displayName = App.usernameMap?.[u.bandaiId] || u.name || u.bandaiId || '—';
        const total = w + l;
        members.push({
            bandaiId: u.bandaiId,
            name: displayName,
            events,
            w,
            l,
            total,
            winRate: total ? (w / total * 100) : 0,
            lastActive,
        });
    }
    members.sort((a, b) => b.events - a.events || b.total - a.total || a.name.localeCompare(b.name, 'en'));
    return members;
}

function _wgTeamEventHistory(data, teamId) {
    const history = new Map();
    for (const u of data.filteredUsers || []) {
        if ((teamIdForBandaiId(u.bandaiId) || teamUnassignedId()) !== teamId) continue;
        const memberName = App.usernameMap?.[u.bandaiId] || u.name || u.bandaiId || '—';
        for (const ev of u.events || []) {
            const key = String(ev.id || ev._event_id || ev._event_name || `${ev._start_datetime || 'event'}-${memberName}`);
            if (!history.has(key)) {
                history.set(key, {
                    key,
                    eventId: ev.id || ev._event_id || null,
                    name: ev._event_name || ev.event?.name || ev.event?.event_name || ev.event?.title || 'Event',
                    date: ev._start_datetime || null,
                    store: ev._store_name || ev.event?.organizer_name || ev.event?.store_name || ev.event?.shop_name || ev.event?.hosted_by || '—',
                    members: new Set(),
                    w: 0,
                    l: 0,
                });
            }
            const row = history.get(key);
            row.members.add(memberName);
            for (const r of ev.rounds || []) {
                if (r.is_win) row.w++; else row.l++;
            }
        }
    }
    return [...history.values()].sort((a, b) => (new Date(b.date || 0) - new Date(a.date || 0)) || b.w - a.w || b.l - a.l);
}

async function _wgLoadDeckMapEvents() {
    const cache = App.teamDeckMetaCache;
    if (cache && cache.__version === App.teamVersion && Array.isArray(cache.__deckmaps)) {
        return cache.__deckmaps;
    }
    if (cache && cache.__version === App.teamVersion && cache.__loading) {
        return cache.__loading;
    }
    const loading = (async () => {
        try {
            const r = await apiFetch('/deckmaps');
            if (!r.ok) return [];
            const data = await r.json();
            return Array.isArray(data) ? data : [];
        } catch {
            return [];
        }
    })();
    App.teamDeckMetaCache = { __version: App.teamVersion, __loading: loading };
    const deckmaps = await loading;
    App.teamDeckMetaCache = { __version: App.teamVersion, __deckmaps: deckmaps };
    return deckmaps;
}

async function _wgTeamDeckMeta(data, teamId) {
    const members = new Set();
    for (const m of _wgTeamMembers(data, teamId)) {
        if (m.bandaiId) members.add(String(m.bandaiId).toLowerCase());
        if (m.name) members.add(String(m.name).toLowerCase());
    }
    if (!members.size) {
        return { total: 0, eventCount: 0, leaders: [], stores: [] };
    }

    const deckmaps = await _wgLoadDeckMapEvents();
    const leaderCounts = new Map();
    const storeCounts = new Map();
    const eventIds = new Set();

    for (const ev of deckmaps || []) {
        const eventId = String(ev.id || ev._id || ev.eventId || `${ev.date || ''}-${ev.storeId || ''}`);
        let matched = false;
        for (const en of ev.entries || []) {
            const player = String(en.playerId || en.playerName || en.bandaiId || en.name || '').toLowerCase();
            if (!player || !members.has(player)) continue;
            matched = true;
            const leaderId = String(en.leaderId || '');
            leaderCounts.set(leaderId, (leaderCounts.get(leaderId) || 0) + 1);
            const store = ev.storeName || ev.storeId || ev.store || ev.store?.name || '—';
            storeCounts.set(store, (storeCounts.get(store) || 0) + 1);
        }
        if (matched) eventIds.add(eventId);
    }

    const toList = map => [...map.entries()].sort((a, b) => b[1] - a[1]).map(([id, count]) => ({
        id,
        name: typeof _dmLeaderName === 'function' ? (_dmLeaderName(id) || id || '—') : (id || '—'),
        img: typeof _dmLeaderImgUrl === 'function' ? _dmLeaderImgUrl(id) : '',
        count,
    }));

    return {
        total: [...leaderCounts.values()].reduce((s, n) => s + n, 0),
        eventCount: eventIds.size,
        leaders: toList(leaderCounts).slice(0, 6),
        stores: [...storeCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([name, count]) => ({ name, count })),
    };
}

function _wgSearchPanelText(team, data) {
    return _wgTeamSearchText(team, data);
}

function _wgSortValue(team, data, sortKey) {
    const r = data.results?.[team.id] || { w: 0, l: 0, events: 0, memberCount: 0 };
    const total = r.w + r.l;
    const wr = total ? (r.w / total * 100) : 0;
    if (sortKey === 'name') return team.name.toLowerCase();
    if (sortKey === 'losses') return r.l;
    if (sortKey === 'events') return r.events;
    if (sortKey === 'members') return r.memberCount;
    if (sortKey === 'wins') return r.w;
    return wr;
}

function _wgSortTeams(a, b, data) {
    const sortKey = App.teamSort || 'wr';
    const av = _wgSortValue(a, data, sortKey);
    const bv = _wgSortValue(b, data, sortKey);
    if (sortKey === 'name') return String(av).localeCompare(String(bv), 'en');
    if (bv !== av) return bv - av;
    return a.name.localeCompare(b.name, 'en');
}

function _wgFilteredTeams(data) {
    const q = String(App.teamQuery || '').trim().toLowerCase();
    return _wgVisibleTeams(data)
        .filter(team => !q || _wgSearchPanelText(team, data).includes(q))
        .sort((a, b) => _wgSortTeams(a, b, data));
}

function _wgTeamCardStats(teamId, data) {
    const r = data.results?.[teamId] || { w: 0, l: 0, events: 0, memberCount: 0, members: [] };
    const total = r.w + r.l;
    const wr = total ? (r.w / total * 100) : 0;
    return { r, total, wr };
}

function _wgSyncUrlState(replace = true) {
    const url = new URL(window.location.href);
    if (App.teamSelectedId) url.searchParams.set('teamId', App.teamSelectedId); else url.searchParams.delete('teamId');
    if (App.teamCompareId) url.searchParams.set('compareTeamId', App.teamCompareId); else url.searchParams.delete('compareTeamId');
    const next = `${url.pathname}${url.search ? `?${url.searchParams.toString()}` : ''}${url.hash}`;
    if (replace) history.replaceState({}, '', next);
    else history.pushState({}, '', next);
}

function _wgHydrateFromUrl(data) {
    const params = new URLSearchParams(window.location.search);
    const teamId = params.get('teamId');
    const compareTeamId = params.get('compareTeamId');
    if (teamId && data.results?.[teamId]) App.teamSelectedId = teamId;
    if (compareTeamId && data.results?.[compareTeamId] && compareTeamId !== App.teamSelectedId) {
        App.teamCompareId = compareTeamId;
    }
    if (App.teamCompareId === App.teamSelectedId) App.teamCompareId = null;
    App.teamDashboardHydrated = true;
}

function _wgEnsureBindings() {
    if (App.teamDashboardBound) return;
    App.teamDashboardBound = true;
    window.addEventListener('popstate', () => {
        App.teamDashboardHydrated = false;
        if (Array.isArray(App.lastWorstGenerationUsers)) {
            renderWorstGeneration(App.lastWorstGenerationUsers);
        }
    });
    window.addEventListener('keydown', e => {
        if (e.key === 'Escape' && document.getElementById('teamDetailModal')?.style.display !== 'none') {
            clearWorstGenSelection();
        }
    });
}

function _wgSetDetailTab(tab) {
    App.teamDetailTab = tab || 'general';
    const buttons = document.querySelectorAll('[data-team-detail-tab]');
    buttons.forEach(btn => {
        const active = btn.getAttribute('data-team-detail-tab') === App.teamDetailTab;
        btn.style.background = active ? 'var(--primary)' : 'var(--card)';
        btn.style.color = active ? '#fff' : 'var(--text)';
        btn.style.borderColor = active ? 'var(--primary)' : 'var(--border)';
    });
    const panes = document.querySelectorAll('[data-team-detail-pane]');
    panes.forEach(pane => {
        pane.style.display = pane.getAttribute('data-team-detail-pane') === App.teamDetailTab ? '' : 'none';
    });
}

function _wgRenderHoverCard(data) {
    const card = document.getElementById('worstGenHoverCard');
    if (!card) return;
    const teamId = App.teamHoverId || App.teamSelectedId;
    if (!teamId || !data.results?.[teamId]) {
        card.style.display = 'none';
        card.innerHTML = '';
        return;
    }
    const team = App.teamById?.[teamId];
    const { r, total, wr } = _wgTeamCardStats(teamId, data);
    const members = _wgTeamMembers(data, teamId).slice(0, 4);
    card.style.display = '';
    card.innerHTML = `
        <div style="padding:1rem 1.1rem;">
            <div style="display:flex;justify-content:space-between;gap:1rem;align-items:flex-start;flex-wrap:wrap;">
                <div style="display:flex;align-items:center;gap:.8rem;">
                    <span style="width:34px;height:34px;border-radius:10px;display:inline-flex;align-items:center;justify-content:center;background:${_wgTeamColor(teamId)};color:#fff;font-size:1rem;flex:none;">${_wgTeamIcon(teamId)}</span>
                    <div>
                        <div style="font-size:1rem;font-weight:700;">${_esc(team?.name || teamId)}</div>
                        <div style="font-size:.76rem;color:var(--muted);">${r.memberCount} player${r.memberCount === 1 ? '' : 's'} · ${r.events} events</div>
                    </div>
                </div>
                <div style="text-align:right;min-width:120px;">
                    <div style="font-size:1.6rem;font-weight:800;color:var(--primary);">${wr.toFixed(1)}%</div>
                    <div style="font-size:.72rem;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;">Win rate</div>
                </div>
            </div>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:.6rem;margin-top:.9rem;">
                ${_wgStat(`${r.w}`, 'Wins')}
                ${_wgStat(`${r.l}`, 'Losses')}
                ${_wgStat(`${total}`, 'Matches')}
                ${_wgStat(`${r.memberCount}`, 'Players')}
            </div>
            <div style="margin-top:.85rem;display:flex;flex-wrap:wrap;gap:.5rem;">
                ${members.map(m => `<span style="display:inline-flex;align-items:center;gap:.35rem;padding:.35rem .55rem;border:1px solid var(--border);border-radius:999px;font-size:.74rem;background:var(--bg);">${_esc(m.name)}</span>`).join('') || '<span style="color:var(--muted);font-size:.78rem;">No members matched the current snapshot.</span>'}
            </div>
        </div>`;
}

function _wgRenderComparePanel(data) {
    const panel = document.getElementById('worstGenComparePanel');
    if (!panel) return;
    const leftId = App.teamSelectedId;
    const rightId = App.teamCompareId;
    if (!leftId || !rightId || leftId === rightId || !data.results?.[leftId] || !data.results?.[rightId]) {
        panel.style.display = 'none';
        panel.innerHTML = '';
        return;
    }

    const a = App.teamById?.[leftId] || { id: leftId, name: leftId };
    const b = App.teamById?.[rightId] || { id: rightId, name: rightId };
    const ra = data.results[leftId];
    const rb = data.results[rightId];
    const pctA = ra.w + ra.l ? (ra.w / (ra.w + ra.l) * 100).toFixed(1) : '0.0';
    const pctB = rb.w + rb.l ? (rb.w / (rb.w + rb.l) * 100).toFixed(1) : '0.0';
    const aLeads = parseFloat(pctA) > parseFloat(pctB);
    const bLeads = parseFloat(pctB) > parseFloat(pctA);
    const h2h = data.h2h?.[leftId]?.[rightId] || { w: 0, l: 0 };
    const h2hTotal = h2h.w + h2h.l;
    const h2hPct = h2hTotal ? (h2h.w / h2hTotal * 100).toFixed(1) : '—';

    function box(team, r, pct, leads, accent) {
        return `
            <div style="background:var(--bg);border:1px solid ${leads ? accent : 'var(--border)'};border-radius:14px;padding:1rem;box-shadow:${leads ? '0 0 0 1px rgba(4,138,129,.12)' : 'none'};">
                <div style="display:flex;justify-content:space-between;gap:.75rem;align-items:flex-start;">
                    <div>
                        <div style="font-size:1rem;font-weight:700;">${_esc(team.name)}</div>
                        <div style="font-size:.75rem;color:var(--muted);">${r.memberCount} player${r.memberCount === 1 ? '' : 's'} · ${r.events} events</div>
                    </div>
                    <div style="text-align:right;">
                        <div style="font-size:1.55rem;font-weight:800;color:${leads ? accent : 'var(--primary)'};">${pct}%</div>
                        <div style="font-size:.7rem;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;">Win rate</div>
                    </div>
                </div>
                <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.55rem;margin-top:.9rem;">
                    ${_wgStat(`${r.w}`, 'Wins')}
                    ${_wgStat(`${r.l}`, 'Losses')}
                </div>
                <div style="margin-top:.85rem;">
                    <div style="display:flex;justify-content:space-between;gap:.4rem;font-size:.75rem;margin-bottom:.35rem;color:var(--muted);">
                        <span>${leads ? 'Leads' : 'Trail'}</span><span>${pct}%</span>
                    </div>
                    <div style="height:10px;background:var(--border);border-radius:999px;overflow:hidden;">
                        <div style="height:100%;width:${pct}%;background:${accent};border-radius:999px;"></div>
                    </div>
                </div>
            </div>`;
    }

    panel.style.display = '';
    panel.innerHTML = `
        <div style="padding:1rem 1.1rem;">
            <div style="display:flex;justify-content:space-between;gap:1rem;align-items:flex-end;flex-wrap:wrap;margin-bottom:1rem;">
                <div>
                    <div style="font-size:1rem;font-weight:700;">Compare teams</div>
                    <div style="font-size:.76rem;color:var(--muted);">Head-to-head snapshot for the selected pairing.</div>
                </div>
                <div style="font-size:.78rem;color:var(--muted);">${_esc(a.name)} ${aLeads ? 'leads' : bLeads ? 'trails' : 'is tied'} ${_esc(b.name)} · H2H ${h2h.w}–${h2h.l} (${h2hPct}%)</div>
            </div>
            <div class="compare-cols" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:1rem;align-items:start;">
                ${box(a, ra, pctA, aLeads, 'var(--win)')}
                ${box(b, rb, pctB, bLeads, 'var(--loss)')}
            </div>
        </div>`;
}

async function _wgRenderTeamDetailModal(data) {
    const modal = document.getElementById('teamDetailModal');
    const teamId = App.teamSelectedId;
    if (!modal || !teamId || !data.results?.[teamId]) {
        if (modal) modal.style.display = 'none';
        document.body.style.overflow = '';
        return;
    }

    const team = App.teamById?.[teamId] || { id: teamId, name: teamId, icon: '🏴‍☠️', color: '#3b82f6' };
    const stats = _wgTeamCardStats(teamId, data);
    const members = _wgTeamMembers(data, teamId);
    const history = _wgTeamEventHistory(data, teamId).slice(0, 6);
    const recent = history.length
        ? history.map(ev => {
            const total = ev.w + ev.l;
            const pct = total ? (ev.w / total * 100).toFixed(1) : '0.0';
            const memberList = [...ev.members].slice(0, 4).join(', ');
            return `
                <div style="background:var(--bg);border:1px solid var(--border);border-radius:12px;padding:.9rem 1rem;">
                    <div style="display:flex;justify-content:space-between;gap:1rem;flex-wrap:wrap;align-items:flex-start;">
                        <div>
                            <div style="font-weight:700;">${_esc(ev.name)}</div>
                            <div style="font-size:.74rem;color:var(--muted);">${_esc(ev.store || '—')} · ${ev.date ? new Date(ev.date).toLocaleDateString('pt-BR') : '—'}</div>
                        </div>
                        <div style="text-align:right;">
                            <div style="font-size:1.1rem;font-weight:800;color:var(--primary);">${ev.w}–${ev.l}</div>
                            <div style="font-size:.72rem;color:var(--muted);">${pct}% WR</div>
                        </div>
                    </div>
                    <div style="font-size:.74rem;color:var(--muted);margin-top:.4rem;">Players: ${_esc(memberList || '—')}</div>
                </div>`;
        }).join('')
        : '<div style="color:var(--muted);font-size:.8rem;text-align:center;padding:1rem 0;">No recent events found for this team.</div>';

    const deckMeta = await _wgTeamDeckMeta(data, teamId);
    if (App.teamSelectedId !== teamId) return;

    document.getElementById('teamDetailIcon').textContent = team.icon || '🏴‍☠️';
    document.getElementById('teamDetailName').textContent = team.name || teamId;
    document.getElementById('teamDetailPlayerCount').textContent = `${stats.r.memberCount} player${stats.r.memberCount === 1 ? '' : 's'} · ${stats.r.events} events`;

    const generalBody = document.getElementById('teamDetailGeneralBody');
    if (generalBody) {
        generalBody.innerHTML = `
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:.75rem;">
                ${_wgStat(`${stats.r.memberCount}`, 'Players')}
                ${_wgStat(`${stats.r.events}`, 'Events')}
                ${_wgStat(`${stats.r.w}`, 'Wins')}
                ${_wgStat(`${stats.r.l}`, 'Losses')}
                ${_wgStat(`${stats.wr.toFixed(1)}%`, 'Win Rate')}
            </div>
            <div style="margin-top:1rem;padding:1rem;border:1px solid var(--border);border-radius:12px;background:var(--bg);">
                <div style="font-size:.8rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:.55rem;">Quick notes</div>
                <div style="font-size:.82rem;color:var(--text);line-height:1.6;">${_esc(team.name)} is currently tracked from cached rounds and the current team registry. Use the other tabs to inspect the roster, deck meta, and event history.</div>
            </div>`;
    }

    const rosterBody = document.getElementById('teamDetailRosterBody');
    if (rosterBody) {
        rosterBody.innerHTML = members.length
            ? members.map(m => {
                const lastActive = m.lastActive ? new Date(m.lastActive).toLocaleDateString('pt-BR') : '—';
                return `
                    <tr>
                        <td style="padding:.5rem .4rem;border-bottom:1px solid var(--border);">
                            <div style="font-weight:600;">${_esc(m.name)}</div>
                            <div style="font-size:.72rem;color:var(--muted);">${_esc(m.bandaiId || '')}</div>
                        </td>
                        <td style="padding:.5rem .4rem;border-bottom:1px solid var(--border);text-align:center;">${m.events}</td>
                        <td style="padding:.5rem .4rem;border-bottom:1px solid var(--border);text-align:center;color:var(--win);">${m.w}</td>
                        <td style="padding:.5rem .4rem;border-bottom:1px solid var(--border);text-align:center;color:var(--loss);">${m.l}</td>
                        <td style="padding:.5rem .4rem;border-bottom:1px solid var(--border);text-align:center;font-weight:700;">${m.winRate.toFixed(1)}%</td>
                        <td style="padding:.5rem .4rem;border-bottom:1px solid var(--border);text-align:center;color:var(--muted);">${lastActive}</td>
                    </tr>`;
            }).join('')
            : '<tr><td colspan="6" style="padding:1rem 0;color:var(--muted);text-align:center;">No roster data available.</td></tr>';
    }

    const metaBody = document.getElementById('teamDetailMetaBody');
    if (metaBody) {
        const leaders = deckMeta.leaders || [];
        const stores = deckMeta.stores || [];
        metaBody.innerHTML = `
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:.75rem;margin-bottom:1rem;">
                ${_wgStat(`${deckMeta.eventCount || 0}`, 'Deck events')}
                ${_wgStat(`${deckMeta.total || 0}`, 'Deck entries')}
                ${_wgStat(`${leaders.length}`, 'Top leaders')}
                ${_wgStat(`${stores.length}`, 'Top stores')}
            </div>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:1rem;">
                <div style="background:var(--bg);border:1px solid var(--border);border-radius:12px;padding:.9rem 1rem;">
                    <div style="font-size:.78rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:.6rem;">Top leaders</div>
                    ${leaders.length ? leaders.map(item => `
                        <div style="display:flex;align-items:center;gap:.6rem;padding:.4rem 0;border-bottom:1px solid var(--border);">
                            ${item.img ? `<img src="${item.img}" alt="" style="width:34px;border-radius:6px;flex:none;" onerror="this.style.display='none'">` : `<span style="width:34px;height:34px;border-radius:6px;display:inline-flex;align-items:center;justify-content:center;background:var(--border);flex:none;">🎴</span>`}
                            <div style="flex:1;min-width:0;">
                                <div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${_esc(item.name)}</div>
                                <div style="font-size:.72rem;color:var(--muted);">${item.count} deck${item.count === 1 ? '' : 's'}</div>
                            </div>
                        </div>`).join('') : '<div style="color:var(--muted);font-size:.8rem;">No deck meta available.</div>'}
                </div>
                <div style="background:var(--bg);border:1px solid var(--border);border-radius:12px;padding:.9rem 1rem;">
                    <div style="font-size:.78rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:.6rem;">Top stores</div>
                    ${stores.length ? stores.map(item => `
                        <div style="display:flex;justify-content:space-between;gap:1rem;padding:.4rem 0;border-bottom:1px solid var(--border);">
                            <div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${_esc(item.name)}</div>
                            <div style="color:var(--muted);font-size:.78rem;">${item.count}</div>
                        </div>`).join('') : '<div style="color:var(--muted);font-size:.8rem;">No deck meta available.</div>'}
                </div>
            </div>`;
    }

    const recentBody = document.getElementById('teamDetailRecentMatches');
    if (recentBody) recentBody.innerHTML = recent;

    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    _wgSetDetailTab(App.teamDetailTab || 'general');
}

function _wgRerender() {
    if (Array.isArray(App.lastWorstGenerationUsers)) {
        renderWorstGeneration(App.lastWorstGenerationUsers);
    }
}

function onWorstGenQueryChange(value) {
    App.teamQuery = String(value || '');
    _wgRerender();
}

function onWorstGenSortChange(value) {
    App.teamSort = String(value || 'wr');
    _wgRerender();
}

function onWorstGenCompareChange(value) {
    const next = value ? String(value) : '';
    App.teamCompareId = next || null;
    if (App.teamSelectedId && App.teamSelectedId === App.teamCompareId) App.teamCompareId = null;
    _wgSyncUrlState(true);
    _wgRerender();
}

function clearWorstGenSelection() {
    App.teamSelectedId = null;
    App.teamCompareId = null;
    App.teamHoverId = null;
    App.teamDetailTab = 'general';
    _wgSyncUrlState(true);
    _wgRerender();
}

function openWorstGenTeam(teamId) {
    if (!teamId) return;
    App.teamSelectedId = teamId;
    if (App.teamCompareId === teamId) App.teamCompareId = null;
    App.teamDetailTab = 'general';
    App.teamDashboardHydrated = true;
    _wgSyncUrlState(true);
    _wgRerender();
}

function hoverWorstGenTeam(teamId) {
    App.teamHoverId = teamId || null;
    _wgRenderHoverCard(App.lastWorstGenerationData || { results: {} });
}

function unhoverWorstGenTeam(teamId) {
    if (App.teamHoverId === teamId) App.teamHoverId = null;
    _wgRenderHoverCard(App.lastWorstGenerationData || { results: {} });
}

function setWorstGenDetailTab(tab) {
    App.teamDetailTab = tab || 'general';
    _wgSetDetailTab(App.teamDetailTab);
}

function _wgRenderWorstGenControls(teams) {
    const queryEl = document.getElementById('worstGenQuery');
    const sortEl = document.getElementById('worstGenSort');
    const compareEl = document.getElementById('worstGenCompareSelect');
    if (queryEl && queryEl.value !== (App.teamQuery || '')) queryEl.value = App.teamQuery || '';
    if (sortEl && sortEl.value !== (App.teamSort || 'wr')) sortEl.value = App.teamSort || 'wr';
    if (!compareEl) return;

    const current = App.teamCompareId || '';
    const options = ['<option value="">— none —</option>'];
    for (const team of teams || []) {
        options.push(`<option value="${_esc(team.id)}">${_esc(team.name)}</option>`);
    }
    compareEl.innerHTML = options.join('');
    compareEl.value = current && teams.some(t => t.id === current) ? current : '';
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

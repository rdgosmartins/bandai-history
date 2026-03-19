// ── Yoko Stats Tab ───────────────────────────────────────────────────────────

async function loadYokoTab() {
    if (App.yokoLoading) return;
    App.yokoLoading = true;

    const grid   = document.getElementById('yokoGrid');
    const status = document.getElementById('yokoStatus');

    grid.innerHTML   = '<div class="yoko-fetching"><span class="yoko-spinner"></span> Fetching live events for Yoko team…</div>';
    status.style.display = 'none';

    // Find Yoko users (those with tokens whose names match a Yoko player)
    const yokoUsers = App.usersWithToken.filter(u =>
        YOKO_PLAYERS.some(n => u.name.toLowerCase().includes(n))
    );

    if (yokoUsers.length === 0) {
        grid.innerHTML = '<div class="yoko-no-live">No Yoko team members with tokens found in the loaded player file.</div>';
        App.yokoLoading = false;
        return;
    }

    // Fetch live events for all Yoko users in parallel
    const BASE = `${BANDAI_API_BASE}/api/user/my/event?favorite=0&game_title_id=&limit=1000&offset=0`;
    const LIVE_TABS = [
        `${BASE}&past_event_display_flg=0&selected_tab=1`,
        `${BASE}&past_event_display_flg=0&selected_tab=2`,
        `${BASE}&past_event_display_flg=0&selected_tab=3`,
    ];

    const playerResults = await Promise.all(yokoUsers.map(async u => {
        // Fetch all live tabs in parallel per user
        const tabResults = await Promise.all(
            LIVE_TABS.map(url =>
                fetch(url, { headers: { 'X-Authentication': u.token, 'X-Accept-Version': 'v1', 'Accept': 'application/json, text/plain, */*' } })
                    .then(r => r.ok ? r.json().then(j => j?.success?.events ?? []) : [])
                    .catch(() => [])
            )
        );

        // Deduplicate events by ID
        const evMap = new Map();
        for (const evList of tabResults) {
            for (const ev of evList) {
                if (!evMap.has(ev.id)) evMap.set(ev.id, ev);
            }
        }
        const allEvents = [...evMap.values()];

        // Filter to live/open/running events only
        const liveEvents = allEvents.filter(ev => {
            const s = (ev.status_name ?? ev.status ?? '').toLowerCase();
            return s === 'running' || s === 'open' || s === 'live' || s === 'started' || s === 'in progress';
        });

        if (liveEvents.length === 0) return { user: u, events: [] };

        // For each live event, fetch round details from cache or API
        const enriched = await Promise.all(liveEvents.map(async ev => {
            // Check cache first
            const cache = loadCache(u.bandaiId);
            const cached = cache?.[String(ev.id)];
            if (cached && cached.rounds) {
                return {
                    id:      ev.id,
                    name:    ev.name ?? ev.event_name ?? ev.title ?? cached._event_name ?? 'Event',
                    store:   ev.organizer_name ?? ev.organizer ?? ev.store_name ?? cached._store_name ?? '',
                    date:    ev.start_datetime ?? cached._start_datetime ?? '',
                    status:  ev.status_name ?? ev.status ?? '',
                    rounds:  cached.rounds,
                    rank:    cached._rank ?? cached.user?.rank ?? null,
                    matchPts: cached._match_points ?? cached.user?.match_point ?? null,
                };
            }
            // Try to fetch detail
            try {
                const baseHeaders = {
                    'X-Authentication': u.token,
                    'X-Accept-Version': 'v1',
                    'Accept': 'application/json, text/plain, */*',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                    'Origin': 'https://www.bandai-tcg-plus.com',
                    'Referer': 'https://www.bandai-tcg-plus.com/'
                };
                const r = await fetch(
                    `${BANDAI_API_BASE}/api/user/my/event/${ev.id}`,
                    { headers: baseHeaders }
                );
                if (!r.ok) return null;
                const detail = (await r.json())?.success?.event;
                if (!detail) return null;
                return {
                    id:      ev.id,
                    name:    ev.name ?? ev.event_name ?? detail.name ?? 'Event',
                    store:   ev.organizer_name ?? detail.organizer_name ?? '',
                    date:    ev.start_datetime ?? detail.start_datetime ?? '',
                    status:  ev.status_name ?? detail.status_name ?? '',
                    rounds:  detail.rounds ?? [],
                    rank:    detail.user?.rank ?? null,
                    matchPts: detail.user?.match_point ?? null,
                };
            } catch { return null; }
        }));

        return { user: u, events: enriched.filter(Boolean) };
    }));

    // Build result: only players with live events
    const withLive = playerResults.filter(p => p.events.length > 0);

    // Update status bar
    const total  = yokoUsers.length;
    const active = withLive.length;
    status.style.display = 'flex';
    status.innerHTML = `
        <span><strong>${active}</strong> / ${total} Yoko players in a live event</span>
        <span style="margin-left:auto;font-size:0.76rem;color:var(--muted);">Updated: ${new Date().toLocaleTimeString()}</span>
    `;

    if (withLive.length === 0) {
        grid.innerHTML = '<div class="yoko-no-live">&#128268; No Yoko team members are currently in a live event.<br><span style="font-size:0.8rem;">Try refreshing when an event is running.</span></div>';
        App.yokoLoading = false;
        return;
    }

    // Render cards — sort by most rounds played (most active first)
    withLive.sort((a, b) => {
        const aRounds = a.events.reduce((s, e) => s + e.rounds.length, 0);
        const bRounds = b.events.reduce((s, e) => s + e.rounds.length, 0);
        return bRounds - aRounds;
    });

    grid.innerHTML = withLive.map(p => renderYokoPlayerCard(p)).join('');
    App.yokoLoading = false;
}

function renderYokoPlayerCard({ user, events }) {
    // Aggregate total W/L across all live events for this player
    let totalW = 0, totalL = 0;
    for (const ev of events) {
        for (const r of ev.rounds ?? []) { if (r.is_win) totalW++; else totalL++; }
    }
    const totalGames = totalW + totalL;
    const wrPct = totalGames > 0 ? Math.round(totalW / totalGames * 100) : 0;
    const wrColor = wrPct >= 60 ? 'var(--win)' : wrPct >= 40 ? 'var(--accent)' : 'var(--loss)';

    const eventsHtml = events.map(ev => {
        const rounds = ev.rounds ?? [];
        let w = 0, l = 0;
        for (const r of rounds) { if (r.is_win) w++; else l++; }

        const dateFmt  = ev.date  ? new Date(ev.date).toLocaleDateString('en-GB', { day:'2-digit', month:'short' }) : '';
        const storeFmt = ev.store ? `<span class="yoko-ev-meta-pill">&#128205; ${ev.store}</span>` : '';
        const rankFmt  = ev.rank  != null ? `<span class="yoko-ev-meta-pill rank-pill">&#127942; #${ev.rank}</span>` : '';
        const ptsFmt   = ev.matchPts != null ? `<span class="yoko-ev-meta-pill">&#9889; ${ev.matchPts}pts</span>` : '';
        const datePill = dateFmt ? `<span class="yoko-ev-meta-pill">&#128197; ${dateFmt}</span>` : '';

        const pills = rounds.map(r => {
            const opp = r.opponent_users?.[0]?.player_name
                     ?? App.usernameMap?.[r.opponent_users?.[0]?.membership_number]
                     ?? r.opponent_users?.[0]?.membership_number
                     ?? '???';
            const gw  = r.win_count  != null ? r.win_count  : (r.is_win ? 1 : 0);
            const gl  = r.lose_count != null ? r.lose_count : (r.is_win ? 0 : 1);
            return `<div class="yoko-round-pill ${r.is_win ? 'win' : 'loss'}">
                <span class="yoko-round-pill-rnd">R${r.round_no ?? '?'}</span>
                <span class="yoko-round-pill-res">${r.is_win ? 'WIN' : 'LOSS'}</span>
                <span class="yoko-round-pill-score">${gw}–${gl}</span>
                <span class="yoko-round-pill-opp">${opp}</span>
            </div>`;
        }).join('') || '<span style="font-size:0.75rem;color:var(--muted);">No rounds yet</span>';

        return `
        <div class="yoko-live-event">
            <div class="yoko-live-event-title">${ev.name}<span class="live-badge">LIVE</span></div>
            <div class="yoko-live-event-meta">${datePill}${storeFmt}${rankFmt}${ptsFmt}</div>
            <div class="yoko-round-pills">${pills}</div>
        </div>`;
    }).join('');

    return `
    <div class="yoko-player-card">
        <div class="yoko-player-header">
            <div class="yoko-player-avatar">${_playerAvatar(user.bandaiId, user.name)}</div>
            <div class="yoko-player-info">
                <span class="yoko-player-name">${playerNameLink(user.name)}</span>
                <div class="yoko-player-record">
                    <span class="yoko-w">${totalW}W</span>
                    <span class="yoko-sep">/</span>
                    <span class="yoko-l">${totalL}L</span>
                    ${totalGames > 0 ? `
                    <div class="yoko-wr-track">
                        <div class="yoko-wr-fill" style="width:${wrPct}%;background:${wrColor};"></div>
                    </div>
                    <span class="yoko-wr-pct" style="color:${wrColor};">${wrPct}%</span>` : ''}
                </div>
            </div>
        </div>
        <div class="yoko-player-events">${eventsHtml}</div>
    </div>`;
}

// ── Competitive Badges Board ─────────────────────────────────────────────────

function renderYokoBadges() {
    const grid = document.getElementById('yokoBadgesGrid');
    if (!grid) return;

    computeCompetitiveBadges();
    const cb = App.competitiveBadges;

    if (!cb) {
        grid.innerHTML = '<p class="yoko-empty-hint">Load the username map and fetch data to see competitive titles.</p>';
        return;
    }

    const now         = new Date();
    const currentYear = now.getFullYear();
    const BADGE_YEARS = [2024, 2025, 2026];

    const fmtMonth = ym => {
        const [y, m] = ym.split('-');
        return new Date(+y, +m - 1).toLocaleString('default', { month: 'long', year: 'numeric' });
    };
    const monthLabel = cb.month ? fmtMonth(cb.month) : '—';

    // ── Rei dos Piratas banner ───────────────────────────────────────────────
    const reiSlots = BADGE_YEARS.map(year => {
        const pending = year >= currentYear;
        const w       = cb.reiDosPiratas[year];
        if (pending) return `
            <div class="hof-slot hof-slot-pending">
                <div class="hof-year">${year}</div>
                <div class="hof-avatar-wrap"><div class="hof-avatar hof-avatar-mystery">?</div></div>
                <div class="hof-slot-name">In progress</div>
                <div class="hof-slot-stat">—</div>
            </div>`;
        if (!w) return `
            <div class="hof-slot hof-slot-pending">
                <div class="hof-year">${year}</div>
                <div class="hof-avatar-wrap"><div class="hof-avatar hof-avatar-mystery">—</div></div>
                <div class="hof-slot-name">No data</div>
                <div class="hof-slot-stat">—</div>
            </div>`;
        return `
            <div class="hof-slot">
                <div class="hof-year">${year}</div>
                <div class="hof-avatar-wrap hof-crown">
                    <div class="hof-avatar">${_playerAvatar(w.bandaiId, w.name)}</div>
                </div>
                <div class="hof-slot-name">${playerNameLink(w.name)}</div>
                <div class="hof-slot-stat">${(w.winRate * 100).toFixed(1)}% WR &nbsp;·&nbsp; ${w.w}W/${w.l}L</div>
            </div>`;
    }).join('');

    const reiBanner = `
        <div class="hof-banner hof-rei">
            <div class="hof-banner-header">
                <span class="hof-banner-icon">☠️</span>
                <div>
                    <div class="hof-banner-title">Rei dos Piratas</div>
                    <div class="hof-banner-sub">Best win rate of the year · awarded after Dec 31</div>
                </div>
            </div>
            <div class="hof-slots">${reiSlots}</div>
        </div>`;

    // ── Yonkou + Shichibukai row ─────────────────────────────────────────────
    const rankItems = (list, rankings, offset) => list.map((id, i) => {
        const name = App.usernameMap[id] || id;
        const stat = rankings?.find(p => p.bandaiId === id);
        const wr   = stat ? `${(stat.winRate * 100).toFixed(0)}%` : '';
        return `
            <div class="hof-rank-row">
                <span class="hof-rank-num">#${offset + i + 1}</span>
                <div class="hof-rank-avatar">${_playerAvatar(id, name)}</div>
                <span class="hof-rank-name">${playerNameLink(name)}</span>
                ${wr ? `<span class="hof-rank-wr">${wr}</span>` : ''}
            </div>`;
    }).join('');

    const emptyRows = (n, offset) => Array.from({ length: n }, (_, i) => `
        <div class="hof-rank-row hof-rank-empty">
            <span class="hof-rank-num">#${offset + i + 1}</span>
            <div class="hof-rank-avatar hof-avatar-mystery" style="width:32px;height:32px;font-size:0.75rem;">—</div>
            <span class="hof-rank-name">—</span>
        </div>`).join('');

    const yonkouRows   = rankItems(cb.yonkou, cb.monthRankings, 0)
                       + emptyRows(4 - cb.yonkou.length, cb.yonkou.length);
    const shichibuRows = rankItems(cb.shichibukai, cb.monthRankings, 4)
                       + emptyRows(7 - cb.shichibukai.length, 4 + cb.shichibukai.length);

    // History: past months excluding the current one already shown
    const historyEntries = (cb.history || []).slice(1); // skip first = current month

    const historyTableRows = historyEntries.map(entry => {
        const label = fmtMonth(entry.month);
        const yNames = entry.yonkou.map(id => App.usernameMap[id] || id);
        const sNames = entry.shichibukai.map(id => App.usernameMap[id] || id);
        return `<tr>
            <td class="hof-hist-month">${label}</td>
            <td class="hof-hist-names">${yNames.map(n => `<span class="hof-hist-chip yonkou-chip">${playerNameLink(n)}</span>`).join('')}</td>
            <td class="hof-hist-names">${sNames.map(n => `<span class="hof-hist-chip shichi-chip">${playerNameLink(n)}</span>`).join('')}</td>
        </tr>`;
    }).join('');

    const historyHtml = historyEntries.length ? `
        <div class="hof-history-wrap">
            <button class="hof-history-toggle" onclick="this.closest('.hof-history-wrap').classList.toggle('open')">
                <span class="hof-history-toggle-label">📜 History (${historyEntries.length} months)</span>
                <span class="hof-history-toggle-icon">▼</span>
            </button>
            <div class="hof-history-body">
                <table class="hof-history-table">
                    <thead><tr><th>Month</th><th>🐉 Yonkou</th><th>⚔️ Shichibukai</th></tr></thead>
                    <tbody>${historyTableRows}</tbody>
                </table>
            </div>
        </div>` : '';

    const monthRow = `
        <div class="hof-month-row">
            <div class="hof-title-card hof-yonkou">
                <div class="hof-title-card-header">
                    <span>🐉</span>
                    <div>
                        <div class="hof-title-card-name">Yonkou</div>
                        <div class="hof-title-card-sub">${monthLabel}</div>
                    </div>
                </div>
                <div class="hof-rank-list">${yonkouRows}</div>
            </div>
            <div class="hof-title-card hof-shichi">
                <div class="hof-title-card-header">
                    <span>⚔️</span>
                    <div>
                        <div class="hof-title-card-name">Shichibukai</div>
                        <div class="hof-title-card-sub">${monthLabel}</div>
                    </div>
                </div>
                <div class="hof-rank-list">${shichibuRows}</div>
            </div>
        </div>
        ${historyHtml}`;

    // ── Almirante de Frota banner ────────────────────────────────────────────
    const alm = cb.almirante;
    const almInner = alm ? `
        <div class="hof-almirante-inner">
            <div class="hof-alm-avatar">${_playerAvatar(alm.bandaiId, alm.name)}</div>
            <div class="hof-alm-info">
                <div class="hof-alm-name">${playerNameLink(alm.name)}</div>
                <div class="hof-alm-stat">Best Regional placement: <strong>#${alm.bestRank}</strong>${alm.eventName ? ` &nbsp;·&nbsp; ${alm.eventName}` : ''}</div>
            </div>
        </div>` : `<div class="hof-alm-empty">No Regional data available yet</div>`;

    const almBanner = `
        <div class="hof-banner hof-almirante">
            <div class="hof-banner-header">
                <span class="hof-banner-icon">⚓</span>
                <div>
                    <div class="hof-banner-title">Almirante de Frota</div>
                    <div class="hof-banner-sub">Best placement at a Regional event</div>
                </div>
            </div>
            ${almInner}
        </div>`;

    grid.innerHTML = `<div class="yoko-hall">${reiBanner}${monthRow}${almBanner}</div>`;
}

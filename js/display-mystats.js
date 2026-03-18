// ── Shared stat helpers ─────────────────────────────────────────────────────

// ── ROI helpers ─────────────────────────────────────────────────────────────
// Prize structure: winner (x-0) gets 40% of pot; all x-1 players split 60%.
// x-1 player count is estimated as the number of rounds played (standard Swiss approximation).
function computeEventRoi(ev) {
    if (!ev?.rounds || !ev._entry_fee || !ev._applicant_count) return null;
    const fee       = ev._entry_fee;
    const players   = ev._applicant_count;
    const pot       = fee * players;
    const rounds    = ev.rounds.length;
    let evW = 0, evL = 0;
    for (const r of ev.rounds) { if (r.is_win) evW++; else evL++; }

    let prize = 0;
    if (evL === 0) {
        // Undefeated — winner takes 40%
        prize = pot * 0.40;
    } else if (evL === 1) {
        // x-1 — splits 60% equally with other x-1 players (estimated as rounds played)
        const x1count = Math.max(1, rounds);
        prize = (pot * 0.60) / x1count;
    }
    // Otherwise no prize

    const net = prize - fee;
    const roi = (net / fee) * 100;
    return { fee, players, pot, prize, net, roi, currency: ev._entry_fee_currency ?? '' };
}

function computeRoiSummary(eventData) {
    let totalFee = 0, totalPrize = 0, count = 0;
    let currency = null;
    for (const ev of eventData) {
        const r = computeEventRoi(ev);
        if (!r) continue;
        totalFee   += r.fee;
        totalPrize += r.prize;
        count++;
        if (!currency && r.currency) currency = r.currency;
    }
    if (count === 0) return { totalRoi: null, netTotal: null, currency: null };
    const netTotal  = totalPrize - totalFee;
    const totalRoi  = (netTotal / totalFee) * 100;
    return { totalRoi, netTotal, currency };
}

function computeGameStats(rounds) {
    let gameWins = 0, gameLosses = 0, twoZeroWins = 0, clutchWins = 0, chokes = 0, allTwoOne = 0;
    for (const r of (rounds || [])) {
        const gw = r.win_count  != null ? r.win_count  : (r.is_win ? 1 : 0);
        const gl = r.lose_count != null ? r.lose_count : (r.is_win ? 0 : 1);
        gameWins   += gw;
        gameLosses += gl;
        if (r.is_win  && gl === 0) twoZeroWins++;
        if (r.is_win  && gl >= 1) { clutchWins++; allTwoOne++; }
        if (!r.is_win && gw >= 1) { chokes++;     allTwoOne++; }
    }
    return { gameWins, gameLosses, twoZeroWins, clutchWins, chokes, allTwoOne };
}

function computeRollingForm(eventData) {
    const evs = [...(eventData || [])]
        .filter(ev => ev?.rounds && ev._start_datetime)
        .sort((a, b) => new Date(a._start_datetime) - new Date(b._start_datetime));
    function pct(slice) {
        let w = 0, l = 0;
        for (const ev of slice) for (const r of ev.rounds) { if (r.is_win) w++; else l++; }
        const t = w + l;
        return t > 0 ? w / t * 100 : null;
    }
    return { last5: pct(evs.slice(-5)), last10: pct(evs.slice(-10)) };
}

// ── Streaks ────────────────────────────────────────────────────────────────

function computeStreaks(eventData) {
    const evs = [...(eventData || [])].filter(ev => ev?.rounds && ev._start_datetime);
    evs.sort((a, b) => new Date(a._start_datetime) - new Date(b._start_datetime));
    const rounds = [];
    for (const ev of evs) for (const r of ev.rounds) rounds.push(r.is_win);
    if (!rounds.length) return { current: 0, type: null, bestWin: 0, worstLoss: 0 };

    let bestWin = 0, worstLoss = 0, curW = 0, curL = 0;
    for (const isWin of rounds) {
        if (isWin) { curW++; curL = 0; if (curW > bestWin) bestWin = curW; }
        else       { curL++; curW = 0; if (curL > worstLoss) worstLoss = curL; }
    }
    const type = rounds[rounds.length - 1] ? 'W' : 'L';
    let current = 0;
    for (let i = rounds.length - 1; i >= 0; i--) {
        if (rounds[i] === (type === 'W')) current++; else break;
    }
    return { current, type, bestWin, worstLoss };
}

function displayStreaks(streaks) {
    const el = document.getElementById('streakStats');
    if (!streaks || streaks.current === 0) { el.innerHTML = ''; return; }
    const color = streaks.type === 'W' ? 'var(--win)' : 'var(--loss)';
    el.innerHTML = `<div class="streak-grid">
        <div class="stat-box"><div class="val" style="color:${color}">${streaks.current}${streaks.type}</div><div class="lbl">Current Streak</div></div>
        <div class="stat-box"><div class="val w-val">${streaks.bestWin}</div><div class="lbl">Best Win Streak</div></div>
        <div class="stat-box"><div class="val l-val">${streaks.worstLoss}</div><div class="lbl">Worst Loss Streak</div></div>
    </div>`;
}

// ── Display ────────────────────────────────────────────────────────────────

function displayResults(userName, totalW, totalL, periodMap, playerMap, eventData) {
    const total  = totalW + totalL;
    const winPct = total > 0 ? (totalW / total * 100).toFixed(1) : '0.0';

    document.getElementById('overallStats').innerHTML = `
        <div class="stat-box"><div class="val w-val">${totalW}</div><div class="lbl">Wins</div></div>
        <div class="stat-box"><div class="val l-val">${totalL}</div><div class="lbl">Losses</div></div>
        <div class="stat-box"><div class="val t-val">${total}</div><div class="lbl">Total</div></div>
        <div class="stat-box"><div class="val pct-val">${winPct}%</div><div class="lbl">Win Rate</div></div>`;

    // Rolling form badges appended to the stat grid
    const form = computeRollingForm(eventData);
    const overallFloat = parseFloat(winPct);
    function formBadge(pct, label) {
        if (pct === null) return '';
        const color = pct > overallFloat ? 'var(--win)' : pct < overallFloat ? 'var(--loss)' : 'var(--muted)';
        return `<span style="display:inline-block;font-size:0.7rem;font-weight:700;
            background:${color}22;color:${color};border-radius:999px;
            padding:0.15rem 0.5rem;margin:0.15rem 0.1rem;">L${label}: ${pct.toFixed(1)}%</span>`;
    }
    document.getElementById('overallStats').insertAdjacentHTML('beforeend', `
        <div class="stat-box" style="grid-column:span 2;">
            <div style="font-size:0.65rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--muted);margin-bottom:0.4rem;">Recent Form</div>
            <div>${formBadge(form.last5, '5')}${formBadge(form.last10, '10')}</div>
        </div>`);

    // Game Stats grid
    const allRounds = (eventData || []).flatMap(ev => ev?.rounds || []);
    const gs = computeGameStats(allRounds);
    const gameTotal = gs.gameWins + gs.gameLosses;
    const gamePct   = gameTotal > 0 ? (gs.gameWins / gameTotal * 100).toFixed(1) : null;
    const twoZeroR  = totalW > 0 ? (gs.twoZeroWins / totalW * 100).toFixed(1) : null;

    // ROI summary across all events with fee data
    const roiSummary = computeRoiSummary(eventData || []);
    const roiColor   = roiSummary.totalRoi === null ? 'var(--muted)'
        : roiSummary.totalRoi >= 0 ? 'var(--win)' : 'var(--loss)';
    const currency   = roiSummary.currency ?? '';
    const roiStr     = roiSummary.totalRoi !== null
        ? (roiSummary.totalRoi >= 0 ? '+' : '') + roiSummary.totalRoi.toFixed(1) + '%' : '—';
    const netStr     = roiSummary.netTotal !== null
        ? (roiSummary.netTotal >= 0 ? '+' : '') + roiSummary.netTotal.toFixed(2) : '—';

    const gameStatsEl = document.getElementById('gameStats');
    if (gameStatsEl) {
        gameStatsEl.innerHTML = `
            <div class="stat-box"><div class="val pct-val">${gamePct !== null ? gamePct + '%' : '—'}</div><div class="lbl">Game Win %</div></div>
            <div class="stat-box"><div class="val pct-val">${twoZeroR !== null ? twoZeroR + '%' : '—'}</div><div class="lbl">2-0 Rate</div></div>
            <div class="stat-box"><div class="val" style="color:${roiColor}">${roiStr}</div><div class="lbl">Avg ROI</div></div>
            <div class="stat-box"><div class="val" style="color:${roiColor};font-size:1.4rem;">${netStr}</div><div class="lbl">Net ${currency}</div></div>`;
    }

    const streaks = computeStreaks(eventData);
    displayStreaks(streaks);

    const periodBody = document.getElementById('periodBody');
    periodBody.innerHTML = '';
    for (const p of SET_PERIODS) {
        const s = periodMap[p.name] || { w: 0, l: 0 };
        if (s.w === 0 && s.l === 0) continue;
        const t   = s.w + s.l;
        const pct = (s.w / t * 100).toFixed(1);
        const tr  = document.createElement('tr');
        tr.innerHTML = `<td>${p.name}</td>
            <td class="td-num">${s.w}</td><td class="td-num">${s.l}</td>
            <td class="td-num">${t}</td><td class="td-pct">${pct}%</td>`;
        periodBody.appendChild(tr);
    }

    // Build per-player event count and match history
    const playerEventsCount = {};
    const opponentHistory   = {};
    for (const ev of (eventData || [])) {
        if (!ev?.rounds) continue;
        const dateStr = ev._start_datetime ? ev._start_datetime.slice(0, 10) : '—';
        const evName  = ev._event_name ?? ev.event?.series_title ?? ev.event?.name ?? '—';
        const seenThisEv = new Set();
        const evOpponents = new Map();
        for (const r of ev.rounds) {
            const pid  = r.opponent_users?.[0]?.membership_number;
            const pName = r.opponent_users?.[0]?.player_name?.trim();
            if (!pid) continue;
            // Enrich username map from round data (always up-to-date)
            if (pName && !App.usernameMap[pid]) App.usernameMap[pid] = pName;
            if (!seenThisEv.has(pid)) {
                seenThisEv.add(pid);
                playerEventsCount[pid] = (playerEventsCount[pid] || 0) + 1;
            }
            if (!evOpponents.has(pid)) evOpponents.set(pid, { w: 0, l: 0, gw: 0, gl: 0 });
            const opp = evOpponents.get(pid);
            if (r.is_win) opp.w++; else opp.l++;
            // Game-level scores (win_count / lose_count within the match)
            opp.gw += r.win_count  ?? (r.is_win ? 1 : 0);
            opp.gl += r.lose_count ?? (r.is_win ? 0 : 1);
        }
        for (const [pid, res] of evOpponents) {
            if (!opponentHistory[pid]) opponentHistory[pid] = [];
            opponentHistory[pid].push({ dateStr, evName, w: res.w, l: res.l, gw: res.gw, gl: res.gl });
        }
    }
    App.opponentMatchHistory = opponentHistory;

    // ── Bogeyman / Victim ───────────────────────────────────────────────────
    displayRivalry(playerMap);

    const playerBody = document.getElementById('playerBody');
    playerBody.innerHTML = '';
    const sorted = Object.entries(playerMap)
        .sort((a, b) => (b[1][0] + b[1][1]) - (a[1][0] + a[1][1]));
    for (const [pid, res] of sorted) {
        const tag = App.usernameMap[pid] || pid;
        const [w, l] = res;
        const t   = w + l;
        const pct = (w / t * 100).toFixed(1);
        const evCount = playerEventsCount[pid] || 0;
        const tr  = document.createElement('tr');
        if (pid === App.selectedPlayerId) tr.classList.add('row-highlight');
        tr.innerHTML = `<td>${tag}</td>
            <td class="td-num">${w}</td><td class="td-num">${l}</td>
            <td class="td-num">${t}</td><td class="td-pct">${pct}%</td>
            <td class="td-num">${evCount}</td>`;
        tr.style.cursor = 'pointer';
        tr.onclick = () => openOpponentModal(pid);
        playerBody.appendChild(tr);
    }

    // Top Opponents chart
    {
        const TOP_N = 10;
        const topOpp = sorted.slice(0, TOP_N);
        const oppWin  = getComputedStyle(document.documentElement).getPropertyValue('--win').trim()   || '#28a745';
        const oppLoss = getComputedStyle(document.documentElement).getPropertyValue('--loss').trim()  || '#dc3545';
        const oppMuted= getComputedStyle(document.documentElement).getPropertyValue('--muted').trim() || '#6c757d';
        destroyChart('topOpponents');
        App.charts['topOpponents'] = new Chart(document.getElementById('chartTopOpponents'), {
            type: 'bar',
            data: {
                labels: topOpp.map(([pid]) => App.usernameMap[pid] || pid),
                datasets: [
                    { label: 'Wins',   data: topOpp.map(([,r]) => r[0]), backgroundColor: oppWin  + 'cc', borderRadius: 4 },
                    { label: 'Losses', data: topOpp.map(([,r]) => r[1]), backgroundColor: oppLoss + 'cc', borderRadius: 4 }
                ]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { stacked: true, ticks: { font: { size: 10 }, color: oppMuted }, grid: { color: '#eee' } },
                    y: { stacked: true, ticks: { font: { size: 10 }, color: oppMuted }, grid: { display: false } }
                },
                plugins: {
                    legend: { position: 'bottom', labels: { font: { size: 11 }, color: oppMuted } },
                    tooltip: { callbacks: {
                        afterBody: items => {
                            const [pid] = topOpp[items[0].dataIndex];
                            const [w, l] = playerMap[pid];
                            const t = w + l;
                            return [`Win rate: ${(w / t * 100).toFixed(1)}%  (${t} matches)`];
                        }
                    }}
                }
            }
        });
    }

    // Tournament history table
    if (eventData) {
        const tourneyBody = document.getElementById('tourneyBody');
        tourneyBody.innerHTML = '';
        const evList = [...eventData].reverse(); // newest first

        for (const ev of evList) {
            if (!ev?.rounds) continue;
            let evW = 0, evL = 0, evGW = 0, evGL = 0;
            for (const r of ev.rounds) {
                if (r.is_win) evW++; else evL++;
                evGW += r.win_count  ?? (r.is_win ? 1 : 0);
                evGL += r.lose_count ?? (r.is_win ? 0 : 1);
            }

            const dateStr   = fmtDate(ev._start_datetime);
            const storeName = ev._store_name ?? ev.event?.organizer_name ?? ev.event?.organizer
                ?? ev.event?.store_name ?? ev.event?.shop_name ?? null;
            const storeStr  = storeName ?? '—';
            const evName    = ev._event_name ?? ev.event?.series_title ?? ev.event?.name ?? '—';
            const rankStr   = ev._rank   != null ? `#${ev._rank}`   : '—';
            const ptsStr    = ev._match_points != null ? ev._match_points : '—';
            const appStr    = ev._applicant_count != null ? ev._applicant_count : '—';
            const isLive    = ev._status === 'running' || ev._status === 'open';
            const liveBadge = isLive ? ' <span class="live-badge">LIVE</span>' : '';
            const resultColor = evW > evL ? 'var(--win)' : evW < evL ? 'var(--loss)' : 'var(--muted)';
            const cols = 8; // total column count

            // ── Summary row ─────────────────────────────────────────────────
            const tr = document.createElement('tr');
            tr.className = 'tourney-row' + (isLive ? ' live-row' : '');
            tr.innerHTML = `<td>${dateStr}${liveBadge}</td>
                <td>${storeStr}</td>
                <td>${evName}</td>
                <td class="td-num" style="color:${resultColor};font-weight:600">${evW}-${evL}</td>
                <td class="td-num">${evGW}-${evGL}</td>
                <td class="td-num">${ptsStr}</td>
                <td class="td-num">${rankStr}</td>
                <td class="td-num">${appStr}</td>`;

            // Build rounds HTML once, insert/remove dynamically on click
            let roundsHtml = `<div class="tourney-rounds-wrap">
                <table class="tourney-rounds-table">
                    <thead><tr>
                        <th>Round</th><th>Opponent</th><th>Result</th><th>Games</th>
                    </tr></thead><tbody>`;
            ev.rounds.forEach((r, i) => {
                const oppName = r.opponent_users?.[0]?.player_name?.trim() || '—';
                const gw = r.win_count  ?? (r.is_win ? 1 : 0);
                const gl = r.lose_count ?? (r.is_win ? 0 : 1);
                const rColor = r.is_win ? 'var(--win)' : 'var(--loss)';
                roundsHtml += `<tr>
                    <td style="color:var(--muted)">R${i + 1}</td>
                    <td>${oppName}</td>
                    <td style="color:${rColor};font-weight:600">${r.is_win ? 'Win' : 'Loss'}</td>
                    <td class="td-num">${gw}-${gl}</td>
                </tr>`;
            });
            roundsHtml += '</tbody></table></div>';

            tr.addEventListener('click', () => {
                const isExpanded = tr.classList.toggle('expanded');
                if (isExpanded) {
                    const expandTr = document.createElement('tr');
                    expandTr.className = 'tourney-expand-row';
                    expandTr.innerHTML = `<td colspan="${cols}">${roundsHtml}</td>`;
                    tr.after(expandTr);
                } else {
                    const next = tr.nextElementSibling;
                    if (next?.classList.contains('tourney-expand-row')) next.remove();
                }
            });

            tourneyBody.appendChild(tr);
        }

    }

    displayMonthly(eventData);
    displayPlacements(eventData);
    displayEventSize(eventData);
    displayRoundByRound(eventData);
    displayRoundHeatmap(eventData);
    displayRegionals(eventData);
    displayCharts(totalW, totalL, periodMap, eventData);
    displayRecurringOpponents(eventData);
    displayRoi(eventData);
    displayStoreBreakdown(eventData);
    displayStoreStreaks(eventData);
    displaySeasonality(eventData);
    displayPersonalBests(eventData, streaks);
    displayDayOfWeek(eventData);
    // Achievements always use unfiltered data so they reflect the player's full history
    const _allEvs = (App.allEventData || []).filter(ev => ev?.rounds);
    let _allW = 0, _allL = 0;
    for (const ev of _allEvs) for (const r of ev.rounds) { if (r.is_win) _allW++; else _allL++; }
    displayAchievements(_allEvs, _allW, _allL);

    document.getElementById('results').style.display = 'block';
}

// ── Bogeyman / Victim ──────────────────────────────────────────────────────

function displayRivalry(playerMap) {
    const el = document.getElementById('bogeymanStats');
    // Require at least 5 matches against an opponent to qualify
    const MIN_MATCHES = 5;
    let bogeyman = null, victim = null;
    let bogeyPct = 101, victimPct = -1;

    for (const [pid, [w, l]] of Object.entries(playerMap)) {
        const t = w + l;
        if (t < MIN_MATCHES) continue;
        const winPct = w / t * 100;
        // Bogeyman: opponent with lowest win % for us (= they beat us most)
        if (winPct < bogeyPct) { bogeyPct = winPct; bogeyman = { pid, w, l, t, pct: winPct }; }
        // Victim: opponent with highest win % for us
        if (winPct > victimPct) { victimPct = winPct; victim = { pid, w, l, t, pct: winPct }; }
    }

    if (!bogeyman && !victim) { el.innerHTML = ''; return; }

    function rivalryCard(type, data) {
        if (!data) return '';
        const name    = App.usernameMap[data.pid] || data.pid;
        const isBogeyman = type === 'bogeyman';
        const emoji   = isBogeyman ? '&#128123;' : '&#128081;';
        const label   = isBogeyman ? 'The Bogeyman' : 'Your Victim';
        const bigNum  = isBogeyman ? `${data.l}L` : `${data.w}W`;
        const record  = isBogeyman
            ? `${data.w}W &ndash; <strong>${data.l}L</strong> &nbsp;(${data.pct.toFixed(1)}% win rate for you)`
            : `<strong>${data.w}W</strong> &ndash; ${data.l}L &nbsp;(${data.pct.toFixed(1)}% win rate for you)`;
        return `<div class="rivalry-card ${type}" onclick="openOpponentModal('${data.pid}')">
            <div class="rivalry-label">${emoji} ${label}</div>
            <div class="rivalry-name">${name}</div>
            <div class="rivalry-record"><strong>${bigNum}</strong><br><span style="font-size:0.8rem;">${record}</span></div>
        </div>`;
    }

    el.innerHTML = `<div class="rivalry-grid">
        ${rivalryCard('bogeyman', bogeyman)}
        ${rivalryCard('victim',   victim)}
    </div>`;
}

// ── Placement History ──────────────────────────────────────────────────────

function displayPlacements(eventData) {
    const section = document.getElementById('placementsInline');

    // Collect events that have a rank, excluding regionals
    const regionalDates = new Set(REGIONALS.map(r => r.date));
    const ranked = (eventData || [])
        .filter(ev => ev?._rank != null && ev._start_datetime
            && !regionalDates.has(ev._start_datetime.slice(0, 10)))
        .sort((a, b) => new Date(b._start_datetime) - new Date(a._start_datetime));

    if (ranked.length === 0) { section.style.display = 'none'; return; }
    section.style.display = '';

    const total = ranked.length;
    const best  = Math.min(...ranked.map(e => e._rank));
    const avg   = (ranked.reduce((s, e) => s + e._rank, 0) / total).toFixed(1);

    // ── Summary stats ──────────────────────────────────────────────────────
    document.getElementById('placementsStats').innerHTML = `
        <div class="stat-box">
            <div class="val" style="color:var(--gold);font-family:'Cinzel',serif;">#${best}</div>
            <div class="lbl">Best Placement</div>
        </div>
        <div class="stat-box">
            <div class="val t-val">#${avg}</div>
            <div class="lbl">Avg Placement</div>
        </div>
        <div class="stat-box">
            <div class="val pct-val">${total}</div>
            <div class="lbl">Events w/ Rank</div>
        </div>`;

    // ── Tier breakdown ─────────────────────────────────────────────────────
    const tiers = [
        { label: '1st Place', max: 1,        color: '#c9a84c' },
        { label: 'Top 4',     max: 4,        color: '#048A81' },
        { label: 'Top 8',     max: 8,        color: '#2E4057' },
        { label: 'Top 16',    max: 16,       color: '#6c757d' },
        { label: 'Top 32',    max: 32,       color: '#adb5bd' },
        { label: '33+',       max: Infinity, color: '#dee2e6' },
    ];

    const counts = tiers.map(() => 0);
    for (const ev of ranked) {
        const idx = tiers.findIndex(t => ev._rank <= t.max);
        if (idx !== -1) counts[idx]++;
    }

    const maxCount = Math.max(...counts, 1);
    const tiersEl  = document.getElementById('placementsTiers');
    tiersEl.innerHTML = '';
    tiers.forEach((t, i) => {
        if (counts[i] === 0) return;
        const pct  = (counts[i] / total * 100).toFixed(0);
        const barW = (counts[i] / maxCount * 100).toFixed(1);
        const row  = document.createElement('div');
        row.className = 'tier-row';
        row.innerHTML = `
            <span class="tier-label">${t.label}</span>
            <div class="tier-bar-wrap">
                <div class="tier-bar" style="width:${barW}%;background:${t.color};"></div>
            </div>
            <span class="tier-count">${counts[i]}</span>
            <span class="tier-pct">${pct}%</span>`;
        tiersEl.appendChild(row);
    });
}

// ── Monthly breakdown ──────────────────────────────────────────────────────

function displayMonthly(eventData) {
    const card = document.getElementById('monthlyCard');
    const monthly = {};
    for (const ev of (eventData || [])) {
        if (!ev?.rounds || !ev._start_datetime) continue;
        const d = new Date(ev._start_datetime);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (!monthly[key]) monthly[key] = { w: 0, l: 0 };
        for (const r of ev.rounds) { if (r.is_win) monthly[key].w++; else monthly[key].l++; }
    }
    const keys = Object.keys(monthly).sort().reverse();
    if (!keys.length) { card.style.display = 'none'; return; }
    card.style.display = 'block';

    const tbody = document.getElementById('monthlyBody');
    tbody.innerHTML = '';
    for (const key of keys) {
        const s = monthly[key];
        const t = s.w + s.l;
        const pct = (s.w / t * 100).toFixed(1);
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${key}</td>
            <td class="td-num">${s.w}</td><td class="td-num">${s.l}</td>
            <td class="td-num">${t}</td><td class="td-pct">${pct}%</td>`;
        tbody.appendChild(tr);
    }

    destroyChart('monthly');
    const win   = getComputedStyle(document.documentElement).getPropertyValue('--win').trim()   || '#28a745';
    const loss  = getComputedStyle(document.documentElement).getPropertyValue('--loss').trim()  || '#dc3545';
    const muted = getComputedStyle(document.documentElement).getPropertyValue('--muted').trim() || '#6c757d';
    App.charts['monthly'] = new Chart(document.getElementById('chartMonthly'), {
        type: 'bar',
        data: {
            labels: keys,
            datasets: [
                { label: 'Wins',   data: keys.map(k => monthly[k].w), backgroundColor: win  + 'cc', borderRadius: 3 },
                { label: 'Losses', data: keys.map(k => monthly[k].l), backgroundColor: loss + 'cc', borderRadius: 3 }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { stacked: true, ticks: { font: { size: 9 }, color: muted, maxRotation: 45 }, grid: { display: false } },
                y: { stacked: true, beginAtZero: true, ticks: { precision: 0, color: muted }, grid: { color: '#eee' } }
            },
            plugins: {
                legend: { position: 'bottom', labels: { font: { size: 11 }, color: muted } },
                tooltip: {
                    callbacks: {
                        footer: items => {
                            const s = monthly[items[0].label];
                            const t = s.w + s.l;
                            return `Win rate: ${(s.w / t * 100).toFixed(1)}%`;
                        }
                    }
                }
            }
        }
    });
}

// ── Performance by event size ──────────────────────────────────────────────

function displayEventSize(eventData) {
    const card = document.getElementById('eventSizeCard');
    const brackets = [
        { label: 'Small (≤ 16)',   test: n => n !== null && n <= 16 },
        { label: 'Medium (17–32)', test: n => n !== null && n >= 17 && n <= 32 },
        { label: 'Large (33+)',    test: n => n !== null && n >= 33 },
        { label: 'Unknown',        test: n => n === null },
    ];
    const stats = brackets.map(() => ({ w: 0, l: 0 }));
    let hasData = false;
    for (const ev of (eventData || [])) {
        if (!ev?.rounds) continue;
        const n = ev._applicant_count ?? null;
        const bi = brackets.findIndex(b => b.test(n));
        if (bi === -1) continue;
        for (const r of ev.rounds) {
            if (r.is_win) stats[bi].w++; else stats[bi].l++;
            hasData = true;
        }
    }
    if (!hasData) { card.style.display = 'none'; return; }
    card.style.display = 'block';

    const tbody = document.getElementById('eventSizeBody');
    tbody.innerHTML = '';
    for (let i = 0; i < brackets.length; i++) {
        const s = stats[i];
        if (s.w === 0 && s.l === 0) continue;
        const t = s.w + s.l;
        const pct = (s.w / t * 100).toFixed(1);
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${brackets[i].label}</td>
            <td class="td-num">${s.w}</td><td class="td-num">${s.l}</td>
            <td class="td-num">${t}</td><td class="td-pct">${pct}%</td>`;
        tbody.appendChild(tr);
    }
}

// ── Round by round ─────────────────────────────────────────────────────────

function displayRoundByRound(eventData) {
    const card = document.getElementById('roundCard');
    const roundMap = {};
    for (const ev of (eventData || [])) {
        if (!ev?.rounds) continue;
        ev.rounds.forEach((r, idx) => {
            if (!roundMap[idx]) roundMap[idx] = { w: 0, l: 0 };
            if (r.is_win) roundMap[idx].w++; else roundMap[idx].l++;
        });
    }
    const indices = Object.keys(roundMap).map(Number).sort((a, b) => a - b);
    if (!indices.length) { card.style.display = 'none'; return; }
    card.style.display = 'block';

    const tbody = document.getElementById('roundBody');
    tbody.innerHTML = '';
    for (const idx of indices) {
        const s = roundMap[idx];
        const t = s.w + s.l;
        const pct = (s.w / t * 100).toFixed(1);
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>Round ${idx + 1}</td>
            <td class="td-num">${s.w}</td><td class="td-num">${s.l}</td>
            <td class="td-num">${t}</td><td class="td-pct">${pct}%</td>`;
        tbody.appendChild(tr);
    }

    // Chart
    const accent  = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()  || '#048A81';
    const win     = getComputedStyle(document.documentElement).getPropertyValue('--win').trim()      || '#28a745';
    const muted   = getComputedStyle(document.documentElement).getPropertyValue('--muted').trim()    || '#6c757d';
    destroyChart('roundBar');
    App.charts['roundBar'] = new Chart(document.getElementById('chartRoundBar'), {
        type: 'bar',
        data: {
            labels: indices.map(i => `Round ${i + 1}`),
            datasets: [{
                label: 'Win %',
                data: indices.map(i => {
                    const s = roundMap[i]; return s ? +(s.w / (s.w + s.l) * 100).toFixed(1) : 0;
                }),
                backgroundColor: indices.map(i => {
                    const s = roundMap[i];
                    const pct = s ? s.w / (s.w + s.l) * 100 : 0;
                    return pct >= 50 ? win + 'cc' : '#dc3545cc';
                }),
                borderRadius: 4
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { min: 0, max: 100, ticks: { callback: v => v + '%', font: { size: 10 }, color: muted }, grid: { color: '#eee' } },
                y: { ticks: { font: { size: 11 }, color: muted }, grid: { display: false } }
            },
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: {
                    label: ctx => {
                        const i = indices[ctx.dataIndex];
                        const s = roundMap[i];
                        return ` Win%: ${ctx.parsed.x}%  (${s.w}W / ${s.l}L)`;
                    }
                }}
            }
        }
    });

    // ── Most Faced Opponent per Round ───────────────────────────────────────
    const MAX_ROUND = 5;
    // roundOppMap[idx][pid] = { w, l, count }
    const roundOppMap = {};
    for (const ev of (eventData || [])) {
        if (!ev?.rounds) continue;
        ev.rounds.forEach((r, idx) => {
            if (idx >= MAX_ROUND) return;
            const pid = r.opponent_users?.[0]?.membership_number;
            if (!pid) return;
            if (!roundOppMap[idx]) roundOppMap[idx] = {};
            if (!roundOppMap[idx][pid]) roundOppMap[idx][pid] = { w: 0, l: 0 };
            if (r.is_win) roundOppMap[idx][pid].w++; else roundOppMap[idx][pid].l++;
        });
    }

    const section = document.getElementById('roundOppSection');
    const grid    = document.getElementById('roundOppGrid');
    grid.innerHTML = '';
    let anyFound = false;

    for (let idx = 0; idx < MAX_ROUND; idx++) {
        const oppMap = roundOppMap[idx];
        if (!oppMap) continue;

        // Pick opponent with most appearances in this round slot
        const top = Object.entries(oppMap)
            .sort((a, b) => (b[1].w + b[1].l) - (a[1].w + a[1].l))[0];
        if (!top) continue;

        anyFound = true;
        const [pid, stats] = top;
        const name  = App.usernameMap[pid] || pid;
        const times = stats.w + stats.l;
        const winColor  = getComputedStyle(document.documentElement).getPropertyValue('--win').trim()  || '#28a745';
        const lossColor = getComputedStyle(document.documentElement).getPropertyValue('--loss').trim() || '#dc3545';
        const recColor  = stats.w >= stats.l ? winColor : lossColor;

        const card = document.createElement('div');
        card.className = 'round-opp-card';
        card.title = `Open ${name}'s profile`;
        card.onclick = () => openOpponentModal(pid);
        card.innerHTML = `
            <div class="roc-round">Round ${idx + 1}</div>
            <div class="roc-name">${name}</div>
            <div class="roc-count">${times}× faced</div>
            <div class="roc-record" style="color:${recColor}">${stats.w}W &ndash; ${stats.l}L</div>`;
        grid.appendChild(card);
    }

    section.style.display = anyFound ? '' : 'none';
}

// ── Feature 1: Round-by-Round Heatmap ──────────────────────────────────────
function displayRoundHeatmap(eventData) {
    const card = document.getElementById('heatmapCard');
    const evs  = (eventData || [])
        .filter(ev => ev?.rounds?.length && ev._start_datetime)
        .sort((a, b) => new Date(b._start_datetime) - new Date(a._start_datetime));
    if (evs.length === 0) { card.style.display = 'none'; return; }
    card.style.display = 'block';

    const maxR = Math.max(...evs.map(ev => ev.rounds.length));
    const colW = Array(maxR).fill(0), colL = Array(maxR).fill(0);

    let html = '<table class="heatmap-table"><thead><tr><th>Event</th>';
    for (let r = 0; r < maxR; r++) html += `<th>R${r + 1}</th>`;
    html += '</tr></thead><tbody>';

    for (const ev of evs) {
        const dateStr = ev._start_datetime.slice(0, 10);
        html += `<tr><td style="font-size:0.72rem;color:var(--muted);white-space:nowrap;padding-right:0.5rem;">${dateStr}</td>`;
        for (let r = 0; r < maxR; r++) {
            const round = ev.rounds[r];
            if (!round) {
                html += '<td><span class="heatmap-dot none" title="Not played"></span></td>';
            } else if (round.is_win) {
                html += '<td><span class="heatmap-dot win" title="Win"></span></td>';
                colW[r]++;
            } else {
                html += '<td><span class="heatmap-dot loss" title="Loss"></span></td>';
                colL[r]++;
            }
        }
        html += '</tr>';
    }

    html += '<tr class="heatmap-pct-row"><td style="font-size:0.72rem;font-weight:700;color:var(--muted);">Win %</td>';
    for (let r = 0; r < maxR; r++) {
        const t = colW[r] + colL[r];
        const pct = t > 0 ? (colW[r] / t * 100).toFixed(0) : '—';
        const color = t > 0 ? ((colW[r] / t) >= 0.5 ? 'var(--win)' : 'var(--loss)') : 'var(--muted)';
        html += `<td style="color:${color}">${pct}${t > 0 ? '%' : ''}</td>`;
    }
    html += '</tr></tbody></table>';
    document.getElementById('heatmapGrid').innerHTML = html;
}

// ── Feature 2: Recurring Opponents ─────────────────────────────────────────
function displayRecurringOpponents(eventData) {
    const card = document.getElementById('recurringCard');
    const evOppDates = {}, evOppWL = {};

    for (const ev of (eventData || [])) {
        if (!ev?.rounds) continue;
        const dateStr = ev._start_datetime ? ev._start_datetime.slice(0, 10) : null;
        const seenInEv = new Set();
        for (const r of ev.rounds) {
            const pid = r.opponent_users?.[0]?.membership_number;
            if (!pid) continue;
            if (!seenInEv.has(pid)) {
                seenInEv.add(pid);
                if (!evOppDates[pid]) evOppDates[pid] = [];
                if (dateStr) evOppDates[pid].push(dateStr);
            }
            if (!evOppWL[pid]) evOppWL[pid] = { w: 0, l: 0 };
            if (r.is_win) evOppWL[pid].w++; else evOppWL[pid].l++;
        }
    }

    const recurring = Object.entries(evOppDates)
        .filter(([, dates]) => dates.length >= 2)
        .sort((a, b) => b[1].length - a[1].length);

    if (recurring.length === 0) { card.style.display = 'none'; return; }
    card.style.display = 'block';

    const tbody = document.getElementById('recurringBody');
    tbody.innerHTML = '';
    for (const [pid, dates] of recurring) {
        const sorted = [...dates].sort();
        const name   = App.usernameMap[pid] || pid;
        const { w, l } = evOppWL[pid] || { w: 0, l: 0 };
        const t   = w + l;
        const pct = t > 0 ? (w / t * 100).toFixed(1) : '0.0';
        const tr  = document.createElement('tr');
        tr.style.cursor = 'pointer';
        tr.title = 'Click to view match history';
        tr.onclick = () => openOpponentModal(pid);
        tr.innerHTML = `<td>${name}</td>
            <td class="td-num">${dates.length}</td>
            <td class="td-num" style="color:var(--win)">${w}</td>
            <td class="td-num" style="color:var(--loss)">${l}</td>
            <td class="td-pct">${pct}%</td>
            <td class="td-num">${sorted[0] ?? '—'}</td>
            <td class="td-num">${sorted[sorted.length - 1] ?? '—'}</td>`;
        tbody.appendChild(tr);
    }
}

// ── Feature 6: Store Performance Breakdown ──────────────────────────────────
function displayStoreBreakdown(eventData) {
    const card = document.getElementById('storeBreakCard');
    const storeMap = {};
    for (const ev of (eventData || [])) {
        if (!ev?.rounds) continue;
        const name = ev._store_name ?? null;
        if (!name) continue;
        if (!storeMap[name]) storeMap[name] = { events: 0, w: 0, l: 0, pts: 0, ptsCount: 0, opponents: new Set() };
        storeMap[name].events++;
        for (const r of ev.rounds) {
            if (r.is_win) storeMap[name].w++; else storeMap[name].l++;
            if (r.opponent_name) storeMap[name].opponents.add(r.opponent_name);
        }
        const mp = ev._match_points ?? (ev.user?.match_point != null ? Number(ev.user.match_point) : null);
        if (mp != null) { storeMap[name].pts += mp; storeMap[name].ptsCount++; }
    }
    const entries = Object.entries(storeMap)
        .sort((a, b) => {
            const ta = a[1].w + a[1].l, tb = b[1].w + b[1].l;
            const pa = ta ? a[1].w / ta : 0, pb = tb ? b[1].w / tb : 0;
            return pb - pa;
        });
    if (entries.length === 0) { card.style.display = 'none'; return; }
    card.style.display = 'block';

    // ── Best / Worst store highlights ───────────────────────────────────────
    const qualified = entries.filter(([, s]) => s.w + s.l >= 2);
    const highlightEl = document.getElementById('storeHighlights');
    if (qualified.length >= 2) {
        const [bestName, bestS]   = qualified[0];
        const [worstName, worstS] = qualified[qualified.length - 1];
        const bestPct  = (bestS.w  / (bestS.w  + bestS.l)  * 100).toFixed(1);
        const worstPct = (worstS.w / (worstS.w + worstS.l) * 100).toFixed(1);
        const mostName = [...entries].sort((a,b) => b[1].events - a[1].events)[0][0];
        const mostVisits = storeMap[mostName].events;
        highlightEl.innerHTML = `
            <div class="stat-box">
                <div class="val" style="color:var(--win);font-size:1.3rem;">${bestPct}%</div>
                <div class="lbl">Best Store<br><span style="color:var(--text);font-weight:600;">${bestName}</span></div>
            </div>
            <div class="stat-box">
                <div class="val" style="color:var(--loss);font-size:1.3rem;">${worstPct}%</div>
                <div class="lbl">Worst Store<br><span style="color:var(--text);font-weight:600;">${worstName}</span></div>
            </div>
            <div class="stat-box">
                <div class="val" style="font-size:1.3rem;">${mostVisits}</div>
                <div class="lbl">Most Visited<br><span style="color:var(--text);font-weight:600;">${mostName}</span></div>
            </div>
            <div class="stat-box">
                <div class="val" style="font-size:1.3rem;">${entries.length}</div>
                <div class="lbl">Stores Played</div>
            </div>`;
        highlightEl.style.display = 'grid';
    } else {
        highlightEl.style.display = 'none';
    }

    // ── Table ────────────────────────────────────────────────────────────────
    const tbody = document.getElementById('storeBreakBody');
    tbody.innerHTML = '';
    for (const [name, s] of entries) {
        const t      = s.w + s.l;
        const pct    = t > 0 ? (s.w / t * 100).toFixed(1) : '0.0';
        const color  = parseFloat(pct) >= 50 ? 'var(--win)' : 'var(--loss)';
        const avgPts = s.ptsCount > 0 ? (s.pts / s.ptsCount).toFixed(1) : '—';
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${name}</td>
            <td class="td-num">${s.events}</td>
            <td class="td-num" style="color:var(--win)">${s.w}</td>
            <td class="td-num" style="color:var(--loss)">${s.l}</td>
            <td class="td-pct" style="color:${color}">${pct}%</td>
            <td class="td-num">${avgPts}</td>
            <td class="td-num">${s.opponents.size}</td>`;
        tbody.appendChild(tr);
    }
}

// ── Store Attendance Streaks ─────────────────────────────────────────────────
function displayStoreStreaks(eventData) {
    const card = document.getElementById('storeStreakCard');
    // Build sorted event list per store
    const storeEvents = {};
    const sorted = [...(eventData || [])]
        .filter(ev => ev?._start_datetime && ev._store_name)
        .sort((a, b) => new Date(a._start_datetime) - new Date(b._start_datetime));

    for (const ev of sorted) {
        const name = ev._store_name;
        if (!storeEvents[name]) storeEvents[name] = [];
        storeEvents[name].push(new Date(ev._start_datetime).toISOString().slice(0, 10));
    }

    if (Object.keys(storeEvents).length === 0) { card.style.display = 'none'; return; }
    card.style.display = 'block';

    // For each store compute best streak and current streak (events within 35 days of each other)
    const GAP_DAYS = 35;
    const rows = [];
    for (const [name, dates] of Object.entries(storeEvents)) {
        let bestStreak = 1, curStreak = 1;
        for (let i = 1; i < dates.length; i++) {
            const diff = (new Date(dates[i]) - new Date(dates[i-1])) / 86400000;
            if (diff <= GAP_DAYS) { curStreak++; bestStreak = Math.max(bestStreak, curStreak); }
            else curStreak = 1;
        }
        // Current streak = streak ending at last visit
        let liveStreak = 1;
        for (let i = dates.length - 1; i > 0; i--) {
            const diff = (new Date(dates[i]) - new Date(dates[i-1])) / 86400000;
            if (diff <= GAP_DAYS) liveStreak++;
            else break;
        }
        rows.push({ name, best: bestStreak, current: liveStreak, visits: dates.length });
    }
    rows.sort((a, b) => b.best - a.best || b.visits - a.visits);

    const tbody = document.getElementById('storeStreakBody');
    tbody.innerHTML = '';
    for (const r of rows) {
        const tr = document.createElement('tr');
        const curColor = r.current >= r.best ? 'var(--win)' : 'var(--accent)';
        tr.innerHTML = `<td>${r.name}</td>
            <td class="td-num"><strong>${r.best}</strong></td>
            <td class="td-num" style="color:${curColor}">${r.current}</td>
            <td class="td-num">${r.visits}</td>`;
        tbody.appendChild(tr);
    }
}

// ── Feature 7: Seasonality Polar Chart ─────────────────────────────────────
function displaySeasonality(eventData) {
    const card = document.getElementById('seasonalityCard');
    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const ms = Array.from({ length: 12 }, () => ({ w: 0, l: 0 }));
    for (const ev of (eventData || [])) {
        if (!ev?.rounds || !ev._start_datetime) continue;
        const m = new Date(ev._start_datetime).getMonth();
        for (const r of ev.rounds) { if (r.is_win) ms[m].w++; else ms[m].l++; }
    }
    if (!ms.some(s => s.w + s.l > 0)) { card.style.display = 'none'; return; }
    card.style.display = 'block';

    const muted = getComputedStyle(document.documentElement).getPropertyValue('--muted').trim() || '#6c757d';
    const pcts  = ms.map(s => { const t = s.w + s.l; return t > 0 ? parseFloat((s.w / t * 100).toFixed(1)) : null; });

    destroyChart('seasonality');
    App.charts['seasonality'] = new Chart(document.getElementById('chartSeasonality'), {
        type: 'polarArea',
        data: {
            labels: MONTHS,
            datasets: [{
                data: pcts.map(p => p ?? 0),
                backgroundColor: pcts.map(p =>
                    p === null ? 'rgba(0,0,0,0.04)' :
                    p >= 60 ? '#28a74555' : p >= 50 ? '#048A8155' : '#dc354555'),
                borderColor: pcts.map(p =>
                    p === null ? 'var(--border)' :
                    p >= 60 ? 'var(--win)' : p >= 50 ? 'var(--accent)' : 'var(--loss)'),
                borderWidth: 1.5
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: { r: {
                min: 0, max: 100,
                ticks: { stepSize: 25, callback: v => v + '%', font: { size: 9 }, color: muted },
                grid: { color: 'rgba(0,0,0,0.07)' }
            }},
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: ctx => {
                    const s = ms[ctx.dataIndex];
                    const t = s.w + s.l;
                    return t > 0 ? ` ${ctx.parsed.r}% (${s.w}W / ${s.l}L, ${t} matches)` : ' No data';
                }}}
            }
        }
    });
}

// ── Feature 8: Personal Bests ───────────────────────────────────────────────
function displayPersonalBests(eventData, streaks) {
    const card = document.getElementById('personalBestsCard');
    if (!eventData || eventData.length === 0) { card.style.display = 'none'; return; }

    let bestEvPct = null, bestEvDate = '—';
    let bestRank  = null;
    let mostRounds = 0, mostRoundsDate = '—';
    const monthCount = {};

    for (const ev of eventData) {
        if (!ev?.rounds) continue;
        const dateStr = ev._start_datetime ? ev._start_datetime.slice(0, 10) : null;

        let evW = 0, evL = 0;
        for (const r of ev.rounds) { if (r.is_win) evW++; else evL++; }
        const evT = evW + evL;
        if (evT > 0) {
            const evPct = evW / evT * 100;
            if (bestEvPct === null || evPct > bestEvPct) { bestEvPct = evPct; bestEvDate = dateStr ?? '—'; }
        }

        const rank = ev._rank ?? null;
        if (rank !== null && (bestRank === null || rank < bestRank)) bestRank = rank;

        if (ev.rounds.length > mostRounds) { mostRounds = ev.rounds.length; mostRoundsDate = dateStr ?? '—'; }

        if (dateStr) {
            const mk = dateStr.slice(0, 7);
            monthCount[mk] = (monthCount[mk] || 0) + 1;
        }
    }

    const bestMonth = Object.entries(monthCount).sort((a, b) => b[1] - a[1])[0];

    card.style.display = 'block';
    document.getElementById('personalBestsGrid').innerHTML = `
        <div class="stat-box"><div class="val w-val">${streaks?.bestWin ?? 0}</div><div class="lbl">Best Win Streak</div></div>
        <div class="stat-box">
            <div class="val pct-val">${bestEvPct !== null ? bestEvPct.toFixed(1) + '%' : '—'}</div>
            <div class="lbl">Best Event Win%<br><span style="font-size:0.65rem;color:var(--muted)">${bestEvDate}</span></div>
        </div>
        <div class="stat-box">
            <div class="val" style="color:var(--gold)">${bestRank !== null ? '#' + bestRank : '—'}</div>
            <div class="lbl">Highest Rank</div>
        </div>
        <div class="stat-box">
            <div class="val t-val">${mostRounds}</div>
            <div class="lbl">Most Rounds in Event<br><span style="font-size:0.65rem;color:var(--muted)">${mostRoundsDate}</span></div>
        </div>
        <div class="stat-box">
            <div class="val t-val">${bestMonth ? bestMonth[1] : '—'}</div>
            <div class="lbl">Most Events in Month<br><span style="font-size:0.65rem;color:var(--muted)">${bestMonth ? bestMonth[0] : ''}</span></div>
        </div>`;
}

// ── Regionals ──────────────────────────────────────────────────────────────
function displayRegionals(eventData) {
    // Build a map of date → event data for quick lookup
    const byDate = {};
    for (const ev of (eventData || [])) {
        if (!ev?._start_datetime) continue;
        const d = ev._start_datetime.slice(0, 10);
        if (!byDate[d]) byDate[d] = ev;
    }

    const card = document.getElementById('regionalsCard');
    const body = document.getElementById('regionalsBody');
    body.innerHTML = '';

    // Show card only if at least one regional is defined
    if (REGIONALS.length === 0) { card.style.display = 'none'; return; }
    card.style.display = 'block';

    for (const reg of REGIONALS) {
        const ev = byDate[reg.date];
        let resultStr = '—';

        if (ev?.rounds) {
            let evW = 0, evL = 0;
            for (const r of ev.rounds) { if (r.is_win) evW++; else evL++; }
            resultStr = `${evW}-${evL}`;
        }

        const tr = document.createElement('tr');
        if (!ev?.rounds) tr.style.opacity = '0.5'; // not yet attended
        tr.innerHTML = `<td>${fmtDate(reg.date)}</td>
            <td>${reg.name}</td>
            <td class="td-num">${resultStr}</td>`;
        body.appendChild(tr);
    }

    // Scatter: tournament size vs final rank (or win% as fallback)
    {
        const scatterPanel = document.getElementById('regionalScatterPanel');
        const scatterPoints = [];
        const scatterLabels = [];
        const scatterMeta   = []; // { rank, winPct, applicants }
        let   useRank = false;

        for (const reg of REGIONALS) {
            const ev = byDate[reg.date];
            if (!ev?.rounds) continue;
            const applicants = ev._applicant_count ?? null;
            if (applicants === null) continue;
            let evW = 0, evL = 0;
            for (const r of ev.rounds) { if (r.is_win) evW++; else evL++; }
            const t = evW + evL;
            if (t === 0) continue;
            const rank   = ev._rank ?? null;
            const winPct = +(evW / t * 100).toFixed(1);
            if (rank !== null) useRank = true;
            scatterMeta.push({ rank, winPct, applicants });
            scatterLabels.push(reg.name);
        }

        // Build points: prefer rank on Y when available for all events, else win%
        for (const m of scatterMeta) {
            const y = useRank ? (m.rank ?? m.winPct) : m.winPct;
            scatterPoints.push({ x: m.applicants, y });
        }

        // Update subtitle accordingly
        const scatterTitle = document.querySelector('#regionalScatterPanel h3');
        const scatterSub   = document.querySelector('#regionalScatterPanel p');
        if (scatterTitle) scatterTitle.textContent = useRank
            ? 'Tournament Size vs. Final Rank'
            : 'Tournament Size vs. Result';
        if (scatterSub) scatterSub.textContent = useRank
            ? 'Each dot is a regional event. X = applicants, Y = final rank (lower is better).'
            : 'Each dot is a regional event. X = applicants, Y = win % achieved.';

        if (scatterPoints.length < 2) {
            scatterPanel.style.display = 'none';
        } else {
            scatterPanel.style.display = '';
            const scMuted = getComputedStyle(document.documentElement).getPropertyValue('--muted').trim() || '#6c757d';
            destroyChart('regionalScatter');
            App.charts['regionalScatter'] = new Chart(document.getElementById('chartRegionalScatter'), {
                type: 'scatter',
                data: {
                    datasets: [{
                        label: 'Regional',
                        data: scatterPoints,
                        backgroundColor: scatterPoints.map((p, i) => {
                            if (useRank) {
                                // lower rank = better (top half of field)
                                const half = (scatterMeta[i].applicants || 2) / 2;
                                return p.y <= half ? '#28a745cc' : '#dc3545cc';
                            }
                            return p.y >= 50 ? '#28a745cc' : '#dc3545cc';
                        }),
                        pointRadius: 8,
                        pointHoverRadius: 10
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        x: { title: { display: true, text: 'Applicants', color: scMuted, font: { size: 11 } },
                             ticks: { font: { size: 10 }, color: scMuted }, grid: { color: '#eee' } },
                        y: useRank
                            ? { reverse: true,
                                title: { display: true, text: 'Final Rank (lower = better)', color: scMuted, font: { size: 11 } },
                                ticks: { callback: v => `#${v}`, font: { size: 10 }, color: scMuted },
                                grid: { color: '#eee' } }
                            : { min: 0, max: 100,
                                title: { display: true, text: 'Win %', color: scMuted, font: { size: 11 } },
                                ticks: { callback: v => v + '%', font: { size: 10 }, color: scMuted },
                                grid: { color: '#eee' } }
                    },
                    plugins: {
                        legend: { display: false },
                        tooltip: { callbacks: {
                            label: ctx => {
                                const m   = scatterMeta[ctx.dataIndex];
                                const lbl = scatterLabels[ctx.dataIndex];
                                const lines = [`${lbl}`, `Applicants: ${m.applicants}`];
                                if (m.rank   != null) lines.push(`Final rank: #${m.rank}`);
                                lines.push(`Win rate: ${m.winPct}%`);
                                return lines;
                            }
                        }}
                    }
                }
            });
        }
    }
}

// ── Achievements ─────────────────────────────────────────────────────────────
function displayAchievements(eventData, totalW, totalL) {
    const card = document.getElementById('achievementsCard');
    if (!card) return;

    const evs = [...(eventData || [])].filter(ev => ev?.rounds && ev._start_datetime);
    evs.sort((a, b) => (a._start_datetime || '').localeCompare(b._start_datetime || ''));

    const total = totalW + totalL;
    const allRounds = evs.flatMap(ev => ev.rounds || []);

    // Compute streak for badge check
    const streaks = computeStreaks(evs);

    // Events per month
    const monthCount = {};
    for (const ev of evs) {
        const m = ev._start_datetime.slice(0, 7);
        monthCount[m] = (monthCount[m] || 0) + 1;
    }
    const maxMonth = Math.max(0, ...Object.values(monthCount));

    // Best single-event record
    let bestEvWinPct = 0;
    for (const ev of evs) {
        let w = 0, l = 0;
        for (const r of ev.rounds) { if (r.is_win) w++; else l++; }
        const t = w + l;
        if (t > 0 && (w / t) > bestEvWinPct) bestEvWinPct = w / t;
    }

    // Undefeated events (0 losses)
    const perfectEvs = evs.filter(ev => ev.rounds.every(r => r.is_win)).length;

    // Top 4 finishes
    const top4 = evs.filter(ev => {
        const rank = ev._rank ?? ev.user?.rank ?? null;
        return rank != null && Number(rank) <= 4;
    }).length;

    // Different stores
    const stores = new Set(evs.map(ev => ev._store_name).filter(Boolean));

    const defs = [
        { id: 'first-win',       icon: '⚔️',  title: 'First Blood',       desc: 'Win your first match',                    unlocked: totalW >= 1 },
        { id: 'ten-events',      icon: '🎯',  title: 'Grinder',           desc: 'Play 10 tournaments',                     unlocked: evs.length >= 10 },
        { id: 'fifty-events',    icon: '🏆',  title: 'Veteran',           desc: 'Play 50 tournaments',                     unlocked: evs.length >= 50 },
        { id: 'hundred-wins',    icon: '💯',  title: 'Supernova',         desc: 'Accumulate 100 wins',                     unlocked: totalW >= 100 },
        { id: 'perfect-event',   icon: '✨',  title: 'Flawless',          desc: 'Win every match in a tournament',         unlocked: perfectEvs >= 1 },
        { id: 'five-perfect',    icon: '🌟',  title: 'Untouchable',       desc: '5 tournaments with no losses',            unlocked: perfectEvs >= 5 },
        { id: 'top4',            icon: '🥇',  title: 'Podium',            desc: 'Finish Top 4 in a tournament',            unlocked: top4 >= 1 },
        { id: 'five-top4',       icon: '👑',  title: 'Royalty',           desc: '5 Top 4 finishes',                       unlocked: top4 >= 5 },
        { id: 'win-streak-5',    icon: '🔥',  title: 'On Fire',           desc: 'Win 5 rounds in a row',                  unlocked: streaks.bestWin >= 5 },
        { id: 'win-streak-10',   icon: '🌋',  title: 'Unstoppable',       desc: 'Win 10 rounds in a row',                 unlocked: streaks.bestWin >= 10 },
        { id: 'five-stores',     icon: '🗺️',  title: 'Road Warrior',      desc: 'Play at 5 different stores',              unlocked: stores.size >= 5 },
        { id: 'ten-stores',      icon: '🌍',  title: 'Conqueror of Raftel', desc: 'Play at 10 different stores',           unlocked: stores.size >= 10 },
        { id: 'four-month',      icon: '📅',  title: 'Monthly Obsession', desc: '4 tournaments in a single month',         unlocked: maxMonth >= 4 },
        { id: 'five-hundred-r',  icon: '⚡',  title: 'Round Machine',     desc: 'Play 500 rounds total',                   unlocked: total >= 500 },
        { id: 'regional',        icon: '🌐',  title: 'Regionals Veteran', desc: 'Attend a Regional event',                 unlocked: evs.some(ev => {
            const d = ev._start_datetime?.slice(0, 10);
            return d && REGIONALS.some(r => r.date === d);
        })},
    ];

    card.style.display = 'block';
    const grid = document.getElementById('achievementsGrid');
    if (!grid) return;

    grid.innerHTML = defs.map(a => `
        <div class="achievement-badge ${a.unlocked ? 'unlocked' : 'locked'}" title="${a.desc}">
            <div class="achievement-icon">${a.icon}</div>
            <div class="achievement-title">${a.title}</div>
            <div class="achievement-desc">${a.desc}</div>
        </div>`).join('');

    // ── Competitive badges ────────────────────────────────────────────────────
    const compEl = document.getElementById('competitiveBadgesSection');
    if (!compEl) return;

    const cb = App.competitiveBadges;
    if (!cb) { compEl.style.display = 'none'; return; }

    // Resolve current player's bandaiId
    const idx = document.getElementById('userSelect').value;
    if (idx === '') { compEl.style.display = 'none'; return; }
    const myId = App.usersWithToken[parseInt(idx)].bandaiId;

    const fmtMonth = ym => {
        const [y, m] = ym.split('-');
        return new Date(+y, +m - 1).toLocaleString('default', { month: 'long', year: 'numeric' });
    };

    // Rei dos Piratas — one badge per completed year
    const reiHtml = Object.entries(cb.reiDosPiratas)
        .sort(([a], [b]) => +b - +a)
        .map(([year, winner]) => {
            const unlocked = winner.bandaiId === myId;
            const pct = (winner.winRate * 100).toFixed(1);
            const desc = unlocked
                ? `You were the best player of ${year} with ${pct}% win rate (${winner.w}W/${winner.l}L)`
                : `${winner.name} won with ${pct}% win rate — play more in ${year} to compete`;
            return `
            <div class="achievement-badge competitive ${unlocked ? 'unlocked rei' : 'locked'}" title="${desc}">
                <div class="achievement-icon">☠️</div>
                <div class="achievement-title">Rei dos Piratas</div>
                <div class="achievement-subtitle">${year}</div>
                <div class="achievement-desc">${desc}</div>
            </div>`;
        }).join('');

    // Yonkou & Shichibukai — last completed month
    const monthLabel = fmtMonth(cb.month);

    const yonkouUnlocked = cb.yonkou.includes(myId);
    const yonkouDesc = yonkouUnlocked
        ? `You were among the top 4 players in ${monthLabel}`
        : cb.yonkou.length
            ? `Top 4 of ${monthLabel} — not yet achieved`
            : `No data for ${monthLabel}`;

    const shichiUnlocked = cb.shichibukai.includes(myId);
    const shichiDesc = shichiUnlocked
        ? `You ranked 5th–11th in ${monthLabel}`
        : cb.shichibukai.length
            ? `Positions 5–11 of ${monthLabel} — not yet achieved`
            : `No data for ${monthLabel}`;

    const monthHtml = `
        <div class="achievement-badge competitive ${yonkouUnlocked ? 'unlocked yonkou' : 'locked'}" title="${yonkouDesc}">
            <div class="achievement-icon">🐉</div>
            <div class="achievement-title">Yonkou</div>
            <div class="achievement-subtitle">${monthLabel}</div>
            <div class="achievement-desc">${yonkouDesc}</div>
        </div>
        <div class="achievement-badge competitive ${shichiUnlocked ? 'unlocked shichibukai' : 'locked'}" title="${shichiDesc}">
            <div class="achievement-icon">⚔️</div>
            <div class="achievement-title">Shichibukai</div>
            <div class="achievement-subtitle">${monthLabel}</div>
            <div class="achievement-desc">${shichiDesc}</div>
        </div>`;

    // Almirante de Frota — best Regional placement ever
    const alm = cb.almirante;
    let almHtml = '';
    if (alm) {
        const unlocked = alm.bandaiId === myId;
        const evLabel  = alm.eventName ? ` at ${alm.eventName}` : '';
        const desc = unlocked
            ? `You hold the best Regional placement among all tracked players — #${alm.bestRank}${evLabel}`
            : `${alm.name} holds the best Regional placement with #${alm.bestRank}${evLabel}`;
        almHtml = `
        <div class="achievement-badge competitive ${unlocked ? 'unlocked almirante' : 'locked'}" title="${desc}">
            <div class="achievement-icon">⚓</div>
            <div class="achievement-title">Almirante de Frota</div>
            <div class="achievement-subtitle">#${alm.bestRank} at Regionals</div>
            <div class="achievement-desc">${desc}</div>
        </div>`;
    }

    compEl.style.display = reiHtml || monthHtml || almHtml ? '' : 'none';
    compEl.querySelector('.competitive-badges-grid').innerHTML = reiHtml + monthHtml + almHtml;
}

// ── Day-of-Week Performance ──────────────────────────────────────────────────
function displayDayOfWeek(eventData) {
    const card = document.getElementById('dayOfWeekCard');
    if (!card) return;

    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const stats = Array.from({ length: 7 }, () => ({ w: 0, l: 0, events: 0 }));

    for (const ev of (eventData || [])) {
        if (!ev?.rounds || !ev._start_datetime) continue;
        const dow = new Date(ev._start_datetime).getDay();
        stats[dow].events++;
        for (const r of ev.rounds) { if (r.is_win) stats[dow].w++; else stats[dow].l++; }
    }

    const hasData = stats.some(s => s.events > 0);
    if (!hasData) { card.style.display = 'none'; return; }
    card.style.display = 'block';

    const tbody = document.getElementById('dayOfWeekBody');
    if (!tbody) return;
    tbody.innerHTML = stats.map((s, i) => {
        const t = s.w + s.l;
        const pct = t > 0 ? (s.w / t * 100).toFixed(1) : '—';
        const color = t > 0 ? (parseFloat(pct) >= 50 ? 'var(--win)' : 'var(--loss)') : 'var(--muted)';
        const barW = s.events > 0 ? Math.round((s.events / Math.max(...stats.map(x => x.events))) * 100) : 0;
        return `<tr>
            <td><strong>${days[i]}</strong></td>
            <td class="td-num">${s.events || '—'}</td>
            <td class="td-num" style="color:var(--win)">${s.w || '—'}</td>
            <td class="td-num" style="color:var(--loss)">${s.l || '—'}</td>
            <td class="td-pct" style="color:${color}">${pct}${pct !== '—' ? '%' : ''}</td>
            <td style="width:100px;">
                ${barW > 0 ? `<div style="height:8px;border-radius:4px;background:var(--accent);opacity:0.7;width:${barW}%"></div>` : ''}
            </td>
        </tr>`;
    }).join('');
}

// ── ROI per Tournament ──────────────────────────────────────────────────────
function displayRoi(eventData) {
    const card = document.getElementById('roiCard');
    const tbody = document.getElementById('roiBody');
    if (!card || !tbody) return;

    const evList = [...(eventData || [])].reverse();
    const rows = [];
    for (const ev of evList) {
        const r = computeEventRoi(ev);
        if (!r) continue;
        let evW = 0, evL = 0;
        for (const rnd of ev.rounds) { if (rnd.is_win) evW++; else evL++; }
        rows.push({ ev, r, evW, evL });
    }

    if (rows.length === 0) { card.style.display = 'none'; return; }
    card.style.display = 'block';

    const fmt = (n, cur) => cur ? `${cur} ${n.toFixed(2)}` : n.toFixed(2);
    tbody.innerHTML = '';
    for (const { ev, r, evW, evL } of rows) {
        const roiColor  = r.roi >= 0 ? 'var(--win)' : 'var(--loss)';
        const netColor  = r.net >= 0 ? 'var(--win)' : 'var(--loss)';
        const resultColor = evW > evL ? 'var(--win)' : evW < evL ? 'var(--loss)' : 'var(--muted)';
        const roiPrefix = r.roi >= 0 ? '+' : '';
        const netPrefix = r.net >= 0 ? '+' : '';
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${fmtDate(ev._start_datetime)}</td>
            <td>${ev._store_name ?? '—'}</td>
            <td class="td-num" style="color:${resultColor};font-weight:600">${evW}-${evL}</td>
            <td class="td-num">${r.players}</td>
            <td class="td-num">${fmt(r.fee, r.currency)}</td>
            <td class="td-num">${fmt(r.pot, r.currency)}</td>
            <td class="td-num" style="color:${r.prize > 0 ? 'var(--win)' : 'var(--muted)'}">${r.prize > 0 ? fmt(r.prize, r.currency) : '—'}</td>
            <td class="td-num" style="color:${netColor}">${netPrefix}${fmt(r.net, r.currency)}</td>
            <td class="td-pct" style="color:${roiColor}">${roiPrefix}${r.roi.toFixed(1)}%</td>`;
        tbody.appendChild(tr);
    }
}

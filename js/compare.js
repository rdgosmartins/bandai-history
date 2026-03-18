// ── Multi-user comparison ──────────────────────────────────────────────────

function buildCompareCard() {
    const card = document.getElementById('compareCard');
    if (App.usersWithToken.length < 2) { card.style.display = 'none'; return; }
    card.style.display = 'block';

    const currentIdx = parseInt(document.getElementById('userSelect').value);

    // Count matches played against each tracked player (by bandaiId)
    const matchCount = {};
    for (const ev of (App.allEventData || [])) {
        if (!ev?.rounds) continue;
        for (const r of ev.rounds) {
            const pid = r.opponent_users?.[0]?.membership_number;
            if (!pid) continue;
            matchCount[pid] = (matchCount[pid] || 0) + 1;
        }
    }

    // Find the tracked player (excluding current) with the most matches
    let mostFacedIdx = null, mostFacedCount = 0;
    App.usersWithToken.forEach((u, i) => {
        if (i === currentIdx) return;
        const c = matchCount[u.bandaiId] || 0;
        if (c > mostFacedCount) { mostFacedCount = c; mostFacedIdx = i; }
    });

    const sel = document.getElementById('compareUserSelect');
    sel.innerHTML = '<option value="">— select a user —</option>';
    App.usersWithToken.forEach((u, i) => {
        if (i === currentIdx) return;
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = u.name + (matchCount[u.bandaiId] ? ` (${matchCount[u.bandaiId]} matches)` : '');
        if (i === mostFacedIdx) opt.selected = true;
        sel.appendChild(opt);
    });

    // Auto-trigger comparison for the pre-selected player
    if (mostFacedIdx !== null) onCompareUserChange();
    else document.getElementById('compareContent').innerHTML = '';
}

function onCompareUserChange() {
    const idx = document.getElementById('compareUserSelect').value;
    if (idx === '') { document.getElementById('compareContent').innerHTML = ''; return; }

    const currentIdx = parseInt(document.getElementById('userSelect').value);
    const userA = App.usersWithToken[currentIdx];
    const userB = App.usersWithToken[parseInt(idx)];

    const cacheB = loadCache(userB.bandaiId);
    const evDataB = Object.values(cacheB);
    if (evDataB.length === 0) {
        document.getElementById('compareContent').innerHTML =
            `<p style="color:var(--muted);font-size:0.88rem;">No cached data for <strong>${userB.name}</strong>. Run Fetch &amp; Analyze for that user first.</p>`;
        return;
    }
    renderCompare(computeUserStats(userA.name, App.allEventData), computeUserStats(userB.name, evDataB));
}

function computeUserStats(name, eventData) {
    let w = 0, l = 0, tournaments = 0;
    const periodMap = {};
    for (const p of SET_PERIODS) periodMap[p.name] = { w: 0, l: 0 };
    for (const ev of eventData) {
        if (!ev?.rounds) continue;
        tournaments++;
        const period = ev._start_datetime ? getPeriodForDate(ev._start_datetime) : SET_PERIODS[0].name;
        for (const r of ev.rounds) {
            if (r.is_win) { w++; periodMap[period].w++; } else { l++; periodMap[period].l++; }
        }
    }
    let bestPeriod = null, bestPct = -1;
    for (const [pname, s] of Object.entries(periodMap)) {
        const t = s.w + s.l;
        if (t < 3) continue;
        const pct = s.w / t * 100;
        if (pct > bestPct) { bestPct = pct; bestPeriod = pname.split(' · ')[0]; }
    }
    return { name, w, l, tournaments, bestPeriod, bestPct };
}

function renderCompare(a, b) {
    const tA = a.w + a.l, tB = b.w + b.l;
    const pctA = tA > 0 ? (a.w / tA * 100).toFixed(1) : '0.0';
    const pctB = tB > 0 ? (b.w / tB * 100).toFixed(1) : '0.0';
    const aLeads = parseFloat(pctA) > parseFloat(pctB);
    const bLeads = parseFloat(pctB) > parseFloat(pctA);

    function userBox(u, pct, leads) {
        return `<div class="compare-user-box ${leads ? 'compare-active' : ''}">
            <h3>${u.name}${leads ? ' ◀' : ''}</h3>
            <div class="stat-grid" style="grid-template-columns:repeat(2,1fr);gap:0.6rem;">
                <div class="stat-box"><div class="val w-val" style="font-size:1.5rem">${u.w}</div><div class="lbl">Wins</div></div>
                <div class="stat-box"><div class="val l-val" style="font-size:1.5rem">${u.l}</div><div class="lbl">Losses</div></div>
                <div class="stat-box"><div class="val pct-val" style="font-size:1.5rem">${pct}%</div><div class="lbl">Win Rate</div></div>
                <div class="stat-box"><div class="val t-val" style="font-size:1.5rem">${u.tournaments}</div><div class="lbl">Events</div></div>
            </div>
            <div class="compare-bar-wrap">
                <div class="compare-bar-label">
                    <span>Win Rate</span>
                    <span class="${leads ? 'compare-winner' : ''}">${pct}%</span>
                </div>
                <div class="compare-bar"><div class="compare-bar-fill" style="width:${pct}%"></div></div>
            </div>
            ${u.bestPeriod ? `<p style="font-size:0.78rem;color:var(--muted);margin-top:0.6rem;">Best set: <strong>${u.bestPeriod}</strong> (${u.bestPct.toFixed(1)}%)</p>` : ''}
        </div>`;
    }
    document.getElementById('compareContent').innerHTML =
        `<div class="compare-cols">${userBox(a, pctA, aLeads)}${userBox(b, pctB, bLeads)}</div>`;
}

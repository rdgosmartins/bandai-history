// ── Date filter ────────────────────────────────────────────────────────────

function clearYearChips() {
    document.querySelectorAll('#yearChips .chip').forEach(c => c.classList.remove('active'));
}

function onYearChip(btn) {
    const year     = btn.dataset.year;
    const isActive = btn.classList.contains('active');
    clearYearChips();
    if (isActive) {
        document.getElementById('dateFrom').value = '';
        document.getElementById('dateTo').value   = '';
    } else {
        btn.classList.add('active');
        document.getElementById('dateFrom').value = `${year}-01-01`;
        document.getElementById('dateTo').value   = `${year}-12-31`;
    }
    applyFilter();
}

// When the user edits dates manually, deselect year chips (they may no longer match)
function onDateRangeChange() {
    clearYearChips();
    applyFilter();
}

function clearDateFilter() {
    document.getElementById('dateFrom').value = '';
    document.getElementById('dateTo').value   = '';
    clearYearChips();
    applyFilter();
}

function getDateRange() {
    const from = document.getElementById('dateFrom').value; // 'YYYY-MM-DD' or ''
    const to   = document.getElementById('dateTo').value;
    return {
        from: from ? new Date(from) : null,
        to:   to   ? new Date(to + 'T23:59:59') : null,
    };
}

// ── Store filter ───────────────────────────────────────────────────────────

function buildStoreFilter(allEventData) {
    const stores = new Set();
    for (const ev of allEventData) {
        if (ev._store_name) stores.add(ev._store_name);
    }
    const sel = document.getElementById('storeSelect');
    sel.innerHTML = '<option value="">— all stores —</option>';
    const sorted = [...stores].sort((a, b) => a.localeCompare(b));
    for (const name of sorted) {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        sel.appendChild(opt);
    }
    // Restore previous selection if still valid
    if (App.selectedStore && stores.has(App.selectedStore)) sel.value = App.selectedStore;
    else App.selectedStore = null;
}

function onStoreChange() {
    const val = document.getElementById('storeSelect').value;
    App.selectedStore = val || null;
    applyFilter();
}

function clearStoreFilter() {
    App.selectedStore = null;
    document.getElementById('storeSelect').value = '';
    applyFilter();
}

// ── Regionals filter ───────────────────────────────────────────────────────

const _regionalDates = new Set(REGIONALS.map(r => r.date));

function toggleRegionalsOnly() {
    App.regionalsOnly = !App.regionalsOnly;
    document.getElementById('regionalsOnlyBtn').classList.toggle('active', App.regionalsOnly);
    applyFilter();
}

// ── Player filter / autocomplete ───────────────────────────────────────────

function buildPlayerList() {
    // Returns sorted list of { id, name } for players that appear in App.allEventData
    const seen = new Map();
    for (const ev of App.allEventData) {
        if (!ev?.rounds) continue;
        for (const r of ev.rounds) {
            const pid = r.opponent_users?.[0]?.membership_number;
            if (pid && !seen.has(pid)) seen.set(pid, App.usernameMap[pid] || pid);
        }
    }
    return [...seen.entries()]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

function onPlayerSearchInput() {
    App.selectedPlayerId = null;
    App.acHighlight = -1;
    const q = document.getElementById('playerSearchInput').value.trim().toLowerCase();
    if (!q) { hideAutocomplete(); return; }
    const matches = buildPlayerList().filter(p => p.name.toLowerCase().includes(q)).slice(0, 20);
    renderAutocomplete(matches);
}

function renderAutocomplete(matches) {
    const ul = document.getElementById('playerAutocomplete');
    ul.innerHTML = '';
    if (matches.length === 0) { ul.style.display = 'none'; return; }
    matches.forEach((p, i) => {
        const li = document.createElement('li');
        li.textContent = p.name;
        li.dataset.pid = p.id;
        li.onmousedown = () => selectPlayer(p.id, p.name); // mousedown fires before blur
        ul.appendChild(li);
    });
    ul.style.display = 'block';
}

function showAutocomplete() {
    const q = document.getElementById('playerSearchInput').value.trim();
    if (q) onPlayerSearchInput();
}

function hideAutocomplete() {
    setTimeout(() => {
        document.getElementById('playerAutocomplete').style.display = 'none';
        App.acHighlight = -1;
    }, 150);
}

function onPlayerSearchKey(e) {
    const ul    = document.getElementById('playerAutocomplete');
    const items = [...ul.querySelectorAll('li')];
    if (!items.length) return;

    if (e.key === 'ArrowDown') {
        e.preventDefault();
        App.acHighlight = Math.min(App.acHighlight + 1, items.length - 1);
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        App.acHighlight = Math.max(App.acHighlight - 1, 0);
    } else if (e.key === 'Enter') {
        e.preventDefault();
        if (App.acHighlight >= 0) {
            const li = items[App.acHighlight];
            selectPlayer(li.dataset.pid, li.textContent);
        }
        return;
    } else if (e.key === 'Escape') {
        clearPlayerFilter();
        return;
    }

    items.forEach((li, i) => li.classList.toggle('highlighted', i === App.acHighlight));
    if (App.acHighlight >= 0) items[App.acHighlight].scrollIntoView({ block: 'nearest' });
}

function selectPlayer(pid, name) {
    App.selectedPlayerId = pid;
    document.getElementById('playerSearchInput').value = name;
    document.getElementById('playerAutocomplete').style.display = 'none';
    applyFilter();
}

function clearPlayerFilter() {
    App.selectedPlayerId = null;
    document.getElementById('playerSearchInput').value = '';
    document.getElementById('vsBanner').style.display = 'none';
    applyFilter();
}

// ── Period filter ──────────────────────────────────────────────────────────

function buildFilterChips(allEventData) {
    // Determine which periods actually have events
    const periodsWithData = new Set();
    for (const ev of allEventData) {
        if (!ev?.rounds) continue;
        const period = ev._start_datetime ? getPeriodForDate(ev._start_datetime) : SET_PERIODS[0].name;
        periodsWithData.add(period);
    }

    const container = document.getElementById('periodChips');
    container.innerHTML = '';

    // "All" chip
    const allChip = document.createElement('button');
    allChip.className = 'chip chip-all active';
    allChip.textContent = 'All';
    allChip.dataset.period = 'all';
    allChip.onclick = () => {
        const indiv = [...container.querySelectorAll('.chip:not(.chip-all)')];
        const allOn = indiv.every(c => c.classList.contains('active'));
        indiv.forEach(c => c.classList.toggle('active', !allOn));
        allChip.classList.toggle('active', !allOn);
        applyFilter();
    };
    container.appendChild(allChip);

    // One chip per period that has data
    for (const p of SET_PERIODS) {
        if (!periodsWithData.has(p.name)) continue;
        const chip = document.createElement('button');
        chip.className = 'chip active';
        chip.textContent = p.name.split(' · ')[0]; // short label
        chip.title = p.name;                        // full name on hover
        chip.dataset.period = p.name;
        chip.onclick = () => {
            chip.classList.toggle('active');
            const indiv = [...container.querySelectorAll('.chip:not(.chip-all)')];
            const allOn = indiv.every(c => c.classList.contains('active'));
            allChip.classList.toggle('active', allOn);
            applyFilter();
        };
        container.appendChild(chip);
    }

    document.getElementById('filterCard').style.display = 'block';
}

function getSelectedPeriods() {
    const chips = document.querySelectorAll('#periodChips .chip:not(.chip-all)');
    return new Set([...chips].filter(c => c.classList.contains('active')).map(c => c.dataset.period));
}

function applyFilter() {
    const selected  = getSelectedPeriods();
    const { from, to } = getDateRange();

    const filtered = App.allEventData.filter(ev => {
        if (!ev?.rounds) return false;

        // Period chip filter
        if (selected.size > 0) {
            const period = ev._start_datetime ? getPeriodForDate(ev._start_datetime) : SET_PERIODS[0].name;
            if (!selected.has(period)) return false;
        }

        // Date range filter
        if (ev._start_datetime) {
            const d = new Date(ev._start_datetime);
            if (from && d < from) return false;
            if (to   && d > to)   return false;
        }

        // Store filter
        if (App.selectedStore && ev._store_name !== App.selectedStore) return false;

        // Regionals-only filter
        if (App.regionalsOnly) {
            const d = ev._start_datetime?.slice(0, 10);
            if (!d || !_regionalDates.has(d)) return false;
        }

        return true;
    });

    let totalW = 0, totalL = 0;
    for (const ev of filtered) {
        if (!ev?.rounds) continue;
        for (const r of ev.rounds) { if (r.is_win) totalW++; else totalL++; }
    }

    const periodMap = {};
    for (const p of SET_PERIODS) periodMap[p.name] = { w: 0, l: 0 };
    for (const ev of filtered) {
        if (!ev?.rounds) continue;
        const period = ev._start_datetime ? getPeriodForDate(ev._start_datetime) : SET_PERIODS[0].name;
        for (const r of ev.rounds) { if (r.is_win) periodMap[period].w++; else periodMap[period].l++; }
    }

    const playerMap = {};
    for (const ev of filtered) {
        if (!ev?.rounds) continue;
        for (const r of ev.rounds) {
            const pid = r.opponent_users?.[0]?.membership_number;
            if (!pid) continue;
            if (!playerMap[pid]) playerMap[pid] = [0, 0];
            if (r.is_win) playerMap[pid][0]++; else playerMap[pid][1]++;
        }
    }
    App.playerResults = playerMap;

    // Update vs banner when a specific player is selected
    const banner = document.getElementById('vsBanner');
    if (App.selectedPlayerId && playerMap[App.selectedPlayerId]) {
        const [w, l] = playerMap[App.selectedPlayerId];
        const t   = w + l;
        const pct = t > 0 ? (w / t * 100).toFixed(1) : '0.0';
        document.getElementById('vsName').textContent  = App.usernameMap[App.selectedPlayerId] || App.selectedPlayerId;
        document.getElementById('vsStats').innerHTML   = `<span style="color:var(--win)">${w}W</span> / <span style="color:var(--loss)">${l}L</span> — <strong>${pct}%</strong> win rate over ${t} match${t !== 1 ? 'es' : ''}`;
        banner.style.display = 'flex';
    } else if (App.selectedPlayerId) {
        document.getElementById('vsName').textContent  = App.usernameMap[App.selectedPlayerId] || App.selectedPlayerId;
        document.getElementById('vsStats').innerHTML   = 'No matches in the selected period';
        banner.style.display = 'flex';
    } else {
        banner.style.display = 'none';
    }

    computeCompetitiveBadges();
    displayResults('', totalW, totalL, periodMap, playerMap, filtered);
}

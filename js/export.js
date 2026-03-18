// ── PDF export ─────────────────────────────────────────────────────────────

function _doPrint(bodyClass) {
    const wasCollapsed = [...document.querySelectorAll('.card-body.collapsed')];
    wasCollapsed.forEach(body => body.classList.remove('collapsed'));
    document.body.classList.add(bodyClass);

    function restore() {
        wasCollapsed.forEach(body => body.classList.add('collapsed'));
        document.body.classList.remove(bodyClass);
        window.removeEventListener('afterprint', restore);
    }
    window.addEventListener('afterprint', restore);
    window.print();
}

function exportPDF()         { _doPrint('print-my-stats'); }
function exportRankingsPDF() { _doPrint('print-rankings'); }

// ── Export ─────────────────────────────────────────────────────────────────

function exportExcel() {
    if (!App.playerResults) return;
    const sorted = Object.entries(App.playerResults)
        .sort((a, b) => (b[1][0] + b[1][1]) - (a[1][0] + a[1][1]));

    const data = [["Player", "W", "L", "Total", "Win%"]];
    for (const [pid, res] of sorted) {
        const tag   = App.usernameMap[pid] || pid;
        const [w, l] = res;
        const t     = w + l;
        const pct   = t > 0 ? parseFloat((w / t * 100).toFixed(1)) : 0;
        data.push([tag, w, l, t, pct]);
    }

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws['!cols'] = [{ wch: 24 }, { wch: 6 }, { wch: 6 }, { wch: 8 }, { wch: 8 }];
    XLSX.utils.book_append_sheet(wb, ws, "Results");
    XLSX.writeFile(wb, "bandai_results.xlsx");
}

// ── HTML export (fully interactive standalone) ──────────────────────────────

async function exportHTML() {
    const userSel    = document.getElementById('userSelect');
    const bandaiId   = userSel?.value || '';
    const playerName = userSel ? (userSel.options[userSel.selectedIndex]?.text || 'Player') : 'Player';
    const dateStr    = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const theme      = document.body.dataset.theme || '';

    // ── 1. Inline local CSS ──────────────────────────────────────────────────
    const localCSSFiles = ['css/variables.css','css/layout.css','css/components.css','css/yoko.css'];
    const cssChunks = await Promise.all(localCSSFiles.map(f =>
        fetch(f).then(r => r.ok ? r.text() : '').catch(() => '')
    ));
    const inlinedCSS = cssChunks.join('\n');

    // ── 2. Inline local JS (in dependency order, skip export.js itself) ──────
    const localJSFiles = [
        'js/state.js','js/constants.js','js/utils.js','js/filter.js',
        'js/display-charts.js','js/display-mystats.js','js/compare.js',
        'js/modal.js','js/rankings.js','js/inspector.js',
        'js/yoko.js','js/player-profile.js','js/theme.js'
    ];
    const jsChunks = await Promise.all(localJSFiles.map(f =>
        fetch(f).then(r => r.ok ? r.text() : '').catch(() => '')
    ));
    const inlinedJS = jsChunks.join('\n\n');

    // ── 3. Serialize current player data ─────────────────────────────────────
    const eventData   = App.allEventData || [];
    const usernameMap = App.usernameMap  || {};
    const compBadges  = App.competitiveBadges ? JSON.stringify(App.competitiveBadges) : 'null';

    // Collect all known user caches so cross-player rankings work offline
    const allCaches = {};
    for (const u of (App.usersWithToken || [])) {
        const cached = loadCache(u.bandaiId);
        if (cached) allCaches[u.bandaiId] = cached;
    }

    // Build usersWithToken list (strip tokens — only need bandaiId + name)
    const usersMinimal = (App.usersWithToken || []).map(u => ({
        bandaiId: u.bandaiId,
        name:     u.name || usernameMap[u.bandaiId] || u.bandaiId
    }));

    // ── 4. HTML filter section (identical to analyzer.html, stripped of step 1/2 setup) ──
    const filterSection = `
<div class="card" style="margin-bottom:1rem;">
  <div class="card-header" onclick="toggleCard('filter')">
    <h2><span class="section-icon">&#128269;</span> Filters</h2>
    <span class="toggle-icon" id="filter-icon">▼</span>
  </div>
  <div class="card-body" id="filter-body" style="max-height:9999px;">
    <div class="chip-row" id="periodChips"></div>
    <div class="filter-row" style="margin-top:1rem;">
      <div class="chip-row" id="yearChips">
        <button class="chip" data-year="2024" onclick="onYearChip(this)">2024</button>
        <button class="chip" data-year="2025" onclick="onYearChip(this)">2025</button>
        <button class="chip" data-year="2026" onclick="onYearChip(this)">2026</button>
      </div>
    </div>
    <div class="filter-row" style="margin-top:0.5rem;">
      <div class="filter-group">
        <label for="dateFrom">From</label>
        <input type="date" id="dateFrom" onchange="onDateRangeChange()">
      </div>
      <div class="filter-group">
        <label for="dateTo">To</label>
        <input type="date" id="dateTo" onchange="onDateRangeChange()">
      </div>
      <button class="btn btn-outline btn-sm" onclick="clearDateFilter()" style="align-self:flex-end">&#10005; Clear dates</button>
    </div>
    <div class="filter-row" style="margin-top:0.75rem;">
      <div class="filter-group" style="flex:1;min-width:200px;">
        <label for="storeSelect">Store</label>
        <select id="storeSelect" onchange="onStoreChange()">
          <option value="">— all stores —</option>
        </select>
      </div>
      <button class="btn btn-outline btn-sm" onclick="clearStoreFilter()" style="align-self:flex-end">&#10005; Clear store</button>
    </div>
    <div class="filter-row" style="margin-top:0.75rem;">
      <button id="regionalsOnlyBtn" class="chip" onclick="toggleRegionalsOnly()">Regionals only</button>
    </div>
  </div>
</div>`;

    // ── 5. Results container HTML (from live DOM) ─────────────────────────────
    const resultsEl = document.getElementById('results');
    const clone = resultsEl.cloneNode(true);
    // Remove toolbar + inspector from clone (bootstrap will re-render)
    clone.querySelectorAll('.pdf-toolbar, #inspectorCard').forEach(el => el.remove());
    // Clear dynamic content — will be re-rendered by bootstrap
    ['overallStats','gameStats','streakStats','bogeymanStats','placementsInline',
     'placementsStats','placementsTiers','periodChips','tournamentsBody',
     'achievementsCard','achievementsGrid','competitiveBadgesSection',
     'opponentTableBody','opponentSearch','storeSelect'].forEach(id => {
        const el = clone.querySelector('#'+id);
        if (el) el.innerHTML = '';
    });
    clone.querySelectorAll('canvas').forEach(c => c.remove());

    // ── 6. Bootstrap script ───────────────────────────────────────────────────
    const bootstrap = `
(function() {
    // Restore caches to localStorage so loadCache() works for rankings
    const _caches = ${JSON.stringify(allCaches)};
    for (const [bid, data] of Object.entries(_caches)) {
        try { localStorage.setItem('bandai_cache_' + bid, JSON.stringify(data)); } catch(e){}
    }

    // Restore App state
    App.usernameMap      = ${JSON.stringify(usernameMap)};
    App.usersWithToken   = ${JSON.stringify(usersMinimal)};
    App.allEventData     = ${JSON.stringify(eventData)};
    App.selectedPlayerId = ${JSON.stringify(bandaiId)};
    App.competitiveBadges = ${compBadges};

    // Populate userSelect with exported player only
    const userSel = document.getElementById('userSelect');
    if (userSel) {
        userSel.innerHTML = '';
        const opt = document.createElement('option');
        opt.value = ${JSON.stringify(bandaiId)};
        opt.textContent = ${JSON.stringify(playerName)};
        userSel.appendChild(opt);
        userSel.value = ${JSON.stringify(bandaiId)};
        userSel.disabled = false;
    }

    // Show results, hide setup UI
    const results = document.getElementById('results');
    if (results) results.style.display = '';
    const tabNav = document.getElementById('tabNav');
    if (tabNav) tabNav.style.display = '';

    // Build store filter and run initial render
    buildStoreFilter(App.allEventData);
    computeCompetitiveBadges();
    applyFilter();
})();`;

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${playerName} — Bandai TCG History (${dateStr})</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700;800&display=swap" rel="stylesheet">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js"></script>
  <style>${inlinedCSS}
    body { padding: 1.5rem; }
    #setupSection, .pdf-toolbar { display: none !important; }
  </style>
</head>
<body data-theme="${theme}">
  <div style="margin-bottom:1.5rem; padding-bottom:1rem; border-bottom:1px solid var(--border); display:flex; align-items:center; justify-content:space-between;">
    <div>
      <h1 style="font-family:'Cinzel',serif; font-size:1.4rem; color:var(--gold); margin:0 0 0.2rem;">${playerName}</h1>
      <p style="margin:0; font-size:0.8rem; color:var(--muted);">Bandai TCG History — Exportado em ${dateStr}</p>
    </div>
    <button class="btn btn-outline btn-sm" onclick="document.body.dataset.theme = document.body.dataset.theme === 'dark' ? '' : 'dark'">&#9680; Tema</button>
  </div>

  <!-- Hidden inputs required by filter functions -->
  <select id="userSelect" style="display:none"></select>

  ${filterSection}

  <div id="results">
    ${clone.innerHTML}
  </div>

  <script>${inlinedJS}</script>
  <script>${bootstrap}</script>
</body>
</html>`;

    const blob = new Blob([html], { type: 'text/html;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    const safeName = playerName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    a.href = url;
    a.download = `bandai_history_${safeName}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportCSV() {
    if (!App.allEventData || App.allEventData.length === 0) return;

    function dl(filename, rows) {
        const csv = rows.map(r =>
            r.map(v => {
                const s = String(v ?? '');
                return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
            }).join(',')
        ).join('\r\n');
        const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    const evs = [...App.allEventData]
        .filter(ev => ev?.rounds)
        .sort((a, b) => (b._start_datetime || '').localeCompare(a._start_datetime || ''));

    // 1. Tournament history
    const tourRows = [['Date', 'Event', 'Store', 'W', 'L', 'Game W', 'Game L', 'Win%', 'Rank', 'Points']];
    for (const ev of evs) {
        let evW = 0, evL = 0, evGW = 0, evGL = 0;
        for (const r of ev.rounds) {
            if (r.is_win) evW++; else evL++;
            evGW += r.win_count  != null ? r.win_count  : (r.is_win ? 1 : 0);
            evGL += r.lose_count != null ? r.lose_count : (r.is_win ? 0 : 1);
        }
        const t = evW + evL;
        tourRows.push([
            ev._start_datetime ? ev._start_datetime.slice(0, 10) : '',
            ev._event_name ?? '',
            ev._store_name ?? '',
            evW, evL, evGW, evGL,
            t > 0 ? (evW / t * 100).toFixed(1) + '%' : '—',
            ev._rank != null ? ev._rank : '',
            ev._match_points != null ? ev._match_points : ''
        ]);
    }
    dl('bandai_tournament_history.csv', tourRows);

    // 2. Opponent history (from App.playerResults)
    setTimeout(() => {
        if (!App.playerResults) return;
        const oppRows = [['Player', 'W', 'L', 'Total', 'Win%']];
        const sorted = Object.entries(App.playerResults).sort((a, b) => (b[1][0]+b[1][1]) - (a[1][0]+a[1][1]));
        for (const [pid, res] of sorted) {
            const [w, l] = res;
            const t = w + l;
            oppRows.push([App.usernameMap[pid] || pid, w, l, t, t > 0 ? (w/t*100).toFixed(1)+'%' : '—']);
        }
        dl('bandai_opponent_history.csv', oppRows);
    }, 300);

    // 3. Round-by-round detail
    setTimeout(() => {
        const rndRows = [['Date', 'Event', 'Round', 'Opponent', 'Result', 'Score']];
        for (const ev of evs) {
            const date  = ev._start_datetime ? ev._start_datetime.slice(0, 10) : '';
            const name  = ev._event_name ?? '';
            for (const r of ev.rounds) {
                const opp    = r.opponent_users?.[0]?.player_name ?? r.opponent_users?.[0]?.membership_number ?? '—';
                const result = r.is_win ? 'Win' : 'Loss';
                const gw = r.win_count  != null ? r.win_count  : (r.is_win ? 1 : 0);
                const gl = r.lose_count != null ? r.lose_count : (r.is_win ? 0 : 1);
                rndRows.push([date, name, r.round_no ?? '—', opp, result, `${gw}-${gl}`]);
            }
        }
        dl('bandai_rounds.csv', rndRows);
    }, 600);
}

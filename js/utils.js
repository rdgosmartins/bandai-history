function toggleCard(cardId) {
    const body = document.getElementById(cardId + '-body');
    const icon = document.getElementById(cardId + '-icon');
    if (!body) return;
    body.classList.toggle('collapsed');
    if (icon) icon.style.transform = body.classList.contains('collapsed') ? 'rotate(-90deg)' : '';
}

// Format a YYYY-MM-DD (or ISO datetime) string as DD/MM/YYYY
function fmtDate(dateStr) {
    if (!dateStr || dateStr === '—') return '—';
    const part = dateStr.slice(0, 10); // works for both 'YYYY-MM-DD' and full ISO
    const [y, m, d] = part.split('-');
    return `${d}/${m}/${y}`;
}

function getPeriodForDate(dateStr) {
    const d = new Date(dateStr);
    let period = SET_PERIODS[0].name;
    for (let i = 1; i < SET_PERIODS.length; i++) {
        if (d >= SET_PERIODS[i].date) period = SET_PERIODS[i].name;
        else break;
    }
    return period;
}

function setProgress(text, pct) {
    document.getElementById('progressText').textContent = text;
    document.getElementById('progressBar').style.width = pct + '%';
}

function showError(html) {
    const box = document.getElementById('errorBox');
    box.innerHTML = `<div class="error-box">${html}</div>`;
    box.style.display = 'block';
}

function clearError() {
    const box = document.getElementById('errorBox');
    box.style.display = 'none';
    box.innerHTML = '';
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Sortable tables ────────────────────────────────────────────────────────

const sortState = {};
function sortTable(tableId, col) {
    const table = document.getElementById(tableId);
    const tbody = table.querySelector('tbody');
    const rows  = Array.from(tbody.querySelectorAll('tr'));
    const key   = tableId + '_' + col;
    const asc   = sortState[key] !== true;
    sortState[key] = asc;

    table.querySelectorAll('thead th').forEach((th, i) => {
        th.classList.remove('sorted-asc', 'sorted-desc');
        if (i === col) th.classList.add(asc ? 'sorted-asc' : 'sorted-desc');
    });

    rows.sort((a, b) => {
        const clean = v => v.replace(/[%#]/g, '').trim();
        let av = clean(a.cells[col].textContent);
        let bv = clean(b.cells[col].textContent);
        // Convert DD/MM/YYYY → YYYY-MM-DD so date columns sort correctly
        const toIso = v => {
            const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
            return m ? `${m[3]}-${m[2]}-${m[1]}` : v;
        };
        av = toIso(av); bv = toIso(bv);
        const an = parseFloat(av), bn = parseFloat(bv);
        if (!isNaN(an) && !isNaN(bn)) return asc ? an - bn : bn - an;
        return asc ? av.localeCompare(bv) : bv.localeCompare(av);
    });
    rows.forEach(r => tbody.appendChild(r));
}

// ── Shared win-rate helper ───────────────────────────────────────────────────
// Consolidado aqui porque a mesma conta (wins/total*100) estava reimplementada
// em display-mystats.js, match-tracker.js, player-profile.js e rankings.js.
// decimals=1 dá "62.5", decimals=0 dá "63" (arredondado) — cada call site usava
// uma das duas variações, então isso preserva o comportamento de cada um.
function calcWinPct(wins, total, decimals = 1) {
    if (!total) return decimals === 0 ? 0 : '0.0';
    const pct = (wins / total) * 100;
    return decimals === 0 ? Math.round(pct) : pct.toFixed(decimals);
}

// ── Shared HTML-escape helper ────────────────────────────────────────────────
// Centralizado aqui — antes existia uma cópia quase idêntica em match-tracker.js
// (removida) e em profile.html (mantida lá, já que profile.html é uma página
// separada que não carrega utils.js).
function _esc(str) {
    const div = document.createElement('div');
    div.textContent = String(str ?? '');
    return div.innerHTML;
}

// ── Shared authenticated fetch helper ────────────────────────────────────────
// O padrão `fetch(AUTH_BASE + path, { credentials: 'include', ...opts })` estava
// repetido dezenas de vezes pelo código. apiFetch() centraliza isso — mesmo
// comportamento, só sem repetir `credentials: 'include'` toda vez. Retorna a
// Response crua (não faz .json() automaticamente), pra não mudar como cada
// call site já trata erro/parsing.
function apiFetch(path, options = {}) {
    return fetch(AUTH_BASE + path, { credentials: 'include', ...options });
}

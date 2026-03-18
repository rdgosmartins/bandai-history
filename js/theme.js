// ── Dark / Light mode ──────────────────────────────────────────────────────

function applyTheme(dark) {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    const btn = document.getElementById('themeToggleBtn');
    if (btn) btn.innerHTML = dark ? '&#9728;&#65039; Light' : '&#127775; Dark';
    // Update wave SVG fill to match background
    const wavePath = document.getElementById('wavePath');
    if (wavePath) {
        const bg = getComputedStyle(document.documentElement).getPropertyValue('--wave-fill').trim();
        wavePath.setAttribute('fill', bg);
    }
    // Redraw charts so colors update
    if (typeof App !== 'undefined' && App.allEventData && App.allEventData.length) {
        const sel = document.getElementById('userSelect');
        if (sel && sel.value !== '') applyFilter();
    }
    // Redraw rankings progression chart if visible
    if (document.getElementById('rankingsTab')?.style.display !== 'none') buildGlobalRankings();
}

function toggleTheme() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const next   = !isDark;
    localStorage.setItem('op-theme', next ? 'dark' : 'light');
    applyTheme(next);
}

// Apply saved or system preference on load
(function () {
    const saved  = localStorage.getItem('op-theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(saved ? saved === 'dark' : prefersDark);
})();

// ── Opponent profile modal ─────────────────────────────────────────────────

function openOpponentModal(pid) {
    const name    = App.usernameMap[pid] || pid;
    const history = App.opponentMatchHistory[pid] || [];
    const [w, l]  = App.playerResults[pid] || [0, 0];
    const t       = w + l;
    const pct     = t > 0 ? (w / t * 100).toFixed(1) : '0.0';

    document.getElementById('modalPlayerName').textContent = `vs ${name}`;
    document.getElementById('modalPlayerRecord').innerHTML =
        `<span style="color:var(--win)">${w}W</span> / <span style="color:var(--loss)">${l}L</span> — ${pct}% win rate · ${history.length} event${history.length !== 1 ? 's' : ''}`;

    const tbody = document.getElementById('modalMatchBody');
    tbody.innerHTML = '';
    const sorted = [...history].sort((a, b) => b.dateStr.localeCompare(a.dateStr));
    for (const m of sorted) {
        const tr = document.createElement('tr');
        const resultColor = m.w > m.l ? 'var(--win)' : m.l > m.w ? 'var(--loss)' : 'var(--muted)';
        const resultStr = `${m.w}W-${m.l}L`;
        const gameStr   = (m.gw != null && m.gl != null) ? `${m.gw}-${m.gl}` : '—';
        tr.innerHTML = `<td>${fmtDate(m.dateStr)}</td><td>${m.evName}</td>
            <td class="td-num" style="color:${resultColor};font-weight:600">${resultStr}</td>
            <td class="td-num">${gameStr}</td>`;
        tbody.appendChild(tr);
    }
    document.getElementById('opponentModal').classList.add('open');
}

function closeOpponentModal(event) {
    if (event.target === document.getElementById('opponentModal'))
        document.getElementById('opponentModal').classList.remove('open');
}

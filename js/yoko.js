// ── Yoko Stats Tab — Competitive Titles ─────────────────────────────────────
// (A seção de "Live Events" foi removida — este arquivo agora só cuida dos
// badges/patentes competitivas: Rei dos Piratas, Yonkou, Shichibukai, Almirante.)

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
                    <div class="hof-banner-sub">Best win rate of the year (Jan–Dec) · awarded after Dec 31</div>
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

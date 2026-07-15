// ── Matchmaker Tab (dados do bot Discord YOKO Matchmaker) ───────────────────────
// Somente leitura: o SQLite do bot é a fonte da verdade, isso aqui é um espelho
// pro dashboard exibir ranking/histórico. Nenhuma ação aqui altera o matchmaking.

// Sistema de patentes e bounty baseado em faixas de ELO (mesma lógica do bot Discord,
// em src/ranks.js — mantenha os dois em sincronia se ajustar os valores).

const MM_ELO_FLOOR = 400;

const MM_TIERS = [
    { name: 'Novato do Grand Line', emoji: '🏴‍☠️', eloMin: -Infinity, eloMax: 999,  bountyMin: 0,             bountyMax: 100_000_000 },
    { name: 'Supernova',            emoji: '🌟',    eloMin: 1000,      eloMax: 1299, bountyMin: 100_000_000,   bountyMax: 500_000_000 },
    { name: 'Shichibukai',          emoji: '⚔️',    eloMin: 1300,      eloMax: 1599, bountyMin: 500_000_000,   bountyMax: 1_000_000_000 },
    { name: 'Yonko',                emoji: '☠️',    eloMin: 1600,      eloMax: 1899, bountyMin: 1_000_000_000, bountyMax: 5_046_000_000 },
    { name: 'Rei dos Piratas',      emoji: '👑',    eloMin: 1900,      eloMax: Infinity, bountyMin: 5_564_800_000, bountyMax: 5_564_800_000, locked: true },
];

function mmGetTier(elo) {
    for (const t of MM_TIERS) if (elo >= t.eloMin && elo <= t.eloMax) return t;
    return MM_TIERS[MM_TIERS.length - 1];
}

function mmGetPatente(elo) {
    const t = mmGetTier(elo);
    return { name: t.name, emoji: t.emoji };
}

function mmGetBounty(elo) {
    const t = mmGetTier(elo);
    if (t.locked) return t.bountyMin;
    const effectiveMin = t.eloMin === -Infinity ? MM_ELO_FLOOR : t.eloMin;
    if (elo <= effectiveMin) return t.bountyMin;
    const clampedElo = Math.min(elo, t.eloMax);
    const ratio = (clampedElo - effectiveMin) / (t.eloMax - effectiveMin);
    return Math.max(0, Math.round(t.bountyMin + ratio * (t.bountyMax - t.bountyMin)));
}

function mmFormatBounty(elo) {
    return mmGetBounty(elo).toLocaleString('pt-BR') + ' Berries';
}

function mmHtml() {
    return `
        <div class="card">
            <div class="card-header" onclick="toggleCard('mmRanking')">
                <h2><span class="section-icon">&#9760;&#65039;</span> Cartazes de Procurado — Ranking</h2>
                <span class="toggle-icon" id="mmRanking-icon">&#9660;</span>
            </div>
            <div class="card-body" id="mmRanking-body" style="max-height:9999px;">
                <p style="font-size:0.8rem;color:var(--muted);margin-bottom:1rem;">
                    Ranking do bot de matchmaking do Discord — atualizado a cada partida confirmada.
                </p>
                <div class="table-wrap">
                    <table id="mmRankingTable">
                        <thead><tr><th>#</th><th>Jogador</th><th>Bounty</th><th>Patente</th><th>W</th><th>L</th></tr></thead>
                        <tbody id="mmRankingBody"><tr><td colspan="6">Carregando…</td></tr></tbody>
                    </table>
                </div>
            </div>
        </div>

        <div class="card">
            <div class="card-header" onclick="toggleCard('mmProfile')">
                <h2><span class="section-icon">&#128100;</span> Buscar Perfil</h2>
                <span class="toggle-icon" id="mmProfile-icon">&#9660;</span>
            </div>
            <div class="card-body" id="mmProfile-body" style="max-height:9999px;">
                <div style="display:flex;gap:.6rem;margin-bottom:1rem;">
                    <input type="text" id="mmSearchInput" placeholder="Discord ID do jogador"
                        style="flex:1;padding:.5rem .7rem;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text);font-size:.85rem;">
                    <button class="podium-sort-btn" onclick="mmSearchPlayer()">Buscar</button>
                </div>
                <div id="mmProfileResult"></div>
            </div>
        </div>

        <div class="card">
            <div class="card-header" onclick="toggleCard('mmMatches')">
                <h2><span class="section-icon">&#128220;</span> Partidas Recentes</h2>
                <span class="toggle-icon" id="mmMatches-icon">&#9660;</span>
            </div>
            <div class="card-body" id="mmMatches-body" style="max-height:9999px;">
                <div class="table-wrap">
                    <table id="mmMatchesTable">
                        <thead><tr><th>Vencedor</th><th>Derrotado</th><th>Quando</th></tr></thead>
                        <tbody id="mmMatchesBody"><tr><td colspan="3">Carregando…</td></tr></tbody>
                    </table>
                </div>
            </div>
        </div>
    `;
}

async function loadMatchmakerTab() {
    const el = document.getElementById('matchmakerTab');
    if (!el) return;

    if (!el.dataset.loaded) {
        el.innerHTML = mmHtml();
        el.dataset.loaded = '1';
    }

    await Promise.all([mmLoadRanking(), mmLoadRecentMatches()]);
}

async function mmLoadRanking() {
    const tbody = document.getElementById('mmRankingBody');
    try {
        const res = await fetch(`${AUTH_BASE}/matchmaker/ranking?limit=10`);
        const data = await res.json();
        if (!data.players || data.players.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6">Ninguém jogou ainda. Entre na fila no Discord com <code>/entrar-fila</code>!</td></tr>';
            return;
        }
        tbody.innerHTML = data.players.map((p, i) => {
            const patente = mmGetPatente(p.elo);
            return `<tr>
                <td>${i + 1}</td>
                <td>${_esc(p.username)}</td>
                <td>${mmFormatBounty(p.elo)}</td>
                <td>${patente.emoji} ${patente.name}</td>
                <td>${p.wins}</td>
                <td>${p.losses}</td>
            </tr>`;
        }).join('');
    } catch (err) {
        tbody.innerHTML = '<tr><td colspan="6">Erro ao carregar ranking.</td></tr>';
        console.error('[Matchmaker] ranking error:', err);
    }
}

async function mmLoadRecentMatches() {
    const tbody = document.getElementById('mmMatchesBody');
    try {
        const res = await fetch(`${AUTH_BASE}/matchmaker/matches?limit=15`);
        const data = await res.json();
        if (!data.matches || data.matches.length === 0) {
            tbody.innerHTML = '<tr><td colspan="3">Nenhuma partida registrada ainda.</td></tr>';
            return;
        }
        tbody.innerHTML = data.matches.map(m => {
            const when = new Date(m.resolvedAt).toLocaleString('pt-BR');
            const winnerDelta = m.winner.delta >= 0 ? `+${m.winner.delta}` : `${m.winner.delta}`;
            return `<tr>
                <td>${_esc(m.winner.username)} (${winnerDelta})</td>
                <td>${_esc(m.loser.username)} (${m.loser.delta})</td>
                <td>${when}</td>
            </tr>`;
        }).join('');
    } catch (err) {
        tbody.innerHTML = '<tr><td colspan="3">Erro ao carregar partidas.</td></tr>';
        console.error('[Matchmaker] matches error:', err);
    }
}

async function mmSearchPlayer() {
    const input = document.getElementById('mmSearchInput');
    const resultDiv = document.getElementById('mmProfileResult');
    const id = input.value.trim();
    if (!id) return;

    resultDiv.innerHTML = '<p style="color:var(--muted);">Buscando…</p>';
    try {
        const res = await fetch(`${AUTH_BASE}/matchmaker/player/${encodeURIComponent(id)}`);
        if (!res.ok) {
            resultDiv.innerHTML = '<p style="color:var(--muted);">Jogador não encontrado.</p>';
            return;
        }
        const data = await res.json();
        const p = data.player;
        const patente = mmGetPatente(p.elo);
        const total = p.wins + p.losses;
        const winrate = total > 0 ? ((p.wins / total) * 100).toFixed(1) : '0.0';

        resultDiv.innerHTML = `
            <div style="padding:.8rem;border:1px solid var(--border);border-radius:8px;">
                <strong>${patente.emoji} ${_esc(p.username)}</strong> — ${patente.name}<br>
                Bounty: ${mmFormatBounty(p.elo)}<br>
                ${p.wins}V / ${p.losses}D (${winrate}% winrate)
            </div>`;
    } catch (err) {
        resultDiv.innerHTML = '<p style="color:var(--muted);">Erro ao buscar jogador.</p>';
        console.error('[Matchmaker] player search error:', err);
    }
}

// _esc() vem de js/utils.js (compartilhada, evita duplicar com match-tracker.js)

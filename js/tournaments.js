// ── Tournament Management ─────────────────────────────────────────────────────
// Requires: state.js (App), auth.js (AUTH_BASE)

let _trnParticipants  = [];
let _trnSearchResults = {};
let _currentTrn       = null;
let _trnIsAdmin       = false;
let _trnTimerInterval = null;
let _trnLiveInterval  = null;
let _trnTab           = 'lista'; // 'lista' | 'circuito' | 'aovivo'
let _circuits          = [];
let _selectedCircuitId = null;
let _cachedTournaments = [];
let _crcParticipants   = [];
let _ecrcParticipants  = [];

// ── Sub-nav ───────────────────────────────────────────────────────────────────

function switchTrnTab(tab) {
    _trnTab = tab;
    ['lista','aovivo'].forEach(t => {
        const btn = document.getElementById('trnTabBtn_' + t);
        const panel = document.getElementById('trnPanel_' + t);
        if (btn)   btn.classList.toggle('active', t === tab);
        if (panel) panel.style.display = t === tab ? '' : 'none';
    });
    if (tab === 'aovivo')   loadLiveView();
    if (tab !== 'aovivo' && _trnLiveInterval) { clearInterval(_trnLiveInterval); _trnLiveInterval = null; }
}

// ── List ──────────────────────────────────────────────────────────────────────

async function loadTournaments() {
    _trnIsAdmin = document.getElementById('createTournamentBtn')?.style.display !== 'none';
    _showTrnList();
    switchTrnTab(_trnTab);
    if (_trnTab !== 'lista') return;
    const listEl = document.getElementById('tournamentList');
    if (listEl) listEl.innerHTML = '<p style="color:var(--muted);text-align:center;padding:2rem 0;">Carregando…</p>';
    try {
        const [tRes, cRes] = await Promise.all([
            fetch(`${AUTH_BASE}/tournaments`, { credentials: 'include' }),
            fetch(`${AUTH_BASE}/circuits`,    { credentials: 'include' }),
        ]);
        if (!tRes.ok) throw new Error('HTTP ' + tRes.status);
        const [tournaments, circuits] = await Promise.all([tRes.json(), cRes.ok ? cRes.json() : Promise.resolve([])]);
        _circuits = circuits;
        _renderTournamentList(tournaments);
    } catch {
        if (listEl) listEl.innerHTML = '<p style="color:var(--loss);text-align:center;padding:1.5rem 0;">Erro ao carregar torneios.</p>';
    }
}

function _showTrnList()   {
    document.getElementById('tournamentListCard').style.display = '';
    document.getElementById('tournamentDetailCard').style.display = 'none';
    _stopTimerDisplay();
}
function _showTrnDetail() {
    document.getElementById('tournamentListCard').style.display = 'none';
    document.getElementById('tournamentDetailCard').style.display = '';
}

const FMT_LABEL = { swiss: 'Swiss', round_robin: 'Pontos Corridos', top_cut: 'Top Cut', swiss_top_cut: 'Swiss + Top Cut' };

function _renderTournamentList(list) {
    const listEl = document.getElementById('tournamentList');
    if (!list.length) { listEl.innerHTML = '<p style="color:var(--muted);text-align:center;padding:2.5rem 0;">Nenhum torneio criado ainda.</p>'; return; }
    const stLabel = { pending: 'Pendente', in_progress: 'Em Andamento', completed: 'Concluído' };
    const stColor = { pending: 'var(--muted)', in_progress: 'var(--accent)', completed: 'var(--win)' };
    const rows = list.map(t => {
        const dateStr  = t.date ? new Date(t.date + 'T12:00:00').toLocaleDateString('pt-BR') : '—';
        const fmtExtra = t.format === 'swiss' || t.format === 'swiss_top_cut'
            ? (t.format === 'swiss_top_cut' ? ` (Top ${t.swissTopCutSize || 8})` : ' (até 1 invicto)')
            : t.format === 'top_cut' ? ` (Top ${t.topCutSize})` : '';
        const n = t.participants?.length || 0;
        const phaseTag = t.phase === 'top_cut' ? ' <span style="font-size:.7rem;color:var(--gold);font-weight:600;">[Top Cut]</span>' : '';
        const crc = t.circuitId ? _circuits.find(c => c.id === t.circuitId) : null;
        const crcBadge = crc ? ` <span class="trn-circuit-badge">${_tEsc(crc.name)}</span>` : '';
        return `<tr style="cursor:pointer;" onclick="openTournamentDetail('${t.id}')">
            <td><strong>${_tEsc(t.name)}</strong>${phaseTag}${crcBadge}</td>
            <td>${dateStr}</td>
            <td>${FMT_LABEL[t.format] || t.format}${fmtExtra}</td>
            <td>${(t.matchFormat || 'md3').toUpperCase()}</td>
            <td>${n} player${n !== 1 ? 's' : ''}</td>
            <td><span style="color:${stColor[t.status] || 'var(--muted)'};font-weight:600;">${stLabel[t.status] || t.status}</span></td>
        </tr>`;
    }).join('');
    listEl.innerHTML = `<div class="table-wrap"><table>
        <thead><tr><th>Nome</th><th>Data</th><th>Formato</th><th>MD</th><th>Players</th><th>Status</th></tr></thead>
        <tbody>${rows}</tbody>
    </table></div>`;
}

// ── Detail view ───────────────────────────────────────────────────────────────

async function openTournamentDetail(id) {
    _showTrnDetail();
    const body = document.getElementById('tournamentDetailBody');
    body.innerHTML = '<p style="color:var(--muted);text-align:center;padding:2rem 0;">Carregando…</p>';
    try {
        const res = await fetch(`${AUTH_BASE}/tournaments/${id}`, { credentials: 'include' });
        if (!res.ok) throw new Error();
        _currentTrn = await res.json();
        _renderDetail();
    } catch { body.innerHTML = '<p style="color:var(--loss);text-align:center;padding:1.5rem 0;">Erro ao carregar torneio.</p>'; }
}

function closeTournamentDetail() { _currentTrn = null; _stopTimerDisplay(); _showTrnList(); loadTournaments(); }

function _renderDetail() {
    const t       = _currentTrn;
    const body    = document.getElementById('tournamentDetailBody');
    const stLabel = { pending: 'Pendente', in_progress: 'Em Andamento', completed: 'Concluído' };
    const stColor = { pending: 'var(--muted)', in_progress: 'var(--accent)', completed: 'var(--win)' };
    const dateStr = t.date ? new Date(t.date + 'T12:00:00').toLocaleDateString('pt-BR') : '—';
    const fmtExtra = t.format === 'swiss' ? ' · até 1 invicto'
        : t.format === 'swiss_top_cut' ? ` · Top ${t.swissTopCutSize || 8}`
        : t.format === 'top_cut' ? ` · Top ${t.topCutSize}` : '';
    const mdfmt   = (t.matchFormat || 'md3').toUpperCase();
    const phaseTag = t.phase === 'top_cut' ? ' <span style="font-size:.75rem;color:var(--gold);font-weight:700;background:rgba(201,168,76,.12);padding:.1rem .4rem;border-radius:4px;">TOP CUT</span>' : '';

    const rounds = t.rounds || [];
    const isHybrid = t.format === 'swiss_top_cut';
    const canGenerate = _trnIsAdmin && t.status !== 'completed' &&
        (!rounds.length || rounds[rounds.length - 1].complete) &&
        !(t.format === 'round_robin' && rounds.length > 0);
    const genLabel = t.format === 'round_robin' ? 'Gerar Rodadas'
        : isHybrid && t.phase === 'top_cut' ? `Gerar Top Cut R${rounds.filter(r => r.isTopCut).length + 1}`
        : `Gerar Rodada ${rounds.length + 1}`;

    let html = `
    <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:.75rem;margin-bottom:1rem;">
        <div>
            <h3 style="font-family:'Cinzel',serif;margin:0 0 .25rem;">${_tEsc(t.name)}${phaseTag}</h3>
            <span style="font-size:.82rem;color:var(--muted);">${dateStr} &nbsp;·&nbsp; ${FMT_LABEL[t.format] || t.format}${fmtExtra} &nbsp;·&nbsp; ${mdfmt}</span>
        </div>
        <div style="display:flex;gap:.45rem;align-items:center;flex-wrap:wrap;">
            <span style="color:${stColor[t.status]};font-weight:700;font-size:.85rem;">${stLabel[t.status] || t.status}</span>
            ${canGenerate ? `<button class="btn btn-primary btn-sm" onclick="generateNextRound()">${genLabel}</button>` : ''}
            ${_trnIsAdmin && t.status !== 'completed' ? `<button class="btn btn-outline btn-sm" onclick="openPlacementsModal()">&#127942; Colocações</button>` : ''}
            ${_trnIsAdmin ? `<button class="btn btn-outline btn-sm" onclick="openEditTournamentModal()">&#9998; Editar</button>` : ''}
            ${_trnIsAdmin ? `<button class="btn btn-danger btn-sm" onclick="deleteTournament()" style="background:rgba(220,53,69,.1);border-color:var(--loss);color:var(--loss);">&#128465; Excluir</button>` : ''}
            <button class="btn btn-outline btn-sm" onclick="exportTournamentPDF()" title="Imprimir">&#128438;</button>
            <button class="btn btn-outline btn-sm" onclick="exportTournamentCSV()" title="Exportar CSV">&#8675; CSV</button>
            ${_trnIsAdmin ? `<button class="btn btn-outline btn-sm" onclick="exportTournamentJSON()" title="Exportar JSON">&#8675; JSON</button>` : ''}
            ${_trnIsAdmin && rounds.length ? `<button class="btn btn-outline btn-sm" onclick="reopenLastRound()" title="Reabrir última rodada" style="color:var(--gold);">&#8635; Reabrir</button>` : ''}
            ${_trnIsAdmin ? `<button class="btn btn-outline btn-sm" onclick="openCloneTournamentModal()" title="Clonar torneio">&#128203; Clonar</button>` : ''}
        </div>
    </div>
    ${_renderTimerHtml(t)}`;

    // Placements banner if set
    if (t.placements?.length) {
        const podium = t.placements.slice().sort((a, b) => a.place - b.place).slice(0, 4);
        const plLabel = { 1: '🥇', 2: '🥈', 3: '🥉', 4: '4º' };
        html += `<div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:1rem;">` +
            podium.map(pl => {
                const p = (t.participants || []).find(x => x.id === pl.participantId);
                const img = p?.leaderId ? `<img src="${_leaderImgUrl(p.leaderId)}" style="width:24px;border-radius:3px;vertical-align:middle;margin-right:.3rem;" onerror="this.style.display='none'">` : '';
                return `<span style="background:var(--card);border:1px solid var(--border);border-radius:8px;padding:.25rem .6rem;font-size:.8rem;">
                    ${plLabel[pl.place] || pl.place + 'º'} ${img}${_tEsc(p?.name || pl.participantId)}${pl.prize ? ` <span style="color:var(--muted);font-size:.72rem;">· ${_tEsc(pl.prize)}</span>` : ''}
                </span>`;
            }).join('') + `</div>`;
    }

    if (rounds.length) {
        html += rounds.map(r => _renderRoundHtml(r, t, r.number === rounds.length)).join('');
    } else {
        html += `<p style="color:var(--muted);font-size:.85rem;margin-bottom:1.25rem;">Nenhuma rodada gerada ainda.</p>`;
    }

    // Bracket for top cut formats
    const topCutRounds = rounds.filter(r => r.isTopCut || t.format === 'top_cut');
    if (topCutRounds.length) html += _renderBracketHtml(t, topCutRounds);

    const standings = _computeStandings(t);
    if (standings.length) html += _renderStandingsHtml(standings, t);
    if (rounds.length)    html += _renderH2HHtml(t);
    if (t.participants?.some(p => p.leaderId)) html += _renderLeaderStatsHtml(t);
    html += _renderPlayersHtml(t);

    body.innerHTML = html;
    _startTimerDisplay(t);
}

// ── Timer ─────────────────────────────────────────────────────────────────────

function _renderTimerHtml(t) {
    if (!t.currentTimerStart && !_trnIsAdmin) return '';
    const isRunning = !!t.currentTimerStart;
    return `<div class="trn-timer-wrap" style="margin-bottom:.75rem;padding:.5rem .75rem;background:var(--card);border:1px solid var(--border);border-radius:8px;display:flex;align-items:center;gap:.75rem;flex-wrap:wrap;">
        <span style="font-size:.78rem;color:var(--muted);font-weight:600;">TIMER RODADA</span>
        <span class="trn-timer" id="trnTimerEl">${isRunning ? _timerStr(t.currentTimerStart) : '00:00'}</span>
        ${_trnIsAdmin ? (isRunning
            ? `<button class="btn btn-outline btn-sm" onclick="stopRoundTimer()">&#9646;&#9646; Parar</button>
               <button class="btn btn-outline btn-sm" onclick="stopRoundTimer()">&#8634; Reset</button>`
            : `<button class="btn btn-primary btn-sm" onclick="startRoundTimer()">&#9654; Iniciar Timer</button>`)
        : ''}
    </div>`;
}

function _timerStr(isoStart) {
    const elapsed = Math.floor((Date.now() - new Date(isoStart).getTime()) / 1000);
    const m = Math.floor(elapsed / 60).toString().padStart(2, '0');
    const s = (elapsed % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

function _startTimerDisplay(t) {
    _stopTimerDisplay();
    if (!t.currentTimerStart) return;
    _trnTimerInterval = setInterval(() => {
        const el = document.getElementById('trnTimerEl');
        if (!el) { _stopTimerDisplay(); return; }
        const elapsed = Math.floor((Date.now() - new Date(t.currentTimerStart).getTime()) / 1000);
        const m = Math.floor(elapsed / 60).toString().padStart(2, '0');
        const s = (elapsed % 60).toString().padStart(2, '0');
        el.textContent = `${m}:${s}`;
        el.classList.toggle('overtime', elapsed >= 50 * 60);
    }, 1000);
}

function _stopTimerDisplay() {
    if (_trnTimerInterval) { clearInterval(_trnTimerInterval); _trnTimerInterval = null; }
}

async function startRoundTimer() {
    try {
        const res = await fetch(`${AUTH_BASE}/tournaments/${_currentTrn.id}/timer`, {
            method: 'PUT', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'start' }),
        });
        if (!res.ok) { alert('Erro.'); return; }
        _currentTrn = await res.json();
        _renderDetail();
    } catch { alert('Erro de rede.'); }
}

async function stopRoundTimer() {
    try {
        const res = await fetch(`${AUTH_BASE}/tournaments/${_currentTrn.id}/timer`, {
            method: 'PUT', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'stop' }),
        });
        if (!res.ok) { alert('Erro.'); return; }
        _currentTrn = await res.json();
        _renderDetail();
    } catch { alert('Erro de rede.'); }
}

// ── Rounds HTML ───────────────────────────────────────────────────────────────

function _playerAvatarUrl(pObj) {
    if (!pObj) return null;
    // Registered player: look up profileDirectory by id (which is bandaiName)
    const dirEntry = pObj.isGuest ? null : (App.profileDirectory || {})[String(pObj.id || '').toLowerCase()];
    if (dirEntry?.avatarUrl) return dirEntry.avatarUrl;
    // Fallback: deterministic placeholder using DiceBear (pixel-art style)
    const seed = encodeURIComponent(pObj.name || pObj.id || 'player');
    return `https://api.dicebear.com/7.x/pixel-art/svg?seed=${seed}&size=40`;
}

function _playerAvatarHtml(pObj, align) {
    if (!pObj || pObj.id === 'BYE') return '';
    const url = _playerAvatarUrl(pObj);
    const flip = align === 'right' ? 'style="order:-1;"' : '';
    return `<img src="${url}" alt="" class="trn-player-avatar" ${flip} onerror="this.src='https://api.dicebear.com/7.x/pixel-art/svg?seed=fallback&size=40'">`;
}

function _pLeaderImg(id, participants) {
    if (id === 'BYE') return '';
    const p = participants?.find(x => x.id === id);
    if (!p?.leaderId) return '';
    return `<img src="${_leaderImgUrl(p.leaderId)}" alt="" style="width:28px;border-radius:3px;vertical-align:middle;margin-right:.3rem;" onerror="this.style.display='none'">`;
}

function _renderRoundHtml(round, t, isLatest) {
    const canEdit      = _trnIsAdmin && isLatest && !round.complete;
    const isTopCutRound = round.isTopCut || t.format === 'top_cut';
    const tcArr        = t.rounds.filter(r => r.isTopCut || t.format === 'top_cut');
    const roundLabel   = isTopCutRound
        ? `Top Cut R${tcArr.findIndex(r => r.number === round.number) + 1}`
        : `Rodada ${round.number}`;
    const mdfmt = t.matchFormat || 'md3';

    const pairingCards = round.pairings.map((pair, idx) => {
        const p1Name = _pName(pair.p1Id, t.participants);
        const p2Name = pair.p2Id === 'BYE' ? 'BYE' : _pName(pair.p2Id, t.participants);
        const p1obj  = (t.participants || []).find(x => x.id === pair.p1Id);
        const p2obj  = pair.p2Id !== 'BYE' ? (t.participants || []).find(x => x.id === pair.p2Id) : null;
        const isBye  = pair.p2Id === 'BYE';
        const extMin = t.timeExtensions?.[pair.id];
        const extBadge = extMin ? `<span class="time-ext-badge">+${extMin}min</span>` : '';

        const p1Img = p1obj?.leaderId
            ? `<img src="${_leaderImgUrl(p1obj.leaderId)}" class="trn-p-img" onerror="this.style.display='none'">`
            : `<span class="trn-p-img-ph"></span>`;
        const p2Img = p2obj?.leaderId
            ? `<img src="${_leaderImgUrl(p2obj.leaderId)}" class="trn-p-img" onerror="this.style.display='none'">`
            : `<span class="trn-p-img-ph"></span>`;
        const p1Avatar = _playerAvatarHtml(p1obj, 'left');
        const p2Avatar = _playerAvatarHtml(p2obj, 'right');

        /* ── Completed match ── */
        if (pair.result) {
            const wId    = pair.result.winnerId;
            const p1wins = wId === pair.p1Id;
            const p2wins = wId === pair.p2Id;
            let scoreText;
            if (isBye)             scoreText = 'W/O';
            else if (mdfmt === 'md1') scoreText = p1wins ? '1—0' : '0—1';
            else                   scoreText = `${pair.result.p1GameWins}—${pair.result.p2GameWins}`;

            return `<div class="trn-pairing trn-pairing-done">
                <div class="trn-mesa-num">Mesa ${idx + 1}</div>
                <div class="trn-match-row">
                    <div class="trn-side trn-side-left${p1wins ? ' trn-winner' : ' trn-loser'}">
                        ${p1Avatar}
                        ${p1Img}
                        <div class="trn-side-info">
                            <span class="trn-side-name">${_tEsc(p1Name)}</span>
                            ${p1wins ? `<span class="trn-win-chip">✓ vencedor</span>` : ''}
                        </div>
                    </div>
                    <div class="trn-vs-block">
                        <span class="trn-score-result">${scoreText}</span>
                        ${extBadge}
                    </div>
                    <div class="trn-side trn-side-right${p2wins ? ' trn-winner' : isBye ? '' : ' trn-loser'}">
                        ${isBye ? `<span class="trn-side-name" style="color:var(--muted);font-style:italic;">BYE</span>` : `
                        <div class="trn-side-info" style="align-items:flex-end;">
                            <span class="trn-side-name">${_tEsc(p2Name)}</span>
                            ${p2wins ? `<span class="trn-win-chip">✓ vencedor</span>` : ''}
                        </div>
                        ${p2Img}
                        ${p2Avatar}`}
                    </div>
                </div>
            </div>`;
        }

        /* ── Pending match ── */
        const extBtn = canEdit
            ? `<button class="btn btn-outline btn-sm" onclick="addTimeExtension('${_tEsc(pair.id)}')" title="Extensão de tempo" style="margin-left:auto;">⏱${extMin ? ` +${extMin}min` : ''}</button>`
            : '';
        const ctrlFooter = canEdit ? `
            <div class="trn-ctrl-footer" id="rctrl-${pair.id}">
                <button class="btn btn-outline btn-sm" onclick="selectWinner(${round.number},'${pair.id}','${_tEsc(pair.p1Id)}',this)">&#9658; ${_tEsc(p1Name)}</button>
                ${isBye ? '' : `<button class="btn btn-outline btn-sm" onclick="selectWinner(${round.number},'${pair.id}','${_tEsc(pair.p2Id)}',this)">&#9658; ${_tEsc(p2Name)}</button>`}
                ${extBtn}
            </div>` : '';

        return `<div class="trn-pairing trn-pairing-pending" id="prow-${pair.id}">
            <div class="trn-mesa-num">Mesa ${idx + 1}</div>
            <div class="trn-match-row">
                <div class="trn-side trn-side-left">
                    ${p1Avatar}
                    ${p1Img}
                    <div class="trn-side-info"><span class="trn-side-name">${_tEsc(p1Name)}</span></div>
                </div>
                <div class="trn-vs-block">
                    <span class="trn-vs-label">vs</span>
                    ${extBadge}
                </div>
                <div class="trn-side trn-side-right">
                    ${isBye ? `<span class="trn-side-name" style="color:var(--muted);font-style:italic;">BYE</span>` : `
                    <div class="trn-side-info" style="align-items:flex-end;"><span class="trn-side-name">${_tEsc(p2Name)}</span></div>
                    ${p2Img}
                    ${p2Avatar}`}
                </div>
            </div>
            ${ctrlFooter}
        </div>`;
    }).join('');

    const done    = round.pairings.filter(p => !!p.result).length;
    const pending = round.pairings.length - done;
    const statusBadge = round.complete
        ? `<span class="trn-round-badge trn-badge-done">✓ Encerrada</span>`
        : `<span class="trn-round-badge trn-badge-live">${pending} pendente${pending !== 1 ? 's' : ''}</span>`;
    const tcBadge = isTopCutRound
        ? `<span class="trn-round-badge trn-badge-tc">Top Cut</span>` : '';

    const roundKey = `${t.id}_r${round.number}`;
    const collapsed = !isLatest;
    return `<div class="trn-round${collapsed ? ' trn-round-collapsed' : ''}" id="trn-round-${roundKey}">
        <div class="trn-round-header" onclick="trnToggleRound('${roundKey}')" style="cursor:pointer;user-select:none;">
            <div style="display:flex;align-items:center;gap:.45rem;flex-wrap:wrap;">
                <span class="trn-round-chevron">${collapsed ? '▶' : '▼'}</span>
                <strong class="trn-round-title">${roundLabel}</strong>
                ${tcBadge}${statusBadge}
            </div>
            <span style="font-size:.72rem;color:var(--muted);">${done} / ${round.pairings.length} concluídas</span>
        </div>
        <div class="trn-pairings">${pairingCards}</div>
    </div>`;
}

function trnToggleRound(roundKey) {
    const el = document.getElementById(`trn-round-${roundKey}`);
    if (!el) return;
    const collapsed = el.classList.toggle('trn-round-collapsed');
    el.querySelector('.trn-round-chevron').textContent = collapsed ? '▶' : '▼';
}

// ── Bracket visualization ─────────────────────────────────────────────────────

function _renderBracketHtml(t, topCutRounds) {
    if (!topCutRounds.length) return '';

    const cols = topCutRounds.map(round => {
        const matches = round.pairings.map(pair => {
            const p1 = _pName(pair.p1Id, t.participants);
            const p2 = _pName(pair.p2Id, t.participants);
            const wId = pair.result?.winnerId;
            const p1img = _pLeaderImg(pair.p1Id, t.participants);
            const p2img = _pLeaderImg(pair.p2Id, t.participants);
            return `<div class="bracket-match">
                <div class="bracket-player${wId === pair.p1Id ? ' winner' : ''}">${p1img}${_tEsc(p1)}</div>
                <div class="bracket-player${wId === pair.p2Id ? ' winner' : ''}">${p2img}${_tEsc(p2)}</div>
            </div>`;
        }).join('');
        const tc = topCutRounds.findIndex(r => r.number === round.number);
        const colLabel = tc === topCutRounds.length - 1 ? 'Final' : tc === topCutRounds.length - 2 ? 'Semi' : `R${tc + 1}`;
        return `<div class="bracket-col">
            <div style="font-size:.72rem;text-align:center;color:var(--muted);font-weight:600;text-transform:uppercase;padding:.25rem 0;">${colLabel}</div>
            ${matches}
        </div>`;
    }).join('');

    return `<div style="margin-top:1.5rem;margin-bottom:1.25rem;">
        <strong style="font-size:.9rem;display:block;margin-bottom:.5rem;">Chave (Top Cut)</strong>
        <div class="bracket-grid">${cols}</div>
    </div>`;
}

// ── Standings HTML ────────────────────────────────────────────────────────────

function _renderStandingsHtml(standings, t) {
    const showOmw = t && (t.format === 'swiss' || t.format === 'swiss_top_cut');
    const participants = _currentTrn?.participants || [];
    const rows = standings.map((s, i) => {
        const p      = participants.find(x => x.id === s.id);
        const imgSrc = _leaderImgUrl(p?.leaderId);
        const leaderCell = imgSrc
            ? `<img src="${imgSrc}" alt="" style="width:32px;border-radius:4px;display:block;margin:0 auto;" onerror="this.style.display='none'">`
            : '<span style="color:var(--muted);font-size:.7rem;">—</span>';
        return `<tr>
            <td style="color:var(--muted);font-size:.8rem;">${i + 1}</td>
            <td><strong>${_tEsc(s.name)}</strong>${s.dropped ? ' <span style="font-size:.7rem;color:var(--loss);font-weight:600;">(dropped)</span>' : ''}</td>
            <td style="text-align:center;">${leaderCell}</td>
            <td style="color:var(--win);font-weight:600;">${s.wins}</td>
            <td style="color:var(--loss);">${s.losses}</td>
            <td style="font-size:.82rem;color:var(--muted);">${s.gw}-${s.gl}</td>
            ${showOmw ? `<td style="font-size:.78rem;color:var(--muted);">${s.omwPct !== undefined ? (s.omwPct * 100).toFixed(1) + '%' : '—'}</td>` : ''}
        </tr>`;
    }).join('');
    return `<div style="margin-top:1.5rem;">
        <strong style="font-size:.9rem;display:block;margin-bottom:.5rem;">Classificação</strong>
        <div class="table-wrap"><table>
            <thead><tr><th>#</th><th>Player</th><th>Líder</th><th>V</th><th>D</th><th>Jogos</th>${showOmw ? '<th>OMW%</th>' : ''}</tr></thead>
            <tbody>${rows}</tbody>
        </table></div>
    </div>`;
}

// ── H2H Matrix ────────────────────────────────────────────────────────────────

function _renderH2HHtml(t) {
    const players = (t.participants || []).filter(p => !p.dropped && !p.isGuest !== false);
    if (players.length < 2) return '';

    // Build result lookup: { 'p1|p2': 'W' or 'L' from p1 perspective }
    const results = {};
    for (const round of (t.rounds || [])) {
        for (const pair of round.pairings) {
            if (!pair.result || pair.p2Id === 'BYE') continue;
            const { winnerId } = pair.result;
            const key1 = `${pair.p1Id}|${pair.p2Id}`;
            const key2 = `${pair.p2Id}|${pair.p1Id}`;
            results[key1] = winnerId === pair.p1Id ? 'W' : 'L';
            results[key2] = winnerId === pair.p2Id ? 'W' : 'L';
        }
    }

    const headerCells = players.map(p => `<th style="font-size:.72rem;writing-mode:vertical-rl;transform:rotate(180deg);max-width:24px;padding:.2rem .1rem;" title="${_tEsc(p.name)}">${_tEsc(p.name.slice(0, 8))}</th>`).join('');
    const rows = players.map(p => {
        const cells = players.map(op => {
            if (op.id === p.id) return `<td style="background:var(--border);"></td>`;
            const r = results[`${p.id}|${op.id}`];
            if (!r) return `<td style="text-align:center;font-size:.75rem;color:var(--muted);">—</td>`;
            const col = r === 'W' ? 'var(--win)' : 'var(--loss)';
            return `<td style="text-align:center;font-size:.75rem;font-weight:700;color:${col};">${r}</td>`;
        }).join('');
        return `<tr><td style="font-size:.8rem;font-weight:600;white-space:nowrap;">${_tEsc(p.name)}</td>${cells}</tr>`;
    }).join('');

    return `<div style="margin-top:1.5rem;overflow-x:auto;">
        <strong style="font-size:.9rem;display:block;margin-bottom:.5rem;">Head-to-Head</strong>
        <table style="border-collapse:collapse;font-size:.8rem;">
            <thead><tr><th></th>${headerCells}</tr></thead>
            <tbody>${rows}</tbody>
        </table>
    </div>`;
}

// ── Leader Meta Stats ─────────────────────────────────────────────────────────

function _renderLeaderStatsHtml(t) {
    const leaderMap = {};
    for (const p of (t.participants || [])) {
        if (!p.leaderId) continue;
        if (!leaderMap[p.leaderId]) leaderMap[p.leaderId] = { id: p.leaderId, players: [], wins: 0, losses: 0 };
        leaderMap[p.leaderId].players.push(p.id);
    }
    for (const round of (t.rounds || [])) {
        for (const pair of round.pairings) {
            if (!pair.result || pair.p2Id === 'BYE') continue;
            const { winnerId } = pair.result;
            const loserId = winnerId === pair.p1Id ? pair.p2Id : pair.p1Id;
            const getLeader = id => (t.participants || []).find(p => p.id === id)?.leaderId;
            const wLeader = getLeader(winnerId), lLeader = getLeader(loserId);
            if (wLeader && leaderMap[wLeader]) leaderMap[wLeader].wins++;
            if (lLeader && leaderMap[lLeader]) leaderMap[lLeader].losses++;
        }
    }

    const sorted = Object.values(leaderMap).sort((a, b) => b.players.length - a.players.length);
    if (!sorted.length) return '';

    const cards = sorted.map(l => {
        const total  = l.wins + l.losses;
        const wr     = total ? Math.round(l.wins / total * 100) : 0;
        const lname  = _leaderName(l.id);
        return `<div style="display:flex;align-items:center;gap:.5rem;background:var(--card);border:1px solid var(--border);border-radius:8px;padding:.4rem .6rem;min-width:140px;">
            <img src="${_leaderImgUrl(l.id)}" alt="" style="width:36px;border-radius:4px;" onerror="this.style.display='none'">
            <div>
                <div style="font-size:.75rem;font-weight:600;max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${_tEsc(lname)}">${_tEsc(lname)}</div>
                <div style="font-size:.7rem;color:var(--muted);">${l.players.length} player${l.players.length !== 1 ? 's' : ''} · ${wr}% WR</div>
                <div style="font-size:.68rem;color:var(--muted);">${l.wins}W ${l.losses}L</div>
            </div>
        </div>`;
    }).join('');

    return `<div style="margin-top:1.5rem;">
        <strong style="font-size:.9rem;display:block;margin-bottom:.5rem;">Meta do Torneio</strong>
        <div style="display:flex;flex-wrap:wrap;gap:.4rem;">${cards}</div>
    </div>`;
}

// ── Players / Check-in / Drop ─────────────────────────────────────────────────

function _renderPlayersHtml(t) {
    if (!_trnIsAdmin) return '';
    const active  = (t.participants || []).filter(p => !p.dropped);
    const dropped = (t.participants || []).filter(p => p.dropped);
    if (!active.length && !dropped.length) return '';

    const checkedIn = active.filter(p => p.checkedIn).length;

    const rows = active.map(p => {
        const imgSrc = _leaderImgUrl(p.leaderId);
        return `<tr>
            <td style="width:42px;">${imgSrc ? `<img src="${imgSrc}" alt="" style="width:36px;border-radius:4px;display:block;" onerror="this.style.display='none'">` : '<span style="display:inline-block;width:36px;height:50px;background:var(--border);border-radius:4px;"></span>'}</td>
            <td style="font-weight:600;font-size:.85rem;">${_tEsc(p.name)}</td>
            <td>${_leaderSelectHtml(p.id, p.leaderId || '')}</td>
            <td style="text-align:center;"><label style="cursor:pointer;" title="${p.checkedIn ? 'Presente' : 'Ausente'}">
                <input type="checkbox" ${p.checkedIn ? 'checked' : ''} onchange="setParticipantCheckedIn('${_tEsc(p.id)}', this.checked)" style="cursor:pointer;">
            </label></td>
            ${t.status !== 'completed' ? `<td><button onclick="dropPlayer('${_tEsc(p.id)}')" style="background:none;border:none;cursor:pointer;color:var(--loss);font-size:.75rem;padding:0;" title="Drop">drop</button></td>` : '<td></td>'}
        </tr>`;
    }).join('');

    const droppedRows = dropped.map(p => {
        const imgSrc = _leaderImgUrl(p.leaderId);
        return `<tr style="opacity:.5;">
            <td>${imgSrc ? `<img src="${imgSrc}" alt="" style="width:36px;border-radius:4px;display:block;" onerror="this.style.display='none'">` : ''}</td>
            <td style="text-decoration:line-through;font-size:.85rem;">${_tEsc(p.name)}</td>
            <td style="font-size:.75rem;color:var(--muted);">${p.leaderId ? _tEsc(p.leaderId) : '—'}</td>
            <td></td><td><span style="font-size:.72rem;color:var(--loss);font-weight:600;">dropped</span></td>
        </tr>`;
    }).join('');

    return `<div style="margin-top:1.5rem;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.5rem;">
            <strong style="font-size:.9rem;">Players</strong>
            <span style="font-size:.78rem;color:var(--muted);">${checkedIn}/${active.length} presentes</span>
        </div>
        <div class="table-wrap"><table>
            <thead><tr><th></th><th>Nome</th><th>Líder</th><th style="text-align:center;width:40px;">✓</th><th></th></tr></thead>
            <tbody>${rows}${droppedRows}</tbody>
        </table></div>
    </div>`;
}

async function setParticipantCheckedIn(participantId, checkedIn) {
    try {
        const res = await fetch(`${AUTH_BASE}/tournaments/${_currentTrn.id}/participant/${encodeURIComponent(participantId)}`, {
            method: 'PUT', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ checkedIn }),
        });
        if (!res.ok) return;
        _currentTrn = await res.json();
        // Update counter without full re-render
        const active = (_currentTrn.participants || []).filter(p => !p.dropped);
        const ci = active.filter(p => p.checkedIn).length;
        const counterEl = document.querySelector('#tournamentDetailBody .trn-checkin-counter');
        if (counterEl) counterEl.textContent = `${ci}/${active.length} presentes`;
    } catch {}
}

// ── Result selection ──────────────────────────────────────────────────────────

let _pendingResult = {};

function selectWinner(roundNumber, pairingId, winnerId, btn) {
    _pendingResult = { roundNumber, pairingId, winnerId };
    const ctrl  = document.getElementById('rctrl-' + pairingId);
    if (!ctrl) return;
    const wName = _pName(winnerId, _currentTrn?.participants);
    const mdfmt = _currentTrn?.matchFormat || 'md3';

    if (mdfmt === 'md1') {
        ctrl.innerHTML = '<span style="color:var(--muted);font-size:.8rem;padding:.2rem 0;">Salvando…</span>';
        submitResult(pairingId, 1, 0);
        return;
    }

    ctrl.innerHTML = `
        <span style="font-size:.82rem;font-weight:700;color:var(--accent);">&#9658; ${_tEsc(wName)}</span>
        <span style="font-size:.75rem;color:var(--muted);">placar:</span>
        ${_scoreButtons(pairingId, mdfmt)}
        <button class="btn btn-outline btn-sm" onclick="_renderDetail()" title="Cancelar" style="margin-left:auto;">&#10005;</button>`;
}

function _scoreButtons(pairingId, mdfmt) {
    const pid = _tEsc(pairingId);
    if (mdfmt === 'md5') {
        return [[3,0],[3,1],[3,2],[2,3],[1,3],[0,3]].map(([w,l]) =>
            `<button class="btn ${w>l?'btn-primary':'btn-outline'} btn-sm" onclick="submitResult('${pid}',${w},${l})">${w}-${l}</button>`
        ).join('');
    }
    return [[2,0],[2,1],[1,2],[0,2]].map(([w,l]) =>
        `<button class="btn ${w>l?'btn-primary':'btn-outline'} btn-sm" onclick="submitResult('${pid}',${w},${l})">${w}-${l}</button>`
    ).join('');
}

async function submitResult(pairingId, wGames, lGames, timeExtension) {
    if (!_pendingResult.pairingId) return;
    const { roundNumber, winnerId } = _pendingResult;
    const round = _currentTrn.rounds.find(r => r.number === roundNumber);
    const pair  = round?.pairings.find(p => p.id === pairingId);
    if (!pair) return;
    const p1GameWins = winnerId === pair.p1Id ? wGames : lGames;
    const p2GameWins = winnerId === pair.p2Id ? wGames : lGames;
    const ctrl = document.getElementById('rctrl-' + pairingId);
    if (ctrl) ctrl.innerHTML = '<span style="color:var(--muted);font-size:.8rem;">Salvando…</span>';
    const bodyObj = { roundNumber, pairingId, winnerId, p1GameWins, p2GameWins };
    if (timeExtension) bodyObj.timeExtension = timeExtension;
    try {
        const res = await fetch(`${AUTH_BASE}/tournaments/${_currentTrn.id}/result`, {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bodyObj),
        });
        if (!res.ok) { alert('Erro ao salvar resultado.'); _renderDetail(); return; }
        _currentTrn = await res.json();
        _pendingResult = {};
        _renderDetail();
    } catch { alert('Erro de rede.'); _renderDetail(); }
}

function addTimeExtension(pairingId) {
    const min = prompt('Minutos de extensão para esta mesa:', '5');
    if (!min || isNaN(parseInt(min, 10))) return;
    // Store locally and show badge (no separate API call — will be sent with result)
    _currentTrn.timeExtensions = _currentTrn.timeExtensions || {};
    _currentTrn.timeExtensions[pairingId] = parseInt(min, 10);
    _renderDetail();
}

// ── Generate round ────────────────────────────────────────────────────────────

async function generateNextRound() {
    const btn = document.querySelector('#tournamentDetailBody .btn-primary');
    if (btn) { btn.disabled = true; btn.textContent = 'Gerando…'; }
    try {
        const res = await fetch(`${AUTH_BASE}/tournaments/${_currentTrn.id}/generate-round`, { method: 'POST', credentials: 'include' });
        if (!res.ok) { const err = await res.json().catch(()=>({})); alert(err.error || 'Erro.'); _renderDetail(); return; }
        _currentTrn = await res.json();
        _renderDetail();
    } catch { alert('Erro de rede.'); _renderDetail(); }
}

// ── Placements modal ──────────────────────────────────────────────────────────

function openPlacementsModal() {
    const t = _currentTrn;
    if (!t) return;
    const standings = _computeStandings(t);
    const top = standings.slice(0, Math.min(8, standings.length));
    const rows = top.map((s, i) => {
        const p    = (t.participants || []).find(x => x.id === s.id);
        const img  = p?.leaderId ? `<img src="${_leaderImgUrl(p.leaderId)}" style="width:28px;border-radius:3px;vertical-align:middle;margin-right:.3rem;" onerror="this.style.display='none'">` : '';
        const existingPl = (t.placements || []).find(pl => pl.participantId === s.id);
        return `<tr>
            <td style="font-size:.85rem;">${img}${_tEsc(s.name)}</td>
            <td><input type="number" min="1" max="${standings.length}" value="${existingPl?.place || i + 1}" id="pl_place_${_tEsc(s.id)}" style="width:60px;padding:.2rem .35rem;border:1px solid var(--border);border-radius:4px;background:var(--card);color:var(--text);font-size:.82rem;"></td>
            <td><input type="text" value="${existingPl?.prize || ''}" id="pl_prize_${_tEsc(s.id)}" placeholder="prêmio (opcional)" style="width:130px;padding:.2rem .35rem;border:1px solid var(--border);border-radius:4px;background:var(--card);color:var(--text);font-size:.82rem;"></td>
        </tr>`;
    }).join('');

    const modal = document.getElementById('placementsModal');
    document.getElementById('placementsBody').innerHTML = `<table style="width:100%;border-collapse:collapse;">
        <thead><tr><th style="text-align:left;font-size:.78rem;padding:.3rem .2rem;">Player</th><th style="font-size:.78rem;padding:.3rem .2rem;">Pos.</th><th style="font-size:.78rem;padding:.3rem .2rem;">Prêmio</th></tr></thead>
        <tbody>${rows}</tbody>
    </table>
    <p style="font-size:.75rem;color:var(--muted);margin-top:.75rem;">Badges serão atribuídos automaticamente para players registrados (top 4).</p>`;
    modal.style.display = 'flex';
}

function closePlacementsModal(e, force = false) {
    if (!force && e && !e.target.classList.contains('modal-overlay')) return;
    document.getElementById('placementsModal').style.display = 'none';
}

async function submitPlacements() {
    const t = _currentTrn;
    const standings = _computeStandings(t);
    const top = standings.slice(0, Math.min(8, standings.length));
    const placements = top.map(s => ({
        participantId: s.id,
        place: parseInt(document.getElementById('pl_place_' + s.id.replace(/[^a-zA-Z0-9_-]/g, '_'))?.value || '0', 10) || 0,
        prize: document.getElementById('pl_prize_' + s.id.replace(/[^a-zA-Z0-9_-]/g, '_'))?.value?.trim() || '',
    })).filter(pl => pl.place > 0);

    const btn = document.querySelector('#placementsModal .btn-primary');
    const orig = btn.innerHTML; btn.disabled = true; btn.innerHTML = 'Salvando…';
    try {
        const res = await fetch(`${AUTH_BASE}/tournaments/${t.id}/placements`, {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ placements }),
        });
        if (!res.ok) { const err = await res.json().catch(()=>({})); alert(err.error || 'Erro.'); return; }
        _currentTrn = await res.json();
        closePlacementsModal(null, true);
        _renderDetail();
    } catch { alert('Erro de rede.');
    } finally { btn.disabled = false; btn.innerHTML = orig; }
}

// ── Export ────────────────────────────────────────────────────────────────────

function exportTournamentPDF() {
    const prevTitle = document.title;
    document.title = _currentTrn?.name || 'Torneio';
    document.body.classList.add('print-tournament');
    window.print();
    document.addEventListener('afterprint', () => {
        document.body.classList.remove('print-tournament');
        document.title = prevTitle;
    }, { once: true });
}

function exportTournamentCSV() {
    const t = _currentTrn;
    if (!t) return;
    const standings = _computeStandings(t);
    const lines = ['Pos,Player,Líder,V,D,GW,GL,OMW%'];
    standings.forEach((s, i) => {
        const p = (t.participants || []).find(x => x.id === s.id);
        lines.push([
            i + 1, `"${s.name}"`, p?.leaderId || '',
            s.wins, s.losses, s.gw, s.gl,
            s.omwPct !== undefined ? (s.omwPct * 100).toFixed(1) + '%' : '',
        ].join(','));
    });
    lines.push('');
    lines.push('Rodada,Mesa,Player1,Player2,Vencedor,Placar');
    for (const round of (t.rounds || [])) {
        for (const pair of round.pairings) {
            if (!pair.result) continue;
            const p1 = _pName(pair.p1Id, t.participants);
            const p2 = pair.p2Id === 'BYE' ? 'BYE' : _pName(pair.p2Id, t.participants);
            const winner = _pName(pair.result.winnerId, t.participants);
            const score  = `${pair.result.p1GameWins}-${pair.result.p2GameWins}`;
            lines.push([round.number, pair.id, `"${p1}"`, `"${p2}"`, `"${winner}"`, score].join(','));
        }
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `${t.name.replace(/[^a-z0-9]/gi, '_')}_resultados.csv`;
    a.click(); URL.revokeObjectURL(url);
}

async function exportTournamentJSON() {
    const t = _currentTrn;
    if (!t) return;
    try {
        const res = await fetch(`${AUTH_BASE}/tournaments/${t.id}/export`, { credentials: 'include' });
        if (!res.ok) { alert('Erro ao exportar.'); return; }
        const data = await res.json();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url; a.download = `${t.name.replace(/[^a-z0-9]/gi, '_')}.json`;
        a.click(); URL.revokeObjectURL(url);
    } catch { alert('Erro de rede.'); }
}

async function reopenLastRound() {
    const t = _currentTrn;
    if (!t || !t.rounds?.length) return;
    const lastRound = t.rounds[t.rounds.length - 1];
    if (!confirm(`Reabrir Rodada ${lastRound.number}? Isso permitirá corrigir resultados.`)) return;
    try {
        const res = await fetch(`${AUTH_BASE}/tournaments/${t.id}/reopen-round`, { method: 'POST', credentials: 'include' });
        if (!res.ok) { alert('Erro ao reabrir rodada.'); return; }
        const detail = await fetch(`${AUTH_BASE}/tournaments/${t.id}`, { credentials: 'include' });
        if (detail.ok) { _currentTrn = await detail.json(); _renderDetail(); }
    } catch { alert('Erro de rede.'); }
}

let _cloneSourceId = null;

function openCloneTournamentModal() {
    if (!_currentTrn) return;
    _cloneSourceId = _currentTrn.id;
    document.getElementById('cloneTrnName').value = `${_currentTrn.name} (cópia)`;
    document.getElementById('cloneTrnDate').value = new Date().toISOString().slice(0, 10);
    document.getElementById('cloneTournamentModal').style.display = 'flex';
}
function closeCloneTournamentModal(e, force = false) {
    if (!force && e && !e.target.classList.contains('modal-overlay')) return;
    document.getElementById('cloneTournamentModal').style.display = 'none';
}
async function submitCloneTournament() {
    const name = document.getElementById('cloneTrnName').value.trim();
    const date = document.getElementById('cloneTrnDate').value;
    if (!name || !date) { alert('Nome e data são obrigatórios.'); return; }
    const btn = document.querySelector('#cloneTournamentModal .btn-primary');
    const orig = btn.innerHTML; btn.disabled = true; btn.innerHTML = 'Clonando…';
    try {
        const res = await fetch(`${AUTH_BASE}/tournaments/${_cloneSourceId}/clone`, {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, date }),
        });
        if (!res.ok) { const err = await res.json().catch(()=>({})); alert(err.error || 'Erro.'); return; }
        closeCloneTournamentModal(null, true);
        loadTournaments();
    } catch { alert('Erro de rede.');
    } finally { btn.disabled = false; btn.innerHTML = orig; }
}

// ── Circuit tab ───────────────────────────────────────────────────────────────

async function loadCircuitStandings() {
    const panel = document.getElementById('circuitoPanelContent');
    if (!panel) return;
    panel.innerHTML = '<p style="color:var(--muted);text-align:center;padding:2rem 0;">Carregando…</p>';
    try {
        const [cRes, tRes] = await Promise.all([
            fetch(`${AUTH_BASE}/circuits`,    { credentials: 'include' }),
            fetch(`${AUTH_BASE}/tournaments`, { credentials: 'include' }),
        ]);
        _circuits         = cRes.ok ? await cRes.json() : [];
        _cachedTournaments = tRes.ok ? await tRes.json() : [];
        if (!_selectedCircuitId && _circuits.length) _selectedCircuitId = _circuits[0].id;
        panel.innerHTML = _renderCircuitPanelHtml(_circuits, _cachedTournaments);
    } catch {
        panel.innerHTML = '<p style="color:var(--loss);text-align:center;padding:1.5rem 0;">Erro ao carregar circuito.</p>';
    }
}

function _renderCircuitPanelHtml(circuits, allTournaments) {
    const newBtn = _trnIsAdmin
        ? `<button class="btn btn-primary btn-sm" onclick="openCreateCircuitModal()">+ Novo Circuito</button>` : '';

    if (!circuits.length) {
        return `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;flex-wrap:wrap;gap:.5rem;">
            <span style="color:var(--muted);font-size:.9rem;">Nenhum circuito cadastrado</span>
            ${newBtn}
        </div>`;
    }

    const options = circuits.map(c =>
        `<option value="${_tEsc(c.id)}" ${c.id === _selectedCircuitId ? 'selected' : ''}>${_tEsc(c.name)}${c.season ? ` — ${_tEsc(c.season)}` : ''}</option>`
    ).join('');

    const selected = circuits.find(c => c.id === _selectedCircuitId) || circuits[0];
    const editBtns = _trnIsAdmin ? `
        <button class="btn btn-outline btn-sm" onclick="openEditCircuitModal('${_tEsc(selected.id)}')">&#9998; Editar</button>` : '';

    const header = `<div style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;margin-bottom:1rem;">
        <select onchange="onCircuitSelect(this.value)" style="flex:1;min-width:180px;max-width:320px;">${options}</select>
        ${editBtns}
        ${newBtn}
    </div>`;

    const infoPanel = _renderCircuitInfoPanel(selected);

    return header + infoPanel + _renderCircuitStandingsHtml(selected, allTournaments);
}

function _renderCircuitInfoPanel(circuit) {
    if (!circuit) return '';
    const period = (circuit.startDate || circuit.endDate)
        ? `<div style="display:flex;align-items:center;gap:.35rem;font-size:.82rem;color:var(--muted);">
            <span>&#128197;</span>
            <span>${circuit.startDate || '?'} → ${circuit.endDate || '?'}</span>
           </div>` : '';

    const parts = circuit.participants || [];
    const chips = parts.length
        ? `<div style="display:flex;flex-wrap:wrap;gap:.3rem;margin-top:.4rem;">${
            parts.map(p => `<span style="display:inline-block;background:var(--bg);border:1px solid var(--border);border-radius:20px;padding:.15rem .55rem;font-size:.75rem;">&#127918; ${_tEsc(p.name)}</span>`).join('')
          }</div>`
        : '';

    if (!period && !chips) return '';

    return `<div style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:.85rem 1rem;margin-bottom:1rem;">
        ${period}
        ${parts.length ? `<div style="font-size:.75rem;color:var(--muted);margin-top:.5rem;font-weight:600;">${parts.length} participante${parts.length !== 1 ? 's' : ''}</div>${chips}` : ''}
    </div>`;
}

function _renderCircuitStandingsHtml(circuit, allTournaments) {
    if (!circuit) return '';
    const tournaments = allTournaments.filter(t => t.circuitId === circuit.id && t.status === 'completed');
    const cfg = circuit;

    if (!tournaments.length) {
        return `<div style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:1.25rem;">
            <p style="color:var(--muted);font-size:.85rem;">Nenhum torneio concluído associado a este circuito.</p>
        </div>`;
    }

    // Accumulate points per player
    const playerMap = {};
    for (const t of tournaments) {
        const standings = _computeStandings(t);
        standings.forEach((s, idx) => {
            if (!playerMap[s.name]) playerMap[s.name] = { name: s.name, tournaments: 0, wins: 0, plPts: 0, winPts: 0 };
            const pm = playerMap[s.name];
            pm.tournaments++;
            pm.wins += s.wins;
            const pl = (t.placements || []).find(p => p.participantId === s.id);
            const place = pl?.place || idx + 1;
            const pt = cfg.pointTable || { 1: 10, 2: 7, 3: 5, 4: 5, 'default': 1 };
            const plPts = pt[place] ?? pt[String(place)] ?? (pt['default'] ?? 1);
            pm.plPts  += plPts;
            pm.winPts += s.wins * (cfg.winBonus || 0);
        });
    }

    // Add manual points
    for (const mp of (circuit.manualPoints || [])) {
        const key = mp.participantName || mp.participantId;
        if (!playerMap[key]) playerMap[key] = { name: key, tournaments: 0, wins: 0, plPts: 0, winPts: 0, manualPts: 0 };
        playerMap[key].manualPts = (playerMap[key].manualPts || 0) + (mp.points || 0);
    }

    const sorted = Object.values(playerMap)
        .map(p => ({ ...p, total: p.plPts + p.winPts + (p.manualPts || 0) }))
        .sort((a, b) => b.total - a.total || b.wins - a.wins);

    const hasManual = (circuit.manualPoints || []).length > 0;
    const rows = sorted.map((p, i) => `<tr>
        <td style="color:var(--muted);font-size:.8rem;">${i + 1}</td>
        <td style="font-weight:600;font-size:.85rem;">${_tEsc(p.name)}</td>
        <td style="font-size:.82rem;color:var(--muted);">${p.tournaments}</td>
        <td style="font-size:.82rem;">${p.wins}</td>
        <td style="font-size:.82rem;">${p.plPts.toFixed(1)}</td>
        <td style="font-size:.82rem;">${p.winPts.toFixed(1)}</td>
        ${hasManual ? `<td style="font-size:.82rem;color:var(--accent);">${(p.manualPts||0).toFixed(1)}</td>` : ''}
        <td style="font-weight:700;color:var(--gold);">${p.total.toFixed(1)}</td>
    </tr>`).join('');

    const closedBadge = circuit.status === 'closed'
        ? `<span style="font-size:.72rem;font-weight:700;color:var(--muted);background:var(--border);border-radius:20px;padding:.1rem .45rem;margin-left:.5rem;">Encerrado</span>` : '';

    return `<div style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:1.25rem;">
        <div style="margin-bottom:.75rem;font-size:.75rem;color:var(--muted);display:flex;align-items:center;gap:.5rem;">
            Bônus V: ${cfg.winBonus || 0} pt &nbsp;·&nbsp; ${tournaments.length} torneio${tournaments.length !== 1 ? 's' : ''}${closedBadge}
        </div>
        <div class="table-wrap"><table>
            <thead><tr><th>#</th><th>Player</th><th>Torneios</th><th>V</th><th>Pts (Col.)</th><th>Pts (V)</th>${hasManual ? '<th>Pts (M)</th>' : ''}<th>Total</th></tr></thead>
            <tbody>${rows}</tbody>
        </table></div>
    </div>`;
}

function onCircuitSelect(id) {
    _selectedCircuitId = id;
    const panel = document.getElementById('circuitoPanelContent');
    if (!panel) return;
    panel.innerHTML = _renderCircuitPanelHtml(_circuits, _cachedTournaments);
}

// ── Circuit CRUD ──────────────────────────────────────────────────────────────

function openCreateCircuitModal() {
    document.getElementById('crcName').value      = '';
    document.getElementById('crcSeason').value    = '';
    document.getElementById('crcStartDate').value = '';
    document.getElementById('crcEndDate').value   = '';
    document.getElementById('crcWinBonus').value  = '0';
    document.getElementById('crcPt1').value       = '10';
    document.getElementById('crcPt2').value       = '7';
    document.getElementById('crcPt34').value      = '5';
    document.getElementById('crcPt58').value      = '3';
    document.getElementById('crcPtDef').value     = '1';
    document.getElementById('crcParticipantSearch').value = '';
    _crcParticipants = [];
    _buildCrcParticipantPicker('crcParticipantsList', 'crcParticipantSearch', _crcParticipants, 'crc');
    _renderCrcSelectedChips('crcSelectedChips', _crcParticipants, 'crc');
    document.getElementById('createCircuitModal').style.display = 'flex';
}
function closeCreateCircuitModal(e, force = false) {
    if (!force && e && !e.target.classList.contains('modal-overlay')) return;
    document.getElementById('createCircuitModal').style.display = 'none';
}
async function submitCreateCircuit() {
    const name      = document.getElementById('crcName').value.trim();
    if (!name) { alert('Nome obrigatório.'); return; }
    const body = {
        name,
        season:    document.getElementById('crcSeason').value.trim() || null,
        startDate: document.getElementById('crcStartDate').value || null,
        endDate:   document.getElementById('crcEndDate').value   || null,
        winBonus:  parseFloat(document.getElementById('crcWinBonus').value) || 0,
        pointTable: {
            1: parseFloat(document.getElementById('crcPt1').value)   || 10,
            2: parseFloat(document.getElementById('crcPt2').value)   || 7,
            3: parseFloat(document.getElementById('crcPt34').value)  || 5,
            4: parseFloat(document.getElementById('crcPt34').value)  || 5,
            'default': parseFloat(document.getElementById('crcPtDef').value) || 1,
        },
        participants: _crcParticipants.map(p => ({ id: p.id, name: p.name })),
    };
    body.pointTable['5-8'] = parseFloat(document.getElementById('crcPt58').value) || 3;

    const btn = document.querySelector('#createCircuitModal .btn-primary');
    const orig = btn.innerHTML; btn.disabled = true; btn.innerHTML = 'Criando…';
    try {
        const res = await fetch(`${AUTH_BASE}/circuits`, {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!res.ok) { const err = await res.json().catch(()=>({})); alert(err.error || 'Erro.'); return; }
        const created = await res.json();
        _selectedCircuitId = created.id;
        closeCreateCircuitModal(null, true);
        loadCircuitStandings();
    } catch { alert('Erro de rede.');
    } finally { btn.disabled = false; btn.innerHTML = orig; }
}

function openEditCircuitModal(id) {
    const c = _circuits.find(x => x.id === id);
    if (!c) return;
    const pt = c.pointTable || {};
    document.getElementById('editCircuitId').value    = c.id;
    document.getElementById('ecrcName').value         = c.name || '';
    document.getElementById('ecrcSeason').value       = c.season || '';
    document.getElementById('ecrcStartDate').value    = c.startDate || '';
    document.getElementById('ecrcEndDate').value      = c.endDate || '';
    document.getElementById('ecrcWinBonus').value     = c.winBonus ?? 0;
    document.getElementById('ecrcPt1').value          = pt[1]   ?? pt['1']   ?? 10;
    document.getElementById('ecrcPt2').value          = pt[2]   ?? pt['2']   ?? 7;
    document.getElementById('ecrcPt34').value         = pt[3]   ?? pt['3']   ?? 5;
    document.getElementById('ecrcPt58').value         = pt['5-8'] ?? 3;
    document.getElementById('ecrcPtDef').value        = pt['default'] ?? 1;
    document.getElementById('ecrcParticipantSearch').value = '';
    _ecrcParticipants = [...(c.participants || [])];
    _buildCrcParticipantPicker('ecrcParticipantsList', 'ecrcParticipantSearch', _ecrcParticipants, 'ecrc');
    _renderCrcSelectedChips('ecrcSelectedChips', _ecrcParticipants, 'ecrc');
    document.getElementById('editCircuitModal').style.display = 'flex';
}
function closeEditCircuitModal(e, force = false) {
    if (!force && e && !e.target.classList.contains('modal-overlay')) return;
    document.getElementById('editCircuitModal').style.display = 'none';
}
async function submitEditCircuit() {
    const id = document.getElementById('editCircuitId').value;
    const body = {
        name:      document.getElementById('ecrcName').value.trim(),
        season:    document.getElementById('ecrcSeason').value.trim() || null,
        startDate: document.getElementById('ecrcStartDate').value || null,
        endDate:   document.getElementById('ecrcEndDate').value   || null,
        winBonus:  parseFloat(document.getElementById('ecrcWinBonus').value) || 0,
        pointTable: {
            1: parseFloat(document.getElementById('ecrcPt1').value)   || 10,
            2: parseFloat(document.getElementById('ecrcPt2').value)   || 7,
            3: parseFloat(document.getElementById('ecrcPt34').value)  || 5,
            4: parseFloat(document.getElementById('ecrcPt34').value)  || 5,
            'default': parseFloat(document.getElementById('ecrcPtDef').value) || 1,
        },
        participants: _ecrcParticipants.map(p => ({ id: p.id, name: p.name })),
    };
    body.pointTable['5-8'] = parseFloat(document.getElementById('ecrcPt58').value) || 3;
    if (!body.name) { alert('Nome obrigatório.'); return; }

    const btn = document.querySelector('#editCircuitModal .btn-primary');
    const orig = btn.innerHTML; btn.disabled = true; btn.innerHTML = 'Salvando…';
    try {
        const res = await fetch(`${AUTH_BASE}/circuits/${encodeURIComponent(id)}`, {
            method: 'PUT', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!res.ok) { const err = await res.json().catch(()=>({})); alert(err.error || 'Erro.'); return; }
        closeEditCircuitModal(null, true);
        loadCircuitStandings();
    } catch { alert('Erro de rede.');
    } finally { btn.disabled = false; btn.innerHTML = orig; }
}
async function deleteCircuit(id) {
    const c = _circuits.find(x => x.id === id);
    if (!confirm(`Excluir o circuito "${c?.name}"? Esta ação não pode ser desfeita.`)) return;
    try {
        const res = await fetch(`${AUTH_BASE}/circuits/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'include' });
        if (!res.ok) { alert('Erro ao excluir.'); return; }
        _selectedCircuitId = null;
        closeEditCircuitModal(null, true);
        loadCircuitStandings();
    } catch { alert('Erro de rede.'); }
}

function _buildCrcParticipantPicker(listElId, searchElId, selectedArr, prefix) {
    const listEl   = document.getElementById(listElId);
    const searchEl = document.getElementById(searchElId);
    if (!listEl) return;
    const query = searchEl ? searchEl.value.trim().toLowerCase() : '';
    const all   = Object.values(App.profileDirectory || {})
        .map(p => ({ id: p.bandaiName, name: p.displayName || p.bandaiName }))
        .filter(u => !query || u.name.toLowerCase().includes(query) || u.id.toLowerCase().includes(query))
        .sort((a, b) => a.name.localeCompare(b.name));
    listEl.innerHTML = all.length === 0
        ? '<div style="padding:.5rem .75rem;font-size:.8rem;color:var(--muted);">Nenhum jogador encontrado.</div>'
        : all.map(u => {
            const checked = selectedArr.some(s => s.id === u.id);
            return `<label style="display:flex;align-items:center;gap:.5rem;padding:.3rem .75rem;cursor:pointer;font-size:.82rem;border-radius:5px;" onmouseover="this.style.background='var(--bg)'" onmouseout="this.style.background=''">`
                + `<input type="checkbox" ${checked ? 'checked' : ''} onchange="toggle${prefix==='crc'?'Crc':'Ecrc'}Participant('${_tEsc(u.id)}','${_tEsc(u.name)}',this.checked)" style="accent-color:var(--accent);">`
                + `<span>${_tEsc(u.name)}</span></label>`;
        }).join('');
}

function _renderCrcSelectedChips(chipsElId, selectedArr, prefix) {
    const el = document.getElementById(chipsElId);
    if (!el) return;
    if (!selectedArr.length) { el.innerHTML = ''; return; }
    el.innerHTML = selectedArr.map(p =>
        `<span style="display:inline-flex;align-items:center;gap:.25rem;background:rgba(4,138,129,.12);border:1px solid rgba(4,138,129,.3);border-radius:20px;padding:.15rem .55rem;font-size:.75rem;">`
        + `${_tEsc(p.name)}`
        + `<button onclick="toggle${prefix==='crc'?'Crc':'Ecrc'}Participant('${_tEsc(p.id)}','${_tEsc(p.name)}',false)" style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:.85rem;line-height:1;padding:0 0 0 .1rem;">&times;</button>`
        + `</span>`
    ).join('');
}

function toggleCrcParticipant(id, name, checked) {
    if (checked) { if (!_crcParticipants.some(p => p.id === id)) _crcParticipants.push({ id, name }); }
    else { _crcParticipants = _crcParticipants.filter(p => p.id !== id); }
    _buildCrcParticipantPicker('crcParticipantsList', 'crcParticipantSearch', _crcParticipants, 'crc');
    _renderCrcSelectedChips('crcSelectedChips', _crcParticipants, 'crc');
}

function toggleEcrcParticipant(id, name, checked) {
    if (checked) { if (!_ecrcParticipants.some(p => p.id === id)) _ecrcParticipants.push({ id, name }); }
    else { _ecrcParticipants = _ecrcParticipants.filter(p => p.id !== id); }
    _buildCrcParticipantPicker('ecrcParticipantsList', 'ecrcParticipantSearch', _ecrcParticipants, 'ecrc');
    _renderCrcSelectedChips('ecrcSelectedChips', _ecrcParticipants, 'ecrc');
}

function onCrcParticipantSearch() {
    _buildCrcParticipantPicker('crcParticipantsList', 'crcParticipantSearch', _crcParticipants, 'crc');
}

function onEcrcParticipantSearch() {
    _buildCrcParticipantPicker('ecrcParticipantsList', 'ecrcParticipantSearch', _ecrcParticipants, 'ecrc');
}

function _populateCircuitSelect(selectId) {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    while (sel.options.length > 1) sel.remove(1); // keep the "— sem circuito —" option
    for (const c of _circuits) {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.name + (c.season ? ` — ${c.season}` : '');
        sel.appendChild(opt);
    }
}

// ── Ao Vivo tab ───────────────────────────────────────────────────────────────

async function loadLiveView() {
    const panel = document.getElementById('trnPanel_aovivo');
    if (!panel) return;
    panel.innerHTML = '<p style="color:var(--muted);text-align:center;padding:2rem 0;">Carregando…</p>';
    if (_trnLiveInterval) { clearInterval(_trnLiveInterval); _trnLiveInterval = null; }
    await _fetchLiveView();
    _trnLiveInterval = setInterval(_fetchLiveView, 30000);
}

async function _fetchLiveView() {
    const panel = document.getElementById('trnPanel_aovivo');
    if (!panel) { clearInterval(_trnLiveInterval); _trnLiveInterval = null; return; }
    try {
        const res = await fetch(`${AUTH_BASE}/tournaments`, { credentials: 'include' });
        if (!res.ok) throw new Error();
        const list   = await res.json();
        const active = list.find(t => t.status === 'in_progress');
        if (!active) { panel.innerHTML = '<p style="color:var(--muted);text-align:center;padding:2.5rem 0;">Nenhum torneio em andamento.</p>'; return; }
        // Fetch full detail
        const tRes = await fetch(`${AUTH_BASE}/tournaments/${active.id}`, { credentials: 'include' });
        const t    = await tRes.json();
        panel.innerHTML = _renderLiveHtml(t);
    } catch {
        panel.innerHTML = '<p style="color:var(--loss);text-align:center;padding:1.5rem 0;">Erro ao carregar.</p>';
    }
}

function _renderLiveHtml(t) {
    const rounds    = t.rounds || [];
    const lastRound = rounds[rounds.length - 1];
    if (!lastRound) return `<p style="color:var(--muted);text-align:center;padding:2rem 0;">Aguardando início das rodadas.</p>`;

    // Timer
    let timerHtml = '';
    if (t.currentTimerStart) {
        const elapsed = Math.floor((Date.now() - new Date(t.currentTimerStart).getTime()) / 1000);
        const m = Math.floor(elapsed / 60).toString().padStart(2, '0');
        const s = (elapsed % 60).toString().padStart(2, '0');
        const overtime = elapsed >= 50 * 60;
        timerHtml = `<div style="text-align:center;margin-bottom:1rem;">
            <span class="trn-timer${overtime ? ' overtime' : ''}" style="font-size:2rem;">${m}:${s}</span>
            ${overtime ? '<div style="font-size:.8rem;color:var(--loss);font-weight:600;">OVERTIME</div>' : ''}
        </div>`;
    }

    const isTopCutRound = lastRound.isTopCut || t.format === 'top_cut';
    const roundLabel = isTopCutRound ? 'Top Cut' : `Rodada ${lastRound.number}`;

    const rows = lastRound.pairings.map(pair => {
        const p1    = _pName(pair.p1Id, t.participants);
        const p2    = pair.p2Id === 'BYE' ? 'BYE' : _pName(pair.p2Id, t.participants);
        const p1img = _pLeaderImg(pair.p1Id, t.participants);
        const p2img = pair.p2Id === 'BYE' ? '' : _pLeaderImg(pair.p2Id, t.participants);
        const extMin = t.timeExtensions?.[pair.id];
        const extBadge = extMin ? `<span style="font-size:.7rem;color:var(--accent);font-weight:600;">+${extMin}min</span>` : '';

        if (pair.result) {
            const wId = pair.result.winnerId;
            const score = pair.p2Id === 'BYE' ? 'W/O' : `${pair.result.p1GameWins}-${pair.result.p2GameWins}`;
            return `<tr>
                <td style="${wId===pair.p1Id?'font-weight:700;':'color:var(--muted);'}">${p1img}${_tEsc(p1)}</td>
                <td style="text-align:center;font-size:.82rem;color:var(--muted);">${score}</td>
                <td style="${wId===pair.p2Id?'font-weight:700;':'color:var(--muted);'}">${p2img}${_tEsc(p2)}</td>
            </tr>`;
        }
        return `<tr>
            <td>${p1img}${_tEsc(p1)}</td>
            <td style="text-align:center;color:var(--muted);font-size:.82rem;">vs ${extBadge}</td>
            <td>${p2img}${_tEsc(p2)}</td>
        </tr>`;
    }).join('');

    const badge = lastRound.complete
        ? '<span style="font-size:.75rem;color:var(--win);font-weight:600;">✓ Encerrada</span>'
        : '<span style="font-size:.75rem;color:var(--accent);font-weight:600;">Em andamento</span>';

    return `<div>
        <div style="display:flex;align-items:baseline;gap:.6rem;margin-bottom:.75rem;flex-wrap:wrap;">
            <strong style="font-size:1rem;">${_tEsc(t.name)}</strong>
            <span style="font-size:.82rem;color:var(--muted);">${roundLabel}</span>
            ${badge}
            <span style="font-size:.75rem;color:var(--muted);margin-left:auto;">Auto-atualiza a cada 30s</span>
        </div>
        ${timerHtml}
        <div class="table-wrap"><table>
            <thead><tr><th>Player 1</th><th style="text-align:center;width:80px;"></th><th>Player 2</th></tr></thead>
            <tbody>${rows}</tbody>
        </table></div>
    </div>`;
}

// ── Edit tournament ───────────────────────────────────────────────────────────

function openEditTournamentModal() {
    const t = _currentTrn;
    if (!t) return;
    const hasRounds = (t.rounds?.length || 0) > 0;
    document.getElementById('etName').value         = t.name || '';
    document.getElementById('etDate').value         = t.date || '';
    document.getElementById('etFormat').value       = t.format || 'swiss';
    document.getElementById('etFormat').disabled    = hasRounds;
    document.getElementById('etTopCutSize').value   = String(t.topCutSize || 8);
    document.getElementById('etTopCutSize').disabled = hasRounds;
    document.getElementById('etTopCutWrap').style.display       = t.format === 'top_cut' ? '' : 'none';
    document.getElementById('etSwissTopCutWrap').style.display  = t.format === 'swiss_top_cut' ? '' : 'none';
    document.getElementById('etSwissTopCutSize').value = String(t.swissTopCutSize || 8);
    document.getElementById('etSwissTopCutSize').disabled = hasRounds;

    const mdfmt = t.matchFormat || 'md3';
    document.querySelectorAll('[name=etMatchFormat]').forEach(r => { r.checked = r.value === mdfmt; });

    document.getElementById('etFormat').onchange = function() {
        document.getElementById('etTopCutWrap').style.display      = this.value === 'top_cut' ? '' : 'none';
        document.getElementById('etSwissTopCutWrap').style.display = this.value === 'swiss_top_cut' ? '' : 'none';
    };
    _populateCircuitSelect('etCircuitId');
    const etCrcSel = document.getElementById('etCircuitId');
    if (etCrcSel) etCrcSel.value = t.circuitId || '';
    document.getElementById('editTournamentModal').style.display = 'flex';
}

function closeEditTournamentModal(e, force = false) {
    if (!force && e && !e.target.classList.contains('modal-overlay')) return;
    document.getElementById('editTournamentModal').style.display = 'none';
}

async function submitEditTournament() {
    const name           = document.getElementById('etName').value.trim();
    const date           = document.getElementById('etDate').value;
    const format         = document.getElementById('etFormat').value;
    const topCutSize     = parseInt(document.getElementById('etTopCutSize').value, 10);
    const swissTopCutSize = parseInt(document.getElementById('etSwissTopCutSize').value, 10);
    const matchFormat    = document.querySelector('[name=etMatchFormat]:checked')?.value || 'md3';
    if (!name) { alert('Nome obrigatório.'); return; }

    const btn = document.querySelector('#editTournamentModal .btn-primary');
    const orig = btn.innerHTML; btn.disabled = true; btn.innerHTML = 'Salvando…';
    try {
        const res = await fetch(`${AUTH_BASE}/tournaments/${_currentTrn.id}`, {
            method: 'PUT', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, date, format, topCutSize, swissTopCutSize, matchFormat, circuitId: document.getElementById('etCircuitId')?.value || null }),
        });
        if (!res.ok) { const err = await res.json().catch(()=>({})); alert(err.error || 'Erro.'); return; }
        _currentTrn = await res.json();
        closeEditTournamentModal(null, true);
        _renderDetail();
    } catch { alert('Erro de rede.');
    } finally { btn.disabled = false; btn.innerHTML = orig; }
}

// ── Delete tournament ─────────────────────────────────────────────────────────

async function deleteTournament() {
    if (!confirm(`Excluir o torneio "${_currentTrn?.name}"? Esta ação não pode ser desfeita.`)) return;
    try {
        const res = await fetch(`${AUTH_BASE}/tournaments/${_currentTrn.id}`, { method: 'DELETE', credentials: 'include' });
        if (!res.ok) { alert('Erro ao excluir.'); return; }
        _currentTrn = null;
        _showTrnList();
        loadTournaments();
    } catch { alert('Erro de rede.'); }
}

// ── Drop player ───────────────────────────────────────────────────────────────

async function dropPlayer(participantId) {
    const p = _currentTrn?.participants?.find(x => x.id === participantId);
    if (!p) return;
    if (!confirm(`Dropar ${p.name}? As partidas pendentes serão dadas como W/O para os oponentes.`)) return;
    try {
        const res = await fetch(`${AUTH_BASE}/tournaments/${_currentTrn.id}/drop/${encodeURIComponent(participantId)}`, {
            method: 'POST', credentials: 'include',
        });
        if (!res.ok) { const err = await res.json().catch(()=>({})); alert(err.error || 'Erro.'); return; }
        _currentTrn = await res.json();
        _renderDetail();
    } catch { alert('Erro de rede.'); }
}

// ── Standings (client) ────────────────────────────────────────────────────────

function _computeStandings(t) {
    const map = {};
    for (const p of (t.participants || []))
        map[p.id] = { id: p.id, name: p.name, wins: 0, losses: 0, gw: 0, gl: 0, dropped: !!p.dropped, opponents: [] };
    for (const round of (t.rounds || [])) {
        for (const pair of round.pairings) {
            if (!pair.result) continue;
            const { winnerId, p1GameWins: p1g = 0, p2GameWins: p2g = 0 } = pair.result;
            const loserId = winnerId === pair.p1Id ? pair.p2Id : pair.p1Id;
            if (map[winnerId]) {
                map[winnerId].wins++;
                map[winnerId].gw += winnerId === pair.p1Id ? p1g : p2g;
                map[winnerId].gl += winnerId === pair.p1Id ? p2g : p1g;
                if (loserId !== 'BYE') map[winnerId].opponents.push(loserId);
            }
            if (map[loserId]) {
                map[loserId].losses++;
                map[loserId].gw += loserId === pair.p1Id ? p1g : p2g;
                map[loserId].gl += loserId === pair.p1Id ? p2g : p1g;
                if (winnerId !== 'BYE') map[loserId].opponents.push(winnerId);
            }
        }
    }
    // OMW%
    const standings = Object.values(map);
    for (const s of standings) {
        if (!s.opponents.length) { s.omwPct = 0.33; delete s.opponents; continue; }
        const rates = s.opponents.map(opId => {
            const op = map[opId];
            if (!op) return 0.33;
            const total = op.wins + op.losses;
            return total ? Math.max(0.33, op.wins / total) : 0.33;
        });
        s.omwPct = rates.reduce((a, b) => a + b, 0) / rates.length;
        delete s.opponents;
    }
    return standings.sort((a, b) => b.wins - a.wins || a.losses - b.losses || b.omwPct - a.omwPct || b.gw - a.gw);
}

function _pName(id, participants) {
    if (id === 'BYE') return 'BYE';
    return participants?.find(p => p.id === id)?.name || id;
}

// ── Leader selection ──────────────────────────────────────────────────────────

const TRN_LEADERS = [
    {id:'OP01-001',name:'Roronoa Zoro'},{id:'OP01-002',name:'Trafalgar Law'},{id:'OP01-003',name:'Monkey D. Luffy'},
    {id:'OP01-031',name:'Kouzuki Oden'},{id:'OP01-060',name:'Donquixote Doflamingo'},{id:'OP01-061',name:'Kaido'},
    {id:'OP01-062',name:'Crocodile'},{id:'OP01-091',name:'King'},
    {id:'OP02-001',name:'Edward Newgate'},{id:'OP02-002',name:'Monkey D. Garp'},{id:'OP02-025',name:"Kin'emon"},
    {id:'OP02-026',name:'Sanji'},{id:'OP02-049',name:'Emporio Ivankov'},{id:'OP02-071',name:'Magellan'},
    {id:'OP02-072',name:'Zephyr'},{id:'OP02-093',name:'Smoker'},
    {id:'OP03-001',name:'Portgas D. Ace'},{id:'OP03-021',name:'Kuro'},{id:'OP03-022',name:'Arlong'},
    {id:'OP03-040',name:'Nami'},{id:'OP03-058',name:'Iceburg'},{id:'OP03-076',name:'Rob Lucci'},
    {id:'OP03-077',name:'Charlotte Linlin'},{id:'OP03-099',name:'Charlotte Katakuri'},
    {id:'OP04-001',name:'Nefertari Vivi'},{id:'OP04-019',name:'Donquixote Doflamingo'},{id:'OP04-020',name:'Issho'},
    {id:'OP04-039',name:'Rebecca'},{id:'OP04-040',name:'Queen'},{id:'OP04-058',name:'Crocodile'},
    {id:'OP05-001',name:'Sabo'},{id:'OP05-002',name:'Belo Betty'},{id:'OP05-022',name:'Donquixote Rosinante'},
    {id:'OP05-041',name:'Sakazuki'},{id:'OP05-060',name:'Monkey D. Luffy'},{id:'OP05-098',name:'Enel'},
    {id:'OP06-001',name:'Uta'},{id:'OP06-020',name:'Hody Jones'},{id:'OP06-021',name:'Perona'},
    {id:'OP06-022',name:'Yamato'},{id:'OP06-042',name:'Vinsmoke Reiju'},{id:'OP06-080',name:'Gecko Moria'},
    {id:'OP07-001',name:'Monkey D. Dragon'},{id:'OP07-019',name:'Jewelry Bonney'},{id:'OP07-038',name:'Boa Hancock'},
    {id:'OP07-059',name:'Foxy'},{id:'OP07-079',name:'Rob Lucci'},{id:'OP07-097',name:'Vegapunk'},
    {id:'OP08-001',name:'Tony Tony Chopper'},{id:'OP08-002',name:'Marco'},{id:'OP08-021',name:'Carrot'},
    {id:'OP08-057',name:'King'},{id:'OP08-058',name:'Charlotte Pudding'},{id:'OP08-098',name:'Kalgara'},
    {id:'OP09-001',name:'Shanks'},{id:'OP09-022',name:'Lim'},{id:'OP09-042',name:'Buggy'},
    {id:'OP09-061',name:'Monkey D. Luffy'},{id:'OP09-062',name:'Nico Robin'},{id:'OP09-081',name:'Marshall D. Teach'},
    {id:'OP10-001',name:'Smoker'},{id:'OP10-002',name:'Caesar Clown'},{id:'OP10-003',name:'Sugar'},
    {id:'OP10-022',name:'Trafalgar Law'},{id:'OP10-042',name:'Usopp'},{id:'OP10-099',name:'Eustass "Captain" Kid'},
    {id:'OP11-001',name:'Koby'},{id:'OP11-021',name:'Jinbe'},{id:'OP11-022',name:'Shirahoshi'},
    {id:'OP11-040',name:'Monkey D. Luffy'},{id:'OP11-041',name:'Nami'},{id:'OP11-062',name:'Charlotte Katakuri'},
    {id:'OP12-001',name:'Silvers Rayleigh'},{id:'OP12-020',name:'Roronoa Zoro'},{id:'OP12-040',name:'Kuzan'},
    {id:'OP12-041',name:'Sanji'},{id:'OP12-061',name:'Donquixote Rosinante'},{id:'OP12-081',name:'Koala'},
    {id:'OP13-001',name:'Monkey D. Luffy'},{id:'OP13-002',name:'Portgas D. Ace'},{id:'OP13-003',name:'Gol D. Roger'},
    {id:'OP13-004',name:'Sabo'},{id:'OP13-079',name:'Imu'},{id:'OP13-100',name:'Jewelry Bonney'},
    {id:'OP14-001',name:'Trafalgar Law'},{id:'OP14-020',name:'Dracule Mihawk'},{id:'OP14-040',name:'Jinbe'},
    {id:'OP14-041',name:'Boa Hancock'},{id:'OP14-060',name:'Donquixote Doflamingo'},{id:'OP14-079',name:'Crocodile'},
    {id:'OP14-080',name:'Gecko Moria'},
    {id:'OP15-001',name:'Don Krieg'},{id:'OP15-002',name:'Lucy'},{id:'OP15-022',name:'Brook'},
    {id:'OP15-039',name:'Rebecca'},{id:'OP15-058',name:'Enel'},{id:'OP15-098',name:'Monkey D. Luffy'},
    {id:'EB01-001',name:'Kouzuki Oden'},{id:'EB01-021',name:'Hannyabal'},{id:'EB01-040',name:'Kyros'},
    {id:'EB02-010',name:'Monkey D. Luffy'},{id:'EB03-001',name:'Nefertari Vivi'},{id:'EB04-001',name:'Jewelry Bonney'},
    {id:'ST01-001',name:'Monkey D. Luffy'},{id:'ST02-001',name:'Eustass "Captain" Kid'},{id:'ST03-001',name:'Crocodile'},
    {id:'ST04-001',name:'Kaido'},{id:'ST05-001',name:'Shanks'},{id:'ST06-001',name:'Sakazuki'},
    {id:'ST07-001',name:'Charlotte Linlin'},{id:'ST08-001',name:'Monkey D. Luffy'},{id:'ST09-001',name:'Yamato'},
    {id:'ST10-001',name:'Trafalgar Law'},{id:'ST10-002',name:'Monkey D. Luffy'},{id:'ST10-003',name:'Eustass "Captain" Kid'},
    {id:'ST11-001',name:'Uta'},{id:'ST12-001',name:'Roronoa Zoro & Sanji'},{id:'ST13-001',name:'Sabo'},
    {id:'ST13-002',name:'Portgas D. Ace'},{id:'ST13-003',name:'Monkey D. Luffy'},{id:'ST14-001',name:'Monkey D. Luffy'},
    {id:'ST21-001',name:'Monkey D. Luffy (Gear 5)'},{id:'ST22-001',name:'Ace & Newgate'},{id:'ST29-001',name:'Monkey D. Luffy'},
];

function _leaderImgUrl(id) { return id ? `https://optcgapi.com/media/static/Card_Images/${id}.jpg` : ''; }
function _leaderName(id) {
    if (!id) return '';
    const l = TRN_LEADERS.find(x => x.id === id);
    return l ? `${l.name} (${id})` : id;
}

function _leaderSelectHtml(participantId, currentLeaderId) {
    const opts = TRN_LEADERS.map(l =>
        `<option value="${_tEsc(l.id)}" ${l.id === currentLeaderId ? 'selected' : ''}>${_tEsc(l.id)} · ${_tEsc(l.name)}</option>`
    ).join('');
    return `<select data-pid="${_tEsc(participantId)}" onchange="setParticipantLeader(this.dataset.pid, this.value)" style="font-size:.75rem;padding:.15rem .3rem;border:1px solid var(--border);border-radius:5px;background:var(--card);color:var(--text);max-width:180px;cursor:pointer;">
        <option value="">— líder —</option>${opts}
    </select>`;
}

async function setParticipantLeader(participantId, leaderId) {
    try {
        const res = await fetch(`${AUTH_BASE}/tournaments/${_currentTrn.id}/participant/${encodeURIComponent(participantId)}`, {
            method: 'PUT', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ leaderId: leaderId || '' }),
        });
        if (!res.ok) { alert('Erro ao salvar líder.'); return; }
        _currentTrn = await res.json();
        _renderDetail();
    } catch { alert('Erro de rede.'); }
}

// ── Create tournament modal ───────────────────────────────────────────────────

function openCreateTournamentModal() {
    _trnParticipants = []; _trnSearchResults = {};
    document.getElementById('tnName').value              = '';
    document.getElementById('tnDate').value              = new Date().toISOString().slice(0, 10);
    document.getElementById('tnFormat').value            = 'swiss';
    document.getElementById('tnTopCutSize').value        = '8';
    document.getElementById('tnSwissTopCutSize').value   = '8';
    document.getElementById('tnPlayerSearch').value      = '';
    document.getElementById('tnGuestName').value         = '';
    document.getElementById('tnSwissOptions').style.display     = '';
    document.getElementById('tnTopCutOptions').style.display    = 'none';
    document.getElementById('tnSwissTopCutOpts').style.display  = 'none';
    document.getElementById('tnPlayerAC').style.display         = 'none';
    document.querySelectorAll('[name=tnMatchFormat]').forEach(r => { r.checked = r.value === 'md3'; });
    _populateCircuitSelect('tnCircuitId');
    const crcSel = document.getElementById('tnCircuitId');
    if (crcSel) crcSel.value = '';
    _renderTrnParticipants();
    document.getElementById('createTournamentModal').style.display = 'flex';
}

function closeTournamentModal(e, force = false) {
    if (!force && e && !e.target.classList.contains('modal-overlay')) return;
    document.getElementById('createTournamentModal').style.display = 'none';
    document.getElementById('tnPlayerAC').style.display = 'none';
}

function onTournamentFormatChange() {
    const fmt = document.getElementById('tnFormat').value;
    document.getElementById('tnSwissOptions').style.display     = fmt === 'swiss' ? '' : 'none';
    document.getElementById('tnTopCutOptions').style.display    = fmt === 'top_cut' ? '' : 'none';
    document.getElementById('tnSwissTopCutOpts').style.display  = fmt === 'swiss_top_cut' ? '' : 'none';
}

function onTournamentPlayerSearch() {
    const q = document.getElementById('tnPlayerSearch').value.trim().toLowerCase();
    const ac = document.getElementById('tnPlayerAC');
    if (q.length < 2) { ac.style.display = 'none'; return; }
    const dir = Object.values(App.profileDirectory || {});
    const matches = dir
        .filter(p => !_trnParticipants.some(x => x.id === p.bandaiName))
        .filter(p => (p.displayName || '').toLowerCase().includes(q) || (p.bandaiName || '').toLowerCase().includes(q))
        .slice(0, 8);
    if (!matches.length) { ac.style.display = 'none'; return; }
    _trnSearchResults = {};
    ac.innerHTML = matches.map((p, i) => {
        const key = 'tps_' + i;
        _trnSearchResults[key] = { id: p.bandaiName, name: p.displayName || p.bandaiName, isGuest: false };
        return `<div class="ac-item" onclick="addTournamentPlayer('${key}')">&#127918; ${_tEsc(p.displayName || p.bandaiName)}`
            + (p.bandaiName ? `<span style="font-size:.72rem;color:var(--muted);margin-left:.35rem;">${_tEsc(p.bandaiName)}</span>` : '')
            + `</div>`;
    }).join('');
    ac.style.display = 'block';
}

function addTournamentPlayer(key) {
    const player = _trnSearchResults[key];
    if (!player || _trnParticipants.some(p => p.id === player.id)) return;
    _trnParticipants.push(player);
    document.getElementById('tnPlayerSearch').value = '';
    document.getElementById('tnPlayerAC').style.display = 'none';
    _renderTrnParticipants();
}

function addTournamentGuest() {
    const name = document.getElementById('tnGuestName').value.trim();
    if (!name) return;
    _trnParticipants.push({ id: 'guest_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5), name, isGuest: true });
    document.getElementById('tnGuestName').value = '';
    _renderTrnParticipants();
}

function removeTournamentParticipant(idx) {
    _trnParticipants.splice(idx, 1);
    _renderTrnParticipants();
}

function _renderTrnParticipants() {
    const container = document.getElementById('tnParticipantsList');
    const countEl   = document.getElementById('tnParticipantsCount');
    const n = _trnParticipants.length;
    countEl.textContent = `${n} participante${n !== 1 ? 's' : ''}`;
    if (!n) { container.innerHTML = '<span style="color:var(--muted);font-size:.8rem;align-self:center;">Nenhum participante adicionado</span>'; return; }
    container.innerHTML = _trnParticipants.map((p, i) => `
        <span style="display:inline-flex;align-items:center;gap:.3rem;background:var(--card);border:1px solid var(--border);border-radius:20px;padding:.2rem .65rem;font-size:.8rem;white-space:nowrap;">
            ${p.isGuest ? '&#128100;' : '&#127918;'} ${_tEsc(p.name)}
            <button onclick="removeTournamentParticipant(${i})" style="background:none;border:none;cursor:pointer;color:var(--loss);font-size:.85rem;line-height:1;padding:0 0 0 .2rem;" title="Remover">&#10005;</button>
        </span>`).join('');
}

async function submitCreateTournament() {
    const name           = document.getElementById('tnName').value.trim();
    const date           = document.getElementById('tnDate').value;
    const format         = document.getElementById('tnFormat').value;
    const topCutSize     = parseInt(document.getElementById('tnTopCutSize').value, 10);
    const swissTopCutSize = parseInt(document.getElementById('tnSwissTopCutSize').value, 10);
    const matchFormat    = document.querySelector('[name=tnMatchFormat]:checked')?.value || 'md3';
    if (!name) { alert('Digite o nome do torneio.'); return; }
    if (!date) { alert('Selecione a data.'); return; }
    const circuitId = document.getElementById('tnCircuitId')?.value || null;
    const body = { name, date, format, matchFormat, participants: _trnParticipants, circuitId: circuitId || null };
    if (format === 'top_cut')      body.topCutSize      = topCutSize;
    if (format === 'swiss_top_cut') body.swissTopCutSize = swissTopCutSize;
    const btn = document.querySelector('#createTournamentModal .btn-primary');
    const orig = btn.innerHTML; btn.disabled = true; btn.innerHTML = 'Criando…';
    try {
        const res = await fetch(`${AUTH_BASE}/tournaments`, {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!res.ok) { const err = await res.json().catch(()=>({})); alert(err.error || 'Erro.'); return; }
        closeTournamentModal(null, true);
        await loadTournaments();
    } catch { alert('Erro de rede.');
    } finally { btn.disabled = false; btn.innerHTML = orig; }
}

// ── Util ──────────────────────────────────────────────────────────────────────

function _tEsc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

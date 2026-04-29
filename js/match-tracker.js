// ── Match Tracker ─────────────────────────────────────────────────────────────
// Requires: auth.js (AUTH_BASE), tournaments.js (TRN_LEADERS, _leaderImgUrl)

const ML_SETS = ['OP15','OP14','EB04','OP13','EB03','OP12','EB02','OP11','EB01',
                 'OP10','OP09','OP08','OP07','OP06','OP05','OP04','OP03','OP02','OP01'];
const ML_TYPES = ['Testing','Local','Store CS','Treasure Cup','Flagship','Regional','National','World'];

let _mlMatches              = [];   // cached list
let _mlRoundCtx             = null; // { matchId, type } while the round detail modal is open
let _mlPendingBandaiEventId = null; // bandaiEventId selected via suggestion chip
let _mlCurrentBandaiId      = null; // resolved bandaiId of the logged-in user

// ── Init ───────────────────────────────────────────────────────────────────────

async function loadMatchLog() {
    const el = document.getElementById('matchLogTab');
    if (!el) return;
    el.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
            <h2 style="margin:0;font-size:1.15rem;">&#129527; Log Pose</h2>
            <button class="btn btn-primary btn-sm" onclick="openCreateMatchModal()">+ Add Tournament</button>
        </div>
        <div id="mlList"><p style="color:var(--muted);text-align:center;padding:3rem 0;">Carregando…</p></div>
        ${_mlCreateModalHtml()}
        ${_mlRoundTypeModalHtml()}
        ${_mlRoundDetailModalHtml()}
    `;
    try {
        const [matchRes, authUser] = await Promise.all([
            fetch(`${AUTH_BASE}/my-matches`, { credentials: 'include' }),
            _authUserPromise,
        ]);
        _mlMatches = matchRes.ok ? await matchRes.json() : [];
        const me = (App.usersWithToken || []).find(u =>
            u.name.toLowerCase() === (authUser?.bandaiName || '').toLowerCase());
        _mlCurrentBandaiId = me?.bandaiId || null;
    } catch { _mlMatches = []; }
    _renderMatchList();
}

// ── Rendering ──────────────────────────────────────────────────────────────────

function _renderMatchList() {
    const el = document.getElementById('mlList');
    if (!el) return;
    if (_mlMatches.length === 0) {
        el.innerHTML = `<p style="color:var(--muted);text-align:center;padding:3rem 0;">Nenhum torneio registrado ainda.<br>Clique em <strong>+ Add Tournament</strong> para começar.</p>`;
        return;
    }
    const sorted = [..._mlMatches].sort((a, b) => (a.closed ? 1 : 0) - (b.closed ? 1 : 0));
    el.innerHTML = sorted.map(m => _mlCardHtml(m)).join('');
}

function _mlCardHtml(m) {
    const { w, l } = _mlScore(m.rounds);
    const imgSrc   = m.leaderId ? _leaderImgUrl(m.leaderId) : '';
    const leaderName = m.leaderId ? (TRN_LEADERS.find(x => x.id === m.leaderId)?.name ?? m.leaderId) : '—';
    const scoreColor = w > l ? 'var(--win,#28a745)' : (l > w ? 'var(--loss,#dc3545)' : 'var(--muted)');

    const tags = [
        m.set  ? `<span class="pm-badge yonkou">${m.set}</span>`  : '',
        m.type ? `<span class="pm-badge shichi">${_mlTypeShort(m.type)}</span>` : '',
    ].filter(Boolean).join(' ');

    const roundsHtml = m.rounds.length === 0
        ? `<p style="color:var(--muted);font-size:.82rem;margin:.5rem 0 .25rem;">Nenhum round ainda.</p>`
        : `<table style="width:100%;border-collapse:collapse;font-size:.82rem;margin-top:.6rem;">
            <thead>
                <tr style="color:var(--muted);font-size:.72rem;text-transform:uppercase;letter-spacing:.06em;">
                    <th style="text-align:left;padding:.2rem .4rem;">Round</th>
                    <th style="text-align:left;padding:.2rem .4rem;">Deck</th>
                    <th style="text-align:center;padding:.2rem .4rem;">Dice</th>
                    <th style="text-align:center;padding:.2rem .4rem;">Order</th>
                    <th style="text-align:center;padding:.2rem .4rem;">Result</th>
                </tr>
            </thead>
            <tbody>
                ${m.rounds.map((r, i) => _mlRoundRowHtml(r, i + 1)).join('')}
            </tbody>
          </table>`;

    const isClosed   = !!m.closed;
    const cardBorder = isClosed ? 'border:1.5px solid var(--win,#28a745);opacity:.82;' : '';
    const closedBadge = isClosed
        ? `<span style="font-size:.67rem;font-weight:700;background:rgba(40,167,69,.13);color:var(--win,#28a745);border:1px solid var(--win,#28a745);border-radius:10px;padding:.1rem .42rem;margin-left:.45rem;vertical-align:middle;">Finalizado</span>`
        : '';
    const bottomButtons = isClosed
        ? `<button class="btn btn-outline btn-sm" style="margin-top:.75rem;width:100%;color:var(--muted);" onclick="toggleCloseMatch('${m.id}')">&#8617; Reabrir torneio</button>`
        : `<div style="display:flex;gap:.5rem;margin-top:.75rem;">
               <button class="btn btn-outline btn-sm" style="flex:1;" onclick="openAddRoundModal('${m.id}')">+ Add round</button>
               <button class="btn btn-outline btn-sm" style="color:var(--win,#28a745);border-color:var(--win,#28a745);padding-left:.8rem;padding-right:.8rem;" onclick="toggleCloseMatch('${m.id}')">&#127937; Encerrar</button>
           </div>`;

    return `
    <div class="card" style="margin-bottom:1rem;${cardBorder}">
        <div class="card-body" style="padding:.9rem 1rem;">
            <div style="display:flex;gap:.9rem;align-items:flex-start;">
                <div style="position:relative;flex-shrink:0;">
                    ${imgSrc
                        ? `<img src="${imgSrc}" alt="${leaderName}" style="width:60px;height:60px;object-fit:cover;border-radius:6px;display:block;" onerror="this.style.display='none'">`
                        : `<div style="width:60px;height:60px;background:var(--card-bg,#e9ecef);border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:1.5rem;">🃏</div>`}
                    <span style="position:absolute;bottom:-6px;left:50%;transform:translateX(-50%);background:${scoreColor};color:#fff;font-weight:700;font-size:.72rem;padding:.1rem .38rem;border-radius:8px;white-space:nowrap;">${w}–${l}</span>
                </div>
                <div style="flex:1;min-width:0;">
                    <div style="display:flex;justify-content:space-between;align-items:center;gap:.5rem;">
                        <div style="min-width:0;overflow:hidden;">
                            <strong style="font-size:.97rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${_esc(m.name)}</strong>${closedBadge}
                        </div>
                        <button class="btn btn-outline btn-sm" style="font-size:.7rem;padding:.18rem .45rem;flex-shrink:0;color:var(--loss,#dc3545);border-color:var(--loss,#dc3545);"
                            onclick="deleteMatch('${m.id}')">&#128465;</button>
                    </div>
                    <div style="font-size:.77rem;color:var(--muted);margin:.15rem 0 .35rem;">${m.date}${tags ? ' &nbsp;' + tags : ''}</div>
                    ${roundsHtml}
                </div>
            </div>
            ${_mlTournamentStatsHtml(m)}
            ${m.bandaiEventId ? _mlStandingsHtml(m) : ''}
            ${bottomButtons}
        </div>
    </div>`;
}

function _mlTournamentStatsHtml(m) {
    const rounds = (m.rounds || []).filter(r => r.type !== 'bye' && r.won != null);
    if (rounds.length < 2) return '';

    // Dice
    const withDice   = rounds.filter(r => r.wonDice != null);
    const diceWon    = withDice.filter(r => r.wonDice).length;
    const dicePct    = withDice.length ? Math.round(diceWon / withDice.length * 100) : null;

    // Order
    const goFirst    = rounds.filter(r => r.wentFirst === true);
    const goSecond   = rounds.filter(r => r.wentFirst === false);
    const firstWin   = goFirst.filter(r => r.won).length;
    const secondWin  = goSecond.filter(r => r.won).length;
    const firstPct   = goFirst.length  ? Math.round(firstWin  / goFirst.length  * 100) : null;
    const secondPct  = goSecond.length ? Math.round(secondWin / goSecond.length * 100) : null;

    // Dice vs result correlation
    const wonDiceRounds  = withDice.filter(r => r.wonDice === true);
    const lostDiceRounds = withDice.filter(r => r.wonDice === false);
    const winWhenDice    = wonDiceRounds.filter(r => r.won).length;
    const winWhenNoDice  = lostDiceRounds.filter(r => r.won).length;
    const wdPct          = wonDiceRounds.length  >= 2 ? Math.round(winWhenDice   / wonDiceRounds.length  * 100) : null;
    const wndPct         = lostDiceRounds.length >= 2 ? Math.round(winWhenNoDice / lostDiceRounds.length * 100) : null;

    // Unique opponent decks
    const uniqueLeaders = [...new Set(rounds.map(r => r.opponentLeaderId).filter(Boolean))];
    const namedOpps     = [...new Set(rounds.map(r => r.opponentName).filter(Boolean))];
    const uniqueDeckCount = uniqueLeaders.length || namedOpps.length;

    // Top cut rounds
    const topCutRounds = rounds.filter(r => r.type === 'topcut');

    function pctColor(p) {
        if (p == null) return 'var(--muted)';
        return p >= 60 ? 'var(--win,#28a745)' : (p <= 40 ? 'var(--loss,#dc3545)' : 'var(--text,#555)');
    }
    function stat(label, val, pct) {
        const c = pctColor(pct);
        return `<div style="line-height:1.5;">${label} <strong style="color:${c};">${val}</strong>${pct != null ? ` <span style="font-size:.7rem;color:${c};">(${pct}%)</span>` : ''}</div>`;
    }

    const cells = [];
    if (withDice.length >= 1)
        cells.push(stat('🎲 Dado', `${diceWon}/${withDice.length}`, dicePct));
    if (uniqueDeckCount)
        cells.push(`<div style="line-height:1.5;">🃏 Decks <strong>${uniqueDeckCount}</strong> distintos</div>`);
    if (goFirst.length)
        cells.push(stat('1º jogador', `${firstWin}V ${goFirst.length - firstWin}D`, firstPct));
    if (goSecond.length)
        cells.push(stat('2º jogador', `${secondWin}V ${goSecond.length - secondWin}D`, secondPct));
    if (wdPct  != null)
        cells.push(stat('+Dado', `${winWhenDice}/${wonDiceRounds.length}`, wdPct));
    if (wndPct != null)
        cells.push(stat('−Dado', `${winWhenNoDice}/${lostDiceRounds.length}`, wndPct));
    if (topCutRounds.length)
        cells.push(`<div style="line-height:1.5;">🏆 Top cut <strong>${topCutRounds.length}</strong> round${topCutRounds.length > 1 ? 's' : ''}</div>`);

    // Bandai API fields from local cache (read synchronously — already fetched by My Stats)
    if (m.bandaiEventId && _mlCurrentBandaiId) {
        try {
            const cache     = loadCache(_mlCurrentBandaiId);
            const evUser    = cache[String(m.bandaiEventId)]?.user;
            if (evUser) {
                // Opponent Win Rate — try every known field name; value is typically 0–1 (decimal)
                const owr = evUser.opponent_match_win_rate
                    ?? evUser.opponent_win_rate
                    ?? evUser.resistance
                    ?? evUser.owp ?? null;
                if (owr != null) {
                    const owrPct = owr > 1 ? Math.round(owr) : Math.round(owr * 100);
                    cells.push(stat('Resistência (OWR)', `${owrPct}%`, owrPct));
                }
                // Game Win Rate
                const gwr = evUser.game_win_rate ?? evUser.gwp ?? evUser.game_win_percentage ?? null;
                if (gwr != null) {
                    const gwrPct = gwr > 1 ? Math.round(gwr) : Math.round(gwr * 100);
                    cells.push(stat('GWR', `${gwrPct}%`, gwrPct));
                }
                // Current standing (rank during live event)
                const liveRank = evUser.rank ?? null;
                if (liveRank != null && m.finalRank == null) {
                    cells.push(`<div style="line-height:1.5;">📍 Colocação atual <strong>#${liveRank}</strong></div>`);
                }
                // Drop status
                if (evUser.drop_flg === 1 || evUser.is_drop === true) {
                    cells.push(`<div style="line-height:1.5;color:var(--loss,#dc3545);">⚠️ <strong>Drop</strong></div>`);
                }
            }
        } catch { /* cache unavailable */ }
    }

    // Persisted sync values (from the Sync button — stored in worker)
    if (m.opponentWinRate != null) {
        const owrPct = m.opponentWinRate > 1 ? Math.round(m.opponentWinRate) : Math.round(m.opponentWinRate * 100);
        if (!cells.some(c => c.includes('Resistência')))
            cells.push(stat('Resistência (OWR)', `${owrPct}%`, owrPct));
    }
    if (m.gameWinRate != null) {
        const gwrPct = m.gameWinRate > 1 ? Math.round(m.gameWinRate) : Math.round(m.gameWinRate * 100);
        if (!cells.some(c => c.includes('GWR')))
            cells.push(stat('GWR', `${gwrPct}%`, gwrPct));
    }

    if (!cells.length) return '';

    const thumbsHtml = uniqueLeaders.length
        ? `<div style="margin-top:.45rem;display:flex;gap:.25rem;flex-wrap:wrap;align-items:center;">
            ${uniqueLeaders.map(id => `<img src="${_leaderImgUrl(id)}" title="${_esc(id)}" style="width:22px;height:22px;object-fit:cover;border-radius:3px;" onerror="this.style.display='none'">`).join('')}
           </div>`
        : '';

    const cols = cells.length >= 4 ? '1fr 1fr' : '1fr';
    return `
    <div style="margin-top:.65rem;padding:.5rem .7rem;background:var(--bg,#f8f9fa);border-radius:8px;border:1px solid var(--border,#dee2e6);">
        <div style="font-size:.67rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.07em;margin-bottom:.4rem;">Estatísticas do torneio</div>
        <div style="display:grid;grid-template-columns:${cols};gap:.2rem .8rem;font-size:.79rem;">
            ${cells.join('')}
        </div>
        ${thumbsHtml}
    </div>`;
}

function _mlStandingsHtml(m) {
    const syncBtn = `<button data-sync-match="${m.id}" onclick="mlSyncStandings('${m.id}')"
        style="font-size:.78rem;padding:.22rem .55rem;border:1px solid var(--accent,#048A81);border-radius:6px;background:none;color:var(--accent,#048A81);cursor:pointer;white-space:nowrap;">&#8635; Sync</button>`;
    const hasFinal = m.finalRank != null || m.finalPoints != null || m.finalStatus;
    if (hasFinal) {
        const rank   = m.finalRank   != null ? `<span>&#127885; #${m.finalRank}</span>` : '';
        const pts    = m.finalPoints != null ? `<span>&#9889; ${m.finalPoints}pts</span>` : '';
        const status = m.finalStatus ? `<span style="font-style:italic;">${_esc(m.finalStatus)}</span>` : '';
        const owr    = m.opponentWinRate != null
            ? `<span title="Opponent Win Rate">OWR ${m.opponentWinRate > 1 ? Math.round(m.opponentWinRate) : Math.round(m.opponentWinRate * 100)}%</span>` : '';
        const gwr    = m.gameWinRate != null
            ? `<span title="Game Win Rate">GWR ${m.gameWinRate > 1 ? Math.round(m.gameWinRate) : Math.round(m.gameWinRate * 100)}%</span>` : '';
        return `<div style="display:flex;align-items:center;gap:.55rem;flex-wrap:wrap;margin-top:.6rem;padding:.4rem .55rem;background:rgba(4,138,129,.07);border-radius:7px;font-size:.82rem;">
            ${rank}${pts}${status}${owr}${gwr}
            <span style="flex:1;"></span>
            ${syncBtn}
        </div>`;
    }
    return `<div style="margin-top:.6rem;text-align:right;">${syncBtn}</div>`;
}

async function mlSyncStandings(matchId) {
    const m = _mlMatches.find(x => x.id === matchId);
    if (!m?.bandaiEventId) return;
    const user = await _authUserPromise;
    const me   = (App.usersWithToken || []).find(u => u.name.toLowerCase() === (user?.bandaiName || '').toLowerCase());
    if (!me?.token) { _mlShowSyncError(matchId, 'Token não disponível'); return; }
    _mlSetSyncLoading(matchId, true);
    try {
        const res = await fetch(`${BANDAI_API_BASE}/api/user/event/${m.bandaiEventId}/history`,
            { headers: { 'X-Authentication': me.token } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const info   = data?.success;
        const finalRank   = info?.user?.rank        ?? null;
        const finalPoints = info?.user?.match_point  ?? null;
        const finalStatus = info?.event?.status_name ?? null;
        const opponentWinRate = info?.user?.opponent_match_win_rate
            ?? info?.user?.opponent_win_rate
            ?? info?.user?.resistance
            ?? info?.user?.owp ?? null;
        const gameWinRate = info?.user?.game_win_rate
            ?? info?.user?.gwp
            ?? info?.user?.game_win_percentage ?? null;

        const r2 = await fetch(`${AUTH_BASE}/my-matches/${matchId}`, {
            method: 'PUT', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ finalRank, finalPoints, finalStatus, opponentWinRate, gameWinRate }),
        });
        if (!r2.ok) throw new Error(await r2.text());

        const idx = _mlMatches.findIndex(x => x.id === matchId);
        if (idx !== -1) Object.assign(_mlMatches[idx], { finalRank, finalPoints, finalStatus, opponentWinRate, gameWinRate });
        _renderMatchList();
    } catch (e) {
        _mlSetSyncLoading(matchId, false);
        _mlShowSyncError(matchId, e.message);
    }
}

function _mlSetSyncLoading(matchId, loading) {
    const btn = document.querySelector(`[data-sync-match="${matchId}"]`);
    if (!btn) return;
    btn.disabled = loading;
    btn.textContent = loading ? '…' : '↻ Sync';
}

function _mlShowSyncError(matchId, msg) {
    const btn = document.querySelector(`[data-sync-match="${matchId}"]`);
    if (!btn) return;
    btn.disabled = false;
    btn.style.color = 'var(--loss,#dc3545)';
    btn.style.borderColor = 'var(--loss,#dc3545)';
    btn.title = msg;
    btn.textContent = '✕ Erro';
}

function _mlRoundRowHtml(r, num) {
    if (r.type === 'bye') {
        return `<tr style="background:var(--bg,#f8f9fa);">
            <td style="padding:.3rem .4rem;"><strong style="color:var(--muted);">${num}</strong></td>
            <td colspan="4" style="padding:.3rem .4rem;color:var(--muted);font-style:italic;">Bye</td>
        </tr>`;
    }
    const topCutBadge = r.type === 'topcut' ? `<span style="font-size:.65rem;background:#fff3cd;color:#856404;border:1px solid #ffc107;border-radius:10px;padding:.08rem .3rem;margin-left:.3rem;">TC</span>` : '';
    const oppImg = r.opponentLeaderId
        ? `<img src="${_leaderImgUrl(r.opponentLeaderId)}" style="width:28px;height:28px;object-fit:cover;border-radius:3px;vertical-align:middle;" onerror="this.style.display='none'">`
        : `<span style="color:var(--muted);font-size:.8rem;">—</span>`;
    const oppNameHtml = r.opponentName
        ? `<div style="font-size:.7rem;color:var(--muted);margin-top:.15rem;max-width:72px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${_esc(r.opponentName)}">${_esc(r.opponentName)}</div>`
        : '';
    const diceHtml = r.wonDice === true
        ? `<span title="Won dice" style="font-size:1rem;">🎲</span>`
        : (r.wonDice === false ? `<span title="Lost dice" style="font-size:1rem;opacity:.35;">🎲</span>` : '—');
    const orderHtml = r.wentFirst === true
        ? `<span style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;background:#0d6efd;color:#fff;border-radius:4px;font-size:.75rem;font-weight:700;">1</span>`
        : (r.wentFirst === false ? `<span style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;background:#6c757d;color:#fff;border-radius:4px;font-size:.75rem;font-weight:700;">2</span>` : '—');
    const resultHtml = r.won === true
        ? `<span style="color:var(--win,#28a745);font-size:1.1rem;">✅</span>`
        : (r.won === false ? `<span style="color:var(--loss,#dc3545);font-size:1.1rem;">❌</span>` : '—');
    const rowBg = r.won === true ? 'rgba(40,167,69,.06)' : (r.won === false ? 'rgba(220,53,69,.06)' : '');

    return `<tr style="background:${rowBg};">
        <td style="padding:.3rem .4rem;"><strong style="color:${r.won === true ? 'var(--win,#28a745)' : (r.won === false ? 'var(--loss,#dc3545)' : 'var(--muted)')};">${num}</strong>${topCutBadge}</td>
        <td style="padding:.3rem .4rem;">${oppImg}${oppNameHtml}</td>
        <td style="text-align:center;padding:.3rem .4rem;">${diceHtml}</td>
        <td style="text-align:center;padding:.3rem .4rem;">${orderHtml}</td>
        <td style="text-align:center;padding:.3rem .4rem;">${resultHtml}</td>
    </tr>`;
}

// ── Create Tournament Modal ────────────────────────────────────────────────────

function _mlCreateModalHtml() {
    const setOpts = ML_SETS.map(s => `<option value="${s}">${s}</option>`).join('');
    const typeOpts = ML_TYPES.map(t => `<option value="${t}">${t}</option>`).join('');
    return `
    <div id="mlCreateModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:3000;overflow-y:auto;" onclick="if(event.target===this)closeCreateMatchModal()">
        <div style="background:var(--card,#fff);border-radius:12px;max-width:480px;margin:2rem auto;padding:0;overflow:hidden;">
            <button onclick="closeCreateMatchModal()" style="display:block;width:100%;background:#1a1a2e;color:#fff;border:none;padding:.85rem;font-size:.95rem;font-weight:600;cursor:pointer;">Cancel</button>
            <div style="padding:1.5rem 1.75rem 1.75rem;">
                <div style="margin-bottom:1.1rem;">
                    <label style="display:block;font-weight:700;margin-bottom:.45rem;">Tournament Name</label>
                    <input id="mlTournamentName" type="text" style="width:100%;box-sizing:border-box;padding:.55rem .75rem;border:1.5px solid var(--border,#dee2e6);border-radius:8px;font-size:.9rem;background:var(--bg,#f8f9fa);color:var(--text,#1a1a2e);" placeholder="e.g. Treasure Cup April">
                    <div id="mlUnlinkChip" style="display:none;margin-top:.4rem;"></div>
                </div>
                <div style="margin-bottom:1.1rem;">
                    <label style="display:block;font-weight:700;margin-bottom:.45rem;">Deck</label>
                    ${_mlLeaderSelectHtml('mlCreateLeaderId')}
                </div>
                <div style="margin-bottom:1.1rem;">
                    <label style="display:block;font-weight:700;margin-bottom:.45rem;">Date</label>
                    <input id="mlTournamentDate" type="date" style="padding:.55rem .75rem;border:1.5px solid var(--border,#dee2e6);border-radius:8px;font-size:.9rem;background:var(--bg,#f8f9fa);color:var(--text,#1a1a2e);" oninput="_mlOnDateChange(this.value)">
                    <div id="mlEventSuggestions" style="display:none;margin-top:.6rem;"></div>
                </div>
                <div style="margin-bottom:1.1rem;">
                    <label style="display:block;font-weight:700;margin-bottom:.45rem;">Set <span style="font-weight:400;color:var(--muted);">(optional)</span></label>
                    <select id="mlTournamentSet" style="padding:.55rem .75rem;border:1.5px solid var(--border,#dee2e6);border-radius:8px;font-size:.9rem;background:var(--bg,#f8f9fa);color:var(--text,#1a1a2e);min-width:100px;">
                        <option value=""></option>
                        ${setOpts}
                    </select>
                </div>
                <div style="margin-bottom:1.5rem;">
                    <label style="display:block;font-weight:700;margin-bottom:.45rem;">Tournament Type <span style="font-weight:400;color:var(--muted);">(optional)</span></label>
                    <select id="mlTournamentType" style="padding:.55rem .75rem;border:1.5px solid var(--border,#dee2e6);border-radius:8px;font-size:.9rem;background:var(--bg,#f8f9fa);color:var(--text,#1a1a2e);min-width:160px;">
                        <option value=""></option>
                        ${typeOpts}
                    </select>
                </div>
                <button onclick="submitCreateMatch()" style="display:block;width:100%;background:#6c757d;color:#fff;border:none;border-radius:8px;padding:.75rem;font-size:.95rem;font-weight:600;cursor:pointer;">Add tournament</button>
            </div>
        </div>
    </div>`;
}

function openCreateMatchModal() {
    _mlPendingBandaiEventId = null;
    document.getElementById('mlCreateModal').style.display = '';
    document.getElementById('mlTournamentName').value = '';
    document.getElementById('mlTournamentDate').value = new Date().toISOString().slice(0, 10);
    document.getElementById('mlTournamentSet').value  = '';
    document.getElementById('mlTournamentType').value = '';
    document.getElementById('mlCreateLeaderId').value = '';
    const sugg = document.getElementById('mlEventSuggestions');
    sugg.style.display = 'none'; sugg.innerHTML = '';
    const chip = document.getElementById('mlUnlinkChip');
    chip.style.display = 'none'; chip.innerHTML = '';
}

function closeCreateMatchModal() {
    document.getElementById('mlCreateModal').style.display = 'none';
}

async function _mlOnDateChange(dateVal) {
    const sugg = document.getElementById('mlEventSuggestions');
    const chip = document.getElementById('mlUnlinkChip');
    if (!sugg) return;
    sugg.style.display = 'none';
    sugg.innerHTML = '';

    const user = await _authUserPromise;
    if (document.getElementById('mlTournamentDate')?.value !== dateVal) return; // race guard

    if (!user?.bandaiName) return;
    const me = (App.usersWithToken || []).find(u => u.name.toLowerCase() === user.bandaiName.toLowerCase());
    if (!me?.bandaiId) {
        sugg.innerHTML = `<p style="font-size:.8rem;color:var(--muted);margin:.2rem 0;">Cache não encontrado. <a href="#" onclick="switchTab('my-stats');closeCreateMatchModal();return false;" style="color:var(--accent,#048A81);">Vá a My Stats</a> para carregar seus eventos.</p>`;
        sugg.style.display = '';
        return;
    }
    const cache = loadCache(me.bandaiId);
    const matches = Object.values(cache).filter(e => (e._start_datetime || '').slice(0, 10) === dateVal);
    if (!matches.length) return;

    sugg.innerHTML = `<p style="font-size:.78rem;font-weight:600;color:var(--muted);margin:0 0 .4rem;">Eventos nessa data:</p>` +
        matches.map(e => {
            const label = _esc(e._event_name || e._store_name || e.id || 'Evento desconhecido');
            return `<button type="button" onclick="_mlSelectSuggestion(${JSON.stringify(String(e.id || ''))}, ${JSON.stringify(label)})"
                style="display:block;width:100%;text-align:left;margin-bottom:.3rem;padding:.4rem .65rem;border:1.5px solid var(--accent,#048A81);border-radius:7px;background:rgba(4,138,129,.07);color:var(--text,#1a1a2e);font-size:.83rem;cursor:pointer;">${label}</button>`;
        }).join('');
    sugg.style.display = '';
}

function _mlSelectSuggestion(eventId, eventName) {
    _mlPendingBandaiEventId = eventId;
    const nameEl = document.getElementById('mlTournamentName');
    if (nameEl && !nameEl.value.trim()) nameEl.value = eventName;
    const sugg = document.getElementById('mlEventSuggestions');
    sugg.style.display = 'none';
    sugg.innerHTML = '';
    const chip = document.getElementById('mlUnlinkChip');
    chip.innerHTML = `<span style="display:inline-flex;align-items:center;gap:.4rem;padding:.28rem .6rem;background:rgba(4,138,129,.12);border:1px solid var(--accent,#048A81);border-radius:20px;font-size:.78rem;color:var(--accent,#048A81);">
        &#128279; Vinculado: <strong>${_esc(eventName)}</strong>
        <button type="button" onclick="_mlUnlinkEvent()" style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:.95rem;line-height:1;padding:0 0 0 .15rem;">&#x2715;</button>
    </span>`;
    chip.style.display = '';
}

function _mlUnlinkEvent() {
    _mlPendingBandaiEventId = null;
    const chip = document.getElementById('mlUnlinkChip');
    chip.style.display = 'none';
    chip.innerHTML = '';
}

async function submitCreateMatch() {
    const name     = document.getElementById('mlTournamentName').value.trim();
    const date     = document.getElementById('mlTournamentDate').value;
    const set      = document.getElementById('mlTournamentSet').value  || null;
    const type     = document.getElementById('mlTournamentType').value || null;
    const leaderId = document.getElementById('mlCreateLeaderId').value || null;
    if (!name || !date) { alert('Tournament Name and Date are required.'); return; }
    try {
        const r = await fetch(`${AUTH_BASE}/my-matches`, {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, leaderId, date, set, type, bandaiEventId: _mlPendingBandaiEventId || null }),
        });
        if (!r.ok) throw new Error(await r.text());
        const m = await r.json();
        _mlMatches.unshift(m);
        _mlPendingBandaiEventId = null;
        closeCreateMatchModal();
        _renderMatchList();
    } catch (e) { alert('Erro: ' + e.message); }
}

// ── Add Round — Step 1 (type picker) ──────────────────────────────────────────

function _mlRoundTypeModalHtml() {
    return `
    <div id="mlRoundTypeModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:3001;display:none;" onclick="if(event.target===this)closeRoundTypeModal()">
        <div style="background:var(--card,#fff);border-radius:12px;max-width:420px;margin:4rem auto;padding:1.5rem 1.75rem;position:relative;">
            <button onclick="closeRoundTypeModal()" style="position:absolute;top:.75rem;right:.9rem;background:none;border:none;font-size:1.2rem;cursor:pointer;color:var(--muted);">✕</button>
            <h3 id="mlRoundTypeTitle" style="margin:0 0 1.25rem;font-size:1.05rem;">Round 1</h3>
            <p style="font-weight:600;margin:0 0 1rem;font-size:.9rem;">What type of round?</p>
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:.75rem;">
                <button onclick="selectRoundType('bye')"    class="ml-type-btn">⏸️<br>Bye</button>
                <button onclick="selectRoundType('swiss')"  class="ml-type-btn">🔄<br>Swiss</button>
                <button onclick="selectRoundType('topcut')" class="ml-type-btn">🏆<br>Top Cut</button>
            </div>
        </div>
    </div>
    <style>
    .ml-type-btn{background:var(--bg,#f8f9fa);border:1.5px solid var(--border,#dee2e6);border-radius:10px;padding:.9rem .5rem;font-size:.9rem;cursor:pointer;transition:background .15s,border-color .15s;}
    .ml-type-btn:hover{background:rgba(4,138,129,.08);border-color:var(--accent,#048A81);}
    </style>`;
}

function openAddRoundModal(matchId) {
    _mlRoundCtx = { matchId };
    const m = _mlMatches.find(x => x.id === matchId);
    const roundNum = (m?.rounds?.length ?? 0) + 1;
    document.getElementById('mlRoundTypeTitle').textContent = `Round ${roundNum}`;
    const modal = document.getElementById('mlRoundTypeModal');
    modal.style.display = '';
}

function closeRoundTypeModal() {
    document.getElementById('mlRoundTypeModal').style.display = 'none';
}

function selectRoundType(type) {
    closeRoundTypeModal();
    if (type === 'bye') {
        _submitBye();
    } else {
        _mlRoundCtx.type = type;
        openRoundDetailModal();
    }
}

async function _submitBye() {
    if (!_mlRoundCtx) return;
    const { matchId } = _mlRoundCtx;
    const m = _mlMatches.find(x => x.id === matchId);
    if (!m) return;
    const rounds = [...m.rounds, { type: 'bye' }];
    await _mlSaveRounds(matchId, rounds);
}

// ── Add Round — Step 2 (round details) ────────────────────────────────────────

function _mlRoundDetailModalHtml() {
    return `
    <div id="mlRoundDetailModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:3002;" onclick="if(event.target===this)closeRoundDetailModal()">
        <div style="background:var(--card,#fff);border-radius:12px;max-width:420px;margin:3rem auto;padding:1.5rem 1.75rem;position:relative;">
            <button onclick="closeRoundDetailModal()" style="position:absolute;top:.75rem;right:.9rem;background:none;border:none;font-size:1.2rem;cursor:pointer;color:var(--muted);">✕</button>
            <h3 id="mlRoundDetailTitle" style="margin:0 0 1.25rem;font-size:1.05rem;">Round 1 – Swiss</h3>
            <div style="margin-bottom:1rem;">
                <label style="display:block;font-weight:700;margin-bottom:.45rem;">Opponent Leader</label>
                ${_mlLeaderSelectHtml('mlRoundOppLeaderId')}
            </div>
            <div style="margin-bottom:1rem;">
                <label style="display:block;font-weight:700;margin-bottom:.45rem;">Opponent Name <span style="font-weight:400;color:var(--muted);font-size:.8rem;">(optional)</span></label>
                <div style="position:relative;">
                    <input id="mlRoundOppName" type="text" style="width:100%;box-sizing:border-box;padding:.55rem .75rem;border:1.5px solid var(--border,#dee2e6);border-radius:8px;font-size:.9rem;background:var(--bg,#f8f9fa);color:var(--text,#1a1a2e);" placeholder="e.g. João Silva">
                    <span id="mlOppNameHint" style="display:none;position:absolute;right:.6rem;top:50%;transform:translateY(-50%);font-size:.68rem;color:var(--accent,#048A81);pointer-events:none;">&#128279; Bandai</span>
                </div>
            </div>
            <div style="margin-bottom:.75rem;">
                <button id="mlDiceBtn" onclick="mlToggle('dice')" class="ml-toggle-btn ml-toggle-lost" style="width:100%;">🎲 &nbsp;Lost Dice</button>
            </div>
            <div style="margin-bottom:.75rem;">
                <button id="mlOrderBtn" onclick="mlToggle('order')" class="ml-toggle-btn ml-toggle-second" style="width:100%;">2 &nbsp;Went Second</button>
            </div>
            <div style="margin-bottom:1.25rem;">
                <button id="mlResultBtn" onclick="mlToggle('result')" class="ml-toggle-btn ml-toggle-lost" style="width:100%;">✕ &nbsp;Lost Match</button>
            </div>
            <button onclick="submitAddRound()" style="display:block;width:100%;background:#6c757d;color:#fff;border:none;border-radius:8px;padding:.75rem;font-size:.95rem;font-weight:600;cursor:pointer;">Add Round</button>
        </div>
    </div>
    <style>
    .ml-toggle-btn{border:none;border-radius:8px;padding:.65rem 1rem;font-size:.9rem;font-weight:600;cursor:pointer;text-align:center;transition:background .15s;}
    .ml-toggle-won   {background:rgba(40,167,69,.12);color:var(--win,#28a745);}
    .ml-toggle-lost  {background:rgba(220,53,69,.10);color:var(--loss,#dc3545);}
    .ml-toggle-first {background:rgba(13,110,253,.12);color:#0d6efd;}
    .ml-toggle-second{background:rgba(108,117,125,.12);color:#6c757d;}
    </style>`;
}

// Toggle state stored on button data attrs
function mlToggle(which) {
    if (which === 'dice') {
        const btn = document.getElementById('mlDiceBtn');
        const won = btn.dataset.won !== '1';
        btn.dataset.won = won ? '1' : '0';
        btn.className   = 'ml-toggle-btn ' + (won ? 'ml-toggle-won' : 'ml-toggle-lost');
        btn.innerHTML   = won ? '🎲 &nbsp;Won Dice' : '🎲 &nbsp;Lost Dice';
    } else if (which === 'order') {
        const btn   = document.getElementById('mlOrderBtn');
        const first = btn.dataset.first !== '1';
        btn.dataset.first = first ? '1' : '0';
        btn.className     = 'ml-toggle-btn ' + (first ? 'ml-toggle-first' : 'ml-toggle-second');
        btn.innerHTML     = first ? '1 &nbsp;Went First' : '2 &nbsp;Went Second';
    } else if (which === 'result') {
        const btn = document.getElementById('mlResultBtn');
        const won = btn.dataset.won !== '1';
        btn.dataset.won = won ? '1' : '0';
        btn.className   = 'ml-toggle-btn ' + (won ? 'ml-toggle-won' : 'ml-toggle-lost');
        btn.innerHTML   = won ? '✔ &nbsp;Won Match' : '✕ &nbsp;Lost Match';
    }
}

async function openRoundDetailModal() {
    if (!_mlRoundCtx) return;
    const { matchId, type } = _mlRoundCtx;
    const m = _mlMatches.find(x => x.id === matchId);
    const roundNum = (m?.rounds?.length ?? 0) + 1;
    const label = type === 'topcut' ? 'Top Cut' : 'Swiss';
    document.getElementById('mlRoundDetailTitle').textContent = `Round ${roundNum} – ${label}`;
    // reset toggles
    const diceBtn   = document.getElementById('mlDiceBtn');
    const orderBtn  = document.getElementById('mlOrderBtn');
    const resultBtn = document.getElementById('mlResultBtn');
    diceBtn.dataset.won     = '0'; diceBtn.className   = 'ml-toggle-btn ml-toggle-lost';   diceBtn.innerHTML   = '🎲 &nbsp;Lost Dice';
    orderBtn.dataset.first  = '0'; orderBtn.className  = 'ml-toggle-btn ml-toggle-second'; orderBtn.innerHTML  = '2 &nbsp;Went Second';
    resultBtn.dataset.won   = '0'; resultBtn.className = 'ml-toggle-btn ml-toggle-lost';   resultBtn.innerHTML = '✕ &nbsp;Lost Match';
    document.getElementById('mlRoundOppLeaderId').value = '';
    document.getElementById('mlRoundOppName').value = '';
    document.getElementById('mlOppNameHint').style.display = 'none';

    // Auto-suggest opponent name + result from Bandai cache
    if (m?.bandaiEventId) {
        try {
            const user = await _authUserPromise;
            const me   = (App.usersWithToken || []).find(u => u.name.toLowerCase() === (user?.bandaiName || '').toLowerCase());
            if (me?.bandaiId) {
                const cache      = loadCache(me.bandaiId);
                const eventData  = cache[String(m.bandaiEventId)];
                const bandaiRound = eventData?.rounds?.[roundNum - 1];
                if (bandaiRound) {
                    const oppName = bandaiRound.opponent_users?.[0]?.player_name?.trim();
                    if (oppName) {
                        document.getElementById('mlRoundOppName').value = oppName;
                        document.getElementById('mlOppNameHint').style.display = '';
                    }
                    if (bandaiRound.is_win != null) {
                        const won = !!bandaiRound.is_win;
                        resultBtn.dataset.won = won ? '1' : '0';
                        resultBtn.className   = 'ml-toggle-btn ' + (won ? 'ml-toggle-won' : 'ml-toggle-lost');
                        resultBtn.innerHTML   = won ? '✔ &nbsp;Won Match' : '✕ &nbsp;Lost Match';
                    }
                }
            }
        } catch { /* silently skip if cache unavailable */ }
    }

    document.getElementById('mlRoundDetailModal').style.display = '';
}

function closeRoundDetailModal() {
    document.getElementById('mlRoundDetailModal').style.display = 'none';
}

async function submitAddRound() {
    if (!_mlRoundCtx) return;
    const { matchId, type } = _mlRoundCtx;
    const m = _mlMatches.find(x => x.id === matchId);
    if (!m) return;
    const opponentLeaderId = document.getElementById('mlRoundOppLeaderId').value || null;
    const opponentName     = document.getElementById('mlRoundOppName').value.trim() || null;
    const wonDice   = document.getElementById('mlDiceBtn').dataset.won   === '1';
    const wentFirst = document.getElementById('mlOrderBtn').dataset.first === '1';
    const won       = document.getElementById('mlResultBtn').dataset.won  === '1';
    const round = { type, opponentLeaderId, opponentName, wonDice, wentFirst, won };
    const rounds = [...m.rounds, round];
    closeRoundDetailModal();
    await _mlSaveRounds(matchId, rounds);
}

async function _mlSaveRounds(matchId, rounds) {
    try {
        const r = await fetch(`${AUTH_BASE}/my-matches/${matchId}`, {
            method: 'PUT', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rounds }),
        });
        if (!r.ok) throw new Error(await r.text());
        const updated = await r.json();
        const idx = _mlMatches.findIndex(m => m.id === matchId);
        if (idx !== -1) _mlMatches[idx] = updated;
        _renderMatchList();
    } catch (e) { alert('Erro ao salvar round: ' + e.message); }
}

// ── Delete ─────────────────────────────────────────────────────────────────────

async function toggleCloseMatch(matchId) {
    const m = _mlMatches.find(x => x.id === matchId);
    if (!m) return;
    const closed = !m.closed;
    try {
        const r = await fetch(`${AUTH_BASE}/my-matches/${matchId}`, {
            method: 'PUT', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ closed }),
        });
        if (!r.ok) throw new Error(await r.text());
        m.closed = closed;
        _renderMatchList();
    } catch (e) { alert('Erro: ' + e.message); }
}

async function deleteMatch(matchId) {
    if (!confirm('Remover este torneio do histórico?')) return;
    try {
        const r = await fetch(`${AUTH_BASE}/my-matches/${matchId}`, { method: 'DELETE', credentials: 'include' });
        if (!r.ok) throw new Error(await r.text());
        _mlMatches = _mlMatches.filter(m => m.id !== matchId);
        _renderMatchList();
    } catch (e) { alert('Erro: ' + e.message); }
}

// ── Leader Select (reuses TRN_LEADERS from tournaments.js) ────────────────────

function _mlLeaderSelectHtml(id) {
    const opts = TRN_LEADERS.map(l =>
        `<option value="${l.id}">${l.id} · ${l.name}</option>`
    ).join('');
    return `<select id="${id}" style="width:100%;padding:.55rem .75rem;border:1.5px solid var(--border,#dee2e6);border-radius:8px;font-size:.9rem;background:var(--bg,#f8f9fa);color:var(--text,#1a1a2e);">
        <option value="">— líder —</option>${opts}
    </select>`;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function _mlScore(rounds) {
    let w = 0, l = 0;
    for (const r of (rounds || [])) {
        if (r.type === 'bye') continue;
        if (r.won === true)  w++;
        if (r.won === false) l++;
    }
    return { w, l };
}

function _mlTypeShort(type) {
    const map = { 'Store CS': 'CS', 'Treasure Cup': 'TC', 'Flagship': 'FLAG', 'Regional': 'REG', 'National': 'NAT', 'World': 'WLD' };
    return map[type] || type?.slice(0, 5).toUpperCase() || '?';
}

function _esc(str) {
    return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

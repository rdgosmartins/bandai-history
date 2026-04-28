// ── Match Tracker ─────────────────────────────────────────────────────────────
// Requires: auth.js (AUTH_BASE), tournaments.js (TRN_LEADERS, _leaderImgUrl)

const ML_SETS = ['OP15','OP14','EB04','OP13','EB03','OP12','EB02','OP11','EB01',
                 'OP10','OP09','OP08','OP07','OP06','OP05','OP04','OP03','OP02','OP01'];
const ML_TYPES = ['Testing','Local','Store CS','Treasure Cup','Flagship','Regional','National','World'];

let _mlMatches   = [];   // cached list
let _mlRoundCtx  = null; // { matchId, type } while the round detail modal is open

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
        const r = await fetch(`${AUTH_BASE}/my-matches`, { credentials: 'include' });
        _mlMatches = r.ok ? await r.json() : [];
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
    el.innerHTML = _mlMatches.map(m => _mlCardHtml(m)).join('');
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

    return `
    <div class="card" style="margin-bottom:1rem;">
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
                        <strong style="font-size:.97rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${_esc(m.name)}</strong>
                        <button class="btn btn-outline btn-sm" style="font-size:.7rem;padding:.18rem .45rem;flex-shrink:0;color:var(--loss,#dc3545);border-color:var(--loss,#dc3545);"
                            onclick="deleteMatch('${m.id}')">&#128465;</button>
                    </div>
                    <div style="font-size:.77rem;color:var(--muted);margin:.15rem 0 .35rem;">${m.date}${tags ? ' &nbsp;' + tags : ''}</div>
                    ${roundsHtml}
                </div>
            </div>
            <button class="btn btn-outline btn-sm" style="margin-top:.75rem;width:100%;" onclick="openAddRoundModal('${m.id}')">+ Add round</button>
        </div>
    </div>`;
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
        <td style="padding:.3rem .4rem;">${oppImg}</td>
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
                </div>
                <div style="margin-bottom:1.1rem;">
                    <label style="display:block;font-weight:700;margin-bottom:.2rem;">Deck</label>
                    <p style="margin:0 0 .4rem;font-size:.78rem;color:var(--muted);">e.g. Donquixote Doflamingo (OP04)</p>
                    ${_mlLeaderPickerHtml('mlCreateLeader')}
                </div>
                <div style="margin-bottom:1.1rem;">
                    <label style="display:block;font-weight:700;margin-bottom:.45rem;">Date</label>
                    <input id="mlTournamentDate" type="date" style="padding:.55rem .75rem;border:1.5px solid var(--border,#dee2e6);border-radius:8px;font-size:.9rem;background:var(--bg,#f8f9fa);color:var(--text,#1a1a2e);">
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
    document.getElementById('mlCreateModal').style.display = '';
    document.getElementById('mlTournamentName').value = '';
    document.getElementById('mlTournamentDate').value = new Date().toISOString().slice(0, 10);
    document.getElementById('mlTournamentSet').value  = '';
    document.getElementById('mlTournamentType').value = '';
    _mlResetLeaderPicker('mlCreateLeader');
}

function closeCreateMatchModal() {
    document.getElementById('mlCreateModal').style.display = 'none';
}

async function submitCreateMatch() {
    const name     = document.getElementById('mlTournamentName').value.trim();
    const date     = document.getElementById('mlTournamentDate').value;
    const set      = document.getElementById('mlTournamentSet').value  || null;
    const type     = document.getElementById('mlTournamentType').value || null;
    const leaderId = document.getElementById('mlCreateLeader_hidden')?.value || null;
    if (!name || !date) { alert('Tournament Name and Date are required.'); return; }
    try {
        const r = await fetch(`${AUTH_BASE}/my-matches`, {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, leaderId, date, set, type }),
        });
        if (!r.ok) throw new Error(await r.text());
        const m = await r.json();
        _mlMatches.unshift(m);
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
                <label style="display:block;font-weight:700;margin-bottom:.2rem;">Opponent Leader</label>
                <p style="margin:0 0 .4rem;font-size:.78rem;color:var(--muted);">e.g. Donquixote Doflamingo (OP04)</p>
                ${_mlLeaderPickerHtml('mlRoundOppLeader')}
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

function openRoundDetailModal() {
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
    _mlResetLeaderPicker('mlRoundOppLeader');
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
    const opponentLeaderId = document.getElementById('mlRoundOppLeader_hidden')?.value || null;
    const wonDice   = document.getElementById('mlDiceBtn').dataset.won   === '1';
    const wentFirst = document.getElementById('mlOrderBtn').dataset.first === '1';
    const won       = document.getElementById('mlResultBtn').dataset.won  === '1';
    const round = { type, opponentLeaderId, wonDice, wentFirst, won };
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

async function deleteMatch(matchId) {
    if (!confirm('Remover este torneio do histórico?')) return;
    try {
        const r = await fetch(`${AUTH_BASE}/my-matches/${matchId}`, { method: 'DELETE', credentials: 'include' });
        if (!r.ok) throw new Error(await r.text());
        _mlMatches = _mlMatches.filter(m => m.id !== matchId);
        _renderMatchList();
    } catch (e) { alert('Erro: ' + e.message); }
}

// ── Leader Picker (search-as-you-type over TRN_LEADERS) ───────────────────────

function _mlLeaderPickerHtml(prefix) {
    return `
    <div style="position:relative;" id="${prefix}_container">
        <input id="${prefix}_input" type="text" autocomplete="off"
            style="width:100%;box-sizing:border-box;padding:.55rem 2rem .55rem .75rem;border:1.5px solid var(--border,#dee2e6);border-radius:8px;font-size:.9rem;background:var(--bg,#f8f9fa);color:var(--text,#1a1a2e);"
            placeholder="Search leader…"
            oninput="_mlLeaderSearch('${prefix}')"
            onfocus="_mlLeaderSearch('${prefix}')"
            onblur="setTimeout(()=>_mlLeaderHide('${prefix}'),180)">
        <span style="position:absolute;right:.65rem;top:50%;transform:translateY(-50%);pointer-events:none;color:var(--muted);">▼</span>
        <input type="hidden" id="${prefix}_hidden">
        <div id="${prefix}_dropdown" style="display:none;position:absolute;z-index:100;left:0;right:0;top:calc(100% + 2px);max-height:220px;overflow-y:auto;background:var(--card,#fff);border:1.5px solid var(--border,#dee2e6);border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,.12);">
        </div>
    </div>`;
}

function _mlLeaderSearch(prefix) {
    const q = (document.getElementById(prefix + '_input')?.value || '').toLowerCase();
    const dd = document.getElementById(prefix + '_dropdown');
    if (!dd) return;
    const filtered = TRN_LEADERS.filter(l =>
        l.name.toLowerCase().includes(q) || l.id.toLowerCase().includes(q)
    ).slice(0, 40);
    if (filtered.length === 0) { dd.style.display = 'none'; return; }
    dd.innerHTML = filtered.map(l => `
        <div onclick="_mlLeaderSelect('${prefix}','${l.id}','${_esc(l.name)}')"
            style="display:flex;align-items:center;gap:.5rem;padding:.42rem .7rem;cursor:pointer;font-size:.87rem;"
            onmouseover="this.style.background='var(--bg,#f8f9fa)'"
            onmouseout="this.style.background=''">
            <img src="${_leaderImgUrl(l.id)}" style="width:28px;height:28px;object-fit:cover;border-radius:3px;flex-shrink:0;" onerror="this.style.display='none'">
            <span>${_esc(l.name)} <span style="color:var(--muted);font-size:.78rem;">(${l.id.split('-')[0]})</span></span>
        </div>`).join('');
    dd.style.display = '';
}

function _mlLeaderSelect(prefix, id, name) {
    document.getElementById(prefix + '_input').value  = name;
    document.getElementById(prefix + '_hidden').value = id;
    document.getElementById(prefix + '_dropdown').style.display = 'none';
}

function _mlLeaderHide(prefix) {
    const dd = document.getElementById(prefix + '_dropdown');
    if (dd) dd.style.display = 'none';
}

function _mlResetLeaderPicker(prefix) {
    const inp = document.getElementById(prefix + '_input');
    const hid = document.getElementById(prefix + '_hidden');
    if (inp) inp.value = '';
    if (hid) hid.value = '';
    _mlLeaderHide(prefix);
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

// ── Deck Mapping ──────────────────────────────────────────────────────────────
// Requires: auth.js (AUTH_BASE), state.js (App.profileDirectory)
// Leaders: buscados de /cards.json (mesma base local usada pelo OPTCG Agent)

let DM_LEADERS        = [];   // [{id, n, c, s, pw, lf, at, st}] — filtrado de cards.json (t === 'Leader')
let DM_LEADERS_LOADED = false;
let DM_STORES         = [];
let _dmEntries         = [];  // entries sendo montadas no modal de criação/edição
let _dmSearchResults   = {};
let _dmEditingId        = null;
let _dmEvents          = [];  // cache de todos os deckmaps carregados
let _dmFilters          = { storeId: '', set: '', dateFrom: '', dateTo: '', format: '' };
let _dmDetailId         = null;

// ── Leaders (via API local) ─────────────────────────────────────────────────────

async function _dmLoadLeaders() {
    if (DM_LEADERS_LOADED) return;
    try {
        const r = await fetch('/cards.json');
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const all = await r.json();
        DM_LEADERS = all.filter(c => c.t === 'Leader').sort((a, b) => (a.n || '').localeCompare(b.n || ''));
        DM_LEADERS_LOADED = true;
    } catch (e) {
        console.warn('[DeckMap] Falha ao carregar Leaders de /cards.json', e);
        DM_LEADERS = [];
    }
}

function _dmLeaderImgUrl(id) { return id ? `https://optcgapi.com/media/static/Card_Images/${id}.jpg` : ''; }

function _dmLeaderById(id) { return DM_LEADERS.find(l => l.id === id); }

function _dmLeaderName(id) {
    if (!id) return '';
    const l = _dmLeaderById(id);
    return l ? `${l.n} (${id})` : id;
}

function _dmLeaderSet(id) {
    const l = _dmLeaderById(id);
    return l?.s || (id ? id.split('-')[0] : '');
}

// ── Top-level tab ─────────────────────────────────────────────────────────────

async function loadDeckMapTab() {
    const isAdmin = document.getElementById('createTournamentBtn')?.style.display !== 'none';
    document.getElementById('dmAdminControls').style.display = isAdmin ? '' : 'none';

    await _dmLoadLeaders();
    await Promise.all([_dmLoadStores(), _dmLoadEvents()]);
    _dmPopulateFilterOptions();
    _dmRenderStats();
    _dmRenderEventList();
}

function switchDmView(view) {
    document.getElementById('dmListView').style.display   = view === 'list'   ? '' : 'none';
    document.getElementById('dmDetailView').style.display  = view === 'detail' ? '' : 'none';
}

// ── Stores CRUD ───────────────────────────────────────────────────────────────

async function _dmLoadStores() {
    try {
        const r = await apiFetch(`/stores`);
        if (!r.ok) throw new Error();
        DM_STORES = await r.json();
    } catch {
        DM_STORES = [];
    }
}

function _dmPopulateStoreSelect(selectId, placeholder) {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = `<option value="">${placeholder}</option>` +
        DM_STORES.map(s => `<option value="${_dmEsc(s.id)}">${_dmEsc(s.name)}${s.city ? ' — ' + _dmEsc(s.city) : ''}</option>`).join('');
    if (current) sel.value = current;
}

function openManageStoresModal() {
    _dmRenderStoreList();
    document.getElementById('dmStoreModal').style.display = 'flex';
}
function closeManageStoresModal(e, force = false) {
    if (!force && e && !e.target.classList.contains('modal-overlay')) return;
    document.getElementById('dmStoreModal').style.display = 'none';
}

function _dmRenderStoreList() {
    const el = document.getElementById('dmStoreList');
    if (!DM_STORES.length) { el.innerHTML = '<p style="color:var(--muted);font-size:.85rem;text-align:center;padding:1rem 0;">Nenhuma loja cadastrada.</p>'; return; }
    el.innerHTML = DM_STORES.map(s => `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:.5rem;padding:.5rem .25rem;border-bottom:1px solid var(--border);">
            <div>
                <strong style="font-size:.85rem;">${_dmEsc(s.name)}</strong>
                ${s.city ? `<span style="font-size:.78rem;color:var(--muted);margin-left:.4rem;">${_dmEsc(s.city)}</span>` : ''}
            </div>
            <button class="btn btn-outline btn-sm" style="padding:.25rem .6rem;" onclick="_dmDeleteStore('${s.id}')">&#128465;</button>
        </div>`).join('');
}

async function addStore() {
    const name = document.getElementById('dmNewStoreName').value.trim();
    const city = document.getElementById('dmNewStoreCity').value.trim();
    if (!name) return;
    try {
        const r = await fetch(`${AUTH_BASE}/stores`, {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, city: city || null }),
        });
        if (!r.ok) { alert('Erro ao criar loja.'); return; }
        document.getElementById('dmNewStoreName').value = '';
        document.getElementById('dmNewStoreCity').value = '';
        await _dmLoadStores();
        _dmRenderStoreList();
        _dmPopulateFilterOptions();
        _dmPopulateStoreSelect('dmStoreId', '— selecione a loja —');
    } catch { alert('Erro de rede.'); }
}

async function _dmDeleteStore(id) {
    if (!confirm('Remover esta loja? Eventos já registrados manterão o ID, mas o nome não será mais exibido.')) return;
    try {
        const r = await apiFetch(`/stores/${id}`, { method: 'DELETE' });
        if (!r.ok) { alert('Erro ao remover.'); return; }
        await _dmLoadStores();
        _dmRenderStoreList();
        _dmPopulateFilterOptions();
    } catch { alert('Erro de rede.'); }
}

function _dmStoreName(id) {
    const s = DM_STORES.find(x => x.id === id);
    return s ? s.name : (id || '—');
}

// ── Events (deckmaps) CRUD ───────────────────────────────────────────────────

async function _dmLoadEvents() {
    try {
        const r = await apiFetch(`/deckmaps`);
        if (!r.ok) throw new Error();
        _dmEvents = await r.json();
    } catch {
        _dmEvents = [];
    }
}

function _dmPopulateFilterOptions() {
    _dmPopulateStoreSelect('dmFilterStore', 'Todas as lojas');

    const sets = [...new Set(DM_LEADERS.map(l => l.s).filter(Boolean))].sort();
    const setSel = document.getElementById('dmFilterSet');
    if (setSel) {
        const cur = setSel.value;
        setSel.innerHTML = '<option value="">Todas as coleções</option>' +
            sets.map(s => `<option value="${s}">${s}</option>`).join('');
        if (cur) setSel.value = cur;
    }

    const formats = [...new Set(_dmEvents.map(e => e.format).filter(Boolean))].sort();
    const fmtSel = document.getElementById('dmFilterFormat');
    if (fmtSel) {
        const cur = fmtSel.value;
        fmtSel.innerHTML = '<option value="">Todos os formatos</option>' +
            formats.map(f => `<option value="${_dmEsc(f)}">${_dmEsc(f)}</option>`).join('');
        if (cur) fmtSel.value = cur;
    }
}

function dmApplyFilters() {
    _dmFilters = {
        storeId:  document.getElementById('dmFilterStore').value,
        set:      document.getElementById('dmFilterSet').value,
        dateFrom: document.getElementById('dmFilterDateFrom').value,
        dateTo:   document.getElementById('dmFilterDateTo').value,
        format:   document.getElementById('dmFilterFormat').value,
    };
    _dmRenderStats();
    _dmRenderEventList();
}

function dmClearFilters() {
    document.getElementById('dmFilterStore').value    = '';
    document.getElementById('dmFilterSet').value      = '';
    document.getElementById('dmFilterDateFrom').value = '';
    document.getElementById('dmFilterDateTo').value   = '';
    document.getElementById('dmFilterFormat').value   = '';
    _dmFilters = { storeId: '', set: '', dateFrom: '', dateTo: '', format: '' };
    _dmRenderStats();
    _dmRenderEventList();
}

function _dmFilteredEntries() {
    // Retorna entries (com event anexado) que batem os filtros de evento.
    // Filtro de "set" é aplicado a nível de entry (leaderId pertence ao set).
    const f = _dmFilters;
    const out = [];
    for (const ev of _dmEvents) {
        if (f.storeId  && ev.storeId !== f.storeId)  continue;
        if (f.format   && ev.format  !== f.format)   continue;
        if (f.dateFrom && ev.date < f.dateFrom)      continue;
        if (f.dateTo   && ev.date > f.dateTo)        continue;
        for (const en of (ev.entries || [])) {
            if (!en.leaderId) continue;
            if (f.set && _dmLeaderSet(en.leaderId) !== f.set) continue;
            out.push({ ...en, event: ev });
        }
    }
    return out;
}

function _dmFilteredEvents() {
    const f = _dmFilters;
    return _dmEvents.filter(ev => {
        if (f.storeId  && ev.storeId !== f.storeId)  return false;
        if (f.format   && ev.format  !== f.format)   return false;
        if (f.dateFrom && ev.date < f.dateFrom)      return false;
        if (f.dateTo   && ev.date > f.dateTo)        return false;
        if (f.set) {
            const hasSet = (ev.entries || []).some(en => en.leaderId && _dmLeaderSet(en.leaderId) === f.set);
            if (!hasSet) return false;
        }
        return true;
    });
}

// ── Stats / meta ──────────────────────────────────────────────────────────────

function _dmRenderStats() {
    const entries = _dmFilteredEntries();
    const events   = _dmFilteredEvents();

    document.getElementById('dmStatEvents').textContent  = events.length;
    document.getElementById('dmStatPlayers').textContent = events.reduce((s, e) => s + (e.playerCount || e.entries?.length || 0), 0);
    document.getElementById('dmStatDecks').textContent   = entries.length;

    const leaderMap = {};
    for (const en of entries) {
        if (!leaderMap[en.leaderId]) leaderMap[en.leaderId] = 0;
        leaderMap[en.leaderId]++;
    }
    const sorted = Object.entries(leaderMap).sort((a, b) => b[1] - a[1]);
    const total  = entries.length || 1;

    const el = document.getElementById('dmMetaList');
    if (!sorted.length) {
        el.innerHTML = '<p style="color:var(--muted);text-align:center;padding:2rem 0;">Nenhum deck registrado com esses filtros.</p>';
        return;
    }
    el.innerHTML = sorted.map(([leaderId, count]) => {
        const l   = _dmLeaderById(leaderId);
        const pct = ((count / total) * 100).toFixed(1);
        return `
        <div style="display:flex;align-items:center;gap:.7rem;padding:.55rem 0;border-bottom:1px solid var(--border);cursor:pointer;" onclick="dmFilterByLeader('${leaderId}')">
            <img src="${_dmLeaderImgUrl(leaderId)}" alt="" style="width:42px;border-radius:5px;flex-shrink:0;" onerror="this.style.opacity='.15'">
            <div style="flex:1;min-width:0;">
                <div style="font-size:.85rem;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${_dmEsc(l ? l.n : leaderId)}</div>
                <div style="font-size:.72rem;color:var(--muted);">${leaderId} · ${l?.c || ''}</div>
            </div>
            <div style="text-align:right;flex-shrink:0;">
                <div style="font-size:.95rem;font-weight:700;color:var(--primary);">${count}</div>
                <div style="font-size:.7rem;color:var(--muted);">${pct}%</div>
            </div>
            <div style="width:60px;height:6px;background:var(--bg);border-radius:3px;overflow:hidden;flex-shrink:0;">
                <div style="width:${pct}%;height:100%;background:var(--gold);"></div>
            </div>
        </div>`;
    }).join('');
}

function dmFilterByLeader(leaderId) {
    // Abre a lista de decks dessa carta específica (todas as entries, sem filtro de set/loja extra)
    const entries = _dmFilteredEntries().filter(e => e.leaderId === leaderId);
    const l = _dmLeaderById(leaderId);
    document.getElementById('dmLeaderDecksTitle').textContent = `${l ? l.n : leaderId} — ${entries.length} deck${entries.length !== 1 ? 's' : ''}`;
    document.getElementById('dmLeaderDecksBody').innerHTML = entries.length
        ? entries.map(e => `
            <div style="display:flex;align-items:center;justify-content:space-between;padding:.45rem 0;border-bottom:1px solid var(--border);font-size:.82rem;">
                <span>${e.isGuest ? '&#128100;' : '&#127918;'} ${_dmEsc(e.playerName)}</span>
                <span style="color:var(--muted);">${_dmStoreName(e.event.storeId)} · ${e.event.date ? new Date(e.event.date + 'T12:00:00').toLocaleDateString('pt-BR') : '—'}</span>
            </div>`).join('')
        : '<p style="color:var(--muted);text-align:center;padding:1rem 0;">Nenhum deck.</p>';
    document.getElementById('dmLeaderDecksModal').style.display = 'flex';
}
function closeDmLeaderDecksModal(e, force = false) {
    if (!force && e && !e.target.classList.contains('modal-overlay')) return;
    document.getElementById('dmLeaderDecksModal').style.display = 'none';
}

// ── Event list ────────────────────────────────────────────────────────────────

function _dmRenderEventList() {
    const events = _dmFilteredEvents();
    const el = document.getElementById('dmEventList');
    if (!events.length) { el.innerHTML = '<p style="color:var(--muted);text-align:center;padding:2.5rem 0;">Nenhum evento registrado.</p>'; return; }
    const rows = events.map(ev => {
        const dateStr = ev.date ? new Date(ev.date + 'T12:00:00').toLocaleDateString('pt-BR') : '—';
        const n = ev.entries?.length || ev.playerCount || 0;
        return `<tr style="cursor:pointer;" onclick="openDmEventDetail('${ev.id}')">
            <td><strong>${_dmEsc(_dmStoreName(ev.storeId))}</strong></td>
            <td>${dateStr}</td>
            <td>${_dmEsc(ev.format)}</td>
            <td>${n} player${n !== 1 ? 's' : ''}</td>
        </tr>`;
    }).join('');
    el.innerHTML = `<div class="table-wrap"><table>
        <thead><tr><th>Loja</th><th>Data</th><th>Formato</th><th>Players</th></tr></thead>
        <tbody>${rows}</tbody>
    </table></div>`;
}

function openDmEventDetail(id) {
    const ev = _dmEvents.find(e => e.id === id);
    if (!ev) return;
    _dmDetailId = id;
    const isAdmin = document.getElementById('createTournamentBtn')?.style.display !== 'none';

    document.getElementById('dmDetailTitle').textContent =
        `${_dmStoreName(ev.storeId)} — ${ev.date ? new Date(ev.date + 'T12:00:00').toLocaleDateString('pt-BR') : '—'}`;
    document.getElementById('dmDetailSub').textContent =
        `${ev.format} · ${ev.entries?.length || 0} decks registrados`;
    document.getElementById('dmDetailAdminBtns').style.display = isAdmin ? '' : 'none';

    const rows = (ev.entries || []).map(en => `
        <tr>
            <td>${en.isGuest ? '&#128100;' : '&#127918;'} ${_dmEsc(en.playerName)}</td>
            <td>
                ${en.leaderId ? `<img src="${_dmLeaderImgUrl(en.leaderId)}" style="width:26px;border-radius:3px;vertical-align:middle;margin-right:.4rem;" onerror="this.style.display='none'">` : ''}
                ${_dmEsc(_dmLeaderName(en.leaderId) || '—')}
            </td>
        </tr>`).join('');
    document.getElementById('dmDetailTable').innerHTML = `<div class="table-wrap"><table>
        <thead><tr><th>Player</th><th>Leader</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="2" style="color:var(--muted);text-align:center;">Nenhum deck registrado.</td></tr>'}</tbody>
    </table></div>`;

    switchDmView('detail');
}

function backToDmList() { switchDmView('list'); }

async function deleteDmEvent() {
    if (!_dmDetailId) return;
    if (!confirm('Excluir este evento e todos os decks registrados?')) return;
    try {
        const r = await apiFetch(`/deckmaps/${_dmDetailId}`, { method: 'DELETE' });
        if (!r.ok) { alert('Erro ao excluir.'); return; }
        await _dmLoadEvents();
        _dmPopulateFilterOptions();
        _dmRenderStats();
        _dmRenderEventList();
        backToDmList();
    } catch { alert('Erro de rede.'); }
}

function editDmEvent() {
    const ev = _dmEvents.find(e => e.id === _dmDetailId);
    if (!ev) return;
    openCreateDeckMapModal(ev);
}

// ── Create / Edit modal ───────────────────────────────────────────────────────

function openCreateDeckMapModal(editEvent = null) {
    _dmEditingId = editEvent?.id || null;
    _dmEntries   = editEvent ? editEvent.entries.map(e => ({ ...e })) : [];
    _dmSearchResults = {};

    document.getElementById('dmModalTitle').textContent = editEvent ? 'Editar Evento' : 'Novo Evento';
    _dmPopulateStoreSelect('dmStoreId', '— selecione a loja —');
    document.getElementById('dmStoreId').value     = editEvent?.storeId || '';
    document.getElementById('dmDate').value        = editEvent?.date    || new Date().toISOString().slice(0, 10);
    document.getElementById('dmFormat').value      = editEvent?.format  || '';
    document.getElementById('dmPlayerSearch').value = '';
    document.getElementById('dmGuestName').value    = '';
    document.getElementById('dmPlayerAC').style.display = 'none';
    _dmRenderEntries();
    document.getElementById('dmCreateModal').style.display = 'flex';
}

function closeDmCreateModal(e, force = false) {
    if (!force && e && !e.target.classList.contains('modal-overlay')) return;
    document.getElementById('dmCreateModal').style.display = 'none';
    document.getElementById('dmPlayerAC').style.display = 'none';
}

function onDmPlayerSearch() {
    const q  = document.getElementById('dmPlayerSearch').value.trim().toLowerCase();
    const ac = document.getElementById('dmPlayerAC');
    if (q.length < 2) { ac.style.display = 'none'; return; }
    const dir = Object.values(App.profileDirectory || {});
    const matches = dir
        .filter(p => !_dmEntries.some(x => x.playerId === p.bandaiName))
        .filter(p => (p.displayName || '').toLowerCase().includes(q) || (p.bandaiName || '').toLowerCase().includes(q))
        .slice(0, 8);
    if (!matches.length) { ac.style.display = 'none'; return; }
    _dmSearchResults = {};
    ac.innerHTML = matches.map((p, i) => {
        const key = 'dps_' + i;
        _dmSearchResults[key] = { playerId: p.bandaiName, playerName: p.displayName || p.bandaiName, isGuest: false };
        return `<div class="ac-item" onclick="addDmPlayer('${key}')">&#127918; ${_dmEsc(p.displayName || p.bandaiName)}`
            + (p.bandaiName ? `<span style="font-size:.72rem;color:var(--muted);margin-left:.35rem;">${_dmEsc(p.bandaiName)}</span>` : '')
            + `</div>`;
    }).join('');
    ac.style.display = 'block';
}

function addDmPlayer(key) {
    const player = _dmSearchResults[key];
    if (!player || _dmEntries.some(e => e.playerId === player.playerId)) return;
    _dmEntries.push({ ...player, leaderId: '' });
    document.getElementById('dmPlayerSearch').value = '';
    document.getElementById('dmPlayerAC').style.display = 'none';
    _dmRenderEntries();
}

function addDmGuest() {
    const name = document.getElementById('dmGuestName').value.trim();
    if (!name) return;
    _dmEntries.push({
        playerId: 'guest_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
        playerName: name, isGuest: true, leaderId: '',
    });
    document.getElementById('dmGuestName').value = '';
    _dmRenderEntries();
}

function removeDmEntry(idx) {
    _dmEntries.splice(idx, 1);
    _dmRenderEntries();
}

function setDmEntryLeader(idx, leaderId) {
    if (_dmEntries[idx]) _dmEntries[idx].leaderId = leaderId;
}

function _dmLeaderOptionsHtml(currentId) {
    const opts = DM_LEADERS.map(l =>
        `<option value="${_dmEsc(l.id)}" ${l.id === currentId ? 'selected' : ''}>${_dmEsc(l.id)} · ${_dmEsc(l.n)}</option>`
    ).join('');
    return `<option value="">— líder —</option>${opts}`;
}

function _dmRenderEntries() {
    const container = document.getElementById('dmEntriesList');
    const countEl    = document.getElementById('dmEntriesCount');
    const n = _dmEntries.length;
    countEl.textContent = `${n} jogador${n !== 1 ? 'es' : ''}`;
    if (!n) { container.innerHTML = '<p style="color:var(--muted);font-size:.8rem;text-align:center;padding:1rem 0;">Nenhum jogador adicionado.</p>'; return; }

    container.innerHTML = _dmEntries.map((e, i) => `
        <div style="display:flex;align-items:center;gap:.5rem;padding:.4rem 0;border-bottom:1px solid var(--border);">
            <span style="font-size:.8rem;flex:0 0 140px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                ${e.isGuest ? '&#128100;' : '&#127918;'} ${_dmEsc(e.playerName)}
            </span>
            ${e.leaderId ? `<img src="${_dmLeaderImgUrl(e.leaderId)}" style="width:24px;border-radius:3px;" onerror="this.style.display='none'">` : '<span style="width:24px;"></span>'}
            <select onchange="setDmEntryLeader(${i}, this.value)" style="flex:1;font-size:.78rem;padding:.2rem .4rem;border:1px solid var(--border);border-radius:5px;background:var(--card);color:var(--text);">
                ${_dmLeaderOptionsHtml(e.leaderId)}
            </select>
            <button onclick="removeDmEntry(${i})" style="background:none;border:none;cursor:pointer;color:var(--loss);font-size:.85rem;" title="Remover">&#10005;</button>
        </div>`).join('');
}

async function saveDmEvent() {
    const storeId = document.getElementById('dmStoreId').value;
    const date    = document.getElementById('dmDate').value;
    const format  = document.getElementById('dmFormat').value.trim();

    if (!storeId) { alert('Selecione a loja.'); return; }
    if (!date)    { alert('Selecione a data.'); return; }
    if (!format)  { alert('Informe o formato do torneio.'); return; }

    const payload = {
        storeId, date, format,
        playerCount: _dmEntries.length,
        entries: _dmEntries.map(e => ({
            playerId: e.playerId, playerName: e.playerName, isGuest: !!e.isGuest, leaderId: e.leaderId || '',
        })),
    };

    const btn = document.getElementById('dmSaveBtn');
    const orig = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = 'Salvando…';

    try {
        const url    = _dmEditingId ? `${AUTH_BASE}/deckmaps/${_dmEditingId}` : `${AUTH_BASE}/deckmaps`;
        const method = _dmEditingId ? 'PUT' : 'POST';
        const r = await fetch(url, {
            method, credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!r.ok) { alert('Erro ao salvar evento.'); return; }
        await _dmLoadEvents();
        _dmPopulateFilterOptions();
        _dmRenderStats();
        _dmRenderEventList();
        closeDmCreateModal(null, true);
        if (_dmEditingId) openDmEventDetail(_dmEditingId);
    } catch {
        alert('Erro de rede.');
    } finally {
        btn.disabled = false; btn.innerHTML = orig;
    }
}

// ── Util ──────────────────────────────────────────────────────────────────────

function _dmEsc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

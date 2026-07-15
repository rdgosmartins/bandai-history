// ── OPTCG Agent ───────────────────────────────────────────────────────────────
// 100% client-side:
//   Chat    → Anthropic API (direto do browser)
//   Busca   → /cards.json (asset estático do próprio site)
//   Deck    → parse + análise em JavaScript puro

// ── Constantes ────────────────────────────────────────────────────────────────

const WORKER_BASE    = (typeof AUTH_BASE !== 'undefined') ? AUTH_BASE : '';
const CARDS_JSON_URL = '/cards.json';

// ── Estado ────────────────────────────────────────────────────────────────────

const Agent = {
    db:          [],      // cards carregados do cards.json
    dbIndex:     {},      // { id -> card }
    dbLoaded:    false,
    chatHistory: [],
    currentDeck: null,
};

// ── Init ──────────────────────────────────────────────────────────────────────

async function loadAgentTab() {
    const el = document.getElementById('agentTab');
    if (!el) return;

    el.innerHTML = _agentHtml();
    _bindAgentEvents();

    // Carregar base de cartas
    _loadCardsDB();

    _addAgentMsg('bot', `Olá, marujo! Sou especialista em <strong>One Piece TCG</strong> com base de 2.500+ cartas e motor estratégico.<br><br>
        Posso responder sobre <strong>regras</strong>, <strong>estratégia</strong>, <strong>mulligan</strong> e analisar decks. Tente:<br>
        <em>"Shanks c10"</em> · <em>"Life 2, counter ou aceitar?"</em> · <em>"Leaders vermelhos"</em> · <em>"Como funciona Double Attack?"</em>`);
}

async function _loadCardsDB() {
    const dot = document.getElementById('agentStatusDot');
    const txt = document.getElementById('agentStatusTxt');
    try {
        const r = await fetch(CARDS_JSON_URL);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        Agent.db = await r.json();
        Agent.dbIndex = {};
        for (const c of Agent.db) Agent.dbIndex[c.id] = c;
        Agent.dbLoaded = true;

        if (dot) dot.className = 'agent-dot ok';
        if (txt) txt.textContent = `${Agent.db.length} cartas`;

        // Popular select de sets
        const sets = [...new Set(Agent.db.map(c => c.s).filter(Boolean))].sort();
        const sel  = document.getElementById('agentSetFilter');
        if (sel) {
            sets.forEach(s => {
                const o = document.createElement('option');
                o.value = s; o.textContent = s;
                sel.appendChild(o);
            });
        }
    } catch (e) {
        if (dot) dot.className = 'agent-dot err';
        if (txt) txt.textContent = 'Erro ao carregar cartas';
        console.warn('[Agent] Falha ao carregar cards.json:', e);
    }
}

// ── Busca local ───────────────────────────────────────────────────────────────

function _searchCards(filters) {
    const { name, color, cardType, cost, rarity, minPower, setId, attribute, effect } = filters;
    return Agent.db.filter(c => {
        if (name      && !(c.n  || '').toLowerCase().includes(name.toLowerCase()))      return false;
        if (color     && !(c.c  || '').toLowerCase().includes(color.toLowerCase()))     return false;
        if (cardType  && c.t !== cardType)                                               return false;
        if (cost      && String(c.co) !== String(cost))                                 return false;
        if (rarity    && c.r !== rarity)                                                 return false;
        if (minPower  && parseInt(c.pw || 0) < parseInt(minPower))                      return false;
        if (setId     && c.s !== setId)                                                  return false;
        if (attribute && (c.at || '').toLowerCase() !== attribute.toLowerCase())         return false;
        if (effect    && !(c.fx || '').toLowerCase().includes(effect.toLowerCase()))     return false;
        return true;
    });
}

function _parseNaturalQuery(q) {
    const lo = q.toLowerCase();
    const f  = {};

    // custo: c10, custo 10
    const cm = lo.match(/\bc(\d+)\b|custo\s+(\d+)|cost\s+(\d+)/);
    if (cm) f.cost = cm[1] || cm[2] || cm[3];

    // power mínimo: pw10000, 10000+
    const pm = lo.match(/pw\s*(\d+)|power\s+(\d+)|(\d{4,})\+/);
    if (pm) f.minPower = pm[1] || pm[2] || pm[3];

    // tipo
    if      (/\bleader\b/.test(lo))               f.cardType = 'Leader';
    else if (/\bcharacter\b|\bpersonagem\b/.test(lo)) f.cardType = 'Character';
    else if (/\bevent\b|\bevento\b/.test(lo))      f.cardType = 'Event';
    else if (/\bstage\b/.test(lo))                 f.cardType = 'Stage';

    // cor
    const clr = {vermelho:'Red',red:'Red',azul:'Blue',blue:'Blue',verde:'Green',
                 green:'Green',roxo:'Purple',purple:'Purple',preto:'Black',
                 black:'Black',amarelo:'Yellow',yellow:'Yellow'};
    for (const [k, v] of Object.entries(clr)) {
        if (lo.includes(k)) { f.color = v; break; }
    }

    // set: OP-09, op9, ST-01
    const sm = lo.match(/\bop[-\s]?0?(\d{1,2})\b|\bst[-\s]?0?(\d{1,2})\b|\beb[-\s]?0?(\d{1,2})\b/);
    if (sm) {
        if (sm[1])      f.setId = `OP-${sm[1].padStart(2, '0')}`;
        else if (sm[2]) f.setId = `ST-${sm[2].padStart(2, '0')}`;
        else if (sm[3]) f.setId = `EB-${sm[3].padStart(2, '0')}`;
    }

    // raridade
    if (/\bsec\b/.test(lo))              f.rarity = 'SEC';
    else if (/\bsuper rare\b|\bsr\b/.test(lo)) f.rarity = 'SR';

    // keywords como efeito
    for (const kw of ['rush','blocker','double attack','trigger','banish','unblockable','on play','when attacking','on k.o']) {
        if (lo.includes(kw)) { f.effect = kw; break; }
    }

    // nome: o que sobra
    let n = q
        .replace(/c\d+|custo\s*\d+|cost\s*\d+/gi, '')
        .replace(/vermelho|azul|verde|roxo|preto|amarelo|red|blue|green|purple|black|yellow/gi, '')
        .replace(/leader|character|event|stage|personagem|evento/gi, '')
        .replace(/super rare|sec|rush|blocker|double attack|trigger|banish|unblockable/gi, '')
        .replace(/op[-\s]?\d{1,2}|st[-\s]?\d{1,2}|eb[-\s]?\d{1,2}/gi, '')
        .replace(/com|todos|all|me mostre|quais|são|os|as|de|do|da|para|líderes?|leaders?|\+/gi, ' ')
        .replace(/\s+/g, ' ').trim();
    if (n.length >= 2) f.name = n;

    return f;
}

function _cardsToText(cards, max = 25) {
    if (!cards.length) return 'Nenhuma carta encontrada.';
    const lines = cards.slice(0, max).map(c =>
        `[${c.id}] ${c.n} | ${c.c || ''} ${c.t || ''} | c${c.co ?? '—'} | ${c.pw ?? '—'}pw | ${c.r || ''} | ${(c.fx || '').slice(0, 100)}`
    );
    if (cards.length > max) lines.push(`...e mais ${cards.length - max} cartas.`);
    return lines.join('\n');
}

// ── Deck parser ───────────────────────────────────────────────────────────────

function _parseDeckCode(code) {
    const pattern = /(\d{1,2})x([A-Z0-9]+-\d{3})/g;
    const entries = [];
    let m;
    while ((m = pattern.exec(code)) !== null) {
        const qty  = parseInt(m[1]);
        const id   = m[2];
        const card = Agent.dbIndex[id] || { id, n: id, t: 'Unknown', co: null, pw: null, fx: '' };
        entries.push({ qty, card });
    }
    return entries;
}

function _deckStats(entries) {
    const nonLeader = entries.filter(e => e.card.t !== 'Leader');
    const costs  = nonLeader.flatMap(e => Array(e.qty).fill(parseInt(e.card.co) || 0));
    const pows   = nonLeader.filter(e => e.card.t === 'Character')
                            .flatMap(e => { const p = parseInt(e.card.pw); return isNaN(p) ? [] : Array(e.qty).fill(p); });
    const total  = entries.reduce((s, e) => s + e.qty, 0);
    const costDist = {};
    costs.forEach(c => { costDist[c] = (costDist[c] || 0) + 1; });
    const even = Object.entries(costDist).filter(([k]) => +k % 2 === 0).reduce((s, [,v]) => s + v, 0);
    const odd  = Object.entries(costDist).filter(([k]) => +k % 2 !== 0).reduce((s, [,v]) => s + v, 0);
    const avgCost = costs.length ? (costs.reduce((a, b) => a + b, 0) / costs.length).toFixed(1) : '—';
    const avgPow  = pows.length  ? Math.round(pows.reduce((a, b) => a + b, 0) / pows.length) : 0;
    const colors  = [...new Set(entries.map(e => e.card.c).filter(Boolean))];
    const types   = {};
    entries.forEach(e => { types[e.card.t] = (types[e.card.t] || 0) + e.qty; });
    const parity  = even > odd ? 'PAR' : odd > even ? 'ÍMPAR' : 'MISTO';
    return { total, unique: entries.length, avgCost, avgPow, colors, types, costDist, parity,
             idealGoing: parity === 'PAR' ? 'SEGUNDO' : parity === 'ÍMPAR' ? 'PRIMEIRO' : 'NEUTRO' };
}

// ── Chat ──────────────────────────────────────────────────────────────────────

function _scrollChat() {
    const el = document.getElementById('agentMsgs');
    if (el) el.scrollTop = el.scrollHeight;
}

function _addAgentMsg(role, html) {
    const msgs = document.getElementById('agentMsgs');
    if (!msgs) return;
    const d    = document.createElement('div');
    d.className = 'agent-msg ' + (role === 'user' ? 'agent-msg-u' : 'agent-msg-b');
    d.innerHTML = `<div class="agent-ava">${role === 'user' ? '⚓' : '🏴‍☠️'}</div>
                   <div class="agent-bbl">${html}</div>`;
    msgs.appendChild(d);
    _scrollChat();
}

function _showTyping() {
    const msgs = document.getElementById('agentMsgs');
    if (!msgs) return;
    const d    = document.createElement('div');
    d.className = 'agent-msg agent-msg-b';
    d.id        = 'agentTyping';
    d.innerHTML = `<div class="agent-ava">🏴‍☠️</div>
                   <div class="agent-bbl"><span class="agent-dots"><span></span><span></span><span></span></span></div>`;
    msgs.appendChild(d);
    _scrollChat();
}

function _rmTyping() { document.getElementById('agentTyping')?.remove(); }

function _fmt(t) {
    return (t || '')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g,     '<em>$1</em>')
        .replace(/`([^`]+)`/g,     '<code>$1</code>')
        .replace(/\n/g,            '<br>');
}

async function _callAnthropic(messages) {
    const r = await fetch(`${WORKER_BASE}/agent/chat`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ messages }),
    });
    if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${r.status}`);
    }
    const data = await r.json();
    return data.reply || '';
}

async function sendAgentMsg() {
    const inp = document.getElementById('agentInput');
    if (!inp) return;
    const raw = inp.value.trim();
    if (!raw) return;

    inp.value = '';
    document.getElementById('agentSendBtn').disabled = true;

    // Detectar código de deck → pré-carregar aba deck
    if (/(\d{1,2}x[A-Z0-9]+-\d{3}){3,}/.test(raw)) {
        const field = document.getElementById('agentDeckCode');
        if (field) { field.value = raw; _loadDeckFromCode(raw); }
    }

    // Enriquecer mensagem com dados de cartas da DB local
    let content = raw;
    if (Agent.dbLoaded) {
        const isDeck = /(\d{1,2}x[A-Z0-9]+-\d{3}){3,}/.test(raw);
        if (isDeck) {
            const entries = _parseDeckCode(raw);
            if (entries.length) {
                const total = entries.reduce((s, e) => s + e.qty, 0);
                const lines = entries.map(e =>
                    `${e.qty}x ${e.card.id} — ${e.card.n} | c${e.card.co ?? 'Leader'} | ${e.card.pw ?? '—'}pw | ${e.card.t} | ${(e.card.fx || '').slice(0, 100)}`
                ).join('\n');
                content += `\n\nDADOS DO DECK (${total} cartas):\n${lines}`;
            }
        } else {
            const filters = _parseNaturalQuery(raw);
            const results = _searchCards(filters);
            if (results.length > 0 && results.length < 200) {
                content += `\n\nDADOS DA BASE (${results.length} cartas encontradas):\n${_cardsToText(results, 25)}`;
            }
        }
    }

    _addAgentMsg('user', _fmt(raw));
    Agent.chatHistory.push({ role: 'user', content });
    _showTyping();

    try {
        const reply = await _callAnthropic(Agent.chatHistory);
        _rmTyping();
        _addAgentMsg('bot', _fmt(reply));
        Agent.chatHistory.push({ role: 'assistant', content: reply });
    } catch (e) {
        _rmTyping();
        _addAgentMsg('bot', `Erro: <code>${e.message}</code>`);
    }

    document.getElementById('agentSendBtn').disabled = false;
    inp.focus();
}

function agentQuickAsk(q) {
    const inp = document.getElementById('agentInput');
    if (inp) { inp.value = q; sendAgentMsg(); }
}

// ── Search tab ────────────────────────────────────────────────────────────────

async function doAgentSearch() {
    if (!Agent.dbLoaded) {
        document.getElementById('agentSearchInfo').textContent = 'Base de cartas ainda carregando…';
        return;
    }
    const filters = {
        name:      document.getElementById('agentNameFilter')?.value.trim(),
        color:     document.getElementById('agentColorFilter')?.value,
        cardType:  document.getElementById('agentTypeFilter')?.value,
        cost:      document.getElementById('agentCostFilter')?.value,
        rarity:    document.getElementById('agentRarityFilter')?.value,
        minPower:  parseInt(document.getElementById('agentPowerFilter')?.value) || undefined,
        setId:     document.getElementById('agentSetFilter')?.value,
        attribute: document.getElementById('agentAttrFilter')?.value,
        effect:    document.getElementById('agentEffectFilter')?.value.trim(),
    };
    // Limpar valores vazios
    Object.keys(filters).forEach(k => { if (!filters[k]) delete filters[k]; });

    const results = _searchCards(filters);
    _renderSearchResults(results);
}

function _renderSearchResults(cards) {
    const info = document.getElementById('agentSearchInfo');
    const grid = document.getElementById('agentSearchGrid');
    if (!info || !grid) return;

    const shown = cards.slice(0, 80);
    info.textContent = `${cards.length} carta${cards.length !== 1 ? 's' : ''} encontrada${cards.length !== 1 ? 's' : ''}${cards.length > 80 ? ' (mostrando 80)' : ''}`;
    grid.innerHTML   = '';

    shown.forEach(card => {
        const div = document.createElement('div');
        div.className = 'agent-card-item';
        div.onclick   = () => _openCardModal(card);
        const img = document.createElement('img');
        img.className = 'agent-card-img';
        img.src       = `https://optcgapi.com/media/static/Card_Images/${card.id}.jpg`;
        img.alt       = card.n || '';
        img.loading   = 'lazy';
        img.onerror   = () => img.remove();
        div.appendChild(img);
        div.innerHTML += `
            <div class="agent-card-name" title="${card.n || ''}">${card.n || '—'}</div>
            <div class="agent-card-tags">
                <span class="agent-tag ${_colorClass(card.c)}">${card.c || '—'}</span>
                <span class="agent-tag agent-tag-N">${card.t || '—'}</span>
                ${card.r  ? `<span class="agent-tag agent-tag-N">${card.r}</span>` : ''}
                ${card.co != null ? `<span class="agent-tag agent-tag-N">c${card.co}</span>` : ''}
            </div>`;
        grid.appendChild(div);
    });
}

function clearAgentSearch() {
    ['agentNameFilter','agentCostFilter','agentPowerFilter','agentEffectFilter']
        .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    ['agentColorFilter','agentTypeFilter','agentRarityFilter','agentSetFilter','agentAttrFilter']
        .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    const grid = document.getElementById('agentSearchGrid');
    const info = document.getElementById('agentSearchInfo');
    if (grid) grid.innerHTML = '';
    if (info) info.textContent = `${Agent.db.length} cartas disponíveis — use os filtros acima.`;
}

function _colorClass(c) {
    const m = {Red:'agent-tag-R',Blue:'agent-tag-B',Green:'agent-tag-G',
               Purple:'agent-tag-P',Black:'agent-tag-K',Yellow:'agent-tag-Y'};
    for (const [k, v] of Object.entries(m)) if ((c || '').includes(k)) return v;
    return 'agent-tag-N';
}

// ── Deck builder ──────────────────────────────────────────────────────────────

function loadAgentDeck() {
    const code = document.getElementById('agentDeckCode')?.value?.trim();
    if (!code) return;
    _loadDeckFromCode(code);
}

function _loadDeckFromCode(code) {
    const entries = _parseDeckCode(code);
    if (!entries.length) { alert('Nenhuma carta reconhecida. Verifique o formato: 4xOP16-091...'); return; }
    const stats = _deckStats(entries);
    Agent.currentDeck = { entries, stats };
    _renderDeck(entries, stats);
}

function _renderDeck(entries, stats) {
    // Stats sidebar
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('agentDeckTotal',  stats.total);
    set('agentDeckUnique', stats.unique);
    set('agentDeckAvg',    stats.avgCost);
    set('agentDeckPw',     stats.avgPow > 0 ? (stats.avgPow / 1000).toFixed(1) + 'k' : '—');
    set('agentDeckColors', stats.colors.join(', ') || '—');

    const parityEl = document.getElementById('agentDeckParity');
    if (parityEl) {
        parityEl.textContent = stats.parity === 'ÍMPAR' ? 'Curva ímpar → ir 1º'
                             : stats.parity === 'PAR'   ? 'Curva par → ir 2º'
                             : 'Curva mista';
        parityEl.className = 'agent-deck-parity ' +
            (stats.parity === 'ÍMPAR' ? 'parity-odd' : stats.parity === 'PAR' ? 'parity-even' : '');
    }

    // Curva de mana
    const dist    = stats.costDist;
    const maxCost = Math.max(...Object.keys(dist).map(Number), 8);
    const maxQty  = Math.max(...Object.values(dist), 1);
    let barsHtml  = '';
    for (let i = 1; i <= maxCost; i++) {
        const q = dist[i] || 0;
        const h = q ? Math.round((q / maxQty) * 64) : 0;
        barsHtml += `<div class="agent-bar-wrap">
            <div class="agent-bar-cnt">${q || ''}</div>
            <div class="agent-bar" style="height:${Math.max(h, q ? 3 : 0)}px;opacity:${q ? 1 : 0.12}"></div>
            <div class="agent-bar-lbl">${i}</div>
        </div>`;
    }
    const curveEl = document.getElementById('agentCurveBars');
    if (curveEl) curveEl.innerHTML = barsHtml;

    // Lista lateral agrupada por tipo
    const listEl = document.getElementById('agentDeckList');
    if (listEl) {
        const order  = ['Leader', 'Character', 'Event', 'Stage', 'Unknown'];
        const groups = {};
        entries.forEach(e => { const g = e.card.t || 'Unknown'; (groups[g] = groups[g] || []).push(e); });
        listEl.innerHTML = '';
        order.forEach(gname => {
            const items = groups[gname];
            if (!items?.length) return;
            items.sort((a, b) => (parseInt(a.card.co) || 0) - (parseInt(b.card.co) || 0));
            const grp = document.createElement('div');
            grp.className = 'agent-deck-group';
            grp.innerHTML = `<div class="agent-deck-group-title">${gname} <span>(${items.reduce((s, e) => s + e.qty, 0)})</span></div>`;
            items.forEach(e => {
                const row = document.createElement('div');
                row.className = 'agent-deck-row';
                row.onclick   = () => _openCardModal(e.card);
                const img     = document.createElement('img');
                img.src = `https://optcgapi.com/media/static/Card_Images/${e.card.id}.jpg`;
                img.onerror = () => img.style.opacity = '0.2';
                row.appendChild(img);
                row.innerHTML += `
                    <span class="agent-deck-qty">${e.qty}x</span>
                    <div class="agent-deck-info">
                        <div class="agent-deck-name" title="${e.card.n}">${e.card.n}</div>
                        <div class="agent-deck-meta">${e.card.id}${e.card.co != null ? ` · c${e.card.co}` : ''}${e.card.pw ? ` · ${parseInt(e.card.pw).toLocaleString()}pw` : ''}</div>
                    </div>`;
                grp.appendChild(row);
            });
            listEl.appendChild(grp);
        });
    }

    // Grid de imagens
    const gridEl = document.getElementById('agentDeckGrid');
    if (gridEl) {
        gridEl.innerHTML = '';
        entries.forEach(e => {
            const div = document.createElement('div');
            div.className = 'agent-deck-thumb';
            div.onclick   = () => _openCardModal(e.card);
            const img     = document.createElement('img');
            img.src       = `https://optcgapi.com/media/static/Card_Images/${e.card.id}.jpg`;
            img.alt       = e.card.n || '';
            img.loading   = 'lazy';
            img.onerror   = () => { img.style.background = '#eee'; img.src = ''; img.style.minHeight = '80px'; };
            div.appendChild(img);
            if (e.qty > 1) {
                const b = document.createElement('div');
                b.className   = 'agent-thumb-badge';
                b.textContent = `${e.qty}x`;
                div.appendChild(b);
            }
            const tb = document.createElement('div');
            tb.className   = 'agent-thumb-type';
            tb.textContent = {Leader:'L',Character:'C',Event:'E',Stage:'S'}[e.card.t] || '?';
            div.appendChild(tb);
            gridEl.appendChild(div);
        });
    }

    // Limpar análise anterior
    const anlEl = document.getElementById('agentAnalysisContent');
    if (anlEl) anlEl.innerHTML = '<p style="color:var(--muted);font-size:.88rem">Clique em <strong>Análise IA</strong> para analisar este deck.</p>';
}

async function runAgentDeckAnalysis() {
    if (!Agent.currentDeck) { alert('Carregue um deck primeiro.'); return; }
    const el = document.getElementById('agentAnalysisContent');
    if (!el) return;

    el.innerHTML = `<div class="agent-analysis-loading">
        <span class="agent-dots"><span></span><span></span><span></span></span>
        <span>Analisando deck com IA…</span>
    </div>`;

    const { entries, stats } = Agent.currentDeck;
    const lines = entries.map(e =>
        `${e.qty}x ${e.card.id} — ${e.card.n} | c${e.card.co ?? 'Leader'} | ${e.card.pw ? e.card.pw + 'pw' : '—'} | ${e.card.t} | ${(e.card.fx || '').slice(0, 100)}`
    ).join('\n');

    const prompt = `Analise este deck de One Piece TCG (${stats.total} cartas, curva ${stats.parity}, custo médio ${stats.avgCost}):\n\n${lines}\n\nForneça análise completa em português: 1. Estratégia principal, 2. Pacote de busca/consistência, 3. Win conditions, 4. Pontos fortes, 5. Fraquezas e melhorias, 6. Dicas de jogo por turno.`;

    try {
        const reply = await _callAnthropic([{ role: 'user', content: prompt }], 2000);
        el.innerHTML = `<div class="agent-analysis-text">${_fmt(reply)}</div>
            <button class="btn btn-outline btn-sm" style="margin-top:1rem" onclick="runAgentDeckAnalysis()">&#8635; Reanalisar</button>`;
    } catch (e) {
        el.innerHTML = `<p style="color:var(--muted)">Erro: ${e.message}</p>`;
    }
}

// ── Card modal ────────────────────────────────────────────────────────────────

function _openCardModal(card) {
    const modal = document.getElementById('agentCardModal');
    const body  = document.getElementById('agentCardModalBody');
    if (!modal || !body) return;

    const rows = [
        ['ID', card.id], ['Set', card.s], ['Tipo', card.t], ['Cor', card.c], ['Raridade', card.r],
        ['Power',   card.pw  ? parseInt(card.pw).toLocaleString() : null],
        ['Custo',   card.co], ['Life', card.lf], ['Counter', card.ct],
        ['Atributo', card.at], ['Tipos', card.st],
    ].filter(([, v]) => v != null && v !== '');

    body.innerHTML = `
        <div class="agent-modal-inner">
            <img src="https://optcgapi.com/media/static/Card_Images/${card.id}.jpg"
                 alt="${card.n || ''}" class="agent-modal-img" onerror="this.style.opacity='.2'">
            <div class="agent-modal-info">
                <h3>${card.n || '—'}</h3>
                ${rows.map(([k, v]) => `
                    <div class="agent-modal-row">
                        <span class="agent-modal-key">${k}</span>
                        <span class="agent-modal-val">${v}</span>
                    </div>`).join('')}
            </div>
            ${card.fx ? `<div class="agent-modal-fx"><strong>Efeito:</strong><br><br>${(card.fx).replace(/\n/g,'<br><br>')}</div>` : ''}
            <button class="btn btn-primary btn-sm" style="grid-column:1/-1"
                    onclick="_askAboutCard(${JSON.stringify(card).replace(/"/g,'&quot;')})">
                &#128172; Analisar no chat
            </button>
        </div>`;
    modal.classList.add('open');
}

function _askAboutCard(card) {
    document.getElementById('agentCardModal')?.classList.remove('open');
    _switchAgentTab('chat');
    const inp = document.getElementById('agentInput');
    if (inp) {
        inp.value = `Analise a carta ${card.n} (${card.id}): c${card.co ?? '?'}, ${card.pw ?? '?'}pw, ${card.c} ${card.t}. Efeito: ${card.fx || 'sem efeito'}. Como usar, combos e valor competitivo?`;
        sendAgentMsg();
    }
}

// ── Sub-tabs ──────────────────────────────────────────────────────────────────

function _switchAgentTab(tab) {
    ['chat', 'search', 'deck'].forEach(t => {
        document.getElementById(`agentSubTab-${t}`)?.classList.toggle('active', t === tab);
        document.getElementById(`agentSubPanel-${t}`)?.classList.toggle('agent-subpanel-on', t === tab);
    });
}

function _switchAgentDeckTab(tab) {
    ['overview', 'grid', 'analysis'].forEach(t => {
        document.getElementById(`agentDeckTab-${t}`)?.classList.toggle('active', t === tab);
        document.getElementById(`agentDeckPanel-${t}`)?.classList.toggle('agent-subpanel-on', t === tab);
    });
    if (tab === 'analysis') runAgentDeckAnalysis();
}

// ── Events ────────────────────────────────────────────────────────────────────

function _bindAgentEvents() {
    document.getElementById('agentInput')
        ?.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAgentMsg(); } });
    document.getElementById('agentNameFilter')
        ?.addEventListener('keydown', e => { if (e.key === 'Enter') doAgentSearch(); });
    document.getElementById('agentCardModal')
        ?.addEventListener('click', e => { if (e.target === document.getElementById('agentCardModal')) e.target.classList.remove('open'); });
}

// ── HTML ──────────────────────────────────────────────────────────────────────

function _agentHtml() { return `
<style>
.agent-wrap{max-width:1100px;margin:0 auto;padding:0 1rem 2rem}
.agent-header{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.75rem;margin-bottom:1.25rem}
.agent-header h2{font-family:'Montserrat',sans-serif;font-size:.82rem;text-transform:uppercase;letter-spacing:.1em;color:var(--primary);display:flex;align-items:center;gap:.5rem;margin:0}
.agent-status{display:flex;align-items:center;gap:.5rem;font-size:.78rem;color:var(--muted)}
.agent-dot{width:8px;height:8px;border-radius:50%;background:var(--muted);flex-shrink:0;transition:background .3s}
.agent-dot.ok{background:var(--win,#28a745)}.agent-dot.warn{background:#f0ad4e}.agent-dot.err{background:var(--loss,#dc3545)}
.agent-subtabs{display:flex;gap:0;border-bottom:2px solid var(--border);margin-bottom:1.25rem}
.agent-subtab{padding:.55rem 1.4rem;border:none;background:none;font-family:'Montserrat',sans-serif;font-size:.78rem;letter-spacing:.06em;color:var(--muted);cursor:pointer;border-bottom:3px solid transparent;margin-bottom:-2px;transition:color .18s,border-color .18s;display:flex;align-items:center;gap:.35rem}
.agent-subtab.active{color:var(--gold);border-bottom-color:var(--gold);font-weight:700}
.agent-subtab:hover:not(.active){color:var(--text)}
.agent-subpanel{display:none}.agent-subpanel-on{display:block}
/* Chat */
.agent-quickbtns{display:flex;flex-wrap:wrap;gap:.4rem;margin-bottom:.75rem}
.agent-qbtn{padding:.3rem .85rem;border:1.5px solid var(--border);border-radius:999px;font-size:.78rem;background:white;color:var(--muted);cursor:pointer;transition:all .15s}
.agent-qbtn:hover{border-color:var(--gold);color:var(--primary);background:rgba(201,168,76,.06)}
.agent-msgs{background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:.9rem 1rem;height:340px;overflow-y:auto;display:flex;flex-direction:column;gap:.75rem}
.agent-msg{display:flex;gap:.65rem;align-items:flex-start}
.agent-msg-u{flex-direction:row-reverse}
.agent-ava{width:28px;height:28px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:13px;border:1px solid var(--border);background:white}
.agent-bbl{max-width:85%;padding:.65rem .9rem;border-radius:10px;font-size:.85rem;line-height:1.6}
.agent-msg-b .agent-bbl{background:white;border:1px solid var(--border);border-radius:4px 10px 10px 10px;color:var(--text)}
.agent-msg-u .agent-bbl{background:linear-gradient(135deg,var(--primary),#154080);color:white;border-radius:10px 4px 10px 10px}
.agent-bbl code{background:var(--bg);padding:.1rem .35rem;border-radius:4px;font-family:monospace;font-size:.8rem}
.agent-bbl a{color:var(--accent)}
.agent-input-row{display:flex;gap:.6rem;margin-top:.75rem}
.agent-input-row textarea{flex:1;padding:.6rem .9rem;border:1px solid var(--border);border-radius:8px;font-size:.88rem;font-family:inherit;resize:none;height:42px;background:white;color:var(--text);transition:border-color .2s}
.agent-input-row textarea:focus{outline:none;border-color:var(--accent)}
.agent-send-btn{padding:0 1.2rem;background:linear-gradient(135deg,var(--primary),#154080);color:white;border:none;border-radius:8px;cursor:pointer;font-size:.88rem;transition:opacity .15s}
.agent-send-btn:hover{opacity:.9}.agent-send-btn:disabled{opacity:.45;cursor:not-allowed}
.agent-dots{display:inline-flex;gap:4px;align-items:center}
.agent-dots span{width:5px;height:5px;border-radius:50%;background:var(--muted);animation:agBounce 1.2s infinite}
.agent-dots span:nth-child(2){animation-delay:.2s}.agent-dots span:nth-child(3){animation-delay:.4s}
@keyframes agBounce{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-5px)}}
/* Search */
.agent-search-grid-4{display:grid;grid-template-columns:repeat(4,1fr);gap:.65rem;margin-bottom:.65rem}
.agent-search-grid-2{display:grid;grid-template-columns:1fr 1fr;gap:.65rem;margin-bottom:.65rem}
@media(max-width:600px){.agent-search-grid-4{grid-template-columns:1fr 1fr}.agent-search-grid-2{grid-template-columns:1fr}}
.agent-sfield{width:100%;padding:.5rem .8rem;border:1px solid var(--border);border-radius:7px;font-size:.88rem;color:var(--text);background:white;transition:border-color .2s;font-family:inherit}
.agent-sfield:focus{outline:none;border-color:var(--accent)}
#agentSearchInfo{font-size:.8rem;color:var(--muted);margin:.5rem 0}
.agent-search-results{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:.65rem;margin-top:.75rem}
.agent-card-item{background:white;border:1px solid var(--border);border-radius:10px;padding:.65rem;cursor:pointer;transition:border-color .15s,box-shadow .15s}
.agent-card-item:hover{border-color:var(--gold);box-shadow:0 2px 8px rgba(201,168,76,.15)}
.agent-card-img{width:100%;aspect-ratio:.714;object-fit:cover;border-radius:7px;margin-bottom:.5rem;background:var(--bg);display:block}
.agent-card-name{font-size:.78rem;font-weight:600;color:var(--text);margin-bottom:.35rem;line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.agent-card-tags{display:flex;flex-wrap:wrap;gap:.25rem}
.agent-tag{font-size:.68rem;padding:.15rem .5rem;border-radius:999px;font-weight:600}
.agent-tag-R{background:#fce8e0;color:#8b2e14}.agent-tag-B{background:#deedf9;color:#0d4478}
.agent-tag-G{background:#e3f1d4;color:#2a5c08}.agent-tag-P{background:#e9e8fc;color:#3a2f7a}
.agent-tag-K{background:#e0dfda;color:#333}.agent-tag-Y{background:#fdf0d0;color:#5a3600}
.agent-tag-N{background:var(--bg);color:var(--muted);border:1px solid var(--border)}
/* Deck */
.agent-deck-layout{display:grid;grid-template-columns:210px 1fr;gap:1.25rem}
@media(max-width:700px){.agent-deck-layout{grid-template-columns:1fr}}
.agent-deck-sidebar{display:flex;flex-direction:column;gap:.75rem}
.agent-deck-input label{margin-bottom:.35rem}
.agent-deck-input textarea{font-family:monospace;font-size:.78rem;height:76px;border:1px solid var(--border);border-radius:7px;width:100%;padding:.5rem .7rem;resize:none;background:white;color:var(--text);transition:border-color .2s}
.agent-deck-input textarea:focus{outline:none;border-color:var(--accent)}
.agent-deck-stats{display:grid;grid-template-columns:1fr 1fr;gap:.5rem}
.agent-stat-mini{background:var(--bg);border-radius:7px;padding:.55rem .75rem;border:1px solid var(--border)}
.agent-stat-mini .sm-label{font-size:.68rem;color:var(--muted);margin-bottom:.15rem;text-transform:uppercase;letter-spacing:.05em}
.agent-stat-mini .sm-val{font-size:1.1rem;font-weight:700;color:var(--text)}
.agent-deck-parity{font-size:.75rem;font-weight:600;padding:.3rem .6rem;border-radius:6px;background:var(--bg);color:var(--muted);border:1px solid var(--border);text-align:center}
.parity-odd{background:rgba(4,138,129,.1);color:var(--accent);border-color:var(--accent)}
.parity-even{background:rgba(29,79,136,.1);color:var(--primary);border-color:var(--primary)}
.agent-deck-group{margin-bottom:.9rem}
.agent-deck-group-title{font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);border-bottom:1px solid var(--border);padding:.3rem 0 .2rem;margin-bottom:.35rem;display:flex;justify-content:space-between}
.agent-deck-row{display:flex;align-items:center;gap:.5rem;padding:.3rem 0;cursor:pointer;border-radius:5px}
.agent-deck-row:hover .agent-deck-name{color:var(--accent)}
.agent-deck-row img{width:26px;height:36px;object-fit:cover;border-radius:3px;background:var(--bg);flex-shrink:0}
.agent-deck-qty{font-size:.78rem;font-weight:700;color:var(--primary);min-width:18px}
.agent-deck-name{font-size:.78rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text)}
.agent-deck-meta{font-size:.7rem;color:var(--muted)}
.agent-deck-main{display:flex;flex-direction:column;gap:.75rem}
.agent-deck-tabs{display:flex;gap:0;border-bottom:1.5px solid var(--border)}
.agent-deck-tab{padding:.45rem 1.1rem;border:none;background:none;font-family:'Montserrat',sans-serif;font-size:.75rem;letter-spacing:.05em;color:var(--muted);cursor:pointer;border-bottom:2.5px solid transparent;margin-bottom:-1.5px;transition:color .15s,border-color .15s}
.agent-deck-tab.active{color:var(--gold);border-bottom-color:var(--gold);font-weight:700}
.agent-deck-tab:hover:not(.active){color:var(--text)}
.agent-curve-bars{display:flex;align-items:flex-end;gap:5px;height:72px;margin:.5rem 0;padding:0 .25rem}
.agent-bar-wrap{display:flex;flex-direction:column;align-items:center;gap:2px;flex:1}
.agent-bar{background:var(--primary);border-radius:3px 3px 0 0;width:100%;min-height:2px;transition:height .3s}
.agent-bar-lbl{font-size:.65rem;color:var(--muted)}.agent-bar-cnt{font-size:.68rem;font-weight:700;color:var(--text);min-height:12px}
.agent-deck-img-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(75px,1fr));gap:.5rem}
.agent-deck-thumb{position:relative;cursor:pointer;border-radius:6px;overflow:hidden;border:1px solid var(--border);transition:border-color .15s}
.agent-deck-thumb:hover{border-color:var(--gold)}
.agent-deck-thumb img{width:100%;aspect-ratio:.714;object-fit:cover;display:block;background:var(--bg)}
.agent-thumb-badge{position:absolute;top:3px;right:3px;background:var(--primary);color:white;font-size:.65rem;font-weight:700;border-radius:8px;padding:1px 5px}
.agent-thumb-type{position:absolute;bottom:3px;left:3px;font-size:.65rem;padding:1px 4px;border-radius:3px;font-weight:700;background:rgba(0,0,0,.55);color:white}
.agent-analysis-loading{display:flex;align-items:center;gap:.75rem;color:var(--muted);font-size:.88rem;padding:1rem 0}
.agent-analysis-text{font-size:.88rem;line-height:1.7;color:var(--text)}
.agent-analysis-text strong{color:var(--primary)}
/* Modal */
#agentCardModal{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:2000;display:none;align-items:center;justify-content:center;padding:1rem}
#agentCardModal.open{display:flex}
.agent-modal-box{background:var(--card);border-radius:12px;border:1px solid rgba(201,168,76,.15);border-top:3px solid var(--gold);max-width:480px;width:100%;max-height:84vh;overflow-y:auto;padding:1.25rem;position:relative;box-shadow:0 8px 32px rgba(0,0,0,.18)}
.agent-modal-close{position:absolute;top:.75rem;right:1rem;background:none;border:none;font-size:1.2rem;cursor:pointer;color:var(--muted)}
.agent-modal-close:hover{color:var(--text)}
.agent-modal-inner{display:grid;grid-template-columns:120px 1fr;gap:1rem}
.agent-modal-img{width:120px;border-radius:8px;background:var(--bg)}
.agent-modal-info h3{font-family:'Montserrat',sans-serif;font-size:.92rem;font-weight:700;color:var(--primary);margin-bottom:.6rem}
.agent-modal-row{display:flex;justify-content:space-between;font-size:.8rem;padding:.25rem 0;border-bottom:1px solid var(--border)}
.agent-modal-row:last-child{border:none}
.agent-modal-key{color:var(--muted)}.agent-modal-val{font-weight:600;color:var(--text);text-align:right;max-width:58%}
.agent-modal-fx{grid-column:1/-1;margin-top:.65rem;font-size:.82rem;line-height:1.6;color:var(--muted);background:var(--bg);padding:.65rem .9rem;border-radius:7px;border:1px solid var(--border)}
</style>

<div class="agent-wrap">
  <div class="agent-header">
    <h2>&#129504; OPTCG Agent</h2>
    <div class="agent-status">
      <div class="agent-dot" id="agentStatusDot"></div>
      <span id="agentStatusTxt">Carregando base…</span>
    </div>
  </div>

  <div class="agent-subtabs">
    <button class="agent-subtab active" id="agentSubTab-chat"   onclick="_switchAgentTab('chat')">&#128172; Chat</button>
    <button class="agent-subtab"        id="agentSubTab-search" onclick="_switchAgentTab('search')">&#127183; Buscar</button>
    <button class="agent-subtab"        id="agentSubTab-deck"   onclick="_switchAgentTab('deck')">&#128196; Deck</button>
  </div>

  <!-- CHAT -->
  <div class="agent-subpanel agent-subpanel-on" id="agentSubPanel-chat">
    <div class="agent-quickbtns">
      <button class="agent-qbtn" onclick="agentQuickAsk('Shanks com custo 10 — quais existem e como jogar?')">Shanks c10</button>
      <button class="agent-qbtn" onclick="agentQuickAsk('Life 2, oponente ataca meu Leader com 6000pw — counter ou aceitar?')">Counter Life 2?</button>
      <button class="agent-qbtn" onclick="agentQuickAsk('Como funciona a curva par vs ímpar?')">Curva par/ímpar</button>
      <button class="agent-qbtn" onclick="agentQuickAsk('Quais Leaders vermelhos existem?')">Leaders Red</button>
      <button class="agent-qbtn" onclick="agentQuickAsk('Sequência de batalha passo a passo')">Batalha</button>
      <button class="agent-qbtn" onclick="agentQuickAsk('Oponente tem 2 Blockers e Life 3. Burn ou Removal?')">Burn vs Removal</button>
    </div>
    <div class="agent-msgs" id="agentMsgs"></div>
    <div class="agent-input-row">
      <textarea id="agentInput" placeholder="Pergunte sobre regras, cartas, estratégias ou cole um código de deck…"></textarea>
      <button class="agent-send-btn" id="agentSendBtn" onclick="sendAgentMsg()">&#10148;</button>
    </div>
  </div>

  <!-- SEARCH -->
  <div class="agent-subpanel" id="agentSubPanel-search">
    <div class="agent-search-grid-2">
      <div>
        <label>Nome da carta</label>
        <input type="text" class="agent-sfield" id="agentNameFilter" placeholder="ex: Luffy, Shanks…">
      </div>
      <div>
        <label>Texto do efeito</label>
        <input type="text" class="agent-sfield" id="agentEffectFilter" placeholder="ex: Rush, Blocker, K.O…">
      </div>
    </div>
    <div class="agent-search-grid-4">
      <div>
        <label>Cor</label>
        <select class="agent-sfield" id="agentColorFilter">
          <option value="">Todas</option>
          <option>Red</option><option>Blue</option><option>Green</option>
          <option>Purple</option><option>Black</option><option>Yellow</option>
        </select>
      </div>
      <div>
        <label>Tipo</label>
        <select class="agent-sfield" id="agentTypeFilter">
          <option value="">Todos</option>
          <option>Leader</option><option>Character</option><option>Event</option><option>Stage</option>
        </select>
      </div>
      <div>
        <label>Custo</label>
        <input type="number" class="agent-sfield" id="agentCostFilter" min="0" max="12" placeholder="ex: 10">
      </div>
      <div>
        <label>Raridade</label>
        <select class="agent-sfield" id="agentRarityFilter">
          <option value="">Todas</option>
          <option>C</option><option>UC</option><option>R</option>
          <option>SR</option><option>SEC</option><option value="L">L</option>
        </select>
      </div>
    </div>
    <div class="agent-search-grid-4">
      <div>
        <label>Set</label>
        <select class="agent-sfield" id="agentSetFilter"><option value="">Todos</option></select>
      </div>
      <div>
        <label>Power mín.</label>
        <input type="number" class="agent-sfield" id="agentPowerFilter" step="1000" placeholder="ex: 10000">
      </div>
      <div>
        <label>Atributo</label>
        <select class="agent-sfield" id="agentAttrFilter">
          <option value="">Todos</option>
          <option>Slash</option><option>Strike</option><option>Ranged</option>
          <option>Special</option><option>Wisdom</option>
        </select>
      </div>
      <div style="display:flex;align-items:flex-end;gap:.5rem">
        <button class="btn btn-primary btn-sm" onclick="doAgentSearch()">&#128269; Buscar</button>
        <button class="btn btn-outline btn-sm" onclick="clearAgentSearch()">Limpar</button>
      </div>
    </div>
    <div id="agentSearchInfo">Use os filtros para buscar na base local.</div>
    <div class="agent-search-results" id="agentSearchGrid"></div>
  </div>

  <!-- DECK -->
  <div class="agent-subpanel" id="agentSubPanel-deck">
    <div class="agent-deck-layout">
      <div class="agent-deck-sidebar">
        <div class="agent-deck-input">
          <label>Código do deck</label>
          <textarea id="agentDeckCode" placeholder="4xOP16-0914xOP16-092…"></textarea>
          <button class="btn btn-primary btn-sm" style="width:100%;margin-top:.5rem;justify-content:center" onclick="loadAgentDeck()">&#8595; Carregar</button>
        </div>
        <div class="agent-deck-stats">
          <div class="agent-stat-mini"><div class="sm-label">Total</div><div class="sm-val" id="agentDeckTotal">—</div></div>
          <div class="agent-stat-mini"><div class="sm-label">Únicas</div><div class="sm-val" id="agentDeckUnique">—</div></div>
          <div class="agent-stat-mini"><div class="sm-label">Custo médio</div><div class="sm-val" id="agentDeckAvg">—</div></div>
          <div class="agent-stat-mini"><div class="sm-label">Power médio</div><div class="sm-val" id="agentDeckPw">—</div></div>
          <div class="agent-stat-mini" style="grid-column:1/-1"><div class="sm-label">Cores</div><div class="sm-val" style="font-size:.88rem" id="agentDeckColors">—</div></div>
        </div>
        <div class="agent-deck-parity" id="agentDeckParity">—</div>
        <button class="btn btn-outline btn-sm" style="width:100%;justify-content:center"
                onclick="_switchAgentDeckTab('analysis');_switchAgentTab('deck')">&#129504; Análise IA</button>
        <div id="agentDeckList" style="max-height:300px;overflow-y:auto;margin-top:.25rem"></div>
      </div>
      <div class="agent-deck-main">
        <div class="agent-deck-tabs">
          <button class="agent-deck-tab active" id="agentDeckTab-overview"  onclick="_switchAgentDeckTab('overview')">Visão geral</button>
          <button class="agent-deck-tab"        id="agentDeckTab-grid"      onclick="_switchAgentDeckTab('grid')">Grid</button>
          <button class="agent-deck-tab"        id="agentDeckTab-analysis"  onclick="_switchAgentDeckTab('analysis')">Análise IA</button>
        </div>
        <div id="agentDeckPanel-overview" class="agent-subpanel agent-subpanel-on">
          <div style="background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:.9rem 1rem">
            <div style="font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);margin-bottom:.5rem">Curva de Mana</div>
            <div class="agent-curve-bars" id="agentCurveBars">
              <div style="color:var(--muted);font-size:.8rem;align-self:center">Carregue um deck</div>
            </div>
          </div>
        </div>
        <div id="agentDeckPanel-grid"     class="agent-subpanel"><div class="agent-deck-img-grid" id="agentDeckGrid"></div></div>
        <div id="agentDeckPanel-analysis" class="agent-subpanel">
          <div id="agentAnalysisContent" style="color:var(--muted);font-size:.88rem;padding:.5rem 0">
            Carregue um deck e clique em <strong>Análise IA</strong>.
          </div>
        </div>
      </div>
    </div>
  </div>
</div>

<div id="agentCardModal">
  <div class="agent-modal-box">
    <button class="agent-modal-close" onclick="document.getElementById('agentCardModal').classList.remove('open')">&times;</button>
    <div id="agentCardModalBody"></div>
  </div>
</div>
`; }

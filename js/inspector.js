// ── API Field Inspector ────────────────────────────────────────────────────

function toggleInspector() {
    const card = document.getElementById('inspectorCard');
    if (card.style.display === 'none') {
        buildInspector();
        card.style.display = '';
        // ensure body is not collapsed
        document.getElementById('inspector-body').classList.remove('collapsed');
    } else {
        card.style.display = 'none';
    }
}

function syntaxHighlight(json) {
    // Escape HTML then colorise keys, strings, numbers, booleans, nulls
    return json
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, match => {
            if (/^"/.test(match)) {
                if (/:$/.test(match)) return `<span class="inspector-key">${match}</span>`;
                return `<span class="inspector-str">${match}</span>`;
            }
            if (/true|false/.test(match)) return `<span class="inspector-bool">${match}</span>`;
            if (/null/.test(match))       return `<span class="inspector-null">${match}</span>`;
            return `<span class="inspector-num">${match}</span>`;
        });
}

function makeBlock(id, data) {
    const json = JSON.stringify(data, null, 2);
    const highlighted = syntaxHighlight(json);
    return `<div class="inspector-block" id="${id}">` +
        `<button class="inspector-copy" onclick="copyInspector('${id}','${id}-btn')" id="${id}-btn">Copy</button>` +
        highlighted +
        `</div>`;
}

function copyInspector(blockId, btnId) {
    const text = document.getElementById(blockId).innerText.replace(/^Copy\n?/, '');
    navigator.clipboard.writeText(text).then(() => {
        const btn = document.getElementById(btnId);
        btn.textContent = 'Copied!';
        setTimeout(() => btn.textContent = 'Copy', 1800);
    });
}

function buildInspector() {
    const container = document.getElementById('inspectorSections');
    container.innerHTML = '';

    if (!App.allEventData || App.allEventData.length === 0) {
        container.innerHTML = '<p style="color:var(--loss)">No event data loaded yet. Fetch data first.</p>';
        return;
    }

    // Pick the first event that has rounds
    const ev = App.allEventData.find(e => e?.rounds?.length) || App.allEventData[0];

    // 1. Top-level event history keys (strip rounds for brevity, show separately)
    const evTop = Object.fromEntries(
        Object.entries(ev).filter(([k]) => k !== 'rounds')
    );

    // 2. Nested event object (if present)
    const evNested = ev.event ?? null;

    // 3. First round object
    const round0 = ev.rounds?.[0] ?? null;

    // 4. opponent_users entry (if present)
    const oppUser = round0?.opponent_users?.[0] ?? null;

    const sections = [
        { label: 'Event History — top-level fields (rounds excluded)', id: 'isp-evtop', data: evTop },
        { label: 'Event History — nested `event` object', id: 'isp-evnested', data: evNested },
        { label: 'Round object — rounds[0]', id: 'isp-round', data: round0 },
        { label: 'Opponent user — rounds[0].opponent_users[0]', id: 'isp-oppuser', data: oppUser },
    ];

    for (const s of sections) {
        const div = document.createElement('div');
        div.className = 'inspector-section';
        div.innerHTML = `<h3>${s.label}</h3>` + (s.data !== null ? makeBlock(s.id, s.data) : `<p style="color:var(--muted);font-size:0.82rem;">Not present in this event.</p>`);
        container.appendChild(div);
    }
}

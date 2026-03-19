// ── Fetch & Analyze ────────────────────────────────────────────────────────

// Core fetch+cache logic for a single user. Returns { newCount, totalCount }.
// onProgress(text, pct) is called to update the shared progress bar.
async function fetchUserEvents(user, onProgress) {
    const token = user.token;
    // Fetch multiple tab/flag combinations to capture both open and completed events,
    // then deduplicate by event ID so each event is processed only once.
    const BASE = `${BANDAI_API_BASE}/api/user/my/event?favorite=0&game_title_id=&limit=1000&offset=0`;
    const tabCombos = [
        `${BASE}&past_event_display_flg=1&selected_tab=3`, // past/completed (original)
        `${BASE}&past_event_display_flg=0&selected_tab=1`, // upcoming / registered
        `${BASE}&past_event_display_flg=0&selected_tab=2`, // ongoing / today
        `${BASE}&past_event_display_flg=0&selected_tab=3`, // all events no past filter
        `${BASE}&past_event_display_flg=1&selected_tab=1`,
        `${BASE}&past_event_display_flg=1&selected_tab=2`,
    ];
    const tabResults = await Promise.all(
        tabCombos.map((url, i) =>
            fetch(url, { headers: { 'X-Authentication': token } })
                .then(r => r.ok ? r.json().then(j => ({ tab: i + 1, url, count: j?.success?.events?.length ?? 0, events: j?.success?.events ?? [] })) : { tab: i + 1, url, count: 0, events: [] })
                .catch(() => ({ tab: i + 1, url, count: 0, events: [] }))
        )
    );
    console.log('[BandaiTabs]', tabResults.map(r => `tab${r.tab}(${r.url.split('selected_tab=')[1]}): ${r.count} events`));
    const eventMap = new Map();
    for (const result of tabResults) {
        for (const ev of result.events) {
            if (!eventMap.has(ev.id)) eventMap.set(ev.id, ev);
        }
    }
    const events = [...eventMap.values()];
    if (events.length === 0) throw new Error(`No events found for ${user.name} — all tab requests failed`);

    // Merge server KV cache before using local — shares data across all browsers/sessions
    await pullServerCache(user.bandaiId);

    const cache       = loadCache(user.bandaiId);
    const newEvents   = events.filter(ev => !cache[String(ev.id)]);
    const cachedCount = events.length - newEvents.length;

    // Patch metadata on cached entries
    for (const ev of events) {
        if (cache[String(ev.id)]) {
            const entry = cache[String(ev.id)];
            entry._start_datetime  = ev.start_datetime;
            entry._event_name      = ev.name ?? ev.event_name ?? ev.title
                ?? entry.event?.series_title ?? null;
            entry._store_name      = ev.organizer_name ?? ev.organizer ?? ev.organization_name
                ?? ev.hosted_by ?? ev.store_name ?? ev.shop_name ?? ev.venue_name
                ?? ev.store?.name ?? ev.shop?.name ?? ev.organizer?.name ?? null;
            entry._capacity        = ev.capacity ?? ev.max_capacity ?? ev.max_entry_count ?? null;
            if (entry._rank == null && entry.user?.rank != null)
                entry._rank = entry.user.rank;
            if (entry._match_points == null && entry.user?.match_point != null)
                entry._match_points = Number(entry.user.match_point);
        }
    }

    const baseHeaders = {
        'X-Authentication': token,
        'X-Accept-Version': 'v1',
        'Accept': 'application/json, text/plain, */*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
        'Origin': 'https://www.bandai-tcg-plus.com',
        'Referer': 'https://www.bandai-tcg-plus.com/'
    };

    // Helper: fetch event detail from /api/user/my/event/{id}
    async function fetchEventDetail(eventId) {
        try {
            const r = await fetch(
                `${BANDAI_API_BASE}/api/user/my/event/${eventId}`,
                { headers: baseHeaders }
            );
            if (!r.ok) return null;
            const ev = (await r.json())?.success?.event;
            if (!ev) return null;
            return {
                applicant_count:    ev.count_applicants       ?? null,
                max_join_count:     ev.max_join_count          ?? null,
                entry_fee:          ev.entry_fee != null ? parseFloat(ev.entry_fee) : null,
                entry_fee_currency: ev.entry_fee_currency_code ?? null,
                status:             ev.status_name             ?? null,
            };
        } catch { return null; }
    }

    if (newEvents.length > 0) {
        for (let i = 0; i < newEvents.length; i++) {
            const ev = newEvents[i];
            onProgress(
                `${user.name}: fetching ${i + 1}/${newEvents.length} new events (${cachedCount} cached)…`,
                Math.round((i / newEvents.length) * 100)
            );
            const evResp = await fetch(
                `${BANDAI_API_BASE}/api/user/event/${ev.id}/history`,
                { headers: baseHeaders }
            );
            if (evResp.ok) {
                const evData = (await evResp.json()).success;
                evData._start_datetime  = ev.start_datetime;
                evData._event_name      = ev.name ?? ev.event_name ?? ev.title
                    ?? evData.event?.name ?? evData.event?.event_name
                    ?? evData.event?.series_title ?? null;
                evData._rank            = evData.user?.rank ?? null;
                evData._match_points    = evData.user?.match_point != null
                    ? Number(evData.user.match_point) : null;
                evData._store_name      = ev.organizer_name ?? ev.organizer ?? ev.organization_name
                    ?? ev.hosted_by ?? ev.store_name ?? ev.shop_name ?? ev.venue_name
                    ?? ev.store?.name ?? ev.shop?.name ?? ev.organizer?.name
                    ?? evData.event?.organizer_name ?? evData.event?.organizer
                    ?? evData.event?.organization_name ?? evData.event?.hosted_by
                    ?? evData.event?.store_name ?? evData.event?.shop_name
                    ?? evData.event?.venue_name ?? evData.event?.store?.name
                    ?? evData.event?.organizer?.name ?? null;
                evData._capacity        = ev.capacity ?? ev.max_capacity
                    ?? ev.max_entry_count
                    ?? evData.event?.capacity ?? evData.event?.max_capacity ?? null;

                // Fetch extra detail (applicant count, capacity, entry fee, status) from the detail endpoint
                const detail = await fetchEventDetail(ev.id);
                evData._applicant_count    = detail?.applicant_count    ?? null;
                evData._capacity           = detail?.max_join_count     ?? evData._capacity;
                evData._entry_fee          = detail?.entry_fee          ?? null;
                evData._entry_fee_currency = detail?.entry_fee_currency ?? null;
                evData._status             = detail?.status             ?? null;
                await sleep(300);

                cache[String(ev.id)] = evData;
            }
            await sleep(300);
        }
    }

    // Backfill detail for cached events still missing applicant count or entry fee,
    // or with a suspiciously high BRL entry fee (> 150) which indicates a corrupted cache value.
    const missingDetail = events.filter(ev => {
        const entry = cache[String(ev.id)];
        if (!entry) return false;
        const suspiciousFee = entry._entry_fee != null
            && entry._entry_fee > 150
            && (entry._entry_fee_currency ?? '').toUpperCase() !== 'USD';
        if (suspiciousFee) entry._entry_fee = null; // force re-fetch
        return entry._applicant_count == null || entry._entry_fee == null;
    });
    if (missingDetail.length > 0) {
        for (let i = 0; i < missingDetail.length; i++) {
            const ev = missingDetail[i];
            onProgress(
                `${user.name}: backfilling event detail ${i + 1}/${missingDetail.length}…`,
                Math.round((i / missingDetail.length) * 100)
            );
            const detail = await fetchEventDetail(ev.id);
            if (detail) {
                const entry = cache[String(ev.id)];
                if (detail.applicant_count    != null) entry._applicant_count    = detail.applicant_count;
                if (detail.max_join_count     != null) entry._capacity           = detail.max_join_count;
                if (detail.entry_fee          != null) entry._entry_fee          = detail.entry_fee;
                if (detail.entry_fee_currency != null) entry._entry_fee_currency = detail.entry_fee_currency;
                if (detail.status             != null) entry._status             = detail.status;
            }
            await sleep(300);
        }
    }

    // Always save — metadata patches are applied to cached entries regardless of new events.
    saveCache(user.bandaiId, cache);

    return { newCount: newEvents.length, totalCount: events.length };
}

// Sync new events for every user with a token, then re-render the currently selected user.
async function syncAllUsers() {
    if (App.usersWithToken.length === 0) return;

    clearError();
    document.getElementById('progress').style.display = 'block';
    document.getElementById('fetchBtn').disabled     = true;
    document.getElementById('syncAllBtn').disabled   = true;
    document.getElementById('loadCacheBtn').disabled = true;

    const results = []; // { name, newCount, totalCount, error }

    try {
        for (let u = 0; u < App.usersWithToken.length; u++) {
            const user = App.usersWithToken[u];
            const pctBase = Math.round((u / App.usersWithToken.length) * 90);
            const pctNext = Math.round(((u + 1) / App.usersWithToken.length) * 90);
            setProgress(`Syncing ${u + 1}/${App.usersWithToken.length}: ${user.name}…`, pctBase);
            try {
                const { newCount, totalCount } = await fetchUserEvents(user, (text, pct) => {
                    const scaled = pctBase + Math.round(pct / 100 * (pctNext - pctBase));
                    setProgress(text, scaled);
                });
                results.push({ name: user.name, newCount, totalCount, error: null });
            } catch (err) {
                results.push({ name: user.name, newCount: 0, totalCount: 0, error: err.message });
            }
            updateCacheBar(App.usersWithToken[parseInt(document.getElementById('userSelect').value || '0')]?.bandaiId);
        }

        setProgress('All users synced!', 100);
        setTimeout(() => { document.getElementById('progress').style.display = 'none'; }, 800);

        // Show a brief summary
        const lines = results.map(r =>
            r.error
                ? `${r.name}: ❌ ${r.error}`
                : `${r.name}: +${r.newCount} new (${r.totalCount} total)`
        ).join('\n');
        console.log('[Sync All]\n' + lines);

        // Re-render the currently selected user if one is active
        const selIdx = document.getElementById('userSelect').value;
        if (selIdx !== '') {
            const user = App.usersWithToken[parseInt(selIdx)];
            const cache = loadCache(user.bandaiId);
            const allEventData = Object.values(cache).sort((a, b) =>
                new Date(b._start_datetime) - new Date(a._start_datetime));
            App.allEventData = allEventData;
            updateCacheBar(user.bandaiId);

            let totalW = 0, totalL = 0;
            for (const ev of allEventData) {
                if (!ev?.rounds) continue;
                for (const r of ev.rounds) { if (r.is_win) totalW++; else totalL++; }
            }
            const periodMap = {};
            for (const p of SET_PERIODS) periodMap[p.name] = { w: 0, l: 0 };
            for (const ev of allEventData) {
                if (!ev?.rounds) continue;
                const period = ev._start_datetime
                    ? getPeriodForDate(ev._start_datetime) : SET_PERIODS[0].name;
                for (const r of ev.rounds) {
                    if (r.is_win) periodMap[period].w++; else periodMap[period].l++;
                }
            }
            const playerMap = {};
            for (const ev of allEventData) {
                if (!ev?.rounds) continue;
                for (const r of ev.rounds) {
                    const pid = r.opponent_users?.[0]?.membership_number;
                    if (!pid) continue;
                    if (!playerMap[pid]) playerMap[pid] = [0, 0];
                    if (r.is_win) playerMap[pid][0]++; else playerMap[pid][1]++;
                }
            }
            App.playerResults = playerMap;

            buildFilterChips(allEventData);
            buildStoreFilter(allEventData);
            buildCompareCard();
            displayResults(user.name, totalW, totalL, periodMap, playerMap, allEventData);
        }

        // Show the tab nav and refresh rankings if visible
        document.getElementById('tabNav').style.display = 'flex';
        if (document.getElementById('rankingsTab').style.display !== 'none') buildGlobalRankings();

        // Show summary in a status line under the buttons
        const summaryEl = document.getElementById('syncAllSummary');
        if (summaryEl) {
            const newTotal = results.reduce((s, r) => s + r.newCount, 0);
            const errCount = results.filter(r => r.error).length;
            summaryEl.textContent = errCount
                ? `Sync complete — ${newTotal} new events across ${results.length} users (${errCount} error${errCount>1?'s':''})`
                : `Sync complete — ${newTotal} new event${newTotal !== 1 ? 's' : ''} across ${results.length} users`;
            summaryEl.style.display = '';
        }

    } catch (err) {
        showError(err.message);
    } finally {
        document.getElementById('fetchBtn').disabled     = false;
        document.getElementById('syncAllBtn').disabled   = App.usersWithToken.length < 2;
        const _selIdx = document.getElementById('userSelect').value;
        document.getElementById('loadCacheBtn').disabled = _selIdx === ''
            || Object.keys(loadCache(App.usersWithToken[parseInt(_selIdx)]?.bandaiId || '')).length === 0;
    }
}

async function fetchAndAnalyze() {
    const idx = document.getElementById('userSelect').value;
    if (idx === '') { showError('Please select a user.'); return; }

    const user  = App.usersWithToken[parseInt(idx)];
    const token = user.token;

    clearError();
    document.getElementById('progress').style.display = 'block';
    document.getElementById('results').style.display  = 'none';
    document.getElementById('fetchBtn').disabled = true;
    document.getElementById('syncAllBtn').disabled = true;

    try {
        // 1 & 2. Fetch + cache new events via shared helper
        setProgress(`Fetching event list for ${user.name}…`, 5);
        await fetchUserEvents(user, (text, pct) => setProgress(text, 5 + Math.round(pct / 100 * 90)));

        // 3. Build full dataset from cache in event-list order
        const cache = loadCache(user.bandaiId);
        const allEventData = Object.values(cache).sort(
            (a, b) => new Date(b._start_datetime) - new Date(a._start_datetime));
        App.allEventData     = allEventData;
        App.selectedPlayerId = null;
        App.selectedStore    = null;
        App.regionalsOnly    = false;
        document.getElementById('playerSearchInput').value = '';
        document.getElementById('vsBanner').style.display  = 'none';
        document.getElementById('dateFrom').value = '';
        document.getElementById('dateTo').value   = '';
        document.getElementById('regionalsOnlyBtn').classList.remove('active');

        updateCacheBar(user.bandaiId);
        setProgress('Processing data…', 97);

        // 3. Overall W/L
        let totalW = 0, totalL = 0;
        for (const ev of allEventData) {
            if (!ev?.rounds) continue;
            for (const r of ev.rounds) { if (r.is_win) totalW++; else totalL++; }
        }

        // 4. By period
        const periodMap = {};
        for (const p of SET_PERIODS) periodMap[p.name] = { w: 0, l: 0 };
        for (const ev of allEventData) {
            if (!ev?.rounds) continue;
            const period = ev._start_datetime
                ? getPeriodForDate(ev._start_datetime) : SET_PERIODS[0].name;
            for (const r of ev.rounds) {
                if (r.is_win) periodMap[period].w++; else periodMap[period].l++;
            }
        }

        // 5. By player
        const playerMap = {};
        for (const ev of allEventData) {
            if (!ev?.rounds) continue;
            for (const r of ev.rounds) {
                const pid = r.opponent_users?.[0]?.membership_number;
                if (!pid) continue;
                if (!playerMap[pid]) playerMap[pid] = [0, 0];
                if (r.is_win) playerMap[pid][0]++; else playerMap[pid][1]++;
            }
        }
        App.playerResults = playerMap;

        setProgress('Done!', 100);
        setTimeout(() => { document.getElementById('progress').style.display = 'none'; }, 600);

        buildFilterChips(allEventData);
        buildStoreFilter(allEventData);
        buildCompareCard();
        displayResults(user.name, totalW, totalL, periodMap, playerMap, allEventData);

        // Show tab nav; if user is already on the rankings tab, refresh it
        document.getElementById('tabNav').style.display = 'flex';
        if (document.getElementById('rankingsTab').style.display !== 'none') buildGlobalRankings();

    } catch (err) {
        document.getElementById('progress').style.display = 'none';
        let msg = err.message;
        if (err instanceof TypeError && err.message.toLowerCase().includes('fetch')) {
            msg = `<strong>Network / CORS error</strong> — the browser blocked the request to the Bandai API.<br><br>
The API is designed for the mobile app and does not include CORS headers.
To bypass this, launch Chrome with web-security disabled:<br><br>
<code>"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --disable-web-security --user-data-dir="%TEMP%\\chrome-no-cors"</code><br><br>
Then open <code>analyzer.html</code> in that window.`;
        }
        showError(msg);
    } finally {
        document.getElementById('fetchBtn').disabled = false;
        document.getElementById('syncAllBtn').disabled = App.usersWithToken.length < 2;
    }
}

// ── Charts ─────────────────────────────────────────────────────────────────

function destroyChart(id) {
    if (App.charts[id]) { App.charts[id].destroy(); delete App.charts[id]; }
}

function displayCharts(totalW, totalL, periodMap, eventData) {
    const card = document.getElementById('chartsCard');
    if (totalW + totalL === 0) { card.style.display = 'none'; return; }
    card.style.display = 'block';

    const accent  = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()   || '#048A81';
    const win     = getComputedStyle(document.documentElement).getPropertyValue('--win').trim()       || '#28a745';
    const loss    = getComputedStyle(document.documentElement).getPropertyValue('--loss').trim()      || '#dc3545';
    const primary = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim()   || '#2E4057';
    const muted   = getComputedStyle(document.documentElement).getPropertyValue('--muted').trim()     || '#6c757d';

    // ── 1. Win / Loss doughnut ──────────────────────────────────────────────
    destroyChart('donut');
    App.charts['donut'] = new Chart(document.getElementById('chartDonut'), {
        type: 'doughnut',
        data: {
            labels: ['Wins', 'Losses'],
            datasets: [{ data: [totalW, totalL], backgroundColor: [win, loss], borderWidth: 0 }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '68%',
            plugins: {
                legend: { position: 'bottom', labels: { font: { size: 11 }, color: muted } },
                tooltip: {
                    callbacks: {
                        label: ctx => {
                            const t = totalW + totalL;
                            const pct = (ctx.parsed / t * 100).toFixed(1);
                            return ` ${ctx.parsed} (${pct}%)`;
                        }
                    }
                }
            }
        }
    });

    // ── 2. Results by Set Period bar chart ─────────────────────────────────
    destroyChart('periodBar');
    const periodLabels = [], periodWins = [], periodLosses = [];
    for (const p of SET_PERIODS) {
        const s = periodMap[p.name];
        if (!s || (s.w === 0 && s.l === 0)) continue;
        periodLabels.push(p.name.split(' · ')[0]); // short label
        periodWins.push(s.w);
        periodLosses.push(s.l);
    }
    App.charts['periodBar'] = new Chart(document.getElementById('chartPeriodBar'), {
        type: 'bar',
        data: {
            labels: periodLabels,
            datasets: [
                { label: 'Wins',   data: periodWins,   backgroundColor: win  + 'cc', borderRadius: 4 },
                { label: 'Losses', data: periodLosses, backgroundColor: loss + 'cc', borderRadius: 4 }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { stacked: false, ticks: { font: { size: 10 }, color: muted }, grid: { display: false } },
                y: { beginAtZero: true, ticks: { precision: 0, color: muted }, grid: { color: '#eee' } }
            },
            plugins: {
                legend: { position: 'bottom', labels: { font: { size: 11 }, color: muted } },
                tooltip: {
                    callbacks: {
                        footer: items => {
                            const idx  = items[0].dataIndex;
                            const w    = periodWins[idx];
                            const l    = periodLosses[idx];
                            const t    = w + l;
                            const pct  = t > 0 ? (w / t * 100).toFixed(1) : '0.0';
                            return `Win rate: ${pct}%`;
                        }
                    }
                }
            }
        }
    });

    // ── 3. Win rate over time (per tournament, chronological) ──────────────
    destroyChart('timeline');
    const evListChron = [...(eventData || [])].filter(ev => ev?.rounds && ev._start_datetime);
    evListChron.sort((a, b) => new Date(a._start_datetime) - new Date(b._start_datetime));

    const timeLabels = [], timeWinRates = [], timeTotals = [], timeRolling = [];
    let cumW = 0, cumL = 0;
    const ROLLING_N = 5;
    for (let i = 0; i < evListChron.length; i++) {
        const ev = evListChron[i];
        for (const r of ev.rounds) { if (r.is_win) cumW++; else cumL++; }
        const t   = cumW + cumL;
        timeWinRates.push(t > 0 ? parseFloat((cumW / t * 100).toFixed(1)) : 0);
        timeTotals.push(t);
        timeLabels.push(fmtDate(ev._start_datetime));
        // Rolling window
        let rW = 0, rL = 0;
        for (let j = Math.max(0, i - ROLLING_N + 1); j <= i; j++) {
            for (const r of evListChron[j].rounds) { if (r.is_win) rW++; else rL++; }
        }
        const rt = rW + rL;
        timeRolling.push(rt > 0 ? parseFloat((rW / rt * 100).toFixed(1)) : null);
    }

    App.charts['timeline'] = new Chart(document.getElementById('chartTimeline'), {
        type: 'line',
        data: {
            labels: timeLabels,
            datasets: [
            {
                label: 'Cumulative Win %',
                data: timeWinRates,
                borderColor: accent,
                backgroundColor: accent + '22',
                fill: true,
                tension: 0.3,
                pointRadius: evListChron.length > 40 ? 0 : 3,
                pointHoverRadius: 5,
                borderWidth: 2
            },
            {
                label: `Rolling ${ROLLING_N} Win %`,
                data: timeRolling,
                borderColor: primary,
                backgroundColor: 'transparent',
                fill: false,
                tension: 0.3,
                pointRadius: 0,
                pointHoverRadius: 4,
                borderWidth: 1.5,
                borderDash: [5, 3]
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    ticks: {
                        font: { size: 9 }, color: muted,
                        maxTicksLimit: 12,
                        maxRotation: 45
                    },
                    grid: { display: false }
                },
                y: {
                    min: 0, max: 100,
                    ticks: {
                        callback: v => v + '%',
                        font: { size: 10 }, color: muted
                    },
                    grid: { color: '#eee' }
                }
            },
            plugins: {
                legend: { position: 'bottom', labels: { font: { size: 11 }, color: muted } },
                tooltip: {
                    callbacks: {
                        title: items => `Tournament: ${items[0].label}`,
                        label: ctx => {
                            if (ctx.datasetIndex === 0)
                                return ` Cumulative: ${ctx.parsed.y}%  (${timeTotals[ctx.dataIndex]} matches)`;
                            return ` Rolling ${ROLLING_N}: ${ctx.parsed.y ?? '—'}%`;
                        }
                    }
                }
            }
        }
    });

    // ── 5. Win Rate by Store ────────────────────────────────────────────────
    {
        const storeMap = {};
        for (const ev of (eventData || [])) {
            if (!ev?.rounds) continue;
            const name = ev._store_name ?? ev.event?.organizer_name ?? ev.event?.organizer
                ?? ev.event?.store_name ?? ev.event?.shop_name ?? null;
            if (!name) continue;
            if (!storeMap[name]) storeMap[name] = { w: 0, l: 0 };
            for (const r of ev.rounds) {
                if (r.is_win) storeMap[name].w++; else storeMap[name].l++;
            }
        }
        const storePanel = document.getElementById('storeChartPanel');
        const storeEntries = Object.entries(storeMap)
            .filter(([, s]) => s.w + s.l >= 2)
            .sort((a, b) => (b[1].w + b[1].l) - (a[1].w + a[1].l));

        if (storeEntries.length === 0) {
            storePanel.style.display = 'none';
        } else {
            storePanel.style.display = '';
            destroyChart('store');
            App.charts['store'] = new Chart(document.getElementById('chartStore'), {
                type: 'bar',
                data: {
                    labels: storeEntries.map(([name]) => name),
                    datasets: [
                        { label: 'Wins',   data: storeEntries.map(([,s]) => s.w), backgroundColor: win  + 'cc', borderRadius: 4 },
                        { label: 'Losses', data: storeEntries.map(([,s]) => s.l), backgroundColor: loss + 'cc', borderRadius: 4 }
                    ]
                },
                options: {
                    indexAxis: 'y',
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        x: { stacked: true, ticks: { font: { size: 10 }, color: muted }, grid: { color: '#eee' } },
                        y: { stacked: true, ticks: { font: { size: 10 }, color: muted }, grid: { display: false } }
                    },
                    plugins: {
                        legend: { position: 'bottom', labels: { font: { size: 11 }, color: muted } },
                        tooltip: { callbacks: {
                            afterBody: items => {
                                const [, s] = storeEntries[items[0].dataIndex];
                                const t = s.w + s.l;
                                return [`Win rate: ${(s.w / t * 100).toFixed(1)}%  (${t} matches)`];
                            }
                        }}
                    }
                }
            });
        }
    }

    // ── 6. Streak History (bar) ─────────────────────────────────────────────
    {
        const evsSorted = [...(eventData || [])]
            .filter(ev => ev?.rounds && ev._start_datetime)
            .sort((a, b) => new Date(a._start_datetime) - new Date(b._start_datetime));

        const streakLabels = [];
        const streakData   = [];
        let cur = 0, curType = null;
        for (const ev of evsSorted) {
            for (const r of ev.rounds) {
                if (r.is_win) {
                    cur = curType === 'W' ? cur + 1 : 1;
                    curType = 'W';
                } else {
                    cur = curType === 'L' ? cur + 1 : 1;
                    curType = 'L';
                }
            }
            streakLabels.push(fmtDate(ev._start_datetime));
            streakData.push(curType === 'W' ? cur : -cur);
        }

        destroyChart('streak');
        App.charts['streak'] = new Chart(document.getElementById('chartStreak'), {
            type: 'bar',
            data: {
                labels: streakLabels,
                datasets: [{
                    label: 'Streak',
                    data: streakData,
                    backgroundColor: streakData.map(v => v > 0 ? win + 'cc' : loss + 'cc'),
                    borderRadius: 3
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { ticks: { font: { size: 9 }, color: muted, maxTicksLimit: 14, maxRotation: 45 }, grid: { display: false } },
                    y: { ticks: { font: { size: 10 }, color: muted,
                            callback: v => v > 0 ? `+${v}W` : `${Math.abs(v)}L`
                         }, grid: { color: '#eee' } }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: { callbacks: {
                        title: items => `Tournament: ${items[0].label}`,
                        label: ctx => {
                            const v = ctx.parsed.y;
                            return v > 0 ? ` Win streak: ${v}` : ` Loss streak: ${Math.abs(v)}`;
                        }
                    }}
                }
            }
        });
    }
}

const AUTH_BASE = 'https://bandai-auth.rdgosmartins.workers.dev';

// Base URL for all Bandai API calls.
// When hosted online, this points to the Cloudflare CORS proxy.
// For local use with --disable-web-security, change to:
//   'https://api.bandai-tcg-plus.com'
const BANDAI_API_BASE = 'https://bandai-proxy.rdgosmartins.workers.dev';

const SET_PERIODS = [
    { name: "Pre OP-01",                              date: null },
    { name: "OP-01 · Romance Dawn",                   date: new Date("2022-12-02") },
    { name: "OP-02 · Paramount War",                  date: new Date("2023-03-10") },
    { name: "OP-03 · Pillars of Strength",            date: new Date("2023-06-02") },
    { name: "OP-04 · Kingdoms of Intrigue",           date: new Date("2023-09-01") },
    { name: "OP-05 · Awakening of the New Era",       date: new Date("2023-11-03") },
    { name: "OP-06 · Wings of the Captain",           date: new Date("2024-02-23") },
    { name: "OP-07 · 500 Years in the Future",        date: new Date("2024-06-28") },
    { name: "OP-08 · Two Legends",                    date: new Date("2024-09-13") },
    { name: "OP-09 · Emperors in the New World",      date: new Date("2024-12-13") },
    { name: "OP-10 · Royal Blood",                    date: new Date("2025-03-21") },
    { name: "OP-11 · A Fist of Divine Speed",         date: new Date("2025-06-06") },
    { name: "OP-12 · Legacy of the Master",           date: new Date("2025-08-22") },
    { name: "OP-13 · Carrying On His Will",           date: new Date("2025-11-07") },
    { name: "OP-14 / EB-04 · The Azure Sea's Seven",  date: new Date("2026-01-16") },
];

const REGIONALS = [
    { date: "2025-08-02", name: "One Piece Offline Regionals 02/05 - Day 1" },
    { date: "2025-08-03", name: "One Piece Offline Regionals 02/05 - Day 2" },
    { date: "2025-11-08", name: "Latam TCG One Piece Regional - Brazil" },
    { date: "2025-11-09", name: "Offline Treasure Cup - Brazil Day 2" },
];

// Players whose events only count when at least one other mapped player attended the same tournament.
const RESTRICTED_TO_SHARED = ['jaime', 'nathan', 'elias'];

// Yoko team member names (substring match against user names, case-insensitive)
const YOKO_PLAYERS = [
    'rodrigo','mori','chico','amanda','vasco','ambuxa','moura',
    'taj','massaro','liarmo','cerjo','menta','jaime','ike','elias','sampley'
];

const PALETTE = [
    '#048A81','#c9a84c','#e05252','#5b8dee','#9b59b6',
    '#e67e22','#1abc9c','#e91e63','#3498db','#f39c12'
];

// Global mutable state
window.App = {
    usersWithToken: [],
    usernameMap: {},
    allEventData: [],
    playerResults: null,
    opponentMatchHistory: {},
    selectedPlayerId: null,
    acHighlight: -1,
    selectedStore: null,
    regionalsOnly: false,
    charts: {},
    rankStore: null,
    rankDatePreset: 'all',
    rankRegionalsOnly: false,
    podiumSort: 'pct',
    lastLeaderboardUsers: null,
    storeH2HUsers: [],
    competitiveBadges: null,   // { reiDosPiratas: {year: {bandaiId,name,winRate}}, yonkou: [], shichibukai: [], month }
    profileDirectory: {},      // { 'bandainame_lower' → publicProfile }
    // Teams — Worst Generation tab
    teams: [],                 // sanitized team list [{ id, name, color, icon, createdAt, updatedAt }]
    teamById: {},              // id → team
    teamByBandaiId: {},        // bandaiId_lower → teamId (derived from directory + username map)
    teamResults: null,         // { teamId: { w, l, events, members } }
    teamH2H: null,             // { teamIdA: { teamIdB: { w, l } } }
    teamVersion: 0,            // invalidator: bump when the team registry changes
};
const CACHE_PREFIX = 'bandai_events_';

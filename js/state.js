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
    yokoLoading: false,
    competitiveBadges: null,   // { reiDosPiratas: {year: {bandaiId,name,winRate}}, yonkou: [], shichibukai: [], month }
};
const CACHE_PREFIX = 'bandai_events_';

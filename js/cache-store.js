// ── CacheStore: armazenamento local do cache de eventos ─────────────────────────
// Guarda o cache de eventos por Bandai ID em IndexedDB (centenas de MB), em vez do
// localStorage (~5 MB), que enchia por causa do /cache-all (cache de todos os jogadores).
//
// A API de leitura continua SÍNCRONA (loadCache() é chamado em ~25 lugares): os dados
// ficam espelhados em memória e a gravação no IndexedDB é feita em segundo plano
// (write-behind, em lote). `CacheStore.ready` resolve quando o espelho foi carregado e
// os dados antigos do localStorage (chaves bandai_events_*) foram migrados.
//
// Fallback: sem IndexedDB (modo privado antigo, bloqueado, etc.) usa o localStorage como
// antes; se a gravação falhar, o dado fica só em memória e hasUnpersisted() devolve true.

const CacheStore = (() => {
    const DB_NAME = 'yoko-cache';
    const DB_VERSION = 1;
    const STORE = 'events';
    const LEGACY_PREFIX = (typeof CACHE_PREFIX !== 'undefined') ? CACHE_PREFIX : 'bandai_events_';
    const FLUSH_DELAY_MS = 50;

    const mem = {};                  // bandaiId -> { eventId: registro }   (espelho síncrono)
    const dirty = new Set();         // ids com gravação pendente (put, ou delete se mem[id] === undefined)
    const unpersisted = new Set();   // ids cuja gravação falhou: ficam só em memória
    let db = null;
    let mode = 'pending';            // 'pending' | 'idb' | 'localstorage'
    let isReady = false;
    let flushTimer = null;
    let flushChain = Promise.resolve();
    let onStatusChange = null;

    function notify() { try { if (typeof onStatusChange === 'function') onStatusChange(); } catch { /* ignore */ } }

    function normalize(map) {
        return (typeof normalizeCacheMap === 'function') ? normalizeCacheMap(map) : (map || {});
    }

    function mergeMaps(a, b) {
        if (typeof mergeEventRecords !== 'function') return { ...a, ...b };
        const out = {};
        for (const id of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) {
            out[id] = mergeEventRecords((a || {})[id], (b || {})[id]);
        }
        return out;
    }

    function openDb() {
        return new Promise((resolve, reject) => {
            if (typeof indexedDB === 'undefined' || !indexedDB) { reject(new Error('IndexedDB indisponível')); return; }
            let req;
            try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch (e) { reject(e); return; }
            req.onupgradeneeded = () => {
                if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error || new Error('Falha ao abrir IndexedDB'));
            req.onblocked = () => reject(new Error('IndexedDB bloqueado'));
        });
    }

    function readAll() {
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readonly');
            const st = tx.objectStore(STORE);
            const keysReq = st.getAllKeys();
            const valsReq = st.getAll();
            tx.oncomplete = () => resolve({ keys: keysReq.result, vals: valsReq.result });
            tx.onerror = tx.onabort = () => reject(tx.error || new Error('Falha ao ler IndexedDB'));
        });
    }

    function legacyKeys() {
        const keys = [];
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k && k.startsWith(LEGACY_PREFIX)) keys.push(k);
            }
        } catch { /* localStorage indisponível */ }
        return keys;
    }

    // Move os dados antigos do localStorage para o IndexedDB e só então apaga as chaves
    // antigas (libera a cota do localStorage). Se algo falhar, nada é apagado.
    async function migrateLegacy() {
        const keys = legacyKeys();
        if (!keys.length) return;
        const migrated = [];
        for (const k of keys) {
            const id = k.slice(LEGACY_PREFIX.length);
            try {
                const parsed = JSON.parse(localStorage.getItem(k) || '{}');
                mem[id] = normalize(mergeMaps(mem[id], normalize(parsed)));
                dirty.add(id);
                migrated.push(k);
            } catch (e) {
                console.warn('[CacheStore] Entrada antiga ilegível, mantida no localStorage:', k, e);
            }
        }
        await flush();
        for (const k of migrated) {
            const id = k.slice(LEGACY_PREFIX.length);
            if (unpersisted.has(id)) continue;   // não gravou: mantém a cópia antiga
            try { localStorage.removeItem(k); } catch { /* ignore */ }
        }
        console.log(`[CacheStore] Migrados ${migrated.length} caches do localStorage para o IndexedDB.`);
    }

    function hydrateFromLocalStorage() {
        for (const k of legacyKeys()) {
            const id = k.slice(LEGACY_PREFIX.length);
            if (id in mem) continue;
            try { mem[id] = normalize(JSON.parse(localStorage.getItem(k) || '{}')); } catch { /* ignore */ }
        }
    }

    async function init() {
        try {
            db = await openDb();
            const { keys, vals } = await readAll();
            keys.forEach((k, i) => { if (!(k in mem)) mem[k] = vals[i] || {}; });   // o que já foi setado antes do ready vence
            mode = 'idb';
            await migrateLegacy();
        } catch (e) {
            console.warn('[CacheStore] IndexedDB indisponível, usando localStorage:', e);
            db = null;
            mode = 'localstorage';
            hydrateFromLocalStorage();
        }
        isReady = true;
        if (dirty.size) scheduleFlush(0);
        notify();
    }

    function scheduleFlush(delay = FLUSH_DELAY_MS) {
        if (flushTimer) return;
        flushTimer = setTimeout(() => { flushTimer = null; flush(); }, delay);
    }

    function flush() {
        if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
        // Encadeia para nunca haver duas transações de escrita competindo.
        flushChain = flushChain.then(() => flushNow()).catch(() => {});
        return flushChain;
    }

    function flushNow() {
        if (!dirty.size) return Promise.resolve();
        const ids = [...dirty];
        dirty.clear();

        if (mode === 'localstorage') {
            for (const id of ids) {
                try {
                    if (mem[id] === undefined) localStorage.removeItem(LEGACY_PREFIX + id);
                    else localStorage.setItem(LEGACY_PREFIX + id, JSON.stringify(mem[id]));
                    unpersisted.delete(id);
                } catch (e) {
                    unpersisted.add(id);
                    console.warn('[CacheStore] Falha ao gravar no localStorage — mantendo em memória:', id, e);
                }
            }
            notify();
            return Promise.resolve();
        }
        if (!db) { ids.forEach(id => dirty.add(id)); return Promise.resolve(); }   // ainda abrindo

        return new Promise(resolve => {
            let tx;
            try {
                tx = db.transaction(STORE, 'readwrite');
                const st = tx.objectStore(STORE);
                for (const id of ids) {
                    if (mem[id] === undefined) st.delete(id);
                    else st.put(mem[id], id);
                }
            } catch (e) {
                ids.forEach(id => { if (mem[id] !== undefined) unpersisted.add(id); });
                console.warn('[CacheStore] Falha ao iniciar gravação no IndexedDB — mantendo em memória:', e);
                notify();
                resolve();
                return;
            }
            tx.oncomplete = () => { ids.forEach(id => unpersisted.delete(id)); notify(); resolve(); };
            const fail = () => {
                ids.forEach(id => { if (mem[id] !== undefined) unpersisted.add(id); });
                console.warn('[CacheStore] Falha ao gravar no IndexedDB — mantendo em memória:', tx.error);
                notify();
                resolve();
            };
            tx.onerror = fail;
            tx.onabort = fail;
        });
    }

    // Garante a gravação ao esconder/fechar a aba.
    if (typeof document !== 'undefined' && document.addEventListener) {
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
    }
    if (typeof window !== 'undefined' && window.addEventListener) {
        window.addEventListener('pagehide', () => { flush(); });
    }

    const ready = init();   // nunca rejeita: init() trata os próprios erros

    return {
        ready,
        get isReady() { return isReady; },
        get mode() { return mode; },
        get(bandaiId) { return mem[bandaiId] || {}; },
        set(bandaiId, map) {
            mem[bandaiId] = map || {};
            dirty.add(bandaiId);
            if (isReady) scheduleFlush();   // antes do ready, o init agenda a gravação
        },
        remove(bandaiId) {
            delete mem[bandaiId];
            unpersisted.delete(bandaiId);
            dirty.add(bandaiId);            // mem[id] === undefined => delete
            if (isReady) scheduleFlush();
            notify();
        },
        ids() { return Object.keys(mem); },
        hasUnpersisted() { return unpersisted.size > 0; },
        flush,
        set onStatusChange(fn) { onStatusChange = fn; },
    };
})();

// Service worker registration and safe cache-version auto update.
(function () {
    const SW_URL = './sw.js';
    const CACHE_KEY = 'hubActiveCacheVersion';
    const LABEL_KEY = 'hubVersion';
    const CACHE_NAME_RE = /CACHE_NAME\s*=\s*['"]([^'"]+)['"]/;
    const WORKER_MESSAGE_TIMEOUT_MS = 2000;

    function fetchWithTimeout(url, options, timeoutMs) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        return fetch(url, Object.assign({}, options, { signal: controller.signal }))
            .finally(() => clearTimeout(timeoutId));
    }

    async function getRemoteCacheName() {
        try {
            const response = await fetchWithTimeout(SW_URL + '?cache-check=' + Date.now(), {
                cache: 'no-store'
            }, 5000);
            if (!response || !response.ok) return null;
            const text = await response.text();
            const match = text.match(CACHE_NAME_RE);
            return match && match[1] ? match[1] : null;
        } catch (error) {
            return null;
        }
    }

    function messageWorker(worker, type, timeoutMs = WORKER_MESSAGE_TIMEOUT_MS) {
        return new Promise((resolve) => {
            if (!worker) {
                resolve(null);
                return;
            }

            const channel = new MessageChannel();
            const timeoutId = setTimeout(() => resolve(null), timeoutMs);
            channel.port1.onmessage = event => {
                clearTimeout(timeoutId);
                resolve(event.data || null);
            };

            try {
                worker.postMessage({ type }, [channel.port2]);
            } catch (error) {
                clearTimeout(timeoutId);
                resolve(null);
            }
        });
    }

    async function getActiveCacheName(registration) {
        const worker = navigator.serviceWorker.controller || registration?.active;
        const response = await messageWorker(worker, 'GET_CACHE_NAME');
        return response?.cacheName || null;
    }

    function warmOptionalCache(registration) {
        const worker = navigator.serviceWorker.controller || registration?.active;
        if (worker) worker.postMessage({ type: 'WARM_OPTIONAL_CACHE' });
    }

    function showUpdateOverlay() {
        let overlay = document.getElementById('appUpdateOverlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'appUpdateOverlay';
            overlay.setAttribute('role', 'status');
            overlay.setAttribute('aria-live', 'polite');
            overlay.innerHTML = [
                '<div class="app-update-box">',
                '<div class="app-update-spinner"></div>',
                '<div class="app-update-title">Подождите</div>',
                '<div class="app-update-text">Идет обновление приложения...</div>',
                '</div>'
            ].join('');
            document.body.appendChild(overlay);
        }

        if (!document.getElementById('appUpdateOverlayStyle')) {
            const style = document.createElement('style');
            style.id = 'appUpdateOverlayStyle';
            style.textContent = `
                #appUpdateOverlay {
                    position: fixed;
                    inset: 0;
                    z-index: 99999;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: rgba(0, 0, 0, 0.72);
                    color: #cbd5e1;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                    text-align: center;
                }
                #appUpdateOverlay .app-update-box {
                    width: min(82vw, 320px);
                    padding: 28px 24px;
                    border-radius: 16px;
                    background: #161e2e;
                    border: 1px solid rgba(255, 255, 255, 0.16);
                    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.45);
                }
                #appUpdateOverlay .app-update-spinner {
                    width: 34px;
                    height: 34px;
                    margin: 0 auto 16px;
                    border-radius: 50%;
                    border: 3px solid rgba(203, 213, 225, 0.22);
                    border-top-color: #38bdf8;
                    animation: appUpdateSpin 0.9s linear infinite;
                }
                #appUpdateOverlay .app-update-title {
                    font-size: 18px;
                    font-weight: 800;
                    margin-bottom: 8px;
                    color: #38bdf8;
                }
                #appUpdateOverlay .app-update-text {
                    font-size: 14px;
                    line-height: 1.35;
                }
                @keyframes appUpdateSpin { to { transform: rotate(360deg); } }
            `;
            document.head.appendChild(style);
        }

        overlay.style.display = 'flex';
    }

    function hideUpdateOverlay() {
        const overlay = document.getElementById('appUpdateOverlay');
        if (overlay) overlay.style.display = 'none';
    }

    function waitForWorkerState(worker, targetStates) {
        return new Promise((resolve) => {
            if (!worker) {
                resolve(null);
                return;
            }
            if (targetStates.includes(worker.state)) {
                resolve(worker.state);
                return;
            }

            function onStateChange() {
                if (targetStates.includes(worker.state)) {
                    worker.removeEventListener('statechange', onStateChange);
                    resolve(worker.state);
                }
            }

            worker.addEventListener('statechange', onStateChange);
        });
    }

    async function runUpdateCheck(registration) {
        if (!navigator.onLine) return;

        const remoteCacheName = await getRemoteCacheName();
        if (!remoteCacheName) return;

        const activeCacheName = await getActiveCacheName(registration);
        if (activeCacheName === remoteCacheName) {
            localStorage.setItem(CACHE_KEY, remoteCacheName);
            localStorage.setItem(LABEL_KEY, remoteCacheName);
            warmOptionalCache(registration);
            return;
        }

        const hadController = Boolean(navigator.serviceWorker.controller);
        let didReload = false;
        if (hadController) showUpdateOverlay();

        const reloadForNewWorker = () => {
            if (didReload) return;
            didReload = true;
            localStorage.setItem(CACHE_KEY, remoteCacheName);
            localStorage.setItem(LABEL_KEY, remoteCacheName);
            window.location.reload();
        };
        const onControllerChange = () => {
            if (hadController) reloadForNewWorker();
        };

        navigator.serviceWorker.addEventListener('controllerchange', onControllerChange, { once: true });

        try {
            const updatedRegistration = await registration.update();
            const worker = updatedRegistration.installing || updatedRegistration.waiting;

            if (updatedRegistration.waiting) {
                updatedRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
            }

            const state = worker
                ? await waitForWorkerState(worker, ['activated', 'redundant'])
                : null;
            const installedCacheName = await getActiveCacheName(updatedRegistration);

            if (state === 'redundant') {
                throw new Error('New service worker installation failed');
            }
            if (installedCacheName === remoteCacheName) {
                localStorage.setItem(CACHE_KEY, remoteCacheName);
                localStorage.setItem(LABEL_KEY, remoteCacheName);
                if (hadController) reloadForNewWorker();
                else warmOptionalCache(updatedRegistration);
            }
            if (!didReload) {
                navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
                hideUpdateOverlay();
            }
        } catch (error) {
            console.warn('SW update skipped:', error);
            navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
            hideUpdateOverlay();
        }
    }

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register(SW_URL, { updateViaCache: 'none' })
            .then((registration) => {
                console.log('SW registered. Scope:', registration.scope);
                runUpdateCheck(registration);
            })
            .catch((error) => {
                console.error('SW registration error:', error);
                hideUpdateOverlay();
            });
    }
})();

// Shared MyNPA Realtime Database bootstrap and pending cloud sync.
// Runs on every main page so cloud data and queued admin writes stay current.
(function () {
    const NPA_AIRPORTS_DB_KEY = 'mynpa_airports_rtdb_v1';
    const NPA_REFERENCE_CACHE_KEY = 'mynpa_airports_reference_v1';
    const NPA_CLOUD_APPROACHES_KEY = 'mynpa_cloud_approaches_v1';
    const NPA_PENDING_CLOUD_WRITES_KEY = 'mynpa_pending_cloud_writes_v1';
    const NPA_SYNC_STATUS_KEY = 'mynpa_sync_status_v1';
    const FIREBASE_APP_SDK = 'https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js';
    const FIREBASE_DATABASE_SDK = 'https://www.gstatic.com/firebasejs/9.22.0/firebase-database-compat.js';
    const FIREBASE_AUTH_SDK = 'https://www.gstatic.com/firebasejs/9.22.0/firebase-auth-compat.js';
    const NPA_FIREBASE_CONFIG = {
        apiKey: 'AIzaSyBrx_6HkG7-zOEZMKzLB2NpMqpae_qKlGo',
        authDomain: 'mynpa-db.firebaseapp.com',
        databaseURL: 'https://mynpa-db-default-rtdb.europe-west1.firebasedatabase.app',
        projectId: 'mynpa-db',
        storageBucket: 'mynpa-db.firebasestorage.app',
        messagingSenderId: '556017315454',
        appId: '1:556017315454:web:6ec41a310c54315d4ab22f'
    };

    let initPromise = null;
    let listenersAttached = false;
    let syncInProgress = false;
    let syncStatus = {};

    function readJsonStorage(key, fallbackValue) {
        try {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : fallbackValue;
        } catch (error) {
            console.error('MyNPA localStorage read error:', error);
            return fallbackValue;
        }
    }

    function writeJsonStorage(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch (error) {
            console.error('MyNPA localStorage write error:', error);
            return false;
        }
    }

    function sanitizeAirportCode(value) {
        return String(value || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
    }

    function normalizeRunways(source) {
        if (Array.isArray(source)) return source.filter(Boolean);
        if (!source || typeof source !== 'object') return [];
        return Object.keys(source).map(key => source[key]).filter(Boolean);
    }

    function normalizeRadioAids(airportData) {
        const source = Array.isArray(airportData?.radioAids)
            ? airportData.radioAids
            : Array.isArray(airportData?.navaids)
                ? airportData.navaids
                : [];
        return source.filter(Boolean).map(aid => {
            const sourceType = String(aid.sourceType || aid.type || 'VOR').toUpperCase();
            return {
                ...aid,
                type: sourceType === 'NDB' || sourceType === 'TAR' ? sourceType : 'VOR',
                sourceType,
                name: String(aid.name || aid.id || sourceType).trim().toUpperCase()
            };
        });
    }

    function normalizeReferenceAirport(airportCode, airportData) {
        const icao = sanitizeAirportCode(airportCode || airportData?.icao);
        return {
            icao,
            runways: normalizeRunways(airportData?.runways),
            radioAids: normalizeRadioAids(airportData),
            updatedAt: Number(airportData?.updatedAt) || Date.now()
        };
    }

    function runwayObjectFromArray(runways) {
        const result = {};
        normalizeRunways(runways).forEach((runway, index) => {
            const thr1 = String(runway?.thr1 || '').trim().toUpperCase();
            const thr2 = String(runway?.thr2 || '').trim().toUpperCase();
            let key = [thr1, thr2].filter(Boolean).join('_') || `runway_${index + 1}`;
            key = key.replace(/[.#$[\]/]/g, '_');
            result[key] = {
                rwLength: runway?.rwLength ?? '',
                rwLengthDisplayUnit: runway?.rwLengthDisplayUnit === 'ft' ? 'ft' : 'm',
                thr1,
                thr1Coord: runway?.thr1Coord || '',
                thr1Elev: runway?.thr1Elev ?? '',
                thr2,
                thr2Coord: runway?.thr2Coord || '',
                thr2Elev: runway?.thr2Elev ?? ''
            };
        });
        return result;
    }

    function navaidsFromRadioAids(radioAids) {
        return normalizeRadioAids({ radioAids })
            .filter(aid => aid.type !== 'TAR')
            .map(aid => ({
                type: aid.sourceType === 'VORDME' ? 'VORDME' : aid.type,
                id: aid.name || aid.id || '',
                coord: aid.coord || ''
            }));
    }

    function serializeReferenceAirport(airportCode, airportData) {
        const normalized = normalizeReferenceAirport(airportCode, airportData);
        return {
            icao: normalized.icao,
            runways: runwayObjectFromArray(normalized.runways),
            navaids: navaidsFromRadioAids(normalized.radioAids)
        };
    }

    function getCloudApproachesForAirport(cloudData, airportCode) {
        const entry = cloudData?.[airportCode];
        if (!entry || typeof entry !== 'object') return {};
        return entry.approaches && typeof entry.approaches === 'object' ? entry.approaches : {};
    }

    function rebuildCombinedLocalDb() {
        const references = readJsonStorage(NPA_REFERENCE_CACHE_KEY, {});
        const cloudApproaches = readJsonStorage(NPA_CLOUD_APPROACHES_KEY, {});
        const merged = readJsonStorage(NPA_AIRPORTS_DB_KEY, {});

        Object.keys(references || {}).forEach(rawCode => {
            const code = sanitizeAirportCode(rawCode);
            const reference = references[rawCode];
            if (!code || !reference || typeof reference !== 'object') return;
            const localApproaches = merged[code]?.approaches && typeof merged[code].approaches === 'object'
                ? merged[code].approaches
                : {};
            merged[code] = {
                ...normalizeReferenceAirport(code, reference),
                approaches: localApproaches
            };
        });

        Object.keys(cloudApproaches || {}).forEach(rawCode => {
            const code = sanitizeAirportCode(rawCode);
            if (!code) return;
            const existing = merged[code] || normalizeReferenceAirport(code, { icao: code });
            const localApproaches = existing.approaches && typeof existing.approaches === 'object'
                ? existing.approaches
                : {};
            merged[code] = {
                ...existing,
                approaches: {
                    ...localApproaches,
                    ...getCloudApproachesForAirport(cloudApproaches, rawCode)
                }
            };
        });

        writeJsonStorage(NPA_AIRPORTS_DB_KEY, merged);
        window.airportsDb = merged;
        window.dispatchEvent(new CustomEvent('npa-cloud-data-updated', {
            detail: { airportsDb: merged }
        }));
        return merged;
    }

    function getPendingCloudWrites() {
        const queue = readJsonStorage(NPA_PENDING_CLOUD_WRITES_KEY, []);
        return Array.isArray(queue) ? queue : [];
    }

    function setPendingCloudWrites(queue) {
        const normalized = Array.isArray(queue) ? queue : [];
        writeJsonStorage(NPA_PENDING_CLOUD_WRITES_KEY, normalized);
        window.dispatchEvent(new CustomEvent('npa-pending-sync-changed', {
            detail: { pendingCount: normalized.length }
        }));
    }

    function pendingWriteId(item) {
        return `${item?.kind || ''}:${sanitizeAirportCode(item?.airportCode)}:${item?.approachName || ''}`;
    }

    function queueCloudWrite(item) {
        if (!item || !item.kind || !sanitizeAirportCode(item.airportCode)) return;
        const queued = {
            ...item,
            airportCode: sanitizeAirportCode(item.airportCode),
            updatedAt: Number(item.updatedAt) || Date.now()
        };
        const id = pendingWriteId(queued);
        const next = getPendingCloudWrites().filter(existing => pendingWriteId(existing) !== id);
        next.push(queued);
        setPendingCloudWrites(next);
    }

    function isFirebaseReady() {
        return Boolean(window.npaDb && typeof window.npaDb.ref === 'function');
    }

    function isAdminMode() {
        return Boolean(window.npaAuth?.currentUser);
    }

    function safeApproachKey(value) {
        return String(value || '').trim().replace(/[.#$[\]/]/g, '_');
    }

    async function writeAirportReferenceToCloud(airportCode, airportData) {
        if (!isFirebaseReady() || !isAdminMode()) throw new Error('Admin Firebase mode is required');
        const code = sanitizeAirportCode(airportCode);
        await window.npaDb.ref(`airportsReference/${code}`).set(serializeReferenceAirport(code, airportData));
    }

    async function writeApproachToCloud(airportCode, approachName, approachData) {
        if (!isFirebaseReady() || !isAdminMode()) throw new Error('Admin Firebase mode is required');
        const code = sanitizeAirportCode(airportCode);
        const key = safeApproachKey(approachName);
        if (!code || !key) throw new Error('Airport and approach are required');
        await window.npaDb.ref(`airportsNpa/${code}/approaches/${key}`).set({
            ...approachData,
            name: approachName,
            updatedAt: Number(approachData?.updatedAt) || Date.now()
        });
    }

    async function writePendingItem(item) {
        if (item.kind === 'reference') {
            await writeAirportReferenceToCloud(item.airportCode, item.data);
            return;
        }
        if (item.kind === 'approach') {
            await writeApproachToCloud(item.airportCode, item.approachName, item.data);
            return;
        }
        throw new Error(`Unknown MyNPA pending write kind: ${item.kind}`);
    }

    async function syncPendingCloudWrites() {
        if (syncInProgress || !navigator.onLine || !isFirebaseReady() || !isAdminMode()) return false;
        const queue = getPendingCloudWrites();
        if (!queue.length) return true;

        syncInProgress = true;
        const remaining = [];
        try {
            for (let index = 0; index < queue.length; index += 1) {
                try {
                    await writePendingItem(queue[index]);
                } catch (error) {
                    console.error('MyNPA RTDB pending sync error:', error);
                    remaining.push(...queue.slice(index));
                    break;
                }
            }
        } finally {
            setPendingCloudWrites(remaining);
            syncInProgress = false;
        }
        return remaining.length === 0;
    }

    function updateSyncStatus(patch) {
        syncStatus = {
            ...readJsonStorage(NPA_SYNC_STATUS_KEY, {}),
            ...syncStatus,
            ...patch
        };
        writeJsonStorage(NPA_SYNC_STATUS_KEY, syncStatus);
    }

    function loadFirebaseSdkPart(src, validator, label) {
        if (validator()) return Promise.resolve(true);
        return new Promise((resolve, reject) => {
            const existing = document.querySelector(`script[src="${src}"]`);
            const script = existing || document.createElement('script');
            const onLoad = () => validator() ? resolve(true) : reject(new Error(`Firebase ${label} SDK did not initialize`));
            script.addEventListener('load', onLoad, { once: true });
            script.addEventListener('error', () => reject(new Error(`Firebase ${label} SDK failed to load`)), { once: true });
            if (!existing) {
                script.src = src;
                script.async = true;
                document.head.appendChild(script);
            }
        });
    }

    async function ensureFirebaseSdk() {
        await loadFirebaseSdkPart(FIREBASE_APP_SDK, () => Boolean(window.firebase), 'app');
        await loadFirebaseSdkPart(FIREBASE_DATABASE_SDK, () => Boolean(window.firebase?.database), 'database');
        await loadFirebaseSdkPart(FIREBASE_AUTH_SDK, () => Boolean(window.firebase?.auth), 'auth');
    }

    function attachRealtimeListeners() {
        if (listenersAttached || !isFirebaseReady()) return;
        listenersAttached = true;

        window.npaDb.ref('airportsReference').on('value', snapshot => {
            writeJsonStorage(NPA_REFERENCE_CACHE_KEY, snapshot.val() || {});
            rebuildCombinedLocalDb();
            updateSyncStatus({ lastReferenceSyncAt: Date.now(), lastError: '' });
        }, error => {
            console.error('MyNPA RTDB reference load error:', error);
            updateSyncStatus({ lastError: error.message || String(error) });
        });

        window.npaDb.ref('airportsNpa').on('value', snapshot => {
            writeJsonStorage(NPA_CLOUD_APPROACHES_KEY, snapshot.val() || {});
            rebuildCombinedLocalDb();
            updateSyncStatus({ lastApproachSyncAt: Date.now(), lastError: '' });
        }, error => {
            console.error('MyNPA RTDB approach load error:', error);
            updateSyncStatus({ lastError: error.message || String(error) });
        });
    }

    async function initNpaFirebase() {
        if (isFirebaseReady()) return true;
        if (initPromise) return initPromise;
        if (navigator.onLine === false) {
            rebuildCombinedLocalDb();
            return false;
        }

        initPromise = (async () => {
            try {
                await ensureFirebaseSdk();
                if (!firebase.apps.length) firebase.initializeApp(NPA_FIREBASE_CONFIG);
                window.npaDb = firebase.database();
                window.npaAuth = firebase.auth();
                try {
                    await window.npaAuth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
                } catch (error) {
                    console.warn('MyNPA Firebase auth persistence init error:', error);
                }
                attachRealtimeListeners();
                window.npaAuth.onAuthStateChanged(user => {
                    if (typeof window.handleNpaAdminAuthState === 'function') {
                        window.handleNpaAdminAuthState(user);
                    }
                    if (user) syncPendingCloudWrites();
                });
                window.npaFirebaseInitialized = true;
                updateSyncStatus({ lastInitCompletedAt: Date.now(), lastError: '' });
                return true;
            } catch (error) {
                console.warn('MyNPA RTDB initialization failed:', error);
                window.npaFirebaseInitialized = false;
                updateSyncStatus({ lastError: error.message || String(error) });
                return false;
            } finally {
                initPromise = null;
            }
        })();
        return initPromise;
    }

    rebuildCombinedLocalDb();

    window.MyFlightNpaSync = {
        init: initNpaFirebase,
        syncPending: syncPendingCloudWrites,
        forceSyncPending: syncPendingCloudWrites,
        refreshCloud: initNpaFirebase,
        getPending: getPendingCloudWrites,
        getCache: () => readJsonStorage(NPA_AIRPORTS_DB_KEY, {}),
        status: () => readJsonStorage(NPA_SYNC_STATUS_KEY, {}),
        isReady: isFirebaseReady,
        isAdmin: isAdminMode,
        queueCloudWrite,
        writeAirportReference: writeAirportReferenceToCloud,
        writeApproach: writeApproachToCloud
    };
    window.initNpaFirebase = initNpaFirebase;
    window.syncPendingAirportSaves = syncPendingCloudWrites;
    window.isFirebaseReady = isFirebaseReady;
    window.writeAirportReferenceToCloud = writeAirportReferenceToCloud;
    window.writeApproachToCloud = writeApproachToCloud;
    window.queueNpaCloudWrite = queueCloudWrite;

    const boot = () => initNpaFirebase().then(() => syncPendingCloudWrites());
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot, { once: true });
    } else {
        boot();
    }
    window.addEventListener('online', boot);
    window.addEventListener('focus', boot);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') boot();
    });
})();


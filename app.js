// Service worker registration and safe cache-version auto update.
(function () {
    const SW_URL = './sw.js';
    const CACHE_KEY = 'hubActiveCacheVersion';
    const LABEL_KEY = 'hubVersion';
    const CACHE_NAME_RE = /CACHE_NAME\s*=\s*['"]([^'"]+)['"]/;
    const UPDATE_TIMEOUT_MS = 45000;

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

    async function getInstalledCacheName(remoteCacheName) {
        if (!('caches' in window)) {
            return localStorage.getItem(CACHE_KEY) || localStorage.getItem(LABEL_KEY);
        }

        try {
            const keys = await caches.keys();
            if (remoteCacheName && keys.includes(remoteCacheName)) return remoteCacheName;
            return keys.find((key) => /^myflight_/i.test(key)) ||
                localStorage.getItem(CACHE_KEY) ||
                localStorage.getItem(LABEL_KEY);
        } catch (error) {
            return localStorage.getItem(CACHE_KEY) || localStorage.getItem(LABEL_KEY);
        }
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

    function waitForWorkerState(worker, targetStates, timeoutMs) {
        return new Promise((resolve) => {
            if (!worker) {
                resolve(null);
                return;
            }
            if (targetStates.includes(worker.state)) {
                resolve(worker.state);
                return;
            }

            const timeoutId = setTimeout(() => {
                worker.removeEventListener('statechange', onStateChange);
                resolve('timeout');
            }, timeoutMs);

            function onStateChange() {
                if (targetStates.includes(worker.state)) {
                    clearTimeout(timeoutId);
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

        const installedCacheName = await getInstalledCacheName(remoteCacheName);
        if (!installedCacheName || installedCacheName === remoteCacheName) {
            localStorage.setItem(CACHE_KEY, remoteCacheName);
            localStorage.setItem(LABEL_KEY, remoteCacheName);
            return;
        }

        const hadController = Boolean(navigator.serviceWorker.controller);
        let didReload = false;
        showUpdateOverlay();

        const onControllerChange = () => {
            if (didReload || !hadController) return;
            didReload = true;
            localStorage.setItem(CACHE_KEY, remoteCacheName);
            localStorage.setItem(LABEL_KEY, remoteCacheName);
            window.location.reload();
        };

        navigator.serviceWorker.addEventListener('controllerchange', onControllerChange, { once: true });

        try {
            const updatedRegistration = await registration.update();
            const worker = updatedRegistration.installing || updatedRegistration.waiting;

            if (updatedRegistration.waiting) {
                updatedRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
            }

            const state = await waitForWorkerState(worker, ['activated', 'redundant'], UPDATE_TIMEOUT_MS);
            if (!hadController && state === 'activated') {
                localStorage.setItem(CACHE_KEY, remoteCacheName);
                localStorage.setItem(LABEL_KEY, remoteCacheName);
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
        window.addEventListener('load', () => {
            navigator.serviceWorker.register(SW_URL, { updateViaCache: 'none' })
                .then((registration) => {
                    console.log('SW registered. Scope:', registration.scope);
                    runUpdateCheck(registration);
                })
                .catch((error) => {
                    console.error('SW registration error:', error);
                    hideUpdateOverlay();
                });
        });
    }
})();

// Shared MyNPA Firebase bootstrap and pending airport sync.
// Runs from app.js so queued MyNPA saves can sync from any app page, not only mynpa.html.
(function () {
    const NPA_AIRPORTS_DB_KEY = 'mynpa_airports_v2';
    const NPA_PENDING_AIRPORT_SAVES_KEY = 'mynpa_pending_airport_saves_v2';
    const FIREBASE_APP_SDK = 'https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js';
    const FIREBASE_FIRESTORE_SDK = 'https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore-compat.js';
    const FIREBASE_AUTH_SDK = 'https://www.gstatic.com/firebasejs/9.22.0/firebase-auth-compat.js';
    const NPA_FIREBASE_CONFIG = {
        apiKey: 'AIzaSyBrx_6HkG7-zOEZMKzLB2NpMqpae_qKlGo',
        authDomain: 'mynpa-db.firebaseapp.com',
        projectId: 'mynpa-db',
        storageBucket: 'mynpa-db.firebasestorage.app',
        messagingSenderId: '556017315454',
        appId: '1:556017315454:web:6ec41a310c54315d4ab22f'
    };

    let npaFirebaseInitPromise = null;
    let sharedNpaSyncInProgress = false;
    let npaPendingSyncRetryTimer = null;
    let npaPendingSyncRetryDelayMs = 2000;
    const NPA_PENDING_SYNC_RETRY_MAX_MS = 30000;

    function readJsonStorage(key, fallbackValue) {
        try {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : fallbackValue;
        } catch (error) {
            console.error('NPA localStorage read error:', error);
            return fallbackValue;
        }
    }

    function writeJsonStorage(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch (error) {
            console.error('NPA localStorage write error:', error);
            return false;
        }
    }

    function getPendingAirportSaves() {
        return readJsonStorage(NPA_PENDING_AIRPORT_SAVES_KEY, []);
    }

    function setPendingAirportSaves(queue) {
        writeJsonStorage(NPA_PENDING_AIRPORT_SAVES_KEY, Array.isArray(queue) ? queue : []);
    }

    function loadNpaAirportsDb() {
        return readJsonStorage(NPA_AIRPORTS_DB_KEY, {});
    }

    function persistNpaAirportsDb(cache) {
        writeJsonStorage(NPA_AIRPORTS_DB_KEY, cache || {});
    }

    function mergeCloudNpaAirportsDb(source, options = {}) {
        if (!source || typeof source !== 'object') return;

        if (typeof window.mergeNpaAirportsDb === 'function') {
            window.mergeNpaAirportsDb(source, options);
            return;
        }

        const merged = window.airportsDb && typeof window.airportsDb === 'object'
            ? window.airportsDb
            : loadNpaAirportsDb();

        Object.keys(source).forEach(airportCode => {
            const airportData = source[airportCode];
            if (!airportData || typeof airportData !== 'object') return;
            merged[airportCode] = airportData;
        });

        window.airportsDb = merged;
        persistNpaAirportsDb(merged);
    }

    function isFirebaseReady() {
        return window.npaDb && typeof window.npaDb.collection === 'function';
    }

    async function writeAirportToCloud(airportCode, airportData) {
        if (!isFirebaseReady()) throw new Error('Firebase is not ready');
        await window.npaDb.collection('airports').doc(airportCode).set(airportData, { merge: true });
    }

    function resetPendingSyncRetry() {
        npaPendingSyncRetryDelayMs = 2000;
        if (npaPendingSyncRetryTimer) {
            window.clearTimeout(npaPendingSyncRetryTimer);
            npaPendingSyncRetryTimer = null;
        }
    }

    function schedulePendingSyncRetry() {
        if (!navigator.onLine || !getPendingAirportSaves().length || npaPendingSyncRetryTimer) return;

        const delayMs = npaPendingSyncRetryDelayMs;
        npaPendingSyncRetryDelayMs = Math.min(npaPendingSyncRetryDelayMs * 2, NPA_PENDING_SYNC_RETRY_MAX_MS);
        npaPendingSyncRetryTimer = window.setTimeout(() => {
            npaPendingSyncRetryTimer = null;
            requestPendingNpaSync();
        }, delayMs);
    }

    async function sharedSyncPendingAirportSaves() {
        if (sharedNpaSyncInProgress) return;
        if (!navigator.onLine) return;

        if (!isFirebaseReady()) {
            const ready = await initNpaFirebase();
            if (!ready || !isFirebaseReady()) {
                schedulePendingSyncRetry();
                return;
            }
        }

        const queue = getPendingAirportSaves();
        if (!queue.length) {
            resetPendingSyncRetry();
            return;
        }

        sharedNpaSyncInProgress = true;
        const remaining = [];

        try {
            for (let i = 0; i < queue.length; i += 1) {
                const item = queue[i];
                if (!item || !item.airportCode || !item.airportData) continue;

                try {
                    await writeAirportToCloud(item.airportCode, item.airportData);
                } catch (error) {
                    console.error('NPA pending sync error:', error);
                    remaining.push(item, ...queue.slice(i + 1));
                    break;
                }
            }
        } finally {
            setPendingAirportSaves(remaining);
            sharedNpaSyncInProgress = false;
            if (remaining.length) {
                schedulePendingSyncRetry();
            } else {
                resetPendingSyncRetry();
            }
        }
    }

    async function requestPendingNpaSync() {
        const queueBeforeSync = getPendingAirportSaves();
        if (!queueBeforeSync.length) {
            resetPendingSyncRetry();
            return;
        }

        if (!navigator.onLine) return;

        if (!isFirebaseReady()) {
            const ready = await initNpaFirebase();
            if (!ready || !isFirebaseReady()) {
                schedulePendingSyncRetry();
                return;
            }
        }

        if (typeof window.syncPendingAirportSaves === 'function' && window.syncPendingAirportSaves !== sharedSyncPendingAirportSaves) {
            try {
                await window.syncPendingAirportSaves();
            } catch (error) {
                console.error('NPA page pending sync error:', error);
            }
        }

        if (getPendingAirportSaves().length) {
            await sharedSyncPendingAirportSaves();
        }
    }

    function findScriptBySrc(src) {
        const absoluteSrc = new URL(src, window.location.href).href;
        return Array.from(document.scripts).find(script => script.src === absoluteSrc);
    }

    function removeScriptBySrc(src) {
        const existing = findScriptBySrc(src);
        if (existing) existing.remove();
    }

    function loadScriptOnce(src) {
        const absoluteSrc = new URL(src, window.location.href).href;
        let existing = findScriptBySrc(src);

        if (existing && existing.dataset.myflightFailed === 'true') {
            existing.remove();
            existing = null;
        }

        if (existing) {
            if (existing.dataset.myflightLoaded === 'true') return Promise.resolve();
            return new Promise((resolve, reject) => {
                existing.addEventListener('load', resolve, { once: true });
                existing.addEventListener('error', () => {
                    existing.dataset.myflightFailed = 'true';
                    reject(new Error(`Failed to load ${src}`));
                }, { once: true });
            });
        }

        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.async = false;
            script.onload = () => {
                script.dataset.myflightLoaded = 'true';
                resolve();
            };
            script.onerror = () => {
                script.dataset.myflightFailed = 'true';
                script.remove();
                reject(new Error(`Failed to load ${src}`));
            };
            document.head.appendChild(script);
        });
    }

    async function loadFirebaseSdkPart(src, validator, label) {
        if (validator()) return true;

        await loadScriptOnce(src);
        if (validator()) return true;

        removeScriptBySrc(src);
        throw new Error(`Firebase ${label} SDK did not initialize`);
    }

    async function ensureFirebaseSdk() {
        await loadFirebaseSdkPart(FIREBASE_APP_SDK, () => Boolean(window.firebase), 'app');
        await loadFirebaseSdkPart(FIREBASE_FIRESTORE_SDK, () => Boolean(window.firebase && firebase.firestore), 'firestore');
        await loadFirebaseSdkPart(FIREBASE_AUTH_SDK, () => Boolean(window.firebase && firebase.auth), 'auth');
        return true;
    }

    async function initNpaFirebase() {
        if (window.npaFirebaseInitialized && isFirebaseReady()) return true;
        if (window.npaFirebaseInitialized && !isFirebaseReady()) window.npaFirebaseInitialized = false;
        if (npaFirebaseInitPromise) return npaFirebaseInitPromise;
        if (navigator.onLine === false) return false;

        npaFirebaseInitPromise = (async () => {
            try {
                const sdkReady = await ensureFirebaseSdk();
                if (!sdkReady) {
                    npaFirebaseInitPromise = null;
                    return false;
                }

                if (!firebase.apps.length) firebase.initializeApp(NPA_FIREBASE_CONFIG);

                window.npaDb = firebase.firestore();
                window.npaAuth = firebase.auth();

                window.npaDb.enablePersistence({ synchronizeTabs: true })
                    .catch(error => console.error('NPA Firestore persistence init error:', error));

                window.npaDb.collection('airports').onSnapshot({
                    includeMetadataChanges: true
                }, (snapshot) => {
                    const cloudData = {};
                    snapshot.forEach(doc => {
                        cloudData[doc.id] = doc.data();
                    });

                    if (Object.keys(cloudData).length > 0) mergeCloudNpaAirportsDb(cloudData, {
                        fromCache: snapshot.metadata.fromCache
                    });
                    console.log('NPA database ready:', snapshot.metadata.fromCache ? 'cache' : 'server');
                    requestPendingNpaSync();
                }, (error) => {
                    console.error('NPA database load error:', error);
                });

                window.npaAuth.onAuthStateChanged(() => {
                    requestPendingNpaSync();
                });

                window.npaFirebaseInitialized = true;
                requestPendingNpaSync();
                return true;
            } catch (error) {
                console.warn('Firebase SDK is not available. MyNPA sync will retry later.', error);
                npaFirebaseInitPromise = null;
                window.npaFirebaseInitialized = false;
                schedulePendingSyncRetry();
                return false;
            }
        })();

        return npaFirebaseInitPromise;
    }

    function scheduleNpaFirebaseSync(delayMs) {
        window.setTimeout(() => {
            initNpaFirebase().then((ready) => {
                if (ready) requestPendingNpaSync();
                if (!ready && getPendingAirportSaves().length) schedulePendingSyncRetry();
            });
        }, delayMs);
    }

    window.MyFlightNpaSync = {
        init: initNpaFirebase,
        syncPending: requestPendingNpaSync,
        getPending: getPendingAirportSaves,
        getCache: loadNpaAirportsDb,
        isReady: isFirebaseReady
    };
    window.initNpaFirebase = initNpaFirebase;
    if (typeof window.syncPendingAirportSaves !== 'function') window.syncPendingAirportSaves = sharedSyncPendingAirportSaves;
    if (typeof window.isFirebaseReady !== 'function') window.isFirebaseReady = isFirebaseReady;
    if (typeof window.writeAirportToCloud !== 'function') window.writeAirportToCloud = writeAirportToCloud;

    window.addEventListener('load', () => scheduleNpaFirebaseSync(500));
    window.addEventListener('online', () => scheduleNpaFirebaseSync(1000));
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') scheduleNpaFirebaseSync(0);
    });
})();

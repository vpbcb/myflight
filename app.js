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

// Shared MyNPA Firebase bootstrap and pending-save sync.
// Runs from app.js so queued MyNPA saves can sync from any app page, not only mynpa.html.
(function () {
    const NPA_LOCAL_DB_KEY = 'mynpa_airports_cache_v1';
    const NPA_PENDING_QUEUE_KEY = 'mynpa_pending_saves_v1';
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

    function getPendingNpaSaves() {
        return readJsonStorage(NPA_PENDING_QUEUE_KEY, []);
    }

    function setPendingNpaSaves(queue) {
        writeJsonStorage(NPA_PENDING_QUEUE_KEY, Array.isArray(queue) ? queue : []);
    }

    function loadNpaCache() {
        return readJsonStorage(NPA_LOCAL_DB_KEY, {});
    }

    function persistNpaCache(cache) {
        writeJsonStorage(NPA_LOCAL_DB_KEY, cache || {});
    }

    function mergeCloudNpaDatabase(source) {
        if (!source || typeof source !== 'object') return;

        if (typeof window.mergeNpaDatabase === 'function') {
            window.mergeNpaDatabase(source);
            return;
        }

        const merged = window.airportsNpa && typeof window.airportsNpa === 'object'
            ? window.airportsNpa
            : loadNpaCache();
        const pendingKeys = new Set(
            getPendingNpaSaves()
                .filter(item => item && item.recordKey)
                .map(item => item.recordKey)
        );

        Object.keys(source).forEach(airportCode => {
            const airportData = source[airportCode];
            if (!airportData || typeof airportData !== 'object') return;
            if (!merged[airportCode]) merged[airportCode] = {};

            Object.keys(airportData).forEach(type => {
                if (pendingKeys.has(`${airportCode}::${type}`)) return;
                merged[airportCode][type] = airportData[type];
            });
        });

        window.airportsNpa = merged;
        persistNpaCache(merged);
    }

    function isFirebaseReady() {
        return window.npaDb && typeof window.npaDb.collection === 'function';
    }

    async function writeNpaRecordToCloud(airportCode, type, approachData) {
        if (!isFirebaseReady()) throw new Error('Firebase is not ready');
        await window.npaDb.collection('airportsnpa').doc(airportCode).set({
            [type]: approachData
        }, { merge: true });
    }

    async function sharedSyncPendingNpaSaves() {
        if (sharedNpaSyncInProgress || !navigator.onLine || !isFirebaseReady()) return;

        const queue = getPendingNpaSaves();
        if (!queue.length) return;

        sharedNpaSyncInProgress = true;
        const remaining = [];

        try {
            for (let i = 0; i < queue.length; i += 1) {
                const item = queue[i];
                if (!item || !item.airportCode || !item.type || !item.approachData) continue;

                try {
                    await writeNpaRecordToCloud(item.airportCode, item.type, item.approachData);
                } catch (error) {
                    console.error('NPA pending sync error:', error);
                    remaining.push(item, ...queue.slice(i + 1));
                    break;
                }
            }
        } finally {
            setPendingNpaSaves(remaining);
            sharedNpaSyncInProgress = false;
        }
    }

    async function requestPendingNpaSync() {
        if (typeof window.syncPendingNpaSaves === 'function' && window.syncPendingNpaSaves !== sharedSyncPendingNpaSaves) {
            await window.syncPendingNpaSaves();
            return;
        }

        await sharedSyncPendingNpaSaves();
    }

    function loadScriptOnce(src) {
        const absoluteSrc = new URL(src, window.location.href).href;
        const existing = Array.from(document.scripts).find(script => script.src === absoluteSrc);

        if (existing) {
            if (existing.dataset.myflightLoaded === 'true') return Promise.resolve();
            return new Promise((resolve, reject) => {
                existing.addEventListener('load', resolve, { once: true });
                existing.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true });
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
            script.onerror = () => reject(new Error(`Failed to load ${src}`));
            document.head.appendChild(script);
        });
    }

    async function ensureFirebaseSdk() {
        if (!window.firebase) await loadScriptOnce(FIREBASE_APP_SDK);
        if (!window.firebase || !firebase.firestore) await loadScriptOnce(FIREBASE_FIRESTORE_SDK);
        if (!window.firebase || !firebase.auth) await loadScriptOnce(FIREBASE_AUTH_SDK);
        return Boolean(window.firebase && firebase.firestore && firebase.auth);
    }

    async function initNpaFirebase() {
        if (window.npaFirebaseInitialized) return true;
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

                window.npaDb.collection('airportsnpa').onSnapshot({
                    includeMetadataChanges: true
                }, (snapshot) => {
                    const cloudData = {};
                    snapshot.forEach(doc => {
                        cloudData[doc.id] = doc.data();
                    });

                    if (Object.keys(cloudData).length > 0) mergeCloudNpaDatabase(cloudData);
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
                return false;
            }
        })();

        return npaFirebaseInitPromise;
    }

    function scheduleNpaFirebaseSync(delayMs) {
        window.setTimeout(() => {
            initNpaFirebase().then(() => requestPendingNpaSync());
        }, delayMs);
    }

    window.MyFlightNpaSync = {
        init: initNpaFirebase,
        syncPending: requestPendingNpaSync,
        getPending: getPendingNpaSaves,
        isReady: isFirebaseReady
    };
    window.initNpaFirebase = initNpaFirebase;
    if (typeof window.syncPendingNpaSaves !== 'function') window.syncPendingNpaSaves = sharedSyncPendingNpaSaves;
    if (typeof window.isFirebaseReady !== 'function') window.isFirebaseReady = isFirebaseReady;
    if (typeof window.writeNpaRecordToCloud !== 'function') window.writeNpaRecordToCloud = writeNpaRecordToCloud;

    window.addEventListener('load', () => scheduleNpaFirebaseSync(500));
    window.addEventListener('online', () => scheduleNpaFirebaseSync(1000));
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') scheduleNpaFirebaseSync(0);
    });
})();

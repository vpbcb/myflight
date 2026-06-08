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
    const NPA_CONFIRMED_CLOUD_AIRPORTS_KEY = 'mynpa_confirmed_cloud_airports_v1';
    const NPA_SYNC_STATUS_KEY = 'mynpa_sync_status_v1';
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
    let npaCloudRefreshInProgress = false;
    let npaRestPullInProgress = false;
    let npaCloudRefreshTimer = null;
    let npaPendingSyncRetryTimer = null;
    let npaPendingSyncRetryDelayMs = 2000;
    let npaSyncStatus = {};
    const NPA_CLOUD_REFRESH_INTERVAL_MS = 15000;
    const NPA_PENDING_SYNC_RETRY_MAX_MS = 30000;
    const NPA_BOOT_RETRY_DELAYS_MS = [0, 1000, 3000, 7000, 15000];

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
        const normalizedQueue = Array.isArray(queue) ? queue : [];
        writeJsonStorage(NPA_PENDING_AIRPORT_SAVES_KEY, normalizedQueue);
        window.dispatchEvent(new CustomEvent('npa-pending-sync-changed', {
            detail: { pendingCount: normalizedQueue.length }
        }));
    }

    function loadNpaAirportsDb() {
        return readJsonStorage(NPA_AIRPORTS_DB_KEY, {});
    }

    function persistNpaAirportsDb(cache) {
        writeJsonStorage(NPA_AIRPORTS_DB_KEY, cache || {});
    }

    function normalizeAirportCode(code) {
        return String(code || '').trim().toUpperCase();
    }

    function getConfirmedCloudAirportCodes() {
        const storedCodes = readJsonStorage(NPA_CONFIRMED_CLOUD_AIRPORTS_KEY, null);
        if (Array.isArray(storedCodes)) {
            return new Set(storedCodes.map(normalizeAirportCode).filter(Boolean));
        }

        const pendingCodes = new Set(
            getPendingAirportSaves()
                .map(item => normalizeAirportCode(item && item.airportCode))
                .filter(Boolean)
        );
        const legacyConfirmedCodes = new Set(
            Object.keys(loadNpaAirportsDb() || {})
                .map(normalizeAirportCode)
                .filter(code => code && !pendingCodes.has(code))
        );
        setConfirmedCloudAirportCodes(legacyConfirmedCodes);
        return legacyConfirmedCodes;
    }

    function setConfirmedCloudAirportCodes(codes) {
        const normalizedCodes = Array.from(codes || [])
            .map(normalizeAirportCode)
            .filter(Boolean)
            .sort();
        writeJsonStorage(NPA_CONFIRMED_CLOUD_AIRPORTS_KEY, [...new Set(normalizedCodes)]);
    }

    function confirmCloudAirportCodes(codes) {
        const confirmedCodes = getConfirmedCloudAirportCodes();
        Array.from(codes || []).forEach(code => {
            const normalizedCode = normalizeAirportCode(code);
            if (normalizedCode) confirmedCodes.add(normalizedCode);
        });
        setConfirmedCloudAirportCodes(confirmedCodes);
    }

    function getAirportUpdatedAt(value) {
        const updatedAt = Number(value && value.updatedAt);
        return Number.isFinite(updatedAt) ? updatedAt : 0;
    }

    function getPendingAirportSaveMap(queue = getPendingAirportSaves()) {
        const pendingByAirport = new Map();

        queue.forEach(item => {
            const airportCode = normalizeAirportCode(item && item.airportCode);
            if (!airportCode || !item || !item.airportData) return;

            const updatedAt = Math.max(
                getAirportUpdatedAt(item),
                getAirportUpdatedAt(item.airportData)
            );
            const existing = pendingByAirport.get(airportCode);
            if (!existing || updatedAt >= existing.updatedAt) {
                pendingByAirport.set(airportCode, { item, updatedAt });
            }
        });

        return pendingByAirport;
    }

    function isNpaStandaloneApp() {
        try {
            return Boolean(
                (window.navigator && window.navigator.standalone === true) ||
                (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
            );
        } catch (error) {
            return false;
        }
    }

    function getNpaAirportCacheCount() {
        return Object.keys(loadNpaAirportsDb() || {}).length;
    }

    function getNpaSyncStatus() {
        npaSyncStatus = npaSyncStatus && Object.keys(npaSyncStatus).length
            ? npaSyncStatus
            : readJsonStorage(NPA_SYNC_STATUS_KEY, {});

        return {
            ...npaSyncStatus,
            firebaseReady: isFirebaseReady(),
            standalone: isNpaStandaloneApp(),
            airportCount: getNpaAirportCacheCount(),
            pendingCount: getPendingAirportSaves().length
        };
    }

    function updateNpaSyncStatus(patch = {}) {
        npaSyncStatus = {
            ...getNpaSyncStatus(),
            ...patch,
            updatedAt: Date.now(),
            firebaseReady: isFirebaseReady(),
            standalone: isNpaStandaloneApp(),
            airportCount: getNpaAirportCacheCount(),
            pendingCount: getPendingAirportSaves().length
        };
        writeJsonStorage(NPA_SYNC_STATUS_KEY, npaSyncStatus);
        return { ...npaSyncStatus };
    }

    function getNpaErrorMessage(error) {
        return error && error.message ? error.message : String(error || 'Unknown error');
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
        const pendingQueue = getPendingAirportSaves();
        const pendingByAirport = getPendingAirportSaveMap(pendingQueue);
        const confirmedPendingAirports = new Set();
        const actuallyRemovedAirports = new Set();
        const canConfirmPending = options.fromCache !== true && options.hasPendingWrites !== true;
        const confirmedCloudAirports = getConfirmedCloudAirportCodes();
        const cloudAirportCodes = new Set(
            Array.isArray(options.cloudAirportCodes)
                ? options.cloudAirportCodes.map(normalizeAirportCode).filter(Boolean)
                : Object.keys(source).map(normalizeAirportCode).filter(Boolean)
        );
        const removedAirports = new Set(
            Array.isArray(options.removedAirportCodes)
                ? options.removedAirportCodes.map(normalizeAirportCode).filter(Boolean)
                : []
        );

        if (options.authoritativeCloudSnapshot === true) {
            confirmedCloudAirports.forEach(airportCode => {
                if (!cloudAirportCodes.has(airportCode)) removedAirports.add(airportCode);
            });
        }

        Object.keys(source).forEach(airportCode => {
            const airportData = source[airportCode];
            if (!airportData || typeof airportData !== 'object') return;
            const normalizedCode = normalizeAirportCode(airportCode);
            if (!normalizedCode) return;

            const pending = pendingByAirport.get(normalizedCode);
            const localUpdatedAt = getAirportUpdatedAt(merged[normalizedCode]);
            const pendingUpdatedAt = pending ? pending.updatedAt : 0;
            const cloudUpdatedAt = getAirportUpdatedAt(airportData);

            if (Math.max(localUpdatedAt, pendingUpdatedAt) > cloudUpdatedAt) return;

            merged[normalizedCode] = airportData;
            if (canConfirmPending && pending && cloudUpdatedAt >= pendingUpdatedAt) {
                confirmedPendingAirports.add(normalizedCode);
            }
            if (canConfirmPending) confirmedCloudAirports.add(normalizedCode);
        });

        removedAirports.forEach(airportCode => {
            delete merged[airportCode];
            confirmedCloudAirports.delete(airportCode);
            actuallyRemovedAirports.add(airportCode);
        });

        const pendingAirportsToRemove = new Set([
            ...confirmedPendingAirports,
            ...actuallyRemovedAirports
        ]);
        if (pendingAirportsToRemove.size) {
            setPendingAirportSaves(
                pendingQueue.filter(item =>
                    item && !pendingAirportsToRemove.has(normalizeAirportCode(item.airportCode))
                )
            );
        }

        setConfirmedCloudAirportCodes(confirmedCloudAirports);
        window.airportsDb = merged;
        persistNpaAirportsDb(merged);
        updateNpaSyncStatus({
            lastMergeAt: Date.now(),
            lastMergeSource: options.source || 'unknown',
            lastRemovedCount: actuallyRemovedAirports.size
        });
    }

    function isFirebaseReady() {
        return window.npaDb && typeof window.npaDb.collection === 'function';
    }

    async function writeAirportToCloud(airportCode, airportData) {
        if (!isFirebaseReady()) throw new Error('Firebase is not ready');
        await window.npaDb.collection('airports').doc(airportCode).set(airportData, { merge: true });
    }

    async function discardPendingAirportDeletedFromCloud(airportCode) {
        const normalizedCode = normalizeAirportCode(airportCode);
        if (!normalizedCode || !getConfirmedCloudAirportCodes().has(normalizedCode)) return false;

        const snapshot = await window.npaDb.collection('airports').doc(normalizedCode).get({ source: 'server' });
        if (snapshot.exists) return false;

        mergeCloudNpaAirportsDb({}, {
            removedAirportCodes: [normalizedCode],
            source: 'pending-delete-check'
        });
        return true;
    }

    function collectCloudSnapshotData(snapshot) {
        const cloudData = {};
        snapshot.forEach(doc => {
            cloudData[normalizeAirportCode(doc.id)] = doc.data();
        });
        return cloudData;
    }

    function getRemovedAirportCodes(snapshot) {
        if (!snapshot || typeof snapshot.docChanges !== 'function') return [];

        try {
            return snapshot.docChanges()
                .filter(change => change && change.type === 'removed' && change.doc)
                .map(change => normalizeAirportCode(change.doc.id))
                .filter(Boolean);
        } catch (error) {
            console.error('NPA snapshot change read error:', error);
            return [];
        }
    }

    function decodeFirestoreValue(value) {
        if (!value || typeof value !== 'object') return null;
        if (Object.prototype.hasOwnProperty.call(value, 'stringValue')) return value.stringValue;
        if (Object.prototype.hasOwnProperty.call(value, 'integerValue')) return Number(value.integerValue);
        if (Object.prototype.hasOwnProperty.call(value, 'doubleValue')) return Number(value.doubleValue);
        if (Object.prototype.hasOwnProperty.call(value, 'booleanValue')) return Boolean(value.booleanValue);
        if (Object.prototype.hasOwnProperty.call(value, 'nullValue')) return null;
        if (Object.prototype.hasOwnProperty.call(value, 'timestampValue')) return value.timestampValue;
        if (Object.prototype.hasOwnProperty.call(value, 'arrayValue')) {
            const values = value.arrayValue && Array.isArray(value.arrayValue.values)
                ? value.arrayValue.values
                : [];
            return values.map(decodeFirestoreValue);
        }
        if (Object.prototype.hasOwnProperty.call(value, 'mapValue')) {
            const decoded = {};
            const fields = value.mapValue && value.mapValue.fields && typeof value.mapValue.fields === 'object'
                ? value.mapValue.fields
                : {};
            Object.keys(fields).forEach(key => {
                decoded[key] = decodeFirestoreValue(fields[key]);
            });
            return decoded;
        }
        return null;
    }

    function decodeFirestoreDocument(doc) {
        if (!doc || typeof doc !== 'object') return null;
        const id = normalizeAirportCode(String(doc.name || '').split('/').pop());
        if (!id) return null;

        const data = {};
        const fields = doc.fields && typeof doc.fields === 'object' ? doc.fields : {};
        Object.keys(fields).forEach(key => {
            data[key] = decodeFirestoreValue(fields[key]);
        });
        if (!data.icao) data.icao = id;
        return { id, data };
    }

    function getNpaFirestoreRestUrl(pageToken = '') {
        const url = new URL(`https://firestore.googleapis.com/v1/projects/${NPA_FIREBASE_CONFIG.projectId}/databases/(default)/documents/airports`);
        url.searchParams.set('key', NPA_FIREBASE_CONFIG.apiKey);
        url.searchParams.set('pageSize', '1000');
        if (pageToken) url.searchParams.set('pageToken', pageToken);
        return url.toString();
    }

    async function fetchNpaAirportsViaRest(reason = 'rest-pull') {
        if (!navigator.onLine || npaRestPullInProgress) return false;

        npaRestPullInProgress = true;
        const startedAt = Date.now();
        const cloudData = {};

        try {
            let pageToken = '';
            do {
                const response = await fetch(getNpaFirestoreRestUrl(pageToken), {
                    cache: 'no-store',
                    credentials: 'omit'
                });
                if (!response.ok) {
                    throw new Error(`REST pull failed: ${response.status} ${response.statusText}`);
                }

                const payload = await response.json();
                if (!payload || typeof payload !== 'object') {
                    throw new Error('REST pull returned malformed payload');
                }
                if (payload.documents !== undefined && !Array.isArray(payload.documents)) {
                    throw new Error('REST pull returned malformed documents list');
                }

                const documents = Array.isArray(payload.documents) ? payload.documents : [];
                documents.forEach(doc => {
                    const decoded = decodeFirestoreDocument(doc);
                    if (decoded) cloudData[decoded.id] = decoded.data;
                });

                pageToken = payload.nextPageToken || '';
            } while (pageToken);

            mergeCloudNpaAirportsDb(cloudData, {
                source: 'rest-pull',
                authoritativeCloudSnapshot: true,
                cloudAirportCodes: Object.keys(cloudData),
                reason
            });
            updateNpaSyncStatus({
                lastRestPullAt: startedAt,
                lastRestPullCompletedAt: Date.now(),
                lastRestPullReason: reason,
                lastRestPullCount: Object.keys(cloudData).length,
                lastError: ''
            });
            return true;
        } catch (error) {
            console.error('NPA REST cloud pull error:', error);
            updateNpaSyncStatus({
                lastRestPullErrorAt: Date.now(),
                lastRestPullReason: reason,
                lastError: getNpaErrorMessage(error)
            });
            return false;
        } finally {
            npaRestPullInProgress = false;
        }
    }

    function shouldRunNpaRestFallback() {
        return Boolean(navigator.onLine && (isNpaStandaloneApp() || !isFirebaseReady() || getNpaAirportCacheCount() === 0));
    }

    function applyCloudSnapshot(snapshot, source) {
        const cloudData = collectCloudSnapshotData(snapshot);
        const cloudAirportCodes = Object.keys(cloudData);
        const removedAirportCodes = source === 'snapshot'
            ? getRemovedAirportCodes(snapshot)
            : [];
        const fromCache = Boolean(snapshot.metadata && snapshot.metadata.fromCache);
        const hasPendingWrites = Boolean(snapshot.metadata && snapshot.metadata.hasPendingWrites);

        updateNpaSyncStatus({
            lastSdkPullAt: Date.now(),
            lastSnapshotAt: source === 'snapshot' ? Date.now() : npaSyncStatus.lastSnapshotAt,
            lastServerPullAt: source === 'server-pull' ? Date.now() : npaSyncStatus.lastServerPullAt,
            lastSnapshotSource: source,
            lastSnapshotFromCache: fromCache,
            lastSnapshotHasPendingWrites: hasPendingWrites,
            lastSnapshotDocCount: cloudAirportCodes.length,
            lastSnapshotRemovedCount: removedAirportCodes.length
        });

        const authoritativeCloudSnapshot = source === 'server-pull';
        if (cloudAirportCodes.length > 0 || removedAirportCodes.length > 0 || authoritativeCloudSnapshot) {
            mergeCloudNpaAirportsDb(cloudData, {
                fromCache,
                hasPendingWrites,
                completeCloudSnapshot: authoritativeCloudSnapshot,
                authoritativeCloudSnapshot,
                cloudAirportCodes,
                removedAirportCodes,
                source
            });
        }
        return cloudData;
    }

    async function refreshCloudNpaAirportsDbFromServer() {
        if (npaCloudRefreshInProgress || !navigator.onLine || !isFirebaseReady()) {
            if (shouldRunNpaRestFallback()) fetchNpaAirportsViaRest('server-pull-not-ready');
            return false;
        }

        npaCloudRefreshInProgress = true;
        try {
            if (getPendingAirportSaves().length && !sharedNpaSyncInProgress) {
                await requestPendingNpaSync();
            }

            const snapshot = await window.npaDb.collection('airports').get({ source: 'server' });
            applyCloudSnapshot(snapshot, 'server-pull');
            if (shouldRunNpaRestFallback()) fetchNpaAirportsViaRest('after-server-pull');
            return true;
        } catch (error) {
            console.error('NPA cloud refresh error:', error);
            updateNpaSyncStatus({
                lastServerPullErrorAt: Date.now(),
                lastError: getNpaErrorMessage(error)
            });
            fetchNpaAirportsViaRest('server-pull-error');
            return false;
        } finally {
            npaCloudRefreshInProgress = false;
        }
    }

    function startCloudRefreshFallback() {
        if (npaCloudRefreshTimer) return;

        npaCloudRefreshTimer = window.setInterval(() => {
            if (document.visibilityState === 'visible' && navigator.onLine) {
                if (isFirebaseReady()) refreshCloudNpaAirportsDbFromServer();
                if (shouldRunNpaRestFallback()) fetchNpaAirportsViaRest('visible-poll');
            }
        }, NPA_CLOUD_REFRESH_INTERVAL_MS);
    }

    function stopCloudRefreshFallback() {
        if (!npaCloudRefreshTimer) return;
        window.clearInterval(npaCloudRefreshTimer);
        npaCloudRefreshTimer = null;
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
        const failedAirportCodes = new Set();
        const successfullySynced = new Map();

        try {
            for (let i = 0; i < queue.length; i += 1) {
                const item = queue[i];
                if (!item || !item.airportCode || !item.airportData) continue;

                try {
                    if (await discardPendingAirportDeletedFromCloud(item.airportCode)) continue;
                    await writeAirportToCloud(item.airportCode, item.airportData);
                    successfullySynced.set(
                        normalizeAirportCode(item.airportCode),
                        Math.max(getAirportUpdatedAt(item), getAirportUpdatedAt(item.airportData))
                    );
                } catch (error) {
                    console.error('NPA pending sync error:', error);
                    queue.slice(i).forEach(remainingItem => {
                        const code = normalizeAirportCode(remainingItem && remainingItem.airportCode);
                        if (code) failedAirportCodes.add(code);
                    });
                    break;
                }
            }
        } finally {
            if (successfullySynced.size) {
                confirmCloudAirportCodes(successfullySynced.keys());
            }
            const remaining = getPendingAirportSaves().filter(item => {
                const code = normalizeAirportCode(item && item.airportCode);
                if (!code || failedAirportCodes.has(code)) return true;

                const syncedUpdatedAt = successfullySynced.get(code);
                if (syncedUpdatedAt === undefined) return true;

                const currentUpdatedAt = Math.max(
                    getAirportUpdatedAt(item),
                    getAirportUpdatedAt(item && item.airportData)
                );
                return currentUpdatedAt > syncedUpdatedAt;
            });
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

    function configureNpaFirestore(db) {
        if (!db || typeof db.settings !== 'function') return;

        try {
            db.settings({
                experimentalAutoDetectLongPolling: true,
                ignoreUndefinedProperties: true
            });
        } catch (error) {
            console.warn('NPA Firestore settings skipped:', error);
        }
    }

    function waitForNpaAuthInitialState(auth, timeoutMs = 5000) {
        return new Promise(resolve => {
            let settled = false;
            let unsubscribe = null;
            const finish = user => {
                if (settled) return;
                settled = true;
                window.clearTimeout(timeoutId);
                if (typeof unsubscribe === 'function') unsubscribe();
                resolve(user || null);
            };
            const timeoutId = window.setTimeout(() => finish(auth.currentUser), timeoutMs);

            unsubscribe = auth.onAuthStateChanged(
                user => finish(user),
                error => {
                    console.warn('NPA Firebase initial auth state error:', error);
                    finish(auth.currentUser);
                }
            );
        });
    }

    async function initNpaFirebase() {
        if (window.npaFirebaseInitialized && isFirebaseReady()) return true;
        if (window.npaFirebaseInitialized && !isFirebaseReady()) window.npaFirebaseInitialized = false;
        if (npaFirebaseInitPromise) return npaFirebaseInitPromise;
        if (navigator.onLine === false) {
            updateNpaSyncStatus({
                lastInitAt: Date.now(),
                lastError: 'Offline'
            });
            return false;
        }

        npaFirebaseInitPromise = (async () => {
            try {
                updateNpaSyncStatus({
                    lastInitAt: Date.now(),
                    lastError: ''
                });
                const sdkReady = await ensureFirebaseSdk();
                if (!sdkReady) {
                    npaFirebaseInitPromise = null;
                    return false;
                }

                if (!firebase.apps.length) firebase.initializeApp(NPA_FIREBASE_CONFIG);

                window.npaDb = firebase.firestore();
                window.npaAuth = firebase.auth();
                configureNpaFirestore(window.npaDb);

                try {
                    await window.npaAuth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
                } catch (error) {
                    console.warn('NPA Firebase auth persistence init error:', error);
                }
                const initialAuthUser = await waitForNpaAuthInitialState(window.npaAuth);
                if (typeof window.handleNpaAdminAuthState === 'function') {
                    window.handleNpaAdminAuthState(initialAuthUser);
                }

                window.npaDb.enablePersistence({ synchronizeTabs: true })
                    .catch(error => console.error('NPA Firestore persistence init error:', error));

                window.npaDb.collection('airports').onSnapshot({
                    includeMetadataChanges: true
                }, (snapshot) => {
                    applyCloudSnapshot(snapshot, 'snapshot');
                    console.log('NPA database ready:', snapshot.metadata.fromCache ? 'cache' : 'server');
                    requestPendingNpaSync();
                    if (shouldRunNpaRestFallback()) fetchNpaAirportsViaRest('after-snapshot');
                }, (error) => {
                    console.error('NPA database load error:', error);
                    updateNpaSyncStatus({
                        lastSnapshotErrorAt: Date.now(),
                        lastError: getNpaErrorMessage(error)
                    });
                    fetchNpaAirportsViaRest('snapshot-error');
                });

                window.npaAuth.onAuthStateChanged(user => {
                    if (typeof window.handleNpaAdminAuthState === 'function') {
                        window.handleNpaAdminAuthState(user);
                    }
                    requestPendingNpaSync();
                });

                window.npaFirebaseInitialized = true;
                npaFirebaseInitPromise = null;
                updateNpaSyncStatus({
                    lastInitCompletedAt: Date.now(),
                    lastError: ''
                });
                startCloudRefreshFallback();
                refreshCloudNpaAirportsDbFromServer();
                requestPendingNpaSync();
                return true;
            } catch (error) {
                console.warn('Firebase SDK is not available. MyNPA sync will retry later.', error);
                npaFirebaseInitPromise = null;
                window.npaFirebaseInitialized = false;
                updateNpaSyncStatus({
                    lastInitErrorAt: Date.now(),
                    lastError: getNpaErrorMessage(error)
                });
                fetchNpaAirportsViaRest('init-error');
                schedulePendingSyncRetry();
                return false;
            }
        })();

        return npaFirebaseInitPromise;
    }

    function scheduleNpaFirebaseSync(delayMs, reason = 'scheduled') {
        window.setTimeout(() => {
            initNpaFirebase().then((ready) => {
                if (ready) {
                    refreshCloudNpaAirportsDbFromServer();
                    requestPendingNpaSync();
                }
                if (shouldRunNpaRestFallback()) fetchNpaAirportsViaRest(reason);
                if (!ready && getPendingAirportSaves().length) schedulePendingSyncRetry();
            });
        }, delayMs);
    }

    function runNpaBootSyncSequence(reason) {
        NPA_BOOT_RETRY_DELAYS_MS.forEach(delayMs => {
            scheduleNpaFirebaseSync(delayMs, `${reason}:${delayMs}`);
        });
    }

    window.MyFlightNpaSync = {
        init: initNpaFirebase,
        syncPending: requestPendingNpaSync,
        refreshCloud: refreshCloudNpaAirportsDbFromServer,
        restPull: fetchNpaAirportsViaRest,
        getPending: getPendingAirportSaves,
        getCache: loadNpaAirportsDb,
        status: getNpaSyncStatus,
        isReady: isFirebaseReady
    };
    window.initNpaFirebase = initNpaFirebase;
    if (typeof window.syncPendingAirportSaves !== 'function') window.syncPendingAirportSaves = sharedSyncPendingAirportSaves;
    if (typeof window.isFirebaseReady !== 'function') window.isFirebaseReady = isFirebaseReady;
    if (typeof window.writeAirportToCloud !== 'function') window.writeAirportToCloud = writeAirportToCloud;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => runNpaBootSyncSequence('domcontentloaded'), { once: true });
    } else {
        runNpaBootSyncSequence('already-ready');
    }

    window.addEventListener('load', () => runNpaBootSyncSequence('load'));
    window.addEventListener('pageshow', () => runNpaBootSyncSequence('pageshow'));
    window.addEventListener('focus', () => scheduleNpaFirebaseSync(0, 'focus'));
    window.addEventListener('online', () => runNpaBootSyncSequence('online'));
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            runNpaBootSyncSequence('visibility');
            startCloudRefreshFallback();
        } else {
            stopCloudRefreshFallback();
        }
    });
})();

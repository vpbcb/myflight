// Prevent native long-press link menus on app navigation controls.
(function () {
    const STYLE_ID = 'appLinkCalloutGuardStyle';

    function getElementTarget(target) {
        if (!target) return null;
        return target.nodeType === 1 ? target : target.parentElement;
    }

    function preventNativeLinkMenu(event) {
        const element = getElementTarget(event.target);
        if (element?.closest('a[href]')) {
            event.preventDefault();
        }
    }

    document.addEventListener('contextmenu', preventNativeLinkMenu, { capture: true });

    if (!document.getElementById(STYLE_ID)) {
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            a[href] {
                -webkit-touch-callout: none;
                -webkit-user-select: none;
                user-select: none;
                touch-action: manipulation;
            }
        `;
        document.head.appendChild(style);
    }
})();

// Service worker registration and safe cache-version auto update.
(function () {
    const SW_URL = './sw.js';
    const CACHE_KEY = 'hubActiveCacheVersion';
    const LABEL_KEY = 'hubVersion';
    const CACHE_NAME_RE = /CACHE_NAME\s*=\s*['"]([^'"]+)['"]/;
    const WORKER_MESSAGE_TIMEOUT_MS = 2000;
    const WORKER_UPDATE_TIMEOUT_MS = 18000;

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

    function withTimeout(promise, timeoutMs, message) {
        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
            Promise.resolve(promise)
                .then(resolve, reject)
                .finally(() => clearTimeout(timeoutId));
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

    function waitForWorkerState(worker, targetStates, timeoutMs = 0) {
        return new Promise((resolve) => {
            if (!worker) {
                resolve(null);
                return;
            }
            let done = false;
            let timeoutId = null;

            function finish(state) {
                if (done) return;
                done = true;
                if (timeoutId) clearTimeout(timeoutId);
                worker.removeEventListener('statechange', onStateChange);
                resolve(state);
            }

            function onStateChange() {
                if (targetStates.includes(worker.state)) {
                    finish(worker.state);
                }
            }

            if (targetStates.includes(worker.state)) {
                finish(worker.state);
                return;
            }

            worker.addEventListener('statechange', onStateChange);
            if (timeoutMs > 0) {
                timeoutId = setTimeout(() => finish(null), timeoutMs);
            }
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
        const updateStartedAt = Date.now();
        const getUpdateBudgetMs = () => Math.max(1000, WORKER_UPDATE_TIMEOUT_MS - (Date.now() - updateStartedAt));

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
            const updatedRegistration = await withTimeout(
                registration.update(),
                getUpdateBudgetMs(),
                'Service worker update timed out'
            );
            const worker = updatedRegistration.installing || updatedRegistration.waiting;

            if (updatedRegistration.waiting) {
                updatedRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
            }

            const state = worker
                ? await waitForWorkerState(worker, ['activated', 'redundant'], getUpdateBudgetMs())
                : null;
            const installedCacheName = await getActiveCacheName(updatedRegistration);

            if (state === 'redundant') {
                throw new Error('New service worker installation failed');
            }
            if (worker && state === null && installedCacheName !== remoteCacheName) {
                throw new Error('Timed out waiting for new service worker activation');
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

// Shared screen wake lock controller.
// Uses native Screen Wake Lock only where it is reliable; no video fallback.
(function () {
    const STORAGE_KEY = 'myflight_keep_screen_awake_v1';
    const CHANGE_EVENT = 'myflight:wake-lock-change';

    let enabled = readEnabled();
    let status = {
        active: false,
        mode: enabled ? 'pending' : 'off',
        needsGesture: false,
        error: ''
    };
    let wakeLockSentinel = null;
    let releasingNative = false;
    let acquireTimer = null;

    function readEnabled() {
        try {
            const value = localStorage.getItem(STORAGE_KEY);
            return value === '1' || value === 'true';
        } catch (error) {
            return false;
        }
    }

    function writeEnabled(value) {
        try {
            localStorage.setItem(STORAGE_KEY, value ? '1' : '0');
        } catch (error) {
            console.warn('Wake lock setting write skipped:', error);
        }
    }

    function hasNativeWakeLock() {
        return Boolean(navigator.wakeLock && typeof navigator.wakeLock.request === 'function');
    }

    function isIosDevice() {
        return /iP(ad|hone|od)/.test(navigator.userAgent || '')
            || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    }

    function isStandalonePwa() {
        return window.navigator.standalone === true
            || window.matchMedia?.('(display-mode: standalone)').matches === true;
    }

    function getIosVersion() {
        const ua = navigator.userAgent || '';
        const osMatch = ua.match(/OS (\d+)[._](\d+)?/);
        if (osMatch) {
            return {
                major: Number(osMatch[1]) || 0,
                minor: Number(osMatch[2]) || 0
            };
        }
        const versionMatch = ua.match(/Version\/(\d+)(?:\.(\d+))?/);
        if (isIosDevice() && versionMatch) {
            return {
                major: Number(versionMatch[1]) || 0,
                minor: Number(versionMatch[2]) || 0
            };
        }
        return null;
    }

    function isLegacyIosPwa() {
        if (!isIosDevice() || !isStandalonePwa()) return false;
        const version = getIosVersion();
        if (!version) return true;
        return version.major < 18 || (version.major === 18 && version.minor < 4);
    }

    function canUseNativeWakeLock() {
        return hasNativeWakeLock() && !isLegacyIosPwa();
    }

    function isSupported() {
        return canUseNativeWakeLock();
    }

    function formatError(error) {
        if (!error) return '';
        return error.message || error.name || String(error);
    }

    function getStatus() {
        return {
            enabled,
            active: status.active,
            mode: status.mode,
            supported: isSupported(),
            nativeSupported: canUseNativeWakeLock(),
            rawNativeSupported: hasNativeWakeLock(),
            fallbackSupported: false,
            legacyIosPwa: isLegacyIosPwa(),
            needsGesture: status.needsGesture,
            error: status.error,
            iosStandalone: isIosDevice() && isStandalonePwa()
        };
    }

    function setStatus(patch) {
        status = Object.assign({}, status, patch);
        try {
            window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: getStatus() }));
        } catch (error) {
            // CustomEvent is only for optional UI observers.
        }
    }

    function clearAcquireTimer() {
        if (!acquireTimer) return;
        clearTimeout(acquireTimer);
        acquireTimer = null;
    }

    function scheduleAcquire(delayMs = 250) {
        clearAcquireTimer();
        if (!enabled) return;
        acquireTimer = setTimeout(() => {
            acquireTimer = null;
            requestWakeLock({ fromUserGesture: false }).catch(error => {
                console.warn('Wake lock reacquire skipped:', error);
            });
        }, delayMs);
    }

    async function releaseNativeWakeLock() {
        const sentinel = wakeLockSentinel;
        wakeLockSentinel = null;
        if (!sentinel || sentinel.released) return;
        releasingNative = true;
        try {
            await sentinel.release();
        } catch (error) {
            console.warn('Wake lock release skipped:', error);
        } finally {
            releasingNative = false;
        }
    }

    async function releaseAllWakeLocks() {
        clearAcquireTimer();
        await releaseNativeWakeLock();
    }

    async function requestNativeWakeLock() {
        if (isLegacyIosPwa()) throw new Error('Screen Wake Lock API is unavailable');
        if (!canUseNativeWakeLock()) throw new Error('Screen Wake Lock API is unavailable');
        if (wakeLockSentinel && !wakeLockSentinel.released) {
            setStatus({ active: true, mode: 'native', needsGesture: false, error: '' });
            return true;
        }

        wakeLockSentinel = await navigator.wakeLock.request('screen');
        wakeLockSentinel.addEventListener('release', () => {
            wakeLockSentinel = null;
            if (releasingNative) return;
            setStatus({
                active: false,
                mode: enabled ? 'pending' : 'off',
                needsGesture: false,
                error: ''
            });
            if (enabled && document.visibilityState === 'visible') scheduleAcquire(300);
        }, { once: true });

        setStatus({ active: true, mode: 'native', needsGesture: false, error: '' });
        return true;
    }

    async function requestWakeLock() {
        if (!enabled) return false;
        if (document.visibilityState === 'hidden') {
            setStatus({ active: false, mode: 'pending', needsGesture: false, error: '' });
            return false;
        }

        setStatus({ active: false, mode: 'pending', needsGesture: false, error: '' });

        if (canUseNativeWakeLock()) {
            try {
                return await requestNativeWakeLock();
            } catch (error) {
                console.warn('Native wake lock request failed:', error);
                setStatus({
                    active: false,
                    mode: 'error',
                    needsGesture: false,
                    error: formatError(error)
                });
                return false;
            }
        }

        setStatus({
            active: false,
            mode: 'unavailable',
            needsGesture: false,
            error: 'Screen wake lock is unavailable'
        });
        return false;
    }

    async function enable(options = {}) {
        enabled = true;
        writeEnabled(true);
        setStatus({ active: false, mode: 'pending', needsGesture: false, error: '' });
        return requestWakeLock({ fromUserGesture: options.fromUserGesture !== false });
    }

    async function disable(options = {}) {
        enabled = false;
        if (options.persist !== false) writeEnabled(false);
        await releaseAllWakeLocks();
        setStatus({ active: false, mode: 'off', needsGesture: false, error: '' });
        return true;
    }

    async function toggle(options = {}) {
        const current = getStatus();
        if (!current.enabled) return enable({ fromUserGesture: true });
        if (current.active) return disable();
        if (current.needsGesture || current.mode === 'pending') {
            return requestWakeLock({ fromUserGesture: true });
        }
        return disable();
    }

    function handleVisibleAgain() {
        if (enabled) scheduleAcquire(120);
    }

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            handleVisibleAgain();
        } else if (enabled) {
            releaseAllWakeLocks().finally(() => {
                setStatus({ active: false, mode: 'pending', needsGesture: false, error: '' });
            });
        }
    });
    window.addEventListener('pageshow', handleVisibleAgain);
    window.addEventListener('focus', handleVisibleAgain);
    window.addEventListener('pagehide', () => {
        releaseAllWakeLocks().catch(error => {
            console.warn('Wake lock pagehide release skipped:', error);
        });
    });
    window.addEventListener('storage', event => {
        if (event.key !== STORAGE_KEY) return;
        enabled = readEnabled();
        if (enabled) {
            setStatus({ active: false, mode: 'pending', needsGesture: false, error: '' });
            scheduleAcquire(120);
        } else {
            disable({ persist: false }).catch(error => {
                console.warn('Wake lock storage disable skipped:', error);
            });
        }
    });

    window.MyFlightWakeLock = {
        enable,
        disable,
        toggle,
        isEnabled: () => enabled,
        isActive: () => getStatus().active,
        isSupported,
        getStatus,
        request: requestWakeLock
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            if (enabled) scheduleAcquire(150);
        }, { once: true });
    } else {
        if (enabled) scheduleAcquire(150);
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
    const NPA_ADMIN_SESSION_KEY = 'mynpa_admin_session_v1';
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

    function removeStorage(key) {
        try {
            localStorage.removeItem(key);
            return true;
        } catch (error) {
            console.error('MyNPA localStorage remove error:', error);
            return false;
        }
    }

    function getCachedAdminSession() {
        const session = readJsonStorage(NPA_ADMIN_SESSION_KEY, null);
        if (!session || typeof session !== 'object') return null;
        if (!session.uid && !session.email) return null;
        return session;
    }

    function rememberAdminSession(user) {
        if (!user) return;
        writeJsonStorage(NPA_ADMIN_SESSION_KEY, {
            uid: user.uid || '',
            email: user.email || '',
            refreshedAt: Date.now()
        });
    }

    function clearAdminSession() {
        removeStorage(NPA_ADMIN_SESSION_KEY);
    }

    function getLiveAdminUser() {
        if (window.npaAuth?.currentUser) return window.npaAuth.currentUser;
        return null;
    }

    function getTrustedAdminUser() {
        return getLiveAdminUser() || getCachedAdminSession();
    }

    function sanitizeAirportCode(value) {
        return String(value || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
    }

    const IGNORED_AIRPORT_REFERENCE_KEYS = new Set(['AIRPORTS', 'FAILEDAIRPORTS', 'META', 'AIRP', 'FAIL']);

    function isValidAirportReferenceKey(value) {
        const raw = String(value || '').trim();
        const upper = raw.toUpperCase();
        if (IGNORED_AIRPORT_REFERENCE_KEYS.has(upper)) return false;
        return /^[A-Z]{4}$/.test(raw) && raw === upper;
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

    function getAirportUpdatedAt(value) {
        const updatedAt = Number(value?.updatedAt);
        return Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : 0;
    }

    function normalizeReferenceAirport(airportCode, airportData) {
        const icao = sanitizeAirportCode(airportCode || airportData?.icao);
        return {
            icao,
            runways: normalizeRunways(airportData?.runways),
            radioAids: normalizeRadioAids(airportData),
            localReferenceOverride: false,
            updatedAt: getAirportUpdatedAt(airportData)
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

    function serializeRadioAids(radioAids) {
        return normalizeRadioAids({ radioAids }).map(aid => {
            if (aid.type === 'TAR') {
                return {
                    type: 'TAR',
                    name: 'TAR',
                    thr1: String(aid.thr1 || '').trim().toUpperCase(),
                    thr1Distance: aid.thr1Distance ?? '',
                    thr2: String(aid.thr2 || '').trim().toUpperCase(),
                    thr2Distance: aid.thr2Distance ?? ''
                };
            }

            return {
                type: aid.sourceType === 'VORDME' ? 'VORDME' : aid.type,
                name: aid.name || aid.id || '',
                coord: aid.coord || ''
            };
        });
    }

    function serializeReferenceAirport(airportCode, airportData) {
        const normalized = normalizeReferenceAirport(airportCode, airportData);
        return {
            icao: normalized.icao,
            runways: runwayObjectFromArray(normalized.runways),
            radioAids: serializeRadioAids(normalized.radioAids),
            updatedAt: normalized.updatedAt || Date.now()
        };
    }

    function getCloudApproachesForAirport(cloudData, airportCode) {
        const entry = cloudData?.[airportCode];
        if (!entry || typeof entry !== 'object') return {};
        return entry.approaches && typeof entry.approaches === 'object' ? entry.approaches : {};
    }

    function applyPendingCloudWrites(merged, pendingWrites) {
        pendingWrites.forEach(item => {
            const code = sanitizeAirportCode(item?.airportCode);
            if (!isValidAirportReferenceKey(code)) return;

            if (item.kind === 'reference' && item.data && typeof item.data === 'object') {
                const existingApproaches = merged[code]?.approaches && typeof merged[code].approaches === 'object'
                    ? merged[code].approaches
                    : item.data.approaches && typeof item.data.approaches === 'object'
                        ? item.data.approaches
                        : {};
                const pendingAirport = normalizeReferenceAirport(code, item.data);
                pendingAirport.updatedAt = Math.max(
                    pendingAirport.updatedAt,
                    getAirportUpdatedAt(item)
                );
                merged[code] = {
                    ...pendingAirport,
                    approaches: existingApproaches
                };
                return;
            }

            if (item.kind === 'approach' && item.data && typeof item.data === 'object') {
                const approachName = String(item.approachName || item.data.name || '').trim();
                if (!approachName) return;
                const existing = merged[code] || normalizeReferenceAirport(code, { icao: code });
                const existingApproaches = existing.approaches && typeof existing.approaches === 'object'
                    ? existing.approaches
                    : {};
                merged[code] = {
                    ...existing,
                    approaches: {
                        ...existingApproaches,
                        [approachName]: {
                            ...item.data,
                            name: approachName,
                            updatedAt: Math.max(
                                getAirportUpdatedAt(item.data),
                                getAirportUpdatedAt(item)
                            )
                        }
                    }
                };
                return;
            }

            if (item.kind === 'deleteAirport' || item.kind === 'deleteReference') {
                delete merged[code];
            }
        });
    }

    function rebuildCombinedLocalDb() {
        const references = readJsonStorage(NPA_REFERENCE_CACHE_KEY, {});
        const cloudApproaches = readJsonStorage(NPA_CLOUD_APPROACHES_KEY, {});
        const merged = readJsonStorage(NPA_AIRPORTS_DB_KEY, {});
        const pendingWrites = getPendingCloudWrites();

        Object.keys(merged || {}).forEach(rawCode => {
            if (!isValidAirportReferenceKey(rawCode)) delete merged[rawCode];
        });

        Object.keys(references || {}).forEach(rawCode => {
            if (!isValidAirportReferenceKey(rawCode)) return;
            const code = sanitizeAirportCode(rawCode);
            const reference = references[rawCode];
            if (!code || !reference || typeof reference !== 'object') return;
            const normalizedReference = normalizeReferenceAirport(code, reference);
            const localAirport = merged[code];
            if (localAirport?.localReferenceOverride === true) return;
            const localApproaches = merged[code]?.approaches && typeof merged[code].approaches === 'object'
                ? merged[code].approaches
                : {};
            merged[code] = {
                ...normalizedReference,
                approaches: localApproaches
            };
        });

        Object.keys(cloudApproaches || {}).forEach(rawCode => {
            if (!isValidAirportReferenceKey(rawCode)) return;
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

        // Unsynced local edits are the final authority. A stale Firebase cache
        // must never replace them while the device is offline or reconnecting.
        applyPendingCloudWrites(merged, pendingWrites);

        writeJsonStorage(NPA_AIRPORTS_DB_KEY, merged);
        window.airportsDb = merged;
        window.dispatchEvent(new CustomEvent('npa-cloud-data-updated', {
            detail: { airportsDb: merged }
        }));
        return merged;
    }

    function getPendingCloudWrites() {
        const queue = readJsonStorage(NPA_PENDING_CLOUD_WRITES_KEY, []);
        return Array.isArray(queue)
            ? queue.filter(item => isValidAirportReferenceKey(sanitizeAirportCode(item?.airportCode)))
            : [];
    }

    function setPendingCloudWrites(queue) {
        const normalized = Array.isArray(queue)
            ? queue.filter(item => isValidAirportReferenceKey(sanitizeAirportCode(item?.airportCode)))
            : [];
        writeJsonStorage(NPA_PENDING_CLOUD_WRITES_KEY, normalized);
        window.dispatchEvent(new CustomEvent('npa-pending-sync-changed', {
            detail: { pendingCount: normalized.length }
        }));
    }

    function pendingWriteId(item) {
        return `${item?.kind || ''}:${sanitizeAirportCode(item?.airportCode)}:${item?.approachName || ''}`;
    }

    function queueCloudWrite(item) {
        const code = sanitizeAirportCode(item?.airportCode);
        if (!item || !item.kind || !isValidAirportReferenceKey(code)) return;
        const queued = {
            ...item,
            airportCode: code,
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
        return Boolean(getTrustedAdminUser());
    }

    function safeApproachKey(value) {
        return String(value || '').trim().replace(/[.#$[\]/]/g, '_');
    }

    async function writeAirportReferenceToCloud(airportCode, airportData) {
        if (!isFirebaseReady() || !getLiveAdminUser()) throw new Error('Admin Firebase mode is required');
        const code = sanitizeAirportCode(airportCode);
        if (!isValidAirportReferenceKey(code)) throw new Error('Valid airport code is required');
        const serialized = serializeReferenceAirport(code, airportData);
        await window.npaDb.ref(`airportsReference/${code}`).set(serialized);

        // Keep the manually persisted Firebase snapshot aligned before the
        // realtime listener confirms the same write.
        const references = readJsonStorage(NPA_REFERENCE_CACHE_KEY, {});
        references[code] = serialized;
        writeJsonStorage(NPA_REFERENCE_CACHE_KEY, references);
        rebuildCombinedLocalDb();
    }

    async function deleteAirportReferenceFromCloud(airportCode) {
        if (!isFirebaseReady() || !getLiveAdminUser()) throw new Error('Admin Firebase mode is required');
        const code = sanitizeAirportCode(airportCode);
        if (!isValidAirportReferenceKey(code)) throw new Error('Valid airport code is required');
        await window.npaDb.ref(`airportsReference/${code}`).remove();
    }

    async function deleteAirportFromCloud(airportCode) {
        if (!isFirebaseReady() || !getLiveAdminUser()) throw new Error('Admin Firebase mode is required');
        const code = sanitizeAirportCode(airportCode);
        if (!isValidAirportReferenceKey(code)) throw new Error('Valid airport code is required');
        await Promise.all([
            window.npaDb.ref(`airportsReference/${code}`).remove(),
            window.npaDb.ref(`airportsNpa/${code}`).remove()
        ]);
    }

    async function writeApproachToCloud(airportCode, approachName, approachData) {
        if (!isFirebaseReady() || !getLiveAdminUser()) throw new Error('Admin Firebase mode is required');
        const code = sanitizeAirportCode(airportCode);
        const key = safeApproachKey(approachName);
        if (!isValidAirportReferenceKey(code) || !key) throw new Error('Airport and approach are required');
        const serialized = {
            ...approachData,
            name: approachName,
            updatedAt: Number(approachData?.updatedAt) || Date.now()
        };
        await window.npaDb.ref(`airportsNpa/${code}/approaches/${key}`).set(serialized);

        const cloudApproaches = readJsonStorage(NPA_CLOUD_APPROACHES_KEY, {});
        const airportEntry = cloudApproaches[code] && typeof cloudApproaches[code] === 'object'
            ? cloudApproaches[code]
            : {};
        const approaches = airportEntry.approaches && typeof airportEntry.approaches === 'object'
            ? airportEntry.approaches
            : {};
        cloudApproaches[code] = {
            ...airportEntry,
            approaches: {
                ...approaches,
                [key]: serialized
            }
        };
        writeJsonStorage(NPA_CLOUD_APPROACHES_KEY, cloudApproaches);
        rebuildCombinedLocalDb();
    }

    async function writePendingItem(item) {
        if (item.kind === 'reference') {
            await writeAirportReferenceToCloud(item.airportCode, item.data);
            return;
        }
        if (item.kind === 'deleteReference') {
            await deleteAirportReferenceFromCloud(item.airportCode);
            return;
        }
        if (item.kind === 'deleteAirport') {
            await deleteAirportFromCloud(item.airportCode);
            return;
        }
        if (item.kind === 'approach') {
            await writeApproachToCloud(item.airportCode, item.approachName, item.data);
            return;
        }
        throw new Error(`Unknown MyNPA pending write kind: ${item.kind}`);
    }

    async function syncPendingCloudWrites() {
        if (syncInProgress || !navigator.onLine || !isFirebaseReady() || !getLiveAdminUser()) return false;
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
            const shouldReuseExisting = existing
                && existing.dataset.firebaseSdkFailed !== 'true'
                && existing.dataset.firebaseSdkLoaded !== 'true';
            const script = shouldReuseExisting ? existing : document.createElement('script');
            const onLoad = () => {
                script.dataset.firebaseSdkLoaded = 'true';
                validator() ? resolve(true) : reject(new Error(`Firebase ${label} SDK did not initialize`));
            };
            const onError = () => {
                script.dataset.firebaseSdkFailed = 'true';
                reject(new Error(`Firebase ${label} SDK failed to load`));
            };

            if (existing && !shouldReuseExisting) existing.remove();
            script.addEventListener('load', onLoad, { once: true });
            script.addEventListener('error', onError, { once: true });
            if (!shouldReuseExisting) {
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
                    if (user) {
                        rememberAdminSession(user);
                    }
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
        isOfflineAdmin: () => !getLiveAdminUser() && Boolean(getCachedAdminSession()),
        getAdminUser: getTrustedAdminUser,
        getLiveAdminUser,
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

    if (typeof window.handleNpaAdminAuthState === 'function') {
        const adminUser = getTrustedAdminUser();
        if (adminUser) window.handleNpaAdminAuthState(adminUser);
    }

    const boot = () => initNpaFirebase()
        .then(() => syncPendingCloudWrites())
        .catch(error => {
            console.warn('MyNPA Firebase boot skipped:', error);
        });
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


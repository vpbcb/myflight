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

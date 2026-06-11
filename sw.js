const CACHE_NAME = 'myflight_v.260610-3';
const ASSET_FETCH_TIMEOUT_MS = 20000;

// New worker activates only after every critical asset is cached.
const CRITICAL_ASSETS = [
    './',
    './index.html',
    './manifest.json',
    './app.js',
    './myfuel.html',
    './mywind.html',
    './mypath.html',
    './mynpa.html',
    './myshift.html',
    './offline.html',
    './suflights.js',
    './dbaircraft.js'
];

// Images warm after the new worker controls the page.
const OPTIONAL_ASSETS = [
    './myflightlogo.png',
    './icons/icon-192.png',
    './icons/icon-512.png',
    './icons/icon-maskable-192.png',
    './icons/icon-maskable-512.png',
    './toicon.png',
    './landicon.png',
    './fdp.png',
    './fap.png',
    './handicon.png'
];

const FALLBACK_HTML = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Offline</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background: #0b0f19; color: #cbd5e1; text-align: center; padding: 20px; margin: 0; }
        .box { background: #161e2e; padding: 30px; border-radius: 16px; border: 1px solid rgba(255,255,255,0.1); }
        h2 { margin-top: 0; color: #38bdf8; }
    </style>
</head>
<body>
    <div class="box">
        <h2>Application is initializing</h2>
        <p>Cache is empty. Connect to the internet for a few seconds.</p>
    </div>
</body>
</html>
`;

// Always prefer the cache owned by this worker. Older app caches remain
// available only as offline fallback until optional assets finish warming.
const get = async (request, options) => {
    const activeCache = await caches.open(CACHE_NAME);
    return await activeCache.match(request, options) || await caches.match(request, options);
};

const getAppShell = async (request) => {
    const cachedResponse = await get(request) || await get(request, { ignoreSearch: true });
    if (cachedResponse) return cachedResponse;

    const url = new URL(request.url);
    if (url.pathname.endsWith('/') || url.pathname.endsWith('/index.html')) {
        return await get('./') || await get('./index.html');
    }
    return null;
};

const put = async (request, response) => {
    if (!response || response.status !== 200 || response.type !== 'basic') return response;

    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());

    if (request.mode === 'navigate') {
        const url = new URL(request.url);
        if (url.pathname.endsWith('/index.html')) {
            await cache.put(url.pathname.replace('/index.html', '/'), response.clone());
        } else if (url.pathname.endsWith('/')) {
            await cache.put(url.pathname + 'index.html', response.clone());
        }
    }
    return response;
};

const inet = async (request, timeoutMs = 0) => {
    try {
        if (timeoutMs > 0) {
            const controller = new AbortController();
            const id = setTimeout(() => controller.abort(), timeoutMs);
            try {
                return await fetch(request, { signal: controller.signal });
            } finally {
                clearTimeout(id);
            }
        }
        return await fetch(request);
    } catch (error) {
        return null;
    }
};

const cacheOrInet = async (request) => {
    const cachedResponse = await get(request);
    if (cachedResponse) return cachedResponse;

    const networkResponse = await inet(request);
    if (networkResponse) return await put(request, networkResponse);
    return null;
};

const isExternalRequest = (request) => {
    try {
        return new URL(request.url).origin !== self.location.origin;
    } catch (error) {
        return false;
    }
};

const cacheAsset = async (cache, asset, required) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), ASSET_FETCH_TIMEOUT_MS);
    try {
        const request = new Request(asset, { cache: 'reload' });
        const response = await fetch(request, { signal: controller.signal });
        if (!response || !response.ok) {
            throw new Error(`HTTP ${response ? response.status : 'no response'}`);
        }
        await cache.put(request, response);
        return true;
    } catch (error) {
        const level = required ? 'error' : 'warn';
        console[level](`[SW] ${required ? 'Critical' : 'Optional'} asset failed: ${asset}`, error);
        if (required) throw error;
        return false;
    } finally {
        clearTimeout(timeoutId);
    }
};

const cacheAssets = async (assets, required) => {
    const cache = await caches.open(CACHE_NAME);
    const results = await Promise.all(assets.map(asset => cacheAsset(cache, asset, required)));
    return results.every(Boolean);
};

const getMissingCurrentAssets = async assets => {
    const cache = await caches.open(CACHE_NAME);
    const checks = await Promise.all(assets.map(async asset => ({
        asset,
        cached: Boolean(await cache.match(asset))
    })));
    return checks.filter(item => !item.cached).map(item => item.asset);
};

const deleteOldAppCaches = async () => {
    const keys = await caches.keys();
    await Promise.all(keys
        .filter(key => /^myflight_/i.test(key) && key !== CACHE_NAME)
        .map(key => caches.delete(key)));
};

let optionalWarmPromise = null;
const warmOptionalCache = () => {
    if (!optionalWarmPromise) {
        optionalWarmPromise = getMissingCurrentAssets(OPTIONAL_ASSETS)
            .then(missingAssets => cacheAssets(missingAssets, false))
            .then(async complete => {
                if (complete) {
                    await deleteOldAppCaches();
                    console.log('[SW] Optional cache ready; old app caches removed.');
                } else {
                    console.warn('[SW] Optional cache incomplete; old app cache kept as fallback.');
                }
                return complete;
            })
            .finally(() => {
                optionalWarmPromise = null;
            });
    }
    return optionalWarmPromise;
};

self.addEventListener('install', event => {
    event.waitUntil(
        cacheAssets(CRITICAL_ASSETS, true)
            .then(() => {
                console.log('[SW] Critical cache ready; activating new worker.');
                return self.skipWaiting();
            })
            .catch(error => {
                console.error('[SW] Critical cache failed; keeping previous worker active.', error);
                throw error;
            })
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('message', event => {
    const type = event.data && event.data.type;
    if (type === 'GET_CACHE_NAME') {
        if (event.ports && event.ports[0]) {
            event.ports[0].postMessage({ cacheName: CACHE_NAME });
        }
        return;
    }
    if (type === 'WARM_OPTIONAL_CACHE') {
        const promise = warmOptionalCache();
        event.waitUntil(promise);
        if (event.ports && event.ports[0]) {
            promise.then(complete => event.ports[0].postMessage({ complete }));
        }
        return;
    }
    if (type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;

    if (event.request.mode === 'navigate') {
        const networkFetch = inet(event.request, 3000)
            .then(networkResponse => {
                if (networkResponse && networkResponse.status === 200) {
                    return put(event.request, networkResponse.clone());
                }
                return null;
            })
            .catch(() => null);
        event.waitUntil(networkFetch);

        event.respondWith((async () => {
            const cachedResponse = await getAppShell(event.request);
            if (cachedResponse) return cachedResponse;

            const fallbackNetwork = await inet(event.request, 3000);
            return fallbackNetwork || new Response(FALLBACK_HTML, {
                status: 200,
                headers: { 'Content-Type': 'text/html; charset=utf-8' }
            });
        })());
        return;
    }

    event.respondWith((async () => {
        if (isExternalRequest(event.request)) {
            const networkResponse = await inet(event.request);
            return networkResponse || Response.error();
        }

        const response = await cacheOrInet(event.request);
        return response || new Response('', { status: 200 });
    })());
});

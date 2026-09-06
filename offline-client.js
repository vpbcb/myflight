// Prepare updates automatically; only an explicit update reloads this window.
(function () {
    const scope = new URL('./', location.href);
    const scriptURL = new URL('sw.js', scope).href;
    const buildId = document.querySelector('meta[name="offline-build"]')?.content;
    let registration, busy = false, reloading = false, startupError = false;
    const timeout = (promise, ms = 20000) => {
        let timer;
        return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Update timed out')), ms); })]).finally(() => clearTimeout(timer));
    };
    function message(worker, type) {
        return new Promise(resolve => {
            if (!worker || worker.scriptURL !== scriptURL) { resolve(null); return; }
            const channel = new MessageChannel();
            const finish = data => { clearTimeout(timer); channel.port1.close(); channel.port2.close(); resolve(data); };
            const timer = setTimeout(() => finish(null), type === 'REPAIR_OFFLINE_CACHE' ? 18000 : 5000);
            channel.port1.onmessage = event => finish(event.data);
            try { worker.postMessage({ type }, [channel.port2]); } catch { finish(null); }
        });
    }
    function waitState(worker, states) {
        return new Promise((resolve, reject) => {
            const finish = error => { clearTimeout(timer); worker.removeEventListener('statechange', inspect); error ? reject(error) : resolve(); };
            const inspect = () => {
                if (worker.state === 'redundant') finish(Error('Installation failed'));
                else if (states.includes(worker.state)) finish();
            };
            const timer = setTimeout(() => finish(Error('Installation timed out')), 20000);
            worker.addEventListener('statechange', inspect); inspect();
        });
    }
    function healthy() {
        const worker = navigator.serviceWorker?.controller;
        if (!startupError && buildId && worker?.scriptURL === scriptURL && document.readyState === 'complete') {
            worker.postMessage({ type: 'CLIENT_READY', buildId });
        }
    }
    async function prepare() {
        if (!('serviceWorker' in navigator) || navigator.onLine === false) return;
        registration = await timeout(navigator.serviceWorker.register(scriptURL, { scope: scope.pathname, updateViaCache: 'none' }));
        await timeout(registration.update());
        if (registration.active) await message(registration.active, 'REPAIR_OFFLINE_CACHE');
        healthy();
    }
    async function update() {
        if (navigator.onLine === false) return 'offline';
        if (busy || !('serviceWorker' in navigator)) return 'failed';
        if (!window.dispatchEvent(new Event('app-before-update', { cancelable: true }))) return 'failed';
        busy = true;
        try {
            await prepare();
            const worker = registration.installing || registration.waiting || registration.active;
            if (!worker || worker.scriptURL !== scriptURL) return 'failed';
            await waitState(worker, ['installed', 'activated']);
            if (worker.state === 'installed') {
                if (!(await message(worker, 'GET_OFFLINE_READY'))?.ready) return 'failed';
                worker.postMessage({ type: 'ACTIVATE_UPDATE' });
            }
            await waitState(worker, ['activated']);
            const status = await message(worker, 'REPAIR_OFFLINE_CACHE');
            if (!status?.ready) return 'failed';
            if (status.buildId !== buildId) {
                if (!reloading) { reloading = true; location.reload(); }
                return 'updated';
            }
            return 'current';
        } catch { return navigator.onLine === false ? 'offline' : 'failed'; }
        finally { busy = false; }
    }
    window.MyFlightUpdate = { update, prepare, healthy };
    window.addEventListener('error', event => {
        if (event.error || event.target?.tagName === 'SCRIPT') startupError = true;
    }, true);
    window.addEventListener('load', healthy);
    navigator.serviceWorker?.addEventListener('controllerchange', healthy);
    const retry = () => { if (!busy) { busy = true; prepare().catch(() => {}).finally(() => { busy = false; }); } };
    window.addEventListener('online', retry);
    window.addEventListener('focus', retry);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') retry(); });
    navigator.storage?.persist?.().catch(() => false);
    retry();
})();

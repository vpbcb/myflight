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
    // «Приложение обновлено»: один раз на смену имени кэша (номер версии, который видит пользователь),
    // при первом открытии страницы после смены. Только читает meta/localStorage и спрашивает у воркера
    // имя кэша; никогда не бросает исключений, иначе ошибка сочлась бы за startupError и заблокировала CLIENT_READY.
    const SEEN_BUILD_KEY = 'myflight_seen_build';
    const SEEN_APP_CACHE_KEY = 'myflight_seen_app_cache';
    function showUpdatedModal(version) {
        try {
            if (!document.body || document.getElementById('appUpdatedModal')) return;
            if (!document.getElementById('appUpdatedModalStyle')) {
                const style = document.createElement('style');
                style.id = 'appUpdatedModalStyle';
                style.textContent = '#appUpdatedModal{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;'
                    + 'background:rgba(0,0,0,.72);color:#cbd5e1;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;text-align:center}'
                    + '#appUpdatedModal .app-updated-box{width:min(82vw,320px);padding:24px 24px 18px;border-radius:16px;background:#161e2e;'
                    + 'border:1px solid rgba(255,255,255,.16);box-shadow:0 20px 60px rgba(0,0,0,.45)}'
                    + '#appUpdatedModal .app-updated-title{font-size:18px;font-weight:800;margin-bottom:8px;color:#38bdf8}'
                    + '#appUpdatedModal .app-updated-text{font-size:14px;line-height:1.35}'
                    + '#appUpdatedModal .app-updated-ok{margin-top:16px;min-width:96px;height:38px;border:0;border-radius:10px;'
                    + 'background:#1976d2;color:#fff;font:inherit;font-size:15px;font-weight:700;cursor:pointer}';
                document.head.appendChild(style);
            }
            const modal = document.createElement('div');
            modal.id = 'appUpdatedModal';
            modal.setAttribute('role', 'dialog');
            modal.setAttribute('aria-modal', 'true');
            const box = document.createElement('div');
            box.className = 'app-updated-box';
            const title = document.createElement('div');
            title.className = 'app-updated-title';
            title.textContent = 'Приложение обновлено';
            box.appendChild(title);
            if (version) {
                const text = document.createElement('div');
                text.className = 'app-updated-text';
                text.textContent = 'Версия ' + version;
                box.appendChild(text);
            }
            const ok = document.createElement('button');
            ok.type = 'button';
            ok.className = 'app-updated-ok';
            ok.textContent = 'OK';
            box.appendChild(ok);
            modal.appendChild(box);
            const close = () => modal.remove();
            ok.addEventListener('click', close);
            modal.addEventListener('click', event => { if (event.target === modal) close(); });
            document.body.appendChild(modal);
        } catch { /* Уведомление не должно влиять на работу приложения. */ }
    }
    async function announceActivatedBuild() {
        try {
            if (!buildId) return;
            let appCache = '';
            try {
                const info = await message(navigator.serviceWorker?.controller, 'GET_APP_INSTALLATION');
                appCache = String(info?.appCache || '');
            } catch { /* воркер не ответил */ }
            if (!appCache) return; // без имени кэша ничего не запоминаем — проверим при следующем открытии
            let seenCache, seenBuild;
            try {
                seenCache = localStorage.getItem(SEEN_APP_CACHE_KEY);
                seenBuild = localStorage.getItem(SEEN_BUILD_KEY);
            } catch { return; }
            if (seenCache === appCache) return;
            try {
                localStorage.setItem(SEEN_APP_CACHE_KEY, appCache);
                localStorage.setItem(SEEN_BUILD_KEY, buildId);
            } catch { return; }
            // Ключа кэша ещё нет: на уже установленном приложении смену версии видно по прежней сборке,
            // на новой установке сборки нет — это не обновление
            const updated = seenCache ? true : Boolean(seenBuild && seenBuild !== buildId);
            if (updated) showUpdatedModal(appCache.replace(/^myflight_?/i, ''));
        } catch { /* Уведомление не должно влиять на работу приложения. */ }
    }
    window.MyFlightUpdate = { update, prepare, healthy };
    window.addEventListener('error', event => {
        if (event.error || event.target?.tagName === 'SCRIPT') startupError = true;
    }, true);
    window.addEventListener('load', healthy);
    window.addEventListener('load', () => { announceActivatedBuild(); });
    navigator.serviceWorker?.addEventListener('controllerchange', healthy);
    const retry = () => { if (!busy) { busy = true; prepare().catch(() => {}).finally(() => { busy = false; }); } };
    window.addEventListener('online', retry);
    window.addEventListener('focus', retry);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') retry(); });
    navigator.storage?.persist?.().catch(() => false);
    retry();
})();

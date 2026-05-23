const CACHE_NAME = 'myflight_v.260523-7';

// Правило 1: Только строгие относительные пути
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './manifest.json',
    './app.js',
    './myfuel.html',
    './mywind.html',
    './mypath.html',
    './mynpa.html',
    './myshift.html',
    // --- ДОБАВИТЬ ЭТИ СТРОКИ: ---
    './suflights.js',    // БД рейсов (из index.html)
    './dbaircraft.js',   // БД самолетов (из index.html и myfuel.html)
    './myflightlogo.png',// Логотип
    './icons/icon-192.png',
    './icons/icon-512.png',
    './toicon.png',      // Иконка взлета (MyWind)
    './landicon.png',    // Иконка посадки (MyWind)
    './fdp.png',         // Иконка (MyPath)
    './fap.png',         // Иконка (MyPath)
    './handicon.png'     // Иконка (MyFuel)
];

// Правило 5: Inline Fallback (Резервный HTML при отсутствии сети и кэша)
const FALLBACK_HTML = `
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Оффлайн режим</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background: #0b0f19; color: #cbd5e1; text-align: center; padding: 20px; margin: 0; }
        .box { background: #161e2e; padding: 30px; border-radius: 16px; border: 1px solid rgba(255,255,255,0.1); }
        h2 { margin-top: 0; color: #38bdf8; }
    </style>
</head>
<body>
    <div class="box">
        <h2>✈️ Система инициализируется</h2>
        <p>Кэш пуст. Для запуска инструмента подключитесь к сети на несколько секунд.</p>
    </div>
</body>
</html>
`;

// --- Архитектура вспомогательных функций (Правило 2 и 3) ---

// Чтение из кэша
const get = async (request, options) => {
    return await caches.match(request, options);
};

// HTML shell must survive launches with query strings, for example ?reset=...
const getAppShell = async (request) => {
    const cachedResponse = await get(request) || await get(request, { ignoreSearch: true });
    if (cachedResponse) return cachedResponse;

    const url = new URL(request.url);
    if (url.pathname.endsWith('/') || url.pathname.endsWith('/index.html')) {
        return await get('./') || await get('./index.html');
    }

    return null;
};

// Запись в кэш с решением "Проблемы слэша"
const put = async (request, response) => {
    if (!response || response.status !== 200 || response.type !== 'basic') return response;
    
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
    
    // Дублирование для навигации (чтобы кэш работал и по прямой ссылке, и по слэшу)
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

// Сетевой запрос с жестким таймаутом (Защита от Lie-Fi)
const inet = async (request, timeoutMs = 0) => {
    try {
        if (timeoutMs > 0) {
            const controller = new AbortController();
            const id = setTimeout(() => controller.abort(), timeoutMs);
            const response = await fetch(request, { signal: controller.signal });
            clearTimeout(id);
            return response;
        }
        return await fetch(request);
    } catch (error) {
        // Ошибка сети или прерывание по таймауту
        return null; 
    }
};

// Стратегия: Network First (Самолечение для основы)
const inet_or_cache = async (request) => {
    // Ждем сеть максимум 3 секунды. Если нет - падаем в кэш.
    const networkResponse = await inet(request, 3000); 
    if (networkResponse) {
        return await put(request, networkResponse); // Незаметно обновляем кэш
    }
    return await get(request);
};

// Стратегия: Cache First (Для статики)
const cache_or_inet = async (request) => {
    const cachedResponse = await get(request);
    if (cachedResponse) return cachedResponse;
    
    const networkResponse = await inet(request);
    if (networkResponse) {
        return await put(request, networkResponse);
    }
    return null;
};

// --- Жизненный цикл Service Worker ---

self.addEventListener('install', event => {
    // УБРАНО: Безусловный self.skipWaiting(); который ломал текущую версию
    
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            console.log('[SW] Скачивание свежих файлов...');
            
            // ИСПРАВЛЕНО: Было urlsToCache, стало ASSETS_TO_CACHE
            const requests = ASSETS_TO_CACHE.map(url => new Request(url, { cache: 'reload' }));
            
            // Ждем полного скачивания всех файлов
            return cache.addAll(requests);
        }).then(() => {
            // Активируем новый SW ТОЛЬКО если все файлы успешно скачались
            console.log('[SW] Установка успешна, активируем...');
            return self.skipWaiting();
        }).catch(err => {
            console.error('[SW] Ошибка скачивания кэша, прерываем обновление:', err);
            // Если EDGE оборвал скачивание, мы не активируем новый SW, 
            // и старый рабочий кэш остается нетронутым.
            throw err;
        })
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => Promise.all(
            keys.map((key) => {
                if (key !== CACHE_NAME) {
                    return caches.delete(key);
                }
            })
        )).then(() => self.clients.claim())
    );
});

self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

// Перехват запросов (Ядро маршрутизации)
self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;
    
    event.respondWith((async () => {
        // ИСПРАВЛЕНИЕ: Для навигации (HTML) используем Stale-While-Revalidate
        // Сначала мгновенно отдаем из кэша, а в фоне пытаемся стянуть свежую версию из сети
        if (event.request.mode === 'navigate') {
            const cachedResponse = await getAppShell(event.request);
            
            // Фоновый запрос за свежим HTML (не блокирует загрузку страницы)
            const networkFetch = inet(event.request, 3000).then(networkResponse => {
                if (networkResponse && networkResponse.status === 200) {
                    put(event.request, networkResponse.clone());
                }
            }).catch(() => {}); // Игнорируем ошибки сети в фоне

            // Если есть кэш — отдаем мгновенно. Если нет — ждем сеть. Если и сети нет — Fallback.
            if (cachedResponse) {
                return cachedResponse;
            } else {
                const fallbackNetwork = await inet(event.request, 3000);
                return fallbackNetwork || new Response(FALLBACK_HTML, { 
                    status: 200, 
                    headers: { 'Content-Type': 'text/html; charset=utf-8' } 
                });
            }
        } else {
            // Для ресурсов (JS, CSS, картинки) оставляем Cache First
            const response = await cache_or_inet(event.request);
            return response || new Response('', { status: 200 });
        }
    })());
});

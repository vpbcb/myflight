// Меняй версию здесь при любом обновлении кода (например, v1.1, v1.2)
const CACHE_NAME = 'mywind-260427-1';
const SCOPE = self.registration.scope;

// Динамическое формирование путей от корня регистрации Service Worker'а
const ASSETS_TO_CACHE = [
    SCOPE,
    SCOPE + 'index.html',
    SCOPE + 'offline.html',
    SCOPE + 'manifest.json',
    SCOPE + 'landicon.png',
    SCOPE + 'toicon.png',
    SCOPE + 'windappicon.png',
    SCOPE + 'windapple-icon.png'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      const requests = ASSETS_TO_CACHE.map(url => new Request(url, { cache: 'reload' }));
      await Promise.allSettled(requests.map(req => cache.add(req)));
    })
  );
});

// === ТОТ САМЫЙ БЛОК ACTIVATE ДЛЯ ОЧИСТКИ СТАРОГО МУСОРА ===
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    // Удаляем старые кэши, если имя изменилось
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
    self.clients.claim();
});

// Перехват запросов (EFB Standard: Cache First)
self.addEventListener('fetch', (event) => {
    // Обход кэша для системных запросов с защитой от краша в оффлайне
    if (event.request.url.includes('sw.js') || event.request.url.includes('ping=')) {
        event.respondWith(
            fetch(event.request).catch(() => new Response('', { status: 503, statusText: 'Offline' }))
        );
        return;
    }

    event.respondWith(
        caches.match(event.request, { ignoreSearch: true }).then((cachedResponse) => {
            if (cachedResponse) {
                return cachedResponse;
            }
            
            return fetch(event.request).catch(async () => {
                // ГЛУХОЙ ОФФЛАЙН И NAVIGATION FALLBACK
                if (event.request.mode === 'navigate') {
                    // Ищем кэш по корневому пути ИЛИ по прямому пути к файлу
                    const fallback = await caches.match(SCOPE + 'index.html', { ignoreSearch: true })
              || await caches.match(SCOPE, { ignoreSearch: true })
              || await caches.match(SCOPE + 'offline.html', { ignoreSearch: true });

if (fallback) return fallback;

return new Response(
    '<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Offline</title></head><body style="background:#0b0f19;color:#cbd5e1;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center;margin:0;"><div><h2>NO INTERNET</h2><p>Please connect to the internet to restore app shell.</p></div></body></html>',
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
);
                }
                // Защита от undefined: для потерянных картинок/скриптов жестко отдаем пустой ответ
                // Пытаемся отдать ресурс из кэша повторно (в т.ч. без query), и только потом 503
const fallbackAsset = await caches.match(event.request, { ignoreSearch: true });
if (fallbackAsset) return fallbackAsset;
return new Response('', { status: 503, statusText: 'Offline' });
            });
        })
    );
});

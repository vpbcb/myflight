const CACHE_NAME = 'myflight_v.260906-1';
const APP_CACHE = CACHE_NAME;
const PRECACHE_BUILD = {"id":"84f6c49dc5b733d7aee901e5","assets":[{"url":"app.js","sha256":"3818287cba0a696d99b342ca934ea8da2c46b69edb8811213a3858e62c6ea278","mime":["text/javascript","application/javascript"]},{"url":"bottom-navigation.css","sha256":"99240caf45cdcb3e957ca32ff5b3443d2396a3a29a663fca4b3c5c854878de6d","mime":["text/css"]},{"url":"dbaircraft.js","sha256":"6158e2df5043f5c19efebfa5ebdce36a46b3f9f4f7a855a2889e84e7710154e8","mime":["text/javascript","application/javascript"]},{"url":"index.html","sha256":"7a8e9cd39fd418ff8379fe47a989c32a2db5d37b6f15a103380ec01d6551270f","mime":["text/html"]},{"url":"manifest.json","sha256":"e382db87c44960721e4b8ab0cd06a97d665d8dea6fce18564324fe645c3d913d","mime":["application/json","application/manifest+json"]},{"url":"myfuel.html","sha256":"2bc179aa7f8fcca32a7456f3d23c9e45739d22594adfa88a259557cf5df3f349","mime":["text/html"]},{"url":"mynpa.html","sha256":"72045aac386c210629d51881a2ff5dce711319b397d1d89559265f49b3f831b5","mime":["text/html"]},{"url":"mypath.html","sha256":"cf58b36504c53f7c13f2a09a543db65779cc0f18b2fac4652d09fb81aef0affb","mime":["text/html"]},{"url":"myshift.html","sha256":"d630f7cd73425e9809563af7a0337b4359b979bdb2e61e59513975245b1d1a98","mime":["text/html"]},{"url":"mywind.html","sha256":"ccfa3328e9d5265cbf94be2f7f0ce26ad243036d63aea5d0ffeff1629d16d702","mime":["text/html"]},{"url":"offline-client.js","sha256":"586b942a120aa82cf89c3da5aa75fcc120d76df670550a02fe9167225ec9d112","mime":["text/javascript","application/javascript"]},{"url":"offline.html","sha256":"4c09a1323f85c13aa1ca7f012573fd3610a484c074661032c061d8e5651daec4","mime":["text/html"]},{"url":"suflights.js","sha256":"cf60f70830ceedeb0242971216ccced6d4246313e6e84a3b77913113d7543235","mime":["text/javascript","application/javascript"]},{"url":"vendor/firebase-app-compat.js","sha256":"2d038b9f99cdc28119b4e5c2a4ed86d561fc36c051e515ef35176b1cabe780c1","mime":["text/javascript","application/javascript"]},{"url":"vendor/firebase-auth-compat.js","sha256":"1451e1285d1a09eed6c9f71b07ba01fb097add66b024d13e2454ba07d50a53c6","mime":["text/javascript","application/javascript"]},{"url":"vendor/firebase-database-compat.js","sha256":"1fdd331f8fd0448f9d7ce97573cb828a83aad7a7bb2c4da0e75fdb9563eef129","mime":["text/javascript","application/javascript"]}]};
const APP_ID = "myflight";
const LEGACY_PREFIXES = ["myflight_"];
const OPTIONAL_ASSETS = ["myflightlogo.png", "icons/icon-shortcut-144.png", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-192.png", "icons/icon-maskable-512.png", "toicon.png", "landicon.png", "fdp.png", "fap.png", "handicon.png"];
const FALLBACK_HTML = '<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MyFlight — офлайн</title><body><h1>MyFlight</h1><p>Офлайн-копия недоступна. Подключитесь к интернету и откройте приложение снова. Пользовательские данные не удалены.</p></body></html>';

// Offline protocol 2: immutable releases, repair, persistent client pins.
const APP_BASE_URL = new URL(self.registration.scope);
const CACHE_PREFIX = APP_ID + "-shell-v2:" + encodeURIComponent(APP_BASE_URL.href) + ":";
const BUILD_CACHE = CACHE_PREFIX + APP_CACHE + ":" + PRECACHE_BUILD?.id;
const CLIENT_CACHE = APP_ID + "-clients:" + encodeURIComponent(APP_BASE_URL.href);
const READY_URL = new URL("__offline_ready__", APP_BASE_URL).href;
const PENDING_URL = new URL("__offline_pending__", APP_BASE_URL).href;
const COMPATIBILITY = 1; // Bump before an incompatible local database migration.
const appUrl = path => new URL(path, APP_BASE_URL).href;
const belongsToApp = url => url.origin === APP_BASE_URL.origin && url.pathname.startsWith(APP_BASE_URL.pathname)
  && !["/__/auth/", "/__/firebase/"].some(prefix => url.pathname.startsWith(prefix));
const urlOf = request => typeof request === "string" ? request : request.url;
const digest = async response => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await response.clone().arrayBuffer())), n => n.toString(16).padStart(2, "0")).join("");
const mimeMatches = (response, asset) => !asset.mime || asset.mime.includes((response.headers.get("Content-Type") || "").split(";")[0].trim());

async function readDescriptor(name, verify = true) {
  if (!name?.startsWith(CACHE_PREFIX)) return null;
  try {
    const cache = await caches.open(name), marker = await cache.match(READY_URL);
    if (!marker) return null;
    const meta = await marker.json();
    if (meta.schema !== 2 || meta.compatibility !== COMPATIBILITY || !meta.assets?.length
      || !meta.assets.some(asset => asset.url === "index.html")) return null;
    if (verify && !(await Promise.all(meta.assets.map(async asset => {
      if (!belongsToApp(new URL(appUrl(asset.url))) || !/^[a-f0-9]{64}$/.test(asset.sha256)) return false;
      const response = await cache.match(appUrl(asset.url));
      return response?.ok && mimeMatches(response, asset) && await digest(response) === asset.sha256;
    }))).every(Boolean)) return null;
    return { name, cache, meta };
  } catch { return null; }
}
async function completeBuilds() {
  const names = (await caches.keys()).filter(name => name.startsWith(CACHE_PREFIX));
  const builds = (await Promise.all(names.map(name => readDescriptor(name)))).filter(Boolean);
  return builds.sort((a, b) => Number(b.meta.id === PRECACHE_BUILD?.id) - Number(a.meta.id === PRECACHE_BUILD?.id)
    || b.meta.installedAt - a.meta.installedAt);
}
async function downloadAsset(cache, asset) {
  const controller = new AbortController();
  let timer;
  try {
    await Promise.race([(async () => {
      const url = appUrl(asset.url);
      if (!belongsToApp(new URL(url))) throw new Error("Asset outside application scope");
      const response = await fetch(new Request(url, { cache: "reload" }), { signal: controller.signal });
      if (!response.ok || !mimeMatches(response, asset) || await digest(response) !== asset.sha256)
        throw new Error("Invalid release resource: " + asset.url);
      await cache.put(url, response);
    })(), new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error("Resource download timed out")); }, 12000);
    })]);
  } finally { clearTimeout(timer); }
}
let repairPromise;
function ensureCurrentBuild() {
  if (repairPromise) return repairPromise;
  repairPromise = (async () => {
    if (!PRECACHE_BUILD?.assets?.length) throw new Error("Build the offline shell before publishing");
    const existing = (await completeBuilds()).find(item => item.meta.id === PRECACHE_BUILD.id);
    if (existing) return existing;
    // Even repair writes elsewhere: an open page may still use the damaged cache.
    const names = await caches.keys();
    const name = names.includes(BUILD_CACHE) ? BUILD_CACHE + ":repair:" + Date.now() + "-" + Math.random() : BUILD_CACHE;
    const cache = await caches.open(name);
    try {
      await cache.put(PENDING_URL, new Response(String(Date.now())));
      const results = await Promise.allSettled(PRECACHE_BUILD.assets.map(asset => downloadAsset(cache, asset)));
      if (results.some(result => result.status === "rejected")) throw new Error("Incomplete offline shell");
      const index = await cache.match(appUrl("index.html"));
      if (!index) throw new Error("Missing entry page");
      await cache.put(appUrl(""), index);
      const meta = { schema: 2, compatibility: COMPATIBILITY, ...PRECACHE_BUILD, appCache: APP_CACHE, installedAt: Date.now() };
      await cache.put(READY_URL, new Response(JSON.stringify(meta), { headers: { "X-App-Installed-At": String(meta.installedAt) } }));
      const committed = await readDescriptor(name);
      if (!committed) throw new Error("Offline cache verification failed");
      return committed;
    } catch (error) { await caches.delete(name); throw error; }
  })().finally(() => { repairPromise = null; });
  return repairPromise;
}
async function installAppShell() {
  await ensureCurrentBuild();
  if (!self.registration.active) await self.skipWaiting();
}
async function pinnedBuild(clientId) {
  if (!clientId) return null;
  try {
    const response = await (await caches.open(CLIENT_CACHE)).match(appUrl("__offline_client__/" + clientId));
    const pin = response && await response.json();
    return pin ? await readDescriptor(pin.name, false) : null;
  } catch { return null; }
}
async function pinClient(clientId, build) {
  if (!clientId || !build) return;
  try {
    await (await caches.open(CLIENT_CACHE)).put(appUrl("__offline_client__/" + clientId), new Response(JSON.stringify({ name: build.name })));
  } catch { /* Never discard a release or user data if metadata storage fails. */ }
}
async function legacyMatch(request) {
  for (const name of (await caches.keys()).reverse()) {
    if (!LEGACY_PREFIXES.some(prefix => name.startsWith(prefix))) continue;
    const response = await (await caches.open(name)).match(request);
    if (response) return response;
  }
}
async function matchAppCaches(request, clientId) {
  if (!belongsToApp(new URL(urlOf(request)))) return undefined;
  const pin = await pinnedBuild(clientId);
  for (const build of pin ? [pin] : await completeBuilds()) {
    const response = await build.cache.match(request);
    if (!response) continue;
    const asset = build.meta.assets.find(asset => appUrl(asset.url) === urlOf(request));
    if (asset && (await digest(response) !== asset.sha256 || !mimeMatches(response, asset))) continue;
    return response;
  }
  return pin ? undefined : legacyMatch(request);
}
async function fetchWithTimeout(request, milliseconds = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), milliseconds);
  try {
    const response = await fetch(request, { signal: controller.signal });
    await response.clone().arrayBuffer();
    return response;
  } finally { clearTimeout(timer); }
}
async function appShellResponse(request, clientId) {
  try {
    let build = (await completeBuilds())[0];
    if (!build) { try { build = await ensureCurrentBuild(); } catch { /* Legacy fallback below. */ } }
    if (build) {
      const relative = new URL(urlOf(request)).pathname.slice(APP_BASE_URL.pathname.length);
      const page = relative.endsWith(".html") ? appUrl(relative) : appUrl("index.html");
      const response = await build.cache.match(page);
      if (response) { await pinClient(clientId, build); return response; }
    }
    const legacy = await legacyMatch(urlOf(request)) || await legacyMatch(appUrl("index.html")) || await legacyMatch(appUrl(""));
    if (legacy) return legacy;
  } catch { /* Storage failure must not prevent an online launch or a readable fallback. */ }
  try { const response = await fetchWithTimeout(request, 3000); if (response.ok) return response; }
  catch { /* No network. */ }
  return new Response(FALLBACK_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
async function cacheFirst(request, clientId) {
  try { const cached = await matchAppCaches(request, clientId); if (cached) return cached; } catch { /* Try network. */ }
  try {
    const pin = await pinnedBuild(clientId);
    const asset = (pin?.meta.assets ?? PRECACHE_BUILD?.assets)?.find(asset => appUrl(asset.url) === urlOf(request));
    if (asset) {
      if (!pin || pin.meta.id === PRECACHE_BUILD?.id) {
        try { const build = await ensureCurrentBuild(); const cached = await build.cache.match(request); if (cached) return cached; }
        catch { /* Online resources can still run when persistence is unavailable. */ }
      }
      const response = await fetchWithTimeout(request);
      return response.ok && mimeMatches(response, asset) && await digest(response) === asset.sha256 ? response : Response.error();
    }
    if (pin && pin.meta.id !== PRECACHE_BUILD?.id) return Response.error();
    return await fetchWithTimeout(request);
  } catch { return Response.error(); }
}
let optionalWarmPromise;
function warmOptionalCache() {
  if (optionalWarmPromise) return optionalWarmPromise;
  optionalWarmPromise = (async () => {
    const build = await ensureCurrentBuild();
    await Promise.allSettled(OPTIONAL_ASSETS.map(async path => {
      const url = appUrl(path);
      if (await build.cache.match(url)) return;
      const response = await fetchWithTimeout(new Request(url));
      if (response.ok && !response.headers.get("Content-Type")?.includes("text/html")) await build.cache.put(url, response);
    }));
  })().catch(() => undefined).finally(() => { optionalWarmPromise = null; });
  return optionalWarmPromise;
}
async function collectOldBuilds() {
  if (self.registration.installing || self.registration.waiting || repairPromise || !self.clients?.matchAll) return;
  const builds = await completeBuilds();
  if (builds[0]?.meta.id !== PRECACHE_BUILD?.id) return;
  const clients = (await self.clients.matchAll({ type: "window", includeUncontrolled: true })).filter(client => belongsToApp(new URL(client.url)));
  const pins = await Promise.all(clients.map(client => pinnedBuild(client.id)));
  if (pins.some(pin => !pin)) return; // Unknown old clients block collection.
  const generations = [...new Set(builds.map(build => build.meta.id))].slice(0, 2);
  const keep = new Set([...builds.filter(build => generations.includes(build.meta.id)).map(build => build.name), ...pins.map(pin => pin.name)]);
  for (const name of await caches.keys()) {
    if (!name.startsWith(CACHE_PREFIX) || keep.has(name)) continue;
    const cache = await caches.open(name), descriptor = await readDescriptor(name, false);
    const pending = await cache.match(PENDING_URL);
    const createdAt = descriptor?.meta.installedAt || Number(pending && await pending.text());
    if (createdAt > 0 && Date.now() - createdAt > 86400000) await caches.delete(name);
  }
  const clientCache = await caches.open(CLIENT_CACHE);
  if (clientCache.keys && clientCache.delete) {
    const live = new Set(clients.map(client => appUrl("__offline_client__/" + client.id)));
    for (const request of await clientCache.keys()) if (!live.has(request.url)) await clientCache.delete(request);
  }
}
self.addEventListener("install", event => event.waitUntil(installAppShell()));
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET" || !belongsToApp(new URL(request.url))) return;
  if (request.mode === "navigate") {
    event.respondWith(appShellResponse(request, event.resultingClientId));
    event.waitUntil(warmOptionalCache());
  } else event.respondWith(cacheFirst(request, event.clientId));
});
self.addEventListener("message", event => {
  const type = event.data?.type, reply = data => event.ports?.[0]?.postMessage(data);
  event.waitUntil((async () => {
    try {
      if (type === "ACTIVATE_UPDATE" || type === "SKIP_WAITING") { await ensureCurrentBuild(); await self.skipWaiting(); return; }
      if (type === "REPAIR_OFFLINE_CACHE") await ensureCurrentBuild();
      if (type === "CLIENT_READY") {
        const build = (await completeBuilds()).find(build => build.meta.id === event.data.buildId);
        if (build && event.source?.id) { await pinClient(event.source.id, build); await collectOldBuilds(); }
        return;
      }
      if (type === "WARM_OPTIONAL_CACHE") { await warmOptionalCache(); reply({ complete: true }); return; }
      const build = (await completeBuilds()).find(build => build.meta.id === PRECACHE_BUILD?.id);
      if (type === "GET_CACHE_NAME") { reply({ cacheName: APP_CACHE, buildId: build?.meta.id }); return; }
      if (type === "GET_APP_INSTALLATION") { reply({ appCache: APP_CACHE, installedAt: build?.meta.installedAt ?? null }); return; }
      reply({ ready: Boolean(build), buildId: build?.meta.id, protocol: 2 });
    } catch { reply({ ready: false, installedAt: null, appCache: APP_CACHE, protocol: 2 }); }
  })());
});

self.addEventListener('notificationclick', event => {
    const rawUrl = event.notification?.data?.url || './';
    const targetUrl = new URL(rawUrl, self.registration.scope).href;
    event.notification.close();

    event.waitUntil((async () => {
        const windowClients = await clients.matchAll({
            type: 'window',
            includeUncontrolled: true
        });
        const appClient = windowClients.find(client => client.url.startsWith(self.registration.scope));

        if (appClient) {
            try {
                const navigatedClient = typeof appClient.navigate === 'function'
                    ? await appClient.navigate(targetUrl)
                    : appClient;
                const focusClient = navigatedClient || appClient;
                if (focusClient && typeof focusClient.focus === 'function') {
                    await focusClient.focus();
                    return;
                }
            } catch (error) {
                console.warn('[SW] Notification focus failed; opening app window.', error);
            }
        }

        if (clients.openWindow) {
            await clients.openWindow(targetUrl);
        }
    })());
});

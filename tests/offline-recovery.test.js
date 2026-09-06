const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { createHash, webcrypto } = require('node:crypto');
const scope = 'https://example.test/myflight/';
const workerSource = () => fs.readFileSync(path.join(__dirname, '..', fs.existsSync(path.join(__dirname, '../sw.source.js')) ? 'sw.source.js' : 'sw.js'), 'utf8');
const url = value => new URL(typeof value === 'string' ? value : value.url, scope).href;
function worker(id, storage = new Map(), options = {}) {
  const contents = { 'index.html': `<html>${id}<script src="app.js"></script></html>`, 'app.js': `/* ${id} */`, 'manifest.json': '{}' };
  const assets = Object.entries(contents).map(([url, body]) => ({ url, sha256: createHash('sha256').update(body).digest('hex') }));
  const events = {}; let activated = false; let offline = false;
  const caches = {
    keys: async () => [...storage.keys()], delete: async name => storage.delete(name),
    open: async name => {
      if (!storage.has(name)) storage.set(name, new Map());
      const data = storage.get(name);
      return { match: async request => data.get(url(request))?.clone(), put: async (request, response) => data.set(url(request), response.clone()) };
    }
  };
  class RelativeRequest extends Request { constructor(input, init) { super(url(input), init); } }
  const context = vm.createContext({ URL, Request: RelativeRequest, Response, Uint8Array, crypto: webcrypto, AbortController, setTimeout, clearTimeout,
    console: { log() {}, warn() {}, error() {} }, caches,
    self: { registration: { scope }, clients: { claim: async () => {} }, location: { origin: new URL(scope).origin }, addEventListener(type, callback) { events[type] = callback; }, skipWaiting: async () => { activated = true; } },
    fetch: async request => {
      if (offline || url(request).endsWith(options.fail || '__none__')) throw Error('network unavailable');
      return new Response(options.badBytes ? 'wrong release' : contents[url(request).slice(scope.length)] || 'optional');
    }
  });
  vm.runInContext(workerSource().replace('const PRECACHE_BUILD = null;', 'const PRECACHE_BUILD = ' + JSON.stringify({ id, assets }) + ';'), context);
  return { storage, context, events, caches, activated: () => activated, offline: () => { offline = true; },
    install: () => { let promise; events.install({ waitUntil(p) { promise = p; } }); return promise; },
    navigate: async clientId => { let promise; events.fetch({ request: { url: scope, method: 'GET', mode: 'navigate' }, resultingClientId: clientId, respondWith(p) { promise = p; }, waitUntil() {} }); return promise; }
  };
}
test('failed replacement with the same displayed version retains the working release', async () => {
  const old = worker('old'); await old.install();
  const next = worker('new', old.storage, { fail: 'app.js' });
  await assert.rejects(next.install());
  old.offline();
  assert.match(await (await old.navigate()).text(), /old/);
});
test('HTTP 200 with wrong release bytes cannot activate a worker', async () => {
  const app = worker('wrong', new Map(), { badBytes: true });
  await assert.rejects(app.install());
  assert.equal(app.activated(), false);
});
module.exports = { worker, scope };

test('old windows keep their matching app.js after activation and worker restart', async () => {
  const old = worker('old'); await old.install();
  await vm.runInContext(`appShellResponse(new Request('${scope}'), 'old-window')`, old.context);
  const next = worker('new', old.storage); await next.install();
  const cold = worker('new', old.storage); cold.offline();
  const script = await vm.runInContext(`cacheFirst(new Request('${scope}app.js'), 'old-window')`, cold.context);
  assert.match(await script.text(), /old/);
});
test('missing current app.js selects the complete backup HTML', async () => {
  const old = worker('old'); await old.install();
  const next = worker('new', old.storage); await next.install();
  for (const [name, entries] of old.storage) if (name.endsWith(':new')) entries.delete(scope + 'app.js');
  next.offline();
  const response = await vm.runInContext(`appShellResponse(new Request('${scope}'))`, next.context);
  assert.match(await response.text(), /old/);
});
test('repair restores the same release after its cache disappears', async () => {
  const app = worker('repair'); await app.install(); app.storage.clear();
  await vm.runInContext(`appShellResponse(new Request('${scope}'))`, app.context);
  app.offline();
  const response = await vm.runInContext(`cacheFirst(new Request('${scope}app.js'))`, app.context);
  assert.match(await response.text(), /repair/);
});
test('storage errors still produce an offline fallback', async () => {
  const app = worker('error'); app.offline(); app.caches.keys = async () => { throw Error('denied'); };
  const response = await vm.runInContext(`appShellResponse(new Request('${scope}'))`, app.context);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Подключитесь/);
});
test('quota failures preserve the previous release', async () => {
  const old = worker('old'); await old.install();
  const next = worker('new', old.storage);
  const open = next.caches.open;
  next.caches.open = async name => { const cache = await open(name); if (name.endsWith(':new')) cache.put = async () => { throw Error('QuotaExceededError'); }; return cache; };
  await assert.rejects(next.install()); old.offline();
  assert.match(await (await vm.runInContext(`appShellResponse(new Request('${scope}'))`, old.context)).text(), /old/);
});

test('collection keeps client-pinned releases and never races an installation', async () => {
  const first = worker('first'); await first.install();
  await vm.runInContext(`appShellResponse(new Request('${scope}'), 'old-window')`, first.context);
  const second = worker('second', first.storage); await second.install();
  const third = worker('third', first.storage); await third.install();
  await vm.runInContext(`appShellResponse(new Request('${scope}'), 'new-window')`, third.context);
  for (const entries of first.storage.values()) {
    const marker = entries.get(scope + '__offline_ready__');
    if (!marker) continue;
    const meta = await marker.json(); meta.installedAt -= 172800000;
    entries.set(scope + '__offline_ready__', new Response(JSON.stringify(meta)));
  }
  vm.runInContext(`self.clients.matchAll = async () => [{ id: 'old-window', url: '${scope}' }, { id: 'new-window', url: '${scope}' }]`, third.context);
  await vm.runInContext('collectOldBuilds()', third.context);
  assert.ok([...first.storage.keys()].some(name => name.endsWith(':first')));
  vm.runInContext(`self.clients.matchAll = async () => [{ id: 'new-window', url: '${scope}' }]; self.registration.installing = {}`, third.context);
  await vm.runInContext('collectOldBuilds()', third.context);
  assert.ok([...first.storage.keys()].some(name => name.endsWith(':first')));
  vm.runInContext('self.registration.installing = null', third.context);
  await vm.runInContext('collectOldBuilds()', third.context);
  assert.ok(![...first.storage.keys()].some(name => name.endsWith(':first')));
  assert.ok([...first.storage.keys()].some(name => name.endsWith(':second')));
});

test('legacy cleanup cannot delete new protocol caches', async () => {
  const app = worker('safe'); await app.install();
  for (const name of [...app.storage.keys()]) if (/^myflight_/i.test(name)) app.storage.delete(name);
  app.offline();
  assert.match(await (await vm.runInContext(`appShellResponse(new Request('${scope}'))`, app.context)).text(), /safe/);
});

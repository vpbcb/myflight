const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const build = JSON.parse(source.match(/const PRECACHE_BUILD = (\{.*\});/)[1]);
const scope = 'https://example.test/myflight/';
const storage = new Map([['myactivity_v.other', new Map([['https://example.test/myactivity/index.html', new Response('MyActivity intact')]])]]);
const key = request => typeof request === 'string' ? request : request.url;
const caches = {
    keys: async () => [...storage.keys()], delete: async name => storage.delete(name),
    open: async name => {
        if (!storage.has(name)) storage.set(name, new Map());
        const data = storage.get(name);
        return { match: async request => data.get(key(request))?.clone(), put: async (request, response) => data.set(key(request), response.clone()) };
    }
};
function worker(text, online, failedAsset) {
    let activated = false;
    const context = vm.createContext({ URL, Request, Response, Uint8Array, crypto: webcrypto, AbortController, setTimeout, clearTimeout, caches,
        self: { registration: { scope }, addEventListener() {}, skipWaiting: async () => { activated = true; } },
        fetch: async request => {
            const url = key(request);
            if (!online || url.endsWith(failedAsset || '__none__')) throw Error('offline');
            assert.ok(url.startsWith(scope));
            const asset = build.assets.find(asset => scope + asset.url === url);
            return new Response(fs.readFileSync(path.join(root, url.slice(scope.length))), { headers: { 'Content-Type': asset?.mime[0] || 'application/octet-stream' } });
        }
    });
    vm.runInContext(text, context);
    return { context, activated: () => activated };
}
(async () => {
    const installed = worker(source, true);
    await vm.runInContext('installAppShell()', installed.context);
    assert.ok(installed.activated());
    const cold = worker(source, false);
    for (const asset of build.assets) {
        const response = await vm.runInContext('matchAppCaches(' + JSON.stringify(scope + asset.url) + ')', cold.context);
        assert.ok(response, asset.url);
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), fs.readFileSync(path.join(root, asset.url)));
    }
    const interrupted = worker(source.replace(build.id, build.id + '-interrupted'), true, 'app.js');
    await assert.rejects(vm.runInContext('installAppShell()', interrupted.context));
    assert.equal(interrupted.activated(), false);
    const page = await vm.runInContext('appShellResponse(new Request(' + JSON.stringify(scope) + '))', cold.context);
    assert.equal(await page.text(), fs.readFileSync(path.join(root, 'index.html'), 'utf8'));
    assert.ok(storage.has('myactivity_v.other'));
    console.log('PASS: complete release, cold offline resources, interrupted update, foreign cache isolation');
})().catch(error => { console.error(error); process.exitCode = 1; });

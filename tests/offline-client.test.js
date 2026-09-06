const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../offline-client.js'), 'utf8');
const scope = 'https://example.test/myflight/';
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
class Worker extends EventTarget {
    scriptURL = scope + 'sw.js'; state = 'activated'; ready = true;
    constructor(id) { super(); this.id = id; this.messages = []; }
    postMessage(message, ports) {
        this.messages.push(message.type);
        if (message.type === 'ACTIVATE_UPDATE') { this.state = 'activated'; this.dispatchEvent(new Event('statechange')); }
        else if (ports?.[0]) ports[0].postMessage({ ready: this.ready, buildId: this.id });
    }
}
async function environment() {
    const current = new Worker('old'); let reloads = 0;
    const registration = { scope, active: current, waiting: null, installing: null, update: async () => registration };
    const serviceWorker = Object.assign(new EventTarget(), { controller: current, register: async () => registration });
    const window = new EventTarget();
    const document = Object.assign(new EventTarget(), { querySelector: () => ({ content: 'old' }), readyState: 'complete', visibilityState: 'visible' });
    const navigator = { onLine: true, serviceWorker };
    vm.runInNewContext(source, { URL, MessageChannel, Event, setTimeout, clearTimeout, navigator, document, window,
        location: { href: scope, reload: () => { reloads++; } } });
    await tick(); await tick();
    return { current, registration, serviceWorker, navigator, window, reloads: () => reloads };
}
test('background preparation and another window activation do not reload this page', async () => {
    const env = await environment();
    env.serviceWorker.dispatchEvent(new Event('controllerchange'));
    assert.equal(env.reloads(), 0);
});
test('explicit update activates a verified waiting worker and reloads once', async () => {
    const env = await environment(); const next = new Worker('new'); next.state = 'installed'; env.registration.waiting = next;
    assert.equal(await env.window.MyFlightUpdate.update(), 'updated');
    assert.ok(next.messages.includes('ACTIVATE_UPDATE'));
    assert.equal(env.reloads(), 1);
});
test('failed verification and network failure preserve the open page', async () => {
    const env = await environment(); const next = new Worker('new'); next.state = 'installed'; next.ready = false; env.registration.waiting = next;
    assert.equal(await env.window.MyFlightUpdate.update(), 'failed');
    assert.ok(!next.messages.includes('ACTIVATE_UPDATE'));
    assert.equal(env.reloads(), 0);
    env.navigator.onLine = false;
    assert.equal(await env.window.MyFlightUpdate.update(), 'offline');
});
test('an unsaved-data guard rejects explicit activation', async () => {
    const env = await environment();
    env.window.addEventListener('app-before-update', event => event.preventDefault());
    assert.equal(await env.window.MyFlightUpdate.update(), 'failed');
    assert.equal(env.reloads(), 0);
});

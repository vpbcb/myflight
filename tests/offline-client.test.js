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

// «Приложение обновлено»: окружение с localStorage и минимальным DOM
function fakeElement(tag) {
    const listeners = {};
    return {
        tagName: tag.toUpperCase(), children: [], attributes: {}, textContent: '', removed: false,
        setAttribute(name, value) { this.attributes[name] = value; },
        appendChild(child) { this.children.push(child); child.parent = this; return child; },
        addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
        click() { (listeners.click || []).forEach(fn => fn({ target: this })); },
        remove() { this.removed = true; if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this); }
    };
}
async function updatedEnvironment({ seenBuild, seenCache, storage = 'ok', build = 'new', appCache = 'myflight_v.260925-9', controlled = true } = {}) {
    const current = new Worker(build);
    const registration = { scope, active: current, waiting: null, installing: null, update: async () => registration };
    const serviceWorker = Object.assign(new EventTarget(), { controller: controlled ? current : null, register: async () => registration });
    // Ответ воркера на GET_APP_INSTALLATION — имя кэша релиза
    current.postMessage = function (message, ports) {
        this.messages.push(message.type);
        if (ports?.[0]) ports[0].postMessage(message.type === 'GET_APP_INSTALLATION' ? { appCache } : { ready: true, buildId: build });
    };
    const store = new Map([
        ...(seenBuild === undefined ? [] : [['myflight_seen_build', seenBuild]]),
        ...(seenCache === undefined ? [] : [['myflight_seen_app_cache', seenCache]])
    ]);
    const localStorage = storage === 'broken'
        ? { getItem() { throw Error('denied'); }, setItem() { throw Error('denied'); } }
        : { getItem: key => store.has(key) ? store.get(key) : null, setItem: (key, value) => store.set(key, String(value)) };
    const body = fakeElement('body'), head = fakeElement('head');
    const document = Object.assign(new EventTarget(), {
        querySelector: () => ({ content: build }), readyState: 'complete', visibilityState: 'visible', body, head,
        createElement: fakeElement,
        getElementById: id => [...body.children, ...head.children].find(el => el.id === id) || null
    });
    const window = new EventTarget();
    vm.runInNewContext(source, { URL, MessageChannel, Event, setTimeout, clearTimeout, localStorage, document, window,
        navigator: { onLine: true, serviceWorker }, location: { href: scope, reload: () => {} } });
    await tick(); await tick();
    window.dispatchEvent(new Event('load'));
    for (let i = 0; i < 5; i += 1) await tick();
    const modal = body.children.find(el => el.id === 'appUpdatedModal') || null;
    return { current, store, modal };
}
const modalText = modal => JSON.stringify(modal, (key, value) => key === 'parent' ? undefined : value);

test('first launch only remembers the cache name and shows no update modal', async () => {
    const env = await updatedEnvironment();
    assert.equal(env.modal, null);
    assert.equal(env.store.get('myflight_seen_app_cache'), 'myflight_v.260925-9');
    assert.equal(env.store.get('myflight_seen_build'), 'new');
});
test('same cache name shows no update modal even when the build changed', async () => {
    const env = await updatedEnvironment({ seenBuild: 'old', seenCache: 'myflight_v.260925-9' });
    assert.equal(env.modal, null);
});
test('a new cache name shows "Приложение обновлено" with the version once', async () => {
    const env = await updatedEnvironment({ seenBuild: 'new', seenCache: 'myflight_v.260925-8' });
    assert.ok(env.modal, 'modal shown');
    assert.match(modalText(env.modal), /Приложение обновлено/);
    assert.match(modalText(env.modal), /Версия v\.260925-9/);
    assert.equal(env.store.get('myflight_seen_app_cache'), 'myflight_v.260925-9');
    assert.ok(env.current.messages.includes('CLIENT_READY'));
});
test('an installed app without the cache key shows the modal when its build changed', async () => {
    const env = await updatedEnvironment({ seenBuild: 'old' });
    assert.ok(env.modal, 'modal shown');
    assert.equal(env.store.get('myflight_seen_app_cache'), 'myflight_v.260925-9');
});
test('no controller or no cache name remembers nothing and shows no modal', async () => {
    for (const options of [{ controlled: false }, { appCache: '' }]) {
        const env = await updatedEnvironment({ seenBuild: 'old', ...options });
        assert.equal(env.modal, null);
        assert.equal(env.store.has('myflight_seen_app_cache'), false);
        assert.equal(env.store.get('myflight_seen_build'), 'old');
    }
});
test('broken localStorage never blocks CLIENT_READY or throws', async () => {
    const env = await updatedEnvironment({ seenBuild: 'old', storage: 'broken' });
    assert.equal(env.modal, null);
    assert.ok(env.current.messages.includes('CLIENT_READY'));
});

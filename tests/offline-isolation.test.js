const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const resetSource = html.slice(html.indexOf('async function hardResetApp()'), html.indexOf('function openSettingsModal()'));

test('manual update preserves other PWAs and all user data on the shared origin', async () => {
    const removed = [], unregistered = [], deletedKeys = [];
    const caches = { keys: async () => ['myflight_v.1', 'myactivity_v.366', 'myactivity-shell:scope:build'], delete: async key => removed.push(key) };
    const context = vm.createContext({
        URL, console, document: { getElementById: () => null }, alert() {},
        localStorage: { removeItem: key => deletedKeys.push(key), clear: () => assert.fail('must preserve local data') },
        sessionStorage: { clear: () => assert.fail('must preserve session data') },
        navigator: { serviceWorker: { getRegistrations: async () => ['myflight', 'myactivity', 'myflight/nested'].map(app => ({
            scope: `https://example.test/${app}/`, unregister: async () => unregistered.push(app)
        })) } },
        caches, window: { MyFlightUpdate: { update: async () => 'failed' }, caches, location: { href: 'https://example.test/myflight/', pathname: '/myflight/' } }
    });
    vm.runInContext(resetSource, context);
    await vm.runInContext('hardResetApp()', context);
    assert.deepEqual(removed, []);
    assert.deepEqual(unregistered, []);
    assert.deepEqual(deletedKeys, []);
});

test('manual update offline leaves everything untouched', async () => {
    let warned = false;
    const context = vm.createContext({ document: { getElementById: () => null }, window: { MyFlightUpdate: { update: async () => 'offline' } }, alert: () => { warned = true; } });
    vm.runInContext(resetSource, context);
    await vm.runInContext('hardResetApp()', context);
    assert.equal(warned, true);
});

test('worker fallback ignores another application cache even for matching URL', async () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
    const consulted = [];
    const context = vm.createContext({
        URL, self: { registration: { scope: 'https://example.test/myflight/' }, addEventListener() {} },
        caches: {
            keys: async () => ['myflight_v.older', 'myactivity_v.366'],
            open: async name => ({ match: async () => { consulted.push(name); return name === 'myflight_v.older' ? 'own fallback' : undefined; } })
        }
    });
    vm.runInContext(source, context);
    assert.equal(await vm.runInContext("legacyMatch('https://example.test/myflight/index.html')", context), 'own fallback');
    assert.ok(!consulted.includes('myactivity_v.366'));
});

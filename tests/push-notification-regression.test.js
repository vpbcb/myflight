const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const serviceWorker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

function extractFunctionSource(source, name) {
    const marker = `function ${name}(`;
    const start = source.indexOf(marker);
    assert.notStrictEqual(start, -1, `${name}() must exist`);

    const openBrace = source.indexOf('{', start);
    assert.notStrictEqual(openBrace, -1, `${name}() must have a body`);

    let depth = 0;
    for (let i = openBrace; i < source.length; i++) {
        if (source[i] === '{') depth++;
        if (source[i] === '}') depth--;
        if (depth === 0) return source.slice(start, i + 1);
    }

    throw new Error(`${name}() body was not closed`);
}

function loadPushHelpers() {
    const sandbox = {};
    [
        'normalizePushField',
        'formatPushAircraft',
        'buildMyFlightPushBody'
    ].forEach(name => {
        vm.runInNewContext(extractFunctionSource(indexHtml, name), sandbox);
    });
    return sandbox;
}

function assertNoUnicodeNotificationStyle(body) {
    for (const char of body) {
        const code = char.codePointAt(0);
        assert.notStrictEqual(code, 0x0332, 'notification body must not use combining underline');
        assert.ok(
            code < 0x1D400 || code > 0x1D7FF,
            'notification body must not use mathematical Unicode bold symbols'
        );
    }
}

function test(name, fn) {
    try {
        const result = fn();
        if (result && typeof result.then === 'function') {
            result
                .then(() => console.log(`PASS ${name}`))
                .catch(error => {
                    console.error(`FAIL ${name}`);
                    console.error(error.message);
                    process.exitCode = 1;
                });
            return;
        }
        console.log(`PASS ${name}`);
    } catch (error) {
        console.error(`FAIL ${name}`);
        console.error(error.message);
        process.exitCode = 1;
    }
}

function loadServiceWorkerHandlers(clientsApi) {
    const handlers = {};
    const sandbox = {
        AbortController,
        URL,
        caches: {
            open: async () => ({ match: async () => null, put: async () => undefined }),
            match: async () => null,
            keys: async () => [],
            delete: async () => undefined
        },
        clients: clientsApi,
        clearTimeout,
        console: {
            ...console,
            warn: () => undefined
        },
        fetch: async () => null,
        Request: class {
            constructor(url) {
                this.url = new URL(url, 'https://example.test/myflight/').href;
            }
        },
        self: {
            clients: { claim: async () => undefined },
            location: { origin: 'https://example.test' },
            registration: { scope: 'https://example.test/myflight/' },
            skipWaiting: async () => undefined,
            addEventListener(type, handler) {
                handlers[type] = handler;
            }
        },
        setTimeout
    };

    vm.runInNewContext(serviceWorker, sandbox);
    return handlers;
}

async function dispatchNotificationClick(handler, data = { url: './' }) {
    let waitUntilPromise = null;
    let closed = false;

    handler({
        notification: {
            data,
            close() {
                closed = true;
            }
        },
        waitUntil(promise) {
            waitUntilPromise = promise;
        }
    });

    assert.ok(waitUntilPromise, 'notificationclick must call event.waitUntil');
    await waitUntilPromise;
    assert.strictEqual(closed, true, 'notification must be closed after tap');
}

test('push notification uses MyFlight title and plain strict three-line body', () => {
    const { buildMyFlightPushBody } = loadPushHelpers();
    const body = buildMyFlightPushBody({
        flightNumber: '1234',
        aircraft: { type: 'A320', regFull: 'RA-73170' },
        quickNotes: { fob: '11600', stand: '130', crew: '100680' },
        notes: 'Call dispatch before boarding'
    });

    const lines = body.split('\n');
    assert.match(indexHtml, /const\s+MYFLIGHT_PUSH_TITLE\s*=\s*'MyFlight'\s*;/);
    assert.strictEqual(lines.length, 3, 'notification body must have exactly three lines');
    assert.strictEqual(body.trim(), body, 'notification body must not have leading or trailing blank lines');
    assert.doesNotMatch(lines[1], /\|/, 'FOB/St./Crew line must not use vertical separators');
    assertNoUnicodeNotificationStyle(body);
    assert.strictEqual(body, [
        'SU1234 RA73170',
        '*FOB:11600 *St.130 *Crew:100680 *',
        'Notes: Call dispatch before boarding'
    ].join('\n'));
});

test('push notification strict three-line body keeps empty placeholders plain', () => {
    const { buildMyFlightPushBody } = loadPushHelpers();
    const body = buildMyFlightPushBody({
        flightNumber: '',
        aircraft: null,
        aircraftQuery: '',
        quickNotes: {},
        notes: ''
    });

    assert.strictEqual(body.split('\n').length, 3, 'notification body must have exactly three lines');
    assert.strictEqual(body.trim(), body, 'notification body must not have leading or trailing blank lines');
    assertNoUnicodeNotificationStyle(body);
    assert.strictEqual(body, [
        '- -',
        '*FOB:- *St.- *Crew:- *',
        'Notes: -'
    ].join('\n'));
});

test('push notification options are silent and keep tap navigation data', () => {
    const optionsBody = extractFunctionSource(indexHtml, 'buildMyFlightPushOptions');

    assert.match(optionsBody, /silent:\s*true/);
    assert.match(optionsBody, /renotify:\s*false/);
    assert.match(optionsBody, /requireInteraction:\s*true/);
    assert.match(optionsBody, /tag:\s*MYFLIGHT_PUSH_TAG/);
    assert.match(optionsBody, /data:\s*\{\s*url:\s*'\.\/'\s*\}/);
    assert.doesNotMatch(optionsBody, /vibrate\s*:/);
});

test('Settings modal owns the Push toggle', () => {
    const settingsPosition = indexHtml.indexOf('id="settingsModal"');
    const pushPosition = indexHtml.indexOf('id="pushToggleBtn"');
    const mailPosition = indexHtml.indexOf('id="btnMail"');
    assert.ok(settingsPosition >= 0 && pushPosition > settingsPosition);
    assert.ok(mailPosition > pushPosition);
    assert.match(indexHtml, /id="pushToggleBtn"[^>]*>[\s\S]*?<span id="pushText">Push Off<\/span>[\s\S]*?<\/button>/);
    assert.match(indexHtml, /\.push-toggle-card\.is-on\s*\{[\s\S]*background:\s*#16a34a/);
    assert.ok(pushPosition > indexHtml.indexOf('<span class="title">MyPath</span>'));
});

test('Push toggle is activated by an ordinary click', () => {
    const bindBody = extractFunctionSource(indexHtml, 'bindMyFlightPushControls');
    assert.match(bindBody, /addEventListener\(['"]click['"],\s*toggleMyFlightPush\s*\)/);
    assert.doesNotMatch(bindBody, /touchstart|mousedown|beginMyFlightPushPress|triggerMyFlightPushLongPress/);
    assert.doesNotMatch(indexHtml, /MYFLIGHT_PUSH_LONG_PRESS_MS|myFlightPushLongPressTimer|myFlightPushLongPressTriggered/);
});

test('service worker focuses or opens MyFlight when notification is tapped', () => {
    assert.match(serviceWorker, /notificationclick/);
    assert.match(serviceWorker, /clients\.matchAll/);
    assert.match(serviceWorker, /\.focus\(\)/);
    assert.match(serviceWorker, /clients\.openWindow/);
});

test('service worker navigates and focuses an existing MyFlight client on notification tap', async () => {
    const calls = [];
    const appClient = {
        url: 'https://example.test/myflight/myfuel.html',
        navigate: async url => {
            calls.push(['navigate', url]);
            return appClient;
        },
        focus: async () => {
            calls.push(['focus']);
            return appClient;
        }
    };
    const handlers = loadServiceWorkerHandlers({
        matchAll: async () => [appClient],
        openWindow: async url => {
            calls.push(['openWindow', url]);
            return null;
        }
    });

    await dispatchNotificationClick(handlers.notificationclick);

    assert.deepStrictEqual(calls, [
        ['navigate', 'https://example.test/myflight/'],
        ['focus']
    ]);
});

test('service worker opens MyFlight when an existing client cannot be focused', async () => {
    const calls = [];
    const appClient = {
        url: 'https://example.test/myflight/',
        navigate: async url => {
            calls.push(['navigate', url]);
            return appClient;
        },
        focus: async () => {
            calls.push(['focus']);
            throw new Error('focus blocked');
        }
    };
    const handlers = loadServiceWorkerHandlers({
        matchAll: async () => [appClient],
        openWindow: async url => {
            calls.push(['openWindow', url]);
            return null;
        }
    });

    await dispatchNotificationClick(handlers.notificationclick);

    assert.deepStrictEqual(calls, [
        ['navigate', 'https://example.test/myflight/'],
        ['focus'],
        ['openWindow', 'https://example.test/myflight/']
    ]);
});

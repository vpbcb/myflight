const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const PAGES = ['index.html', 'myfuel.html', 'mywind.html', 'mypath.html', 'mynpa.html', 'myshift.html'];

function lockScript(page) {
    const html = fs.readFileSync(path.join(root, page), 'utf8');
    const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
    const script = scripts.find(s => s.includes('window.MyFlightViewportLock = {'));
    assert.ok(script, `${page}: блок MyFlightViewportLock не найден`);
    return script;
}

// Android PWA: окно 400x800, клавиатура уменьшает innerHeight/visualViewport до 500.
function loadLock(page) {
    const timers = new Map();
    let nextTimer = 1;
    const docListeners = {};
    const htmlEl = {
        style: { setProperty(name, value) { this[name] = value; } },
        classList: { toggle() {}, contains: () => false },
        clientHeight: 800,
        clientWidth: 400,
        scrollTop: 0
    };
    const body = { style: {}, scrollTop: 0 };
    const input = { tagName: 'INPUT' };
    const env = { scrollCalls: 0 };
    const window = {
        navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 14)', platform: 'Linux armv8l', maxTouchPoints: 5 },
        matchMedia: () => ({ matches: true, addEventListener() {} }),
        innerHeight: 800,
        innerWidth: 400,
        outerWidth: 400,
        scrollY: 0,
        scrollTo() { env.scrollCalls += 1; },
        addEventListener() {},
        visualViewport: { height: 800, width: 400, addEventListener() {} }
    };
    const document = {
        documentElement: htmlEl,
        body,
        activeElement: null,
        querySelectorAll: () => [],
        addEventListener(type, fn) { (docListeners[type] = docListeners[type] || []).push(fn); }
    };
    const context = {
        window,
        document,
        navigator: window.navigator,
        setTimeout(fn, delay) { const id = nextTimer++; timers.set(id, { fn, delay }); return id; },
        clearTimeout(id) { timers.delete(id); },
        requestAnimationFrame(fn) { const id = nextTimer++; timers.set(id, { fn, delay: 0 }); return id; },
        cancelAnimationFrame(id) { timers.delete(id); }
    };
    vm.createContext(context);
    vm.runInContext(lockScript(page), context);

    return {
        lock: window.MyFlightViewportLock,
        timers,
        env,
        htmlEl,
        runTimers() {
            for (const [id, timer] of [...timers]) {
                timers.delete(id);
                timer.fn();
            }
        },
        focusInput() {
            document.activeElement = input;
            (docListeners.focusin || []).forEach(fn => fn({ target: input }));
        },
        openKeyboard() {
            window.innerHeight = 500;
            window.visualViewport.height = 500;
        },
        window
    };
}

for (const page of PAGES) {
    test(`${page}: повторный relock не множит таймеры`, () => {
        const t = loadLock(page);
        const perSeries = t.timers.size;
        assert.ok(perSeries > 0);
        t.lock.relock();
        t.lock.relock();
        assert.equal(t.timers.size, perSeries);
    });

    test(`${page}: фокус в поле обрывает серию relock`, () => {
        const t = loadLock(page);
        assert.ok(t.timers.size > 0);
        t.focusInput();
        t.openKeyboard();
        const height = t.htmlEl.style['--app-height'];
        const scrolls = t.env.scrollCalls;
        t.runTimers();
        assert.equal(t.htmlEl.style['--app-height'], height);
        assert.equal(t.env.scrollCalls, scrolls);
    });

    test(`${page}: принудительная фиксация не урезает высоту при открытой клавиатуре`, () => {
        const t = loadLock(page);
        t.runTimers();
        assert.equal(t.lock.getHeight(), 800);
        t.focusInput();
        t.openKeyboard();
        t.lock.lock({ forceHeight: true });
        t.lock.relock();
        t.runTimers();
        assert.equal(t.lock.getHeight(), 800);
        assert.equal(t.htmlEl.style['--app-height'], '800px');
    });

    test(`${page}: scrollTo только когда страница реально сдвинута`, () => {
        const t = loadLock(page);
        t.runTimers();
        t.focusInput();
        t.runTimers();
        assert.equal(t.env.scrollCalls, 0);
        t.window.scrollY = 120;
        t.lock.lock();
        assert.ok(t.env.scrollCalls > 0);
    });
}

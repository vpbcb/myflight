const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const pageNames = ['index.html', 'myfuel.html', 'myshift.html', 'mynpa.html', 'mywind.html', 'mypath.html'];
const pages = Object.fromEntries(pageNames.map(name => [name, fs.readFileSync(path.join(root, name), 'utf8')]));

function bottomControls(pageName) {
    const html = pages[pageName];
    const start = html.indexOf('<div class="bottom-controls');
    assert.notEqual(start, -1, `${pageName} must contain the shared bottom-controls wrapper`);
    const end = html.indexOf('</div>', start);
    assert.ok(end > start, `${pageName} bottom-controls wrapper must close`);
    return html.slice(start, end);
}

test('all active pages load the shared bottom navigation stylesheet', () => {
    for (const [name, html] of Object.entries(pages)) {
        assert.match(html, /<link rel="stylesheet" href="\.\/bottom-navigation\.css">/, name);
    }

    assert.ok(fs.existsSync(path.join(root, 'bottom-navigation.css')), 'bottom-navigation.css must exist');
});

test('bottom actions use fixed three-column slots on every page', () => {
    const expectedSlots = {
        'index.html': ['left', 'center'],
        'myfuel.html': ['left', 'right'],
        'myshift.html': ['left', 'right'],
        'mynpa.html': ['left', 'center', 'right'],
        'mywind.html': ['left', 'center', 'right'],
        'mypath.html': ['left', 'center', 'right']
    };

    for (const [name, slots] of Object.entries(expectedSlots)) {
        const controls = bottomControls(name);
        for (const slot of slots) {
            assert.match(
                controls,
                new RegExp(`class="[^"]*bottom-action[^"]*bottom-action--${slot}[^"]*"`),
                `${name} must place its ${slot} action in the shared grid`
            );
        }
        assert.equal((controls.match(/\bbottom-action-label\b/g) || []).length, slots.length, `${name} labels`);
    }
});

test('shared navigation copies the home action dimensions, typography and color', () => {
    const cssPath = path.join(root, 'bottom-navigation.css');
    assert.ok(fs.existsSync(cssPath), 'bottom-navigation.css must exist');
    const css = fs.readFileSync(cssPath, 'utf8');

    assert.match(css, /grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);/);
    assert.match(css, /padding:\s*0 16px var\(--bottom-nav-padding-bottom\);/);
    assert.match(css, /width:\s*min\(90px,\s*100%\);/);
    assert.match(css, /height:\s*var\(--bottom-nav-button-height\);/);
    assert.match(css, /color:\s*var\(--bottom-nav-color,\s*var\(--text-main,\s*var\(--text,\s*var\(--ink,\s*#0b1026\)\)\)\);/);
    assert.match(css, /font-size:\s*0\.65rem;/);
    assert.match(css, /font-weight:\s*800;/);
    assert.match(css, /letter-spacing:\s*1px;/);
    assert.match(css, /font-family:\s*'Inter',\s*-apple-system,\s*BlinkMacSystemFont,\s*"Segoe UI",\s*Roboto,\s*sans-serif\s*!important;/);
    assert.match(css, /margin-left:\s*0\s*!important;/);
    assert.match(css, /:root\s*\{\s*--bottom-nav-color:\s*#1e293b;/);
    assert.match(css, /html\.dark-theme\s*\{\s*--bottom-nav-color:\s*#cbd5e1;/);
    assert.match(css, /left:\s*auto\s*!important;/);
    assert.match(css, /right:\s*auto\s*!important;/);
    assert.match(css, /@media\s*\(hover:\s*hover\)\s*and\s*\(pointer:\s*fine\)\s*and\s*\(max-height:\s*680px\)\s*\{[\s\S]*?--bottom-nav-padding-bottom:\s*max\(4px,\s*calc\(var\(--safe-bottom\)\s*\+\s*4px\)\);/);
    assert.match(css, /@media\s*\(max-height:\s*600px\)\s*\{[\s\S]*?--bottom-nav-padding-bottom:\s*max\(2px,\s*calc\(var\(--safe-bottom\)\s*\+\s*2px\)\);/);
});

test('light subpages explicitly override a dark system color scheme', () => {
    for (const name of ['myshift.html', 'mynpa.html', 'mywind.html']) {
        assert.match(
            pages[name],
            /document\.documentElement\.classList\.toggle\('light-theme',\s*!isDark\);/,
            `${name} must mark its explicit light theme for the shared navigation`
        );
    }
});

test('bordered calculators compensate their one-pixel inset', () => {
    assert.match(bottomControls('mywind.html'), /bottom-controls--bordered/);
    assert.match(bottomControls('mypath.html'), /bottom-controls--bordered/);

    const css = fs.readFileSync(path.join(root, 'bottom-navigation.css'), 'utf8');
    assert.match(css, /\.bottom-controls\.bottom-controls--bordered\s*\{\s*bottom:\s*-1px;/);
});

test('service worker includes the shared stylesheet with the current cache version', () => {
    const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
    assert.match(sw, /const CACHE_NAME = 'myflight_v\.260904-9';/);
    assert.match(sw, /'\.\/bottom-navigation\.css'/);
});

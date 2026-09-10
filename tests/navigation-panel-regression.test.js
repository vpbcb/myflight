const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

test('five opted-in pages use a single shared navigation panel', () => {
    for (const name of ['index.html', 'myshift.html', 'mynpa.html', 'mywind.html', 'mypath.html']) {
        const html = read(name);
        assert.match(html, /class="bottom-controls[^"]*\bbottom-controls--panel\b/);
        assert.doesNotMatch(html, /\.(?:home-nav|myshift-nav)\b/);
        assert.doesNotMatch(html, /\.bottom-controls\.bottom-controls--panel\s*\{/);
    }
    for (const name of ['myfuel.html']) {
        assert.doesNotMatch(read(name), /class="[^"]*\bbottom-controls--panel\b/);
    }
});

test('shared panel owns colors, zones, typography and flow positioning', () => {
    const css = read('bottom-navigation.css');
    assert.match(css, /\.bottom-controls\.bottom-controls--panel\s*\{/);
    assert.match(css, /--nav-panel-bg:\s*#ebf3fa/);
    assert.match(css, /--nav-panel-ink:\s*#294e73/);
    assert.match(css, /html\.dark-theme[^{}]*bottom-controls--panel\s*\{[^}]*--nav-panel-bg:\s*#1e2f41/);
    assert.match(css, /\.bottom-controls\.bottom-controls--panel\.bottom-controls--flow\s*\{\s*position:\s*relative/);
    assert.match(css, /\.bottom-controls\.bottom-controls--panel::before\s*\{\s*left:calc\(100% \/ 3\)/);
    assert.match(css, /\.bottom-controls\.bottom-controls--panel::after\s*\{\s*left:calc\(200% \/ 3\)/);
    assert.match(css, /\.bottom-controls\.bottom-controls--panel > \.bottom-action > \.bottom-action-label\s*\{[^}]*font-weight:600/);
});

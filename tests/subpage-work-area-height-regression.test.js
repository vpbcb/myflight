const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

const navCss = read('bottom-navigation.css');
const myNpaHtml = read('mynpa.html');
const myShiftHtml = read('myshift.html');
const myWindHtml = read('mywind.html');
const myPathHtml = read('mypath.html');

test('shared navigation exposes one adaptive reserved height', () => {
    assert.match(navCss, /--bottom-nav-button-height:\s*32px;/);
    assert.match(navCss, /--bottom-nav-padding-bottom:\s*max\(12px,\s*calc\(var\(--safe-bottom\)\s*\+\s*8px\)\);/);
    assert.match(navCss, /--bottom-nav-reserved-height:\s*calc\(var\(--bottom-nav-button-height\)\s*\+\s*var\(--bottom-nav-padding-bottom\)\);/);
    assert.match(navCss, /\.bottom-controls\s*\{[^}]*padding:\s*0 16px var\(--bottom-nav-padding-bottom\);/);
    assert.match(navCss, /\.bottom-controls\s*>\s*\.bottom-action\s*\{[^}]*height:\s*var\(--bottom-nav-button-height\);/);
    assert.match(navCss, /@media\s*\(hover:\s*hover\)\s*and\s*\(pointer:\s*fine\)\s*and\s*\(max-height:\s*680px\)\s*\{[^}]*--bottom-nav-padding-bottom:\s*max\(4px,\s*calc\(var\(--safe-bottom\)\s*\+\s*4px\)\);/);
    assert.match(navCss, /@media\s*\(max-height:\s*600px\)\s*\{[^}]*--bottom-nav-padding-bottom:\s*max\(2px,\s*calc\(var\(--safe-bottom\)\s*\+\s*2px\)\);/);
});

test('four calculator work areas reserve exactly the shared navigation height', () => {
    assert.match(myNpaHtml, /\.precision-scroll-container\s*\{[^}]*margin:\s*5px 0 var\(--bottom-nav-reserved-height,\s*0px\) 0;/);
    assert.match(myNpaHtml, /\.precision-scroll-container\s*\{[^}]*padding:\s*8px 10px 6px;/);
    assert.match(myNpaHtml, /\.npa-tabs-card\s*\{[^}]*margin-bottom:\s*0;/);
    assert.match(myShiftHtml, /\.app-container\s*\{[^}]*padding-bottom:\s*var\(--bottom-nav-reserved-height,\s*max\(44px,\s*calc\(var\(--safe-bottom\)\s*\+\s*40px\)\)\);/);
});

test('cached shared CSS cannot remove calculator side padding', () => {
    for (const html of [myWindHtml, myPathHtml]) {
        assert.match(html, /\.calculator\s*\{[^}]*padding-top:\s*max\(2px,\s*calc\(var\(--safe-top\)\s*\+\s*2px\)\);/);
        assert.match(html, /\.calculator\s*\{[^}]*padding-right:\s*20px;/);
        assert.match(html, /\.calculator\s*\{[^}]*padding-bottom:\s*var\(--bottom-nav-reserved-height,\s*max\(44px,\s*calc\(var\(--safe-bottom\)\s*\+\s*40px\)\)\);/);
        assert.match(html, /\.calculator\s*\{[^}]*padding-left:\s*20px;/);
        assert.doesNotMatch(html, /padding:\s*[^;]*var\(--bottom-nav-reserved-height/);
    }
});

test('MyNPA measures its working bottom from the complete navigation bar', () => {
    const start = myNpaHtml.indexOf('function getNpaLayoutVisibleBottom()');
    const end = myNpaHtml.indexOf('\n    function ', start + 1);
    const body = myNpaHtml.slice(start, end);

    assert.notEqual(start, -1);
    assert.match(body, /document\.querySelector\('\.bottom-controls'\)/);
    assert.match(body, /controlsRect\.top\s*-\s*6/);
    assert.doesNotMatch(body, /refreshBtn|menuBtn|buttonTops/);
});

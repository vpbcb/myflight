const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const myNpaHtml = fs.readFileSync(path.resolve(__dirname, '..', 'mynpa.html'), 'utf8');

test('Racetrack field labels use weight 600 without changing section headings', () => {
    assert.match(myNpaHtml, /#npaBlock2 \.cell-label,\s*#npaBlock2 \.racetrack-offset-track\s*\{[^}]*font-weight:\s*600\s*;/);
    assert.match(myNpaHtml, /<div class="npa-subsection-title">Racetrack entry<\/div>/);
    assert.match(myNpaHtml, /<div class="npa-subsection-title">Downwind leg<\/div>/);
    assert.match(myNpaHtml, /<span class="cell-label">Racetrack NAV aid\s*<br>\s*<span style="text-transform: lowercase;">or<\/span> manual dist from NDB to THR:<\/span>/);
    assert.doesNotMatch(myNpaHtml, /Racetrack radio aid shift/);
});

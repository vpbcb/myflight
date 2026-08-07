const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const myPathHtml = fs.readFileSync(path.resolve(__dirname, '..', 'mypath.html'), 'utf8');

test('MyPath data grid leaves no extra gap above bottom navigation', () => {
    assert.match(myPathHtml, /\.main-layout\s*\{[^}]*margin-bottom:\s*0\s*;/);
    assert.match(myPathHtml, /\.table\s*\{[^}]*flex:\s*1\s*;/);
});

test('MyPath always reserves the full warning height in normal flow', () => {
    assert.match(myPathHtml, /\.shift-alert-plate\s*\{[^}]*display:\s*block\s*;[^}]*position:\s*static\s*;[^}]*visibility:\s*hidden\s*;[^}]*flex-shrink:\s*0\s*;/);
    assert.match(myPathHtml, /\.shift-alert-plate\.is-visible\s*\{[^}]*visibility:\s*visible\s*;/);
});

test('MyPath toggles warning visibility without changing its layout space', () => {
    assert.match(myPathHtml, /shiftAlert\.classList\.toggle\('is-visible',\s*isPathShiftActive\)\s*;/);
    assert.match(myPathHtml, /shiftAlert\.setAttribute\('aria-hidden',\s*isPathShiftActive\s*\?\s*'false'\s*:\s*'true'\)\s*;/);
    assert.doesNotMatch(myPathHtml, /shiftAlert\.style\.display\s*=/);
});

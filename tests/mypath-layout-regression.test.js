const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const myPathHtml = fs.readFileSync(path.resolve(__dirname, '..', 'mypath.html'), 'utf8');

test('MyPath data grid leaves no extra gap above bottom navigation', () => {
    assert.match(myPathHtml, /\.main-layout\s*\{[^}]*margin-bottom:\s*0\s*;/);
    assert.match(myPathHtml, /\.table\s*\{[^}]*flex:\s*1\s*;/);
});

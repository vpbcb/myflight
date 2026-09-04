const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const indexHtml = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

test('Notes keypad uses the same one-hand position as MyPath on phones', () => {
    assert.match(indexHtml, /\.notes-keypad-content\s*\{[^}]*margin-bottom:\s*-15vh\s*;[^}]*margin-left:\s*30px\s*;/);
    assert.match(indexHtml, /@media\s*\(min-device-width:\s*768px\)\s*\{\s*\.notes-keypad-content\s*\{[^}]*margin-bottom:\s*0\s*!important\s*;[^}]*margin-left:\s*0\s*!important\s*;/);
});

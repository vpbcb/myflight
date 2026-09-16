const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const myWindHtml = fs.readFileSync(path.resolve(__dirname, '..', 'mywind.html'), 'utf8');

test('narrow/contaminated button stays on one line and scales with its container', () => {
    assert.match(myWindHtml, /\.tabs-container\s*\{[^}]*container-type:\s*inline-size;/);
    assert.match(
        myWindHtml,
        /#narrowContBtn\s*\{[^}]*font-size:\s*min\(0\.75rem,\s*3cqi\);[^}]*white-space:\s*nowrap;/s
    );
    assert.match(myWindHtml, /#narrowContBtn em\s*\{[^}]*font-size:\s*0\.867em;/s);
});

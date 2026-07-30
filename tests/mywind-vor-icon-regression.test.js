const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const myWindHtml = fs.readFileSync(path.resolve(__dirname, '..', 'mywind.html'), 'utf8');

test('MyWind uses a VOR CDI instrument icon for MyNPA navigation', () => {
    const configMatch = myWindHtml.match(/mynpa:\s*\{[\s\S]*?icon:\s*'([^']+)'/);

    assert.ok(configMatch, 'MyNPA navigation config should exist');
    assert.match(configMatch[1], /<circle cx="12" cy="12" r="9"><\/circle>/);
    assert.match(configMatch[1], /<path d="M12 5v14"><\/path>/);
    assert.match(configMatch[1], /<path d="m9\.5 7 2\.5-3 2\.5 3"><\/path>/);
});

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const indexHtml = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

test('short desktop windows compact only the space below the search card', () => {
    const marker = '/* Short desktop viewport fit */';
    const start = indexHtml.indexOf(marker);
    assert.notEqual(start, -1, 'short desktop viewport rules must exist');

    const end = indexHtml.indexOf('</style>', start);
    const compactRules = indexHtml.slice(start, end);

    assert.match(compactRules, /@media\s*\(hover:\s*hover\)\s*and\s*\(pointer:\s*fine\)\s*and\s*\(max-height:\s*680px\)/);
    assert.match(compactRules, /\.flight-search-card\s*\{\s*margin-bottom:\s*0;/);
    assert.match(compactRules, /\.container\s*\{\s*gap:\s*clamp\(4px,\s*1vh,\s*8px\);/);
    assert.match(compactRules, /\.project-card\s*\{[\s\S]*height:\s*clamp\(64px,\s*14vh,\s*94px\);[\s\S]*aspect-ratio:\s*auto;/);
    assert.match(compactRules, /\.bottom-controls\s*\{[\s\S]*margin-top:\s*clamp\(0px,\s*1vh,\s*4px\);[\s\S]*padding-bottom:\s*max\(4px,\s*calc\(var\(--safe-bottom\)\s*\+\s*4px\)\);/);
    assert.match(compactRules, /@media\s*\(max-height:\s*600px\)/);
    assert.match(compactRules, /height:\s*clamp\(48px,\s*calc\(50vh\s*-\s*216px\),\s*84px\);/);
    assert.match(compactRules, /font-size:\s*clamp\(20px,\s*4\.6vh,\s*28px\);/);

    assert.doesNotMatch(compactRules, /\.header|\.main-logo|\.search-wrapper|\.notes-field/);
});

test('home actions retain flexible space above the six tiles', () => {
    assert.match(indexHtml, /\.home-actions\s*\{[\s\S]*?margin-top:\s*auto;/);
});

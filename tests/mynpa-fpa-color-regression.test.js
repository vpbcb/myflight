const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'mynpa.html'), 'utf8');

function selectorColor(selector) {
    const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = source.match(new RegExp(`${escapedSelector}\\s*\\{[^}]*color:\\s*(#[0-9a-f]{6})`, 'i'));
    return match?.[1]?.toLowerCase();
}

test('hot FPA uses the positive OAT red', () => {
    const oatPositive = selectorColor('#tempC.temp-positive');
    const fpaHot = selectorColor('.fcu-info-stacked .fcu-main.fcu-fpa-hot');

    assert.equal(oatPositive, '#ef4444');
    assert.equal(fpaHot, oatPositive);
});

test('cold FPA keeps its blue color', () => {
    assert.equal(selectorColor('.fcu-info-stacked .fcu-main.fcu-fpa-cold'), '#0273ad');
});

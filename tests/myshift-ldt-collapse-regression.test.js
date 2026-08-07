const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const myShiftHtml = fs.readFileSync(path.join(root, 'myshift.html'), 'utf8');

test('LDT card starts collapsed under the calculation heading', () => {
    assert.match(myShiftHtml, /id="afterResultsCard"[^>]*aria-expanded="false"/);
    assert.match(myShiftHtml, /class="ldtCardHeader"[^>]*>\s*Расчет LDT/);
    assert.match(myShiftHtml, /id="ldtCardContent" class="ldtFoldContent"/);
    assert.match(myShiftHtml, /#afterResultsCard:not\(\.open\) \.ldtFoldContent\s*\{[^}]*max-height:\s*0/);
});

test('LDT card toggles except when its time input is clicked', () => {
    assert.match(myShiftHtml, /function toggleLdtCard\(event\)/);
    assert.match(myShiftHtml, /event\.target\.closest\(['"]#flightTime['"]\)/);
    assert.match(myShiftHtml, /classList\.toggle\(['"]open['"]\)/);
    assert.match(myShiftHtml, /setAttribute\(['"]aria-expanded['"],\s*String\(isOpen\)\)/);
});

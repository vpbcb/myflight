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

test('open LDT keeps the outer width stable and scrolls only its content', () => {
    assert.match(myShiftHtml, /\.scrollArea\.ldt-scroll-contained\s*\{[^}]*overflow-y:\s*hidden/);
    assert.match(myShiftHtml, /#afterResultsCard\.open \.ldtFoldContent\s*\{[^}]*min-height:\s*0[^}]*overflow-x:\s*hidden[^}]*overflow-y:\s*auto[^}]*scrollbar-gutter:\s*stable/);
    assert.match(myShiftHtml, /function updateLdtScrollLayout\(\)[\s\S]{0,600}scrollArea\.getBoundingClientRect\(\)[\s\S]{0,600}card\.style\.setProperty\('--ldt-card-max-height'/);
    assert.match(myShiftHtml, /scrollArea\?\.classList\.toggle\('ldt-scroll-contained', isOpen\)/);
    assert.match(myShiftHtml, /if\(isOpen\) updateLdtScrollLayout\(\);[\s\S]{0,100}removeProperty\('--ldt-card-max-height'\)/);
    assert.match(myShiftHtml, /window\.addEventListener\('resize', updateLdtScrollLayout\)/);
    assert.match(myShiftHtml, /window\.addEventListener\('orientationchange', updateLdtScrollLayout\)/);
});

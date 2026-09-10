const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'myshift.html'), 'utf8');

const resultIds = {
    MSK: ['outReportMSK', 'outEngMSK', 'outEndMSK', 'outLdtMSK'],
    UTC: ['outReportUTC', 'outEngUTC', 'outEndUTC', 'outLdtUTC'],
    LOCAL: ['outReportLOC', 'outEngLOC', 'outEndLOC', 'outLdtLOC']
};

test('four result groups expose synchronized accessible time-zone columns', () => {
    for (const [zone, ids] of Object.entries(resultIds)) {
        for (const id of ids) {
            assert.match(
                html,
                new RegExp(
                    `class="mtCol resultTimeColumn"[^>]*data-time-zone="${zone}"` +
                    `[^>]*role="button"[^>]*tabindex="0"[^>]*aria-pressed="false"` +
                    `[\\s\\S]{0,180}id="${id}"`
                ),
                `${id} must be an accessible ${zone} column`
            );
        }
    }
});

test('one delegated interaction toggles or switches the selected zone', () => {
    assert.match(
        html,
        /const RESULT_TIME_ZONES = Object\.freeze\(\["MSK", "UTC", "LOCAL"\]\)/
    );
    assert.match(html, /let selectedResultTimeZone = null/);
    assert.match(
        html,
        /function toggleResultTimeZone\(zone\)[\s\S]{0,360}selectedResultTimeZone === normalizedZone\s*\?\s*null\s*:\s*normalizedZone[\s\S]{0,180}renderResultTimeZoneFocus\(\)[\s\S]{0,180}saveState\(\)/
    );
    assert.match(
        html,
        /rightCol\.addEventListener\("click", handleResultTimeZoneClick\)/
    );
    assert.match(
        html,
        /rightCol\.addEventListener\("keydown", handleResultTimeZoneKeydown\)/
    );
    assert.match(
        html,
        /event\.key !== "Enter" && event\.key !== " "/
    );
});

test('rendering keeps the selected zone prominent and the other zones visible but dimmed', () => {
    assert.match(
        html,
        /function renderResultTimeZoneFocus\(\)[\s\S]{0,700}time-column-selected[\s\S]{0,300}time-column-dimmed[\s\S]{0,300}aria-pressed/
    );
    assert.match(
        html,
        /\.resultTimeColumn\.time-column-dimmed\s*\{[^}]*opacity:\s*0\.[23]/
    );
    assert.match(html, /--resultTimeSelected:\s*rgba\(25,118,210,0\.55\)/);
    assert.match(html, /html\.dark-theme\s*\{[\s\S]{0,420}--resultTimeSelected:\s*rgba\(2,115,173,0\.55\)/);
    assert.match(
        html,
        /\.resultTimeColumn\s*\{[^}]*border-radius:\s*0/
    );
    assert.match(
        html,
        /\.resultTimeColumn\.time-column-selected\s*\{[^}]*background:\s*var\(--resultTimeSelected\)/
    );
    assert.match(
        html,
        /\.resultTimeColumn:focus-visible\s*\{[^}]*outline:\s*none/
    );
});

test('selected result zone persists, restores safely, and resets with calculation data', () => {
    assert.match(
        html,
        /const state = \{[\s\S]{0,500}selectedResultTimeZone/
    );
    assert.match(
        html,
        /function loadState\(\)[\s\S]{0,700}selectedResultTimeZone\s*=\s*normalizeResultTimeZone\(s\.selectedResultTimeZone\)/
    );
    assert.match(
        html,
        /function resetState\(\)[\s\S]{0,900}selectedResultTimeZone\s*=\s*null[\s\S]{0,180}renderResultTimeZoneFocus\(\)/
    );
});

test('LDT time-column interaction does not collapse the LDT card', () => {
    assert.match(
        html,
        /function toggleLdtCard\(event\)[\s\S]{0,180}closest\(['"]#flightTime, \.resultTimeColumn['"]\)/
    );
    assert.match(
        html,
        /function handleLdtCardKeydown\(event\)[\s\S]{0,180}closest\(['"]#flightTime, \.resultTimeColumn['"]\)/
    );
});

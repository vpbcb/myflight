const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const myShiftHtml = fs.readFileSync(path.resolve(__dirname, '..', 'myshift.html'), 'utf8');
const bottomControlsMarkup = myShiftHtml.match(/<div class="bottom-controls">[\s\S]*?<\/div>/)?.[0] ?? '';

test('MyShift carousel has a bottom Cancel action', () => {
    assert.match(myShiftHtml, /id="carouselCancelBtn"[^>]*class="[^"]*carouselNavBtn[^"]*carouselCancelBtn[^"]*"[^>]*hidden[^>]*>Отмена<\/button>/);
    assert.doesNotMatch(bottomControlsMarkup, /id="carouselCancelBtn"/);
    assert.match(myShiftHtml, /\.carouselCancelBtn\s*\{[^}]*position:\s*fixed[^}]*left:\s*50%[^}]*bottom:[^}]*transform:\s*translateX\(-50%\)[^}]*background:\s*#ef4444/);
    assert.match(myShiftHtml, /const isRunning = carouselStepIndex >= 0[^;]*;[\s\S]{0,240}cancelButton\.hidden = !isRunning;/);
});

test('Cancel stops the carousel, closes its keypad, and removes field focus', () => {
    assert.match(myShiftHtml, /function cancelCarousel\(\)\s*\{[\s\S]*?closeKeypad\(\);[\s\S]*?finishCarousel\(\{\s*completed:\s*false\s*\}\);[\s\S]*?document\.activeElement\?\.blur\(\);[\s\S]*?\}/);
    assert.match(myShiftHtml, /\$\("carouselCancelBtn"\)\?\.addEventListener\('click',\s*cancelCarousel\)/);
});

test('completed MyShift data stays valid for its calendar day and the next day', () => {
    const startMarker = '// SHIFT_STATE_LIFETIME_START';
    const endMarker = '// SHIFT_STATE_LIFETIME_END';
    const start = myShiftHtml.indexOf(startMarker);
    const end = myShiftHtml.indexOf(endMarker);
    assert.notEqual(start, -1, 'lifetime helpers start marker');
    assert.ok(end > start, 'lifetime helpers end marker');

    const source = myShiftHtml.slice(start + startMarker.length, end);
    const context = {};
    vm.runInNewContext(`${source}\nthis.api = { getLocalDayStamp, isShiftStateFresh };`, context);

    const completedDay = context.api.getLocalDayStamp(new Date(2026, 8, 4, 23, 55));
    assert.equal(context.api.isShiftStateFresh(completedDay, completedDay), true);
    assert.equal(context.api.isShiftStateFresh(completedDay, completedDay + 1), true);
    assert.equal(context.api.isShiftStateFresh(completedDay, completedDay + 2), false);
    assert.equal(context.api.isShiftStateFresh(completedDay, completedDay - 1), false);
});

test('first or expired opening spotlights Start Calculation', () => {
    assert.match(myShiftHtml, /\.app-container\.carousel-ready::before/);
    assert.match(myShiftHtml, /function showCarouselStart\(\)\s*\{[\s\S]*?classList\.add\("carousel-ready"\)[\s\S]*?\$\("btnBotRefresh"\)\?\.focus\(\{\s*preventScroll:\s*true\s*\}\)/);
    assert.match(myShiftHtml, /function initializeShiftState\(\)\s*\{[\s\S]*?isShiftStateFresh[\s\S]*?loadState\(\)[\s\S]*?resetState\(\)[\s\S]*?showCarouselStart\(\)/);
    assert.match(myShiftHtml, /window\.addEventListener\("load",\s*\(\)\s*=>\s*\{\s*initializeShiftState\(\)/);
});

test('only full carousel completion records the retention day', () => {
    assert.match(myShiftHtml, /function finishCarousel\(\{\s*completed\s*=\s*true\s*\}\s*=\s*\{\}\)[\s\S]*?if\(completed\)\s*\{[\s\S]*?localStorage\.setItem\(SHIFT_COMPLETED_DAY_KEY,\s*String\(getLocalDayStamp\(\)\)\)/);
    assert.match(myShiftHtml, /function startCarousel\(\)\s*\{[\s\S]*?classList\.remove\("carousel-ready"\)/);
});

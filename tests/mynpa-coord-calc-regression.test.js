const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const myNpaHtml = fs.readFileSync(path.resolve(__dirname, '..', 'mynpa.html'), 'utf8');

function functionSource(name) {
    const start = myNpaHtml.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `${name} should exist`);
    const openBrace = myNpaHtml.indexOf('{', start);
    let depth = 0;

    for (let index = openBrace; index < myNpaHtml.length; index += 1) {
        if (myNpaHtml[index] === '{') depth += 1;
        if (myNpaHtml[index] === '}') depth -= 1;
        if (depth === 0) return myNpaHtml.slice(start, index + 1);
    }

    assert.fail(`${name} should have a closing brace`);
}

function loadCoordMath() {
    const context = {};
    vm.createContext(context);
    vm.runInContext([
        'getRadioCoordParts',
        'getRadioCoordMaskedValue',
        'parseNpaCoordPart',
        'parseNpaCoordinatePair',
        'getGreatCircleDistanceNm',
        'formatCoordCalcDistance',
        'splitCoordCalcText',
        'formatCoordCalcText',
        'isCoordCalcComplete'
    ].map(functionSource).join('\n'), context);
    return context;
}

test('great-circle distance matches reference values', () => {
    const { getGreatCircleDistanceNm } = loadCoordMath();
    // 1° по меридиану ≈ 60.04 NM
    assert.ok(Math.abs(getGreatCircleDistanceNm({ lat: 55, lon: 37 }, { lat: 56, lon: 37 }) - 60.04) < 0.01);
    // LAX → JFK из Aviation Formulary (Ed Williams): ≈ 2144 NM
    const lax = { lat: 33 + 56.6 / 60, lon: -(118 + 24.5 / 60) };
    const jfk = { lat: 40 + 38.4 / 60, lon: -(73 + 46.7 / 60) };
    assert.ok(Math.abs(getGreatCircleDistanceNm(lax, jfk) - 2144) < 2);
    assert.equal(getGreatCircleDistanceNm(lax, lax), 0);
});

test('masked keypad values are parsed with hemispheres and formatted in NM', () => {
    const math = loadCoordMath();
    const lax = math.parseNpaCoordinatePair(math.getRadioCoordMaskedValue('33566118245NW', false));
    assert.ok(Math.abs(lax.lat - (33 + 56.6 / 60)) < 1e-9);
    assert.ok(Math.abs(lax.lon + (118 + 24.5 / 60)) < 1e-9);
    const south = math.parseNpaCoordinatePair('3356.6S 01824.5E');
    assert.ok(south.lat < 0 && south.lon > 0);

    assert.equal(math.formatCoordCalcDistance(12.345), '12.3 NM');
    assert.equal(math.formatCoordCalcDistance(2143.6), '2144 NM');
    assert.equal(math.formatCoordCalcDistance(NaN), '-- NM');
});

test('collapsed calculator sits under the downwind leg on the Racetrack tab', () => {
    const racetrack = myNpaHtml.slice(myNpaHtml.indexOf('<div id="npaBlock2"'), myNpaHtml.indexOf('<div id="npaBlock4"'));
    assert.ok(racetrack.indexOf('Downwind leg') < racetrack.indexOf('id="npaCoordCalc"'));
    assert.match(racetrack, /<div class="npa-subsection-divider"><\/div>\s*<div class="npa-coord-calc" id="npaCoordCalc">/);
    assert.match(racetrack, /onclick="toggleNpaCoordCalc\(\)" aria-expanded="false">\s*<span class="npa-coord-calc-title-group">\s*<span class="npa-subsection-title">Coordinate calculator<\/span>\s*(?:<!--[^>]*-->)?<svg class="npa-coord-calc-globe"/);
    assert.match(racetrack, /id="npaCoordCalc1" data-coord-calc="1"[^>]*onclick="openNpaAirportRadioCoordKeypad\(this, true\)"/);
    assert.match(racetrack, /id="npaCoordCalc2" data-coord-calc="2"[^>]*onclick="openNpaAirportRadioCoordKeypad\(this\)"/);
    assert.match(myNpaHtml, /\.npa-coord-calc-body \{\s*display: none;/);
    assert.match(racetrack, /<span class="npa-coord-calc-arrow">&#9660;<\/span>/);
    assert.match(myNpaHtml, /\.npa-coord-calc\.open \.npa-coord-calc-arrow \{\s*transform: rotate\(180deg\);/);
});

test('coordinate keypad recalculates the distance and advances Coord 1 -> Coord 2', () => {
    assert.match(functionSource('getAirportCoordKeypadTitle'), /if \(input\?\.dataset\?\.coordCalc\) return `COORD \$\{input\.dataset\.coordCalc\}`;/);
    assert.match(functionSource('openNextRunwayCoordInput'), /coordCalc === '1'[\s\S]*npaCoordCalc2/);
    assert.match(myNpaHtml, /if \(activeAirportRadioCoordInput\?\.dataset\.coordCalc\) \{\s*activeAirportRadioCoordInput\.value = formatCoordCalcText\(finalVal\);\s*updateNpaCoordCalc\(\);/);
    assert.match(myNpaHtml, /restoreNpaCoordCalc\(\);\s*const restoredState = restoreNpaCurrentPageState\(\);/);
});

test('racetrack content scrolls instead of shrinking, so the dividers stay visible', () => {
    assert.match(myNpaHtml, /#npaBlock2\.npa-tab-panel\.open \{\s*overflow-y: auto;/);
    assert.match(myNpaHtml, /#npaBlock2 \.card-content \{[^}]*height: auto;\s*min-height: 100%;/);
    assert.match(myNpaHtml, /#npaBlock2 \.card-content > \* \{\s*flex-shrink: 0;/);
});

test('calculator accepts DM, DMS and decimal-degree coordinates without a mask', () => {
    const math = loadCoordMath();
    const expected = { lat: 55 + 58.4 / 60, lon: 37 + 24.9 / 60 };
    for (const typed of ['5558.4N03724.9E', 'N5558.4E03724.9', '555824N0372454E', '555824.0N0372454.0E', '55.973333N37.415E']) {
        const text = math.formatCoordCalcText(typed);
        const coord = math.parseNpaCoordinatePair(text);
        assert.ok(coord, `${typed} -> ${text}`);
        assert.ok(Math.abs(coord.lat - expected.lat) < 1e-5 && Math.abs(coord.lon - expected.lon) < 1e-5, `${typed} -> ${text}`);
    }
    assert.equal(math.formatCoordCalcText('5558.4N03724.9E'), '5558.4N 03724.9E');
    assert.equal(math.formatCoordCalcText('N5558.4E03724.9'), 'N5558.4 E03724.9');
    assert.equal(math.formatCoordCalcText('5558.4'), '5558.4');
    const southWest = math.parseNpaCoordinatePair(math.formatCoordCalcText('3356.6S11824.5W'));
    assert.ok(southWest.lat < 0 && southWest.lon < 0);
});

test('only the calculator keypad drops the mask and shows the dot key', () => {
    assert.ok(myNpaHtml.includes("if (dotBtn && !isNpaCoordCalcKeypad()) dotBtn.style.visibility = 'hidden';"));
    assert.ok(myNpaHtml.includes("if (activeNpaField === 'airportRadioCoord' && !isNpaCoordCalcKeypad()) {"));
    assert.ok(myNpaHtml.includes('currentKpVal = `${currentKpVal}${value}`.slice(0, 24);'));
    assert.ok(myNpaHtml.includes('activeAirportRadioCoordInput.value = finalVal === "" && keypadWasCleared ? "" : getRadioCoordMaskedValue(finalVal, true);'));
});

test('calculator keypad display always has two lines, latitude and longitude', () => {
    const context = {};
    vm.createContext(context);
    vm.runInContext(['splitCoordCalcText', 'getCoordCalcKeypadHtml'].map(functionSource).join('\n'), context);
    const lines = html => (html.match(/<span class="kp-coord-line[^"]*">[^<]*<\/span>/g) || []).length;
    for (const typed of ['', '5558', '5558.4N', '5558.4N037', '555833N0372452E']) {
        assert.equal(lines(context.getCoordCalcKeypadHtml(typed)), 2, typed);
    }
    assert.match(context.getCoordCalcKeypadHtml(''), /kp-coord-hint">latitude<\/span><span class="kp-coord-line kp-coord-hint">longitude/);
    assert.match(context.getCoordCalcKeypadHtml('5558.4N037'), /">5558\.4N<\/span><span class="kp-coord-line">037</);
});

test('keypad shows NEXT until both lines have values; NEXT moves to the longitude line', () => {
    const math = loadCoordMath();
    assert.equal(math.isCoordCalcComplete(''), false);
    assert.equal(math.isCoordCalcComplete('5558.4'), false);
    assert.equal(math.isCoordCalcComplete('5558.4 '), false);
    assert.equal(math.isCoordCalcComplete('5558.4N'), false);
    assert.equal(math.isCoordCalcComplete('5558.4 037'), true);
    assert.equal(math.isCoordCalcComplete('5558.4N037'), true);
    assert.ok(myNpaHtml.includes('<button id="doneBtn" class="kp-btn kp-done" onclick="pressNpaKeypadDone()">DONE</button>'));
    assert.ok(myNpaHtml.includes("if (doneBtn && !isCoordCalcComplete(shownValue)) doneBtn.textContent = 'NEXT';"));
});

test('missing hemisphere is not auto-filled: N/S or E/W keys blink three times instead', () => {
    assert.doesNotMatch(myNpaHtml, /function finalizeCoordCalcText/);
    assert.match(functionSource('pressNpaKeypadDone'), /if \(!\/\[EW\]\/\.test\(splitCoordCalcText\(shownValue\)\.lon\)\) \{\s*blinkNpaKeypadButtons\(\['E', 'W'\]\);\s*return;/);
    assert.match(myNpaHtml, /if \(!\/\[NS\]\/\.test\(parts\.lat\)\) \{\s*blinkNpaKeypadButtons\(\['N', 'S'\]\);\s*return;/);
    // 6 полупериодов alternate = три вспышки
    assert.match(myNpaHtml, /\.kp-btn\.kp-blink \{\s*animation: kp-hemisphere-blink 0\.3s ease-in-out 6 alternate;/);
});

test('calculator block is collapsed after a page reload; only the coordinates are remembered', () => {
    const restore = functionSource('restoreNpaCoordCalc');
    assert.match(restore, /setNpaCoordCalcOpen\(false\);/);
    assert.doesNotMatch(restore, /saved\.open/);
    assert.doesNotMatch(functionSource('saveNpaCoordCalc'), /open:/);
});

test('longitude without a leading zero is parsed with two-digit degrees', () => {
    const math = loadCoordMath();
    const expected = 37 + 24.9 / 60;
    for (const text of ['5558.4N 03724.9E', '5558.4N 3724.9E', '555824N 0372454E', '555824N 372454E', '55.97N 37.415E']) {
        assert.ok(Math.abs(math.parseNpaCoordinatePair(text).lon - expected) < 1e-3, text);
    }
    assert.ok(Math.abs(math.parseNpaCoordinatePair('5558.4N 11824.5W').lon + (118 + 24.5 / 60)) < 1e-9);
    // пример пользователя: десятичные градусы, ~2.96 NM
    const a = math.parseNpaCoordinatePair('44.211289N 43.19758E');
    const b = math.parseNpaCoordinatePair('44.195756N 43.132339E');
    assert.equal(math.formatCoordCalcDistance(math.getGreatCircleDistanceNm(a, b)), '3.0 NM');
});

test('only the hemisphere keys that fit the current line are active', () => {
    const context = {};
    vm.createContext(context);
    vm.runInContext(['splitCoordCalcText', 'getCoordCalcAllowedHemispheres'].map(functionSource).join('\n'), context);
    const allowed = value => context.getCoordCalcAllowedHemispheres(value).join('');
    assert.equal(allowed(''), 'NS');
    assert.equal(allowed('4412.3'), 'NS');
    assert.equal(allowed('4412.3N'), 'EW');
    assert.equal(allowed('N4412.3'), 'EW');
    assert.equal(allowed('4412.3N 04308.4'), 'EW');
    assert.equal(allowed('4412.3N 04308.4E'), '');
    assert.match(myNpaHtml, /#kpExtraRow \.kp-btn:disabled \{\s*opacity: 0\.3;\s*pointer-events: none;/);
});

test('CLR clears longitude first, then latitude', () => {
    const clear = myNpaHtml.slice(myNpaHtml.indexOf("if (key === 'clear') {"), myNpaHtml.indexOf("if (key === 'temp_sign') {"));
    assert.match(clear, /if \(isNpaCoordCalcKeypad\(\)\) \{[\s\S]*?const parts = splitCoordCalcText\(getCoordCalcShownValue\(\)\);\s*if \(parts\.lon \|\| parts\.separated\) \{/);
    assert.ok(clear.indexOf('isNpaCoordCalcKeypad()') < clear.lastIndexOf('currentKpVal = "";'));
});

test('with both lines empty CLR becomes EXIT and closes the keypad', () => {
    assert.match(functionSource('updateNpaKeypadClearButton'), /const shouldShowExit = isNpaCoordCalcKeypad\(\) && getCoordCalcShownValue\(\)\.trim\(\) === "";/);
    const clear = myNpaHtml.slice(myNpaHtml.indexOf("if (key === 'clear') {"), myNpaHtml.indexOf("if (key === 'temp_sign') {"));
    assert.match(clear, /if \(getCoordCalcShownValue\(\)\.trim\(\) === ""\) \{\s*closeNpaKeypad\(\);\s*return;/);
});

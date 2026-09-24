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
        'formatCoordCalcDistance'
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
    assert.match(racetrack, /onclick="toggleNpaCoordCalc\(\)" aria-expanded="false">\s*<span class="npa-subsection-title">Coordinate calculator<\/span>/);
    assert.match(racetrack, /id="npaCoordCalc1" data-coord-calc="1"[^>]*onclick="openNpaAirportRadioCoordKeypad\(this, true\)"/);
    assert.match(racetrack, /id="npaCoordCalc2" data-coord-calc="2"[^>]*onclick="openNpaAirportRadioCoordKeypad\(this\)"/);
    assert.match(myNpaHtml, /\.npa-coord-calc-body \{\s*display: none;/);
    assert.match(myNpaHtml, /\.npa-coord-calc\.open \.npa-coord-calc-arrow \{\s*transform: rotate\(90deg\);/);
});

test('coordinate keypad recalculates the distance and advances Coord 1 -> Coord 2', () => {
    assert.match(functionSource('getAirportCoordKeypadTitle'), /if \(input\?\.dataset\?\.coordCalc\) return `COORD \$\{input\.dataset\.coordCalc\}`;/);
    assert.match(functionSource('openNextRunwayCoordInput'), /coordCalc === '1'[\s\S]*npaCoordCalc2/);
    assert.match(myNpaHtml, /getRadioCoordMaskedValue\(finalVal, true\);\s*if \(activeAirportRadioCoordInput\.dataset\.coordCalc\) updateNpaCoordCalc\(\);/);
    assert.match(myNpaHtml, /restoreNpaCoordCalc\(\);\s*const restoredState = restoreNpaCurrentPageState\(\);/);
});

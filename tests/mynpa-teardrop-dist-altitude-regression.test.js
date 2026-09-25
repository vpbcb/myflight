const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const myNpaHtml = fs.readFileSync(path.resolve(__dirname, '..', 'mynpa.html'), 'utf8');

function functionSource(name) {
    const start = myNpaHtml.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `${name} should exist`);
    const openBrace = myNpaHtml.indexOf('{', myNpaHtml.indexOf(')', start));
    let depth = 0;

    for (let index = openBrace; index < myNpaHtml.length; index += 1) {
        if (myNpaHtml[index] === '{') depth += 1;
        if (myNpaHtml[index] === '}') depth -= 1;
        if (depth === 0) return myNpaHtml.slice(start, index + 1);
    }

    assert.fail(`${name} should have a closing brace`);
}

function createContext(fields, mode) {
    const context = { Math, Number, String, fields, mode };
    vm.createContext(context);
    vm.runInContext(`
        var NPA_FDP_FAP_DEFAULT_MODE = 'alt';
        var npaFdpFapMode = mode;
        function getNumberOrBlank(id) { return fields[id] === undefined ? "" : fields[id]; }
        function getAirportThresholdElevationValue() { return fields.elevation; }
        ${[
            'normalizeCourse', 'getReciprocalCourse', 'formatOffsetTrack',
            'normalizeNpaFdpFapMode', 'getNpaFdpFapMode', 'isFilledProfileNumber',
            'getNpaProfileGeometryState', 'getNpaFdpFapInputGeometryState',
            'getNpaProfileRawDistFromInd', 'getNpaProfileIndFromDist',
            'roundNpaProfileDistance', 'roundNpaFdpFapDistanceAltitude', 'getNpaProfileMetrics'
        ].map(functionSource).join('\n')}
    `, context);
    return context;
}

test('teardrop offset track turns 30 degrees towards the holding side', () => {
    const context = createContext({}, 'alt');
    assert.equal(vm.runInContext("formatOffsetTrack(294, 'Right')", context), '084°');
    assert.equal(vm.runInContext("formatOffsetTrack(294, 'Left')", context), '144°');
    assert.equal(vm.runInContext("formatOffsetTrack(360, 'Right')", context), '150°');
    assert.equal(vm.runInContext("formatOffsetTrack(360, 'Left')", context), '210°');
    assert.match(functionSource('updateRacetrackSectors'), /formatOffsetTrack\(inbound, racetrack\)/);
});

test('DIST mode FDP/FAP altitude is the charted altitude plus temperature correction rounded up to 100 ft', () => {
    // USCC VOR RWY 09: FAF 3.8 NM, THR 759 ft, на схеме 2000 ft
    const fapAltitude = tempC => vm.runInContext(
        'getNpaProfileMetrics().hFap',
        createContext({ fap: 3.8, elevation: 759, gpa: 3, tempC }, 'dist')
    );
    assert.equal(fapAltitude(-30), 2300);
    assert.equal(fapAltitude(-10), 2200);
    assert.equal(fapAltitude(13.5), 2000);
    assert.equal(fapAltitude(30), 2000);

    // URMM: FAP 6.0 NM, THR 1044 ft — при МСА на уровне торца ровно высота схемы
    const urmm = tempC => vm.runInContext(
        'getNpaProfileMetrics()',
        createContext({ fap: 6, elevation: 1044, gpa: 3, tempC }, 'dist')
    );
    assert.equal(urmm(15 - 0.00198 * 1044).hFap, 3000);
    assert.equal(urmm(-30).hFap, 3400);
    assert.equal(urmm(-30).dFap, 6);
});

test('ALT mode keeps the entered altitude and moves the distance with temperature', () => {
    const metrics = vm.runInContext(
        'getNpaProfileMetrics()',
        createContext({ fap: 3000, elevation: 1044, gpa: 3, tempC: -30 }, 'alt')
    );
    assert.equal(metrics.hFap, 3000);
    assert.equal(metrics.dFap, 5.1);
});

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

const GEOMETRY_FUNCTIONS = [
    'normalizeBearing360', 'reciprocalBearing', 'getBearingFromNmVector', 'getProfileOutboundBearingDeg',
    'getRadioDirectGeometry', 'getDirectRadioDistanceFromThr', 'getThrDistanceFromDirectRadioDistance',
    'getProfileRadioShiftExactNm', 'getProfileRadioGeometrySource', 'getNpaProfileRadioDistanceFromThr',
    'getNpaProfileThrFromRadioDistance', 'getNpaProfileActiveShift', 'getNpaProfileActiveBaselineNm',
    'getNpaProfileThrFromActiveNm', 'getNpaProfileShiftedColumnDisplay', 'hasNpaProfileShiftValue',
    'formatNpaProfileDistance', 'normalizeNpaProfileUnit', 'getDownwindDistanceFromFinalDescent',
    'getNmVector', 'getRadioAidDirectDistanceNm', 'getRadioAidSignedShiftNm', 'findRunwayForThreshold',
    'parseNpaCoordinatePair', 'parseNpaCoordPart', 'normalizeRadioDirectSource', 'sanitizeNpaAirportCode',
    'normalizeOptionalNmValue'
];

// Координаты из базы аэропортов MyNPA (формат ГГММ.м)
const AIRPORTS = {
    URMM: {
        runways: [{ thr1: '11', thr1Coord: '4414.2N 04303.7E', thr2: '29', thr2Coord: '4413.0N 04306.2E' }],
        radioAids: [{ name: 'MNW', type: 'VOR', coord: '4414.4N 04303.2E' }]
    },
    UUEE: {
        runways: [{ thr1: '06R', thr1Coord: '5558.0N 03723.2E', thr2: '24L', thr2Coord: '5558.5N 03726.6E' }],
        radioAids: [{ name: 'MR', type: 'VOR', coord: '5558.7N 03719.7E' }]
    }
};

function createContext({ airport, threshold, aidName, inboundCourse = 114, manualShift = 0 }) {
    const aid = aidName ? AIRPORTS[airport].radioAids.find(item => item.name === aidName) : null;
    const context = {
        Math, Number, String, Object, Array,
        NPA_NM_TO_KM: 1.852,
        npaProfileUnits: { dist: 'nm', radio: 'nm', tar: 'nm' },
        AIRPORTS,
        state: {
            airport,
            threshold,
            inboundCourse,
            manualShift,
            source: aid ? { type: 'VOR', coord: aid.coord, airportCode: airport, threshold, label: `${aid.name} VOR` } : null
        }
    };
    vm.createContext(context);
    vm.runInContext(`
        var profileRadioShiftExactNm = null;
        var finalDescentFromSource = 'fap';
        function getNpaAirportCode() { return state.airport; }
        function getCurrentLandingThreshold() { return state.threshold; }
        function getAirportDocument(code) { return AIRPORTS[code]; }
        function getProfileRadioDirectSource() { return state.source; }
        function getDownwindRadioFixDirectSource() { return state.source; }
        function getDownwindRadioFixShiftNumber() { return state.manualShift; }
        function hasNpaProfileRadioReference() { return Boolean(state.source) || Math.abs(state.manualShift) > 1e-9; }
        function getNumberOrBlank(id) { return id === 'inboundCrs' ? state.inboundCourse : ""; }
        ${GEOMETRY_FUNCTIONS.map(functionSource).join('\n')}
    `, context);
    return context;
}

function run(context, expression) {
    return vm.runInContext(expression, context);
}

test('runway axis for radio geometry ignores the holding Inbound course', () => {
    assert.doesNotMatch(functionSource('getProfileOutboundBearingDeg'), /inboundCrs/);

    // URMM VOR Z RWY 29: MNW за торцом 11, FAF 6.0 NM ↔ D8.5–8.6 MNW при любом Inbound course
    for (const inboundCourse of [114, 294, '']) {
        const context = createContext({ airport: 'URMM', threshold: '29', aidName: 'MNW', inboundCourse });
        assert.ok(Math.abs(run(context, 'getNpaProfileRadioDistanceFromThr(6, 0)') - 8.57) < 0.02);
        assert.ok(Math.abs(run(context, "getDownwindDistanceFromFinalDescent({ valid: true, fapValid: true, dFap: 6, dFapRaw: 6 })") - 8.57) < 0.02);
    }
});

test('profile radio column uses exact distance for an aid beside the final approach', () => {
    // UUEE NDB RWY 06R: MR 1.72 NM перед торцом и 1.17 NM сбоку; по схеме IF D5.3, D D4.2, FAF D2.6
    const context = createContext({ airport: 'UUEE', threshold: '06R', aidName: 'MR' });
    const at = thrNm => run(context, `getNpaProfileRadioDistanceFromThr(${thrNm}, 0)`);
    assert.ok(Math.abs(at(6.9) - 5.3) < 0.1);
    assert.ok(Math.abs(at(5.7) - 4.2) < 0.1);
    assert.ok(Math.abs(at(4.1) - 2.6) < 0.1);
    assert.ok(at(0.5) > 1, 'distance stays positive after passing the aid');
});

test('radio scale converts DME to the threshold point before passing the aid', () => {
    const context = createContext({ airport: 'UUEE', threshold: '06R', aidName: 'MR' });
    assert.ok(Math.abs(run(context, "getNpaProfileThrFromActiveNm('radio', 2, 0, 0)") - 3.34) < 0.05);
    assert.ok(Number.isNaN(run(context, "getNpaProfileThrFromActiveNm('radio', 1, 0, 0)")), 'DME below the abeam minimum is not on the final');

    const [topNm, bottomNm] = run(context, "getNpaProfileActiveBaselineNm('radio', 0, 0)");
    assert.ok(Math.abs(topNm - run(context, 'getNpaProfileRadioDistanceFromThr(10, 0)')) < 1e-9);
    assert.ok(Math.abs(bottomNm - run(context, 'getNpaProfileRadioDistanceFromThr(2, 0)')) < 1e-9);
});

test('manual radio shift without coordinates is shown as an absolute distance', () => {
    const context = createContext({ airport: 'URMM', threshold: '29', aidName: null, manualShift: -2.5 });
    assert.equal(run(context, 'getNpaProfileRadioDistanceFromThr(1, -2.5)'), 1.5);
    assert.equal(run(context, "getNpaProfileThrFromActiveNm('radio', 3, -2.5, 0)"), 5.5);
    assert.equal(run(context, "getNpaProfileShiftedColumnDisplay({ thrNm: 5, radioNm: 5, radioEnabled: true, tarNm: 5 }, 'radio')"), '5 nm');
});

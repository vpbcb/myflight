const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const projectRoot = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(projectRoot, name), 'utf8');
const context = {};
vm.runInNewContext(
    read('dbaircraft.js') + '\n' + read('dbloadsheet.js') + '\n' + read('loadsheet.js') +
    '\nglobalThis.__t = { aircraftDB, loadsheetDB, LoadsheetEngine };',
    context
);
const { aircraftDB, loadsheetDB, LoadsheetEngine: E } = context.__t;

// Objects created inside the vm context have foreign prototypes; compare them as plain JSON.
function plain(value) {
    return JSON.parse(JSON.stringify(value));
}

function deepFreeze(o) {
    if (o && typeof o === 'object' && !Object.isFrozen(o)) {
        Object.freeze(o);
        Object.values(o).forEach(deepFreeze);
    }
    return o;
}

const a320 = deepFreeze({
    reg: 'TEST', type: 'A320', config: '8/150', mtow: 75500, mlw: 66000, maxFuel: 24166,
    dow: 42150, perf: { '2/5': { dow: 42150, doi: 54.62 } }
});
// Presentation example (2013): 6 C + 91 Y, cargo 3 = 620 kg, 18000 kg @ 0.785 => ZFW 51185, TOW 69185
const example8150 = deepFreeze({
    aircraft: a320, crew: '2/5', paxWeight: 85,
    pax: { OA: 6, OB: 54, OC: 39 }, cargo: { '3': 620 }, fuel: { kg: 18000, density: 0.785 }
});

test('roundSymmetric rounds half away from zero and never returns -0', () => {
    assert.equal(E.roundSymmetric(0.5), 1);
    assert.equal(E.roundSymmetric(-0.5), -1);
    assert.ok(Object.is(E.roundSymmetric(-0.3), 0));
    assert.equal(E.roundSymmetric(-18.495), -18);
    assert.equal(E.roundSymmetric(18.88), 19);
    assert.equal(E.roundSymmetric(54.62), 55);
});

test('index <-> %MAC formula matches the blank header', () => {
    assert.ok(Math.abs(E.indexToMac(77, 62700) - 35.3) < 0.05);
    assert.ok(Math.abs(E.indexToMac(74, 72700) - 32.8) < 0.1);
    assert.ok(Math.abs(E.macToIndex(E.indexToMac(61.3, 58000), 58000) - 61.3) < 1e-9);
});

test('cargo nearest-row reading reproduces the presentation examples', () => {
    const c8150 = loadsheetDB['8/150'].cargo;
    const c12144 = loadsheetDB['12/144'].cargo;
    assert.equal(E.nearestRowIndex(620, c8150['3'].kgPerIndex), 3);
    assert.equal(E.nearestRowIndex(1100, c12144['1'].kgPerIndex), -8);
    assert.equal(E.nearestRowIndex(1350, c12144['3'].kgPerIndex), 6);
    assert.equal(E.nearestRowIndex(1600, c12144['4'].kgPerIndex), 12);
    assert.equal(E.nearestRowIndex(500, c12144['5'].kgPerIndex), 6);
    assert.ok(Object.is(E.nearestRowIndex(0, c8150['1'].kgPerIndex), 0));
    assert.equal(E.nearestRowIndex(1, c8150['1'].kgPerIndex), -1);
});

test('cargo coefficients reproduce the printed thresholds within 2 kg', () => {
    const printed = {
        '8/150': { '1': [77, 233, 389, 544, 3346], '3': [124, 373, 623, 2367], '4': [69, 209, 348, 2163], '5': [47, 143, 238, 1479] },
        '16/167': { '1': [42, 128, 214, 2192], '2': [66, 198, 331, 3378], '3': [85, 255, 425, 3488], '4': [50, 152, 254, 2187], '5': [38, 114, 190, 1483] },
        '12/184': { '3': [74, 222, 370, 2297], '5': [38, 116, 193, 735] }
    };
    for (const [config, holds] of Object.entries(printed)) {
        for (const [hold, thresholds] of Object.entries(holds)) {
            const step = Math.abs(loadsheetDB[config].cargo[hold].kgPerIndex);
            thresholds.forEach((kg, i) => {
                const n = i < thresholds.length - 1 ? i + 1 : Math.round(kg / step + 0.5);
                assert.ok(Math.abs((n - 0.5) * step - kg) <= 2, `${config} hold ${hold}: ${kg} kg -> ${n}`);
            });
        }
    }
});

test('printed cabin rows are consistent with the fitted coefficient (±1.5 index, blank typos included)', () => {
    for (const [config, data] of Object.entries(loadsheetDB)) {
        for (const [zone, spec] of Object.entries(data.cabin)) {
            if (!spec.table) continue;
            assert.equal(spec.table[spec.table.length - 1][0], spec.seats, `${config} ${zone} last row = seats`);
            for (const [n, idx] of spec.table) {
                assert.ok(Math.abs(n * spec.indexPerPax - idx) <= 1.5, `${config} ${zone}: ${n} pax -> ${idx}`);
            }
        }
    }
});

test('fuel index: exact rows, interpolation, clamping and density snapping', () => {
    const f = loadsheetDB['8/150'].fuel;
    const fullKg = 24166 * 0.785;
    assert.equal(E.fuelIndex(18000, 0.785, f, fullKg, 'precise').value, -10);
    assert.equal(E.fuelIndex(18000, 0.785, f, fullKg, 'lts').value, -10);
    assert.ok(Math.abs(E.fuelIndex(17750, 0.785, f, fullKg, 'precise').value - (-9.5)) < 1e-9);
    assert.equal(E.fuelIndex(18240, 0.785, f, fullKg, 'lts').value, -10);
    assert.equal(E.fuelIndex(18260, 0.785, f, fullKg, 'lts').value, -11);
    assert.equal(E.fuelIndex(10000, 0.807, f, fullKg, 'precise').value, -4);
    assert.equal(E.fuelIndex(10000, 0.785, f, fullKg, 'precise').value, -3);

    const low = E.fuelIndex(1750, 0.785, f, fullKg, 'precise');
    assert.ok(low.value > 0 && low.value < 1);
    assert.equal(low.warnings.length, 1);
    assert.ok(Object.is(E.fuelIndex(0, 0.785, f, fullKg, 'precise').value, 0));

    assert.equal(E.fuelIndex(18900, 0.785, f, fullKg, 'precise').value, -11);
    const over = E.fuelIndex(25000, 0.785, f, fullKg, 'precise');
    assert.equal(over.value, f.full[0]);
    assert.equal(over.warnings.length, 1);

    const wrongDensity = E.fuelIndex(10000, 0.9, f, 24166 * 0.9, 'precise');
    assert.ok(wrongDensity.warnings.some(w => /Плотность/.test(w)));
});

test('pitch trim scale: linear between the printed ends, constant beyond', () => {
    const a320 = loadsheetDB['8/150'].pitchTrim;
    assert.ok(Math.abs(E.pitchTrim(17, a320) - 2.5) < 0.01);
    assert.ok(Math.abs(E.pitchTrim(28.5, a320)) < 1e-9);
    assert.ok(Math.abs(E.pitchTrim(40, a320) + 2.5) < 0.01);
    assert.equal(E.pitchTrim(10, a320), E.pitchTrim(17, a320));
    assert.equal(E.pitchTrim(45, a320), E.pitchTrim(40, a320));
    const a321 = loadsheetDB['16/167'].pitchTrim;
    assert.ok(Math.abs(E.pitchTrim(12, a321) - 4.5) < 0.02);
    assert.ok(Math.abs(E.pitchTrim(41, a321) + 3.5) < 0.02);
    assert.deepEqual(loadsheetDB['28/142'].pitchTrim, a321);
    assert.deepEqual(loadsheetDB['12/184'].pitchTrim, a321);
    assert.equal(E.formatPitchTrim(1.24), 'UP 1.2');
    assert.equal(E.formatPitchTrim(-0.55), 'DN 0.6');
    assert.equal(E.formatPitchTrim(0.04), '0.0');
});

test('A320 8/150 worked example: paper-style result matches the presentation', () => {
    const r = E.calculate(example8150, loadsheetDB);
    assert.equal(r.ok, true, r.errors.join('; '));
    assert.equal(r.weights.zfw, 51185);
    assert.equal(r.weights.tow, 69185);
    assert.equal(r.lts.index.doi, 55);
    assert.deepEqual(plain(r.lts.index.cargo), { '1': 0, '3': 3, '4': 0, '5': 0 });
    assert.equal(r.lts.index.deadLoad, 58);
    assert.deepEqual(plain(r.lts.index.cabin), { OA: -5, OB: -18, OC: 19 });
    assert.equal(r.lts.index.zfw, 54);
    assert.equal(r.lts.index.fuel, -10);
    assert.equal(r.lts.index.tow, 44);
    assert.ok(Math.abs(r.lts.mac.zfw - 27.0) < 0.3, `zfw mac ${r.lts.mac.zfw}`);
    assert.ok(Math.abs(r.lts.mac.tow - 22.7) < 0.3, `tow mac ${r.lts.mac.tow}`);
    assert.equal(r.limits.towCgBelow27, true);
    assert.ok(Math.abs(r.lts.stabTo - (28.5 - r.lts.mac.tow) / 4.6) < 1e-9);
    assert.equal(E.formatPitchTrim(r.lts.stabTo), 'UP 1.2');
    assert.equal(r.limits.zfwOver, false);
    assert.equal(r.limits.towOver, false);
});

test('A320 8/150 worked example: precise result is unrounded and differs from paper', () => {
    const r = E.calculate(example8150, loadsheetDB);
    const expected = 54.62 + 620 / 249.1 + 6 * -0.79 + 54 * -0.3415 + 39 * 0.4857;
    assert.ok(Math.abs(r.precise.index.zfw - expected) < 1e-9);
    assert.equal(r.precise.index.doi, 54.62);
    assert.notEqual(r.precise.index.zfw, r.lts.index.zfw);
    assert.ok(Math.abs(r.precise.mac.zfw - E.indexToMac(expected, 51185)) < 1e-9);
});

test('A320neo 12/144 worked example (2022 presentation)', () => {
    const aircraft = { reg: 'TEST', type: 'A320neo', config: '12/144', mtow: 75500, maxFuel: 24209,
                       perf: { '2/4': { dow: 46052, doi: 51 } } };
    const r = E.calculate({
        aircraft, crew: '2/4', paxWeight: 85,
        pax: { '0A': 12, '0B': 48, OC: 48, OD: 30 },
        cargo: { '1': 1100, '3': 1350, '4': 1600, '5': 500 },
        fuel: { kg: 10000, density: 0.785 }
    }, loadsheetDB);
    assert.equal(r.ok, true, r.errors.join('; '));
    assert.deepEqual(plain(r.lts.index.cargo), { '1': -8, '3': 6, '4': 12, '5': 6 });
    assert.deepEqual(plain(r.lts.index.cabin), { OA: -8, OB: -14, OC: 10, OD: 22 });
    assert.equal(r.lts.index.deadLoad, 67);
    assert.equal(r.lts.index.zfw, 77);
    assert.equal(r.lts.index.fuel, -3);
    assert.equal(r.lts.index.tow, 74);
});

test('weight and capacity limits produce flags and warnings', () => {
    const r = E.calculate({
        aircraft: a320, crew: '2/5', paxWeight: 100,
        pax: { OA: 9, OB: 54, OC: 96 }, cargo: { '1': 3402, '3': 2500, '4': 2268, '5': 1497 },
        fuel: { kg: 19000, density: 0.785 }
    }, loadsheetDB);
    assert.equal(r.ok, true);
    assert.equal(r.limits.zfwOver, true);
    assert.equal(r.limits.towOver, true);
    assert.deepEqual(plain(r.limits.zoneOver), ['OA']);
    assert.deepEqual(plain(r.limits.holdOver), ['3']);
    assert.ok(r.warnings.some(w => /MZFW/.test(w)));
    assert.ok(r.warnings.some(w => /MTOW/.test(w)));
    assert.ok(r.warnings.some(w => /ёмкости/.test(w)));
});

test('invalid input yields ok:false with a message and null results', () => {
    const base = { aircraft: a320, crew: '2/5', pax: {}, cargo: {}, fuel: { kg: 5000, density: 0.785 } };
    const cases = [
        [{ ...base, aircraft: { ...a320, config: '20/120' } }, /Нет данных LTS/],
        [{ ...base, aircraft: { ...a320, perf: {} } }, /DOW\/DOI/],
        [{ ...base, crew: '3/6' }, /DOW\/DOI/],
        [{ ...base, pax: { OD: 1 } }, /зона/],
        [{ ...base, pax: { OA: 1.5 } }, /целым/],
        [{ ...base, cargo: { '2': 100 } }, /отсек/],
        [{ ...base, cargo: { '3': -5 } }, /отсека 3/],
        [{ ...base, fuel: { kg: NaN } }, /Топливо/],
        [{ ...base, fuel: { kg: 5000, density: 0 } }, /Плотность/],
        [{ ...base, paxWeight: 0 }, /Вес пассажира/],
        [{ ...base, aircraft: null }, /борт/]
    ];
    for (const [input, re] of cases) {
        const r = E.calculate(input, loadsheetDB);
        assert.equal(r.ok, false);
        assert.ok(r.errors.some(e => re.test(e)), `${re} in ${r.errors}`);
        assert.equal(r.precise, null);
        assert.equal(r.lts, null);
        assert.equal(r.limits, null);
    }
});

test('defaults: missing zones/holds are zero, density and pax weight fall back to CONST', () => {
    const r = E.calculate({ aircraft: a320, crew: '2/5', fuel: { kg: 0 } }, loadsheetDB);
    assert.equal(r.ok, true);
    assert.equal(r.weights.paxWeight, E.CONST.DEFAULT_PAX_WEIGHT);
    assert.equal(r.weights.payload, 0);
    assert.equal(r.weights.zfw, 42150);
    assert.equal(r.precise.index.zfw, 54.62);
    assert.equal(r.precise.index.fuel, 0);
    assert.equal(r.lts.index.tow, 55);
});

test('fuel table data is well-formed for every configuration', () => {
    for (const [config, data] of Object.entries(loadsheetDB)) {
        const { rows, densities, full } = data.fuel;
        assert.deepEqual(plain(densities), [0.785, 0.800, 0.810, 0.820], config);
        assert.equal(full.length, 4, config);
        const ended = [false, false, false, false];
        for (let i = 0; i < rows.length; i++) {
            assert.equal(rows[i].length, 5, `${config} row ${i}`);
            if (i > 0) assert.equal(rows[i][0] - rows[i - 1][0], 500, `${config} step at ${rows[i][0]}`);
            for (let c = 1; c <= 4; c++) {
                const v = rows[i][c];
                assert.ok(v === null || Number.isInteger(v), `${config} ${rows[i][0]} col ${c}`);
                if (v === null) ended[c - 1] = true;
                else assert.equal(ended[c - 1], false, `${config}: null must be trailing (row ${rows[i][0]}, col ${c})`);
            }
        }
    }
});

test('every aircraft in aircraftDB has LTS data and seat counts match its config', () => {
    for (const aircraft of aircraftDB) {
        const data = loadsheetDB[aircraft.config];
        assert.ok(data, `${aircraft.regFull}: no LTS data for ${aircraft.config}`);
        const [c, y] = aircraft.config.split('/').map(Number);
        const seats = Object.values(data.cabin).reduce((s, z) => s + z.seats, 0);
        assert.equal(seats, c + y, `${aircraft.config} seats`);
        assert.equal(data.cabin.OA.seats, c, `${aircraft.config} business seats`);
    }
    const real = aircraftDB.find(a => a.reg === '73753');
    const r = E.calculate({ aircraft: real, crew: '2/4', pax: { OA: 4, OB: 50, OC: 80 },
                            cargo: { '1': 800, '3': 900, '4': 600, '5': 200 }, fuel: { kg: 9000, density: 0.8 } }, loadsheetDB);
    assert.equal(r.ok, true, r.errors.join('; '));
    assert.ok(r.precise.mac.zfw > 20 && r.precise.mac.zfw < 40, `mac ${r.precise.mac.zfw}`);
});

test('calculate does not mutate its input or the database', () => {
    const snapshot = JSON.stringify(loadsheetDB);
    const input = deepFreeze({ aircraft: a320, crew: '2/5', pax: { OA: 2 }, cargo: { '1': 100 }, fuel: { kg: 6000, density: 0.8 } });
    const r = E.calculate(input, loadsheetDB);
    assert.equal(r.ok, true);
    assert.equal(JSON.stringify(loadsheetDB), snapshot);
});

test('takeoff CG envelope follows the WBM design limits', () => {
    const a320 = loadsheetDB['8/150'].towCg;
    // Табличные точки WBM WV 011 (extended forward) читаются как есть.
    assert.equal(E.envelopeLimit(a320.fwd, 63000), 17);
    assert.equal(E.envelopeLimit(a320.aft, 57900), 41);
    // Между точками предел линеен по моменту, а не по %MAC.
    const fwd74 = E.envelopeLimit(a320.fwd, 74000);
    assert.ok(fwd74 > 18.9 && fwd74 < 24.25);
    assert.notEqual(fwd74.toFixed(2), (18.9 + (24.25 - 18.9) * 0.25).toFixed(2));

    assert.equal(E.towCgCheck(61.6, 64000, a320).inside, false); // RA-73180: зелёный был ошибкой
    assert.equal(E.towCgCheck(35.1, 64000, a320).inside, true);
    assert.equal(E.towCgCheck(16.0, 64000, a320).inside, false);
    assert.equal(E.towCgCheck(30, 76000, a320).inside, false); // тяжелее последней точки WBM

    for (const [config, spec] of Object.entries(loadsheetDB)) {
        assert.ok(spec.towCg, `${config}: нет взлётных пределов CG`);
        const heaviest = spec.towCg.fwd[spec.towCg.fwd.length - 1][0];
        assert.equal(spec.towCg.aft[spec.towCg.aft.length - 1][0], heaviest, `${config}: fwd/aft на разных весах`);
    }
});

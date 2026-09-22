// Load and Trim Sheet engine: index / %MAC calculation for A320/A321 per the Aeroflot LTS
// procedure. Pure functions, no DOM. Data comes from dbloadsheet.js (per configuration) and
// dbaircraft.js (DOW/DOI per crew, MTOW, tank volume).
//
// Two result flavours are produced from one computation path:
//   precise - unrounded indices (matches the electronic loadsheet),
//   lts     - integer indices rounded the way a pilot reads the paper blank:
//             DOI rounded, cargo read from the nearest printed row, cabin from the printed
//             pax row, fuel from the nearest table row.
//
// Verified against the worked examples in the Aeroflot "Расчет центровки" presentations:
//   A320 8/150: DOI 54.62, cargo3 620, OA6/OB54/OC39, fuel 18000@0.785 -> ZFW index 54, TOW 44
//   A320 12/144: DOI 51, cargo 1100/1350/1600/500, OA12/OB48/OC48/OD30, fuel 10000 -> 77 / 74
const LoadsheetEngine = (() => {
    const CONST = Object.freeze({
        K: 23846,
        INDEX_OFFSET: 50,
        REF_MAC: 25,
        DEFAULT_PAX_WEIGHT: 85,
        DEFAULT_DENSITY: 0.785,
        CG_CAUTION_MAC: 27
    });

    function roundSymmetric(x) {
        const magnitude = Math.round(Math.round(Math.abs(x) * 1e6) / 1e6);
        const result = Math.sign(x) * magnitude;
        return result === 0 ? 0 : result;
    }

    // Printed cargo rows are thresholds (N - 0.5) * |kgPerIndex|; "nearest row" therefore
    // resolves to round(w / |kgPerIndex| + 0.5), except that an empty hold contributes nothing.
    function nearestRowIndex(weightKg, kgPerIndex) {
        if (weightKg <= 0) return 0;
        const n = Math.round(weightKg / Math.abs(kgPerIndex) + 0.5);
        return Math.sign(kgPerIndex) * n;
    }

    // Printed pax rows: [count, index] where the row applies from that count upwards.
    function printedCabinIndex(paxCount, spec) {
        if (!spec.table) return roundSymmetric(paxCount * spec.indexPerPax);
        let value = 0;
        for (const [count, index] of spec.table) {
            if (count > paxCount) break;
            value = index;
        }
        return value;
    }

    function indexToMac(index, weightKg) {
        return CONST.REF_MAC + (index - CONST.INDEX_OFFSET) * CONST.K / weightKg;
    }

    function macToIndex(mac, weightKg) {
        return (mac - CONST.REF_MAC) * weightKg / CONST.K + CONST.INDEX_OFFSET;
    }

    function nearestDensityColumn(density, densities) {
        let best = 0;
        for (let i = 1; i < densities.length; i++) {
            if (Math.abs(densities[i] - density) < Math.abs(densities[best] - density)) best = i;
        }
        return best;
    }

    // Returns { value, warnings }. fullKg (tank capacity at this density) may be null.
    function fuelIndex(weightKg, density, fuelTable, fullKg, mode) {
        const warnings = [];
        if (weightKg <= 0) return { value: 0, warnings };

        const col = nearestDensityColumn(density, fuelTable.densities);
        if (fuelTable.densities[col] !== density) {
            const lo = fuelTable.densities[0];
            const hi = fuelTable.densities[fuelTable.densities.length - 1];
            if (density < lo || density > hi) {
                warnings.push(`Плотность ${density} вне таблицы (${lo}–${hi}), взята колонка ${fuelTable.densities[col]}`);
            }
        }

        const points = [];
        for (const row of fuelTable.rows) {
            const v = row[col + 1];
            if (v !== null && v !== undefined) points.push([row[0], v]);
        }
        const lastRowKg = points[points.length - 1][0];
        if (fullKg !== null && fullKg > lastRowKg) points.push([fullKg, fuelTable.full[col]]);

        let kg = weightKg;
        const capacityKg = points[points.length - 1][0];
        if (kg > capacityKg) {
            warnings.push(`Топливо ${weightKg} кг больше ёмкости баков (${Math.round(capacityKg)} кг при ${fuelTable.densities[col]})`);
            kg = capacityKg;
        }
        if (kg < points[0][0]) {
            warnings.push(`Топливо ${weightKg} кг ниже первой строки таблицы (${points[0][0]} кг), индекс интерполирован от нуля`);
        }

        if (mode === 'lts') {
            let best = points[0];
            for (const p of points) {
                if (Math.abs(p[0] - kg) <= Math.abs(best[0] - kg)) best = p;
            }
            return { value: best[1], warnings };
        }

        let prev = [0, 0];
        for (const p of points) {
            if (kg <= p[0]) {
                const t = (kg - prev[0]) / (p[0] - prev[0]);
                return { value: prev[1] + t * (p[1] - prev[1]), warnings };
            }
            prev = p;
        }
        return { value: prev[1], warnings };
    }

    // THS takeoff setting from the pitch-trim scale; positive = nose up.
    function pitchTrim(mac, spec) {
        const clamped = Math.min(spec.maxMac, Math.max(spec.minMac, mac));
        return (spec.macAtZero - clamped) / spec.macPerDegree;
    }

    function formatPitchTrim(trim) {
        const magnitude = Math.round(Math.abs(trim) * 10) / 10;
        if (magnitude === 0) return '0.0';
        return (trim > 0 ? 'UP ' : 'DN ') + magnitude.toFixed(1);
    }

    function normaliseZoneKey(key) {
        return String(key).toUpperCase().replace(/^0/, 'O');
    }

    function isCount(v) { return Number.isInteger(v) && v >= 0; }
    function isWeight(v) { return Number.isFinite(v) && v >= 0; }

    function validate(input, db) {
        const errors = [];
        const aircraft = input.aircraft;
        if (!aircraft) { errors.push('Не выбран борт'); return { errors }; }

        const data = db[aircraft.config];
        if (!data || !data.cargo || !data.cabin || !data.fuel || !data.pitchTrim) {
            errors.push(`Нет данных LTS для компоновки ${aircraft.config}`);
            return { errors };
        }

        const perf = aircraft.perf && aircraft.perf[input.crew];
        if (!perf || !Number.isFinite(perf.dow) || !Number.isFinite(perf.doi)) {
            errors.push(`Нет DOW/DOI для экипажа ${input.crew}`);
        }

        const pax = {};
        for (const zone of Object.keys(data.cabin)) pax[zone] = 0;
        for (const [rawKey, value] of Object.entries(input.pax || {})) {
            const key = normaliseZoneKey(rawKey);
            if (!(key in data.cabin)) { errors.push(`Неизвестная зона салона ${rawKey}`); continue; }
            if (!isCount(value)) { errors.push(`Число пассажиров в зоне ${key} должно быть целым и ≥ 0`); continue; }
            pax[key] = value;
        }

        const cargo = {};
        for (const hold of Object.keys(data.cargo)) cargo[hold] = 0;
        for (const [rawKey, value] of Object.entries(input.cargo || {})) {
            const key = String(rawKey);
            if (!(key in data.cargo)) { errors.push(`Неизвестный грузовой отсек ${rawKey}`); continue; }
            if (!isWeight(value)) { errors.push(`Загрузка отсека ${key} должна быть числом ≥ 0`); continue; }
            cargo[key] = value;
        }

        const fuelKg = input.fuel ? input.fuel.kg : undefined;
        if (!isWeight(fuelKg)) errors.push('Топливо должно быть числом ≥ 0');
        const density = input.fuel && input.fuel.density !== undefined ? input.fuel.density : CONST.DEFAULT_DENSITY;
        if (!(Number.isFinite(density) && density > 0)) errors.push('Плотность топлива должна быть числом > 0');

        const paxWeight = input.paxWeight !== undefined ? input.paxWeight : CONST.DEFAULT_PAX_WEIGHT;
        if (!(Number.isFinite(paxWeight) && paxWeight > 0)) errors.push('Вес пассажира должен быть числом > 0');

        return { errors, data, perf, pax, cargo, fuelKg, density, paxWeight };
    }

    function computeIndices(ctx, mode) {
        const { data, perf, pax, cargo, fuelKg, density, fullKg, weights } = ctx;
        const lts = mode === 'lts';

        const doi = lts ? roundSymmetric(perf.doi) : perf.doi;

        const cargoIdx = {};
        let cargoSum = 0;
        for (const [hold, spec] of Object.entries(data.cargo)) {
            const v = lts ? nearestRowIndex(cargo[hold], spec.kgPerIndex) : cargo[hold] / spec.kgPerIndex;
            cargoIdx[hold] = v;
            cargoSum += v;
        }
        const deadLoad = doi + cargoSum;

        const cabinIdx = {};
        let cabinSum = 0;
        for (const [zone, spec] of Object.entries(data.cabin)) {
            const v = lts ? printedCabinIndex(pax[zone], spec) : pax[zone] * spec.indexPerPax;
            cabinIdx[zone] = v;
            cabinSum += v;
        }
        const zfwIndex = deadLoad + cabinSum;

        const fuel = fuelIndex(fuelKg, density, data.fuel, fullKg, mode);
        const towIndex = zfwIndex + fuel.value;
        const mac = { zfw: indexToMac(zfwIndex, weights.zfw), tow: indexToMac(towIndex, weights.tow) };

        return {
            index: { doi, cargo: cargoIdx, deadLoad, cabin: cabinIdx, zfw: zfwIndex, fuel: fuel.value, tow: towIndex },
            mac,
            stabTo: pitchTrim(mac.tow, data.pitchTrim),
            warnings: fuel.warnings
        };
    }

    function calculate(input, db) {
        const v = validate(input, db);
        if (v.errors.length) {
            return { ok: false, errors: v.errors, warnings: [], config: input.aircraft ? input.aircraft.config : null,
                     ltsVersion: null, weights: null, precise: null, lts: null, limits: null };
        }
        const { data, perf, pax, cargo, fuelKg, density, paxWeight } = v;
        const aircraft = input.aircraft;
        const warnings = [];

        const paxCount = Object.values(pax).reduce((a, b) => a + b, 0);
        const cargoWeight = Object.values(cargo).reduce((a, b) => a + b, 0);
        const payload = paxCount * paxWeight + cargoWeight;
        const zfw = perf.dow + payload;
        const tow = zfw + fuelKg;
        const weights = { dow: perf.dow, paxCount, paxWeight, paxTotal: paxCount * paxWeight, cargoWeight, payload, zfw, tow, fuel: fuelKg };

        const fullKg = Number.isFinite(aircraft.maxFuel) && aircraft.maxFuel > 0 ? aircraft.maxFuel * density : null;
        const ctx = { data, perf, pax, cargo, fuelKg, density, fullKg, weights };
        const precise = computeIndices(ctx, 'precise');
        const lts = computeIndices(ctx, 'lts');
        warnings.push(...precise.warnings);

        const zoneOver = [];
        for (const [zone, spec] of Object.entries(data.cabin)) {
            if (pax[zone] > spec.seats) { zoneOver.push(zone); warnings.push(`Зона ${zone}: ${pax[zone]} пасс. при ${spec.seats} местах`); }
        }
        const holdOver = [];
        for (const [hold, spec] of Object.entries(data.cargo)) {
            if (cargo[hold] > spec.max) { holdOver.push(hold); warnings.push(`Отсек ${hold}: ${cargo[hold]} кг при максимуме ${spec.max} кг`); }
        }

        const mtow = Number.isFinite(aircraft.mtow) ? aircraft.mtow : null;
        const limits = {
            mzfw: data.mzfw,
            mtow,
            zfwOver: data.mzfw !== null && zfw > data.mzfw,
            towOver: mtow !== null && tow > mtow,
            towCgBelow27: precise.mac.tow < CONST.CG_CAUTION_MAC,
            zoneOver,
            holdOver
        };
        if (limits.zfwOver) warnings.push(`ZFW ${zfw} кг превышает MZFW ${data.mzfw} кг`);
        if (limits.towOver) warnings.push(`TOW ${tow} кг превышает MTOW ${mtow} кг`);
        if (limits.towCgBelow27) warnings.push(`TOW CG ${precise.mac.tow.toFixed(1)}% MAC < 27%: требуется коррекция взлётных характеристик`);

        return {
            ok: true,
            errors: [],
            warnings,
            config: aircraft.config,
            ltsVersion: data.ltsVersion,
            weights,
            precise: { index: precise.index, mac: precise.mac, stabTo: precise.stabTo },
            lts: { index: lts.index, mac: lts.mac, stabTo: lts.stabTo },
            limits
        };
    }

    return { CONST, roundSymmetric, nearestRowIndex, indexToMac, macToIndex, fuelIndex, pitchTrim, formatPitchTrim, calculate };
})();

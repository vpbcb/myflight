const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const appSource = fs.readFileSync(path.resolve(__dirname, '..', 'app.js'), 'utf8');
const syncModuleStart = appSource.indexOf('// Shared MyNPA Realtime Database bootstrap and pending cloud sync.');

assert.notEqual(syncModuleStart, -1, 'MyNPA sync module should exist in app.js');
const syncModuleSource = appSource.slice(syncModuleStart);

const STORAGE_KEYS = {
    airports: 'mynpa_airports_rtdb_v1',
    references: 'mynpa_airports_reference_v1',
    approaches: 'mynpa_cloud_approaches_v1',
    pending: 'mynpa_pending_cloud_writes_v1'
};

function createHarness(initialStorage = {}) {
    const storage = new Map(
        Object.entries(initialStorage).map(([key, value]) => [key, JSON.stringify(value)])
    );
    const setCalls = [];
    const localStorage = {
        getItem: key => storage.has(key) ? storage.get(key) : null,
        setItem: (key, value) => storage.set(key, String(value)),
        removeItem: key => storage.delete(key)
    };
    const window = {
        addEventListener() {},
        dispatchEvent() {},
        npaAuth: { currentUser: { uid: 'offline-admin', email: 'admin@example.test' } },
        npaDb: {
            ref(firebasePath) {
                return {
                    async set(payload) {
                        setCalls.push({ path: firebasePath, payload });
                    },
                    async remove() {}
                };
            }
        }
    };
    const document = {
        readyState: 'loading',
        addEventListener() {},
        querySelector() { return null; },
        head: { appendChild() {} }
    };

    class TestCustomEvent {
        constructor(type, options = {}) {
            this.type = type;
            this.detail = options.detail;
        }
    }

    vm.runInNewContext(syncModuleSource, {
        window,
        document,
        navigator: { onLine: false },
        localStorage,
        CustomEvent: TestCustomEvent,
        console,
        setTimeout,
        clearTimeout,
        Promise
    });

    return {
        window,
        setCalls,
        read(key) {
            const value = storage.get(key);
            return value ? JSON.parse(value) : null;
        }
    };
}

function airport(thr1, updatedAt) {
    return {
        icao: 'UAAA',
        runways: [{ thr1, thr2: '19', rwLength: 3000 }],
        radioAids: [],
        approaches: {},
        updatedAt
    };
}

test('pending offline airport edit wins over stale Firebase reference cache', () => {
    const localAirport = airport('01', 200);
    const harness = createHarness({
        [STORAGE_KEYS.airports]: { UAAA: localAirport },
        [STORAGE_KEYS.references]: { UAAA: airport('OLD', 100) },
        [STORAGE_KEYS.approaches]: {},
        [STORAGE_KEYS.pending]: [{
            kind: 'reference',
            airportCode: 'UAAA',
            data: localAirport,
            updatedAt: 200
        }]
    });

    assert.equal(harness.window.airportsDb.UAAA.runways[0].thr1, '01');
    assert.equal(harness.read(STORAGE_KEYS.airports).UAAA.runways[0].thr1, '01');
    assert.equal(harness.read(STORAGE_KEYS.pending).length, 1);
});

test('newer local airport is not replaced by an older reference snapshot', () => {
    const harness = createHarness({
        [STORAGE_KEYS.airports]: { UAAA: airport('01', 300) },
        [STORAGE_KEYS.references]: { UAAA: airport('OLD', 100) },
        [STORAGE_KEYS.approaches]: {},
        [STORAGE_KEYS.pending]: []
    });

    assert.equal(harness.window.airportsDb.UAAA.runways[0].thr1, '01');
    assert.equal(harness.window.airportsDb.UAAA.updatedAt, 300);
});

test('cloud write carries updatedAt and refreshes the persisted reference snapshot', async () => {
    const harness = createHarness({
        [STORAGE_KEYS.airports]: {},
        [STORAGE_KEYS.references]: {},
        [STORAGE_KEYS.approaches]: {},
        [STORAGE_KEYS.pending]: []
    });

    await harness.window.MyFlightNpaSync.writeAirportReference('UAAA', airport('01', 400));

    assert.equal(harness.setCalls.length, 1);
    assert.equal(harness.setCalls[0].path, 'airportsReference/UAAA');
    assert.equal(harness.setCalls[0].payload.updatedAt, 400);
    assert.equal(harness.read(STORAGE_KEYS.references).UAAA.updatedAt, 400);
});

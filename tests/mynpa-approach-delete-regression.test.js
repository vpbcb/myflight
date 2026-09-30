const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const appSource = fs.readFileSync(path.resolve(__dirname, '..', 'app.js'), 'utf8');
const mynpaSource = fs.readFileSync(path.resolve(__dirname, '..', 'mynpa.html'), 'utf8');
const syncModuleSource = appSource.slice(appSource.indexOf('// Shared MyNPA Realtime Database bootstrap and pending cloud sync.'));

const STORAGE_KEYS = {
    airports: 'mynpa_airports_rtdb_v1',
    references: 'mynpa_airports_reference_v1',
    approaches: 'mynpa_cloud_approaches_v1',
    pending: 'mynpa_pending_cloud_writes_v1'
};

function createHarness(initialStorage, { online = false } = {}) {
    const storage = new Map(
        Object.entries(initialStorage).map(([key, value]) => [key, JSON.stringify(value)])
    );
    const removeCalls = [];
    const window = {
        addEventListener() {},
        dispatchEvent() {},
        npaAuth: { currentUser: { uid: 'admin', email: 'admin@example.test' } },
        npaDb: {
            ref(firebasePath) {
                return {
                    async set() {},
                    async remove() { removeCalls.push(firebasePath); }
                };
            }
        }
    };
    vm.runInNewContext(syncModuleSource, {
        window,
        document: { readyState: 'loading', addEventListener() {}, querySelector() { return null; }, head: { appendChild() {} } },
        location: { pathname: '/myflight/mynpa.html' },
        navigator: { onLine: online },
        localStorage: {
            getItem: key => storage.has(key) ? storage.get(key) : null,
            setItem: (key, value) => storage.set(key, String(value)),
            removeItem: key => storage.delete(key)
        },
        CustomEvent: class { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } },
        console,
        setTimeout,
        clearTimeout,
        Promise
    });
    return {
        window,
        removeCalls,
        read: key => JSON.parse(storage.get(key) || 'null')
    };
}

const airport = approaches => ({ icao: 'URKK', runways: [], radioAids: [], approaches, updatedAt: 100 });

test('pending approach delete hides the approach despite a stale cloud cache', () => {
    const harness = createHarness({
        [STORAGE_KEYS.airports]: { URKK: airport({}) },
        [STORAGE_KEYS.references]: {},
        [STORAGE_KEYS.approaches]: { URKK: { approaches: { VORy23L: { name: 'VORy23L' }, NDBy05R: { name: 'NDBy05R' } } } },
        [STORAGE_KEYS.pending]: [{ kind: 'deleteApproach', airportCode: 'URKK', approachName: 'VORy23L', updatedAt: 200 }]
    });

    assert.deepEqual(Object.keys(harness.window.airportsDb.URKK.approaches), ['NDBy05R']);
});

test('queued delete replaces a queued save of the same approach (and vice versa)', () => {
    const harness = createHarness({
        [STORAGE_KEYS.airports]: {}, [STORAGE_KEYS.references]: {}, [STORAGE_KEYS.approaches]: {},
        [STORAGE_KEYS.pending]: []
    });
    const sync = harness.window.MyFlightNpaSync;

    sync.queueCloudWrite({ kind: 'approach', airportCode: 'URKK', approachName: 'VORy23L', data: { name: 'VORy23L' } });
    sync.queueCloudWrite({ kind: 'deleteApproach', airportCode: 'URKK', approachName: 'VORy23L' });
    assert.deepEqual(harness.read(STORAGE_KEYS.pending).map(item => item.kind), ['deleteApproach']);

    sync.queueCloudWrite({ kind: 'approach', airportCode: 'URKK', approachName: 'VORy23L', data: { name: 'VORy23L' } });
    assert.deepEqual(harness.read(STORAGE_KEYS.pending).map(item => item.kind), ['approach']);
});

test('admin sync removes the approach node from Firebase and from the cloud cache', async () => {
    const harness = createHarness({
        [STORAGE_KEYS.airports]: { URKK: airport({}) },
        [STORAGE_KEYS.references]: {},
        [STORAGE_KEYS.approaches]: { URKK: { approaches: { VORy23L: { name: 'VORy23L' } } } },
        [STORAGE_KEYS.pending]: [{ kind: 'deleteApproach', airportCode: 'URKK', approachName: 'VORy23L', updatedAt: 200 }]
    }, { online: true });

    assert.equal(await harness.window.MyFlightNpaSync.syncPending(), true);
    assert.deepEqual(harness.removeCalls, ['airportsNpa/URKK/approaches/VORy23L']);
    assert.deepEqual(harness.read(STORAGE_KEYS.approaches).URKK.approaches, {});
    assert.deepEqual(harness.read(STORAGE_KEYS.pending), []);
});

test('approach deleted in the cloud is also removed from the local db on other devices', () => {
    assert.match(appSource, /removeLocalApproachesDeletedInCloud\(readJsonStorage\(NPA_CLOUD_APPROACHES_KEY, \{\}\), nextCloudApproaches\)/);
});

test('MyNpa: long tap on an approach option opens the delete confirm; admin also queues a cloud delete', () => {
    assert.match(mynpaSource, /if \(extraClass !== 'add-new-appr'\) attachNpaApproachOptionLongPress\(btn\)/);
    assert.match(mynpaSource, /openNpaApproachDeleteConfirm\(btn\.dataset\.type\)/);
    assert.match(mynpaSource, /if \(isNpaAdminMode\(\)\) \{\s*window\.queueNpaCloudWrite\?\.\(\{\s*kind: 'deleteApproach'/);
    // Удалён выбранный заход — выбор сбрасывается
    assert.match(mynpaSource, /getSelectedNpaType\(\) === approachName\) \{[\s\S]*?setSelectedNpaType\(""\);\s*clearNpaFields\(\);/);
    assert.match(mynpaSource, /\.npa-approach-option \{\s*-webkit-user-select: none;\s*user-select: none;\s*-webkit-touch-callout: none;/);
});

test('MyNpa: ICAO field (long tap opens the airport card) does not select text outside of typing', () => {
    assert.match(mynpaSource, /#apprName:not\(:focus\) \{\s*-webkit-user-select: none !important;\s*user-select: none !important;\s*-webkit-touch-callout: none;/);
    assert.match(mynpaSource, /field\.addEventListener\('selectstart', event => \{\s*if \(document\.activeElement !== input\) event\.preventDefault\(\);/);
});

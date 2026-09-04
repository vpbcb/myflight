const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const projectRoot = path.join(__dirname, '..');
const databaseSource = fs.readFileSync(path.join(projectRoot, 'dbaircraft.js'), 'utf8');
const context = {};

vm.runInNewContext(
    databaseSource + '\nglobalThis.aircraftDBForTest = aircraftDB;',
    context
);

const aircraftByReg = new Map(
    context.aircraftDBForTest.map(aircraft => [aircraft.reg, aircraft])
);

function plain(value) {
    return JSON.parse(JSON.stringify(value));
}

assert.deepStrictEqual(
    plain(aircraftByReg.get('73161')),
    {
        ...plain(aircraftByReg.get('73161')),
        dow: 49649,
        perf: {
            '2/6': { dow: 49649, doi: 40.39 },
            '2/5': { dow: 49574, doi: 41.57 },
            '3/5': { dow: 49654, doi: 40.19 },
            '3/6': { dow: 49729, doi: 39.01 }
        }
    },
    'RA-73161 must use the fleet weights effective on 2026-08-20'
);

assert.deepStrictEqual(
    plain(aircraftByReg.get('73714')),
    {
        ...plain(aircraftByReg.get('73714')),
        dow: 50096,
        perf: {
            '2/6': { dow: 50096, doi: 37.70 },
            '2/5': { dow: 50021, doi: 38.88 },
            '3/5': { dow: 50101, doi: 37.50 },
            '3/6': { dow: 50176, doi: 36.32 }
        }
    },
    'RA-73714 must use the current fleet weights'
);

const serviceWorkerSource = fs.readFileSync(path.join(projectRoot, 'sw.js'), 'utf8');
assert.match(
    serviceWorkerSource,
    /const CACHE_NAME = 'myflight_v\.260904-5';/,
    'the PWA cache must be bumped for the aircraft database update'
);

console.log('Aircraft database values and cache version are current.');

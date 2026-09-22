const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const projectRoot = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(projectRoot, name), 'utf8');
const indexHtml = read('index.html');
const myfuelHtml = read('myfuel.html');

function extractFunction(source, name) {
    const start = source.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `${name}() must exist`);
    let depth = 0;
    for (let i = source.indexOf('{', start); i < source.length; i += 1) {
        if (source[i] === '{') depth += 1;
        if (source[i] === '}') {
            depth -= 1;
            if (depth === 0) return source.slice(start, i + 1);
        }
    }
    throw new Error(`${name}() body was not closed`);
}

function fakeStorage() {
    const values = new Map();
    return {
        getItem: key => (values.has(key) ? values.get(key) : null),
        setItem: (key, value) => values.set(key, String(value)),
        removeItem: key => values.delete(key)
    };
}

function loadMyLoadContext(localStorage, crewOptions = ['2/4', '2/5', '3/4', '3/5']) {
    const crewSelect = { value: '', options: crewOptions.map(value => ({ value })) };
    const acSearch = { value: '' };
    const selected = [];
    const context = {
        localStorage,
        aircraftDB: [{ reg: '73753', regFull: 'RA-73753', type: 'A320', config: '8/150' }],
        document: { getElementById: id => (id === 'crew' ? crewSelect : id === 'acSearch' ? acSearch : null) },
        selectAircraft: ac => selected.push(ac),
        calculateAll: () => {},
        saveFormData: () => {},
        lastHomeContext: null
    };
    vm.createContext(context);
    vm.runInContext(
        `const HOME_AC_KEY = 'myflight_selected_ac_reg';
         const HOME_CREW_KEY = 'myflight_info_crew_config';
         ${extractFunction(myfuelHtml, 'readHomeContext')}
         ${extractFunction(myfuelHtml, 'applyHomeContext')}`,
        context
    );
    return { context, crewSelect, acSearch, selected };
}

test('the home page stores the resolved registration for MyLoad', () => {
    assert.match(indexHtml, /const SELECTED_AC_STORAGE_KEY = 'myflight_selected_ac_reg';/);
    const storage = fakeStorage();
    const context = { localStorage: storage, SELECTED_AC_STORAGE_KEY: 'myflight_selected_ac_reg' };
    vm.createContext(context);
    vm.runInContext(extractFunction(indexHtml, 'saveSelectedAircraftReg'), context);

    context.saveSelectedAircraftReg('73753');
    assert.equal(storage.getItem('myflight_selected_ac_reg'), '73753');
    context.saveSelectedAircraftReg('');
    assert.equal(storage.getItem('myflight_selected_ac_reg'), null);
});

test('MyLoad pulls the aircraft and crew chosen on the home page', () => {
    const storage = fakeStorage();
    storage.setItem('myflight_selected_ac_reg', '73753');
    storage.setItem('myflight_info_crew_config', '2/5');

    const { context, crewSelect, acSearch, selected } = loadMyLoadContext(storage);
    context.applyHomeContext();

    assert.equal(selected.length, 1);
    assert.equal(selected[0].reg, '73753');
    assert.equal(acSearch.value, 'RA-73753');
    assert.equal(crewSelect.value, '2/5');
});

test('MyLoad keeps its own choice until the home page changes again', () => {
    const storage = fakeStorage();
    storage.setItem('myflight_selected_ac_reg', '73753');
    storage.setItem('myflight_info_crew_config', '2/5');

    const { context, crewSelect, selected } = loadMyLoadContext(storage);
    context.applyHomeContext();

    // Локальная правка в MyLoad переживает повторное открытие страницы.
    crewSelect.value = '3/5';
    context.applyHomeContext();
    assert.equal(selected.length, 1);
    assert.equal(crewSelect.value, '3/5');

    // Новый выбор на главной снова подтягивается.
    storage.setItem('myflight_info_crew_config', '3/4');
    context.applyHomeContext();
    assert.equal(selected.length, 2);
    assert.equal(crewSelect.value, '3/4');
});

test('MyLoad never writes the home page keys', () => {
    const start = myfuelHtml.indexOf('function applyHomeContext');
    const end = myfuelHtml.indexOf('function saveFormData');
    const between = myfuelHtml.slice(start, end);
    assert.doesNotMatch(between, /setItem\((?:HOME_AC_KEY|HOME_CREW_KEY)/);
    assert.doesNotMatch(myfuelHtml, /setItem\('myflight_selected_ac_reg'|setItem\('myflight_info_crew_config'/);
});

test('an unknown or missing registration leaves MyLoad untouched', () => {
    const empty = fakeStorage();
    const first = loadMyLoadContext(empty);
    first.context.applyHomeContext();
    assert.equal(first.selected.length, 0);

    const unknown = fakeStorage();
    unknown.setItem('myflight_selected_ac_reg', '00000');
    const second = loadMyLoadContext(unknown);
    second.context.applyHomeContext();
    assert.equal(second.selected.length, 0);
});

test('a crew value the aircraft does not offer is ignored', () => {
    const storage = fakeStorage();
    storage.setItem('myflight_selected_ac_reg', '73753');
    storage.setItem('myflight_info_crew_config', '2/6');

    const { context, crewSelect, selected } = loadMyLoadContext(storage);
    context.applyHomeContext();

    assert.equal(selected.length, 1);
    assert.equal(crewSelect.value, '');
});

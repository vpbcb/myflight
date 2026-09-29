const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const myPathHtml = fs.readFileSync(path.resolve(__dirname, '..', 'mypath.html'), 'utf8');

function functionSource(name) {
    const start = myPathHtml.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `${name} should exist`);
    const openBrace = myPathHtml.indexOf('{', start);
    let depth = 0;

    for (let index = openBrace; index < myPathHtml.length; index += 1) {
        if (myPathHtml[index] === '{') depth += 1;
        if (myPathHtml[index] === '}') depth -= 1;
        if (depth === 0) return myPathHtml.slice(start, index + 1);
    }

    assert.fail(`${name} should have a closing brace`);
}

function loadCopyReader(storage) {
    const constants = myPathHtml.match(/const MYNPA_PAGE_STATE_KEY = [^\n]+\n\s*const MYNPA_AIRPORTS_DB_KEY = [^\n]+/)[0];
    const context = {
        localStorage: { getItem: key => (key in storage ? storage[key] : null) }
    };
    vm.createContext(context);
    vm.runInContext([
        constants,
        functionSource('readMyNpaJson'),
        functionSource('getMyNpaNumber'),
        functionSource('getMyNpaSavedApproachForCopy'),
        'this.read = getMyNpaSavedApproachForCopy;'
    ].join('\n'), context);
    return context.read;
}

const airportsDb = {
    UUEE: {
        runways: [{ thr1: '06R', thr1Elev: '-12 ft', thr2: '24L', thr2Elev: '630 ft' }],
        approaches: {
            VORz24L: { threshold: '24L', gpa: '3.0', fdp: '2500', fap: '2000', fapMode: 'alt', elevation: '600' },
            VORy24L: { threshold: '24L', gpa: '3.0', fdp: '', fap: '2000', fapMode: 'alt' },
            NDB24L: { gpa: '3.2', fdp: '6.5', fap: '5.0', fapMode: 'dist' }
        }
    }
};

function storageFor(selectedType) {
    return {
        mynpa_current_page_state_v1: JSON.stringify({ fields: { apprName: 'UUEE' }, selectedType }),
        mynpa_airports_rtdb_v1: JSON.stringify(airportsDb)
    };
}

test('MyPath left button: NEW APPR on top, COPY MYNPA (long tap) line hidden until MyNpa has an approach', () => {
    assert.doesNotMatch(myPathHtml, /Start here|apprStarted/);
    assert.match(myPathHtml, /<span id="startBtnText">NEW APPR<\/span><em class="bottom-action-hint start-appr-short-hint">\(short tap\)<\/em><\/span>\s*<span class="start-appr-copy" id="copyMyNpaLine" hidden>COPY MYNPA<em class="bottom-action-hint">\(long tap\)<\/em><\/span>/);
    assert.match(myPathHtml, /#startApprBtn:not\(\.has-copy\) \.start-appr-short-hint \{\s*display: none;/);
    assert.match(myPathHtml, /#startApprBtn\.has-copy \.start-appr-label \{\s*font-size: 0\.5rem;/);
    assert.match(myPathHtml, /#startApprBtn \.bottom-action-hint \{[^}]*font-weight: 400;[^}]*opacity: 0\.6;/);
    const update = functionSource('updateCopyMyNpaLine');
    assert.match(update, /line\.hidden = !available;\s*button\.classList\.toggle\('has-copy', available\);/);
});

test('MyPath left button: short tap starts NEW APPR, long tap copies from MyNpa and suppresses the click', () => {
    const init = functionSource('initStartApprButton');
    assert.match(init, /if \(document\.getElementById\('copyMyNpaLine'\)\?\.hidden\) return;/);
    assert.match(init, /longPressHandled = true;\s*if \(copyFromMyNpa\(\)/);
    assert.match(init, /if \(longPressHandled\) \{\s*longPressHandled = false;\s*return;\s*\}\s*resetFields\(\);/);
    assert.match(init, /window\.addEventListener\('pageshow', updateCopyMyNpaLine\);/);
    assert.match(myPathHtml, /initStartApprButton\(\);/);
    const copy = functionSource('copyFromMyNpa');
    assert.match(copy, /getElementById\('angleInput'\)\.value = `\$\{Number\(data\.angle\)\.toFixed\(1\)\}°`/);
    assert.match(copy, /calculate\(\);/);
});

test('MyPath copies the saved MyNpa approach: landing THR elevation, GPA and ALT FDP/FAP', () => {
    const read = loadCopyReader(storageFor('VORz24L'));
    assert.deepEqual({ ...read() }, { elev: 630, angle: 3, copyFdpFap: true, fdp: 2500, fap: 2000 });
});

test('MyPath copies an empty FDP/FAP of the saved approach too, clearing the MyPath field', () => {
    const onlyFap = loadCopyReader(storageFor('VORy24L'))();
    assert.deepEqual({ ...onlyFap }, { elev: 630, angle: 3, copyFdpFap: true, fdp: '', fap: 2000 });
    const copy = functionSource('copyFromMyNpa');
    assert.match(copy, /if \(data\.copyFdpFap\) \{\s*document\.getElementById\('fdp'\)\.value = data\.fdp === '' \? '' : String\(Math\.round\(data\.fdp\)\);\s*document\.getElementById\('fap'\)\.value = data\.fap === '' \? '' : String\(Math\.round\(data\.fap\)\);/);
});

test('MyPath does not copy FDP/FAP of a DIST approach and hides the line without a selected approach', () => {
    const dist = loadCopyReader(storageFor('NDB24L'))();
    assert.deepEqual({ ...dist }, { elev: 630, angle: 3.2, copyFdpFap: false, fdp: '', fap: '' });
    assert.equal(loadCopyReader(storageFor(''))(), null);
    assert.equal(loadCopyReader(storageFor('ILS06R'))(), null);
    assert.equal(loadCopyReader({})(), null);
});

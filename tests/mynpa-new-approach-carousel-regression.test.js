const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const myNpaHtml = fs.readFileSync(path.resolve(__dirname, '..', 'mynpa.html'), 'utf8');

function functionBody(name) {
    const start = myNpaHtml.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `${name} should exist`);
    const openBrace = myNpaHtml.indexOf('{', start);
    let depth = 0;

    for (let index = openBrace; index < myNpaHtml.length; index += 1) {
        if (myNpaHtml[index] === '{') depth += 1;
        if (myNpaHtml[index] === '}') depth -= 1;
        if (depth === 0) return myNpaHtml.slice(openBrace + 1, index);
    }

    assert.fail(`${name} should have a closing brace`);
}

test('new approach carousel continues from FAP through Racetrack fields', () => {
    assert.match(
        myNpaHtml,
        /const NEW_APPROACH_CAROUSEL_STEPS = Object\.freeze\(\['gpa', 'fdp', 'fap', 'downwindRadioFixShift', 'racetrack', 'inboundCrs', 'downwindTime', 'gsAppr'\]\);/
    );
    const advance = functionBody('advanceNewApproachCarousel');
    assert.match(advance, /completedField === 'downwindTime' && getTextOrBlank\('downwindTime'\) !== ""/);
    assert.match(advance, /openRadioAidShiftModal\(\)/);
    assert.match(advance, /setTimeout\(\(\) => openNpaKeypad\(nextField\), 0\)/);
});

test('Racetrack carousel step opens an explicit Left or Right choice modal', () => {
    assert.match(functionBody('selectRadioAidShift'), /newApproachCarouselStep === 'downwindRadioFixShift'[\s\S]*advanceNewApproachCarousel\('downwindRadioFixShift'\)/);
    assert.match(functionBody('advanceNewApproachCarousel'), /nextField === 'racetrack'[\s\S]*openRacetrackChoiceModal\(\)/);
    assert.match(myNpaHtml, /id="racetrackChoiceModal"[\s\S]*class="modal-options racetrack-choice-options"[\s\S]*selectRacetrackChoice\('Left'\)[\s\S]*selectRacetrackChoice\('Right'\)/);
    assert.match(myNpaHtml, /\.racetrack-choice-options\s*\{[^}]*flex-direction:\s*row;/);
    assert.match(myNpaHtml, /\.racetrack-choice-options \.modal-opt-btn\s*\{[^}]*flex:\s*1 1 0;/);
    assert.match(functionBody('selectRacetrackChoice'), /value === 'Left' \? 'Left' : 'Right'/);
    assert.match(functionBody('selectRacetrackChoice'), /newApproachCarouselStep === 'racetrack'[\s\S]*advanceNewApproachCarousel\('racetrack'\)/);
    assert.match(functionBody('closeNpaKeypad'), /NEW_APPROACH_CAROUSEL_STEPS\.includes\(activeNpaField\)/);
});

test('empty manual Racetrack NAV aid input returns to aid selection', () => {
    assert.match(myNpaHtml, /id="keypadClearBtn"[^>]*onclick="kpPress\('clear'\)"[^>]*>CLR<\/button>/);
    assert.match(myNpaHtml, /downwindRadioFixShift:\s*'NAV AID SHIFT FROM LAND THR'/);
    const clearButton = functionBody('updateNpaKeypadClearButton');
    assert.match(clearButton, /activeNpaField === 'downwindRadioFixShift'[\s\S]*currentKpVal === ""[\s\S]*shouldShowBack \? 'Back' : 'CLR'/);
    assert.doesNotMatch(clearButton, /newApproachCarousel/);
    const keypadPress = functionBody('kpPress');
    assert.match(keypadPress, /key === 'clear'[\s\S]*activeNpaField === 'downwindRadioFixShift'[\s\S]*currentKpVal === ""[\s\S]*openRadioAidShiftModal\(\)/);
    assert.doesNotMatch(keypadPress.slice(0, keypadPress.indexOf("currentKpVal = \"\";")), /newApproachCarousel/);
});

test('Radio Aid Shift explains the Racetrack navigation aid choice', () => {
    assert.match(myNpaHtml, /<div class="radio-aid-shift-hint"><em>\(Радиосредство, от которого строится ипподром, или ввести дальность этого радиосредства от торца ВПП\)<\/em><\/div>/);
    assert.match(myNpaHtml, /\.radio-aid-shift-hint\s*\{[^}]*font-style:\s*italic;[^}]*font-weight:\s*400;/);
});

test('edit mode unlock responds after 0.8 seconds and uses the MyWind RWY toast timing', () => {
    assert.match(myNpaHtml, /const NPA_EDIT_UNLOCK_HOLD_MS = 800;/);
    assert.match(myNpaHtml, /const NPA_EDIT_TOAST_FADE_MS = 700;/);
    const toastBody = functionBody('showNpaEditModeToast');
    assert.match(toastBody, /toast\.style\.transition = `opacity \$\{NPA_EDIT_TOAST_FADE_MS\}ms ease-out`;/);
    assert.match(toastBody, /toast\.style\.transition = `opacity \$\{NPA_EDIT_TOAST_FADE_MS\}ms ease-in`;/);
    assert.match(toastBody, /}, NPA_EDIT_TOAST_FADE_MS\);/);
});

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const myPathHtml = fs.readFileSync(path.resolve(__dirname, '..', 'mypath.html'), 'utf8');

function functionBody(name) {
    const start = myPathHtml.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `${name} should exist`);
    const openBrace = myPathHtml.indexOf('{', start);
    let depth = 0;

    for (let index = openBrace; index < myPathHtml.length; index += 1) {
        if (myPathHtml[index] === '{') depth += 1;
        if (myPathHtml[index] === '}') depth -= 1;
        if (depth === 0) return myPathHtml.slice(openBrace + 1, index);
    }

    assert.fail(`${name} should have a closing brace`);
}

test('SHIFT button maps long press to editing and short tap to toggling', () => {
    assert.match(myPathHtml, /id="shiftBtn"[^>]*onpointerdown="startPressShift\(event\)"/);
    assert.match(myPathHtml, /id="shiftBtn"[^>]*onpointercancel="cancelPressShift\(\)"/);
    assert.match(myPathHtml, /id="shiftBtn"[^>]*onclick="clickShift\(event\)"/);
    assert.match(myPathHtml, /const PATH_SHIFT_HOLD_MS\s*=\s*300\s*;/);
    assert.match(functionBody('startPressShift'), /setTimeout\([\s\S]*openKeypad\('pathShiftInput',\s*'PATH SHIFT'\)[\s\S]*PATH_SHIFT_HOLD_MS/);
    assert.match(functionBody('clickShift'), /isShiftLongPress[\s\S]*togglePathShiftActive\(\)/);
});

test('calculation applies only an active configured shift', () => {
    assert.match(functionBody('togglePathShiftActive'), /configuredPathShift\s*===\s*0[\s\S]*showMissingPathShiftToast\(\)/);
    assert.match(functionBody('togglePathShiftActive'), /isPathShiftActive\s*=\s*!isPathShiftActive[\s\S]*calculate\(/);
    assert.match(functionBody('calculate'), /const pathShift\s*=\s*isPathShiftActive\s*\?\s*configuredPathShift\s*:\s*0\s*;/);
    assert.match(functionBody('calculate'), /classList\.toggle\('active-shift',\s*isPathShiftActive\)/);
});

test('missing-value toast stays visible twice as long without slower fades', () => {
    assert.match(myPathHtml, /id="shiftValueToast"[^>]*>\s*INSERT SHIFT VALUE\. LONG TAP ON BUTTON/);
    assert.match(myPathHtml, /const PATH_SHIFT_TOAST_FADE_MS\s*=\s*700\s*;/);
    assert.match(myPathHtml, /const PATH_SHIFT_TOAST_HOLD_MS\s*=\s*1400\s*;/);
    const toastBody = functionBody('showMissingPathShiftToast');
    assert.match(toastBody, /opacity \$\{PATH_SHIFT_TOAST_FADE_MS\}ms ease-out/);
    assert.match(toastBody, /opacity \$\{PATH_SHIFT_TOAST_FADE_MS\}ms ease-in/);
    assert.match(toastBody, /},\s*PATH_SHIFT_TOAST_FADE_MS\s*\);/);
    assert.match(toastBody, /},\s*PATH_SHIFT_TOAST_FADE_MS\s*\+\s*PATH_SHIFT_TOAST_HOLD_MS\s*\);/);
});

test('shift active state persists, migrates, and resets with a new approach', () => {
    assert.match(functionBody('saveAppState'), /pathShiftActive:\s*isPathShiftActive/);
    assert.match(functionBody('loadAppState'), /state\.pathShiftActive/);
    assert.match(functionBody('loadAppState'), /getConfiguredPathShift\(\)\s*!==\s*0/);
    assert.match(functionBody('resetFields'), /isPathShiftActive\s*=\s*false/);
});

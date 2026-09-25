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

test('NEW APPR sequence skips temperature after FAP', () => {
    const closeKeypad = functionBody('closeKeypad');
    assert.doesNotMatch(closeKeypad, /activeKp\.id === 'fap'[\s\S]{0,180}openKeypad\('temp', 'TEMPERATURE'\)/);
    assert.match(closeKeypad, /activeKp\.id === 'fap'[\s\S]{0,360}isSequentialFlow = false;[\s\S]{0,360}angleMenu\.style\.display = 'block';/);
});

test('temperature remains manually editable', () => {
    assert.match(myPathHtml, /id="temp"[\s\S]{0,300}onclick="openKeypad\('temp', 'TEMPERATURE'\)"/);
});

test('NEW APPR carousel resets OAT to +15', () => {
    const reset = functionBody('resetFields');
    assert.match(reset, /document\.getElementById\('temp'\)\.value = "15";\s*isNeg = false;\s*document\.getElementById\('signBtn'\)\.innerText = '\+';/);
    assert.ok(reset.indexOf("getElementById('temp').value") < reset.indexOf('calculate();'));
});

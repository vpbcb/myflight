const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const indexHtml = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

test('Push toggle shows the long-tap hint in every state', () => {
    assert.match(
        indexHtml,
        /id="pushToggleBtn"[^>]*>Push Off \(long tap\)<\/button>/
    );

    const stateStart = indexHtml.indexOf('function setMyFlightPushButtonState');
    const stateEnd = indexHtml.indexOf('async function getMyFlightPushRegistration', stateStart);
    assert.notEqual(stateStart, -1, 'setMyFlightPushButtonState() must exist');
    assert.notEqual(stateEnd, -1, 'button state function boundary must exist');

    const buttonStateBody = indexHtml.slice(stateStart, stateEnd);
    assert.match(buttonStateBody, /'Push On \(long tap\)'/);
    assert.match(buttonStateBody, /'Push Off \(long tap\)'/);
});

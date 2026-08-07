const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const indexHtml = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

function functionBody(name) {
    const start = indexHtml.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `${name}() must exist`);
    const openBrace = indexHtml.indexOf('{', start);
    let depth = 0;

    for (let index = openBrace; index < indexHtml.length; index += 1) {
        if (indexHtml[index] === '{') depth += 1;
        if (indexHtml[index] === '}') depth -= 1;
        if (depth === 0) return indexHtml.slice(openBrace + 1, index);
    }

    assert.fail(`${name}() must have a closing brace`);
}

test('home footer keeps Refresh and replaces Theme and Mail with Settings', () => {
    const footerStart = indexHtml.indexOf('<div class="bottom-controls">');
    const settingsModalStart = indexHtml.indexOf('<div id="settingsModal"');
    assert.notEqual(footerStart, -1);
    assert.ok(settingsModalStart > footerStart);

    const homeControls = indexHtml.slice(footerStart, settingsModalStart);
    assert.match(homeControls, /id="refreshBtn"/);
    assert.match(homeControls, /id="settingsToggleBtn"[^>]*onclick="openSettingsModal\(\)"/);
    assert.doesNotMatch(homeControls, /id="themeToggleBtn"|id="btnMail"|id="pushToggleBtn"/);
});

test('Settings modal contains Theme, Awake, Push, Mail and Update in order', () => {
    const settingsStart = indexHtml.indexOf('<div id="settingsModal"');
    const settingsEnd = indexHtml.indexOf('<div id="notesKeypadModal"', settingsStart);
    assert.notEqual(settingsStart, -1);
    assert.ok(settingsEnd > settingsStart);

    const settings = indexHtml.slice(settingsStart, settingsEnd);
    const ids = ['themeToggleBtn', 'awakeToggleBtn', 'pushToggleBtn', 'btnMail', 'updateAppBtn'];
    let previousPosition = -1;
    ids.forEach(id => {
        const position = settings.indexOf(`id="${id}"`);
        assert.ok(position > previousPosition, `${id} must be in Settings order`);
        previousPosition = position;
    });
    assert.match(settings, /class="modal-close-btn"[^>]*onclick="closeSettingsModal\(\)"/);
    assert.match(settings, /id="updateAppBtn"[^>]*onclick="hardResetApp\(\)"/);
});

test('Settings actions form two centered rows of equal tiles', () => {
    assert.match(
        indexHtml,
        /\.settings-actions\s*\{[\s\S]*display:\s*grid;[\s\S]*grid-template-columns:\s*repeat\(6,\s*minmax\(0,\s*1fr\)\);/
    );
    assert.match(
        indexHtml,
        /\.settings-actions\s*>\s*button\s*\{[\s\S]*grid-column:\s*span\s+2;/
    );
    assert.match(indexHtml, /\.settings-actions\s*>\s*#btnMail\s*\{[\s\S]*grid-column:\s*2\s*\/\s*span\s+2;/);
    assert.match(indexHtml, /\.settings-actions\s*>\s*#updateAppBtn\s*\{[\s\S]*grid-column:\s*4\s*\/\s*span\s+2;/);
    assert.match(
        indexHtml,
        /\.settings-action-btn,\s*\n\s*\.push-toggle-card\s*\{[\s\S]*height:\s*82px;[\s\S]*flex-direction:\s*column;/
    );

    const settingsStart = indexHtml.indexOf('<div id="settingsModal"');
    const settingsEnd = indexHtml.indexOf('<div id="notesKeypadModal"', settingsStart);
    const settings = indexHtml.slice(settingsStart, settingsEnd);
    assert.match(settings, /id="pushToggleBtn"[\s\S]*<svg[\s\S]*<span id="pushText">Push Off<\/span>[\s\S]*<\/button>/);

    const stateBody = functionBody('setMyFlightPushButtonState');
    assert.match(stateBody, /getElementById\('pushText'\)/);
    assert.match(stateBody, /pushText\.textContent\s*=\s*myFlightPushEnabled\s*\?\s*'Push On'\s*:\s*'Push Off'/);
    assert.doesNotMatch(stateBody, /button\.textContent/);
});

test('Settings closes from its backdrop and Mail transitions to the mail modal', () => {
    assert.match(indexHtml, /id="settingsModal"[^>]*onclick="closeSettingsModal\(event\)"/);
    assert.match(functionBody('openSettingsModal'), /classList\.add\('show'\)/);
    assert.match(functionBody('closeSettingsModal'), /classList\.remove\('show'\)/);

    const mailBody = functionBody('openMailFromSettings');
    assert.match(mailBody, /closeSettingsModal\(\)/);
    assert.match(mailBody, /openMailModal\(\)/);
});

test('home Refresh only opens field clearing while Update app owns hard reset', () => {
    const refreshBody = functionBody('bindRefreshControls');
    assert.match(refreshBody, /addEventListener\('click'/);
    assert.match(refreshBody, /openClearDataModal\(\)/);
    assert.doesNotMatch(refreshBody, /hardResetApp|touchstart|mousedown|setTimeout/);

    assert.match(indexHtml, /id="updateAppBtn"[^>]*onclick="hardResetApp\(\)"/);
});

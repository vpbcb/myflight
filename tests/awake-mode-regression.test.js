const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const appJs = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function extractFunctionBody(source, name) {
    const functionMarker = `function ${name}(`;
    const arrowMarker = `const ${name} =`;
    let start = source.indexOf(functionMarker);
    if (start === -1) start = source.indexOf(arrowMarker);
    assert.notStrictEqual(start, -1, `${name}() must exist`);
    const openBrace = source.indexOf('{', start);
    assert.notStrictEqual(openBrace, -1, `${name}() must have a body`);

    let depth = 0;
    for (let i = openBrace; i < source.length; i++) {
        if (source[i] === '{') depth++;
        if (source[i] === '}') depth--;
        if (depth === 0) return source.slice(openBrace + 1, i);
    }

    throw new Error(`${name}() body was not closed`);
}

function test(name, fn) {
    try {
        fn();
        console.log(`PASS ${name}`);
    } catch (error) {
        console.error(`FAIL ${name}`);
        console.error(error.message);
        process.exitCode = 1;
    }
}

test('legacy iOS PWA does not report false native wake lock support', () => {
    const canUseBody = extractFunctionBody(appJs, 'canUseNativeWakeLock');
    assert.match(canUseBody, /return\s+hasNativeWakeLock\(\)\s*&&\s*!isLegacyIosPwa\(\)\s*;/);

    const requestNativeBody = extractFunctionBody(appJs, 'requestNativeWakeLock');
    assert.match(requestNativeBody, /isLegacyIosPwa\(\)/);

    const requestWakeBody = extractFunctionBody(appJs, 'requestWakeLock');
    assert.match(requestWakeBody, /error:\s*'Screen wake lock is unavailable'/);
    assert.match(appJs, /fallbackSupported:\s*false/);
    assert.doesNotMatch(appJs + indexHtml, /NoSleep|createElement\(['"]video|data:video|playsInline|playsinline/);
});

test('separate Awake button requests wake lock on an ordinary click', () => {
    const bindBody = extractFunctionBody(indexHtml, 'bindAwakeButtonControls');
    assert.match(indexHtml, /id=["']awakeToggleBtn["']/);
    assert.match(bindBody, /addEventListener\(['"]click['"],\s*toggleAwakeFromAwakeButton\s*\)/);
    assert.doesNotMatch(bindBody, /touchstart|mousedown|setTimeout/);

    const toggleBody = extractFunctionBody(indexHtml, 'toggleAwakeFromAwakeButton');
    assert.match(toggleBody, /MyFlightWakeLock\.toggle\(\{\s*fromUserGesture:\s*true\s*\}\)/);
    assert.doesNotMatch(indexHtml, /AWAKE_LONG_PRESS_MS|themeLongPressTimer|themeLongPressTriggered/);
});

test('Awake button text and color reflect the active state', () => {
    const updateBody = extractFunctionBody(indexHtml, 'updateAwakeUI');
    assert.match(updateBody, /awakeText\.textContent\s*=\s*awakeStatus\?\.active\s*\?\s*'Awake On'\s*:\s*'Awake Off'/);
    assert.match(updateBody, /setAttribute\('aria-pressed'/);
    assert.match(updateBody, /awakeText\.style\.color\s*=\s*AWAKE_ACTIVE_COLOR/);
});

test('unavailable awake feedback blinks red multiple times', () => {
    assert.match(indexHtml, /const\s+AWAKE_UNAVAILABLE_BLINKS\s*=\s*[3-9]\s*;/);
    assert.match(indexHtml, /const\s+AWAKE_UNAVAILABLE_BLINK_MS\s*=\s*\d+\s*;/);

    const feedbackBody = extractFunctionBody(indexHtml, 'showAwakeUnavailableFeedback');
    assert.match(feedbackBody, /let\s+remainingToggles\s*=\s*AWAKE_UNAVAILABLE_BLINKS\s*\*\s*2\s*;/);
    assert.match(feedbackBody, /awakeUnavailableFeedbackActive\s*=\s*remainingToggles\s*%\s*2\s*===\s*0\s*;/);
    assert.match(feedbackBody, /setTimeout\s*\(\s*tick\s*,\s*AWAKE_UNAVAILABLE_BLINK_MS\s*\)/);
});

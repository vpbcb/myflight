const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const myShiftHtml = fs.readFileSync(path.join(root, 'myshift.html'), 'utf8');
const headerMarkup = myShiftHtml.slice(
    myShiftHtml.indexOf('<div class="headerFixed">'),
    myShiftHtml.indexOf('<div class="scrollArea">')
);

test('guided calculation controls follow the requested visual order', () => {
    const paxIndex = headerMarkup.indexOf('class="paxButtons"');
    const crewIndex = headerMarkup.indexOf('>Расчет для</div>');
    const airportIndex = headerMarkup.indexOf('id="airportBtn"');
    const reinforcedIndex = headerMarkup.indexOf('id="reinforcedBtn"');
    const departureIndex = headerMarkup.indexOf('id="depTimeTitle"');
    const landingsIndex = headerMarkup.indexOf('id="landingsBtn"');
    const extensionIndex = headerMarkup.indexOf('id="extendBtn"');

    assert.ok(paxIndex >= 0, 'PAX selector is present');
    assert.ok(
        paxIndex < crewIndex
        && crewIndex < airportIndex
        && airportIndex < reinforcedIndex
        && reinforcedIndex < departureIndex
        && departureIndex < landingsIndex
        && landingsIndex < extensionIndex,
        'controls are ordered PAX, crew, Cabin fields, departure, landings, extension'
    );
});

test('Refresh opens an accessible confirmation before clearing data', () => {
    assert.match(
        myShiftHtml,
        /id="resetConfirmOverlay"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-hidden="true"/
    );
    assert.match(myShiftHtml, /Очистить данные и начать новый расчет?/);
    assert.match(myShiftHtml, /id="resetConfirmCancel"[^>]*>Отмена</);
    assert.match(myShiftHtml, /id="resetConfirmAccept"[^>]*>Очистить</);
    assert.match(myShiftHtml, /id="resetConfirmCancel"[^>]*class="[^"]*resetConfirmBtn--primary/);
    assert.match(myShiftHtml, /id="resetConfirmAccept"[^>]*class="[^"]*resetConfirmBtn--neutral/);
    assert.match(
        myShiftHtml,
        /refreshBtn\.addEventListener\(['"]click['"],[\s\S]{0,420}openResetConfirm\(\)/
    );
    assert.doesNotMatch(
        myShiftHtml,
        /refreshBtn\.addEventListener\(['"]click['"],[\s\S]{0,420}resetState\(\)/
    );
    assert.match(
        myShiftHtml,
        /function confirmResetAndStart\(\)[\s\S]{0,240}resetState\(\)[\s\S]{0,240}startCarousel\(\)/
    );
});

test('carousel uses Flight and Cabin step sequences with backward navigation', () => {
    const expectedSteps = ['pax', 'crew', 'airport', 'reinforced', 'departure', 'landings', 'extension'];
    const stepIndexes = expectedSteps.map(step => (
        headerMarkup.indexOf(`data-carousel-step="${step}"`)
    ));

    assert.ok(stepIndexes.every(index => index >= 0), 'all five step markers are present');
    assert.deepStrictEqual([...stepIndexes].sort((a, b) => a - b), stepIndexes);
    assert.match(
        myShiftHtml,
        /id="carouselNextBtn"[^>]*hidden[^>]*>Далее</
    );
    assert.match(
        myShiftHtml,
        /id="carouselPrevBtn"[^>]*hidden[^>]*>Назад</
    );
    assert.match(
        myShiftHtml,
        /const BASE_CAROUSEL_STEPS = Object\.freeze\(\[['"]pax['"], ['"]crew['"], ['"]departure['"], ['"]landings['"], ['"]extension['"]\]\)/
    );
    assert.match(
        myShiftHtml,
        /const CABIN_CAROUSEL_STEPS = Object\.freeze\(\[['"]pax['"], ['"]crew['"], ['"]airport['"], ['"]reinforced['"], ['"]departure['"], ['"]landings['"], ['"]extension['"]\]\)/
    );
    assert.match(
        myShiftHtml,
        /function getCarouselSteps\(\)\s*\{[\s\S]{0,180}cabincrew === ["']да["']\s*\?\s*CABIN_CAROUSEL_STEPS\s*:\s*BASE_CAROUSEL_STEPS/
    );
    assert.match(myShiftHtml, /function startCarousel\(\)[\s\S]{0,180}carouselStepIndex = 0;[\s\S]{0,180}renderCarousel\(\)/);
    assert.match(myShiftHtml, /classList\.toggle\(["']carousel-complete["'], index < carouselStepIndex\)/);
    assert.match(myShiftHtml, /classList\.toggle\(["']carousel-current["'], index === carouselStepIndex\)/);
    assert.match(myShiftHtml, /function advanceCarousel\(\)[\s\S]{0,260}finishCarousel\(\)/);
    assert.match(myShiftHtml, /function retreatCarousel\(\)[\s\S]{0,220}carouselStepIndex -= 1;[\s\S]{0,120}renderCarousel\(\)/);
    assert.match(myShiftHtml, /function finishCarousel\(\{ completed = true \} = \{\}\)[\s\S]{0,520}carouselStepIndex = -1;[\s\S]{0,520}carouselPrevBtn/);
    assert.match(myShiftHtml, /function positionCarouselButtons\(\)[\s\S]{0,1400}getBoundingClientRect\(\)[\s\S]{0,1400}Math\.min/);
});

test('departure step immediately opens the custom time keypad on focus', () => {
    assert.match(
        headerMarkup,
        /class="time-container-fixed"[^>]*onclick="openDepartureKeypad\(\)"[\s\S]{0,180}id="depTime"[^>]*readonly[^>]*onfocus="openDepartureKeypad\(\)"/
    );
    assert.match(
        myShiftHtml,
        /function openDepartureKeypad\(\)\s*\{\s*openKeypad\('depTime',\s*'ВРЕМЯ ВЫЛЕТА'\);\s*\}/
    );
    assert.match(
        myShiftHtml,
        /function renderCarousel\(\)[\s\S]{0,1800}steps\[carouselStepIndex\] === 'departure'[\s\S]{0,240}\$\("depTime"\)\?\.focus\(\{ preventScroll: true \}\)/
    );
});

test('departure field stays undimmed while its keypad is open', () => {
    assert.match(
        myShiftHtml,
        /#keypadModal\.keep-carousel-step-visible\s*\{[^}]*background:\s*transparent/
    );
    assert.match(
        myShiftHtml,
        /const keepDepartureVisible = id === 'depTime'[\s\S]{0,180}classList\.contains\('carousel-running'\)/
    );
    assert.match(
        myShiftHtml,
        /keypadModal\.classList\.toggle\('keep-carousel-step-visible', keepDepartureVisible\)/
    );
    assert.match(
        myShiftHtml,
        /function hideKeypadModal\(\)\s*\{[\s\S]{0,160}classList\.remove\('active', 'keep-carousel-step-visible'\)/
    );
});

test('carousel pales the page and keeps only the current step prominent', () => {
    assert.match(myShiftHtml, /--carouselDim:/);
    assert.match(
        myShiftHtml,
        /\.app-container\.carousel-running::before,[\s\S]{0,80}\.app-container\.carousel-ready::before\s*\{[\s\S]{0,320}background:\s*var\(--carouselDim\)/
    );
    assert.match(
        myShiftHtml,
        /\[data-carousel-step\]\.carousel-complete\s*\{[^}]*box-shadow:\s*none/
    );
    assert.match(
        myShiftHtml,
        /function startCarousel\(\)[\s\S]{0,220}classList\.add\(["']carousel-running["']\)/
    );
    assert.match(
        myShiftHtml,
        /function finishCarousel\(\{ completed = true \} = \{\}\)[\s\S]{0,420}classList\.remove\(["']carousel-running["']\)/
    );

    const currentRule = myShiftHtml.match(
        /\[data-carousel-step\]\.carousel-current\s*\{([^}]*)\}/
    );
    assert.ok(currentRule, 'current step style is present');
    assert.doesNotMatch(currentRule[1], /var\(--accent\)/);
    assert.match(currentRule[1], /z-index:\s*1500/);
    assert.match(currentRule[1], /box-shadow:\s*none/);
    assert.doesNotMatch(myShiftHtml, /9999px\s+var\(--carouselDim\)/);
    assert.match(myShiftHtml, /\.app-container\.carousel-running \.headerFixed\s*\{[^}]*z-index:\s*auto/);
    assert.match(myShiftHtml, /\.app-container\.carousel-running #ccBlock\.open\s*\{[^}]*transform:\s*none/);
});

test('carousel navigation uses palette D, lower spacing, and a two-line Start label', () => {
    assert.match(myShiftHtml, /--carouselPrev:\s*#60758d/);
    assert.match(myShiftHtml, /--carouselNext:\s*#173f6b/);
    assert.match(myShiftHtml, /\.carouselPrevBtn\s*\{[^}]*background:\s*var\(--carouselPrev\)/);
    assert.match(myShiftHtml, /\.carouselNextBtn\s*\{[^}]*background:\s*var\(--carouselNext\)/);
    assert.match(myShiftHtml, /const verticalGap = 14;/);
    assert.match(myShiftHtml, /class="bottom-action-label">START<br>CALCULATION<\/span>/);
});

test('clicking anywhere in the crew block alternates Flight and Cabin', () => {
    assert.match(
        headerMarkup,
        /data-carousel-step="crew"[^>]*onclick="toggleCrewSelection\(\)"/
    );
    assert.doesNotMatch(headerMarkup, /id="btnFlight"[^>]*onclick=/);
    assert.doesNotMatch(headerMarkup, /id="btnCabin"[^>]*onclick=/);
    assert.match(
        myShiftHtml,
        /function toggleCrewSelection\(\)\s*\{[\s\S]{0,160}setCrew\(cabincrew === "да" \? "flight" : "cabin"\)/
    );
});

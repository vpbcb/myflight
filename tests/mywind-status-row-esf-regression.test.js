const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const myWindHtml = fs.readFileSync(path.resolve(__dirname, '..', 'mywind.html'), 'utf8');
const between = (start, end) => {
    const from = myWindHtml.indexOf(start);
    const to = myWindHtml.indexOf(end, from);
    assert.ok(from !== -1 && to !== -1, `${start} … ${end}`);
    return myWindHtml.slice(from, to);
};
const rwyMappingSource = between('const rwyMapping = [', '];') + '];';
const statusRowSource = between('    // ESF: длинные состояния', "    window.addEventListener('resize'");

// Minimal DOM: text width = characters × font size × 0.7, enough to exercise the fit loop.
function createElement() {
    return {
        className: '', textContent: '', children: [], style: {},
        append(...items) { this.children.push(...items); },
        replaceChildren(...items) { this.children = items; },
        querySelector(selector) { return this.children.find(child => selector === '.' + child.className) || null; },
        text() { return [this.textContent, ...this.children.map(child => typeof child === 'string' ? child : child.text())].join(' '); }
    };
}

function renderStatusRow(mappingIndex, { width = 360, opMode = 'courseMinusBtn', land = 'MANUAL LANDING', aircraft = 'A320 winglet', crew = 'КВС' } = {}) {
    const statusRow = { ...createElement(), clientWidth: width };
    const context = {
        document: {
            createElement,
            getElementById: id => id === 'landStatusRow' ? statusRow : { innerText: aircraft }
        },
        getComputedStyle: () => ({ paddingLeft: '2px', paddingRight: '2px', fontSize: '15px' }),
        crewBtnLabel: () => crew,
        getLandSelectionText: () => land
    };
    vm.createContext(context);
    vm.runInContext(`${rwyMappingSource}\nlet currentMappingIndex = ${mappingIndex}, currentOpMode = '${opMode}';\n${statusRowSource}\nthis.updateStatusRow = updateStatusRow;`, context);
    const content = () => statusRow.children[0];
    statusRow.children = [];
    // Width depends on the style fitStatusRow applies to the content element.
    const originalCreate = context.document.createElement;
    context.document.createElement = () => {
        const element = originalCreate();
        element.getBoundingClientRect = () => {
            const size = parseFloat(element.style.fontSize) || 15;
            const chars = element.text().replace(/\s+/g, ' ').length;
            return { width: chars * size * 0.7 };
        };
        return element;
    };
    context.updateStatusRow();
    return { statusRow, content: content() };
}

test('status row shows the runway state from the shared ESF mapping', () => {
    const expected = ['DRY', 'GOOD', 'GOOD', ['GOOD to', 'MEDIUM'], 'MEDIUM', ['MEDIUM', 'to POOR'], 'POOR', 'POOR'];
    expected.forEach((esf, index) => {
        const { content } = renderStatusRow(index);
        assert.equal(content.className, 'status-content');
        const main = content.children[0];
        assert.equal(main.children.map(part => typeof part === 'string' ? part : part.textContent).join(''), 'A320W + TAKEOFF + КВС + RW');
        assert.deepEqual(main.children.filter(part => typeof part !== 'string').map(part => part.className), ['status-muted', 'status-muted', 'status-muted', 'status-muted status-rw']);
        const esfEl = content.children[1];
        if (Array.isArray(esf)) {
            assert.equal(esfEl.className, 'status-esf-stack', `row ${index}`);
            assert.deepEqual(esfEl.children.map(line => line.textContent), esf);
        } else {
            assert.equal(esfEl.textContent, esf, `row ${index}`);
        }
    });
});

test('long status text is shrunk to fit the plaque, short text is left alone', () => {
    const short = renderStatusRow(0, { width: 420 }).content;
    assert.equal(short.style.fontSize, '');

    const long = renderStatusRow(3, { width: 340, opMode: 'coursePlusBtn', land: 'AUTOLAND + AUTOROLL', aircraft: 'A321 neo', crew: '2П 80%' }).content;
    const width = long.getBoundingClientRect().width;
    assert.ok(width <= 336, `content ${width}px must fit 336px`);
    assert.equal(long.style.letterSpacing, undefined);
    assert.equal(long.style.fontWeight, undefined);
    assert.ok(parseFloat(long.style.fontSize) < 15);
});

test('plaque appears without an opacity fade and refreshes with every table update', () => {
    const rule = myWindHtml.match(/\.land-status-row\s*\{[^}]*\}/)[0];
    assert.doesNotMatch(rule, /transition:[^;]*opacity/);
    assert.match(rule, /opacity:\s*0;/);
    assert.match(myWindHtml, /\.land-status-row \.status-muted \{\s*font-weight: 500;\s*opacity: 0\.85;/);
    assert.match(myWindHtml, /\.land-status-row \.status-rw \{\s*font-size: 0\.75em;\s*vertical-align: 0\.12em;/);
    assert.match(rule, /font-weight:\s*700;/);
    assert.match(rule, /letter-spacing:\s*0;/);
    assert.match(myWindHtml, /function updateTable\(options = \{\}\) \{\s*const tableBody = document\.getElementById\('tableBody'\);\s*if \(!tableBody\) return;\s*updateStatusRow\(\);/);
});

test('Land button shows the same (long tap) hint as the 2П crew button', () => {
    assert.match(myWindHtml, /id="coursePlusBtn"[^>]*><span>Land<\/span><em class="crew-hint">\(long tap\)<\/em><\/button>/);
    assert.match(myWindHtml, /#crewBtn \.crew-hint, #coursePlusBtn \.crew-hint \{[^}]*display: block;[^}]*font-style: italic;/);
    assert.match(myWindHtml, /#coursePlusBtn\.active-op \.crew-hint \{ color: inherit;/);
});

test('hint between the table and the plaque stays on one line and shrinks to fit', () => {
    assert.match(myWindHtml, /<div id="tableHint" class="table-hint">short tap on either side will highlight it, long tap to switch m\/s <b>\/<\/b> kt<\/div>\s*<div id="landStatusRow"/);
    const rule = myWindHtml.match(/\.table-hint \{[^}]*\}/)[0];
    assert.match(rule, /white-space: nowrap;/);
    assert.match(rule, /font-style: italic;/);
    assert.match(myWindHtml, /function fitTableHint\(\) \{[\s\S]*?hint\.scrollWidth > hint\.clientWidth/);
    assert.match(myWindHtml, /if \(statusRow\) fitStatusRow\(statusRow\);\s*fitTableHint\(\);/);
});

test('long tap switches m/s/kt on every cell that a short tap highlights', () => {
    const cells = myWindHtml.match(/<div [^>]*onclick="clickSide\('(?:left|right)'\)"[^>]*>/g);
    assert.equal(cells.length, 4);
    cells.forEach(cell => {
        assert.match(cell, /onpointerdown="startPressUnit\(event\)" onpointerup="endPressUnit\(event\)" onpointerleave="cancelPressUnit\(\)" onpointercancel="cancelPressUnit\(\)"/);
        assert.match(cell, /touch-action: pan-y;/);
        assert.match(cell, /oncontextmenu="event\.preventDefault\(\)"/);
    });
});

test('table scroll is set in the same task as the rows, so the page opens without a jump', () => {
    const centerSource = myWindHtml.slice(myWindHtml.indexOf('function centerTable() {'), myWindHtml.indexOf('\n}\n', myWindHtml.indexOf('function centerTable() {')));
    assert.doesNotMatch(centerSource, /setTimeout/);
    const restoreSource = between('    function restoreTableScrollPosition() {', '    function attachTableScrollPersistence()');
    assert.doesNotMatch(restoreSource, /setTimeout/);
    const updateSource = between('function updateTable(options = {}) {', 'function centerTable() {');
    assert.doesNotMatch(updateSource.slice(updateSource.indexOf('tableBody.innerHTML = h;')), /setTimeout/);
});

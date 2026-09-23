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

// Minimal DOM: text width = characters × font size × 0.7 (+ letter spacing), enough to exercise the fit loop.
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
            const spacing = element.style.letterSpacing === '0px' ? 0 : 1;
            const bold = element.style.fontWeight === '700' ? 0.95 : 1;
            const chars = element.text().replace(/\s+/g, ' ').length;
            return { width: chars * (size * 0.7 * bold + spacing) };
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
        assert.equal(content.children[0], 'A320W + TAKEOFF + КВС + RW');
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
    assert.equal(short.style.letterSpacing, '');

    const long = renderStatusRow(3, { width: 320, opMode: 'coursePlusBtn', land: 'AUTOLAND + AUTOROLL', aircraft: 'A321 neo', crew: '2П 80%' }).content;
    const width = long.getBoundingClientRect().width;
    assert.ok(width <= 316, `content ${width}px must fit 316px`);
    assert.equal(long.style.letterSpacing, '0px');
    assert.equal(long.style.fontWeight, '700');
    assert.ok(parseFloat(long.style.fontSize) < 15);
});

test('plaque appears without an opacity fade and refreshes with every table update', () => {
    const rule = myWindHtml.match(/\.land-status-row\s*\{[^}]*\}/)[0];
    assert.doesNotMatch(rule, /transition:[^;]*opacity/);
    assert.match(rule, /opacity:\s*0;/);
    assert.match(myWindHtml, /function updateTable\(options = \{\}\) \{\s*const tableBody = document\.getElementById\('tableBody'\);\s*if \(!tableBody\) return;\s*updateStatusRow\(\);/);
});

test('Land button shows the same (long tap) hint as the 2П crew button', () => {
    assert.match(myWindHtml, /id="coursePlusBtn"[^>]*><span>Land<\/span><em class="crew-hint">\(long tap\)<\/em><\/button>/);
    assert.match(myWindHtml, /#crewBtn \.crew-hint, #coursePlusBtn \.crew-hint \{[^}]*display: block;[^}]*font-style: italic;/);
    assert.match(myWindHtml, /#coursePlusBtn\.active-op \.crew-hint \{ color: inherit;/);
});

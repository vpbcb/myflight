const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const indexHtml = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

function extractFunctionSource(source, name) {
    const start = source.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `${name}() must exist`);

    const parametersEnd = source.indexOf(')', start);
    const openBrace = source.indexOf('{', parametersEnd);
    let depth = 0;
    for (let index = openBrace; index < source.length; index += 1) {
        if (source[index] === '{') depth += 1;
        if (source[index] === '}') depth -= 1;
        if (depth === 0) return source.slice(start, index + 1);
    }

    throw new Error(`${name}() body was not closed`);
}

function loadFunction(name) {
    return vm.runInNewContext(`(${extractFunctionSource(indexHtml, name)})`);
}

function createFakeCard(href) {
    let clickHandler = null;
    let preventedClicks = 0;

    return {
        href,
        addEventListener(type, handler) {
            if (type === 'click') clickHandler = handler;
        },
        click() {
            assert.ok(clickHandler, 'click handler must be registered');
            clickHandler({
                preventDefault() {
                    preventedClicks += 1;
                }
            });
        },
        get preventedClicks() {
            return preventedClicks;
        }
    };
}

test('MyFuel looks inactive like MyWeather and binds hidden access', () => {
    assert.match(
        indexHtml,
        /<a href="\.\/myfuel\.html" class="project-card" id="myfuelCard" style="opacity:\s*0\.5;">/
    );
    assert.match(
        indexHtml,
        /<a href="#" class="project-card" style="opacity:\s*0\.5;">[\s\S]*?<span class="title">MyWeather<\/span>/
    );
    assert.match(indexHtml, /bindMyFuelTripleClick\(document\.getElementById\('myfuelCard'\)\)/);
});

test('MyFuel only navigates after three clicks inside the 900 ms window', () => {
    const bindMyFuelTripleClick = loadFunction('bindMyFuelTripleClick');
    const card = createFakeCard('./myfuel.html');
    const navigations = [];
    let now = 100;

    bindMyFuelTripleClick(card, {
        maxWindowMs: 900,
        navigate: url => navigations.push(url),
        now: () => now
    });

    card.click();
    now = 400;
    card.click();
    assert.deepEqual(navigations, []);

    now = 800;
    card.click();
    assert.deepEqual(navigations, ['./myfuel.html']);

    now = 2000;
    card.click();
    now = 2800;
    card.click();
    now = 3001;
    card.click();
    assert.deepEqual(navigations, ['./myfuel.html'], 'expired first click must not unlock MyFuel');

    now = 3200;
    card.click();
    assert.deepEqual(navigations, ['./myfuel.html', './myfuel.html']);
    assert.equal(card.preventedClicks, 7);
});

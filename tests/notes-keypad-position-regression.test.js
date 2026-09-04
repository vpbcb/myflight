const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const myPathHtml = fs.readFileSync(path.join(root, 'mypath.html'), 'utf8');

function cssBlock(source, selector) {
    const start = source.indexOf(selector);
    assert.notEqual(start, -1, `${selector} must exist`);
    const end = source.indexOf('}', start);
    assert.ok(end > start, `${selector} must close`);
    return source.slice(start, end + 1);
}

function cssValue(block, property) {
    const match = block.match(new RegExp(`${property.replace('-', '\\-')}:\\s*([^;]+)`));
    assert.ok(match, `${property} must exist in ${block.slice(0, 80)}`);
    return match[1].trim();
}

test('Notes keypad copies MyPath phone dimensions and position', () => {
    const notesContent = cssBlock(indexHtml, '.modal-content.notes-keypad-content {');
    const pathContent = cssBlock(myPathHtml, '.keypad-content {');
    for (const property of ['width', 'max-width', 'padding', 'margin-bottom', 'margin-left']) {
        assert.equal(cssValue(notesContent, property), cssValue(pathContent, property), property);
    }

    const notesGrid = cssBlock(indexHtml, '.notes-keypad-grid {');
    const pathGrid = cssBlock(myPathHtml, '.keypad-grid {');
    for (const property of ['grid-template-columns', 'gap', 'margin-bottom']) {
        assert.equal(cssValue(notesGrid, property), cssValue(pathGrid, property), property);
    }

    const notesButton = cssBlock(indexHtml, '.notes-kp-btn {');
    const pathButton = cssBlock(myPathHtml, '.kp-btn {');
    assert.equal(cssValue(notesButton, '--btn-height'), cssValue(pathButton, '--btn-height'));
    assert.equal(cssValue(notesButton, 'height'), cssValue(pathButton, 'height'));

    assert.match(indexHtml, /\.notes-keypad-actions\s*\{[^}]*display:\s*flex[^}]*gap:\s*8px/);
    assert.match(indexHtml, /<\/div>\s*<div class="notes-keypad-actions">\s*<button[^>]*notes-kp-clr[^>]*>CLR<\/button>\s*<button[^>]*notes-kp-done[^>]*>DONE<\/button>/);
});

test('Notes keypad copies MyPath tablet geometry', () => {
    const doneRulePosition = indexHtml.indexOf('.notes-kp-done {');
    const wideMediaPosition = indexHtml.indexOf('@media (min-width: 768px)', doneRulePosition);
    assert.ok(doneRulePosition >= 0 && wideMediaPosition > doneRulePosition, 'tablet overrides must follow phone rules');
    assert.match(indexHtml, /@media\s*\(min-device-width:\s*768px\)\s*\{\s*\.modal-content\.notes-keypad-content\s*\{[^}]*margin-bottom:\s*0\s*!important[^}]*margin-left:\s*0\s*!important/);
    assert.match(indexHtml, /@media\s*\(min-width:\s*768px\)\s*\{[\s\S]*?\.modal-content\.notes-keypad-content\s*\{[^}]*max-width:\s*360px\s*!important[^}]*padding:\s*30px 20px\s*!important/);
    assert.match(indexHtml, /@media\s*\(min-width:\s*768px\)\s*\{[\s\S]*?\.notes-kp-btn\s*\{[^}]*--btn-height:\s*55px/);
});

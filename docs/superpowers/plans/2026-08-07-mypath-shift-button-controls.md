# MyPath Shift Button Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make long press edit the configured threshold shift and short tap toggle whether that shift is applied.

**Architecture:** Keep `pathShiftInput` as the configured value and add a separate in-memory/persisted active flag. Route pointer events through dedicated handlers, calculate with an effective shift, and show a MyWind-style transient toast when no value is configured.

**Tech Stack:** Static HTML/CSS/JavaScript, Node.js built-in test runner

## Global Constraints

- Long press threshold is 300 ms.
- Missing-value toast uses 0.7 second fade-in and 0.7 second fade-out.
- Keep the reserved warning-plate layout space unchanged.
- Keep `CACHE_NAME` unchanged.
- Work in the current branch without subagents, reviewers, or worktrees.

---

### Task 1: Separate shift editing from activation

**Files:**
- Create: `tests/mypath-shift-button-controls-regression.test.js`
- Modify: `mypath.html`

**Interfaces:**
- Consumes: configured numeric value from `#pathShiftInput`.
- Produces: `isPathShiftActive`, pointer handlers for `#shiftBtn`, and `pathShiftActive` in saved state.

- [ ] **Step 1: Add failing source-level regression tests**

Create tests that assert:

```js
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
    assert.match(myPathHtml, /id="shiftBtn"[^>]*onclick="clickShift\(event\)"/);
    assert.match(myPathHtml, /const PATH_SHIFT_HOLD_MS\s*=\s*300\s*;/);
    assert.match(functionBody('startPressShift'), /setTimeout\([\s\S]*openKeypad\('pathShiftInput',\s*'PATH SHIFT'\)[\s\S]*PATH_SHIFT_HOLD_MS/);
    assert.match(functionBody('clickShift'), /isShiftLongPress[\s\S]*togglePathShiftActive\(\)/);
});

test('calculation applies only an active configured shift', () => {
    assert.match(functionBody('togglePathShiftActive'), /configuredPathShift\s*===\s*0[\s\S]*showMissingPathShiftToast\(\)/);
    assert.match(functionBody('togglePathShiftActive'), /isPathShiftActive\s*=\s*!isPathShiftActive[\s\S]*calculate\(/);
    assert.match(functionBody('calculate'), /const pathShift\s*=\s*isPathShiftActive\s*\?\s*configuredPathShift\s*:\s*0\s*;/);
});

test('missing-value toast copies the MyWind RWY timing', () => {
    assert.match(myPathHtml, /INSERT SHIFT VALUE\. LONG TAP ON BUTTON/);
    assert.match(functionBody('showMissingPathShiftToast'), /opacity 0\.7s ease-out/);
    assert.match(functionBody('showMissingPathShiftToast'), /opacity 0\.7s ease-in/);
    assert.match(functionBody('showMissingPathShiftToast'), /setTimeout\([\s\S]*700/);
});

test('shift active state persists and resets with a new approach', () => {
    assert.match(functionBody('saveAppState'), /pathShiftActive:\s*isPathShiftActive/);
    assert.match(functionBody('loadAppState'), /state\.pathShiftActive/);
    assert.match(functionBody('resetFields'), /isPathShiftActive\s*=\s*false/);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test tests/mypath-shift-button-controls-regression.test.js`

Expected: FAIL because the button still opens the keypad on every click and no active flag exists.

- [ ] **Step 3: Add button pointer handlers and missing-value toast**

Use the existing MyWind pointer pattern:

```html
<button id="shiftBtn" class="shift-btn" style="touch-action: pan-y;"
    onpointerdown="startPressShift(event)"
    onpointerup="endPressShift(event)"
    onpointerleave="cancelPressShift()"
    onpointercancel="cancelPressShift()"
    onclick="clickShift(event)"
    oncontextmenu="event.preventDefault()">ADD SHIFT</button>
```

Add a centered toast inside `.table` with the text `INSERT SHIFT VALUE. LONG TAP ON BUTTON`. Use the MyWind course-toast colors, shadow, visibility behavior, and 700 ms fade phases with a responsive text size.

```html
<div id="shiftValueToast" class="shift-value-toast" role="status" aria-live="polite">
    INSERT SHIFT VALUE. LONG TAP ON BUTTON
</div>
```

```css
.shift-value-toast {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: calc(100% - 32px);
    max-width: 360px;
    box-sizing: border-box;
    background: rgb(119, 192, 247);
    color: #ffffff;
    padding: 16px 20px;
    border-radius: 16px;
    font-size: clamp(0.8rem, 3.8vw, 1.1rem);
    font-weight: 900;
    text-align: center;
    z-index: 2000;
    pointer-events: none;
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
    opacity: 0;
    visibility: hidden;
}

html.dark-theme .shift-value-toast {
    background: rgb(2, 115, 173);
}
```

- [ ] **Step 4: Implement configured versus active state**

Add:

```js
const PATH_SHIFT_HOLD_MS = 300;
const PATH_SHIFT_TOAST_PHASE_MS = 700;
let isPathShiftActive = false;
let shiftPressTimer;
let isShiftLongPress = false;

function getConfiguredPathShift() {
    const input = document.getElementById('pathShiftInput');
    const value = input ? parseFloat(input.value) : 0;
    return Number.isFinite(value) ? value : 0;
}

function togglePathShiftActive() {
    const configuredPathShift = getConfiguredPathShift();
    if (configuredPathShift === 0) {
        isPathShiftActive = false;
        showMissingPathShiftToast();
        return;
    }
    isPathShiftActive = !isPathShiftActive;
    calculate('pathShiftToggle');
}

function showMissingPathShiftToast() {
    const toast = document.getElementById('shiftValueToast');
    if (!toast) return;
    if (toast.hideTimeout) clearTimeout(toast.hideTimeout);
    if (toast.visibilityTimeout) clearTimeout(toast.visibilityTimeout);
    toast.style.transition = 'none';
    toast.style.opacity = '0';
    toast.style.visibility = 'visible';
    void toast.offsetWidth;
    toast.style.transition = 'opacity 0.7s ease-out';
    toast.style.opacity = '1';
    toast.hideTimeout = setTimeout(() => {
        toast.style.transition = 'opacity 0.7s ease-in';
        toast.style.opacity = '0';
        toast.visibilityTimeout = setTimeout(() => {
            toast.style.visibility = 'hidden';
        }, PATH_SHIFT_TOAST_PHASE_MS);
    }, PATH_SHIFT_TOAST_PHASE_MS);
}

function startPressShift(event) {
    if (event && event.button !== undefined && event.button !== 0) return;
    isShiftLongPress = false;
    clearTimeout(shiftPressTimer);
    shiftPressTimer = setTimeout(() => {
        isShiftLongPress = true;
        openKeypad('pathShiftInput', 'PATH SHIFT');
    }, PATH_SHIFT_HOLD_MS);
}

function endPressShift() {
    clearTimeout(shiftPressTimer);
}

function cancelPressShift() {
    clearTimeout(shiftPressTimer);
    isShiftLongPress = false;
}

function clickShift(event) {
    if (isShiftLongPress) {
        event?.preventDefault();
        event?.stopPropagation();
        isShiftLongPress = false;
        return;
    }
    togglePathShiftActive();
}
```

Long press opens the existing keypad and suppresses the subsequent click. Short click calls `togglePathShiftActive()`.

- [ ] **Step 5: Apply the active state to calculation and UI**

In `calculate()` parse `configuredPathShift`, force the active flag off for zero, and derive:

```js
const pathShift = isPathShiftActive ? configuredPathShift : 0;
```

Show a configured value on the button in both states, but add `active-shift` and show `#shiftAlert` only when active. Keypad completion keeps the current active flag and applies a newly edited active value; entering zero deactivates it.

- [ ] **Step 6: Persist, migrate, and reset state**

Save `pathShiftActive: isPathShiftActive`. On load, use the saved boolean; if absent, treat a legacy non-zero `pathShift` as active. `resetFields()` clears the configured value and active flag.

- [ ] **Step 7: Run target tests and verify GREEN**

Run:

```powershell
node --test tests/mypath-shift-button-controls-regression.test.js
node --test tests/mypath-layout-regression.test.js
```

Expected: all tests pass.

- [ ] **Step 8: Verify interactions in the local browser**

Check short tap with no value, long press keypad opening without a short-tap side effect, activation/deactivation with a configured value, warning-plate state, and table recalculation at narrow and iPad widths.

- [ ] **Step 9: Run final checks once and commit**

Run `npm test`, `npm run lint`, `npm run build`, and `git diff --check`. If npm scripts remain unavailable because there is no `package.json`, report that explicitly.

```powershell
git add -- mypath.html tests/mypath-shift-button-controls-regression.test.js
git commit -m "feat(mypath): split shift edit and toggle"
```

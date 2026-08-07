# MyNPA FPA Hot Color Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Match the hot FCU FPA text color to the existing positive OAT red.

**Architecture:** Keep the existing FPA state classes and calculation logic. Add a source-level regression test, then change the single hot-state CSS declaration.

**Tech Stack:** Static HTML/CSS, Node.js built-in test runner

## Global Constraints

- Change only the red `.fcu-fpa-hot` color from `#d50000` to `#ef4444`.
- Keep `.fcu-fpa-cold` at `#0273ad`.
- Do not change `CACHE_NAME`.
- Work in the current branch without subagents, reviewers, or worktrees.

---

### Task 1: Match the FPA hot color to positive OAT

**Files:**
- Create: `tests/mynpa-fpa-color-regression.test.js`
- Modify: `mynpa.html:3039`

**Interfaces:**
- Consumes: CSS selectors already present in `mynpa.html`.
- Produces: `.fcu-fpa-hot` using `#ef4444`; no JavaScript interface changes.

- [ ] **Step 1: Write the failing regression test**

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'mynpa.html'), 'utf8');

function selectorColor(selector) {
    const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = source.match(new RegExp(`${escapedSelector}\\s*\\{[^}]*color:\\s*(#[0-9a-f]{6})`, 'i'));
    return match?.[1]?.toLowerCase();
}

test('hot FPA uses the positive OAT red', () => {
    const oatPositive = selectorColor('#tempC.temp-positive');
    const fpaHot = selectorColor('.fcu-info-stacked .fcu-main.fcu-fpa-hot');

    assert.equal(oatPositive, '#ef4444');
    assert.equal(fpaHot, oatPositive);
});

test('cold FPA keeps its blue color', () => {
    assert.equal(selectorColor('.fcu-info-stacked .fcu-main.fcu-fpa-cold'), '#0273ad');
});
```

- [ ] **Step 2: Run the target test and verify RED**

Run: `node --test tests/mynpa-fpa-color-regression.test.js`

Expected: FAIL because FPA hot is `#d50000`, while positive OAT is `#ef4444`.

- [ ] **Step 3: Apply the minimal CSS change**

```css
.fcu-info-stacked .fcu-main.fcu-fpa-hot {
    color: #ef4444;
}
```

- [ ] **Step 4: Run the target test and verify GREEN**

Run: `node --test tests/mynpa-fpa-color-regression.test.js`

Expected: two passing tests.

- [ ] **Step 5: Run final project checks once**

Run: `npm test`, `npm run lint`, `npm run build`, and `git diff --check`.

Expected: available checks pass; if npm scripts are unavailable because this static repository has no `package.json`, report that explicitly.

- [ ] **Step 6: Commit the implementation**

```powershell
git add -- mynpa.html tests/mynpa-fpa-color-regression.test.js
git commit -m "style(mynpa): soften hot FPA red"
```

# MyFuel Triple-Click Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make MyFuel look inactive and open it only after three clicks within 900 ms.

**Architecture:** Keep the existing anchor destination and exact `project-card` class, apply the same inline opacity as MyWeather, and bind a focused click gate in `index.html`. The binding function accepts injectable clock and navigation callbacks so its real behavior can be tested without a browser.

**Tech Stack:** HTML, CSS, browser JavaScript, Node.js built-in `node:test` and `vm`.

## Global Constraints

- Do not change `CACHE_NAME` in `sw.js`.
- Do not show a hint for the hidden gesture.
- Do not alter the MyFuel icon, label, or destination.
- Do not touch unrelated untracked files.

---

### Task 1: Inactive MyFuel card with triple-click gate

**Files:**
- Modify: `index.html:319-367,1202-1216,1840-1844`
- Create: `tests/myfuel-triple-click-regression.test.js`

**Interfaces:**
- Consumes: the `#myfuelCard` anchor and its existing `href="./myfuel.html"`.
- Produces: `bindMyFuelTripleClick(card, options)` where `options.now()` returns milliseconds, `options.navigate(url)` performs navigation, and `options.maxWindowMs` defaults to `900`.

- [x] **Step 1: Write the failing regression test**

```js
test('MyFuel looks inactive and only navigates on the third click', () => {
    assert.match(indexHtml, /id="myfuelCard"[^>]*opacity:\s*0\.5/);
    const bind = loadFunction(indexHtml, 'bindMyFuelTripleClick');
    const card = createFakeCard('./myfuel.html');
    const navigations = [];
    let now = 100;
    bind(card, { now: () => now, navigate: url => navigations.push(url), maxWindowMs: 900 });
    card.click();
    now = 400;
    card.click();
    assert.deepEqual(navigations, []);
    now = 800;
    card.click();
    assert.deepEqual(navigations, ['./myfuel.html']);
});
```

- [x] **Step 2: Run the test and verify RED**

Run: `node --test tests/myfuel-triple-click-regression.test.js`

Expected: FAIL because `#myfuelCard`, its inactive opacity, and `bindMyFuelTripleClick` do not exist.

- [x] **Step 3: Add the minimal markup, styling, and click gate**

```html
<a href="./myfuel.html" class="project-card" id="myfuelCard" style="opacity: 0.5;">
```

```css
#myfuelCard { touch-action: manipulation; }
```

```js
function bindMyFuelTripleClick(card, options = {}) {
    if (!card) return;
    const now = options.now || (() => Date.now());
    const navigate = options.navigate || (url => window.location.assign(url));
    const maxWindowMs = options.maxWindowMs || 900;
    let clickTimes = [];
    card.addEventListener('click', event => {
        event.preventDefault();
        const clickedAt = now();
        clickTimes = clickTimes.filter(time => clickedAt - time <= maxWindowMs);
        clickTimes.push(clickedAt);
        if (clickTimes.length < 3) return;
        clickTimes = [];
        navigate(card.href);
    });
}
```

- [x] **Step 4: Run the focused test and verify GREEN**

Run: `node --test tests/myfuel-triple-click-regression.test.js`

Expected: PASS, including blocked first/second clicks, third-click navigation, and expired-click reset.

- [x] **Step 5: Run final project checks**

Run once each: `npm test`, `npm run lint`, `npm run build`, `git diff --check`.

Expected: focused Node test and `git diff --check` pass. If `package.json` remains absent, record the three npm commands as unavailable with `ENOENT`.

- [x] **Step 6: Commit the implementation**

```powershell
git add -- index.html tests/myfuel-triple-click-regression.test.js docs/superpowers/plans/2026-08-05-myfuel-triple-click.md docs/superpowers/specs/2026-08-05-myfuel-triple-click-design.md
git commit -m "feat: gate MyFuel behind triple click"
```

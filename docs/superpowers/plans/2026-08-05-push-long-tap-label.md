# Push Long-Tap Label Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display `(long tap)` in both Push button states.

**Architecture:** Change only the visible strings in `index.html`. Add a focused regression test before production changes, leaving local untracked tests untouched.

**Tech Stack:** HTML, browser JavaScript, Node.js assertions.

## Global Constraints

- Preserve existing long-press behavior and styles.
- Keep `aria-pressed` behavior unchanged.
- Do not change `CACHE_NAME` in `sw.js`.

---

### Task 1: Update Push toggle labels

**Files:**
- Create: `tests/push-long-tap-label-regression.test.js`
- Modify: `index.html:1204,1471-1478`

**Interfaces:**
- Consumes: `setMyFlightPushButtonState(enabled)`.
- Produces: visible strings `Push Off (long tap)` and `Push On (long tap)`.

- [x] **Step 1: Change the existing test to require both labels**

```js
const stateStart = indexHtml.indexOf('function setMyFlightPushButtonState');
const stateEnd = indexHtml.indexOf('async function getMyFlightPushRegistration', stateStart);
const buttonStateBody = indexHtml.slice(stateStart, stateEnd);
assert.match(indexHtml, />Push Off \(long tap\)<\/button>/);
assert.match(buttonStateBody, /'Push On \(long tap\)'/);
assert.match(buttonStateBody, /'Push Off \(long tap\)'/);
```

- [x] **Step 2: Run the focused test and verify RED**

Run: `node tests/push-notification-regression.test.js`

Expected: FAIL because the current labels omit `(long tap)`.

- [x] **Step 3: Update the initial and dynamic strings**

```html
<button type="button" class="push-toggle-card" id="pushToggleBtn" title="Long press to show flight summary notification">Push Off (long tap)</button>
```

```js
button.textContent = myFlightPushEnabled ? 'Push On (long tap)' : 'Push Off (long tap)';
```

- [x] **Step 4: Run the focused test and verify GREEN**

Run: `node tests/push-notification-regression.test.js`

Expected: all push regression checks pass.

- [x] **Step 5: Run final project checks**

Run once each: `npm test`, `npm run lint`, `npm run build`, `git diff --check`.

Expected: npm commands report `ENOENT` while `package.json` is absent; `git diff --check` passes.

# MyShift Carousel Cancel Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a red, pill-shaped «Отмена» button at the fixed bottom center only while the MyShift carousel is active.

**Architecture:** Move the existing cancel action out of the shared bottom navigation and make it a carousel navigation button. Keep visibility controlled by the existing `renderCarousel()` and `finishCarousel()` flow.

**Tech Stack:** Static HTML/CSS/JavaScript, Node.js test runner, service worker cache.

## Global Constraints

- The button is hidden until `START CALCULATION` starts the carousel.
- Use the same shape, size, font, and shadow as «Назад» and «Далее».
- Use a red background and white text.
- Fix the button at the horizontal center near the bottom of the viewport.
- Bump `CACHE_NAME` from `myflight_v.260904-2` to `myflight_v.260904-3`.

---

### Task 1: Restyle and reposition the cancel action

**Files:**
- Modify: `tests/myshift-carousel-cancel-regression.test.js`
- Modify: `myshift.html`
- Modify: `sw.js`
- Modify: `tests/aircraft-db-values-regression.test.js`
- Modify: `tests/bottom-navigation-regression.test.js`

**Interfaces:**
- Consumes: existing `renderCarousel()`, `finishCarousel()`, and `cancelCarousel()` functions.
- Produces: `#carouselCancelBtn.carouselNavBtn.carouselCancelBtn`, controlled by the existing `hidden` property.

- [ ] **Step 1: Write the failing regression test**

Assert that the button is outside `.bottom-controls`, has the carousel navigation class, and receives fixed bottom-center red styling:

```js
assert.match(myShiftHtml, /id="carouselCancelBtn"[^>]*class="[^"]*carouselNavBtn[^"]*carouselCancelBtn[^"]*"[^>]*hidden[^>]*>Отмена<\/button>/);
assert.doesNotMatch(bottomControlsMarkup, /id="carouselCancelBtn"/);
assert.match(myShiftHtml, /\.carouselCancelBtn\s*\{[^}]*position:\s*fixed[^}]*left:\s*50%[^}]*bottom:[^}]*transform:\s*translateX\(-50%\)[^}]*background:\s*#ef4444/);
```

- [ ] **Step 2: Verify the new test fails**

Run: `node --test tests/myshift-carousel-cancel-regression.test.js`

Expected: FAIL because the button still uses `bottom-action--center` inside `.bottom-controls` and has no fixed red pill style.

- [ ] **Step 3: Implement the minimal markup and CSS change**

Move the button next to the carousel navigation buttons:

```html
<button type="button" id="carouselCancelBtn" class="carouselNavBtn carouselCancelBtn" hidden>Отмена</button>
```

Add the specific style after the generic `.carouselNavBtn` rules so its fixed positioning and active transform win while inheriting the common dimensions and typography:

```css
.carouselCancelBtn{
  position:fixed;
  left:50%;
  bottom:max(14px, env(safe-area-inset-bottom));
  transform:translateX(-50%);
  border-color:#ef4444;
  background:#ef4444;
}
.carouselCancelBtn:active{
  transform:translateX(-50%) scale(0.96);
}
```

Keep `renderCarousel()` and `finishCarousel()` unchanged because they already show and hide the button only for an active carousel.

- [ ] **Step 4: Bump the service worker cache**

Change the cache constant and both regression expectations to:

```js
const CACHE_NAME = 'myflight_v.260904-3';
```

- [ ] **Step 5: Verify targeted and full checks**

Run:

```powershell
node --test tests/myshift-carousel-cancel-regression.test.js tests/bottom-navigation-regression.test.js tests/aircraft-db-values-regression.test.js
$trackedTests = @(git ls-files 'tests/*.test.js'); node --test --test-reporter=tap $trackedTests
npm test
npm run lint
npm run build
git diff --check
```

Expected: Node tests PASS and `git diff --check` exits 0. npm commands report the known missing `package.json` unless project metadata has been added.

- [ ] **Step 6: Commit and push**

```powershell
git add -- myshift.html sw.js tests/myshift-carousel-cancel-regression.test.js tests/bottom-navigation-regression.test.js tests/aircraft-db-values-regression.test.js docs/superpowers/plans/2026-09-04-myshift-carousel-cancel-button.md
git commit -m "fix(shift): center carousel cancel button"
git push origin HEAD:main
```

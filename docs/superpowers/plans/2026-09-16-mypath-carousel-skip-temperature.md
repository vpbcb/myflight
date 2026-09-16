# MyPath Carousel Skip Temperature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Исключить температуру из последовательного ввода, запускаемого кнопкой `NEW APPR` на MyPath.

**Architecture:** Цепочка клавиатуры остаётся локальной в `mypath.html`. Ветвь завершения FAP закрывает последовательный режим и открывает уже существующее меню угла, не вызывая `openKeypad('temp', ...)`. Тест читает статический HTML, как другие регрессионные тесты проекта.

**Tech Stack:** HTML, inline JavaScript, Node.js built-in test runner.

## Global Constraints

- Не изменять ручной ввод температуры, расчёты и `sw.js`.
- Проверять только запуск через `NEW APPR`.

---

### Task 1: MyPath sequential keypad

**Files:**
- Create: `tests/mypath-carousel-regression.test.js`
- Modify: `mypath.html:1628-1647`

**Interfaces:**
- Consumes: `closeKeypad(e)`, `isSequentialFlow`, `activeKp`, `angleMenu`.
- Produces: переход FAP → меню угла без автоматического открытия температуры.

- [x] **Step 1: Write the failing test**

```js
test('NEW APPR sequence skips temperature after FAP', () => {
    const closeKeypad = functionBody('closeKeypad');
    assert.doesNotMatch(closeKeypad, /activeKp\.id === 'fap'[\s\S]{0,180}openKeypad\('temp', 'TEMPERATURE'\)/);
    assert.match(closeKeypad, /activeKp\.id === 'fap'[\s\S]{0,360}isSequentialFlow = false;[\s\S]{0,360}angleMenu\.style\.display = 'block';/);
});

test('temperature remains manually editable', () => {
    assert.match(myPathHtml, /id="temp"[\s\S]{0,300}onclick="openKeypad\('temp', 'TEMPERATURE'\)"/);
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --test tests/mypath-carousel-regression.test.js`

Expected: FAIL because FAP opens the temperature keypad.

- [x] **Step 3: Write minimal implementation**

```js
} else if (activeKp && activeKp.id === 'fap') {
    document.getElementById('keypadModal').classList.remove('active');
    activeKp = null;
    isSequentialFlow = false;
    const angleMenu = document.getElementById('angleMenu');
    if (angleMenu) angleMenu.style.display = 'block';
    return;
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `node --test tests/mypath-carousel-regression.test.js`

Expected: PASS with two tests.

- [x] **Step 5: Commit**

```bash
git add mypath.html tests/mypath-carousel-regression.test.js docs/superpowers/plans/2026-09-16-mypath-carousel-skip-temperature.md
git commit -m "fix(mypath): skip temperature in new approach flow"
```

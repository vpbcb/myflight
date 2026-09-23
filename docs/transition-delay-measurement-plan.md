# Дописать в docs/spa-vs-multipage-analysis.md: как замерить задержку перехода на Android

## Context

В `docs/spa-vs-multipage-analysis.md` уже есть раздел «Дополнение: задержка при переходе
между страницами». В нём шаг «1. Замер» описан одной строкой. Пользователь попросил подробно
расписать именно его: как подключить телефон к компьютеру и снять логи. Цель — чтобы замер
можно было выполнить по документу без дополнительных вопросов, а результат передать для
анализа.

Важная деталь окружения: на этом ПК политика администратора запрещает удалённую отладку
Chrome («DevTools remote debugging is disallowed by the system admin» — получено при запуске
Chrome с `--remote-debugging-port`). Не проверено, блокирует ли она также `chrome://inspect`
для USB-устройств, поэтому в инструкции нужен запасной вариант.

## Что дописать (новый подраздел после «Порядок действий»)

### «Замер задержки перехода: пошагово»

**A. Подготовка телефона (один раз)**
1. Настройки → О телефоне → 7 раз нажать «Номер сборки». Появятся «Параметры разработчика».
2. Параметры разработчика → включить «Отладка по USB».
3. Подключить телефон кабелем к ПК. На телефоне разрешить отладку для этого компьютера
   (запрос с RSA-ключом, отметить «Всегда разрешать»).
4. На Windows может понадобиться USB-драйвер производителя (Samsung, Xiaomi) или Google USB
   Driver, если телефон не виден.

**B. Подключение DevTools**
1. На ПК в Chrome открыть `chrome://inspect/#devices` и включить «Discover USB devices».
   Телефон появится в списке, под ним открытые страницы установленного PWA MyFlight
   (адрес `…/myflight…/mywind.html`) и отдельной строкой service worker.
2. Если Chrome пишет, что отладка запрещена политикой, попробовать Edge (`edge://inspect`)
   или другой компьютер без корпоративных политик.
3. Нажать «inspect» у страницы MyWind.

**C. Что снять (три замера, каждый — 3–5 повторов)**

*Замер 1 — Network, главный:*
1. Во вкладке Network включить «Preserve log», «Disable cache» не включать.
2. На телефоне нажать MyPath.
3. Выбрать запрос `mypath.html` (тип document, пометка «ServiceWorker») → вкладка Timing.
   Записать:
   - «ServiceWorker Startup» — холодный запуск service worker;
   - «ServiceWorker respondWith» — время работы `appShellResponse`;
   - общее время запроса.
4. Для `app.js`, `offline-client.js`, `bottom-navigation.css` записать общее время.
5. Повторить сразу (service worker тёплый) и после 1–2 минут простоя (Android выгрузит
   service worker, будет холодный старт).

*Замер 2 — Navigation Timing в консоли:*
После открытия MyPath нажать «inspect» уже у страницы MyPath и выполнить в Console:

```js
const n = performance.getEntriesByType('navigation')[0];
const paint = Object.fromEntries(performance.getEntriesByType('paint').map(p => [p.name, Math.round(p.startTime)]));
console.table({
  'SW стартовал (workerStart)': Math.round(n.workerStart),
  'Ответ SW (responseStart)': Math.round(n.responseStart),
  'HTML получен (responseEnd)': Math.round(n.responseEnd),
  'DOM готов (domContentLoadedEventEnd)': Math.round(n.domContentLoadedEventEnd),
  'load (loadEventEnd)': Math.round(n.loadEventEnd),
  'Первая отрисовка': paint['first-contentful-paint'] ?? paint['first-paint']
});
```

Все значения в мс от начала навигации. Время выгрузки MyWind, до начала навигации, сюда
не входит.

*Замер 3 — Performance (если замеры 1–2 указывают на скрипты страницы):*
1. В DevTools страницы MyWind открыть вкладку Performance → Record.
2. На телефоне нажать MyPath, дождаться открытия, нажать Stop.
3. Сохранить профиль через «Save profile» (`.json`).

**D. Как читать результат**
- Большие «ServiceWorker Startup» или `workerStart` — холодный старт service worker.
  Лечится предзагрузкой (Speculation Rules) или SPA.
- Большой «respondWith» или `responseStart − workerStart` — медленный путь навигации в
  service worker. Это шаг 2 «Порядка действий».
- Большие `domContentLoadedEventEnd − responseEnd` или время до первой отрисовки — тяжёлые
  скрипты или разбор страницы. Это шаг 4.
- Всё быстрое (< 150 мс), а визуально задержка есть — время уходит на выгрузку MyWind или
  нажатие срабатывает не сразу. Проверить обработчики нажатия и `pagehide`.

**E. Что прислать для анализа**
- Скриншоты вкладки Timing для `mypath.html`: тёплый и холодный service worker.
- Вывод `console.table` (скриншот или текст).
- Файл профиля Performance, если снимался.
- Модель телефона и версию Chrome (`chrome://version` на телефоне).

## Файлы

- `docs/spa-vs-multipage-analysis.md` — добавить подраздел выше. В разделе «Порядок действий»
  пункт «1. Замер» сократить до ссылки на него.

## Проверка

- Перечитать документ: разделы идут по порядку, ссылки на функции совпадают с кодом
  (`appShellResponse`, `pinClient`, `completeBuilds`, `cacheFirst`, `clickPathSwitch`).
- Выполнить сниппет из замера 2 в консоли на локальном 5174 (десктопный Chrome): убедиться,
  что он выдаёт таблицу без ошибок.

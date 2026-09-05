# Isolation from MyActivity on the shared GitHub Pages origin

Based on fresh origin/main `d2ea594`.

Settings → Update app now removes only the exact MyFlight service-worker scope and caches beginning with `myflight_`. It clears only `hubActiveCacheVersion` and `hubVersion`, preserving user data and all local/session storage belonging to other PWAs. The existing online preflight remains. The service worker's fallback lookup also searches only MyFlight caches.

Verification: new isolation tests 3/3 pass (foreign registrations/caches, user data, offline reset rejection, own-cache fallback). Full Node suite: 60/61 pass. The failing test `Settings modal copies the MyWind RWY keypad size and placement` prohibits every min-width:768px media rule anywhere in index.html; the same rule exists in unmodified origin/main. This unrelated existing test/style mismatch was not changed. npm test/lint/build are unavailable because this repository has no package.json. git diff --check passed.

MyActivity companion implementation was checked against the actual production build in isolated worker executions. Browser E2E is unavailable on this PC because system administrator policy blocks DevTools remote debugging. Device acceptance: install both online, update either, then close/relaunch each without internet and verify local data persists.

CACHE_NAME remains `myflight_v.260904-10` as requested. The changed sw.js bytes still trigger the browser's service-worker update mechanism when the deployed script is checked. Existing installations must receive this fix before manual Update app can be considered isolated.

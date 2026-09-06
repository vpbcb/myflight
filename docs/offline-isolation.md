# Offline shell protocol 2 — 6 September 2026

Release cache: `myflight_v.260906-1`.

## Source and deployment

Edit `sw.source.js`; `npm run build` generates identical `sw.js` and legacy `service-worker.js`, unique HTML build metadata, and a manifest of 16 required assets with SHA-256 hashes and MIME types. All six app pages, offline page, local scripts/styles/data and vendored Firebase 9.22.0 compat SDKs are required. SDK license headers are preserved. Firebase APIs still need a network; SDK loading no longer does.

Commit the generated workers/pages with their source changes. `.gitattributes` fixes LF line endings so GitHub serves the bytes verified during installation. `npm run check:offline` rejects an inconsistent release. The Pages workflow tests and builds before publishing the whitelisted `dist` directory; configure GitHub Pages to use GitHub Actions. Private local backups and spreadsheets are not deployment inputs.

`npm test` runs every Git-versioned `.test.js` under `tests`, including newly staged tests. Stage new tests before running the full suite. Untracked local experiments are outside the repository suite; they can be run explicitly with `node --test path/to/test.js`. No tracked test is excluded.

## Installation and launch

The cache name includes app, scope, display version and unique build ID: `myflight-shell-v2:<scope>:<version>:<build>`. It deliberately does not match the old `myflight_` cleaner. Even an accidentally repeated display version cannot overwrite the preceding build. Downloads verify status, MIME and complete response hashes; deadlines include response bodies. Failure removes only the newly created incomplete cache. Repairs also use a separate cache when the canonical cache already exists.

Navigation verifies all required resources before selecting current HTML, otherwise selects a complete compatible backup. Persisted client pins keep each old window's fixed-name `app.js` and other files matched to its HTML across activation and worker restarts. There is no background mutation of a committed HTML/JS release. If cache storage disappears, the unchanged worker can rebuild online; unavailable storage/network produces a bounded fallback, not an empty successful JavaScript response.

Only protocol-2 caches in this exact scope are collected. Collection follows a loaded client's report, retains two distinct build generations, all live client pins and a 24-hour grace period. Installing/waiting workers, repairs and unknown clients block it. Legacy and unknown caches stay available for migration and are not globally cleared. Optional image warming never deletes another release.

Before an incompatible future database change, raise `COMPATIBILITY` in the source. Complete-byte verification cannot detect arbitrary logic errors in future releases; this is not automatic runtime-error rollback.

## Safe update button

`hardResetApp` is retained as the existing UI entry point but delegates to `offline-client.js`. It never unregisters workers or clears caches, user data, authorization or pending writes. Offline/failed preparation leaves the current page usable. Background work prepares a waiting worker without reloading open windows. Explicit update validates it, requests activation, verifies readiness, then reloads only the requesting window. Closing all predecessor windows also allows normal activation. A cancelable `app-before-update` event is available to editors that need to guard drafts.

Registration retries on online/focus/visibility and requests persistent storage where supported. Each app has its own worker/cache scope; the origin's quota is still shared.

## Verification and remaining device checks

The versioned tests exercise unchanged-version failure, wrong HTTP-200 bytes, missing app scripts, backup selection, old-window pins across worker restart, quota/storage failure, safe collection and foreign-cache preservation. `node scripts/verify-offline-build.cjs` tests actual release bytes for cold offline launch, all 16 resources and interrupted updates. Syntax, release consistency and the complete versioned suite gate Pages deployment.

Automated checks use isolated worker/runtime contexts. Browser E2E is unavailable on this PC because administrator policy blocks remote debugging; Android/iOS acceptance remains to be performed on a device.

After both releases deploy, open each app online, close all old browser/PWA windows, reopen online and then test airplane-mode cold launch. An old already-open page retains its pre-fix reset code until closed. Complete browser/OS origin-storage deletion also removes local-only data and cannot be repaired without an online installation. The app icon can survive that deletion; persistent-storage requests can be denied. Preserve independent exports of important data.

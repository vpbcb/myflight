# MyFuel Triple-Click Access Design

## Goal

Make the MyFuel card on the home screen look inactive like MyWeather while keeping a hidden triple-click entry to `myfuel.html`.

## Interface

- The MyFuel card uses the same inline `opacity: 0.5` appearance as MyWeather.
- The label and fuel icon stay unchanged.
- No hint about the hidden access gesture is shown.

## Behavior

- The first and second clicks do not navigate.
- Three clicks completed within a rolling 900 ms window navigate to the card's existing `./myfuel.html` URL.
- If more than 900 ms passes between clicks, the counter restarts from the latest click.
- After successful navigation, the counter resets.
- The behavior applies to mouse clicks and browser-generated click events from taps.

## Implementation

- Give the MyFuel card a stable element ID and the same inline opacity as MyWeather in `index.html`.
- Attach a small click handler that prevents the anchor's default navigation, tracks click count and timing, and navigates only on the third click.
- Keep the real `href` so the destination remains declared in markup.
- Do not change `CACHE_NAME` in `sw.js`.

## Testing

- Add a focused Node regression test that verifies the inactive class and exercises the click gate: no navigation after one or two clicks, navigation after the third, and reset after timeout.
- Run the focused test during development.
- Finish with the project-prescribed npm commands and `git diff --check`; report npm commands as unavailable if `package.json` is still absent.

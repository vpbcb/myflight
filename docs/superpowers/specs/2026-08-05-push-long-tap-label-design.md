# Push Long-Tap Label Design

## Goal

Show the required gesture directly on the Push toggle button.

## Interface

- Initial text: `Push Off (long tap)`.
- Enabled text: `Push On (long tap)`.
- Keep the existing color, size, long-press behavior, title, and accessibility state.

## Implementation

- Update the initial button markup in `index.html`.
- Update both text branches in `setMyFlightPushButtonState()`.
- Do not change `CACHE_NAME` in `sw.js`.

## Testing

- Add a focused regression test for the initial, enabled, and disabled labels without modifying local untracked tests.
- Confirm RED before changing `index.html`, then run the focused test again for GREEN.

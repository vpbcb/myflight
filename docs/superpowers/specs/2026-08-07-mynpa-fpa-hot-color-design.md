# MyNPA FPA Hot Color Design

## Goal

Make the red FCU FPA correction indication softer by matching the existing positive OAT color.

## Design

- Change only `.fcu-info-stacked .fcu-main.fcu-fpa-hot` from `#d50000` to `#ef4444` in `mynpa.html`.
- Keep the cold FPA color and all FPA calculation logic unchanged.
- Keep `CACHE_NAME` unchanged.

## Verification

- Add a regression assertion for the exact hot FPA color.
- Confirm the cold FPA color remains `#0273ad`.
- Run the project test, lint, build, and diff checks.

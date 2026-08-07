# MyPath Shift Button Controls Design

## Goal

Separate editing the threshold shift from applying it to the approach-path table.

## Interaction

- A 300 ms long press on the SHIFT button opens the existing PATH SHIFT keypad and suppresses the following click.
- A short tap toggles the configured non-zero shift on or off, recalculates the table, and updates the persistent warning plate.
- A short tap without a configured non-zero value does not change the calculation and shows `INSERT SHIFT VALUE. LONG TAP ON BUTTON`.
- The missing-value toast copies the MyWind RWY long-press lifecycle: 0.7 second fade-in, then 0.7 second fade-out, then hidden.
- Pointer leave or cancellation cancels the pending long press.

## State and Display

- `pathShiftInput` remains the configured shift value.
- A separate boolean tracks whether the configured value is applied.
- With no configured value, the button reads `ADD SHIFT`.
- With a configured inactive value, the button shows the value with neutral styling.
- With an active value, the same label uses the existing active orange styling and the warning plate is visible.
- Finishing keypad entry preserves the active state. If active, the new value is applied immediately; zero deactivates the shift.
- Saved state includes the active flag. Legacy saved state without the flag treats an existing non-zero shift as active.
- `NEW APPR` resets both the configured value and active flag.

## Constraints and Verification

- Keep the warning plate's permanently reserved layout space unchanged.
- Keep calculation formulas and table scrolling behavior unchanged.
- Keep `CACHE_NAME` unchanged.
- Cover short tap toggle, long-press click suppression, missing-value toast, persistence, and reset behavior with regression tests.

# Family tab: one card (0.12.0)

**Why:** two cards made the family tab look like two jobs. David wants one card: create a channel or copy one from a radio, then commit it from the same place.

**What changes**
- Card 02 "Each radio" is removed. "Progress" becomes 02.
- "Add this channel to the radio" lives in the "Channel is ready" box in card 01. That box appears after Create and after Copy, so both tabs get the same button and it cannot be pressed before a channel exists.
- The radios-done counter and the test-message callout move into card 01.
- The per-radio name fields and Suggest a name are dropped from this tab (David's choice, option 1). The family tab never renames a radio; naming stays in Set up a radio.

**Approaches considered**
1. Button in the shared "ready" box (chosen): one button, one code path, impossible to press early.
2. A separate button inside each tab pane: duplicates the control and needs disabled states.
3. Keep the name fields under a toggle in card 01: rejected by David; busier card.

**Not changing:** key handling, one-time QR, slot selection, replace-by-name, verification after reboot.

**Tests:** tests/family.py asserts one channel card plus Progress, no name fields, button hidden until a channel exists, button works from both tabs, and the radio's name is untouched.

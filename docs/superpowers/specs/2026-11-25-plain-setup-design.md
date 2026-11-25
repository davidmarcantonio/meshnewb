# Set up a radio, for people who are not technical (0.14.0)

**Why:** David reviewed the live page with non-technical people as the priority. The setup tab asked a newcomer to read about a screen and a half and make roughly ten decisions (board, baud, two names, PIN, which of two Go buttons) before anything happened. He approved a PR for the four highest-impact fixes.

**What changed (Set up a radio tab only; Join, Family and Check behave as before)**
1. **Shorter runway.** The privacy box is one line with a link to the full section at the foot of the page. "Before you start" is three items (computer, data cable, antenna). Driver, BOOT button and "close other apps" moved into "Radio not showing up?", which opens by itself when no device is picked. The checklist item that pointed at the wrong step numbers is gone.
2. **Find my radio first.** It is the primary button of step 01. The board list sits behind "Pick it yourself" and opens by itself when the page can't name the radio. Board names no longer carry build ids. Install speed (baud) and "my own firmware file" are under Advanced.
3. **One Go button.** "Set up my radio" checks the form, looks at the radio, then:
   - Meshtastic running: applies settings only (the existing firmware stop still catches out-of-date radios before any change).
   - Meshtastic not running, radio model known: shows "Install Meshtastic on this radio?" and waits for a second press before erasing.
   - Meshtastic not running, model unknown: opens the list, installs nothing.
   - Drag-and-drop radios (nRF52): shows those steps.
   The two old buttons remain as small "Or choose yourself" buttons, renamed "Erase and install fresh" and "Just apply my settings". Progress and the log stay hidden until there is something in them.
4. **Name and PIN filled in.** A made-up name and a random PIN are there on arrival. One "Radio name" field; the short name follows it (two capitals plus two digits, else the first four characters) until the user types one. The PIN is large, with "Write this down".
5. **Afterwards.** A successful setup ends with a "Your radio is ready" card: get the app, which radio to tap and the PIN to type, send a hello. Added because a prefilled PIN is easy to overlook.

**Safety change worth knowing:** the board list used to preselect Heltec V3. With the list folded away, a hidden default could install the wrong firmware, so nothing is preselected and an install is refused until the radio is found or picked.

**Wording:** flash -> install, configure -> apply settings, board -> radio, nodes -> other radios. USB chip names appear only under "Radio not showing up?".

**Not in this PR:** moving the factory reset next to step 01, a separate page for the audit details, a message for phone visitors.

**Tests:** tests/setup.py (new). tests/run.py and tests/csp_probe.py updated for the folded short-name field; the validation scenario now empties the prefilled fields and asserts.

**Not tested on a real radio.** The install (erase and write) path is unchanged code, but the tests cannot exercise it; they check only that it is reached after the confirm.

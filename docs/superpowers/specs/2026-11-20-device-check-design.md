# "See how a radio is set" page (0.10.0)

## Intent
A newcomer with a second-hand radio, or one they set up a while ago, should be able to plug it in and see at a
glance how it is set, before deciding whether to change anything. Read-only: nothing is written to the radio.

## Goals
- Third card on the picker, "See how a radio is set", leading to `/check/`.
- One click (pick the USB port), then a summary:
  1. Hardware: board name, chip family, node long name and short name.
  2. Firmware: installed vs. current beta; "update first" with a link to `/radio/` when behind.
  3. Radio: region, modem preset, role, hop limit.
  4. Channels: slot, name, primary/secondary, "default key" / "private key" / "no encryption".
  5. Bluetooth: on/off, pairing mode; a fixed PIN is reported as "set".
  6. WiFi: on/off, network name.
  7. Also: position sharing and precision, MQTT uplink, managed / admin-key mode, how many other radios it has heard.
  8. Heads-up flags: no region set, firmware old, MQTT uplink on a default-key channel, exact location on a
     default-key channel.

## Non-goals
- Changing any setting from this page. Fixes link to `/radio/` or `/family/`.
- Exporting or saving the summary.

## Anti-goals
- Showing any secret: channel keys, channel links, WiFi password, Bluetooth PIN digits, admin keys. Same rule
  as the family page.
- Any new network host or CSP change.

## Constraints
- Only works when Meshtastic is running on the radio. A blank ESP32 or an nRF52 in update mode gets
  "nothing to read" plus what the USB id suggests.
- Same template (`src/index.html`) and script (`src/main.js`) as `/radio/` and `/family/`; build renders a third
  page. The picker stays script-free.

## Approaches
1. **Third page from the existing template, reusing `connectMesh` (picked).** The data is already collected by
   Detect and the family page; this adds a renderer. No new dependencies, no CSP change.
2. Expand the Detect result on `/radio/` into a full summary. Rejected: buries a read-only tool inside the
   page that erases radios, and David asked for it from the picker.
3. A separate small script just for this page. Rejected: duplicates the connection code and adds a second
   bundle to audit.

## Left to the builder
- Exact wording, layout of the summary within the existing panel styles, and test fixtures for the fake node.

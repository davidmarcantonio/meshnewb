# Join a local mesh tab (0.13.0)

**Why:** David has radios that are already named and paired. He wants to switch one to a community's mesh settings (BayMe.sh) without re-entering or overwriting its name, Bluetooth/WiFi or PIN. Before this, community presets could only be applied through Set up a radio, which requires and rewrites all of those.

**What it does**
- New tab and address `/join/`: the state/community/use picker and one button, "Apply these mesh settings".
- Writes what the picked community publishes: region, modem preset, frequency slot, OK to MQTT choice, the primary channel if it is not the public default, and per-use role, hop limit and intervals where the group states them.
- Never sends the owner (name) or Bluetooth/network config. Secondary (family) channels are untouched.
- Where a group publishes no role or hop limit, the radio keeps its own. TX power is always kept.
- Reads the radio back and shows the verification table; name and connection rows say "not changed".
- Out-of-date firmware still stops first. "Apply anyway" applies mesh settings only; the update button leads to Set up a radio.
- The four choices are now a 2x2 grid of buttons with an emoji each (David's request): 📻 Set up a radio, 📡 Join a local mesh, 👥 Family or group channel, 🔍 See how a radio is set.

**Approaches considered**
1. A fourth tab (chosen by David): an existing-radio owner never sees the name and PIN fields.
2. A third button in Set up a radio's Go card: no new tab, but the user must know to skip card 02.

**How it is built:** `readSettings()` returns `{ ...communitySettings(), meshOnly: true }` on the join page; `pushConfig` and `verify` skip owner and Bluetooth/WiFi when `meshOnly`. The community panel is shared with Set up a radio and forced visible on the join page by CSS, so the Set up tab keeps whatever mode it was left in.

**Tests:** tests/join.py. Not covered: a published group with no role/hop limit (no such fixture yet).

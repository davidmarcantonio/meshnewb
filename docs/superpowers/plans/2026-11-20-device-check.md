# "See how a radio is set" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A read-only `/check/` page, reached from the picker, that reads a plugged-in radio and shows how it is set.

**Architecture:** A pure function turns the state `connectMesh()` already collects into rows and flags; `main.js` connects, calls it, and renders with `textContent`. The page is a third render of the existing `src/index.html` template. No new dependencies, hosts or CSP entries.

**Tech Stack:** Vanilla JS (esbuild bundle), `@meshtastic/core` 2.6.7, `node --test`, Playwright (Python) against `tests/fake-node.js`.

**Spec:** `docs/superpowers/specs/2026-11-20-device-check-design.md`

## Global Constraints

- Read-only: the check flow sends no admin message and writes no setting.
- Never put a secret in the DOM or the log: channel keys, channel links, WiFi password, Bluetooth PIN digits, admin keys.
- No new network host, no CSP change. The picker (`src/home.html`) stays script-free.
- Everything read from the radio is rendered with `textContent`, never `innerHTML`.
- The page takes nothing from its own URL.
- Version becomes `0.10.0`.

## Review Focus

1. Nothing answering (blank ESP32, charge-only cable): expect "nothing to read" plus the USB-id guess, not a hang or a stack trace. Test in Task 2.
2. nRF52 in update mode: expect a plain statement that it is in update mode and can't be read, without trying to connect. Test in Task 2 (fake port USB id).
3. User closes the port picker: expect the same "No device picked… try another cable" line Detect uses. Test in Task 2.
4. A node or channel name containing markup (`<img onerror>`): expect it shown as text. Test in Task 2.
5. Primary channel with an empty name: expect the modem preset's label (e.g. "LongFast"), not a blank cell. Test in Task 1.

---

### Task 1: `summarize()`

**Files:**
- Create: `src/summary.js`
- Test: `tests/summary.test.mjs`
- Modify: `package.json` (`test` script runs `node --test tests/summary.test.mjs` first)

**Interfaces:**
- Consumes: the `st` object built in `connectMesh()` (`src/main.js:592-604`): `{ config, module, channels, users, myNodeNum, pioEnv, metadata }`; label maps from `src/enums.js`.
- Produces: `summarize(st, { boardName, family, currentFw }) -> { sections: [{ title, rows: [[label, value]] }], channels: [{ slot, name, kind, key, location, uplink }], flags: [{ level: "warn"|"info", text, href? }] }`. All values are strings. `key` is one of `"default key"`, `"private key"`, `"no encryption"`. `location` is one of `"not shared"`, `"approximate"`, `"exact"`.

- [ ] **Step 1: Write the failing tests** in `tests/summary.test.mjs` using `node:test` and `node:assert/strict`, with a `base()` helper returning a US / LONG_FAST / CLIENT / hop 3 state on firmware `2.7.26.54e0d8d`, one primary channel with psk `[1]`, Bluetooth on with `fixedPin: 123456`, WiFi on with `wifiSsid: "HomeNet"`, `wifiPsk: "hunter2secret"`:

  - `sections` titles are exactly `["Hardware", "Firmware", "Radio", "Bluetooth", "WiFi", "Also"]`.
  - Firmware row reads `2.7.26` and "Up to date" when `currentFw` is `2.7.26.54e0d8d`; with `metadata.firmwareVersion = "2.7.10.abc"` a `warn` flag exists whose `href` is `"../radio/"`.
  - `JSON.stringify(result)` contains neither `"123456"` nor `"hunter2secret"`, nor the base64 of any channel psk; Bluetooth section has a row `["PIN", "Fixed PIN set"]`; WiFi section has `["Network", "HomeNet"]`.
  - Key classification: psk `[]` and `[0]` -> `"no encryption"`; `[1]` and the well-known 16-byte default key (`1PG7OiApB1nwvP+rz05pAQ==`) -> `"default key"`; 16 or 32 other bytes -> `"private key"`.
  - Primary channel with empty name on LONG_FAST has `name === "LongFast"`.
  - `lora.region = 0` produces a `warn` flag containing "No region".
  - `module.mqtt.enabled = true` with `uplinkEnabled` on a default-key channel produces a `warn` flag containing "MQTT"; the same on a private-key channel does not.
  - `moduleSettings.positionPrecision = 32` on a default-key channel produces a `warn` flag containing "exact location"; `13` gives `location === "approximate"` and no flag; `0` gives `"not shared"`.
  - `security.isManaged = true` gives an Also row `["Managed mode", "On"]`.
  - `users` with 4 entries (one being `myNodeNum`) gives `["Other radios heard", "3"]`.
  - A state with `config: {}`, `module: {}`, `channels: {}` returns without throwing, with values of `"Unknown"`.

- [ ] **Step 2:** Run `node --test tests/summary.test.mjs`. Expected: FAIL, cannot find `../src/summary.js`.
- [ ] **Step 3: Implement `summarize`** in `src/summary.js` as a pure ES module with no DOM access. Import `Protobuf` from `@meshtastic/core` for enum names and reuse `PRESET_LABEL` / `ROLE_LABEL` from `src/enums.js`. Version comparison: export `verNums`, `olderThan`, `shortVer` from here and have `main.js` import them (delete the copies at `src/main.js:395-397`).
- [ ] **Step 4:** Run `node --test tests/summary.test.mjs`. Expected: all pass.
- [ ] **Step 5:** Commit: `summarize(): turn radio state into a read-only summary`.

### Task 2: The `/check/` page

**Files:**
- Modify: `build.mjs:90-98` (render `check/index.html`, add it to `PAGES`)
- Modify: `src/home.html` (third `a.choice`, `href="check/"`, title "See how a radio is set", text "Plug in a radio and see its firmware, channels, Bluetooth and WiFi at a glance. Changes nothing."; description meta and the "Not sure?" hint mention it)
- Modify: `src/index.html` (header `h1`/`p` and one `<section class="panel" data-only="check">` holding `#btn-check`, `#check-status`, `#check-flags`, `#check-out`; mark the shared log panel's radio/family-only parts as today)
- Modify: `src/app.css:138` (one rule: on each page hide every `[data-only]` that doesn't name it; flag and summary table styles from existing tokens)
- Modify: `src/main.js` (`checkRun()`, wired in the boot block; guard radio/family-only boot code so it doesn't throw on `/check/`)
- Modify: `tests/fake-node.js` (accept `window.__fakeOpts` overrides for `user`, `network`, `bluetooth`, `channels`, `mqtt`, `security`, and a `silent` option that never answers)
- Create: `tests/check.py`; Modify: `package.json` (`version` `0.10.0`, append `python3 tests/check.py` to `test`), `README.md` (one paragraph on the page)

**Interfaces:**
- Consumes: `summarize()` from Task 1; `pickPort()`, `connectMesh(timeoutMs)`, `identify(st)`, `resolveFirmware()`, `usbKey()`, `NRF_UPDATE_MODE` in `src/main.js`.
- Produces: `async function checkRun()`; DOM ids `btn-check`, `check-status`, `check-flags`, `check-out`.

- [ ] **Step 1: Write `tests/check.py`** in the style of `tests/family.py` (same server, fake-node init script, `pageerror` / CSP console collection), using `assert`:

  - Picker: `a.choice` hrefs are `["radio/", "family/", "check/"]`; the picker still has 0 `<script>` elements.
  - `/check/`: `#btn-full`, `#btn-fam-push`, `#longname` are hidden; `#btn-check` is visible; no page errors; no CSP console messages.
  - Configured fake (region 1, preset 0, WiFi `HomeNet` / `hunter2secret`, fixed PIN 123456, a secondary channel `SmithFam` with a 32-byte key): after clicking `#btn-check`, `#check-out` text contains `Heltec V3`, `2.7.26`, `US`, `LongFast`, `SmithFam`, `private key`, `HomeNet`, `Fixed PIN set`; `document.documentElement.outerHTML` contains none of `hunter2secret`, `123456`, or the key's base64.
  - `window.__fakeNode.adminLog` is empty after the check (nothing written).
  - Fake on `fw: "2.7.10.abc"`: `#check-flags` contains "Update" and a link whose `href` ends `/radio/`.
  - Fresh fake (region 0): `#check-flags` contains "No region".
  - `user.longName = "<img src=x onerror=window.__pwned=1>"`: after the check `window.__pwned` is undefined and the literal text appears in `#check-out`.
  - `silent` fake: `#check-status` contains "nothing to read" within 15 s.
  - Fake port reporting an `NRF_UPDATE_MODE` USB id: `#check-status` contains "update mode"; no connect attempted.
  - Port picker rejected with `NotFoundError`: `#check-status` contains "No device picked".
  - `/check/?name=Evil#x` renders identically to `/check/` before the click (`#check-out` empty).

- [ ] **Step 2:** Run `npm test`. Expected: FAIL at `tests/check.py` (no `check/` link).
- [ ] **Step 3: Build and markup.** Add the page to `build.mjs`, the card to `home.html`, the header and panel to `index.html`, the CSS rule. Header copy: `h1` "MeshNewb. see how a radio is set"; `p` "Plug in a radio and press the button. This page reads its settings over USB and shows them here. It changes nothing on the radio, and nothing leaves this tab."
- [ ] **Step 4: Implement `checkRun()`** in `src/main.js`: `busy(true)`; `pickPort()`; if the USB id is in `NRF_UPDATE_MODE`, report and stop; `connectMesh(12000)`; on failure report "nothing to read" with `identify(null)`'s guess; on success `identify(st)`, `resolveFirmware()`, `summarize()`, disconnect and close the port, then render sections as tables and flags as a list using `createElement` + `textContent`. Flags with `href` render an `<a>` with a fixed relative href from the flag, never from radio data. Status line on success: "Read at HH:MM. Nothing was changed."
- [ ] **Step 5:** Run `npm test`. Expected: all suites pass, including the existing `run.py`, `csp_probe.py`, `family.py`.
- [ ] **Step 6:** Bump `package.json` to `0.10.0`, add the README paragraph, run `npm run build` and confirm `dist/build.json` lists `check/index.html`.
- [ ] **Step 7:** Commit: `Add 'See how a radio is set' read-only check page (0.10.0)`.

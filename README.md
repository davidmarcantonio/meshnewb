# MeshNewb

Flash and configure a [Meshtastic](https://meshtastic.org) node from your browser. Pick your state and community to get that mesh's published settings, or set every radio value by hand. Enter your name and PIN, plug in the board, and press one button. The page flashes the official beta firmware, sends your settings to the radio over USB, then reads them back to check they took.

Live at https://mesh.marcantonio.me. Unofficial. Not affiliated with Meshtastic LLC.

## Before you start

- **Browser:** desktop Chrome, Edge or Opera (Firefox 151+ should work). Not Safari, not iPhone/iPad.
- **Cable:** a USB *data* cable. Charge-only cables look identical but leave out the data wires, and they are the most common reason a board isn't detected. Voltage is not the issue; USB is always 5 V.
- **Driver:** CP210x or CH9102 on some ESP32 boards, if no port appears ([Meshtastic driver page](https://meshtastic.org/docs/getting-started/serial-drivers/esp32/)).
- **Antenna** on before powering the board.
- **Still not detected:** hold BOOT while plugging in.

## Privacy

- No cookies, `localStorage`, analytics, beacons or third-party scripts.
- Loading the page makes no requests beyond its own files (HTML, JS, CSS, fonts, and the community presets under `presets/`).
- The page contacts two hosts, and only after you press a button:
  - `api.meshtastic.org`: which firmware is the current beta.
  - `release.meshtastic.org`: the firmware files, and only for "Erase, flash & configure".
- Requests send no referrer and no credentials.
- Names, PIN, WiFi password and channel keys go over USB to your radio and nowhere else.
- A `Content-Security-Policy` in `index.html` enforces all of this: `default-src 'none'`, `script-src 'self'`, and `connect-src` limited to this site itself (for the preset files) and the two hosts above. Any other request is blocked by the browser. `tests/csp_probe.py` checks this.

## Auditing what you're running

1. **Source:** this repo. All of the app's own code is in `src/`. The board list and tested firmware version are in `data/`.
2. **Build:** GitHub Actions builds from a tagged commit (`.github/workflows/pages.yml`, actions pinned to commit SHAs) and deploys to GitHub Pages.
3. **Provenance:** each deploy publishes a signed build attestation for `index.html`, `app.js`, `app.css`, `build.json` and `presets/index.json`. `build.json` names the app commit, the presets commit and date, and the sha256 of every preset file. Check one with:
   ```sh
   curl -sO https://<pages-host>/app.js
   gh attestation verify app.js --repo davidmarcantonio/meshnewb
   ```
4. **Reproduce:** `app.js` contains no timestamps, commit info or preset data, so the same commit always builds to the same bytes, whatever the presets are:
   ```sh
   git checkout <commit shown in the page footer>
   npm ci && npm run build
   sha256sum dist/app.js   # matches the footer and dist/build.json
   ```

## Use it locally

Web Serial needs a secure context (`https://` or `http://localhost`) and desktop Chrome or Edge.

```sh
npm ci
npm run build
npm run serve          # http://localhost:8000
```

## How it works

| Step | What happens |
|---|---|
| Flash | `esptool-js` erases the ESP32, then writes the board's factory image, OTA app and filesystem at the offsets in the official `.mt.json` manifest (the same method as the official flasher). |
| Configure | `@meshtastic/core` + `@meshtastic/transport-web-serial` read the node's current config, merge your changes in, and commit them in one edit session. `setConfig` replaces a whole section, so sending only some fields would reset the rest. |
| Verify | After the reboot it reconnects and reads every value back. |

nRF52 boards (T-Echo, RAK4631): flash the UF2 by drag-and-drop, then use "Configure only".

## Community presets

Presets live in their own repository, [davidmarcantonio/meshtastic-us-presets](https://github.com/davidmarcantonio/meshtastic-us-presets) (CC0): one JSON file per US community, each with its source link and the date it was checked. Add or correct a community there.

- **Build time, not run time.** `build.mjs` copies `index.json` and the community files into `dist/presets/`. The page reads them from its own host and never contacts GitHub.
- **`app.js` doesn't change when presets do.** Presets are data files, not bundled code, so the `app.js` hash in the footer stays the same across preset updates.
- **Daily refresh.** The deploy workflow runs once a day. It compares the presets repo's latest `main` commit with the one recorded in the live `build.json`. If it moved, it rebuilds the app commit that is already live with the new presets and redeploys. No token or secret is involved; the presets repo is public.
- **What you're looking at.** The footer shows "Presets as of <date>, commit <sha>". The same values are in `build.json` and covered by the build attestation.
- **Published vs listed.** A community with published settings gets a preset. One that keeps its settings in Discord or similar is shown with a link to the group and no preset.

To build against a local checkout or a specific presets commit:

```sh
node build.mjs --presets ../meshtastic-us-presets
PRESETS_COMMIT=<sha> npm run build
```

## Tests

`npm test` builds the app (with the preset snapshot in `tests/fixtures/presets`) and a fake Meshtastic node (a mocked `navigator.serial` that speaks the real framed protobuf protocol). It then runs end-to-end scenarios in headless Chrome with the CSP enforced, and checks that the CSP blocks unlisted hosts. Needs Python 3 + Playwright and a Chrome at `/usr/bin/google-chrome`.

## License

GPL-3.0-only, because the bundled `@meshtastic/core` and `@meshtastic/transport-web-serial` are GPL-3.0-only. `esptool-js` and `@bufbuild/protobuf` are Apache-2.0. Inter and JetBrains Mono are OFL-1.1.

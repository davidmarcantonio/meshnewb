# MeshNewb

Flash and configure a [Meshtastic](https://meshtastic.org) node from your browser. Pick a California community preset, or set every radio value by hand. Enter your name and PIN, plug in the board, and press one button. The page flashes the official beta firmware, sends your settings to the radio over USB, then reads them back to check they took.

Live at https://mesh.marcantonio.me. Unofficial. Not affiliated with Meshtastic LLC.

## Before you start

- **Browser:** desktop Chrome, Edge or Opera (Firefox 151+ should work). Not Safari, not iPhone/iPad.
- **Cable:** a USB *data* cable. Charge-only cables look identical but leave out the data wires, and they are the most common reason a board isn't detected. Voltage is not the issue; USB is always 5 V.
- **Driver:** CP210x or CH9102 on some ESP32 boards, if no port appears ([Meshtastic driver page](https://meshtastic.org/docs/getting-started/serial-drivers/esp32/)).
- **Antenna** on before powering the board.
- **Still not detected:** hold BOOT while plugging in.

## Privacy

- No cookies, `localStorage`, analytics, beacons or third-party scripts.
- Loading the page makes no requests beyond its own files (HTML, JS, CSS, fonts).
- The page contacts two hosts, and only after you press a button:
  - `api.meshtastic.org`: which firmware is the current beta.
  - `release.meshtastic.org`: the firmware files, and only for "Erase, flash & configure".
- Requests send no referrer and no credentials.
- Names, PIN, WiFi password and channel keys go over USB to your radio and nowhere else.
- A `Content-Security-Policy` in `index.html` enforces all of this: `default-src 'none'`, `script-src 'self'`, and `connect-src` limited to the two hosts above. Any other request is blocked by the browser. `tests/csp_probe.py` checks this.

## Auditing what you're running

1. **Source:** this repo. All of the app's own code is in `src/`. The board list and tested firmware version are in `data/`.
2. **Build:** GitHub Actions builds from a tagged commit (`.github/workflows/pages.yml`, actions pinned to commit SHAs) and deploys to GitHub Pages.
3. **Provenance:** each deploy publishes a signed build attestation for `index.html`, `app.js` and `app.css`. Check one with:
   ```sh
   curl -sO https://<pages-host>/app.js
   gh attestation verify app.js --repo davidmarcantonio/meshnewb
   ```
4. **Reproduce:** `app.js` contains no timestamps or commit info, so the same commit always builds to the same bytes:
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

`src/communities.js`. Each entry links its source page and the date it was checked. Communities that publish no settings are listed but can't be selected. Settings change, so pull requests with a source link are welcome.

## Tests

`npm test` builds the app and a fake Meshtastic node (a mocked `navigator.serial` that speaks the real framed protobuf protocol). It then runs end-to-end scenarios in headless Chrome with the CSP enforced, and checks that the CSP blocks unlisted hosts. Needs Python 3 + Playwright and a Chrome at `/usr/bin/google-chrome`.

## License

GPL-3.0-only, because the bundled `@meshtastic/core` and `@meshtastic/transport-web-serial` are GPL-3.0-only. `esptool-js` and `@bufbuild/protobuf` are Apache-2.0. Inter and JetBrains Mono are OFL-1.1.

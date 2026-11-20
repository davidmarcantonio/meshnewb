# "See how a radio is set" page, against the fake node. Run after build + build:fake-node.
import base64, json, subprocess, time
from playwright.sync_api import sync_playwright
srv = subprocess.Popen(["python3","-m","http.server","8766","--directory","dist"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(1)
fake = open("tests/fake-node.bundle.js").read()
URL = "http://localhost:8766"
KEY = [7] * 32
KEY_B64 = base64.b64encode(bytes(KEY)).decode()
SETUP = {"lora": {"region": 1, "modemPreset": 0, "hopLimit": 3},
         "network": {"wifiEnabled": True, "wifiSsid": "HomeNet", "wifiPsk": "hunter2secret"},
         "bluetooth": {"mode": 1, "fixedPin": 123456},
         "channels": [{"index": 1, "role": 2, "name": "SmithFam", "psk": KEY, "positionPrecision": 32}]}
try:
  with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    def page(opts=None, path="/check/"):
      pg = b.new_page(viewport={"width": 1200, "height": 1400})
      pg.errs = []; pg.on("pageerror", lambda e: pg.errs.append(str(e)))
      pg.csp = []; pg.on("console", lambda m: ("Content Security Policy" in m.text or "Refused" in m.text) and pg.csp.append(m.text))
      if opts is not None: pg.add_init_script("window.__fakeOpts = " + json.dumps(opts))
      pg.add_init_script(fake); pg.goto(URL + path); pg.wait_for_timeout(400)
      return pg
    def read(pg, pattern, timeout=30000):
      pg.click("#btn-check")
      pg.wait_for_function("(re) => new RegExp(re).test(document.querySelector('#check-status').textContent)", arg=pattern, timeout=timeout)
      return pg.inner_text("#check-status")
    DONE = "Nothing was changed"

    # picker: third card, still no scripts
    pg = b.new_page(); pg.goto(URL + "/"); pg.wait_for_timeout(300)
    links = [a.get_attribute("href") for a in pg.locator("a.choice").all()]
    assert links == ["radio/", "family/", "check/"], links
    assert pg.locator("script").count() == 0
    print("picker links:", links)

    # the page shows only its own parts
    pg = page(SETUP)
    assert pg.is_hidden("#btn-full") and pg.is_hidden("#btn-fam-push") and pg.is_hidden("#longname") and pg.is_hidden("#log"), "other pages' parts are showing"
    assert pg.is_visible("#btn-check") and pg.inner_text("#check-out") == ""
    assert "see how a radio is set" in pg.inner_text("header.site h1:visible")

    # a configured radio: everything on the list, no secrets anywhere in the document, nothing written
    status = read(pg, DONE)
    out = pg.inner_text("#check-out")
    for want in ["Heltec V3", "ESP32", "Meshtastic 3c4d", "2.7.26", "Up to date", "US", "LongFast", "CLIENT", "SmithFam", "private key", "default key", "HomeNet", "Fixed PIN set"]:
      assert want in out, f"missing {want!r} in:\n{out}"
    html = pg.evaluate("() => document.documentElement.outerHTML")
    for secret in ["hunter2secret", "123456", KEY_B64, "7,7,7,7"]:
      assert secret not in html, f"secret {secret!r} is in the page"
    assert pg.evaluate("() => window.__fakeNode.adminLog.length") == 0, "the check wrote to the radio"
    assert pg.is_hidden("#check-flags"), pg.inner_text("#check-flags")
    print("configured:", status, "|", out.replace("\n", " / ")[:400])
    # the port is released: a second read works
    assert DONE in read(pg, DONE)
    assert pg.errs == [] and pg.csp == [], (pg.errs, pg.csp)

    # old firmware: flagged, with a way to the setup page
    pg = page({**SETUP, "fw": "2.7.10.abc"}); read(pg, DONE)
    flags = pg.inner_text("#check-flags")
    assert "Update" in flags and "2.7.10" in flags, flags
    assert pg.locator("#check-flags a").first.get_attribute("href") == "../radio/"
    print("old firmware:", flags.replace("\n", " / "))

    # blank radio
    pg = page({}); read(pg, DONE)
    assert "No region" in pg.inner_text("#check-flags")
    assert "Not set" in pg.inner_text("#check-out")

    # exact location on the public channel, and MQTT uplink of it
    pg = page({"lora": {"region": 1}, "mqtt": {"enabled": True}, "channels": [{"index": 0, "role": 1, "psk": [1], "uplinkEnabled": True, "positionPrecision": 32}]}); read(pg, DONE)
    flags = pg.inner_text("#check-flags")
    assert "exact location" in flags and "MQTT" in flags, flags

    # names from the radio are text, never markup
    evil = "<img src=x onerror=window.__pwned=1>"
    pg = page({**SETUP, "user": {"longName": evil}, "channels": [{"index": 1, "role": 2, "name": "<b>x</b>", "psk": KEY}]}); read(pg, DONE)
    assert evil in pg.inner_text("#check-out") and "<b>x</b>" in pg.inner_text("#check-out")
    assert pg.evaluate("() => window.__pwned") is None and pg.locator("#check-out img, #check-out b").count() == 0
    print("markup in names shown as text")

    # nothing answering
    pg = page({"mute": True}); s = read(pg, "nothing to read|Nothing to read", 25000)
    assert "nothing to read" in s.lower() and pg.inner_text("#check-out") == "", s
    assert pg.is_enabled("#btn-check")
    print("silent:", s)

    # nRF52 in update mode: say so, don't try to talk to it
    pg = page({"usb": {"usbVendorId": 0x239a, "usbProductId": 0x0029}}); s = read(pg, "update mode", 5000)
    assert pg.evaluate("() => window.__fakeNode.lastNonce") is None, "tried to talk to a board in update mode"
    print("update mode:", s)

    # port picker closed
    pg = page({"noPick": True}); s = read(pg, "No device picked", 5000)
    assert pg.is_enabled("#btn-check")
    print("no pick:", s)

    # the page takes nothing from its own address
    pg = page(SETUP, "/check/?name=Evil&fw=1.0#CgcSAQEaBEV2aWw")
    assert pg.inner_text("#check-out") == "" and pg.inner_text("#check-status") == ""
    read(pg, DONE); assert "Evil" not in pg.inner_text("#check-out")

    # the other two pages still hide the check panel
    for path in ["/radio/", "/family/"]:
      pg = page({}, path); assert pg.is_hidden("#btn-check"), path
      assert pg.errs == [], pg.errs
    print("check page: all passed")
    b.close()
finally:
  srv.terminate()

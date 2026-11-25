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
    def page(opts=None, path="/check/", api_fw="2.7.26.54e0d8d"):
      pg = b.new_page(viewport={"width": 1200, "height": 1400})
      pg.errs = []; pg.on("pageerror", lambda e: pg.errs.append(str(e)))
      pg.csp = []; pg.on("console", lambda m: ("Content Security Policy" in m.text or "Refused" in m.text) and pg.csp.append(m.text))
      pg.ext = []; pg.on("request", lambda r: r.url.startswith(URL) or pg.ext.append(r.url))
      pg.route("https://api.meshtastic.org/github/firmware/list", lambda r: r.fulfill(json={"releases": {"stable": [{"id": "v" + api_fw}]}}))
      if opts is not None: pg.add_init_script("window.__fakeOpts = " + json.dumps(opts))
      pg.add_init_script(fake); pg.goto(URL + path); pg.wait_for_selector(".pagetabs [aria-selected=true]"); pg.wait_for_timeout(300)
      return pg
    def read(pg, pattern, timeout=30000):
      pg.click("#btn-check")
      pg.wait_for_function("(re) => new RegExp(re).test(document.querySelector('#check-status').textContent)", arg=pattern, timeout=timeout)
      return pg.inner_text("#check-status")
    DONE = "Nothing was changed"

    # one page, three tabs. The home page opens on "Set up a radio"; a tab click swaps the parts in place.
    sel = lambda pg: [t.get_attribute("aria-selected") for t in pg.locator(".pagetabs button").all()]
    pg = page({}, "/")
    assert [t.get_attribute("data-tab") for t in pg.locator(".pagetabs button").all()] == ["radio", "family", "check"]
    assert sel(pg) == ["true", "false", "false"] and pg.is_visible("#btn-full") and pg.is_hidden("#btn-check")
    assert pg.locator("header.site h1:visible").count() == 1 and "get your radios talking" in pg.inner_text("header.site h1:visible")
    assert pg.locator("a.choice").count() == 0 and "MeshNewb home" not in pg.inner_text("body")
    pg.wait_for_function("() => document.querySelector('#state').options.length > 1", timeout=5000)   # community list loads from the home page
    assert "Set up a radio." in pg.inner_text(".tabintro")
    pg.click(".pagetabs [data-tab=check]")
    assert sel(pg) == ["false", "false", "true"] and pg.is_visible("#btn-check") and pg.is_hidden("#btn-full") and pg.is_hidden("#btn-fam-new")
    assert "See how a radio is set." in pg.inner_text(".tabintro") and "Set up a radio." not in pg.inner_text(".tabintro")
    pg.click(".pagetabs [data-tab=family]")
    assert sel(pg) == ["false", "true", "false"] and pg.is_visible("#btn-fam-new") and pg.is_hidden("#btn-check")
    pg.focus(".pagetabs [data-tab=family]"); pg.keyboard.press("ArrowRight")
    assert sel(pg) == ["false", "false", "true"], "arrow keys move between tabs"
    assert pg.errs == [] and pg.csp == [] and pg.ext == [], (pg.errs, pg.csp, pg.ext)
    # old addresses still work and open on their own tab
    for path, want in [("/radio/", ["true", "false", "false"]), ("/family/", ["false", "true", "false"]), ("/check/", ["false", "false", "true"])]:
      assert sel(page({}, path)) == want, path
    # a tab choice never comes from the address
    assert sel(page({}, "/?tab=check#check")) == ["true", "false", "false"]
    # the column sits in the middle of a wide window, and the tabs line up with the panels
    wide = b.new_page(viewport={"width": 1800, "height": 900}); wide.goto(URL + "/"); wide.wait_for_timeout(300)
    box = wide.evaluate("() => ['.pagetabs', 'main', '#prereq'].map((s) => { const r = document.querySelector(s).getBoundingClientRect(); return [Math.round(r.left), Math.round(innerWidth - r.right)]; })")
    assert all(abs(l - r) <= 1 for l, r in box) and len({tuple(x) for x in box}) == 1 and box[0][0] > 300, box
    # reading a radio from the Check tab, then switching: the community list still loads, and the fix-it link stays on this page
    pg = page({**SETUP, "fw": "2.7.10.abc"}, "/check/"); read(pg, DONE)
    pg.click("#check-flags a"); pg.wait_for_timeout(200)
    assert pg.url == URL + "/check/" and sel(pg) == ["true", "false", "false"] and pg.is_visible("#btn-full")
    pg.wait_for_function("() => document.querySelector('#state').options.length > 1", timeout=5000)
    # tabs are locked while the page is talking to a radio
    pg = page({**SETUP, "slowFirstMs": 14000}, "/check/"); pg.click("#btn-check"); pg.wait_for_timeout(1500)
    assert all(t.is_disabled() for t in pg.locator(".pagetabs button").all()), "tabs should be locked mid-read"
    pg.wait_for_function("() => /Nothing was changed/.test(document.querySelector('#check-status').textContent)", timeout=45000)
    assert all(t.is_enabled() for t in pg.locator(".pagetabs button").all())
    print("tabs: all passed")

    # the page shows only its own parts
    pg = page(SETUP)
    assert pg.is_hidden("#btn-full") and pg.is_hidden("#btn-fam-new") and pg.is_hidden("#longname") and pg.is_hidden("#log"), "other pages' parts are showing"
    assert pg.is_visible("#btn-check") and pg.inner_text("#check-out") == ""
    assert "See how a radio is set." in pg.inner_text(".tabintro")
    # the page is honest about what leaves the tab: the settings don't, one version lookup does
    head = pg.inner_text("header.site"); teaser = pg.inner_text(".privacy-teaser")
    assert "nothing leaves this tab" not in head and "current firmware version" in head, head
    assert "only when you press Flash" not in teaser and "current firmware version" in teaser, teaser
    assert pg.ext == [], pg.ext

    # a configured radio: everything on the list, no secrets anywhere in the document, nothing written
    status = read(pg, DONE)
    out = pg.inner_text("#check-out")
    for want in ["Heltec V3", "ESP32", "Meshtastic 3c4d", "2.7.26", "Up to date", "US", "LongFast", "CLIENT", "SmithFam", "private key", "default key", "HomeNet", "Off while WiFi is on"]:
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
    assert set(pg.ext) == {"https://api.meshtastic.org/github/firmware/list"}, pg.ext

    # "current" comes from Meshtastic's list, not from what this site was built with
    pg = page(SETUP, api_fw="2.8.1.abcdef0"); read(pg, DONE)
    assert "2.8.1" in pg.inner_text("#check-flags") and "Out of date" in pg.inner_text("#check-out")

    # a radio that answers slowly is given more time, and is never called blank
    pg = page({**SETUP, "slowFirstMs": 14000}); pg.click("#btn-check")
    pg.wait_for_function("() => /more time/.test(document.querySelector('#check-status').textContent)", timeout=20000)
    pg.wait_for_function("() => /Nothing was changed/.test(document.querySelector('#check-status').textContent)", timeout=40000)
    assert "SmithFam" in pg.inner_text("#check-out")
    pg = page({**SETUP, "stall": True}); s = read(pg, "didn't finish", 60000)
    assert "nothing to read" not in s.lower() and "install" not in s.lower() and pg.is_enabled("#btn-check"), s
    print("stalled:", s)

    # old firmware: flagged, with a way to the setup page
    pg = page({**SETUP, "fw": "2.7.10.abc"}); read(pg, DONE)
    flags = pg.inner_text("#check-flags")
    assert "Bluetooth" not in flags
    assert "Update" in flags and "2.7.10" in flags, flags
    assert pg.locator("#check-flags a").first.get_attribute("href") == "../radio/"
    print("old firmware:", flags.replace("\n", " / "))

    # fixed PIN: said to be set, digits never shown
    pg = page({"lora": {"region": 1}, "bluetooth": {"mode": 1, "fixedPin": 654321}}); read(pg, DONE)
    assert "Fixed PIN set" in pg.inner_text("#check-out") and "654321" not in pg.evaluate("() => document.documentElement.outerHTML")

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
    # footer on every page: the M-Powered badge (Meshtastic's own file, unaltered) linked to meshtastic.org, and the trademark line
    import hashlib
    src = hashlib.sha256(open("assets/m-powered.svg", "rb").read()).hexdigest()
    assert src == "298baec165feb7576bb26bcf9c45d6882e9a6d76731b2f71de6d43ae1708ddca", "assets/m-powered.svg differs from Meshtastic's published file"
    assert hashlib.sha256(open("dist/m-powered.svg", "rb").read()).hexdigest() == src
    for path in ["/", "/radio/", "/family/", "/check/"]:
      pg = page({}, path)
      a = pg.locator("footer.site a.badge")
      assert a.get_attribute("href") == "https://meshtastic.org/", path
      assert pg.evaluate("() => { const i = document.querySelector('footer.site a.badge img'); return i.complete && i.naturalWidth > 0 && i.alt; }") == "Powered by Meshtastic", path
      foot = pg.inner_text("footer.site")
      assert "Meshtastic\u00ae is a registered trademark of Meshtastic LLC." in foot and "not affiliated with or endorsed by" in foot, foot
      assert pg.csp == [] and pg.ext == [], (path, pg.csp, pg.ext)
    print("check page: all passed")
    b.close()
finally:
  srv.terminate()

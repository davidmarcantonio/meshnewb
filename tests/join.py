# "Join a local mesh" tab, against the fake node. Run after build + build:fake-node.
# The rule under test: only mesh settings are written. Name, Bluetooth/WiFi, PIN and private channels are never touched.
import json, subprocess, time
from playwright.sync_api import sync_playwright
srv = subprocess.Popen(["python3","-m","http.server","8767","--directory","dist"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(1)
fake = open("tests/fake-node.bundle.js").read()
URL = "http://localhost:8767"
KEY = [7] * 32
MINE = {"user": {"longName": "MapleCut 45", "shortName": "MC45"},
        "lora": {"region": 1, "modemPreset": 0, "channelNum": 0, "hopLimit": 3, "txPower": 17},
        "device": {"role": 1},
        "bluetooth": {"mode": 1, "fixedPin": 654321},
        "channels": [{"index": 1, "role": 2, "name": "SmithFam", "psk": KEY, "positionPrecision": 32}]}
NODE = """() => { const n = window.__fakeNode; return { names:[n.user.longName,n.user.shortName], role:n.config.device.role,
  lora:[n.config.lora.region,n.config.lora.modemPreset,n.config.lora.channelNum,n.config.lora.hopLimit,n.config.lora.txPower],
  bt:[n.config.bluetooth.enabled,n.config.bluetooth.mode,n.config.bluetooth.fixedPin], wifi:n.config.network.wifiEnabled,
  chans:Object.values(n.channels).map(c => [c.index, c.role, c.settings.name, c.settings.psk.length]), admin:n.adminLog.join(',') } }"""
try:
  with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    def page(opts, path="/join/", api_fw="2.7.26.54e0d8d"):
      pg = b.new_page(viewport={"width": 1200, "height": 1400})
      pg.errs = []; pg.on("pageerror", lambda e: pg.errs.append(str(e)))
      pg.csp = []; pg.on("console", lambda m: ("Content Security Policy" in m.text or "Refused" in m.text) and pg.csp.append(m.text))
      pg.route("https://api.meshtastic.org/github/firmware/list", lambda r: r.fulfill(json={"releases": {"stable": [{"id": "v" + api_fw}]}}))
      pg.add_init_script("window.__fakeOpts = " + json.dumps(opts)); pg.add_init_script(fake)
      pg.goto(URL + path); pg.wait_for_selector(".pagetabs [aria-selected=true]")
      return pg
    def pick(pg, slug, use=None):
      pg.wait_for_function("() => document.querySelector('#state').options.length > 1", timeout=5000)
      pg.select_option("#state", "CA"); pg.select_option("#community", f"us/ca/{slug}")
      pg.wait_for_selector("#c-card:not([hidden]), #c-listed:not([hidden])", timeout=5000)
      if use: pg.select_option("#usecase", use)
    def done(pg): pg.wait_for_function("() => /Verification passed|didn't stick/.test(document.querySelector('#log').textContent)", timeout=90000)

    # the tab shows the community picker and one button; nothing personal, no flashing, no mode tabs
    pg = page(MINE)
    assert pg.is_visible("#state") and pg.is_visible("#btn-join") and "Join a local mesh." in pg.inner_text(".tabintro")
    for sel in ["#longname", "#pin", "#ssid", "#btn-full", "#btn-config", "#btn-fam-new", "#btn-check", "#btn-reset", "[data-mode=manual]", "#board"]:
      assert pg.is_hidden(sel), sel + " is showing on the join tab"
    heads = [h.inner_text().replace("\n", " ") for h in pg.locator("main h2").all() if h.is_visible()]
    assert any(h.startswith("01") and "local mesh" in h.lower() for h in heads) and any(h.startswith("02") and "apply" in h.lower() for h in heads), heads
    # nothing picked: says so, sends nothing
    pg.click("#btn-join"); pg.wait_for_timeout(300)
    assert "Pick your state and community first." in pg.inner_text("#log") and pg.evaluate(NODE)["admin"] == ""
    # BayMe.sh, everyday use: MediumFast, slot 45, 6 hops, role as published. Everything personal is as it was.
    before = pg.evaluate(NODE)
    pick(pg, "baymesh", "everyday"); pg.click("#btn-join"); done(pg)
    after = pg.evaluate(NODE); log = pg.inner_text("#log")
    print(log); print("verify:", pg.inner_text("#verify").replace("\t", " ")); print("node:", json.dumps(after))
    assert "Verification passed" in log, log
    assert after["lora"] == [1, 4, 45, 6, 17], after["lora"]          # preset, slot, hops changed; TX power kept
    assert after["role"] == 0                                           # BayMe.sh publishes a role for this use
    assert after["names"] == before["names"] == ["MapleCut 45", "MC45"]
    assert after["bt"] == before["bt"] == [True, 1, 654321] and after["wifi"] == before["wifi"]
    assert after["chans"] == before["chans"], (before["chans"], after["chans"])
    assert "setOwner" not in after["admin"] and "owner" not in log and "Bluetooth: fixed PIN" not in log
    assert "not changed" in pg.inner_text("#verify")
    assert pg.errs == [] and pg.csp == [], (pg.errs, pg.csp)

    # a group that publishes no role or hop limit: the radio keeps its own
    import glob
    bare = [f for f in sorted(glob.glob("tests/fixtures/presets/us/ca/*.json")) if (lambda j: j["status"] == "published" and not any("roleNum" in u or "hopLimit" in u for u in j.get("uses", {}).values()))(json.load(open(f)))]
    if bare:
      slug = bare[0].split("/")[-1][:-5]; j = json.load(open(bare[0]))
      pg = page({**MINE, "lora": {**MINE["lora"], "hopLimit": 5}}); pick(pg, slug); pg.click("#btn-join"); done(pg)
      after = pg.evaluate(NODE); print(f"{slug}:", json.dumps(after))
      assert "Verification passed" in pg.inner_text("#log"), pg.inner_text("#log")
      assert after["role"] == 1 and after["lora"][3] == 5 and after["lora"][1] == j["lora"]["modemPresetNum"], after
      assert after["names"] == ["MapleCut 45", "MC45"] and after["bt"] == [True, 1, 654321]
    else: print("no fixture without a published role/hop limit; skipped that case")

    # a listed group with no published settings: refuses, sends nothing
    listed = [f for f in sorted(glob.glob("tests/fixtures/presets/us/ca/*.json")) if json.load(open(f))["status"] == "listed"]
    if listed:
      pg = page(MINE); pick(pg, listed[0].split("/")[-1][:-5]); pg.click("#btn-join"); pg.wait_for_timeout(300)
      assert "There is no preset for" in pg.inner_text("#log") and pg.evaluate(NODE)["admin"] == ""

    # coming from Set up a radio left in Manual mode: the join tab still shows the picker, and still writes mesh settings only
    pg = page(MINE, "/radio/"); pg.click("[data-mode=manual]"); assert pg.is_visible("#region")
    pg.click(".pagetabs [data-tab=join]")
    assert pg.is_visible("#state") and pg.is_hidden("#region") and pg.is_hidden("#longname")
    pick(pg, "baymesh", "everyday"); pg.click("#btn-join"); done(pg)
    assert pg.evaluate(NODE)["names"] == ["MapleCut 45", "MC45"] and pg.evaluate(NODE)["lora"][:3] == [1, 4, 45]
    pg.click(".pagetabs [data-tab=radio]"); assert pg.is_visible("#region"), "Set up a radio should come back in the mode it was left in"

    # out-of-date firmware: stops first; the update button leads to Set up a radio, "Apply anyway" applies mesh settings only
    pg = page({**MINE, "fw": "2.7.10.abc"}); pick(pg, "baymesh", "everyday"); pg.click("#btn-join")
    pg.wait_for_selector("#fw-gate:not([hidden])", timeout=30000)
    assert pg.evaluate(NODE)["admin"] == "" and pg.inner_text("#btn-fw-anyway") == "Apply anyway" and "Set up a radio" in pg.inner_text("#btn-fw-update")
    pg.click("#btn-fw-anyway"); done(pg)
    after = pg.evaluate(NODE)
    assert after["lora"][:4] == [1, 4, 45, 6] and after["names"] == ["MapleCut 45", "MC45"] and after["bt"] == [True, 1, 654321], after
    pg = page({**MINE, "fw": "2.7.10.abc"}); pick(pg, "baymesh", "everyday"); pg.click("#btn-join")
    pg.wait_for_selector("#fw-gate:not([hidden])", timeout=30000); pg.click("#btn-fw-update"); pg.wait_for_timeout(300)
    assert pg.get_attribute(".pagetabs [data-tab=radio]", "aria-selected") == "true" and pg.is_visible("#btn-full") and pg.evaluate(NODE)["admin"] == ""

    # nothing comes from the address
    pg = page(MINE, "/join/?state=CA&community=us/ca/baymesh#baymesh"); pg.wait_for_function("() => document.querySelector('#state').options.length > 1", timeout=5000)
    assert pg.input_value("#state") == "" and pg.is_hidden("#c-card")
    pg = page(MINE); pick(pg, "baymesh", "everyday"); pg.locator("main").screenshot(path="/tmp/join.png")
    print("join page: all passed")
    b.close()
finally: srv.terminate()

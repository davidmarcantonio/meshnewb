# "Set up a radio" for newcomers, against the fake node. Run after build + build:fake-node.
# The rules under test: the name and PIN are filled in on arrival; "Set up my radio" looks at the radio first and
# never erases on that press alone; nothing installs until the page knows which radio it is.
import json, re, subprocess, time
from playwright.sync_api import sync_playwright
srv = subprocess.Popen(["python3","-m","http.server","8768","--directory","dist"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(1)
fake = open("tests/fake-node.bundle.js").read()
URL = "http://localhost:8768"
ADMIN = "() => window.__fakeNode.adminLog.join(',')"
try:
  with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    def page(opts=None, api_fw="2.7.26.54e0d8d", width=1200):
      pg = b.new_page(viewport={"width": width, "height": 1400})
      pg.errs = []; pg.on("pageerror", lambda e: pg.errs.append(str(e)))
      pg.csp = []; pg.on("console", lambda m: ("Content Security Policy" in m.text or "Refused" in m.text) and pg.csp.append(m.text))
      pg.ext = []; pg.on("request", lambda r: r.url.startswith(URL) or pg.ext.append(r.url))
      pg.route("https://api.meshtastic.org/github/firmware/list", lambda r: r.fulfill(json={"releases": {"stable": [{"id": "v" + api_fw}]}}))
      pg.route("https://release.meshtastic.org/**", lambda r: r.abort())
      pg.add_init_script("window.__fakeOpts = " + json.dumps(opts or {})); pg.add_init_script(fake)
      pg.goto(URL + "/"); pg.wait_for_selector(".pagetabs [aria-selected=true]"); pg.wait_for_timeout(300)
      return pg

    # ---- on arrival: a made-up name and a PIN are already there, and nothing has gone out ----
    pg = page()
    name, shortn, pin = pg.input_value("#longname"), pg.input_value("#shortname"), pg.input_value("#pin")
    assert re.fullmatch(r"[A-Z][a-z]+[A-Z][a-z]+ \d\d", name), name
    assert re.fullmatch(r"[A-Z]{2}\d\d", shortn) and shortn[2:] == name[-2:], (name, shortn)
    assert re.fullmatch(r"\d{6}", pin), pin
    assert pg.inner_text("#short-show") == shortn and pg.is_hidden("#shortname"), "short name is tucked away but shown"
    assert pin not in pg.evaluate("() => document.documentElement.outerHTML"), "the PIN is typed into the field, never written into the page"
    # the short name follows the radio name until the user types their own
    pg.fill("#longname", "Kitchen Radio 07"); assert pg.input_value("#shortname") == "KR07" and pg.inner_text("#short-show") == "KR07"
    pg.fill("#longname", "garage"); assert pg.input_value("#shortname") == "gara"
    pg.evaluate("() => { document.querySelector('#short-row').open = true; }"); pg.fill("#shortname", "GRG"); pg.fill("#longname", "Garage Two 22")
    assert pg.input_value("#shortname") == "GRG", "a typed short name is kept"
    pg.click("#btn-name"); assert re.fullmatch(r"[A-Z]{2}\d\d", pg.input_value("#shortname")), "Pick another resets both"
    old = pg.input_value("#pin"); pg.click("#btn-genpin"); assert re.fullmatch(r"\d{6}", pg.input_value("#pin"))
    # what a newcomer sees first: one main button per step, the expert controls folded away, no empty log
    for sel in ["#btn-detect", "#btn-go", "#btn-full", "#btn-config", "#longname", "#pin"]: assert pg.is_visible(sel), sel
    for sel in ["#board", "#baud", "#localbin", "#log", "#progress", "#go-confirm", "#done", "#fw-gate"]: assert pg.is_hidden(sel), sel + " should not show yet"
    assert pg.input_value("#board") == "", "no radio model is assumed"
    assert all("(" not in t for t in pg.locator("#board option").all_inner_texts()), "board names carry no build ids"
    body = pg.inner_text("body")
    for jargon in ["Flash baud", "ESP32 family", "CP210x, USB JTAG", "Configure only", "Erase, flash"]: assert jargon not in body, jargon
    assert pg.locator("#prereq .checklist li").count() == 3
    assert pg.ext == [] and pg.errs == [] and pg.csp == [], (pg.ext, pg.errs, pg.csp)
    print("arrival: all passed |", name, shortn)

    # ---- an up-to-date radio: one press applies the settings and ends with what to do on the phone ----
    pg = page()
    name, shortn, pin = pg.input_value("#longname"), pg.input_value("#shortname"), pg.input_value("#pin")
    pg.click("#btn-go")
    pg.wait_for_selector("#done:not([hidden])", timeout=90000)
    n = pg.evaluate("() => { const n = window.__fakeNode; return { names: [n.user.longName, n.user.shortName], bt: [n.config.bluetooth.mode, n.config.bluetooth.fixedPin], region: n.config.lora.region, admin: n.adminLog.join(',') } }")
    assert n["names"] == [name, shortn] and n["bt"] == [1, int(pin)] and n["region"] == 1, n
    assert "factoryReset" not in n["admin"] and n["admin"].endswith("commitEditSettings"), n
    done = pg.inner_text("#done")
    assert pin in done and shortn in done and "Meshtastic app" in done, done
    assert "Found: Heltec V3" in pg.inner_text("#detect-result") and pg.input_value("#board") == "heltec-v3"
    assert pg.is_visible("#log") and pg.is_visible("#verify") and pg.errs == [] and pg.csp == [], (pg.errs, pg.csp)
    assert set(pg.ext) == {"https://api.meshtastic.org/github/firmware/list"}, pg.ext
    print("up to date: all passed |", done.replace("\n", " / ")[:160])

    # ---- an out-of-date radio: the page stops and asks; nothing was changed, nothing erased ----
    pg = page({"fw": "2.7.10.94d4bdf"})
    pg.click("#btn-go"); pg.wait_for_selector("#fw-gate:not([hidden])", timeout=60000)
    assert pg.evaluate(ADMIN) == "" and pg.is_hidden("#done") and pg.is_hidden("#go-confirm")
    assert pg.inner_text("#btn-fw-update") == "Erase and install the update" and pg.inner_text("#btn-fw-anyway") == "Apply settings anyway"
    print("out of date: all passed |", pg.inner_text("#fw-gate-text"))

    # ---- a radio with no Meshtastic answering (new or blank) ----
    # The page can't tell which radio it is: it opens the list and installs nothing.
    pg = page({"mute": True})
    pg.click("#btn-go")
    pg.wait_for_function("() => /can't tell which radio/.test(document.querySelector('#log').textContent)", timeout=60000)
    assert pg.is_visible("#board") and pg.is_hidden("#go-confirm") and pg.ext == [], pg.ext
    # Once the radio is picked, the page asks before erasing. Pressing "Not now" leaves everything alone.
    pg.select_option("#board", "heltec-v3"); pg.click("#btn-go"); pg.wait_for_selector("#go-confirm:not([hidden])", timeout=60000)
    ask = pg.inner_text("#go-confirm")
    assert "erases everything" in ask and "Heltec V3" in ask, ask
    assert pg.ext == [], "no firmware is fetched before the user agrees"
    pg.click("#btn-go-cancel"); assert pg.is_hidden("#go-confirm") and pg.ext == [] and pg.evaluate(ADMIN) == ""
    # Agreeing starts the install (the download is blocked in this test, which is how we see it was asked for).
    pg.click("#btn-go"); pg.wait_for_selector("#go-confirm:not([hidden])", timeout=60000); pg.click("#btn-go-install")
    pg.wait_for_function("() => document.querySelector('ol.steps li:nth-child(2)').dataset.state === 'fail'", timeout=30000)
    assert any(u.startswith("https://release.meshtastic.org/") and "heltec-v3" in u for u in pg.ext), pg.ext
    print("blank radio: all passed |", ask.replace("\n", " / ")[:200])

    # ---- "Erase and install fresh" with no radio model known: refused before anything is fetched ----
    pg = page()
    pg.click("#btn-full"); pg.wait_for_function("() => /Which radio is it/.test(document.querySelector('#log').textContent)")
    assert pg.is_visible("#board") and pg.ext == [] and pg.evaluate(ADMIN) == ""
    print("no model: refused")

    # ---- nothing picked in the browser's device list: the fixes open, nothing else happens ----
    pg = page({"noPick": True})
    assert not pg.evaluate("() => document.querySelector('#trouble').open")
    pg.click("#btn-go"); pg.wait_for_function("() => /Couldn't find a radio/.test(document.querySelector('#log').textContent)")
    assert pg.evaluate("() => document.querySelector('#trouble').open") and "another USB cable" in pg.inner_text("#detect-result")
    print("no device: fixes shown")

    # ---- a T-Echo with no Meshtastic running: it installs by drag-and-drop, so the page shows those steps ----
    pg = page({"mute": True, "pioEnv": "t-echo", "usb": {"usbVendorId": 0x239a, "usbProductId": 0x4405}})
    pg.click("#btn-go"); pg.wait_for_function("() => /drag-and-drop/.test(document.querySelector('#log').textContent)", timeout=60000)
    assert pg.is_visible("#nrf-steps") and pg.is_hidden("#go-confirm") and pg.ext == []
    print("drag-and-drop radio: steps shown")

    # ---- a phone-width window: nothing spills sideways ----
    pg = page(width=390)
    assert pg.evaluate("() => document.documentElement.scrollWidth <= innerWidth"), pg.evaluate("() => [document.documentElement.scrollWidth, innerWidth]")
    print("narrow: fits")
    b.close()
finally:
  srv.terminate()

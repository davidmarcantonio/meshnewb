import json, subprocess, time, sys
from playwright.sync_api import sync_playwright
URL_CH = sys.argv[1]
srv = subprocess.Popen(["python3","-m","http.server","8765","--directory","dist"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
fake = open("tests/fake-node.bundle.js").read()
FW = {"releases":{"stable":[{"id":"v2.7.26.54e0d8d"}],"alpha":[]}}
HW = [{"displayName":"Heltec V3","platformioTarget":"heltec-v3","architecture":"esp32-s3","activelySupported":True}]
DONE = "['2','3','4'].some(n=>document.querySelector(`[data-step=\"${n}\"]`).dataset.state==='fail') || document.querySelector('[data-step=\"4\"]').dataset.state==='done' || document.querySelectorAll('#log .err').length>0 || !document.querySelector('#fw-gate').hidden"
def scenario(name, fill, shot=None, opts=None, after=None):
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
        pg = b.new_page(viewport={"width":1400,"height":1500})
        errs=[]; pg.on("pageerror", lambda e: errs.append(str(e)))
        reqs=[]; pg.on("request", lambda r: reqs.append(r.url))
        csp=[]; pg.on("console", lambda m: ("Content Security Policy" in m.text or "Refused" in m.text) and csp.append(m.text))
        pg.route("https://api.meshtastic.org/github/firmware/list", lambda r: r.fulfill(json=FW))
        pg.route("https://api.meshtastic.org/resource/deviceHardware", lambda r: r.fulfill(json=HW))
        if opts: pg.add_init_script("window.__fakeOpts = " + json.dumps(opts))
        pg.add_init_script(fake)
        pg.goto("http://localhost:8765/radio/index.html"); pg.wait_for_timeout(600)
        load_reqs = list(reqs)
        fill(pg)
        if shot: pg.screenshot(path=shot, full_page=True)
        pg.click("#btn-config")
        for _ in range(180):
            if pg.evaluate("() => " + DONE): break
            pg.wait_for_timeout(500)
        node = pg.evaluate("""() => { const n = window.__fakeNode; const L=n.config.lora,D=n.config.device,P=n.config.position;
          return { region:L.region, preset:L.modemPreset, usePreset:L.usePreset, slot:L.channelNum, hops:L.hopLimit, tx:L.txPower, txEn:L.txEnabled, okMqtt:L.configOkToMqtt, bw:L.bandwidth,
            role:D.role, nodeinfo:D.nodeInfoBroadcastSecs, pos:P.positionBroadcastSecs, smart:P.positionBroadcastSmartEnabled, telem:n.module.telemetry.deviceUpdateInterval,
            bt:[n.config.bluetooth.mode,n.config.bluetooth.fixedPin], wifi:[n.config.network.wifiEnabled,n.config.network.wifiSsid],
            names:[n.user.longName,n.user.shortName,n.user.isLicensed], ch0:n.channels[0]&&[n.channels[0].settings.name, btoa(String.fromCharCode(...n.channels[0].settings.psk))], chans:Object.keys(n.channels).length, admin:n.adminLog.join(',') } }""")
        if after: after(pg)
        print(f"\n===== {name} =====  pageerrors={errs}  csp_violations={csp}")
        print("requests on load:", [u.replace("http://localhost:8765","") for u in load_reqs])
        print("external requests total:", [u for u in reqs if not u.startswith("http://localhost")])
        print(pg.inner_text("#log"))
        if pg.is_visible("#verify"): print("--- verify ---\n"+pg.inner_text("#verify"))
        print("--- node ---", json.dumps(node))
        b.close()
def me(pg, ln="Test Node", sn="TST1", pin="246810"):
    pg.fill("#longname", ln); pg.fill("#shortname", sn); pg.fill("#pin", pin)
def pick(pg, slug, state="CA"):
    pg.click("[data-mode=community]")
    pg.select_option("#state", state); pg.select_option("#community", f"us/{state.lower()}/{slug}")
    pg.wait_for_function("() => !document.querySelector('#c-card').hidden || !document.querySelector('#c-listed').hidden")
try:
    def a(pg): me(pg); pick(pg,"baymesh"); pg.select_option("#usecase","home")
    scenario("BayMesh home base", a)
    def b_(pg): me(pg); pick(pg,"socal-mesh-longturbo"); pg.select_option("#usecase","everyday")
    scenario("SoCal LongTurbo everyday", b_)
    def c(pg):
        pg.fill("#longname","Desert Rat"); pg.fill("#shortname","DR1"); pg.click("[data-conn=wifi]"); pg.fill("#ssid","HomeNet"); pg.fill("#wifipsk","hunter2hunter2")
        pick(pg,"high-desert-mesh"); pg.select_option("#usecase","home"); pg.click("#btn-customize")
        pg.fill("#txpower","22"); pg.fill("#hops","5"); pg.click("text=Channels (blank = public default)"); pg.fill("#churl", URL_CH)
        pg.click("text=Broadcast intervals")
    scenario("Customize HD Mesh + WiFi + channel URL", c)
    def d(pg): pick(pg,"central-valley-mesh")
    scenario("Validation (nothing personal filled in)", d)
    def e(pg):
        me(pg); pick(pg,"san-diego-mesh")
        print("listed card:", pg.inner_text("#c-listed").replace("\n"," | "), "| link:", pg.get_attribute("#c-listed-link","href"), "| preset card hidden:", pg.is_hidden("#c-card"))
    scenario("Listed community (San Diego): link shown, no preset, run refused", e)
    def f(pg): me(pg); pg.click("[data-mode=community]")
    scenario("No state picked: run refused", f)
    def g(pg): me(pg)
    scenario("Standard settings (default tab): region only, firmware defaults kept", g)
    TE = {"fw":"2.7.10.94d4bdf","pioEnv":"t-echo","hasWifi":False,"usb":{"usbVendorId":0x239a,"usbProductId":0x4405}}
    def h(pg):
        me(pg); pg.click("#btn-detect"); pg.wait_for_function("() => /running firmware/.test(document.querySelector('#detect-result').textContent)")
        print("detect:", pg.inner_text("#detect-result"), "| nrf steps shown:", pg.is_visible("#nrf-steps"), "| file:", pg.inner_text("#nrf-file"))
    def h2(pg): print("gate:", pg.is_visible("#fw-gate"), pg.inner_text("#fw-gate-text"), "| anyway offered:", pg.is_visible("#btn-fw-anyway"), "| update label:", pg.inner_text("#btn-fw-update"), "| admin so far:", pg.evaluate("() => window.__fakeNode.adminLog.join(',')"))
    scenario("T-Echo on 2.7.10: detected, gate stops Configure only before any change", h, opts=TE, after=h2)
    def i(pg):
        me(pg); pg.click("#btn-config"); pg.wait_for_selector("#fw-gate:not([hidden])"); pg.click("#btn-fw-anyway")
        pg.wait_for_function("() => document.querySelector('[data-step=\"4\"]').dataset.state==='done'", timeout=60000)
        print("after Configure anyway:", pg.inner_text("#verify tr:first-child").replace("\t"," "), "| admin:", pg.evaluate("() => window.__fakeNode.adminLog.join(',')"))
    scenario("T-Echo on 2.7.10: Configure anyway goes through, table flags firmware", i, opts=TE)
    def j(pg): me(pg); pick(pg,"socal-mesh-longturbo")
    def j2(pg): print("gate:", pg.inner_text("#fw-gate-text"), "| anyway offered:", pg.is_visible("#btn-fw-anyway"))
    scenario("LongTurbo preset on 2.7.10: blocked, no Configure anyway", j, opts={"fw":"2.7.10.94d4bdf"}, after=j2)
    def k(pg): me(pg, "Prairie 63", "PR63")
    scenario("Native-USB radio (T-Echo style) drops off USB on reboot: verify still completes", k, opts={"pioEnv":"t-echo","hasWifi":False,"nativeUsb":True,"usb":{"usbVendorId":0x239a,"usbProductId":0x4405}})
    def l(pg): me(pg, "Prairie 63", "PR63")
    def l2(pg): print("nonce asked:", pg.evaluate("() => window.__fakeNode.lastNonce"))
    scenario("Radio that knows 300 others (busy mesh): config-only handshake connects at once", l, opts={"bigNodeDb":True}, after=l2)
    def m(pg): me(pg)
    scenario("Radio that opens the port but says nothing: clear message", m, opts={"mute":True})
finally:
    srv.terminate()

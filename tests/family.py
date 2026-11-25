# Family channel page and the picker, against the fake node. Run after build + build:fake-node.
import json, subprocess, time
from playwright.sync_api import sync_playwright
srv = subprocess.Popen(["python3","-m","http.server","8765","--directory","dist"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(1)
fake = open("tests/fake-node.bundle.js").read()
NODE = """() => { const n = window.__fakeNode; return { names:[n.user.longName,n.user.shortName], lora:[n.config.lora.modemPreset,n.config.lora.channelNum,n.config.lora.hopLimit],
  chans:Object.values(n.channels).map(c => [c.index, c.role, c.settings.name, btoa(String.fromCharCode(...c.settings.psk)).length, c.settings.moduleSettings && c.settings.moduleSettings.positionPrecision]), admin:n.adminLog.join(',') } }"""
try:
  with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    pg = b.new_page(viewport={"width":1200,"height":1400})
    errs=[]; pg.on("pageerror", lambda e: errs.append(str(e)))
    reqs=[]; pg.on("request", lambda r: reqs.append(r.url.replace("http://localhost:8765","")))
    csp=[]; pg.on("console", lambda m: ("Content Security Policy" in m.text or "Refused" in m.text) and csp.append(m.text))
    pg.goto("http://localhost:8765/"); pg.wait_for_timeout(300)
    print("tabs:", [t.get_attribute("data-tab") for t in pg.locator(".pagetabs button").all()], "| requests:", reqs)
    reqs.clear(); pg.add_init_script(fake); pg.goto("http://localhost:8765/family/"); pg.wait_for_timeout(600)
    print("family page requests:", reqs, "| radio parts hidden:", pg.is_hidden("#btn-full"), pg.is_hidden("#longname"), "| family visible:", pg.is_visible("#btn-fam-new"))
    # one card: no "Each radio" card, no per-radio name fields, and no commit button until a channel exists
    heads = [h.inner_text().replace("\n", " ") for h in pg.locator("section[data-only~=family] h2").all() if h.is_visible()]
    print("family cards:", heads, "| push hidden before a channel:", pg.is_hidden("#btn-fam-push"))
    assert len(heads) == 2 and heads[0].startswith("01") and heads[1].startswith("02") and "progress" in heads[1].lower(), heads
    assert pg.locator("#fam-long, #fam-short, #btn-fam-name, #btn-fam-word").count() == 0 and pg.is_hidden("#btn-fam-push")
    pg.fill("#fam-name","SmithFam"); pg.click("#btn-fam-new")
    key_before = pg.text_content("#fam-key"); link = pg.evaluate("() => null")
    print("created:", pg.inner_text("#fam-status"), "| key chars:", len(key_before), "| qr px:", pg.evaluate("() => document.querySelector('#fam-qr').width"))
    assert pg.is_visible("#btn-fam-push") and pg.evaluate("() => document.querySelector('#fam-ready').contains(document.querySelector('#btn-fam-push'))")
    names_before = pg.evaluate(NODE)["names"]
    pg.click("#btn-fam-push")
    pg.wait_for_function("() => /radios? done/.test(document.querySelector('#fam-count').textContent)", timeout=60000)
    print(pg.inner_text("#log")); print("count:", pg.inner_text("#fam-count")); print("node:", json.dumps(pg.evaluate(NODE)))
    assert pg.evaluate(NODE)["names"] == names_before, "adding a channel must not rename the radio"
    assert "owner" not in pg.inner_text("#log")
    # second pass on the same radio: same name must replace, not duplicate
    pg.click("#btn-fam-push"); pg.wait_for_function("() => /2 radios done/.test(document.querySelector('#fam-count').textContent)", timeout=60000)
    print("after 2nd push chans:", json.dumps(pg.evaluate(NODE)["chans"]))
    # copy from a radio
    pg.click("[data-fam=read]"); pg.click("#btn-fam-read"); pg.wait_for_function("() => /Found|No named/.test(document.querySelector('#fam-status').textContent)", timeout=60000)
    print("read:", pg.inner_text("#fam-status"), "| push visible on the copy tab:", pg.is_visible("#btn-fam-push"))
    assert pg.is_visible("#btn-fam-push")
    pg.click("#btn-fam-push"); pg.wait_for_function("() => /3 radios done/.test(document.querySelector('#fam-count').textContent)", timeout=60000)
    print("after push from the copy tab chans:", json.dumps(pg.evaluate(NODE)["chans"]))
    print("after read: QR section hidden:", pg.is_hidden("#fam-save"), "| key text empty:", pg.text_content("#fam-key") == "", "| qr px:", pg.evaluate("() => document.querySelector('#fam-qr').width"))
    # the page must take nothing from its own address: a crafted URL can't preload or alter a channel
    pg2 = b.new_page(); pg2.add_init_script(fake)
    pg2.goto("http://localhost:8765/family/?add=true&name=Evil&psk=AQ==#CgcSAQEaBEV2aWw"); pg2.wait_for_timeout(500)
    print("crafted URL: channel ready shown:", pg2.is_visible("#fam-ready"), "| name field:", repr(pg2.input_value("#fam-name")), "| status:", repr(pg2.inner_text("#fam-status")))
    # factory reset on the radio page: cancel inside the countdown sends nothing; letting it run sends the reset
    USED = {"lora": {"region": 1, "modemPreset": 4, "channelNum": 45, "hopLimit": 6}}
    pg3 = b.new_page(); pg3.add_init_script("window.__fakeOpts = " + json.dumps(USED)); pg3.add_init_script(fake); pg3.goto("http://localhost:8765/radio/"); pg3.wait_for_timeout(500)
    adm = lambda: pg3.evaluate("() => window.__fakeNode.adminLog.join(',')")
    pg3.click("#btn-reset"); pg3.wait_for_selector("#reset-confirm:not([hidden])", timeout=30000)
    print("reset prompt:", pg3.inner_text("#reset-what"))
    pg3.click("#btn-reset-go"); pg3.wait_for_timeout(2500)
    print("counting:", pg3.inner_text("#btn-reset-go"), "| go disabled:", pg3.is_disabled("#btn-reset-go"), "| cancel enabled:", pg3.is_enabled("#btn-reset-cancel"), "| admin:", repr(adm()))
    pg3.click("#btn-reset-cancel"); pg3.wait_for_timeout(9000)
    print("after cancel + 9s:", pg3.inner_text("#reset-status"), "| admin:", repr(adm()), "| prompt hidden:", pg3.is_hidden("#reset-confirm"))
    pg3.click("#btn-reset"); pg3.wait_for_selector("#reset-confirm:not([hidden])", timeout=30000); pg3.click("#btn-reset-go")
    pg3.wait_for_timeout(6000); mid = adm()
    pg3.wait_for_function("() => /Done\\.|didn't go through|hasn't restarted|did not take/.test(document.querySelector('#reset-status').textContent)", timeout=60000)
    end = pg3.inner_text("#reset-status")
    print("at 6s admin:", repr(mid), "| end:", end[:60], "| admin:", repr(adm()))
    assert end.startswith("Done. The radio restarted and is blank"), end
    assert "Factory reset confirmed" in pg3.inner_text("#log")
    # the reset must prove itself: a radio that freezes after erasing, and one that ignores the erase, are both reported as such
    def reset_run(opts):
        q = b.new_page(); q.add_init_script("window.__fakeOpts = " + json.dumps({**USED, **opts})); q.add_init_script(fake); q.goto("http://localhost:8765/radio/"); q.wait_for_timeout(500)
        q.click("#btn-reset"); q.wait_for_selector("#reset-confirm:not([hidden])", timeout=30000); q.click("#btn-reset-go")
        q.wait_for_function("() => /Done\\.|didn't go through|hasn't restarted|did not take|hasn't come back/.test(document.querySelector('#reset-status').textContent)", timeout=90000)
        t = q.inner_text("#reset-status"); q.close(); return t
    t = reset_run({"resetHangs": True, "pioEnv": "t-echo", "hasWifi": False})
    print("frozen after erase:", t)
    assert "Press its reset button once (the top button on its side)" in t and "Done" not in t, t
    t = reset_run({"resetIgnored": True})
    print("erase ignored:", t)
    assert "erase did not take" in t and "region US" in t, t
    pg.locator("section[data-only=family]").first.screenshot(path="/tmp/family.png")
    print("pageerrors:", errs, "csp:", csp, "external:", [u for u in reqs if u.startswith("http")])
    b.close()
finally: srv.terminate()

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
    print("picker links:", [a.get_attribute("href") for a in pg.locator("a.choice").all()], "| requests:", reqs, "| scripts:", pg.locator("script").count())
    reqs.clear(); pg.add_init_script(fake); pg.click("a.choice[href='family/']"); pg.wait_for_timeout(600)
    print("family page requests:", reqs, "| radio parts hidden:", pg.is_hidden("#btn-full"), pg.is_hidden("#longname"), "| family visible:", pg.is_visible("#btn-fam-push"))
    pg.click("#btn-fam-push"); pg.wait_for_timeout(200); print("push with no channel:", pg.inner_text("#log").strip()[-60:])
    pg.fill("#fam-name","SmithFam"); pg.click("#btn-fam-new")
    link = pg.text_content("#fam-link"); key_before = link
    print("created:", pg.inner_text("#fam-status"), "| link:", link[:44]+"…", "| qr px:", pg.evaluate("() => document.querySelector('#fam-qr').width"))
    pg.fill("#fam-long","Dad"); pg.fill("#fam-short","DAD"); pg.click("#btn-fam-push")
    pg.wait_for_function("() => /radios? done/.test(document.querySelector('#fam-count').textContent)", timeout=60000)
    print(pg.inner_text("#log")); print("count:", pg.inner_text("#fam-count")); print("node:", json.dumps(pg.evaluate(NODE)))
    # second pass on the same radio: same name must replace, not duplicate
    pg.click("#btn-fam-push"); pg.wait_for_function("() => /2 radios done/.test(document.querySelector('#fam-count').textContent)", timeout=60000)
    print("after 2nd push chans:", json.dumps(pg.evaluate(NODE)["chans"]))
    # copy from a radio
    pg.click("[data-fam=read]"); pg.click("#btn-fam-read"); pg.wait_for_function("() => /Found|No named/.test(document.querySelector('#fam-status').textContent)", timeout=60000)
    print("read:", pg.inner_text("#fam-status"), "| same link as created:", pg.text_content("#fam-link") == key_before)
    # paste a link
    pg.click("[data-fam=paste]"); pg.fill("#fam-url", link); pg.click("#btn-fam-paste")
    print("paste:", pg.inner_text("#fam-status"), "| same link:", pg.text_content("#fam-link") == key_before)
    pg.locator("section[data-only=family]").first.screenshot(path="/tmp/family.png")
    print("pageerrors:", errs, "csp:", csp, "external:", [u for u in reqs if u.startswith("http")])
    b.close()
finally: srv.terminate()

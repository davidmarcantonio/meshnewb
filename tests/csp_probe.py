import subprocess, time
from playwright.sync_api import sync_playwright
srv = subprocess.Popen(["python3","-m","http.server","8765","--directory","dist"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(1)
try:
  with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    pg = b.new_page(viewport={"width":1400,"height":1700})
    seen = []
    def handle(r):
        seen.append((r.request.url, r.request.headers.get("referer"), r.request.headers.get("cookie")))
        r.fulfill(json={"releases":{"stable":[{"id":"v2.7.26.54e0d8d"}]}})
    pg.route("https://api.meshtastic.org/**", handle)
    pg.route("https://release.meshtastic.org/**", handle)
    pg.route("https://example.com/**", handle)
    pg.goto("http://localhost:8765/radio/index.html"); pg.wait_for_timeout(500)
    res = pg.evaluate("""async () => { const t = async u => { try { await fetch(u, {referrerPolicy:'no-referrer', credentials:'omit'}); return 'allowed' } catch(e) { return 'BLOCKED' } };
      return { api: await t('https://api.meshtastic.org/github/firmware/list'), release: await t('https://release.meshtastic.org/x.json'), other: await t('https://example.com/beacon') } }""")
    print("fetch results:", res)
    print("requests that reached the network layer:", seen)
    pg.fill("#longname","dma West Portal"); pg.evaluate("() => { document.querySelector('#short-row').open = true; }"); pg.fill("#shortname","DMA1"); pg.fill("#pin","246810")
    pg.screenshot(path="tests/screenshot.png", full_page=True)
    b.close()
finally: srv.terminate()

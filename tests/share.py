# "Share this page": the native share button only where the browser has a share sheet, Copy link, Email, and four plain
# links. Run after build. The rules under test: every option shares the site's front door, and nothing goes out on load.
import subprocess, time
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright
srv = subprocess.Popen(["python3","-m","http.server","8769","--directory","dist"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(1)
URL, SITE = "http://localhost:8769", "https://mesh.marcantonio.me/"
try:
  with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    def page(init, path="/", width=1200):
      ctx = b.new_context(viewport={"width": width, "height": 1400}, permissions=["clipboard-read", "clipboard-write"])
      pg = ctx.new_page()
      pg.errs = []; pg.on("pageerror", lambda e: pg.errs.append(str(e)))
      pg.csp = []; pg.on("console", lambda m: ("Content Security Policy" in m.text or "Refused" in m.text) and pg.csp.append(m.text))
      pg.ext = []; pg.on("request", lambda r: r.url.startswith(URL) or r.url.startswith("https://api.meshtastic.org/") or pg.ext.append(r.url))
      pg.route("https://api.meshtastic.org/**", lambda r: r.fulfill(json={"releases": {"stable": [{"id": "v2.7.26.54e0d8d"}]}}))
      pg.add_init_script(init); pg.goto(URL + path); pg.wait_for_selector(".pagetabs [aria-selected=true]"); pg.wait_for_timeout(300)
      return pg

    # ---- no share sheet (Chrome on a Mac or Linux, Firefox): the button stays hidden, Copy link and Email carry it ----
    pg = page("delete Navigator.prototype.share; delete navigator.share;", path="/join/")
    assert pg.is_hidden("#share-native"), "no share sheet, no Share button"
    pg.click("#share-copy"); pg.wait_for_timeout(200)
    assert pg.inner_text("#share-msg") == "Link copied.", pg.inner_text("#share-msg")
    assert pg.evaluate("navigator.clipboard.readText()") == SITE, "copies the front door, not /join/"
    mail = pg.get_attribute("#share-email", "href")
    assert mail.startswith("mailto:?subject=") and "+" not in mail and "https%3A%2F%2Fmesh.marcantonio.me%2F" in mail, mail
    want = {"www.facebook.com": "u", "www.reddit.com": "url", "twitter.com": "url", "bsky.app": "text"}
    links = pg.eval_on_selector_all(".share-more a", "as => as.map(a => [a.href, a.target, a.rel])")
    assert len(links) == 4, links
    for href, target, rel in links:
      u = urlparse(href); q = parse_qs(u.query)
      assert u.scheme == "https" and u.hostname in want, href
      assert SITE in q[want[u.hostname]][0], href
      assert target == "_blank" and "noopener" in rel and "noreferrer" in rel, (href, target, rel)
    assert not pg.ext and not pg.csp and not pg.errs, (pg.ext, pg.csp, pg.errs)
    print("no share sheet: all passed")

    # ---- clipboard refused: the link is shown so it can be copied by hand ----
    pg = page("navigator.clipboard.writeText = () => Promise.reject(new Error('no'));")
    pg.click("#share-copy"); pg.wait_for_timeout(200)
    assert pg.inner_text("#share-msg") == "Copy this: " + SITE, pg.inner_text("#share-msg")
    print("clipboard refused: link shown")

    # ---- share sheet present (phones, Safari, Edge): one button, the front door, and closing the sheet is not an error ----
    pg = page("window.__shared = []; navigator.share = (d) => { window.__shared.push(d); return Promise.reject(new DOMException('closed', 'AbortError')); };", path="/check/")
    assert pg.is_visible("#share-native")
    pg.click("#share-native"); pg.wait_for_timeout(200)
    shared = pg.evaluate("window.__shared")
    assert len(shared) == 1 and shared[0]["url"] == SITE and shared[0]["title"], shared
    assert not pg.errs and pg.inner_text("#share-msg") == "", (pg.errs, pg.inner_text("#share-msg"))
    print("share sheet: all passed")

    # ---- phone width: the row wraps, nothing runs off the side ----
    pg = page("navigator.share = () => Promise.resolve();", width=360)
    assert pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), "share row fits a phone"
    pg.locator("section.share").screenshot(path="tests/screenshot.png")
    print("narrow: fits")
    b.close()
    print("share: all passed")
finally: srv.terminate()

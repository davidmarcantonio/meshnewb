# "Use your radio" tab: the guide and the pretend phone. Run after build.
# The rules under test: the lesson can be finished by following the orange outline, a wrong turn is recoverable,
# nothing leaves the page, the Content-Security-Policy is not tripped (no inline styles), and it fits a phone.
# Chrome only: the iPhone-specific checks were done by hand in the iOS Simulator (see the design doc).
import subprocess, time
from playwright.sync_api import sync_playwright
srv = subprocess.Popen(["python3","-m","http.server","8771","--directory","dist"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(1)
URL = "http://localhost:8771"
try:
  with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    def page(path="/use/", width=1200, height=1400):
      pg = b.new_page(viewport={"width": width, "height": height})
      pg.errs = []; pg.on("pageerror", lambda e: pg.errs.append(str(e)))
      pg.csp = []; pg.on("console", lambda m: ("Content Security Policy" in m.text or "Refused" in m.text) and pg.csp.append(m.text))
      pg.ext = []; pg.on("request", lambda r: r.url.startswith(URL) or pg.ext.append(r.url))
      pg.route("https://api.meshtastic.org/**", lambda r: r.fulfill(json={"releases": {"stable": [{"id": "v2.7.26.54e0d8d"}]}}))
      pg.goto(URL + path); pg.wait_for_selector(".pagetabs [aria-selected=true]")
      return pg
    coach = lambda pg: pg.text_content("#pr-coach")  # text_content: the step label is upper-cased by CSS only
    def clean(pg): assert not pg.errs and not pg.csp, (pg.errs, pg.csp)

    # ---- /use/ opens on the tab; the cable checklist and the USB privacy line are not shown; no request leaves the page ----
    pg = page()
    assert pg.get_attribute(".pagetabs [aria-selected=true]", "data-tab") == "use"
    assert pg.is_hidden("#prereq") and pg.is_hidden(".privacy-teaser"), "nothing is plugged in on this tab"
    assert pg.is_visible("#practice") and pg.is_hidden("#btn-go")
    assert not pg.ext, pg.ext  # not even the firmware version: that is asked only when a radio tab needs it
    print("opens on the tab, no outside request")

    # ---- family channel lesson, start to finish, by tapping whatever is outlined ----
    assert "Step 1 of 5" in coach(pg) and "Tap Channels" in coach(pg)
    pg.click("#practice [data-go=contacts]")                       # the wrong row
    assert "go back" in coach(pg) and pg.locator("#practice .target").get_attribute("class").startswith("back")
    pg.click("#practice .target")
    pg.click("#practice .target"); assert "Tap Family" in coach(pg)
    assert pg.locator("#practice .list button").first.inner_text().startswith("0\nPrimary Channel"), "the public channel is named as the app names it"
    pg.click("#practice .target"); assert "Step 3 of 5" in coach(pg)
    assert pg.locator("#practice .target").get_attribute("id") == "pr-box"
    pg.click("#pr-send"); assert "Step 3 of 5" in coach(pg), "an empty message is not sent"
    pg.fill("#pr-box", "On my way home"); assert "blue arrow" in coach(pg) and pg.inner_text("#pr-bytes") == "14"
    pg.click("#pr-send")
    assert pg.inner_text("#practice .mine .st") == "Sending..." and "Step 5 of 5" in coach(pg)
    pg.wait_for_selector("#practice .mine .st.ok")
    assert pg.inner_text("#practice .mine .st") == "Delivered to mesh"
    assert coach(pg).startswith("Done"), coach(pg)
    assert "does not tell you a person has read it" in coach(pg)
    # A reply lands while the next message is being typed: the typing survives.
    pg.fill("#pr-box", "half a thought"); pg.wait_for_function("() => [...document.querySelectorAll('#practice .m .bub')].at(-1).textContent === 'Message received. Over.'")
    assert pg.input_value("#pr-box") == "half a thought"
    clean(pg)
    print("family channel lesson: all passed")

    # ---- one person: the other lesson, sent with the Enter key; the status names the recipient ----
    pg.click("#pr-next")
    assert pg.get_attribute("#practice [data-lesson=dm]", "aria-pressed") == "true" and "Direct Messages" in coach(pg)
    pg.click("#practice .target"); assert pg.inner_text("#practice .big") == "Contacts (3)"
    assert "only after your radios have heard each other" in coach(pg), "the lesson says the list is not automatic"
    pg.click("#practice .target"); pg.fill("#pr-box", "Was it you?"); pg.press("#pr-box", "Enter")
    pg.wait_for_selector("#practice .mine .st.ok")
    assert pg.inner_text("#practice .mine .st") == "Delivered to recipient"
    assert "First, get them on your list" in coach(pg)
    # The prerequisite is on the page: a person is listed only once the radios have met, and how to make that happen.
    sec = pg.locator("section[data-only~=use]", has=pg.locator("#dm-first"))
    text = " ".join(sec.text_content().split())
    assert all(w in text for w in ["only once your radio knows theirs", "Share Contact", "Add Contact", "Nodes", "Exchange User Info", "Request User Info"]), text
    # Getting someone on the list comes before the steps that assume they are on it.
    assert text.index("First, get them on your list") < text.index("Then send") < text.index("Tap Direct Messages")
    assert sec.locator("ol.taps li").count() == 4
    # The page says up front that there are two kinds of message, before any steps.
    kinds = pg.inner_text("section[data-only~=use] .kinds")
    assert "group chat" in kinds and "goes to one radio" in kinds
    # One message holds 200 bytes, as in the app; an emoji is four of them.
    pg.fill("#pr-box", "x" * 300); assert pg.inner_text("#pr-bytes") == "200" and len(pg.input_value("#pr-box")) == 200
    pg.fill("#pr-box", "😀" * 60); assert pg.inner_text("#pr-bytes") == "200"
    # Starting again forgets what was sent.
    pg.click("#pr-again"); pg.click("#practice .target"); pg.click("#practice .target")
    assert pg.locator("#practice .mine").count() == 0
    clean(pg)
    print("one person lesson: all passed")

    # ---- the finished-setup card and the family tab lead here; the tab row works by keyboard ----
    pg = page("/")
    assert pg.get_attribute(".pagetabs [aria-selected=true]", "data-tab") == "radio" and pg.is_hidden("#practice")
    assert pg.locator(".pagetabs button").count() == 5
    pg.evaluate("document.getElementById('done').hidden = false"); pg.click("#done a[data-goto=use]")
    assert pg.evaluate("document.body.dataset.page") == "use" and pg.is_visible("#practice")
    pg.click(".pagetabs [data-tab=family]"); pg.click("section[data-only~=family] .callout a[data-goto=use]")
    assert pg.evaluate("document.body.dataset.page") == "use"
    pg.focus(".pagetabs [data-tab=use]"); pg.keyboard.press("ArrowRight")
    assert pg.evaluate("document.body.dataset.page") == "radio"
    pg.click(".pagetabs [data-tab=use]"); pg.click("section[data-only~=use] a[data-goto=family]")
    assert pg.evaluate("document.body.dataset.page") == "family"
    clean(pg)
    print("links and keyboard: all passed")

    # ---- a phone: this is the tab people open on one. Nothing runs off the side, and the step stays in view ----
    pg = page(width=360, height=740)
    assert pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), "fits a phone"
    # The step and the pretend phone fit on one screen together, and the step never covers the phone's top bar
    # (a sticky step did, on a real iPhone: it hid the back button the step was telling the reader to tap).
    pg.evaluate("window.scrollBy(0, 5000)"); pg.locator("#pr-screen").scroll_into_view_if_needed()
    pg.click("#practice [data-go=contacts]"); pg.wait_for_timeout(700)      # a wrong turn: the step says "go back"
    step, phone, back = [pg.locator(s).bounding_box() for s in ["#pr-coach", "#practice .phone", "#practice .back"]]
    assert step["y"] >= 0 and phone["y"] + phone["height"] <= 740, f"step and phone both on screen: {step} {phone}"
    assert step["y"] + step["height"] <= phone["y"], "the step sits above the phone, not over it"
    assert back["y"] >= step["y"] + step["height"], "the back button is not covered"
    pg.click("#practice .back"); pg.evaluate("window.scrollTo(0, 0)")
    assert pg.locator("#pr-screen").evaluate("e => e.getBoundingClientRect().top + window.scrollY") < 1300, "the pretend phone is not buried under the tab buttons"
    for sel in ["#practice .lessons button", "#practice .list > button"]:
      assert pg.locator(sel).first.bounding_box()["height"] >= 44, sel + " is big enough to tap"
    pg.evaluate("window.scrollTo(0, 0)"); pg.screenshot(path="tests/screenshot.png", full_page=True)
    clean(pg)
    print("narrow: fits")
    b.close()
    print("use: all passed")
finally: srv.terminate()

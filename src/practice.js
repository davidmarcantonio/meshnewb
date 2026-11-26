// "Use your radio" tab: a pretend phone for practising a first message. Nothing here touches a radio or the network.
// The screens follow the Meshtastic iPhone app (meshtastic/Meshtastic-Apple: ContentView, Messages, ChannelList,
// ChannelMessageRow, UserList, TextMessageField) closely enough to recognise, and are labelled as an illustration.
// No inline styles anywhere: the page's Content-Security-Policy (style-src 'self') would drop them.

const I = {
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  chev: '<svg class="sm chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
  lock: '<svg class="sm lock-g" viewBox="0 0 24 24" role="img" aria-label="Private"><rect x="5" y="11" width="14" height="9" rx="2" fill="currentColor"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  open: '<svg class="sm lock-y" viewBox="0 0 24 24" role="img" aria-label="Public"><rect x="5" y="11" width="14" height="9" rx="2" fill="currentColor"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/></svg>',
  up: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V6M6 11l6-6 6 6"/></svg>',
  clock: '<svg class="sm" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5h4"/></svg>',
  check: '<svg class="sm" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/></svg>',
  people: '<svg class="ios" viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0M16 5.5a3 3 0 0 1 0 5.5M17 14.5a6 6 0 0 1 4 5.5"/></svg>',
  person: '<svg class="ios" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/></svg>',
};
// Made-up radios, named the way "Suggest a name" names them: one word, two digits, short name from both.
const PEOPLE = {
  otter: { s: "OT42", n: "Otter 42", id: "!a3f09c12" },
  bison: { s: "BI08", n: "Bison 08", id: "!7be41d08" },
  maple: { s: "MA17", n: "Maple 17", id: "!c25508aa" },
};
const START = {
  family: { title: "Family", dm: false, reply: ["bison", "Message received. Over."], msgs: [
    ["otter", "Is this thing on"], ["bison", "Testing. Over."], ["maple", "Dad, you don't have to say over"],
    ["bison", "Copy that. Over."], ["maple", "Who ate the last of the ice cream? Asking on a secure channel."]] },
  primary: { title: "Primary Channel", dm: false, msgs: [["otter", "Good morning from a hilltop"]] },
  maple: { title: "Maple 17", dm: true, reply: ["maple", "It wasn't me. It was the dog."], msgs: [["maple", "Radio check. Can you read this?"]] },
  bison: { title: "Bison 08", dm: true, msgs: [] },
  otter: { title: "Otter 42", dm: true, msgs: [] },
};
export const MAX_BYTES = 200; // the app's own limit for one message (TextMessageField.maxbytes)
const SEND_MS = 1800, REPLY_MS = 2200;

const esc = (s) => { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; };
const circle = (k) => `<span class="ct pc-${k}">${PEOPLE[k].s}</span>`;

export function initPractice(root) {
  if (!root) return;
  const q = (sel) => root.querySelector(sel);
  const elScreen = q("#pr-screen"), elCoach = q("#pr-coach"), lessonBtns = [...root.querySelectorAll("[data-lesson]")];
  let chats, lesson = "channel", screen = "home", sentIn = null, delivered = false, timers = [], coachHtml = "";
  // On a phone the step sits above the pretend phone. After a tap, bring the pair back into view if either end has
  // slipped off the screen. Never on load, and never while typing (the keyboard owns the scroll position then).
  const narrow = window.matchMedia("(max-width: 760px)");
  function keepInView() {
    if (!narrow.matches || document.activeElement === q("#pr-box")) return;
    const top = elCoach.getBoundingClientRect().top, bottom = root.querySelector(".phone").getBoundingClientRect().bottom;
    const h = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    if (top < 0 || bottom > h) elCoach.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }

  const last = (key) => { const m = chats[key].msgs; return m.length ? m[m.length - 1][1] : ""; };
  const nav = (label, to, title) => `<div class="nav"><button type="button" class="back" data-go="${to}">${I.back}${label}</button><span class="t">${title}</span><span class="sp"></span></div>`;
  const chanRow = (key, n, lock, name, prev) => `<button type="button" data-go="chat:${key}"><span class="ct pc-chan">${n}</span><span class="grow"><span class="h">${lock}${name}</span><span class="prev">${esc(prev)}</span></span>${I.chev}</button>`;
  const bubble = (m) => {
    if (m[0] === "me") return `<div class="mine"><span class="bub">${esc(m[1])}</span><div class="st${m[2] ? " ok" : ""}">${m[2] ? I.check + m[2] : I.clock + "Sending..."}</div></div>`;
    const p = PEOPLE[m[0]];
    return `<div class="m">${circle(m[0])}<div class="grow"><div class="who">${p.n} (${p.id})</div><span class="bub">${esc(m[1])}</span></div></div>`;
  };

  // Re-drawing a chat (a status change, a reply arriving) must not throw away what is being typed.
  function go(to) {
    const box = q("#pr-box"), keep = box && screen === to ? box.value : "", had = box && document.activeElement === box;
    screen = to; render();
    const now = q("#pr-box");
    if (now && keep) { now.value = keep; now.dispatchEvent(new Event("input")); }
    if (now && had) now.focus();
    keepInView();
  }
  function reset(l) {
    timers.forEach(clearTimeout); timers = [];
    chats = structuredClone(START); lesson = l; sentIn = null; delivered = false; screen = "home";
    lessonBtns.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.lesson === l)));
    render();
  }

  function render() {
    let h;
    if (screen === "home") {
      h = `<div class="nav"></div><div class="big">Messages</div><div class="list">
        <button type="button" data-go="channels">${I.people}<span class="grow">Channels</span>${I.chev}</button>
        <button type="button" data-go="contacts">${I.person}<span class="grow">Direct Messages</span>${I.chev}</button></div>`;
    } else if (screen === "channels") {
      h = nav("Messages", "home", "") + `<div class="big">Channels</div><div class="list">${
        chanRow("primary", "0", I.open, "Primary Channel", "Public. Anyone nearby can read it")}${
        chanRow("family", "1", I.lock, "Family", last("family"))}</div>`;
    } else if (screen === "contacts") {
      h = nav("Messages", "home", "") + `<div class="big">Contacts (3)</div><div class="search">Find a contact</div><div class="list">${
        ["maple", "bison", "otter"].map((k) => `<button type="button" data-go="chat:${k}">${circle(k)}<span class="grow"><span class="h">${I.lock}${PEOPLE[k].n}</span><span class="prev">${esc(last(k) || "No messages yet")}</span></span>${I.chev}</button>`).join("")}</div>`;
    } else {
      const key = screen.split(":")[1], c = chats[key];
      h = nav(c.dm ? "Contacts" : "Channels", c.dm ? "contacts" : "channels", (c.dm ? "" : key === "family" ? I.lock : I.open) + esc(c.title))
        + `<div class="log" id="pr-log">${c.msgs.map(bubble).join("")}</div>
        <div class="compose"><div class="r"><label class="sr" for="pr-box">Message</label><input id="pr-box" type="text" placeholder="Message" autocomplete="off" enterkeyhint="send">
        <button type="button" class="send" id="pr-send" aria-label="Send">${I.up}</button></div>
        <div class="tb" aria-hidden="true"><b>B</b><i>I</i><s>S</s><span>&lt;/&gt;</span><span class="by">Bytes: <span id="pr-bytes">0</span><span class="bar"><span id="pr-bar"></span></span></span></div></div>`;
    }
    elScreen.innerHTML = h;
    elScreen.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => go(b.dataset.go)));
    if (q("#pr-box")) wireChat(screen.split(":")[1]);
    coach();
  }

  function wireChat(key) {
    const box = q("#pr-box"), log = q("#pr-log"), c = chats[key];
    const bytes = () => new TextEncoder().encode(box.value).length;
    const meter = () => { const n = bytes(); q("#pr-bytes").textContent = n; q("#pr-bar").style.width = Math.min(100, Math.round((n / MAX_BYTES) * 100)) + "%"; };
    log.scrollTop = log.scrollHeight;
    box.oninput = () => { while (bytes() > MAX_BYTES) box.value = box.value.slice(0, -1); meter(); coach(); };
    const send = () => {
      const t = box.value.trim();
      if (!t) { box.focus(); return; }
      const msg = ["me", t, ""]; c.msgs.push(msg); box.value = ""; sentIn = key; delivered = false;
      go("chat:" + key);
      timers.push(setTimeout(() => {
        // The real app's wording: a channel message is confirmed by the mesh, a direct message by the other radio.
        msg[2] = c.dm ? "Delivered to recipient" : "Delivered to mesh"; delivered = true;
        if (screen === "chat:" + key) go(screen); else coach();
        if (c.reply) {
          const r = c.reply; c.reply = null;
          timers.push(setTimeout(() => { c.msgs.push(r); if (screen === "chat:" + key) go(screen); }, REPLY_MS));
        }
      }, SEND_MS));
    };
    q("#pr-send").onclick = send;
    box.onkeydown = (e) => { if (e.key === "Enter") send(); };
  }

  // The coach looks at where you are and names the next tap, so a wrong turn never breaks the lesson.
  function coach() {
    const want = lesson === "channel" ? "family" : "maple", listScreen = lesson === "channel" ? "channels" : "contacts";
    const box = q("#pr-box");
    let n = 1, text, target = null, done = false;
    if (sentIn === want) {
      n = 5; done = delivered;
      text = !delivered ? "Sending. Watch the small line under your message."
        : lesson === "channel" ? 'Sent. "Delivered to mesh" means another radio heard it and passed it on. It does not tell you a person has read it.'
        : 'Sent. "Delivered to recipient" means their radio has it. Before you try this for real, read "First, get them on your list" in section 03.';
    } else if (screen === "home") {
      target = `[data-go="${listScreen}"]`; text = lesson === "channel" ? "Tap Channels." : "Tap Direct Messages.";
    } else if (screen === listScreen) {
      n = 2; target = `[data-go="chat:${want}"]`;
      text = lesson === "channel" ? "Tap Family. The green lock means only your group can read it." : "Tap the radio of the person you want. Here, Maple 17. People are listed by their radio's name, and only after your radios have heard each other: section 03 below has the steps.";
    } else if (screen === "chat:" + want) {
      if (box && box.value.trim()) { n = 4; target = "#pr-send"; text = "Tap the blue arrow to send."; }
      else { n = 3; target = "#pr-box"; text = "Tap the Message box and type a few words."; }
    } else {
      n = screen.startsWith("chat:") ? 2 : 1; target = ".back"; text = "Not this one. Tap the blue word at the top left to go back.";
    }
    root.querySelectorAll(".target").forEach((t) => t.classList.remove("target"));
    if (target) q(target)?.classList.add("target");
    elCoach.classList.toggle("done", done);
    let html = `<div class="n">${done ? "Done" : `Step ${n} of 5`}</div><p>${esc(text)}</p>`;
    if (done) html += `<div class="again"><button type="button" id="pr-next">${lesson === "channel" ? "Next: message one person" : "Back to the family channel"}</button><button type="button" id="pr-again">Do this one again</button></div>`;
    if (html !== coachHtml) { elCoach.innerHTML = coachHtml = html; } // unchanged text is not re-announced to a screen reader
    if (done) { q("#pr-next").onclick = () => reset(lesson === "channel" ? "dm" : "channel"); q("#pr-again").onclick = () => reset(lesson); }
  }

  lessonBtns.forEach((b) => (b.onclick = () => { reset(b.dataset.lesson); keepInView(); }));
  reset("channel");
}

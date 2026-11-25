// MeshNewb — flash stock Meshtastic firmware, then push settings over Web Serial.
// Stack mirrors the official flasher: esptool-js + @meshtastic/core. The serial transport is our own (see openTransport).
import { ESPLoader, Transport } from "esptool-js";
import { MeshDevice, Protobuf, Utils } from "@meshtastic/core";
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import qrcode from "qrcode-generator";
import { suggestName } from "./names.js";
import BOARDS from "../data/boards.json";
import FIRMWARE from "../data/firmware.json";
import { summarize, verNums, olderThan, shortVer } from "./summary.js";
import { USE_CASES, PRESET, PRESET_LABEL, ROLE, ROLE_LABEL, FW_DEFAULT } from "./enums.js";

const API = "https://api.meshtastic.org";
const RELEASE = "https://release.meshtastic.org";
const C = Protobuf.Config;
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const REGION_LABEL = Object.fromEntries(Object.entries(C.Config_LoRaConfig_RegionCode).filter(([k]) => isNaN(Number(k))).map(([k, v]) => [v, k]));

// ---------- logging ----------
function log(msg, cls = "") {
  const line = document.createElement("div");
  if (cls) line.className = cls;
  line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  $("log").appendChild(line);
  $("log").scrollTop = $("log").scrollHeight;
}
const ok = (m) => log("✔ " + m, "ok");
const warn = (m) => log("! " + m, "warn");
const err = (m) => log("✘ " + m, "err");
const setStep = (n, state) => { const el = document.querySelector(`[data-step="${n}"]`); if (el) el.dataset.state = state; };
// While the page is talking to a radio, the action buttons and the tabs are locked.
const busy = (on) => document.querySelectorAll("button.act, .pagetabs button").forEach((b) => (b.disabled = on));

function opt(sel, value, text, selected) {
  const o = document.createElement("option");
  o.value = value; o.textContent = text; if (selected) o.selected = true;
  $(sel).appendChild(o);
  return o;
}

// ---------- catalogue (no network until the user flashes) ----------
// Board list is a committed snapshot (data/boards.json) so page load makes zero requests.
const NET = { referrerPolicy: "no-referrer", credentials: "omit", cache: "no-store" };
const get = (url) => fetch(url, NET);

function fillBoards() {
  const list = [...BOARDS.boards].sort((a, b) => a[1].localeCompare(b[1]));
  for (const [target, name] of list) opt("board", target, `${name}  (${target})`, target === "heltec-v3");
}

let currentFw = null; // current beta, once asked
async function resolveFirmware() {
  if (currentFw) return currentFw;
  try {
    const fw = await (await get(`${API}/github/firmware/list`)).json();
    const v = fw.releases.stable[0].id.replace(/^v/, "");
    $("fwver").textContent = `${v} (current beta)`;
    return (currentFw = v);
  } catch (e) {
    warn(`Couldn't ask api.meshtastic.org for the current beta (${e.message}); using tested ${FIRMWARE.tested}.`);
    return FIRMWARE.tested;
  }
}

// ---------- helpers ----------
function b64ToBytes(s) {
  s = s.trim().replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}
const bytesToB64 = (b) => btoa(String.fromCharCode(...b));
function parseChannelUrl(url) {
  const frag = url.split("#")[1];
  if (!frag) throw new Error("Channel URL has no #fragment");
  return fromBinary(Protobuf.AppOnly.ChannelSetSchema, b64ToBytes(frag));
}
function pskBytes(p) {
  if (!p || p === "default") return new Uint8Array([1]);
  if (p === "random") return crypto.getRandomValues(new Uint8Array(32));
  return b64ToBytes(p);
}
const num = (id) => { const v = $(id).value.trim(); return v === "" ? undefined : Number(v); };
const strip = (msg) => { const o = { ...msg }; delete o.$typeName; return o; };

// ---------- mode + community UI ----------
let mode = "community";
let conn = "ble";
function setConn(c) {
  conn = c;
  document.querySelectorAll("[data-conn]").forEach((b) => b.classList.toggle("on", b.dataset.conn === c));
  $("ble-fields").hidden = c !== "ble";
  $("wifi-fields").hidden = c !== "wifi";
}
function setMode(m) {
  mode = m;
  document.querySelectorAll("[data-mode]").forEach((b) => b.classList.toggle("on", b.dataset.mode === m));
  $("panel-standard").hidden = m !== "standard";
  $("panel-community").hidden = m !== "community";
  $("panel-manual").hidden = m !== "manual";
}

// ---------- community presets ----------
// Data files under presets/ on this same host (copied from the presets repo at build time). Nothing here is bundled
// into app.js. `index` lists every community; a community's own file is fetched when it is picked.
const SAME_ORIGIN = { referrerPolicy: "no-referrer", credentials: "omit" };
// app.js sits at the site root, so its own address is the root whichever page loaded it.
const SITE = new URL(".", import.meta.url);
let presetIndex = null;          // presets/index.json
let community = null;            // the selected community's full file, or null
const communityCache = new Map();

async function loadPresetIndex() {
  try {
    const r = await fetch(new URL("presets/index.json", SITE), SAME_ORIGIN);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    presetIndex = await r.json();
  } catch (e) {
    $("c-status").textContent = `Couldn't load the community list (${e.message}). Reload the page, or use "Set everything manually".`;
    $("c-status").hidden = false;
    return;
  }
  const names = Object.entries(presetIndex.states).sort((a, b) => a[1].name.localeCompare(b[1].name));
  for (const [code, st] of names) opt("state", code, st.name);
  $("state").disabled = false;
}

function fillCommunities() {
  const sel = $("community");
  sel.replaceChildren();
  community = null;
  const list = presetIndex ? presetIndex.communities.filter((c) => c.state === $("state").value) : [];
  $("community-row").hidden = !list.length;
  if (!list.length) { renderCommunity(); return; }
  opt("community", "", "Choose a community…", true).disabled = true;
  for (const [status, label] of [["published", "Preset available"], ["listed", "No preset yet — ask the group"]]) {
    const group = list.filter((c) => c.status === status);
    if (!group.length) continue;
    const og = document.createElement("optgroup");
    og.label = label;
    for (const c of group) { const o = document.createElement("option"); o.value = c.id; o.textContent = c.name; og.appendChild(o); }
    sel.appendChild(og);
  }
  renderCommunity();
}

async function pickCommunity() {
  const id = $("community").value;
  const entry = presetIndex?.communities.find((c) => c.id === id);
  community = null;
  renderCommunity();
  if (!entry) return;
  try {
    if (!communityCache.has(id)) {
      const r = await fetch(new URL(`presets/${entry.path}`, SITE), SAME_ORIGIN);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      communityCache.set(id, await r.json());
    }
  } catch (e) {
    $("c-status").textContent = `Couldn't load ${entry.name} (${e.message}).`;
    $("c-status").hidden = false;
    return;
  }
  if ($("community").value !== id) return; // user moved on while it loaded
  community = communityCache.get(id);
  renderCommunity();
}

// uses.default applies to any radio; the picked use overrides it. Unpublished fields fall back to firmware defaults.
function currentUse() {
  const u = { ...(community.uses?.default ?? {}), ...(community.uses?.[$("usecase").value] ?? {}) };
  return {
    role: u.roleNum ?? FW_DEFAULT.role, roleStated: u.roleNum !== undefined,
    hops: u.hopLimit ?? FW_DEFAULT.hopLimit, hopsStated: u.hopLimit !== undefined,
    nodeInfoSecs: u.nodeInfoSecs, positionSecs: u.positionSecs, smart: u.smartPosition, telemetrySecs: u.telemetrySecs,
  };
}

function communitySettings() {
  const c = community, u = currentUse();
  return {
    source: c.name,
    minFirmware: c.minFirmware,
    region: c.lora.regionNum, usePreset: true, preset: c.lora.modemPresetNum, slot: c.lora.frequencySlot ?? 0,
    hopLimit: u.hops, role: u.role, txPower: 0,
    okToMqtt: $("c-okmqtt").checked, ignoreMqtt: undefined,
    nodeInfoSecs: u.nodeInfoSecs, positionSecs: u.positionSecs, smart: u.smart, telemetrySecs: u.telemetrySecs,
    channel: community.primaryChannel && (community.primaryChannel.name || community.primaryChannel.psk !== "AQ==")
      ? { kind: "manual", name: community.primaryChannel.name, psk: community.primaryChannel.psk }
      : { kind: "public" },
  };
}

function linkTo(el, url) {
  el.href = /^https?:\/\//.test(url) ? url : "#";
  const u = new URL(el.href, location.href);
  el.textContent = u.host + (u.pathname === "/" ? "" : u.pathname);
}

function renderCommunity() {
  const c = community;
  const published = c?.status === "published", listed = c?.status === "listed";
  $("c-status").hidden = true;
  $("usecase-row").hidden = !published;
  $("c-card").hidden = !published;
  $("btn-customize").hidden = !published;
  $("c-listed").hidden = !listed;
  if (listed) {
    $("c-listed-name").textContent = c.name;
    $("c-listed-area").textContent = c.area;
    linkTo($("c-listed-link"), c.contact.url);
    $("c-listed-kind").textContent = c.contact.type === "website" ? "their site" : `their ${c.contact.type[0].toUpperCase()}${c.contact.type.slice(1)}`;
    $("c-listed-checked").textContent = c.checked;
    $("c-listed-notes").replaceChildren(...(c.notes ?? []).map((n) => { const li = document.createElement("li"); li.textContent = n; return li; }));
    return;
  }
  if (!published) return;
  const u = currentUse();
  const ch = c.primaryChannel;
  $("c-okmqtt").checked = !!c.mqtt?.okToMqtt;
  $("c-mqtt-advice").textContent = c.mqtt?.advice || "";
  const rows = [
    ["Region / preset", `${REGION_LABEL[c.lora.regionNum]} · ${PRESET_LABEL[c.lora.modemPresetNum] ?? c.lora.modemPreset}`],
    ["Frequency slot", c.lora.frequencySlot ? String(c.lora.frequencySlot) : "auto (0), not published"],
    ["Primary channel", !ch || (ch.name === "" && ch.psk === "AQ==") ? "Public default (blank name, key AQ==)" : `"${ch.name}"`],
    ["Role", u.roleStated ? ROLE_LABEL[u.role] : `${ROLE_LABEL[u.role]} (firmware default)`],
    ["Hop limit", u.hopsStated ? String(u.hops) : `${u.hops} (firmware default)`],
    ["NodeInfo every", u.nodeInfoSecs ? fmtSecs(u.nodeInfoSecs) : "firmware default"],
    ["Position every", u.positionSecs ? fmtSecs(u.positionSecs) : "firmware default"],
    ["Smart position", u.smart === undefined ? "firmware default" : u.smart ? "on" : "off"],
    ["Device telemetry every", u.telemetrySecs ? fmtSecs(u.telemetrySecs) : "firmware default"],
  ];
  if (c.minFirmware) rows.push(["Needs firmware", `${c.minFirmware} or newer`]);
  $("c-summary").replaceChildren(...rows.map(([k, v]) => {
    const tr = document.createElement("tr");
    for (const t of [k, v]) { const td = document.createElement("td"); td.textContent = t; tr.appendChild(td); }
    return tr;
  }));
  $("c-notes").replaceChildren(...(c.notes ?? []).map((n) => { const li = document.createElement("li"); li.textContent = n; return li; }));
  linkTo($("c-source"), c.sources[0]);
  $("c-checked").textContent = c.checked;
  $("c-area").textContent = c.area;
}

function fmtSecs(s) {
  if (s % 3600 === 0) return `${s / 3600} h`;
  if (s % 60 === 0) return `${s / 60} min`;
  return `${s} s`;
}

// Copy the selected community into Manual mode so every field can be tweaked.
function customize() {
  const s = communitySettings();
  $("region").value = s.region;
  $("usepreset").checked = true;
  $("preset").value = s.preset;
  $("slot").value = s.slot ?? 0;
  $("hops").value = s.hopLimit;
  $("role").value = s.role;
  $("txpower").value = 0;
  $("okmqtt").checked = s.okToMqtt;
  $("ignoremqtt").checked = false;
  $("nodeinfo").value = s.nodeInfoSecs ?? "";
  $("posint").value = s.positionSecs ?? "";
  $("smart").value = s.smart === undefined ? "" : String(s.smart);
  $("telem").value = s.telemetrySecs ?? "";
  $("churl").value = "";
  $("chname").value = s.channel.kind === "manual" ? s.channel.name : "";
  $("chpsk").value = s.channel.kind === "manual" ? s.channel.psk : "";
  $("m-basis").textContent = `Started from: ${community.name} · ${USE_CASES[$("usecase").value]}`;
  $("m-basis").hidden = false;
  syncPresetFields();
  setMode("manual");
}

function syncPresetFields() {
  const on = $("usepreset").checked;
  $("preset").disabled = !on;
  $("custom-modem").hidden = on;
}

// ---------- form -> settings ----------
function readSettings() {
  const problems = [];
  // Personal — always required
  const p = {
    longName: $("longname").value.trim(),
    shortName: $("shortname").value.trim(),
    conn,
    pin: $("pin").value.trim(),
    ssid: $("ssid").value.trim(),
    wifiPsk: $("wifipsk").value,
  };
  if (!p.longName) problems.push("Long name is required — it's how people see you on the mesh.");
  if (!p.shortName) problems.push("Short name is required (1–4 characters).");
  if ([...p.shortName].length > 4) problems.push("Short name is max 4 characters.");
  if (new TextEncoder().encode(p.longName).length > 39) problems.push("Long name is max 39 bytes.");
  if (p.conn === "ble" && !/^\d{6}$/.test(p.pin)) problems.push("Bluetooth PIN must be exactly 6 digits (hit Generate if you like).");
  if (p.conn === "wifi") {
    if (!p.ssid) problems.push("WiFi SSID is required when connecting over WiFi.");
    if (p.wifiPsk.length < 8) problems.push("WiFi password must be 8+ characters (WPA2).");
  }

  let r;
  if (mode === "standard") {
    // Region only. Preset, slot, hops and role stay whatever the firmware ships with, so this follows the
    // firmware's own defaults across versions instead of hard-coding them here.
    r = { source: "Standard settings", stock: true, region: 1, usePreset: true, channel: { kind: "public" } };
  } else if (mode === "community") {
    if (community?.status === "published") r = communitySettings();
    else {
      problems.push(community
        ? `There is no preset for ${community.name} yet. Get its settings from the group (link above), then use "Set everything manually".`
        : 'Pick your state and community first, or use "Set everything manually".');
      return { s: p, problems };
    }
  } else {
    r = {
      source: "Manual",
      region: Number($("region").value), usePreset: $("usepreset").checked, preset: Number($("preset").value),
      bandwidth: num("bw"), spreadFactor: num("sf"), codingRate: num("cr"),
      slot: num("slot") ?? 0, freqOffset: num("freqoff"), overrideFreq: num("overridefreq"), rxBoost: $("rxboost").checked,
      hopLimit: num("hops") ?? 3, role: Number($("role").value), txPower: num("txpower") ?? 0,
      okToMqtt: $("okmqtt").checked, ignoreMqtt: $("ignoremqtt").checked,
      nodeInfoSecs: num("nodeinfo"), positionSecs: num("posint"),
      smart: $("smart").value === "" ? undefined : $("smart").value === "true",
      telemetrySecs: num("telem"),
      channel: { kind: "public" },
    };
    const url = $("churl").value.trim(), name = $("chname").value.trim(), psk = $("chpsk").value.trim();
    if (url) {
      try { r.channel = { kind: "url", set: parseChannelUrl(url) }; } catch (e) { problems.push("Channel URL didn't parse: " + e.message); }
    } else if (name || (psk && psk !== "default")) {
      r.channel = { kind: "manual", name, psk };
      if (psk && !["default", "random"].includes(psk)) {
        try { if (![1, 16, 32].includes(b64ToBytes(psk).length)) problems.push("Channel PSK must decode to 1, 16 or 32 bytes."); }
        catch { problems.push("Channel PSK isn't valid base64."); }
      }
      if (name && !r.slot) problems.push("You renamed the primary channel — set the frequency slot explicitly or you'll land on a different frequency than everyone else.");
    }
    if (!r.usePreset && (!r.bandwidth || !r.spreadFactor || !r.codingRate)) problems.push("Custom modem needs bandwidth, spreading factor and coding rate.");
    if (r.hopLimit < 1 || r.hopLimit > 7) problems.push("Hop limit must be 1–7.");
  }
  if (!r.region) problems.push("Pick a region — UNSET means the radio never transmits.");
  return { s: { ...p, ...r }, problems };
}

// ---------- flashing ----------
function toBinStr(u8) {
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return s;
}
async function fetchBin(url) {
  const r = await get(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return new Uint8Array(await r.arrayBuffer());
}
async function buildFileArray() {
  const local = $("localbin").files[0];
  if (local) {
    log(`Using local file ${local.name} at 0x0 (factory image)`);
    return [{ data: toBinStr(new Uint8Array(await local.arrayBuffer())), address: 0 }];
  }
  const firmwareVersion = await resolveFirmware();
  const target = $("board").value, base = `${RELEASE}/${firmwareVersion}`;
  log(`Fetching manifest for ${target} @ ${firmwareVersion}`);
  const r = await get(`${base}/firmware-${target}-${firmwareVersion}.mt.json`);
  if (!r.ok) throw new Error(`Manifest HTTP ${r.status} — board may not have a build for this version`);
  const mt = await r.json();
  const off = (name) => { const p = mt.part?.find((x) => x.name === name); return p ? parseInt(p.offset, 16) : undefined; };
  const plan = [];
  const factory = mt.files.find((f) => f.name.endsWith(".factory.bin"));
  if (!factory) throw new Error("Manifest has no .factory.bin");
  plan.push({ name: factory.name, address: 0 });
  const ota = mt.files.find((f) => f.part_name === "app1");
  if (ota && off("app1") !== undefined) plan.push({ name: ota.name, address: off("app1") });
  const fs = mt.files.find((f) => f.part_name === "spiffs");
  if (fs && off("spiffs") !== undefined) plan.push({ name: fs.name, address: off("spiffs") });
  const files = [];
  for (const f of plan) {
    log(`Downloading ${f.name} → 0x${f.address.toString(16)}`);
    files.push({ data: toBinStr(await fetchBin(`${base}/${f.name}`)), address: f.address });
  }
  return files;
}

let port = null;
// ---------- what is plugged in ----------
// A page only sees a USB device after the user picks it. Then: (1) the USB id says which chip family,
// (2) running Meshtastic firmware reports the exact board and its version. Nothing here leaves the browser.
const USB_FAMILY = { 0x239a: "nrf52", 0x2886: "nrf52", 0x303a: "esp32", 0x10c4: "esp32", 0x1a86: "esp32", 0x0403: "esp32" };
const NRF_UPDATE_MODE = new Set(["239a:0029", "2886:0044", "2886:0045", "2886:0057"]); // UF2 bootloader ids
const NRF_KNOWN = { "239a:4405": ["t-echo", "LilyGo T-Echo"] };
let detected = null;   // { family, pioEnv, name, fw } from the last detection or connection
let fwOverride = false; // user chose "Configure anyway" on out-of-date firmware

const usbKey = (p) => { const i = p?.getInfo?.() ?? {}; const h = (n) => (n ?? 0).toString(16).padStart(4, "0"); return { vid: i.usbVendorId, key: `${h(i.usbVendorId)}:${h(i.usbProductId)}` }; };

function identify(st) {
  const { vid, key } = usbKey(port);
  const pioEnv = st?.pioEnv ?? NRF_KNOWN[key]?.[0] ?? null;
  const board = BOARDS.boards.find(([t]) => t === pioEnv);
  const hw = st?.metadata?.hwModel;
  const family = USB_FAMILY[vid] ?? (board ? "esp32" : "unknown");
  const name = board?.[1] ?? NRF_KNOWN[key]?.[1] ?? (pioEnv || (hw ? Protobuf.Mesh.HardwareModel[hw] : null));
  detected = { family, pioEnv, name, fw: st?.metadata?.firmwareVersion ?? null, updateMode: NRF_UPDATE_MODE.has(key) };
  if (board) $("board").value = board[0];
  showNrfSteps(family === "nrf52");
  return detected;
}

function showNrfSteps(on) {
  $("nrf-steps").hidden = !on;
  if (!on) return;
  const env = detected?.pioEnv || "<your board>";
  $("nrf-file").textContent = `firmware-${env}-<version>.uf2`;
  $("nrf-cp").textContent = `cp -X ~/Downloads/firmware-${env}-*.uf2 /Volumes/<drive name>/`;
}

// nRF52 boards update by drag-and-drop onto a drive their bootloader shows. Getting there normally takes a quick
// double-press of the reset button, which is fiddly; firmware 2.2.17+ will also go there when asked over USB
// (the official flasher does the same). Nothing is erased or written by this.
const BOOT_DRIVE = { "t-echo": "TECHOBOOT" };
async function enterUpdateMode() {
  if (!("serial" in navigator)) { err("This browser can't reach USB serial devices. Use desktop Chrome, Edge or Opera (or Firefox 151+)."); return; }
  const out = $("dfu-status");
  const manual = "Double-press the board's Reset button quickly instead.";
  busy(true);
  try {
    await pickPort();
    if (NRF_UPDATE_MODE.has(usbKey(port).key)) { out.textContent = "This board is already in update mode. Its drive should be showing; go on to the next step."; return; }
    out.textContent = "Asking the radio to switch to update mode…";
    let c;
    try { c = await connectMesh(10000); }
    catch { out.textContent = `Meshtastic didn't answer on that port, so it can't be asked. ${manual}`; return; }
    const d = identify(c.st);
    if (d.family !== "nrf52") {
      try { await c.dev.disconnect(); } catch {}
      out.textContent = "This isn't an nRF52 board, so it doesn't update by drag-and-drop. Use \"Erase, flash & configure\" in step 04.";
      return;
    }
    const p = port;
    let dropped = false;
    const gone = new Promise((res) => p.addEventListener?.("disconnect", () => { dropped = true; res(); }, { once: true }));
    log("→ enter update mode (nothing is erased)");
    await Promise.race([c.dev.enterDfuMode(), sleep(3000)]); // it leaves at once and may never acknowledge
    try { await c.dev.disconnect(); } catch {}
    try { await p.close(); } catch {}
    await Promise.race([gone, sleep(10000)]);
    const drive = BOOT_DRIVE[d.pioEnv] ? `named ${BOOT_DRIVE[d.pioEnv]}` : "(its name usually ends in BOOT)";
    if (dropped) {
      ok("The radio switched to update mode.");
      out.textContent = `Done. A drive ${drive} should appear on your computer within a few seconds. Go on to the next step. To back out without updating, press the board's Reset button once.`;
    } else {
      warn("The radio didn't switch to update mode.");
      out.textContent = `The radio didn't switch (older firmware can't). ${manual}`;
    }
  } catch (e) {
    out.textContent = e.name === "NotFoundError" ? "No device picked." : `Couldn't switch to update mode: ${e.message}. ${manual}`;
  } finally { busy(false); }
}

async function detect() {
  if (!("serial" in navigator)) { err("This browser can't reach USB serial devices. Use desktop Chrome, Edge or Opera (or Firefox 151+)."); return; }
  const out = $("detect-result");
  busy(true);
  try {
    await pickPort();
    let st = null;
    if (!NRF_UPDATE_MODE.has(usbKey(port).key)) {
      out.textContent = "Asking the board what it is…";
      try { const c = await connectMesh(8000); st = c.st; try { await c.dev.disconnect(); } catch {} } catch { /* no Meshtastic answering */ }
      try { await port.close(); } catch {}
    }
    const d = identify(st);
    if (d.updateMode) out.textContent = "An nRF52 board in update mode (its USB drive should be showing). Copy the firmware file onto the drive; steps below.";
    else if (d.fw) {
      const current = await resolveFirmware();
      const old = olderThan(d.fw, current);
      const blank = (st?.config?.lora?.region ?? 0) === 0 ? " No region is set, so it is new or freshly erased." : "";
      out.textContent = `${d.name ?? "Meshtastic board"}, running firmware ${shortVer(d.fw)}. `
        + (old ? `Out of date: current is ${shortVer(current)}. Update it before configuring` : "Up to date.")
        + (d.family === "nrf52" ? (old ? " (drag-and-drop, steps below)." : " This is an nRF52 board; if it ever needs an update, that is drag-and-drop (steps below).") : (old ? ': "Erase, flash & configure" installs the current firmware.' : ""))
        + blank;
    }
    else if (d.family === "nrf52") out.textContent = `${d.name ?? "An nRF52 board"}, but Meshtastic didn't answer. Install the firmware with the steps below, then use "Configure only".`;
    else if (d.family === "esp32") out.textContent = "An ESP32 board with no Meshtastic answering (blank, or busy). Pick your exact board from the list; the USB id alone can't tell ESP32 boards apart.";
    else out.textContent = "Couldn't tell what this is. Pick your board from the list.";
  } catch (e) {
    out.textContent = e.name === "NotFoundError" ? "No device picked. If yours wasn't listed, try another USB cable: charge-only cables are the usual cause." : `Detection failed: ${e.message}`;
  } finally { busy(false); }
}

// Before any setting is sent: is the firmware current enough?
async function firmwareGate(s, st, dev) {
  const d = identify(st);
  if (!d.fw) return;
  const current = await resolveFirmware();
  const need = s.minFirmware;
  const tooOld = need && olderThan(d.fw, need);
  if (!tooOld && (!olderThan(d.fw, current) || fwOverride)) return;
  try { await dev.disconnect(); } catch {}
  try { await port.close(); } catch {}
  $("fw-gate-text").textContent = tooOld
    ? `This radio is on firmware ${shortVer(d.fw)}. ${s.source} needs ${need} or newer, so these settings can't be applied until it is updated. Current is ${shortVer(current)}.`
    : `This radio is on firmware ${shortVer(d.fw)}. Current is ${shortVer(current)}. Update first: older firmware can lack presets and fixes that these settings assume.`;
  $("btn-fw-anyway").hidden = !!tooOld;
  $("btn-fw-update").textContent = d.family === "nrf52" ? "Show me how to update" : "Erase, update & configure";
  $("fw-gate").hidden = false;
  const e = new Error(`Stopped before changing anything: firmware ${shortVer(d.fw)} is older than ${shortVer(tooOld ? need : current)}.`);
  e.name = "FirmwareGate";
  throw e;
}

async function pickPort() {
  port = await navigator.serial.requestPort({});
  port.ondisconnect = () => warn("Serial port disconnected (normal during reboots on native-USB boards).");
  return port;
}

async function flash() {
  const files = await buildFileArray();
  await pickPort();
  const transport = new Transport(port, true);
  const loader = new ESPLoader({ transport, baudrate: Number($("baud").value), terminal: { clean() {}, writeLine: (d) => log(d), write: () => {} } });
  ok(`Bootloader connected: ${await loader.main()}`);
  log("Erasing chip and writing firmware (the slow part)…");
  let lastPct = -10;
  await loader.writeFlash({
    fileArray: files, flashSize: "keep", flashMode: "keep", flashFreq: "keep", eraseAll: true, compress: true,
    reportProgress: (i, written, total) => {
      const pct = Math.round((written / total) * 100);
      $("progress").value = pct;
      $("progtext").textContent = `file ${i + 1}/${files.length}: ${pct}%`;
      if (pct - lastPct >= 25 || pct === 100) { lastPct = pct; log(`  file ${i + 1}/${files.length}: ${pct}%`); }
    },
  });
  ok("Flash written. Hard-resetting via RTS…");
  await transport.setRTS(true); await sleep(100); await transport.setRTS(false);
  await transport.disconnect();
  await transport.waitForUnlock(1500);
}

// ---------- configuring ----------
// Our own serial transport. The library one (@meshtastic/transport-web-serial 0.2.5) can't let go of a port:
// its disconnect() tries to close while the port's read stream is still locked, the close fails quietly, and
// the tab keeps holding the port. The next connection then reuses the still-open port, can't read from it,
// and looks exactly like a radio that says nothing. Here both pipes hang off one abort signal, so
// disconnect() unlocks both streams and the port really closes.
async function openTransport(p) {
  if (p.readable || p.writable) { try { await p.close(); } catch {} }
  if (p.readable || p.writable) throw new Error("The port is still open from an earlier step. Reload this page and try again");
  await p.open({ baudRate: 115200 });
  const ac = new AbortController();
  const to = Utils.toDeviceStream();
  const from = Utils.fromDeviceStream();
  const down = to.readable.pipeTo(p.writable, { signal: ac.signal }).catch(() => {});
  const up = p.readable.pipeTo(from.writable, { signal: ac.signal }).catch(() => {});
  const fromDevice = new ReadableStream({
    start(ctrl) {
      ctrl.enqueue({ type: "status", data: { status: 5 } }); // DeviceConnected
      (async () => {
        const r = from.readable.getReader();
        try { for (;;) { const { value, done } = await r.read(); if (done) break; ctrl.enqueue(value); } } catch {}
        try { ctrl.close(); } catch {}
      })();
    },
  });
  let closed = null;
  const disconnect = () => (closed ??= (async () => {
    ac.abort();
    await Promise.allSettled([down, up]);
    try { await p.close(); } catch {}
  })());
  return { toDevice: to.writable, fromDevice, disconnect };
}
async function connectMesh(timeoutMs = 30000) {
  if (!port) {
    const granted = await navigator.serial.getPorts();
    port = granted.length === 1 ? granted[0] : await pickPort();
  }
  const transport = await openTransport(port);
  // Ask for the radio's own settings only (firmware's SPECIAL_NONCE_ONLY_CONFIG). A normal handshake also dumps
  // every other radio it has heard, which on a busy mesh can run past the timeout. Firmware that predates the
  // special value treats it as an ordinary id and sends everything, so this is safe either way.
  const ONLY_CONFIG = 69420;
  const dev = new MeshDevice(transport, ONLY_CONFIG);
  // The library's disconnect can throw before it reaches the transport. Always release the port.
  const libDisconnect = dev.disconnect.bind(dev);
  dev.disconnect = async () => { try { await withTimeout(libDisconnect(), 3000, "disconnect"); } catch {} await transport.disconnect(); };
  const st = { config: {}, module: {}, channels: {}, myNodeNum: null, users: {}, metadata: null };
  const seen = { myInfo: 0, metadata: 0, config: 0, module: 0, channels: 0, nodes: 0 };
  dev.events.onMyNodeInfo.subscribe(() => seen.myInfo++);
  dev.events.onDeviceMetadataPacket.subscribe(() => seen.metadata++);
  dev.events.onConfigPacket.subscribe(() => seen.config++);
  dev.events.onModuleConfigPacket.subscribe(() => seen.module++);
  dev.events.onChannelPacket.subscribe(() => seen.channels++);
  dev.events.onNodeInfoPacket.subscribe(() => seen.nodes++);
  dev.events.onConfigPacket.subscribe((c) => c.payloadVariant?.case && (st.config[c.payloadVariant.case] = c.payloadVariant.value));
  dev.events.onModuleConfigPacket.subscribe((c) => c.payloadVariant?.case && (st.module[c.payloadVariant.case] = c.payloadVariant.value));
  dev.events.onChannelPacket.subscribe((ch) => (st.channels[ch.index] = ch));
  dev.events.onMyNodeInfo.subscribe((m) => { st.myNodeNum = m.myNodeNum; st.pioEnv = m.pioEnv || null; st.rebootCount = m.rebootCount; });
  dev.events.onNodeInfoPacket.subscribe((n) => n.user && (st.users[n.num] = n.user));
  dev.events.onDeviceMetadataPacket.subscribe((p) => (st.metadata = p.data));
  const configured = new Promise((res) => dev.events.onDeviceStatus.subscribe((x) => x === 7 && res()));
  dev.configure().catch(() => {});
  dev.setHeartbeatInterval(30000);
  // Give up early if the radio hasn't said a single thing after 12 seconds: waiting longer won't help.
  const quiet = sleep(Math.min(12000, timeoutMs)).then(() => (Object.values(seen).some(Boolean) ? sleep(timeoutMs) : null)).then(() => true);
  const timedOut = await Promise.race([configured.then(() => false), sleep(timeoutMs).then(() => true), quiet]);
  if (timedOut) {
    // Let go of the port properly. Without this the streams stay locked, close() fails, and every retry
    // dies with "The port is already open".
    try { await withTimeout(dev.disconnect(), 3000, "disconnect"); } catch {}
    try { await withTimeout(transport.disconnect(), 3000, "disconnect"); } catch {}
    try { await port.close(); } catch {}
    const total = Object.values(seen).reduce((a, b) => a + b, 0);
    const e = new Error(total === 0
      ? "The radio opened the USB port but sent nothing back"
      : `The radio started answering but didn't finish in time (got: ${seen.myInfo ? "identity" : "no identity"}, ${seen.config + seen.module} settings sections, ${seen.channels} channels, ${seen.nodes} radio records)`);
    e.silent = total === 0;
    throw e;
  }
  return { dev, st };
}
async function connectWithRetry(tries = 6, perTryMs = 30000) {
  for (let i = 1; i <= tries; i++) {
    try { log(`Connecting to Meshtastic API (attempt ${i}/${tries})…`); await refreshPort(); return await connectMesh(perTryMs); }
    catch (e) { warn(e.message); try { await port?.close(); } catch {} if (i === tries || (e.silent && i >= 2 && perTryMs >= 30000)) throw e; await sleep(5000); }
  }
}

// Boards with native USB (nRF52 such as the T-Echo, ESP32-S3 without a bridge chip) drop off USB when they
// restart. Pick the same device up again from the ports this page was already allowed to use.
let lastUsbKey = null;
async function refreshPort() {
  if (!port) return;
  lastUsbKey = usbKey(port).key;
  const ports = await navigator.serial.getPorts();
  if (ports.includes(port) && port.connected !== false) return;
  const back = ports.find((p) => usbKey(p).key === lastUsbKey && p.connected !== false);
  if (back) { port = back; port.ondisconnect = () => warn("Serial port disconnected (normal during reboots on native-USB boards)."); }
}
// Call before sending the commit, with the radio's restart counter from the connection that is about to commit;
// await the returned function afterwards. It resolves once the radio has really restarted, so the check that
// follows reads the radio as it will run, not as it was a moment before restarting. Two signs count:
//  - it dropped off USB and came back (native-USB boards: nRF52, bridge-less ESP32-S3), or
//  - it is still on USB but its restart counter went up (boards with a USB bridge chip never drop).
// Radios take anywhere from 2 to 12 seconds to start the restart after a commit, hence the patience.
// Returns an open connection if it had to make one to read the counter, else null.
function watchReboot(countBefore, opts = {}) {
  // opts.report: never warn or throw; resolve to { restarted, conn } and let the caller word the outcome.
  const p = port, key = usbKey(p).key;
  let dropped = false;
  const gone = new Promise((res) => p?.addEventListener?.("disconnect", () => { dropped = true; res(); }, { once: true }));
  return async () => {
    const deadline = Date.now() + (opts.waitMs ?? 25000);
    log("Waiting for the radio to restart…");
    while (!dropped && Date.now() < deadline) {
      await Promise.race([gone, sleep(5000)]);
      if (dropped || countBefore === undefined) break;
      let c = null;
      try { c = await connectMesh(8000); } catch { continue; }
      if (dropped) break;
      if (c.st.rebootCount !== countBefore) return opts.report ? { restarted: true, conn: c } : c;
      try { await c.dev.disconnect(); } catch {}
    }
    if (!dropped) {
      if (opts.report) return { restarted: false };
      if (countBefore !== undefined) warn("The radio hasn't restarted on its own. Checking what it saved; unplug and replug it afterwards so everything takes effect.");
      return null;
    }
    log("Radio dropped off USB to restart; waiting for it to come back…");
    for (let i = 0; i < 40; i++) {
      await sleep(1000);
      const back = (await navigator.serial.getPorts()).find((x) => usbKey(x).key === key && x.connected !== false);
      if (back) { port = back; await sleep(3000); return opts.report ? { restarted: true, conn: null } : null; }
    }
    if (opts.report) return { restarted: false, gone: true };
    throw new Error("The radio didn't come back on USB after restarting. Unplug it, plug it back in, and press the button again to check.");
  };
}
let rebootDone = null;
const withTimeout = (p, ms, what) => Promise.race([p, sleep(ms).then(() => { throw new Error(`${what} timed out`); })]);
const defined = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

async function pushConfig(s) {
  const { dev, st } = await connectWithRetry();
  ok(`Connected. Node !${(st.myNodeNum >>> 0).toString(16)}, firmware ${st.metadata?.firmwareVersion ?? "?"}`);
  await firmwareGate(s, st, dev);
  const have = (k) => strip(st.config[k] ?? {});
  const hasWifi = st.metadata?.hasWifi ?? true;
  const send = async (what, fn) => { log(`→ ${what}`); await withTimeout(fn(), 15000, what); };
  const setCfg = (k, value) => dev.setConfig(create(C.ConfigSchema, { payloadVariant: { case: k, value } }));

  // A channel URL's LoRa block is what the mesh published: its preset and slot win over the form.
  const urlLora = s.channel.kind === "url" ? strip(s.channel.set.loraConfig ?? {}) : {};
  if (s.channel.kind === "url" && s.channel.set.loraConfig) {
    s.preset = urlLora.modemPreset;
    if (urlLora.channelNum) s.slot = urlLora.channelNum;
  }
  // LoRa: read-modify-write. setConfig replaces the whole section.
  const lora = s.stock ? { ...have("lora"), region: s.region, txEnabled: true } : {
    ...have("lora"), ...urlLora,
    region: s.region, txEnabled: true, usePreset: s.usePreset,
    modemPreset: s.channel.kind === "url" && s.channel.set.loraConfig ? urlLora.modemPreset : s.preset,
    hopLimit: s.hopLimit, txPower: s.txPower, channelNum: s.slot ?? 0,
    configOkToMqtt: !!s.okToMqtt,
    ...defined({ ignoreMqtt: s.ignoreMqtt, bandwidth: s.usePreset ? undefined : s.bandwidth, spreadFactor: s.usePreset ? undefined : s.spreadFactor,
      codingRate: s.usePreset ? undefined : s.codingRate, frequencyOffset: s.freqOffset, overrideFrequency: s.overrideFreq,
      sx126xRxBoostedGain: s.rxBoost }),
  };
  const presetName = s.usePreset ? PRESET_LABEL[lora.modemPreset] ?? lora.modemPreset : `custom BW${lora.bandwidth}/SF${lora.spreadFactor}/CR${lora.codingRate}`;

  if (s.stock) {
    // "Standard settings" leaves the radio's LoRa settings alone. On a new or freshly erased radio those are
    // Meshtastic's defaults; on a used one they are whatever its last owner (or mesh) set. Say which.
    const onDefaults = lora.usePreset !== false && (lora.modemPreset ?? 0) === PRESET.LONG_FAST && !lora.channelNum && (lora.hopLimit ?? FW_DEFAULT.hopLimit) === FW_DEFAULT.hopLimit;
    const what = `${presetName}, slot ${lora.channelNum || "auto"}, ${lora.hopLimit} hops`;
    await send(`LoRa: ${REGION_LABEL[s.region]} · ${onDefaults ? `Meshtastic defaults (${what})` : `keeping what this radio already has (${what})`}`, () => setCfg("lora", lora));
    if (!onDefaults) warn(`These are not Meshtastic's defaults (${PRESET_LABEL[PRESET.LONG_FAST]}, slot auto, ${FW_DEFAULT.hopLimit} hops): this radio was set up for a particular mesh before. Fine if that is the mesh you want. For a clean start, use "Start over" (card 05) and then set it up again.`);
  } else {
    await send(`device: role ${ROLE_LABEL[s.role]}${s.nodeInfoSecs ? `, nodeinfo ${fmtSecs(s.nodeInfoSecs)}` : ""}`, () =>
      setCfg("device", { ...have("device"), role: s.role, ...defined({ nodeInfoBroadcastSecs: s.nodeInfoSecs }) }));
    await send(`LoRa: ${REGION_LABEL[s.region]} · ${presetName} · slot ${lora.channelNum || "auto"} · ${lora.hopLimit} hops · OK-to-MQTT ${lora.configOkToMqtt ? "on" : "off"}`, () =>
      setCfg("lora", lora));
  }
  if (s.positionSecs !== undefined || s.smart !== undefined) {
    await send(`position: ${s.positionSecs ? "every " + fmtSecs(s.positionSecs) : "default interval"}, smart ${s.smart === undefined ? "default" : s.smart ? "on" : "off"}`, () =>
      setCfg("position", { ...have("position"), ...defined({ positionBroadcastSecs: s.positionSecs, positionBroadcastSmartEnabled: s.smart }) }));
  }
  if (s.conn === "ble") {
    await send("Bluetooth: fixed PIN", () => setCfg("bluetooth", { ...have("bluetooth"), enabled: true, mode: C.Config_BluetoothConfig_PairingMode.FIXED_PIN, fixedPin: Number(s.pin) }));
    if (have("network").wifiEnabled) await send("WiFi: off (so Bluetooth works)", () => setCfg("network", { ...have("network"), wifiEnabled: false }));
  } else {
    if (!hasWifi) throw new Error("This board has no WiFi. Pick Bluetooth instead.");
    await send(`WiFi: ${s.ssid}`, () => setCfg("network", { ...have("network"), wifiEnabled: true, wifiSsid: s.ssid, wifiPsk: s.wifiPsk }));
  }
  if (s.telemetrySecs) {
    await send(`telemetry: device metrics every ${fmtSecs(s.telemetrySecs)}`, () =>
      dev.setModuleConfig(create(Protobuf.ModuleConfig.ModuleConfigSchema, {
        payloadVariant: { case: "telemetry", value: { ...strip(st.module.telemetry ?? {}), deviceUpdateInterval: s.telemetrySecs } },
      })));
  }

  // Channels
  const CR = Protobuf.Channel.Channel_Role;
  if (s.channel.kind === "url") {
    const list = s.channel.set.settings;
    for (let i = 0; i < 8; i++) {
      const settings = list[i];
      if (!settings && !st.channels[i]?.role) continue;
      const role = settings ? (i === 0 ? CR.PRIMARY : CR.SECONDARY) : CR.DISABLED;
      await send(`channel ${i}${settings ? ` "${settings.name || "(preset default)"}"` : " (disable)"}`, () =>
        dev.setChannel(create(Protobuf.Channel.ChannelSchema, { index: i, role, settings: settings ? strip(settings) : {} })));
    }
  } else {
    const name = s.channel.kind === "manual" ? s.channel.name : "";
    const psk = s.channel.kind === "manual" ? pskBytes(s.channel.psk) : new Uint8Array([1]);
    const cur = st.channels[0]?.settings;
    const same = cur && cur.name === name && bytesToB64(cur.psk ?? new Uint8Array()) === bytesToB64(psk);
    if (!same) {
      await send(`primary channel: ${name ? `"${name}"` : "public default"}`, () =>
        dev.setChannel(create(Protobuf.Channel.ChannelSchema, { index: 0, role: CR.PRIMARY, settings: { ...strip(cur ?? {}), name, psk } })));
      if (s.channel.kind === "manual" && s.channel.psk === "random") warn(`Random PSK generated — save it now: ${bytesToB64(psk)}`);
    } else log("primary channel already correct — leaving it");
  }

  const me = st.users[st.myNodeNum] ?? {};
  await send(`owner: "${s.longName}" / "${s.shortName}"`, () =>
    dev.setOwner(create(Protobuf.Mesh.UserSchema, { ...strip(me), longName: s.longName, shortName: s.shortName, isLicensed: false })));

  rebootDone = watchReboot(st.rebootCount);
  await send("commit (node will reboot)", () => dev.commitEditSettings());
  ok("Settings committed. Node is rebooting.");
  try { await dev.disconnect(); } catch {}
  try { await port.close(); } catch {}
}

async function verify(s) {
  const already = rebootDone ? await rebootDone() : (await sleep(4000), null);
  rebootDone = null;
  const { dev, st } = already ?? await connectWithRetry(8, 15000);
  const L = st.config.lora ?? {}, D = st.config.device ?? {}, P = st.config.position ?? {}, B = st.config.bluetooth ?? {}, N = st.config.network ?? {};
  const T = st.module.telemetry ?? {};
  const me = st.users[st.myNodeNum] ?? {};
  const expPreset = s.channel.kind === "url" && s.channel.set.loraConfig ? s.channel.set.loraConfig.modemPreset : s.preset;
  const rows = [
    ["Firmware", st.metadata?.firmwareVersion ? shortVer(st.metadata.firmwareVersion) + (currentFw && olderThan(st.metadata.firmwareVersion, currentFw) ? ` (out of date; current is ${shortVer(currentFw)})` : "") : "?", true],
    ["Region", REGION_LABEL[L.region], L.region === s.region],
    ["Modem", L.usePreset ? PRESET_LABEL[L.modemPreset] ?? L.modemPreset : `custom BW${L.bandwidth}/SF${L.spreadFactor}/CR${L.codingRate}`, s.stock || (s.usePreset ? L.modemPreset === expPreset : !L.usePreset)],
    ["Frequency slot", L.channelNum ? String(L.channelNum) : "auto", s.stock || (L.channelNum ?? 0) === (s.slot ?? 0)],
    ["TX enabled", String(L.txEnabled), L.txEnabled === true],
    ["TX power", `${L.txPower} dBm${L.txPower === 0 ? " (region max)" : ""}`, s.stock || L.txPower === s.txPower],
    ["Hop limit", String(L.hopLimit), s.stock || L.hopLimit === s.hopLimit],
    ["On community maps (OK to MQTT)", L.configOkToMqtt ? "yes" : "no", s.stock || !!L.configOkToMqtt === !!s.okToMqtt],
    ["Role", ROLE_LABEL[D.role ?? 0] ?? D.role, s.stock || (D.role ?? 0) === s.role],
    ["Names", `${me.longName} / ${me.shortName}`, me.longName === s.longName && me.shortName === s.shortName],
    ["Primary channel", st.channels[0]?.settings?.name || "public default", true],
  ];
  if (s.nodeInfoSecs) rows.push(["NodeInfo interval", fmtSecs(D.nodeInfoBroadcastSecs), D.nodeInfoBroadcastSecs === s.nodeInfoSecs]);
  if (s.positionSecs) rows.push(["Position interval", fmtSecs(P.positionBroadcastSecs), P.positionBroadcastSecs === s.positionSecs]);
  if (s.smart !== undefined) rows.push(["Smart position", String(P.positionBroadcastSmartEnabled), P.positionBroadcastSmartEnabled === s.smart]);
  if (s.telemetrySecs) rows.push(["Telemetry interval", fmtSecs(T.deviceUpdateInterval), T.deviceUpdateInterval === s.telemetrySecs]);
  if (s.conn === "ble") rows.push(["Bluetooth", `${C.Config_BluetoothConfig_PairingMode[B.mode]} ${B.fixedPin}`, B.mode === 1 && B.fixedPin === Number(s.pin)]);
  else rows.push(["WiFi", `${N.wifiEnabled ? "on" : "off"} → ${N.wifiSsid}`, N.wifiEnabled && N.wifiSsid === s.ssid]);

  const tbody = $("verify").querySelector("tbody");
  tbody.innerHTML = "";
  let allGood = true;
  for (const [k, v, good] of rows) {
    allGood &&= good;
    const tr = document.createElement("tr");
    tr.className = good ? "ok" : "err";
    tr.innerHTML = `<td>${good ? "✔" : "✘"}</td><td>${k}</td><td></td>`;
    tr.lastChild.textContent = v ?? "?";
    tbody.appendChild(tr);
  }
  $("verify").hidden = false;
  (allGood ? ok : warn)(allGood ? `Verification passed (${s.source}). Go say hi on the mesh.` : "Some settings didn't stick — see table.");
  try { await dev.disconnect(); } catch {}
  try { await port.close(); } catch {}
  return allGood;
}

// ---------- orchestration ----------
async function run(kind) {
  const { s, problems } = readSettings();
  if (problems.length) { problems.forEach(err); return; }
  if (kind === "full" && detected?.family === "nrf52") {
    err("This is an nRF52 board. The page can't flash it: copy the firmware file onto its USB drive (steps under \"Your radio\"), then press \"Configure only\".");
    return;
  }
  $("fw-gate").hidden = true;
  if (!("serial" in navigator)) { err("This browser can't reach USB serial devices. Use desktop Chrome, Edge or Opera (or Firefox 151+)."); return; }
  busy(true);
  $("verify").hidden = true;
  ["2", "3", "4"].forEach((n) => setStep(n, ""));
  log(`Plan: ${s.source}${mode === "community" ? ` · ${USE_CASES[$("usecase").value]}` : ""}`);
  try {
    if (kind === "full") {
      setStep(2, "active"); await flash(); setStep(2, "done");
      log("Waiting for first boot (formats storage + generates keys, ~15s)…");
      await sleep(15000);
    } else port = null;
    setStep(3, "active"); await pushConfig(s); setStep(3, "done");
    setStep(4, "active"); setStep(4, (await verify(s)) ? "done" : "fail");
  } catch (e) {
    if (e.name === "FirmwareGate") { warn(e.message); ["2", "3", "4"].forEach((n) => setStep(n, "")); return; }
    err(e.message || String(e)); console.error(e);
    document.querySelectorAll('[data-state="active"]').forEach((el) => (el.dataset.state = "fail"));
    if (e.name === "NotFoundError" || /No port selected/i.test(e.message)) {
      warn("No board picked. If your board wasn't in the list: try a different USB cable (charge-only cables are the #1 cause), plug directly into the computer, install the CP210x/CH9102 driver, or hold BOOT while plugging in.");
    } else if (!e.silent && /port|open|lock/i.test(e.message)) warn("Close any other tab/app using the serial port (Meshtastic desktop app, serial monitor, Arduino IDE).");
    else if (e.silent) warn("Nothing came back from the radio. Most often another program has it: close the Meshtastic desktop or web app and any other flasher tab. Otherwise unplug the radio, wait 10 seconds, plug it back in and try again. If it still says nothing, the firmware may not be running: reinstall it.");
    else if (/timed out|handshake|sync|connect|didn't finish/i.test(e.message)) warn("The board stopped answering part-way. Try another cable or USB port, then press the button again.");
  } finally { busy(false); }
}

// ---------- factory reset ("someone gave me this radio") ----------
// Two deliberate clicks, then a 10 second countdown inside the confirm button with Cancel beside it.
let resetTimer = null;
const resetIdle = () => { clearInterval(resetTimer); resetTimer = null; $("btn-reset-go").textContent = "Yes, erase it"; };
async function resetStart() {
  if (!("serial" in navigator)) { err("This browser can't reach USB serial devices. Use desktop Chrome, Edge or Opera (or Firefox 151+)."); return; }
  const out = $("reset-status");
  $("reset-confirm").hidden = true; resetIdle();
  busy(true);
  try {
    await pickPort();
    let st = null;
    out.textContent = "Asking the radio what it is…";
    try { const c = await connectMesh(8000); st = c.st; try { await c.dev.disconnect(); } catch {} } catch { /* nothing answering */ }
    try { await port.close(); } catch {}
    const d = identify(st);
    if (!d.fw) {
      out.textContent = d.family === "nrf52"
        ? "Meshtastic isn't answering on this radio, so it can't be reset from here. Reinstall the firmware with the drag-and-drop steps under \"Your radio\"."
        : "Meshtastic isn't answering on this radio, so it can't be reset from here. \"Erase, flash & configure\" wipes it completely and installs fresh firmware.";
      return;
    }
    const who = st.users[st.myNodeNum]?.longName;
    $("reset-what").textContent = `Erase ${d.name ?? "this radio"}${who ? `, currently named "${who}"` : ""} (firmware ${shortVer(d.fw)})?`;
    $("reset-confirm").hidden = false;
    out.textContent = "";
  } catch (e) {
    out.textContent = e.name === "NotFoundError" ? "No radio picked. Nothing was changed." : `Couldn't reach the radio: ${e.message}`;
  } finally { busy(false); }
}
function resetArm() {
  let n = 10;
  busy(true); // also disables the confirm button itself; Cancel is not an action button and stays live
  $("btn-reset-go").textContent = `Erasing in ${n}…`;
  $("reset-status").textContent = "";
  resetTimer = setInterval(() => {
    n--;
    if (n > 0) { $("btn-reset-go").textContent = `Erasing in ${n}…`; return; }
    resetIdle(); $("btn-reset-go").textContent = "Erasing…";
    resetFire();
  }, 1000);
}
function resetCancel() {
  const armed = !!resetTimer;
  resetIdle(); busy(false);
  $("reset-confirm").hidden = true;
  $("reset-status").textContent = armed ? "Cancelled. Nothing was changed." : "";
}
// Where the restart button is, for the boards we can name. Used when a radio erases itself and then freezes.
const RESET_BUTTON = { "t-echo": "the top button on its side" };
async function resetFire() {
  const out = $("reset-status");
  let sent = false;
  try {
    const { dev, st } = await connectWithRetry(2);
    const pioEnv = st.pioEnv;
    const restarted = watchReboot(st.rebootCount, { report: true, waitMs: 30000 });
    log("→ factory reset (everything on the radio)");
    await Promise.race([dev.factoryResetDevice(), sleep(5000)]); // the radio is busy erasing and may never acknowledge
    sent = true;
    try { await dev.disconnect(); } catch {}
    try { await port.close(); } catch {}
    out.textContent = "Erase command sent. Waiting for the radio to restart (up to 30 seconds)…";
    // Don't take the radio's word for it: wait for a real restart, then look at what it has.
    const r = await restarted();
    if (!r.restarted) {
      // Seen on a real T-Echo (2.7.26): it erased itself, then froze instead of restarting. One press of reset fixed it.
      const where = RESET_BUTTON[pioEnv] ? ` (${RESET_BUTTON[pioEnv]})` : "";
      warn("The erase command was sent, but the radio hasn't restarted by itself.");
      out.textContent = r.gone
        ? "The radio dropped off USB and hasn't come back. Unplug it, plug it back in, and press Detect in step 01. A blank radio shows up with no region set."
        : `The radio took the erase command but hasn't restarted by itself; some freeze at this point. Press its reset button once${where}, wait about 20 seconds for it to start, then press Detect in step 01. A blank radio shows up with no region set.`;
      return;
    }
    const c = r.conn ?? await connectWithRetry(4, 15000);
    const region = c.st.config.lora?.region ?? 0;
    try { await c.dev.disconnect(); } catch {}
    try { await port.close(); } catch {}
    if (region === 0) {
      ok("Factory reset confirmed: the radio restarted and has no settings.");
      out.textContent = "Done. The radio restarted and is blank. Set it up above like a new radio, and remove the old pairing from your phone's Bluetooth settings.";
    } else {
      err("The radio restarted but still has its settings.");
      out.textContent = `The radio restarted but still has its old settings (region ${REGION_LABEL[region] ?? region}), so the erase did not take. Press the button to try again.`;
    }
  } catch (e) {
    err(e.message || String(e));
    out.textContent = sent
      ? `The erase command was sent, but checking the radio afterwards failed: ${e.message}. Unplug it, plug it back in, and press Detect in step 01 to see whether it is blank.`
      : `The reset didn't go through: ${e.message}. Nothing was changed; press the button to try again.`;
  } finally { resetIdle(); $("reset-confirm").hidden = true; busy(false); }
}

// ---------- family / group channel (the /family/ page) ----------
// The key is made in this tab, lives in memory only, and goes to radios over USB. Nothing is stored or sent.
const SECONDARY = 2;
let fam = null;        // { name, psk: Uint8Array }
let famChoices = [];   // channels read from a radio or a link, when there is more than one
let famDone = 0;

function famLink() {
  const cs = create(Protobuf.AppOnly.ChannelSetSchema, { settings: [{ name: fam.name, psk: fam.psk, moduleSettings: { positionPrecision: $("fam-pos").checked ? 32 : 0 } }] });
  const b = bytesToB64(toBinary(Protobuf.AppOnly.ChannelSetSchema, cs)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return "https://meshtastic.org/e/?add=true#" + b;
}
function famRender() {
  $("fam-ready").hidden = !fam;
  if (!fam) return;
  $("fam-ready-name").textContent = fam.name;
  // The QR is offered only for a channel created in this tab. One read from a radio never puts the key on screen.
  $("fam-save").hidden = !fam.fresh;
  if (!fam.fresh) { const cv = $("fam-qr"); cv.width = cv.height = 1; $("fam-key").textContent = ""; $("fam-key-name").textContent = ""; return; }
  const link = famLink();
  $("fam-key-name").textContent = fam.name;
  $("fam-key").textContent = bytesToB64(fam.psk);
  const q = qrcode(0, "M"); q.addData(link); q.make();
  const n = q.getModuleCount(), scale = 5, pad = 4, cv = $("fam-qr");
  cv.width = cv.height = (n + pad * 2) * scale;
  const g = cv.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, cv.width, cv.height); g.fillStyle = "#000";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) g.fillRect((c + pad) * scale, (r + pad) * scale, scale, scale);
}
function famUse(list, from) {
  famChoices = list.filter((c) => c.name && c.psk?.length);
  $("fam-pick-row").hidden = famChoices.length < 2;
  $("fam-pick").replaceChildren();
  famChoices.forEach((c, i) => opt("fam-pick", String(i), c.name, i === 0));
  fam = famChoices[0] ? { name: famChoices[0].name, psk: famChoices[0].psk } : null;
  $("fam-status").textContent = fam ? `Found ${famChoices.length === 1 ? `channel "${fam.name}"` : `${famChoices.length} channels`} ${from}.` : `No named private channel found ${from}.`;
  famRender();
}
function famNew() {
  const name = $("fam-name").value.trim();
  if (!name || new TextEncoder().encode(name).length > 11) { $("fam-status").textContent = "Give the channel a name of 1 to 11 characters."; return; }
  fam = { name, psk: crypto.getRandomValues(new Uint8Array(32)), fresh: true };
  $("fam-pick-row").hidden = true;
  $("fam-status").textContent = `Created "${name}" with a new random key. If phones need to join, print the one-time QR code below before closing this tab.`;
  famRender();
}
async function famRead() {
  busy(true);
  try {
    port = null;
    const { dev, st } = await connectWithRetry(2);
    const list = Object.values(st.channels).filter((c) => c.index > 0 && c.role === SECONDARY).map((c) => ({ name: c.settings?.name, psk: c.settings?.psk }));
    try { await dev.disconnect(); } catch {}
    try { await port.close(); } catch {}
    famUse(list, "on that radio");
  } catch (e) { $("fam-status").textContent = `Couldn't read the radio: ${e.message}`; }
  finally { busy(false); }
}
async function famPush() {
  if (!fam) { err("Create a channel, or copy one from a radio, first."); return; }
  busy(true);
  try {
    port = null;
    const { dev, st } = await connectWithRetry();
    ok(`Connected. Node !${(st.myNodeNum >>> 0).toString(16)}, firmware ${st.metadata?.firmwareVersion ?? "?"}`);
    const used = (i) => st.channels[i] && st.channels[i].role;
    let idx = [1, 2, 3, 4, 5, 6, 7].find((i) => used(i) && st.channels[i].settings?.name === fam.name);
    const replacing = idx !== undefined;
    idx ??= [1, 2, 3, 4, 5, 6, 7].find((i) => !used(i));
    if (idx === undefined) throw new Error("This radio already has 7 extra channels. Remove one in the Meshtastic app first.");
    const send = async (what, fn) => { log(`→ ${what}`); await withTimeout(fn(), 15000, what); };
    await send("start edit", () => dev.beginEditSettings());
    await send(`channel ${idx}: "${fam.name}"${replacing ? " (replacing the one with the same name)" : ""}, location ${$("fam-pos").checked ? "shared" : "not shared"}`, () =>
      dev.setChannel(create(Protobuf.Channel.ChannelSchema, { index: idx, role: SECONDARY, settings: { name: fam.name, psk: fam.psk, moduleSettings: { positionPrecision: $("fam-pos").checked ? 32 : 0 } } })));
    const restarted = watchReboot(st.rebootCount);
    await send("commit", () => dev.commitEditSettings());
    try { await dev.disconnect(); } catch {}
    try { await port.close(); } catch {}
    const v = (await restarted()) ?? await connectWithRetry(8, 15000);
    const got = v.st.channels[idx]?.settings;
    const good = got?.name === fam.name && bytesToB64(got.psk ?? new Uint8Array()) === bytesToB64(fam.psk);
    const pub = v.st.channels[0]?.settings;
    try { await v.dev.disconnect(); } catch {}
    try { await port.close(); } catch {}
    if (!good) throw new Error("The radio didn't keep the channel. Try again, or check it in the Meshtastic app.");
    famDone++;
    ok(`Channel "${fam.name}" is on this radio (slot ${idx}); its main channel is still ${pub?.name ? `"${pub.name}"` : "the public default"}.`);
    $("fam-count").textContent = `${famDone} radio${famDone === 1 ? "" : "s"} done. Unplug this one, plug in the next, and press the button again.`;
  } catch (e) {
    err(e.message || String(e));
    if (e.name === "NotFoundError") warn("No radio picked. If yours wasn't listed, try a different USB cable.");
  } finally { busy(false); }
}
function famBoot() {
  document.querySelectorAll("[data-fam]").forEach((b) => (b.onclick = () => {
    document.querySelectorAll("[data-fam]").forEach((x) => x.classList.toggle("on", x === b));
    for (const k of ["new", "read"]) $(`fam-${k}`).hidden = k !== b.dataset.fam;
  }));
  $("btn-fam-new").onclick = famNew;
  $("btn-fam-read").onclick = famRead;
  $("btn-fam-push").onclick = famPush;
  $("btn-fam-print").onclick = () => window.print();
  $("fam-pick").onchange = () => { const c = famChoices[Number($("fam-pick").value)]; fam = { name: c.name, psk: c.psk }; famRender(); };
  $("fam-pos").onchange = famRender;
}

// ---------- see how a radio is set (/check/) ----------
// Read-only. Connects, reads what the handshake reports, disconnects. No admin message is ever sent from here.
// Everything from the radio goes on the page as text, never as markup.
const el = (tag, text, cls) => { const e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; };
function checkRender(s) {
  const out = $("check-out"), flags = $("check-flags");
  if (s.flags.length) {
    const ul = el("ul");
    for (const f of s.flags) {
      const li = el("li"); li.append(el("span", "! ", "warn"), f.text);
      if (f.href) { const a = el("a", "Set up a radio"); a.href = f.href; a.onclick = (e) => { e.preventDefault(); showPage("radio"); }; li.append(" ", a); }
      ul.append(li);
    }
    flags.replaceChildren(el("b", "Worth a look"), ul);
  }
  flags.hidden = !s.flags.length;
  const table = (cls, head, rows) => {
    const t = el("table", null, cls), body = el("tbody");
    if (head) { const tr = el("tr"); head.forEach((h) => tr.append(el("th", h))); const th = el("thead"); th.append(tr); t.append(th); }
    for (const r of rows) { const tr = el("tr"); r.forEach((c) => tr.append(el("td", c))); body.append(tr); }
    t.append(body); return t;
  };
  const parts = [];
  for (const sec of s.sections) {
    parts.push(el("h3", sec.title), table("kv", null, sec.rows));
    if (sec.title === "Radio") parts.push(el("h3", "Channels"), s.channels.length
      ? table("", ["Slot", "Name", "Type", "Key", "Location shared", "Sent to MQTT"], s.channels.map((c) => [c.slot, c.name, c.kind, c.key, c.location, c.uplink]))
      : el("p", "The radio reported no channels.", "hint"));
  }
  out.replaceChildren(...parts);
}
async function checkRun() {
  const status = $("check-status");
  if (!("serial" in navigator)) { status.textContent = "This browser can't reach USB serial devices. Use desktop Chrome, Edge or Opera."; return; }
  busy(true);
  $("check-out").replaceChildren(); $("check-flags").replaceChildren(); $("check-flags").hidden = true;
  let dev = null;
  try {
    await pickPort();
    if (NRF_UPDATE_MODE.has(usbKey(port).key)) {
      status.textContent = "This is an nRF52 board in update mode (its USB drive is showing), so its settings can't be read. Press its reset button once to start Meshtastic, then press the button again.";
      return;
    }
    status.textContent = "Reading the radio…";
    let st;
    try {
      try { ({ dev, st } = await connectMesh(12000)); }
      catch (e) {
        // Talking but slow (old firmware sends its whole list of other radios): that is a working radio. Wait longer.
        if (e.silent) throw e;
        status.textContent = "The radio is answering, but slowly. Giving it more time…";
        ({ dev, st } = await connectMesh(30000));
      }
    } catch (e) {
      if (!e.silent) {
        status.textContent = "Meshtastic is running on this radio, but it didn't finish sending its settings. Unplug it, plug it back in, wait about 20 seconds and press the button again. "
          + "If that keeps happening, close anything else that may be using the radio (another tab, the Meshtastic app on this computer).";
        return;
      }
      const d = identify(null);
      const what = d.family === "nrf52" ? `${d.name ?? "an nRF52 board"}` : d.family === "esp32" ? "an ESP32 board" : "a USB device";
      status.textContent = `There is nothing to read: this looks like ${what}, but Meshtastic didn't answer. It may be blank, still starting up, or in use by another app or tab. `
        + "If it is new, install Meshtastic in the \"Set up a radio\" tab.";
      return;
    }
    const d = identify(st);
    const current = await resolveFirmware();
    const summary = summarize(st, { boardName: d.name, family: d.family, currentFw: current, fwChecked: currentFw !== null });
    checkRender(summary);
    status.textContent = `Read at ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}. Nothing was changed.`;
  } catch (e) {
    status.textContent = e.name === "NotFoundError" ? "No device picked. If yours wasn't listed, try another USB cable: charge-only cables are the usual cause." : `Couldn't read the radio: ${e.message}`;
  } finally {
    if (dev) { try { await dev.disconnect(); } catch {} }
    try { await port?.close(); } catch {}
    busy(false);
  }
}

// ---------- tabs ----------
// The page's three jobs are tabs. Which one shows is body[data-page]; app.css hides every part that doesn't name it.
// The starting tab is baked into the HTML at build time (/ and /radio/, /family/, /check/); nothing is read from the address.
let presetsAsked = false;
function showPage(name) {
  if (!["radio", "family", "check"].includes(name)) return;
  document.body.dataset.page = name;
  document.querySelectorAll(".pagetabs button").forEach((t) => { const on = t.dataset.tab === name; t.setAttribute("aria-selected", String(on)); t.tabIndex = on ? 0 : -1; });
  if (name === "radio" && !presetsAsked) { presetsAsked = true; loadPresetIndex(); }
}

// ---------- browser check ----------
function browserCheck() {
  const el = $("browser-check");
  const ua = navigator.userAgent;
  const mobile = /Android|iPhone|iPad|iPod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (!("serial" in navigator)) {
    el.className = "check bad";
    el.innerHTML = '<span class="err">✘ This browser can\'t reach USB serial devices.</span> Open this page in desktop Chrome, Edge or Opera (or Firefox 151+).';
  } else if (!window.isSecureContext) {
    el.className = "check bad";
    el.innerHTML = '<span class="err">✘ Not a secure page.</span> Open it over https:// or http://localhost.';
  } else if (mobile) {
    el.className = "check bad";
    el.innerHTML = '<span class="warn">! Mobile browser detected.</span> It reports USB serial support, but flashing is only tested on desktop.';
  } else {
    el.className = "check good";
    el.innerHTML = '<span class="ok">✔ Your browser supports USB serial.</span> Next: check your cable.';
  }
}

// ---------- boot ----------
window.addEventListener("DOMContentLoaded", () => {
  fillBoards();
  for (const [k, v] of Object.entries(USE_CASES)) opt("usecase", k, v, k === "everyday");

  for (const [k, v] of Object.entries(C.Config_LoRaConfig_RegionCode)) if (isNaN(Number(k))) opt("region", v, k, k === "US");
  for (const [k, v] of Object.entries(PRESET)) opt("preset", v, `${PRESET_LABEL[v]} (${k})`, k === "LONG_FAST");
  for (const [k, v] of Object.entries(ROLE)) opt("role", v, k, k === "CLIENT");

  document.querySelectorAll("[data-mode]").forEach((b) => (b.onclick = () => setMode(b.dataset.mode)));
  $("state").onchange = fillCommunities;
  $("community").onchange = pickCommunity;
  $("usecase").onchange = renderCommunity;
  $("btn-customize").onclick = customize;
  $("usepreset").onchange = syncPresetFields;
  $("btn-genpin").onclick = () => ($("pin").value = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000)));
  document.querySelectorAll("[data-conn]").forEach((b) => (b.onclick = () => setConn(b.dataset.conn)));
  $("btn-full").onclick = () => run("full");
  $("btn-config").onclick = () => run("config");

  renderCommunity(); syncPresetFields(); setMode("standard");
  $("btn-find-mesh").onclick = () => setMode("community");
  $("btn-detect").onclick = detect;
  $("btn-dfu").onclick = enterUpdateMode;
  $("btn-fw-anyway").onclick = async () => { fwOverride = true; try { await run("config"); } finally { fwOverride = false; } };
  $("btn-fw-update").onclick = () => {
    $("fw-gate").hidden = true;
    if (detected?.family === "nrf52") { showNrfSteps(true); $("nrf-steps").scrollIntoView({ behavior: "smooth", block: "center" }); }
    else run("full");
  };
  famBoot();
  $("btn-name").onclick = () => { const n = suggestName(); $("longname").value = n.long; $("shortname").value = n.short; };
  $("btn-reset").onclick = resetStart;
  $("btn-reset-go").onclick = resetArm;
  $("btn-reset-cancel").onclick = resetCancel;
  $("btn-check").onclick = checkRun;
  const tabs = [...document.querySelectorAll(".pagetabs button")];
  tabs.forEach((t, i) => {
    t.onclick = () => showPage(t.dataset.tab);
    t.onkeydown = (e) => { const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0; if (d) { const n = tabs[(i + d + tabs.length) % tabs.length]; n.focus(); showPage(n.dataset.tab); } };
  });
  document.querySelectorAll("[data-goto]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); showPage(a.dataset.goto); }));
  showPage(document.body.dataset.page);
  browserCheck();
});

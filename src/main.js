// MeshNewb — flash stock Meshtastic firmware, then push settings over Web Serial.
// Stack mirrors the official flasher: esptool-js + @meshtastic/core + transport-web-serial.
import { ESPLoader, Transport } from "esptool-js";
import { MeshDevice, Protobuf } from "@meshtastic/core";
import { TransportWebSerial } from "@meshtastic/transport-web-serial";
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import qrcode from "qrcode-generator";
import { suggestName } from "./names.js";
import BOARDS from "../data/boards.json";
import FIRMWARE from "../data/firmware.json";
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
const busy = (on) => document.querySelectorAll("button.act").forEach((b) => (b.disabled = on));

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
let presetIndex = null;          // presets/index.json
let community = null;            // the selected community's full file, or null
const communityCache = new Map();

async function loadPresetIndex() {
  try {
    const r = await fetch("../presets/index.json", SAME_ORIGIN);
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
      const r = await fetch(`../presets/${entry.path}`, SAME_ORIGIN);
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
const verNums = (v) => (String(v ?? "").match(/\d+/g) ?? []).slice(0, 3).map(Number);
const olderThan = (a, b) => { const x = verNums(a), y = verNums(b); for (let i = 0; i < 3; i++) { if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0); } return false; };
const shortVer = (v) => verNums(v).join(".");

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
    else if (d.fw) out.textContent = `${d.name ?? "Meshtastic board"}, running firmware ${shortVer(d.fw)}.` + (d.family === "nrf52" ? " This is an nRF52 board: the page can configure it, but updating is drag-and-drop (steps below)." : "");
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
async function connectMesh(timeoutMs = 30000) {
  if (!port) {
    const granted = await navigator.serial.getPorts();
    port = granted.length === 1 ? granted[0] : await pickPort();
  }
  const transport = await TransportWebSerial.createFromPort(port, 115200);
  const dev = new MeshDevice(transport);
  const st = { config: {}, module: {}, channels: {}, myNodeNum: null, users: {}, metadata: null };
  dev.events.onConfigPacket.subscribe((c) => c.payloadVariant?.case && (st.config[c.payloadVariant.case] = c.payloadVariant.value));
  dev.events.onModuleConfigPacket.subscribe((c) => c.payloadVariant?.case && (st.module[c.payloadVariant.case] = c.payloadVariant.value));
  dev.events.onChannelPacket.subscribe((ch) => (st.channels[ch.index] = ch));
  dev.events.onMyNodeInfo.subscribe((m) => { st.myNodeNum = m.myNodeNum; st.pioEnv = m.pioEnv || null; });
  dev.events.onNodeInfoPacket.subscribe((n) => n.user && (st.users[n.num] = n.user));
  dev.events.onDeviceMetadataPacket.subscribe((p) => (st.metadata = p.data));
  const configured = new Promise((res) => dev.events.onDeviceStatus.subscribe((x) => x === 7 && res()));
  dev.configure().catch(() => {});
  dev.setHeartbeatInterval(30000);
  const timedOut = await Promise.race([configured.then(() => false), sleep(timeoutMs).then(() => true)]);
  if (timedOut) throw new Error("Node didn't finish the config handshake in time");
  return { dev, st };
}
async function connectWithRetry(tries = 6) {
  for (let i = 1; i <= tries; i++) {
    try { log(`Connecting to Meshtastic API (attempt ${i}/${tries})…`); return await connectMesh(); }
    catch (e) { warn(e.message); try { await port?.close(); } catch {} if (i === tries) throw e; await sleep(5000); }
  }
}
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
    await send(`LoRa: ${REGION_LABEL[s.region]} · firmware defaults kept (${presetName}, slot ${lora.channelNum || "auto"}, ${lora.hopLimit} hops)`, () => setCfg("lora", lora));
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

  await send("commit (node will reboot)", () => dev.commitEditSettings());
  ok("Settings committed. Node is rebooting.");
  try { await dev.disconnect(); } catch {}
  try { await port.close(); } catch {}
}

async function verify(s) {
  await sleep(4000);
  const { dev, st } = await connectWithRetry(8);
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
    err("This is an nRF52 board. The page can't flash it: copy the firmware file onto its USB drive (steps under Hardware), then press \"Configure only\".");
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
    } else if (/port|open|lock/i.test(e.message)) warn("Close any other tab/app using the serial port (Meshtastic desktop app, serial monitor, Arduino IDE).");
    else if (/timed out|handshake|sync|connect/i.test(e.message)) warn("The board stopped answering. Try another cable or USB port, or hold BOOT while plugging in and press the button again.");
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
        ? "Meshtastic isn't answering on this radio, so it can't be reset from here. Reinstall the firmware with the drag-and-drop steps under Hardware."
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
async function resetFire() {
  const out = $("reset-status");
  try {
    const { dev } = await connectWithRetry(2);
    log("→ factory reset (everything on the radio)");
    await Promise.race([dev.factoryResetDevice(), sleep(5000)]); // the radio reboots and may never acknowledge
    try { await dev.disconnect(); } catch {}
    try { await port.close(); } catch {}
    ok("Factory reset sent. The radio is restarting with factory settings.");
    out.textContent = "Done. Give it about 20 seconds to restart, then set it up above like a new radio. Remove the old pairing from your phone's Bluetooth settings.";
  } catch (e) {
    err(e.message || String(e));
    out.textContent = `The reset didn't go through: ${e.message}. Nothing may have been changed; press the button to try again.`;
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
  if (!fam) { err("Create or load the channel first (step 01)."); return; }
  const longName = $("fam-long").value.trim(), shortName = $("fam-short").value.trim();
  if ((longName && !shortName) || (!longName && shortName)) { err("Fill in both names, or leave both empty to keep the radio's current name."); return; }
  if ([...shortName].length > 4) { err("Short name is max 4 characters."); return; }
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
    if (longName) await send(`owner: "${longName}" / "${shortName}"`, () =>
      dev.setOwner(create(Protobuf.Mesh.UserSchema, { ...strip(st.users[st.myNodeNum] ?? {}), longName, shortName, isLicensed: false })));
    await send("commit", () => dev.commitEditSettings());
    try { await dev.disconnect(); } catch {}
    try { await port.close(); } catch {}
    await sleep(4000);
    const v = await connectWithRetry(8);
    const got = v.st.channels[idx]?.settings;
    const good = got?.name === fam.name && bytesToB64(got.psk ?? new Uint8Array()) === bytesToB64(fam.psk);
    const pub = v.st.channels[0]?.settings;
    try { await v.dev.disconnect(); } catch {}
    try { await port.close(); } catch {}
    if (!good) throw new Error("The radio didn't keep the channel. Try again, or check it in the Meshtastic app.");
    famDone++;
    ok(`Channel "${fam.name}" is on this radio (slot ${idx}); its main channel is still ${pub?.name ? `"${pub.name}"` : "the public default"}.`);
    $("fam-count").textContent = `${famDone} radio${famDone === 1 ? "" : "s"} done. Unplug this one, plug in the next, change the name above, and press the button again.`;
    $("fam-long").value = ""; $("fam-short").value = "";
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
  $("btn-fw-anyway").onclick = async () => { fwOverride = true; try { await run("config"); } finally { fwOverride = false; } };
  $("btn-fw-update").onclick = () => {
    $("fw-gate").hidden = true;
    if (detected?.family === "nrf52") { showNrfSteps(true); $("nrf-steps").scrollIntoView({ behavior: "smooth", block: "center" }); }
    else run("full");
  };
  famBoot();
  $("btn-name").onclick = () => { const n = suggestName(); $("longname").value = n.long; $("shortname").value = n.short; };
  let famWord = null; // one word per family, a new number per radio
  const famSuggest = (keep) => { const n = suggestName(keep ? famWord : null); famWord = n.word; $("fam-long").value = n.long; $("fam-short").value = n.short; $("btn-fam-word").hidden = false; };
  $("btn-fam-name").onclick = () => famSuggest(true);
  $("btn-fam-word").onclick = () => famSuggest(false);
  $("btn-reset").onclick = resetStart;
  $("btn-reset-go").onclick = resetArm;
  $("btn-reset-cancel").onclick = resetCancel;
  if (document.body.dataset.page !== "family") loadPresetIndex();
  browserCheck();
});

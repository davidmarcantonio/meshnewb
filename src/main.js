// MeshProv — flash stock Meshtastic firmware, then push settings over Web Serial.
// Stack mirrors the official flasher: esptool-js + @meshtastic/core + transport-web-serial.
import { ESPLoader, Transport } from "esptool-js";
import { MeshDevice, Protobuf } from "@meshtastic/core";
import { TransportWebSerial } from "@meshtastic/transport-web-serial";
import { create, fromBinary } from "@bufbuild/protobuf";
import BOARDS from "../data/boards.json";
import FIRMWARE from "../data/firmware.json";
import { COMMUNITIES, UNPUBLISHED, USE_CASES, PRESET, PRESET_LABEL, ROLE, ROLE_LABEL } from "./communities.js";

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

async function resolveFirmware() {
  try {
    const fw = await (await get(`${API}/github/firmware/list`)).json();
    const v = fw.releases.stable[0].id.replace(/^v/, "");
    $("fwver").textContent = `${v} (current beta)`;
    return v;
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
function setMode(m) {
  mode = m;
  document.querySelectorAll("[data-mode]").forEach((b) => b.classList.toggle("on", b.dataset.mode === m));
  $("panel-community").hidden = m !== "community";
  $("panel-manual").hidden = m !== "manual";
}

function currentCommunity() {
  return COMMUNITIES.find((c) => c.id === $("community").value);
}

function communitySettings() {
  const c = currentCommunity();
  const u = c.uses[$("usecase").value];
  return {
    source: c.name,
    region: c.lora.region, usePreset: true, preset: c.lora.preset, slot: c.lora.slot,
    hopLimit: u.hops, role: u.role, txPower: 0,
    okToMqtt: $("c-okmqtt").checked, ignoreMqtt: undefined,
    nodeInfoSecs: u.nodeInfoSecs, positionSecs: u.positionSecs, smart: u.smart, telemetrySecs: u.telemetrySecs,
    channel: { kind: "public" },
  };
}

function renderCommunity() {
  const c = currentCommunity();
  const u = c.uses[$("usecase").value];
  $("c-okmqtt").checked = c.okToMqtt;
  const rows = [
    ["Region / preset", `${REGION_LABEL[c.lora.region]} · ${PRESET_LABEL[c.lora.preset]}`],
    ["Frequency slot", c.lora.slot ? String(c.lora.slot) : "auto (0)"],
    ["Primary channel", "Public default (blank name, key AQ==)"],
    ["Role", ROLE_LABEL[u.role]],
    ["Hop limit", String(u.hops)],
    ["NodeInfo every", u.nodeInfoSecs ? fmtSecs(u.nodeInfoSecs) : "firmware default"],
    ["Position every", u.positionSecs ? fmtSecs(u.positionSecs) : "firmware default"],
    ["Smart position", u.smart === undefined ? "firmware default" : u.smart ? "on" : "off"],
    ["Device telemetry every", u.telemetrySecs ? fmtSecs(u.telemetrySecs) : "firmware default"],
  ];
  $("c-summary").innerHTML = rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("");
  $("c-notes").innerHTML = c.notes.map((n) => `<li>${n}</li>`).join("");
  $("c-source").href = c.source;
  $("c-source").textContent = new URL(c.source).host + new URL(c.source).pathname;
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
  $("churl").value = ""; $("chname").value = ""; $("chpsk").value = "";
  $("m-basis").textContent = `Started from: ${currentCommunity().name} · ${USE_CASES[$("usecase").value]}`;
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
    conn: document.querySelector('input[name="conn"]:checked').value,
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
  if (mode === "community") {
    r = communitySettings();
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
  dev.events.onMyNodeInfo.subscribe((m) => (st.myNodeNum = m.myNodeNum));
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
  const lora = {
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

  await send(`device: role ${ROLE_LABEL[s.role]}${s.nodeInfoSecs ? `, nodeinfo ${fmtSecs(s.nodeInfoSecs)}` : ""}`, () =>
    setCfg("device", { ...have("device"), role: s.role, ...defined({ nodeInfoBroadcastSecs: s.nodeInfoSecs }) }));
  await send(`LoRa: ${REGION_LABEL[s.region]} · ${presetName} · slot ${lora.channelNum || "auto"} · ${lora.hopLimit} hops · OK-to-MQTT ${lora.configOkToMqtt ? "on" : "off"}`, () =>
    setCfg("lora", lora));
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
    ["Region", REGION_LABEL[L.region], L.region === s.region],
    ["Modem", L.usePreset ? PRESET_LABEL[L.modemPreset] ?? L.modemPreset : `custom BW${L.bandwidth}/SF${L.spreadFactor}/CR${L.codingRate}`, s.usePreset ? L.modemPreset === expPreset : !L.usePreset],
    ["Frequency slot", L.channelNum ? String(L.channelNum) : "auto", (L.channelNum ?? 0) === (s.slot ?? 0)],
    ["TX enabled", String(L.txEnabled), L.txEnabled === true],
    ["TX power", `${L.txPower} dBm${L.txPower === 0 ? " (region max)" : ""}`, L.txPower === s.txPower],
    ["Hop limit", String(L.hopLimit), L.hopLimit === s.hopLimit],
    ["OK to MQTT", String(!!L.configOkToMqtt), !!L.configOkToMqtt === !!s.okToMqtt],
    ["Role", ROLE_LABEL[D.role ?? 0] ?? D.role, (D.role ?? 0) === s.role],
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
  if (!("serial" in navigator)) { err("This browser has no Web Serial. Use desktop Chrome or Edge."); return; }
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
    err(e.message || String(e)); console.error(e);
    document.querySelectorAll('[data-state="active"]').forEach((el) => (el.dataset.state = "fail"));
    if (/port|open|lock/i.test(e.message)) warn("Close any other tab/app using the serial port (Meshtastic web client, serial monitor, Arduino IDE).");
  } finally { busy(false); }
}

// ---------- boot ----------
window.addEventListener("DOMContentLoaded", () => {
  fillBoards();
  for (const c of COMMUNITIES) opt("community", c.id, c.name, c.id === "baymesh");
  const og = document.createElement("optgroup");
  og.label = "No published settings — ask on their Discord/site";
  for (const u of UNPUBLISHED) { const o = document.createElement("option"); o.disabled = true; o.textContent = u.name; og.appendChild(o); }
  $("community").appendChild(og);
  $("unpublished").innerHTML = UNPUBLISHED.map((u) => `<a href="${u.url}" target="_blank" rel="noopener noreferrer">${u.name}</a>`).join(" · ");
  for (const [k, v] of Object.entries(USE_CASES)) opt("usecase", k, v, k === "everyday");

  for (const [k, v] of Object.entries(C.Config_LoRaConfig_RegionCode)) if (isNaN(Number(k))) opt("region", v, k, k === "US");
  for (const [k, v] of Object.entries(PRESET)) opt("preset", v, `${PRESET_LABEL[v]} (${k})`, k === "LONG_FAST");
  for (const [k, v] of Object.entries(ROLE)) opt("role", v, k, k === "CLIENT");

  document.querySelectorAll("[data-mode]").forEach((b) => (b.onclick = () => setMode(b.dataset.mode)));
  $("community").onchange = renderCommunity;
  $("usecase").onchange = renderCommunity;
  $("btn-customize").onclick = customize;
  $("usepreset").onchange = syncPresetFields;
  $("btn-genpin").onclick = () => ($("pin").value = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000)));
  document.querySelectorAll('input[name="conn"]').forEach((r) => (r.onchange = () => {
    const wifi = $("conn-wifi").checked;
    $("ble-fields").hidden = wifi; $("wifi-fields").hidden = !wifi;
  }));
  $("btn-full").onclick = () => run("full");
  $("btn-config").onclick = () => run("config");

  renderCommunity(); syncPresetFields(); setMode("community");
  if (!("serial" in navigator)) err("No Web Serial in this browser — use desktop Chrome or Edge.");
  if (!window.isSecureContext) err("Not a secure context — serve over https:// or http://localhost.");
});

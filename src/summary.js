// Read-only summary of a radio's settings, for the /check/ page. Pure: takes the state collected during the
// connection handshake and returns strings to display. Secrets (channel keys, WiFi password, Bluetooth PIN,
// admin keys) are only ever classified here ("private key", "Fixed PIN set"), never copied into the result.
import { Protobuf } from "@meshtastic/core";
import { PRESET_LABEL, ROLE_LABEL } from "./enums.js";

export const verNums = (v) => (String(v ?? "").match(/\d+/g) ?? []).slice(0, 3).map(Number);
export const olderThan = (a, b) => { const x = verNums(a), y = verNums(b); for (let i = 0; i < 3; i++) { if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0); } return false; };
export const shortVer = (v) => verNums(v).join(".");

// Meshtastic's well-known default channel key. A one-byte key of 1 is shorthand for it.
const DEFAULT_KEY = [0xd4, 0xf1, 0xbb, 0x3a, 0x20, 0x29, 0x07, 0x59, 0xf0, 0xbc, 0xff, 0xab, 0xcf, 0x4e, 0x69, 0x01];
const FAMILY = { esp32: "ESP32", nrf52: "nRF52" };
const PAIRING = { 0: "Random PIN shown on the radio's screen", 1: "Fixed PIN", 2: "No PIN" };
const KIND = { 1: "Primary", 2: "Secondary" };
const onOff = (v) => (v ? "On" : "Off");

function keyKind(psk) {
  const k = Array.from(psk ?? []);
  if (k.length === 0 || (k.length === 1 && k[0] === 0)) return "no encryption";
  if (k.length === 1 || (k.length === 16 && k.every((b, i) => b === DEFAULT_KEY[i]))) return "default key";
  return "private key";
}
const locationKind = (p) => (!p ? "not shared" : p >= 32 ? "exact" : "approximate");

export function summarize(st, { boardName, family, currentFw, fwChecked = true }) {
  const cfg = st.config ?? {}, mod = st.module ?? {};
  const lora = cfg.lora, bt = cfg.bluetooth, net = cfg.network, sec = cfg.security, mqtt = mod.mqtt;
  const me = st.users?.[st.myNodeNum];
  const fw = st.metadata?.firmwareVersion;
  const flags = [];
  const presetName = !lora ? "Unknown" : lora.usePreset === false ? "Custom" : (PRESET_LABEL[lora.modemPreset ?? 0] ?? `#${lora.modemPreset}`);

  const old = !!fw && !!currentFw && olderThan(fw, currentFw);
  if (old) flags.push({ level: "warn", text: `Firmware ${shortVer(fw)} is out of date (current is ${shortVer(currentFw)}). Update it before changing settings.`, href: "../radio/" });

  const regionSet = !!lora?.region;
  if (lora && !regionSet) flags.push({ level: "warn", text: "No region is set, so this radio is new or freshly erased and will not transmit. Set it up to get on the air.", href: "../radio/" });

  const channels = Object.values(st.channels ?? {}).filter((c) => KIND[c.role]).sort((a, b) => a.index - b.index).map((c) => {
    const s = c.settings ?? {};
    return {
      slot: String(c.index),
      name: s.name || (c.role === 1 ? presetName : "(no name)"),
      kind: KIND[c.role],
      key: keyKind(s.psk),
      location: locationKind(s.moduleSettings?.positionPrecision),
      uplink: s.uplinkEnabled ? "yes" : "no",
    };
  });
  const open = (c) => c.key !== "private key";
  const exposed = channels.filter((c) => open(c) && c.location === "exact");
  if (exposed.length) flags.push({ level: "warn", text: `This radio shares its exact location on ${exposed.map((c) => `"${c.name}"`).join(", ")}, which anyone nearby can read.` });
  const uplinked = channels.filter((c) => open(c) && c.uplink === "yes");
  if (mqtt?.enabled && uplinked.length) flags.push({ level: "warn", text: `MQTT is on and sends ${uplinked.map((c) => `"${c.name}"`).join(", ")} to the internet, where anyone can read it.` });

  const wifiRows = st.metadata?.hasWifi === false ? [["WiFi", "Not on this board"]]
    : !net ? [["WiFi", "Unknown"]]
    : net.wifiEnabled ? [["WiFi", "On"], ["Network", net.wifiSsid || "(none entered)"], ["Password", net.wifiPsk ? "Set" : "None"]]
    : [["WiFi", "Off"]];
  // ESP32 firmware switches Bluetooth off whenever WiFi is on, whatever the Bluetooth setting says.
  const btRows = st.metadata?.hasBluetooth === false ? [["Bluetooth", "Not on this board"]]
    : !bt ? [["Bluetooth", "Unknown"]]
    : bt.enabled && family === "esp32" && net?.wifiEnabled ? [["Bluetooth", "Off while WiFi is on"]]
    : bt.enabled ? [["Bluetooth", "On"], ["Pairing", PAIRING[bt.mode ?? 0] ?? "Unknown"], ...(bt.mode === 1 ? [["PIN", "Fixed PIN set"]] : [])]
    : [["Bluetooth", "Off"]];

  const sections = [
    { title: "Hardware", rows: [
      ["Board", boardName || "Unknown"],
      ["Chip", FAMILY[family] ?? "Unknown"],
      ["Name", me?.longName ? `${me.longName}${me.shortName ? ` (${me.shortName})` : ""}` : "Unknown"],
    ] },
    { title: "Firmware", rows: [
      ["Installed", fw ? shortVer(fw) : "Unknown"],
      ["Status", !fw ? "Unknown" : old ? `Out of date; current is ${shortVer(currentFw)}`
        : fwChecked ? "Up to date" : `Not older than ${shortVer(currentFw)}, the version this site was tested with (couldn't check Meshtastic for a newer one)`],
    ] },
    { title: "Radio", rows: [
      ["Region", !lora ? "Unknown" : regionSet ? (Protobuf.Config.Config_LoRaConfig_RegionCode[lora.region] ?? `#${lora.region}`) : "Not set"],
      ["Preset", presetName],
      ["Frequency slot", !lora ? "Unknown" : lora.channelNum ? String(lora.channelNum) : "Automatic"],
      ["Role", cfg.device ? (ROLE_LABEL[cfg.device.role ?? 0] ?? `#${cfg.device.role}`) : "Unknown"],
      ["Hops", lora ? String(lora.hopLimit ?? 0) : "Unknown"],
    ] },
    { title: "Bluetooth", rows: btRows },
    { title: "WiFi", rows: wifiRows },
    { title: "Also", rows: [
      ["MQTT", mqtt ? onOff(mqtt.enabled) : "Unknown"],
      ["GPS", !cfg.position ? "Unknown" : cfg.position.fixedPosition ? "Fixed position" : cfg.position.gpsMode === 1 ? "On" : "Off"],
      ["Managed mode", sec ? onOff(sec.isManaged) : "Unknown"],
      ["Remote admin key", sec ? ((sec.adminKey ?? []).length ? "Set" : "None") : "Unknown"],
    ] },
  ];
  return { sections, channels, flags };
}

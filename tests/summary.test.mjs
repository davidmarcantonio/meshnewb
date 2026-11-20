// Unit tests for the read-only radio summary. Run: node --test tests/summary.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { summarize } from "../src/summary.js";

const DEFAULT16 = Uint8Array.from(Buffer.from("1PG7OiApB1nwvP+rz05pAQ==", "base64"));
const PRIVATE32 = new Uint8Array(32).fill(7);
const chan = (index, role, name, psk, extra = {}) => ({ index, role, settings: { name, psk, ...extra } });
const base = () => ({
  myNodeNum: 100, pioEnv: "heltec-v3",
  metadata: { firmwareVersion: "2.7.26.54e0d8d", hasWifi: true, hasBluetooth: true },
  users: { 100: { longName: "MapleCut 45", shortName: "MC45" } },
  config: {
    lora: { usePreset: true, region: 1, modemPreset: 0, hopLimit: 3, channelNum: 0 },
    device: { role: 0 },
    bluetooth: { enabled: true, mode: 1, fixedPin: 123456 },
    network: { wifiEnabled: true, wifiSsid: "HomeNet", wifiPsk: "hunter2secret" },
    security: { isManaged: false, adminKey: [] },
    position: { gpsMode: 1, fixedPosition: false },
  },
  module: { mqtt: { enabled: false } },
  channels: { 0: chan(0, 1, "", new Uint8Array([1])) },
});
const OPTS = { boardName: "Heltec V3", family: "esp32", currentFw: "2.7.26.54e0d8d" };
const sum = (mut) => { const st = base(); mut?.(st); return summarize(st, OPTS); };
const row = (r, title, label) => r.sections.find((s) => s.title === title)?.rows.find(([l]) => l === label)?.[1];
const flag = (r, re) => r.flags.find((f) => re.test(f.text));

test("sections come in a fixed order", () => {
  assert.deepEqual(sum().sections.map((s) => s.title), ["Hardware", "Firmware", "Radio", "Bluetooth", "WiFi", "Also"]);
});
test("hardware shows board and the radio's own names", () => {
  const r = sum();
  assert.equal(row(r, "Hardware", "Board"), "Heltec V3");
  assert.equal(row(r, "Hardware", "Name"), "MapleCut 45 (MC45)");
});
test("current firmware reads as up to date with no flag", () => {
  const r = sum();
  assert.equal(row(r, "Firmware", "Installed"), "2.7.26");
  assert.equal(row(r, "Firmware", "Status"), "Up to date");
  assert.equal(flag(r, /firmware/i), undefined);
});
test("old firmware raises a warning that links to the setup page", () => {
  const r = sum((st) => (st.metadata.firmwareVersion = "2.7.10.abc"));
  const f = flag(r, /Update/);
  assert.equal(f.level, "warn");
  assert.equal(f.href, "../radio/");
  assert.match(row(r, "Firmware", "Status"), /Out of date/);
});
test("radio section names region, preset, role and hops", () => {
  const r = sum();
  assert.equal(row(r, "Radio", "Region"), "US");
  assert.equal(row(r, "Radio", "Preset"), "LongFast");
  assert.equal(row(r, "Radio", "Role"), "CLIENT");
  assert.equal(row(r, "Radio", "Hops"), "3");
});
test("no secret reaches the output", () => {
  const r = sum((st) => { st.channels[1] = chan(1, 2, "SmithFam", PRIVATE32); st.config.security.adminKey = [new Uint8Array(32).fill(9)]; });
  const out = JSON.stringify(r);
  for (const secret of ["123456", "hunter2secret", Buffer.from(PRIVATE32).toString("base64"), Buffer.from(new Uint8Array(32).fill(9)).toString("base64"), "7,7,7", "9,9,9"]) assert.ok(!out.includes(secret), secret);
  assert.equal(row(r, "Bluetooth", "PIN"), "Fixed PIN set");
  assert.equal(row(r, "WiFi", "Network"), "HomeNet");
});
test("channel keys are classified, never shown", () => {
  const kinds = [[new Uint8Array([]), "no encryption"], [new Uint8Array([0]), "no encryption"], [new Uint8Array([1]), "default key"], [DEFAULT16, "default key"], [new Uint8Array(16).fill(3), "private key"], [PRIVATE32, "private key"]];
  for (const [psk, want] of kinds) assert.equal(sum((st) => (st.channels[0] = chan(0, 1, "X", psk))).channels[0].key, want);
});
test("an unnamed primary channel takes the preset's name", () => {
  assert.equal(sum().channels[0].name, "LongFast");
  assert.equal(sum((st) => (st.config.lora.modemPreset = 4)).channels[0].name, "MediumFast");
});
test("channels list slot and kind, and skip disabled slots", () => {
  const r = sum((st) => { st.channels[1] = chan(1, 2, "SmithFam", PRIVATE32); st.channels[2] = chan(2, 0, "", new Uint8Array([])); });
  assert.deepEqual(r.channels.map((c) => [c.slot, c.name, c.kind]), [["0", "LongFast", "Primary"], ["1", "SmithFam", "Secondary"]]);
});
test("an unset region is flagged", () => {
  const r = sum((st) => (st.config.lora.region = 0));
  assert.equal(flag(r, /No region/).level, "warn");
  assert.equal(row(r, "Radio", "Region"), "Not set");
});
test("MQTT uplink is flagged on a default-key channel only", () => {
  const on = (psk) => sum((st) => { st.module.mqtt.enabled = true; st.channels[0] = chan(0, 1, "", psk, { uplinkEnabled: true }); });
  assert.equal(flag(on(new Uint8Array([1])), /MQTT/).level, "warn");
  assert.equal(flag(on(PRIVATE32), /MQTT/), undefined);
  assert.equal(on(PRIVATE32).channels[0].uplink, "yes");
  assert.equal(row(on(PRIVATE32), "Also", "MQTT"), "On");
});
test("exact location on a default-key channel is flagged; approximate is not", () => {
  const p = (n, psk = new Uint8Array([1])) => sum((st) => (st.channels[0] = chan(0, 1, "", psk, { moduleSettings: { positionPrecision: n } })));
  assert.equal(p(32).channels[0].location, "exact");
  assert.equal(flag(p(32), /exact location/).level, "warn");
  assert.equal(p(13).channels[0].location, "approximate");
  assert.equal(flag(p(13), /exact location/), undefined);
  assert.equal(p(0).channels[0].location, "not shared");
  assert.equal(flag(p(32, PRIVATE32), /exact location/), undefined);
});
test("managed mode and admin keys are reported without their values", () => {
  const r = sum((st) => { st.config.security.isManaged = true; st.config.security.adminKey = [new Uint8Array(32).fill(9)]; });
  assert.equal(row(r, "Also", "Managed mode"), "On");
  assert.equal(row(r, "Also", "Remote admin key"), "Set");
});
test("bluetooth and wifi off read as off", () => {
  const r = sum((st) => { st.config.bluetooth.enabled = false; st.config.network.wifiEnabled = false; });
  assert.equal(row(r, "Bluetooth", "Bluetooth"), "Off");
  assert.equal(row(r, "WiFi", "WiFi"), "Off");
});
test("a board without wifi says so", () => {
  assert.equal(row(sum((st) => (st.metadata.hasWifi = false)), "WiFi", "WiFi"), "Not on this board");
});
test("a nearly empty state does not throw", () => {
  const r = summarize({ config: {}, module: {}, channels: {}, users: {} }, { boardName: null, family: "unknown", currentFw: "2.7.26.54e0d8d" });
  assert.equal(row(r, "Hardware", "Board"), "Unknown");
  assert.equal(row(r, "Firmware", "Installed"), "Unknown");
  assert.deepEqual(r.channels, []);
});

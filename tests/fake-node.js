import { Protobuf } from "@meshtastic/core";
import { create, toBinary, fromBinary } from "@bufbuild/protobuf";
const M = Protobuf.Mesh, A = Protobuf.Admin, C = Protobuf.Config, P = Protobuf.Portnums.PortNum;
const NUM = 0x1a2b3c4d;
const O = window.__fakeOpts ?? {};
const node = {
  user: create(M.UserSchema, { id: "!1a2b3c4d", longName: "Meshtastic 3c4d", shortName: "3c4d", publicKey: new Uint8Array(32).fill(7), ...(O.user ?? {}) }),
  config: {
    device: create(C.Config_DeviceConfigSchema, { role: 0, nodeInfoBroadcastSecs: 10800 }),
    lora: create(C.Config_LoRaConfigSchema, { usePreset: true, region: 0, modemPreset: 0, hopLimit: 3, txEnabled: true, txPower: 0, ...(window.__fakeOpts?.lora ?? {}) }),
    bluetooth: create(C.Config_BluetoothConfigSchema, { enabled: true, mode: 0, fixedPin: 123456, ...(O.bluetooth ?? {}) }),
    network: create(C.Config_NetworkConfigSchema, { wifiEnabled: false, ntpServer: "meshtastic.pool.ntp.org", ...(O.network ?? {}) }),
    position: create(C.Config_PositionConfigSchema, { positionBroadcastSecs: 900, positionBroadcastSmartEnabled: true, gpsUpdateInterval: 120 }),
  },
  module: { ...(O.mqtt ? { mqtt: create(Protobuf.ModuleConfig.ModuleConfig_MQTTConfigSchema, O.mqtt) } : {}), telemetry: create(Protobuf.ModuleConfig.ModuleConfig_TelemetryConfigSchema, { deviceUpdateInterval: 1800, environmentUpdateInterval: 1800 }) },
  // Extra channels for tests: [{ index, role, name, psk: [bytes], uplinkEnabled, positionPrecision }]
  channels: Object.fromEntries([{ index: 0, role: 1, psk: [1] }, ...(O.channels ?? [])].map((c) => [c.index, create(Protobuf.Channel.ChannelSchema, { index: c.index, role: c.role, settings: { name: c.name ?? "", psk: new Uint8Array(c.psk ?? []), uplinkEnabled: !!c.uplinkEnabled, ...(c.positionPrecision != null ? { moduleSettings: { positionPrecision: c.positionPrecision } } : {}) } })])),
  commits: 0, adminLog: [], rebootCount: 7,
};
window.__fakeNode = node;
const frame = (fr) => { const b = toBinary(M.FromRadioSchema, create(M.FromRadioSchema, fr)); return new Uint8Array([0x94, 0xc3, b.length >> 8, b.length & 255, ...b]); };
class FakePort {
  constructor() { this.readable = null; this.writable = null; this.ondisconnect = null; this.connected = true; this._gone = []; }
  addEventListener(type, fn) { if (type === "disconnect") this._gone.push(fn); }
  removeEventListener() {}
  // Firmware restarts a few seconds after a commit (about 7 on real radios; slowReboot mimics that).
  // Native-USB boards (nRF52, bridge-less ESP32-S3) fall off USB while they restart and answer nothing meanwhile.
  simulateNativeUsbReboot() {
    const at = window.__fakeOpts?.slowReboot ? 9000 : 2500;
    setTimeout(() => { this.connected = false; node.rebooting = true; node.rebootCount++; this.ondisconnect?.(); this._gone.splice(0).forEach((f) => f()); }, at);
    setTimeout(() => { this.connected = true; node.rebooting = false; }, at + 7000);
  }
  // Boards with a USB bridge chip stay on USB; the radio just goes quiet for a moment and its restart counter goes up.
  simulateBridgeReboot() {
    const at = window.__fakeOpts?.slowReboot ? 9000 : 1500;
    setTimeout(() => { node.rebooting = true; node.rebootCount++; }, at);
    setTimeout(() => { node.rebooting = false; }, at + 2500);
  }
  getInfo() { return window.__fakeOpts?.usb ?? { usbVendorId: 0x10c4, usbProductId: 0xea60 }; }
  // Like a real SerialPort: open() refuses while open, close() refuses while a stream is still locked.
  async open() {
    if (this.readable || this.writable) throw new DOMException("The port is already open.", "InvalidStateError");
    let ctl; this.readable = new ReadableStream({ start: (c) => (ctl = c) });
    const push = (fr) => ctl.enqueue(frame(fr));
    let buf = [];
    this.writable = new WritableStream({ write: (chunk) => {
      buf.push(...chunk);
      while (true) {
        const i = buf.findIndex((x, k) => x === 0x94 && buf[k + 1] === 0xc3);
        if (i < 0 || buf.length < i + 4) return;
        const len = (buf[i + 2] << 8) | buf[i + 3];
        if (buf.length < i + 4 + len) return;
        const msg = fromBinary(M.ToRadioSchema, new Uint8Array(buf.slice(i + 4, i + 4 + len)));
        buf = buf.slice(i + 4 + len);
        if (!node.rebooting && !window.__fakeOpts?.mute) handle(msg, push);
      }
    }});
  }
  async close() {
    if (!this.readable) throw new DOMException("The port is already closed.", "InvalidStateError");
    if (this.readable.locked || this.writable.locked) throw new TypeError("Cannot cancel a locked stream");
    await this.readable.cancel(); this.readable = null; this.writable = null;
  }
}
function handle(msg, push) {
  const v = msg.payloadVariant;
  if (v.case === "wantConfigId") {
    node.lastNonce = v.value;
    // A radio that has heard many others sends them all unless asked for config only (69420).
    const others = window.__fakeOpts?.bigNodeDb && v.value !== 69420 ? 300 : 0;
    setTimeout(() => {
      push({ payloadVariant: { case: "myInfo", value: { myNodeNum: NUM, rebootCount: node.rebootCount, pioEnv: window.__fakeOpts?.pioEnv ?? "heltec-v3" } } });
      push({ payloadVariant: { case: "metadata", value: { firmwareVersion: window.__fakeOpts?.fw ?? "2.7.26.54e0d8d", hasWifi: window.__fakeOpts?.hasWifi ?? true, hasBluetooth: true } } });
      push({ payloadVariant: { case: "nodeInfo", value: { num: NUM, user: node.user } } });
      for (const [k, val] of Object.entries(node.config)) push({ payloadVariant: { case: "config", value: { payloadVariant: { case: k, value: val } } } });
      for (const [k, val] of Object.entries(node.module)) push({ payloadVariant: { case: "moduleConfig", value: { payloadVariant: { case: k, value: val } } } });
      for (const ch of Object.values(node.channels)) push({ payloadVariant: { case: "channel", value: ch } });
      for (let i = 0; i < others; i++) push({ payloadVariant: { case: "nodeInfo", value: { num: 1000 + i, user: { longName: "Other " + i, shortName: "O" + (i % 100) } } } });
      setTimeout(() => push({ payloadVariant: { case: "configCompleteId", value: v.value } }), others ? 45000 : 0);
    }, 50);
  } else if (v.case === "packet") {
    const pkt = v.value, d = pkt.payloadVariant.value;
    if (d.portnum === P.ADMIN_APP) {
      const a = fromBinary(A.AdminMessageSchema, d.payload);
      const c = a.payloadVariant.case; node.adminLog.push(c);
      if (c === "setConfig") node.config[a.payloadVariant.value.payloadVariant.case] = a.payloadVariant.value.payloadVariant.value;
      if (c === "setModuleConfig") node.module[a.payloadVariant.value.payloadVariant.case] = a.payloadVariant.value.payloadVariant.value;
      if (c === "setChannel") node.channels[a.payloadVariant.value.index] = a.payloadVariant.value;
      if (c === "setOwner") node.user = a.payloadVariant.value;
      if (c === "factoryResetDevice" || c === "factoryResetConfig") {
        // Wipe to blank unless told the erase is ignored; then restart, or freeze like a real T-Echo was seen to.
        if (!window.__fakeOpts?.resetIgnored) { node.config.lora = create(C.Config_LoRaConfigSchema, { usePreset: true, region: 0, modemPreset: 0, hopLimit: 3, txEnabled: true }); node.user = { ...node.user, longName: "Meshtastic 3c4d", shortName: "3c4d" }; }
        if (window.__fakeOpts?.resetHangs) node.rebooting = true;
        else if (window.__fakeOpts?.nativeUsb) port.simulateNativeUsbReboot(); else port.simulateBridgeReboot();
      }
      // nRF52 leaves for its bootloader: off USB as this device, and it does not come back as a Meshtastic port.
      if (c === "enterDfuModeRequest" && !window.__fakeOpts?.dfuIgnored) setTimeout(() => { port.connected = false; node.rebooting = true; port.ondisconnect?.(); port._gone.splice(0).forEach((f) => f()); }, 300);
      if (c === "commitEditSettings") { node.commits++; if (window.__fakeOpts?.nativeUsb) port.simulateNativeUsbReboot(); else port.simulateBridgeReboot(); }
    }
    const routing = toBinary(M.RoutingSchema, create(M.RoutingSchema, { variant: { case: "errorReason", value: 0 } }));
    setTimeout(() => push({ payloadVariant: { case: "packet", value: { from: NUM, to: NUM, id: Math.floor(Math.random() * 1e9), payloadVariant: { case: "decoded", value: { portnum: P.ROUTING_APP, payload: routing, requestId: pkt.id } } } } }), 20);
  }
}
const port = new FakePort();
Object.defineProperty(navigator, "serial", { value: { requestPort: async () => { if (O.noPick) throw new DOMException("No port selected by the user.", "NotFoundError"); return port; }, getPorts: async () => [port], addEventListener() {} } });

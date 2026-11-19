import { Protobuf } from "@meshtastic/core";
import { create, toBinary } from "@bufbuild/protobuf";
const cs = create(Protobuf.AppOnly.ChannelSetSchema, { settings: [{ name: "TestMesh", psk: new Uint8Array(16).fill(9) }, { name: "Side", psk: new Uint8Array([1]) }], loraConfig: { usePreset: true, region: 1, modemPreset: 4, hopLimit: 3, txEnabled: true, channelNum: 45 } });
const b = Buffer.from(toBinary(Protobuf.AppOnly.ChannelSetSchema, cs)).toString("base64").replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
console.log("https://meshtastic.org/e/#" + b);

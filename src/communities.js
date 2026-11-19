// California Meshtastic community presets.
// Every value below is taken from the community's own published page (see `source`), checked 2026-11-18.
// Where a community publishes nothing for a field, it is left undefined and the firmware default stands.
// Enum numbers follow meshtastic/protobufs master (config.proto); the bundled JS enum predates LONG_TURBO / CLIENT_BASE.

export const PRESET = { LONG_FAST: 0, MEDIUM_SLOW: 3, MEDIUM_FAST: 4, SHORT_SLOW: 5, SHORT_FAST: 6, LONG_MODERATE: 7, SHORT_TURBO: 8, LONG_TURBO: 9 };
export const PRESET_LABEL = {
  0: "LongFast", 3: "MediumSlow", 4: "MediumFast", 5: "ShortSlow", 6: "ShortFast", 7: "LongModerate", 8: "ShortTurbo", 9: "LongTurbo",
};
export const ROLE = { CLIENT: 0, CLIENT_MUTE: 1, ROUTER: 2, TRACKER: 5, SENSOR: 6, CLIENT_HIDDEN: 8, ROUTER_LATE: 11, CLIENT_BASE: 12 };
export const ROLE_LABEL = Object.fromEntries(Object.entries(ROLE).map(([k, v]) => [v, k]));

// Use cases shown to the user. Each community maps them to role/hops/intervals.
export const USE_CASES = {
  everyday: "Everyday radio I carry (handheld / car)",
  home: "Home node (attic, window, rooftop) — also serves my handhelds",
  extra: "Extra radio near another of my nodes",
};

const CHECKED = "2026-11-18";

export const COMMUNITIES = [
  {
    id: "baymesh",
    name: "BayMe.sh — SF Bay Area",
    area: "San Francisco, East Bay, Peninsula, South Bay, North Bay",
    source: "https://bayme.sh/docs/getting-started/recommended-settings/",
    checked: CHECKED,
    lora: { region: 1, preset: PRESET.MEDIUM_FAST, slot: 45 },
    channel: "public", // blank name + AQ== default key
    okToMqtt: false, // "Enable only if you want your public messages online"
    notes: [
      "Licensed Operator mode must stay OFF, even with a callsign.",
      "Firmware default hop limit (3) is explicitly not recommended here.",
      "Coordinate with BayMesh before any ROUTER / infrastructure install.",
    ],
    uses: {
      everyday: { role: ROLE.CLIENT, hops: 6, positionSecs: undefined, smart: true, telemetrySecs: 21600 },
      home: { role: ROLE.CLIENT_BASE, hops: 4, positionSecs: 21600, smart: false, telemetrySecs: 21600 },
      extra: { role: ROLE.CLIENT_MUTE, hops: 6, positionSecs: 21600, smart: false, telemetrySecs: 21600 },
    },
  },
  {
    id: "socal-lt",
    name: "SoCal Mesh — LongTurbo (current homepage default)",
    area: "Laguna / Orange County / greater SoCal",
    source: "https://socalmesh.org/",
    checked: CHECKED,
    lora: { region: 1, preset: PRESET.LONG_TURBO, slot: 14 },
    channel: "public",
    okToMqtt: true, // "Turn on OK to MQTT so your node can appear on the maps"
    notes: [
      "Homepage lists LongTurbo slot 14 (908.750 MHz); their best-practices page still lists LongFast slot 20. If you hear nobody, try the LongFast variant.",
      "LongTurbo needs firmware 2.7.17+. This tool flashes 2.7.26 beta.",
    ],
    uses: socalUses(),
  },
  {
    id: "socal-lf",
    name: "SoCal Mesh — LongFast (best-practices page)",
    area: "Laguna / Orange County / greater SoCal",
    source: "https://socalmesh.org/help/best-practices/",
    checked: CHECKED,
    lora: { region: 1, preset: PRESET.LONG_FAST, slot: 20 },
    channel: "public",
    okToMqtt: true,
    notes: ["Their guidance: enter the slot explicitly rather than leaving 0. Don't use REPEATER."],
    uses: socalUses(),
  },
  {
    id: "cvm",
    name: "Central Valley Mesh — Bakersfield to Stockton",
    area: "Fresno, Bakersfield, Modesto, Stockton, Merced",
    source: "https://centralvalleymesh.net/docs/getting-started/",
    checked: CHECKED,
    lora: { region: 1, preset: PRESET.LONG_FAST, slot: 20 },
    channel: "public",
    okToMqtt: true, // "Enable. Lets gateways upload to the CVM MeshInfo server"
    notes: [
      "Most CVM nodes run LongFast; some areas use MediumFast — check their Discord for your town.",
      "The CVM community channel's key is shared on Discord, not published; add it later with a channel URL.",
    ],
    uses: {
      everyday: { role: ROLE.CLIENT, hops: 3 },
      home: { role: ROLE.CLIENT, hops: 3 },
      extra: { role: ROLE.CLIENT_MUTE, hops: 3 },
    },
  },
  {
    id: "visalia",
    name: "Visalia Mesh — Visalia / Tulare County",
    area: "Visalia and surrounding towns",
    source: "https://visaliamesh.com/wiki",
    checked: CHECKED,
    lora: { region: 1, preset: PRESET.LONG_FAST, slot: 20 },
    channel: "public",
    okToMqtt: true,
    notes: [
      "Their wiki publishes a 'Visalia' secondary channel; paste its channel URL in Manual mode to add it.",
      "Visalia recommends CLIENT_MUTE for pocket/mobile radios.",
    ],
    uses: {
      everyday: { role: ROLE.CLIENT_MUTE, hops: 3, nodeInfoSecs: 43200, positionSecs: 3600, smart: true, telemetrySecs: 3600 },
      home: { role: ROLE.CLIENT_BASE, hops: 3, nodeInfoSecs: 43200, positionSecs: 43200, smart: false, telemetrySecs: 3600 },
      extra: { role: ROLE.CLIENT_MUTE, hops: 3, nodeInfoSecs: 43200, positionSecs: 43200, smart: false, telemetrySecs: 3600 },
    },
  },
  {
    id: "hdmesh",
    name: "High Desert Mesh — Victorville / Hesperia / Apple Valley",
    area: "Victor Valley, High Desert",
    source: "https://hdmesh.org/meshtastic-node-configuration/",
    checked: CHECKED,
    lora: { region: 1, preset: PRESET.LONG_MODERATE, slot: 0 }, // slot not published; default channel name -> auto slot
    channel: "public",
    okToMqtt: true, // "All node types should allow MQTT"
    notes: ["Frequency slot isn't published; left on auto (keep the primary channel name blank)."],
    uses: {
      everyday: { role: ROLE.CLIENT, hops: 7, nodeInfoSecs: 10800, positionSecs: 3600, smart: true },
      home: { role: ROLE.CLIENT, hops: 7, nodeInfoSecs: 10800, positionSecs: 21600, smart: false },
      extra: { role: ROLE.CLIENT_MUTE, hops: 7, nodeInfoSecs: 10800, positionSecs: 21600, smart: false },
    },
  },
];

function socalUses() {
  return {
    everyday: { role: ROLE.CLIENT, hops: 3, nodeInfoSecs: 86400, positionSecs: 900, smart: true, telemetrySecs: 1800 },
    home: { role: ROLE.CLIENT_BASE, hops: 3, nodeInfoSecs: 86400, positionSecs: 86400, smart: true, telemetrySecs: 7200 },
    extra: { role: ROLE.CLIENT_MUTE, hops: 3, nodeInfoSecs: 86400, positionSecs: 86400, smart: true, telemetrySecs: 7200 },
  };
}

// Communities that exist but publish no settings we can verify. Shown, not selectable.
export const UNPUBLISHED = [
  { name: "Sac Valley Mesh", url: "https://discord.gg/kk26pjpDhG" },
  { name: "San Diego Mesh", url: "https://discord.gg/k8RputgWgD" },
  { name: "San Jose Meshtastic Club", url: "https://discord.gg/h7824FUxBx" },
  { name: "Monterey Bay Mesh", url: "https://discord.gg/xeqYpc5D89" },
  { name: "Antelope Valley Mesh", url: "https://www.avmesh.org/" },
  { name: "Mission Viejo Mesh", url: "https://missionviejomesh.org/" },
  { name: "AltaMesh (Altadena)", url: "https://altamesh.net/" },
  { name: "Santa Cruz County", url: "https://groups.io/g/Meshtastic-Santa-Cruz" },
];

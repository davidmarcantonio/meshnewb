// Enum numbers follow meshtastic/protobufs master (config.proto); the bundled JS enum predates LONG_TURBO / CLIENT_BASE.
// Community presets are NOT in this bundle. They are data files under presets/, copied in at build time from
// https://github.com/davidmarcantonio/meshtastic-us-presets, so app.js stays byte-identical when presets change.

export const PRESET = {
  LONG_FAST: 0, LONG_SLOW: 1, MEDIUM_SLOW: 3, MEDIUM_FAST: 4, SHORT_SLOW: 5, SHORT_FAST: 6, LONG_MODERATE: 7,
  SHORT_TURBO: 8, LONG_TURBO: 9, MEDIUM_TURBO: 16,
};
export const PRESET_LABEL = {
  0: "LongFast", 1: "LongSlow", 2: "VeryLongSlow", 3: "MediumSlow", 4: "MediumFast", 5: "ShortSlow", 6: "ShortFast",
  7: "LongModerate", 8: "ShortTurbo", 9: "LongTurbo", 16: "MediumTurbo",
};
export const ROLE = { CLIENT: 0, CLIENT_MUTE: 1, ROUTER: 2, TRACKER: 5, SENSOR: 6, CLIENT_HIDDEN: 8, ROUTER_LATE: 11, CLIENT_BASE: 12 };
export const ROLE_LABEL = { ...Object.fromEntries(Object.entries(ROLE).map(([k, v]) => [v, k])), 3: "ROUTER_CLIENT", 4: "REPEATER", 7: "TAK", 9: "LOST_AND_FOUND", 10: "TAK_TRACKER" };

// Use cases shown to the user. A community file maps them to role/hops/intervals (uses.default, overridden per use).
export const USE_CASES = {
  everyday: "Everyday radio I carry (handheld / car)",
  home: "Home node (attic, window, rooftop) — also serves my handhelds",
  extra: "Extra radio near another of my nodes",
};

// Firmware defaults, used when a community publishes nothing for that field.
export const FW_DEFAULT = { role: 0, hopLimit: 3 };

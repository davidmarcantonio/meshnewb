// Words for "Suggest a name": common, easy to say, two syllables or fewer where possible, nothing personal.
// A radio's name is broadcast to everyone on the mesh, so a random word beats a real name.
export const WORDS = `Acorn Alder Amber Anchor Apple Arrow Aspen Atlas Badger Bamboo Banjo Barley Basil Beacon Beaver Birch Bison Blossom
Boulder Breeze Bridge Brook Cactus Camel Candle Canyon Carrot Cedar Cherry Cinder Clover Cobalt Comet Copper Coral Cotton Cricket
Crystal Daisy Delta Denim Dolphin Domino Drift Eagle Ember Falcon Feather Fern Finch Flint Forest Fossil Garnet Ginger Glacier
Granite Harbor Hazel Heron Hickory Honey Indigo Iris Ivory Jasper Juniper Kettle Kiwi Lantern Laurel Lemon Lilac Linen Lotus
Lunar Magnet Mango Maple Marble Meadow Melon Mesa Mint Mirror Mocha Mosaic Nectar Nimbus Nutmeg Oasis Ocean Olive Onyx Orbit
Orchid Otter Paddle Panda Pebble Pepper Pilot Pine Planet Plum Pocket Poppy Prairie Puffin Quartz Quill Rabbit Radish Raven
Reef Ribbon River Robin Rocket Saffron Sage Salmon Sandal Sequoia Shadow Sierra Silver Sparrow Spruce Summit Sunset Tango
Thistle Thunder Timber Topaz Tulip Tundra Turtle Velvet Violet Walnut Willow Winter Zephyr Zinnia`.split(/\s+/);

/** { word, long: "Maple 42", short: "MA42" }. Pass a word to keep it and only draw a new number. */
export function suggestName(word) {
  const r = crypto.getRandomValues(new Uint32Array(2));
  const w = word ?? WORDS[r[0] % WORDS.length];
  const n = 10 + (r[1] % 90);
  return { word: w, long: `${w} ${n}`, short: `${w.slice(0, 2).toUpperCase()}${n}` };
}

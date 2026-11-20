// Nouns for "Suggest a name": common, easy to say, two syllables or fewer where possible, nothing personal.
// A radio's name is broadcast to everyone on the mesh, so random words beat a real name.
export const WORDS = `Acorn Alder Amber Anchor Apple Arrow Aspen Atlas Badger Bamboo Banjo Barley Basil Beacon Beaver Birch Bison Blossom
Boulder Breeze Bridge Brook Cactus Camel Candle Canyon Carrot Cedar Cherry Cinder Clover Cobalt Comet Copper Coral Cotton Cricket
Crystal Daisy Delta Denim Dolphin Domino Drift Eagle Ember Falcon Feather Fern Finch Flint Forest Fossil Garnet Ginger Glacier
Granite Harbor Hazel Heron Hickory Honey Indigo Iris Ivory Jasper Juniper Kettle Kiwi Lantern Laurel Lemon Lilac Linen Lotus
Lunar Magnet Mango Maple Marble Meadow Melon Mesa Mint Mirror Mocha Mosaic Nectar Nimbus Nutmeg Oasis Ocean Olive Onyx Orbit
Orchid Otter Paddle Panda Pebble Pepper Pilot Pine Planet Plum Pocket Poppy Prairie Puffin Quartz Quill Rabbit Radish Raven
Reef Ribbon River Robin Rocket Saffron Sage Salmon Sandal Sequoia Shadow Sierra Silver Sparrow Spruce Summit Sunset Tango
Thistle Thunder Timber Topaz Tulip Tundra Turtle Velvet Violet Walnut Willow Winter Zephyr Zinnia`.split(/\s+/);

// Second half of the name: plain everyday verbs, one syllable where possible, nothing that reads badly after a noun.
export const VERBS = `Bake Bend Blink Build Call Camp Carry Catch Chase Climb Cook Count Cut Dance Dash Dig Dive Draw Dream Drive
Drum Fetch Find Fish Float Fly Fold Glide Glow Grow Guide Hike Hop Hum Jog Jump Keep Knit Laugh Launch Lead Leap Lift Look
March Mend Mix Nap Paint Pass Pedal Plant Play Race Reach Read Ride Ring Roam Roll Row Run Sail Sing Skate Skip Slide Smile
Snap Soar Spin Sprint Stand Stir Stroll Surf Swim Swing Talk Toss Trek Turn Wade Walk Wander Wave Whistle Wink Work Write`.split(/\s+/);

const AVOID = new Set(["SS", "KK"]);

/** { word: "MapleCut", long: "MapleCut 45", short: "MC45" }. Pass a word pair to keep it and only draw a new number. */
export function suggestName(word) {
  const r = crypto.getRandomValues(new Uint32Array(3));
  const a = WORDS[r[0] % WORDS.length], b = VERBS[r[1] % VERBS.length];
  if (!word && AVOID.has(a[0] + b[0])) return suggestName(); // draw again rather than hand out unfortunate initials
  const w = word ?? a + b;
  const n = 10 + (r[2] % 90);
  return { word: w, long: `${w} ${n}`, short: `${w.match(/[A-Z]/g).slice(0, 2).join("")}${n}` };
}

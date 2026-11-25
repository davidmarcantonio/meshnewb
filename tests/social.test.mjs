// Link previews and icons: every address of the page carries the same preview tags, and the files they name exist.
// Runs against dist/ (after build.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SITE = "https://mesh.marcantonio.me";
const PAGES = ["index.html", "radio/index.html", "join/index.html", "family/index.html", "check/index.html", "use/index.html"];
const meta = (html, attr, key) => html.match(new RegExp(`<meta ${attr}="${key}" content="([^"]*)">`))?.[1];

for (const page of PAGES) test(`preview tags: ${page}`, () => {
  const html = readFileSync(`dist/${page}`, "utf8");
  assert.equal(meta(html, "property", "og:image"), `${SITE}/og.png`);
  assert.equal(meta(html, "name", "twitter:image"), `${SITE}/og.png`);
  assert.equal(meta(html, "property", "og:url"), `${SITE}/`);
  assert.equal(meta(html, "name", "twitter:card"), "summary_large_image");
  assert.equal(meta(html, "property", "og:image:width"), "1200");
  assert.equal(meta(html, "property", "og:image:height"), "630");
  for (const k of ["og:title", "og:description", "og:image:alt"]) assert.ok(meta(html, "property", k), k);
  assert.ok(meta(html, "property", "og:title").length <= 60, "og:title fits one line in a preview card");
  assert.ok(meta(html, "property", "og:description").length <= 200, "og:description is not cut mid-thought");
  assert.ok(html.includes(`<link rel="canonical" href="${SITE}/">`));
  // Icons are relative so they work from /radio/ and friends; they must point at the site root.
  const root = page.includes("/") ? "../" : "";
  for (const f of ["favicon.ico", "favicon.svg", "apple-touch-icon.png"]) assert.ok(html.includes(`href="${root}${f}"`), f);
  assert.ok(!html.includes("{{"), "no unrendered placeholder");
});

test("preview image is a 1200x630 PNG under 300 KB", () => {
  const b = readFileSync("dist/og.png");
  assert.equal(b.subarray(1, 4).toString(), "PNG");
  assert.equal(b.readUInt32BE(16), 1200);
  assert.equal(b.readUInt32BE(20), 630);
  assert.ok(b.length < 300_000, `og.png is ${b.length} bytes`);
});

test("apple-touch-icon is 180x180 with no transparency", () => {
  const b = readFileSync("dist/apple-touch-icon.png");
  assert.equal(b.readUInt32BE(16), 180);
  assert.equal(b.readUInt32BE(20), 180);
  assert.ok([0, 2, 3].includes(b[25]), "colour type has no alpha channel (iOS paints transparent pixels black)");
});

test("build.json lists the preview files", () => {
  const files = JSON.parse(readFileSync("dist/build.json", "utf8")).files;
  for (const f of ["og.png", "favicon.ico", "favicon.svg", "apple-touch-icon.png"]) assert.match(files[f], /^[0-9a-f]{64}$/);
});

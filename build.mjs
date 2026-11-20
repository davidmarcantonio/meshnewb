// Reproducible build: same commit + same package-lock => byte-identical app.js / app.css.
// app.js contains no timestamps or commit info, so its sha256 can be checked by anyone who rebuilds.
//
// Community presets are data, not code: they are copied from the presets repo into dist/presets/ and fetched by the
// page from its own origin. app.js is the same whichever presets commit is used.
//   node build.mjs                      clone the presets repo's main branch
//   node build.mjs --presets <dir>      use a local checkout (tests use tests/fixtures/presets)
//   PRESETS_COMMIT=<sha> node build.mjs  pin a presets commit
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, existsSync, mkdtempSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { tmpdir } from "node:os";

const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const sri = (b) => "sha384-" + createHash("sha384").update(b).digest("base64");

const shim = resolve("shims/node.js");
const out = "dist";
rmSync(out, { recursive: true, force: true });
mkdirSync(`${out}/fonts`, { recursive: true });

const r = await build({
  entryPoints: ["src/main.js"],
  bundle: true, minify: true, format: "esm", target: "chrome110",
  write: false, legalComments: "none", charset: "utf8",
  // @meshtastic/core's npm build inlines tslog's Node flavour; these shims make it browser-safe.
  alias: { os: shim, path: shim, util: shim },
  banner: { js: 'globalThis.process??={env:{},cwd:()=>""};globalThis.Buffer??={isBuffer:()=>false};' },
});
const js = r.outputFiles[0].contents;
const css = readFileSync("src/app.css");
writeFileSync(`${out}/app.js`, js);
writeFileSync(`${out}/app.css`, css);

for (const [pkg, file] of [
  ["@fontsource/inter", "inter-latin-400-normal.woff2"],
  ["@fontsource/inter", "inter-latin-500-normal.woff2"],
  ["@fontsource/jetbrains-mono", "jetbrains-mono-latin-400-normal.woff2"],
]) copyFileSync(`node_modules/${pkg}/files/${file}`, `${out}/fonts/${file}`);

// The checked-out commit, not GITHUB_SHA: the daily presets refresh rebuilds the already-deployed app commit.
const git = (cwd, args) => execSync(`git ${args}`, { cwd, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
let commit;
try { commit = git(".", "rev-parse HEAD"); } catch { commit = process.env.GITHUB_SHA || "uncommitted"; }

// ---------- community presets ----------
const PRESETS_REPO = process.env.PRESETS_REPO || "davidmarcantonio/meshtastic-us-presets";
const argDir = process.argv.includes("--presets") ? process.argv[process.argv.indexOf("--presets") + 1] : null;
let presetsDir = argDir && resolve(argDir);
if (!presetsDir) {
  presetsDir = mkdtempSync(join(tmpdir(), "presets-"));
  const ref = process.env.PRESETS_COMMIT || "main";
  execSync(`git init -q && git fetch -q --depth 1 https://github.com/${PRESETS_REPO}.git ${ref} && git checkout -q FETCH_HEAD`, { cwd: presetsDir, stdio: "inherit" });
}
let presetsCommit = "fixture", presetsDate = "fixture";
try {
  // Only trust git if the folder is its own repository; a fixture folder inside this repo would report this repo's commit.
  if (resolve(git(presetsDir, "rev-parse --show-toplevel")) === presetsDir) {
    presetsCommit = git(presetsDir, "rev-parse HEAD"); presetsDate = git(presetsDir, "log -1 --format=%cs");
  }
} catch { /* a plain folder (test fixture) */ }
if (!existsSync(join(presetsDir, "index.json"))) throw new Error(`No index.json in presets (${PRESETS_REPO} @ ${presetsCommit}). Refusing to build a site with no communities.`);
const indexBytes = readFileSync(join(presetsDir, "index.json"));
const index = JSON.parse(indexBytes);
if (!index.communities?.length) throw new Error("presets index.json lists no communities");
const presetFiles = { "index.json": sha256(indexBytes) };
mkdirSync(`${out}/presets`, { recursive: true });
writeFileSync(`${out}/presets/index.json`, indexBytes);
for (const c of index.communities) {
  if (!/^us\/[a-z]{2}\/[a-z0-9-]+\.json$/.test(c.path)) throw new Error(`unexpected preset path ${c.path}`);
  const bytes = readFileSync(join(presetsDir, c.path));
  const d = JSON.parse(bytes);
  if (d.id !== c.id || d.status !== c.status) throw new Error(`${c.path} doesn't match index.json (index is stale?)`);
  mkdirSync(dirname(`${out}/presets/${c.path}`), { recursive: true });
  writeFileSync(`${out}/presets/${c.path}`, bytes);
  presetFiles[c.path] = sha256(bytes);
}
const repo = process.env.GITHUB_REPOSITORY || "davidmarcantonio/meshnewb";
const fw = JSON.parse(readFileSync("data/firmware.json", "utf8"));

const vars = {
  APP_SRI: sri(js), CSS_SRI: sri(css), APP_SHA256: sha256(js),
  VERSION: JSON.parse(readFileSync("package.json", "utf8")).version,
  COMMIT: commit, COMMIT_SHORT: commit.slice(0, 7), REPO: repo, FW_TESTED: fw.tested,
  PRESETS_REPO, PRESETS_COMMIT: presetsCommit, PRESETS_COMMIT_SHORT: presetsCommit.slice(0, 7), PRESETS_DATE: presetsDate,
  PRESETS_COUNT: String(index.communities.length),
};
// Four pages from two templates: the picker at /, and the app template rendered as /radio/, /family/ and /check/.
const render = (file, extra) => readFileSync(file, "utf8").replace(/\{\{(\w+)\}\}/g, (m, k) => {
  const v = { ...vars, ...extra }; if (!(k in v)) throw new Error(`unknown placeholder ${m}`); return v[k];
});
const PAGES = ["index.html", "radio/index.html", "family/index.html", "check/index.html"];
writeFileSync(`${out}/index.html`, render("src/home.html", {}));
for (const page of ["radio", "family", "check"]) {
  mkdirSync(`${out}/${page}`, { recursive: true });
  writeFileSync(`${out}/${page}/index.html`, render("src/index.html", { PAGE: page, ROOT: "../" }));
}
writeFileSync(`${out}/.nojekyll`, "");

const manifest = {
  version: vars.VERSION,
  commit, repo, files: {},
  presets: { repo: PRESETS_REPO, commit: presetsCommit, date: presetsDate, count: index.communities.length, files: presetFiles },
};
for (const f of [...PAGES, "app.js", "app.css"]) manifest.files[f] = sha256(readFileSync(`${out}/${f}`));
writeFileSync(`${out}/build.json`, JSON.stringify(manifest, null, 2) + "\n");
console.log(`app.js ${js.length} bytes  sha256 ${vars.APP_SHA256}\ncommit ${commit}\npresets ${index.communities.length} communities, ${PRESETS_REPO} @ ${presetsCommit} (${presetsDate})`);

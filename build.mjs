// Reproducible build: same commit + same package-lock => byte-identical app.js / app.css.
// app.js contains no timestamps or commit info, so its sha256 can be checked by anyone who rebuilds.
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync } from "node:fs";
import { resolve } from "node:path";

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

const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const sri = (b) => "sha384-" + createHash("sha384").update(b).digest("base64");

let commit = process.env.GITHUB_SHA;
if (!commit) { try { commit = execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { commit = "uncommitted"; } }
const repo = process.env.GITHUB_REPOSITORY || "davidmarcantonio/meshnewb";
const fw = JSON.parse(readFileSync("data/firmware.json", "utf8"));

const vars = {
  APP_SRI: sri(js), CSS_SRI: sri(css), APP_SHA256: sha256(js),
  COMMIT: commit, COMMIT_SHORT: commit.slice(0, 7), REPO: repo, FW_TESTED: fw.tested,
};
let html = readFileSync("src/index.html", "utf8");
html = html.replace(/\{\{(\w+)\}\}/g, (m, k) => { if (!(k in vars)) throw new Error(`unknown placeholder ${m}`); return vars[k]; });
writeFileSync(`${out}/index.html`, html);
writeFileSync(`${out}/.nojekyll`, "");

const manifest = { commit, repo, files: {} };
for (const f of ["index.html", "app.js", "app.css"]) manifest.files[f] = sha256(readFileSync(`${out}/${f}`));
writeFileSync(`${out}/build.json`, JSON.stringify(manifest, null, 2) + "\n");
console.log(`app.js ${js.length} bytes  sha256 ${vars.APP_SHA256}\ncommit ${commit}`);

/**
 * Stage the installable controller for one platform:
 *
 *   release/canopy-controller-<version>-<platform>-<arch>/
 *     node | node.exe        pinned Node runtime, checksum verified
 *     controller.mjs(.map)   the bundle from scripts/bundle.mjs
 *     better_sqlite3.node    better-sqlite3's binary, prebuilt for that Node
 *
 * It runs on its own: no pnpm, tsx or repo. Start it with
 *   DATA_DIR=<dir> ./node --enable-source-maps controller.mjs
 *
 *   node scripts/stage.mjs                         this machine
 *   node scripts/stage.mjs --platform win32 --arch x64
 *
 * Downloads are cached in .cache/, so a second run is offline.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

/**
 * The Node the controller ships with. An LTS line, and the one development
 * runs on, so what is tested is what is installed.
 */
const NODE_VERSION = "24.20.0";

const { values } = parseArgs({
  options: {
    platform: { type: "string", default: process.platform },
    arch: { type: "string", default: process.arch },
  },
});
const platform = values.platform;
const arch = values.arch;
if (!["linux", "win32"].includes(platform)) throw new Error(`Unsupported platform: ${platform}`);
if (!["x64", "arm64"].includes(arch)) throw new Error(`Unsupported arch: ${arch}`);

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = join(root, ".cache");
const bundle = join(root, "release/controller.mjs");
const { version } = JSON.parse(await readFile(join(root, "../../package.json"), "utf8"));
const out = join(root, `release/canopy-controller-${version}-${platform}-${arch}`);

async function exists(path) {
  return stat(path).then(() => true, () => false);
}

/** Download once into the cache; later runs reuse the file. */
async function fetchCached(url, name) {
  const path = join(cacheDir, name);
  if (await exists(path)) return path;
  console.log(`download ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  await mkdir(cacheDir, { recursive: true });
  await writeFile(path, Buffer.from(await res.arrayBuffer()));
  return path;
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

if (!(await exists(bundle))) throw new Error("No bundle. Run scripts/bundle.mjs first.");

// ── Node ──────────────────────────────────────────────────────────────────────

const nodeDist = `https://nodejs.org/dist/v${NODE_VERSION}`;
const nodePlatform = platform === "win32" ? "win" : platform;
const nodeBase = `node-v${NODE_VERSION}-${nodePlatform}-${arch}`;
const nodeArchive = platform === "win32" ? `${nodeBase}.zip` : `${nodeBase}.tar.xz`;

const sums = await readFile(await fetchCached(`${nodeDist}/SHASUMS256.txt`, `node-v${NODE_VERSION}-SHASUMS256.txt`), "utf8");
const expected = sums.split("\n").find((line) => line.endsWith(`  ${nodeArchive}`))?.split(" ")[0];
if (!expected) throw new Error(`${nodeArchive} is not in Node's SHASUMS256.txt`);
const archivePath = await fetchCached(`${nodeDist}/${nodeArchive}`, nodeArchive);
if ((await sha256(archivePath)) !== expected) {
  await rm(archivePath);
  throw new Error(`${nodeArchive} does not match its published checksum, so it was deleted. Run again.`);
}

// The native module has to be built for this Node's ABI, which nodejs.org
// publishes per release as `modules`.
const releases = JSON.parse(await readFile(await fetchCached("https://nodejs.org/dist/index.json", `node-index-${NODE_VERSION}.json`), "utf8"));
const abi = releases.find((r) => r.version === `v${NODE_VERSION}`)?.modules;
if (!abi) throw new Error(`No ABI version for Node ${NODE_VERSION} in nodejs.org's index`);

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

if (platform === "win32") {
  execFileSync("unzip", ["-q", "-j", archivePath, `${nodeBase}/node.exe`, `${nodeBase}/LICENSE`, "-d", out]);
} else {
  execFileSync("tar", ["-xJf", archivePath, "-C", out, "--strip-components=1", `${nodeBase}/bin/node`, `${nodeBase}/LICENSE`]);
  await cp(join(out, "bin/node"), join(out, "node"));
  await rm(join(out, "bin"), { recursive: true });
}
await cp(join(out, "LICENSE"), join(out, "LICENSE.node"));
await rm(join(out, "LICENSE"));

// ── better-sqlite3 ────────────────────────────────────────────────────────────

// Resolved the way the backend resolves it, so the version staged is the
// version bundled.
const require = createRequire(join(root, "package.json"));
const sqliteDir = dirname(require.resolve("better-sqlite3/package.json"));
const sqliteVersion = JSON.parse(await readFile(join(sqliteDir, "package.json"), "utf8")).version;

// The project publishes a prebuilt binary per Node ABI, platform and arch,
// which is what `prebuild-install` fetches on a normal install.
const prebuild = `better-sqlite3-v${sqliteVersion}-node-v${abi}-${platform}-${arch}.tar.gz`;
const prebuildPath = await fetchCached(
  `https://github.com/WiseLibs/better-sqlite3/releases/download/v${sqliteVersion}/${prebuild}`,
  prebuild,
);
execFileSync("tar", ["-xzf", prebuildPath, "-C", out, "--strip-components=2", "build/Release/better_sqlite3.node"]);
await cp(join(sqliteDir, "LICENSE"), join(out, "LICENSE.better-sqlite3"));

// ── The controller ────────────────────────────────────────────────────────────

await cp(bundle, join(out, "controller.mjs"));
await cp(`${bundle}.map`, join(out, "controller.mjs.map"));

console.log(`staged ${out}`);
console.log(`  node ${NODE_VERSION} (ABI ${abi}), better-sqlite3 ${sqliteVersion}`);

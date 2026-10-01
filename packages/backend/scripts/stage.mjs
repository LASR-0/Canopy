/**
 * Stage the installable controller for one platform:
 *
 *   release/canopy-controller-<version>-<platform>-<arch>/
 *     node | node.exe        pinned Node runtime, checksum verified
 *     controller.mjs(.map)   the bundle, rebuilt by scripts/bundle.mjs first
 *     better_sqlite3.node    better-sqlite3's binary, prebuilt for that Node
 *     canopy-service.exe     win32 only: WinSW, with canopy-service.xml
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
 * The Node the controller ships with: the repo's .node-version, which CI also
 * tests on, so what is tested is what is installed. An LTS line.
 */
const NODE_VERSION = (await readFile(join(dirname(fileURLToPath(import.meta.url)), "../../../.node-version"), "utf8")).trim();

/**
 * WinSW, which lets node.exe run as a Windows service (packaging/windows).
 * The .NET Framework 4.6.1 build: 656 KB, and every supported Windows ships
 * .NET Framework 4.8. WinSW publishes no checksums and does not sign its
 * releases, so this hash was taken from the GitHub release on 2026-10-01.
 */
const WINSW_VERSION = "2.12.0";
const WINSW_SHA256 = "b5066b7bbdfba1293e5d15cda3caaea88fbeab35bd5b38c41c913d492aadfc4f";

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

/**
 * Windows' own tar, by full path: on a CI runner Git's GNU tar can come first
 * on the PATH, and it reads no zip and takes "C:" for a remote host.
 */
const TAR = process.platform === "win32" ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";

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

// Always bundled afresh: staging a bundle left over from an earlier build once
// packed a 0.0.1 controller into a folder named 0.0.0. It takes under a second.
execFileSync(process.execPath, [join(root, "scripts/bundle.mjs")], { stdio: "inherit" });

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
  // Windows' tar is bsdtar, which reads zip; Linux's GNU tar does not.
  const entries = [`${nodeBase}/node.exe`, `${nodeBase}/LICENSE`];
  if (process.platform === "win32") execFileSync(TAR, ["-xf", archivePath, "-C", out, "--strip-components=1", ...entries]);
  else execFileSync("unzip", ["-q", "-j", archivePath, ...entries, "-d", out]);
} else {
  execFileSync(TAR, ["-xJf", archivePath, "-C", out, "--strip-components=1", `${nodeBase}/bin/node`, `${nodeBase}/LICENSE`]);
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
execFileSync(TAR, ["-xzf", prebuildPath, "-C", out, "--strip-components=2", "build/Release/better_sqlite3.node"]);
await cp(join(sqliteDir, "LICENSE"), join(out, "LICENSE.better-sqlite3"));

// ── WinSW (Windows) ───────────────────────────────────────────────────────────

if (platform === "win32") {
  const winsw = await fetchCached(
    `https://github.com/winsw/winsw/releases/download/v${WINSW_VERSION}/WinSW.NET461.exe`,
    `WinSW.NET461-v${WINSW_VERSION}.exe`,
  );
  if ((await sha256(winsw)) !== WINSW_SHA256) {
    await rm(winsw);
    throw new Error("WinSW does not match its pinned checksum, so it was deleted. Run again.");
  }
  const license = await fetchCached(
    `https://raw.githubusercontent.com/winsw/winsw/v${WINSW_VERSION}/LICENSE.txt`,
    `WinSW-LICENSE-v${WINSW_VERSION}.txt`,
  );
  // WinSW reads the .xml that shares its own name.
  await cp(winsw, join(out, "canopy-service.exe"));
  await cp(join(root, "../../packaging/windows/canopy-service.xml"), join(out, "canopy-service.xml"));
  await cp(license, join(out, "LICENSE.winsw"));
}

// ── The controller ────────────────────────────────────────────────────────────

await cp(bundle, join(out, "controller.mjs"));
await cp(`${bundle}.map`, join(out, "controller.mjs.map"));

console.log(`staged ${out}`);
console.log(`  node ${NODE_VERSION} (ABI ${abi}), better-sqlite3 ${sqliteVersion}`);

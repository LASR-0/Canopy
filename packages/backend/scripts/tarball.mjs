/**
 * Pack the Linux controller tarball, the controller without the desktop app:
 *
 *   release/canopy-controller-<version>-linux-<arch>.tar.gz
 *     canopy-controller-<version>-linux-<arch>/
 *       install.sh  uninstall.sh  canopy.service  controller/
 *
 * Stage that arch first (scripts/stage.mjs). The scripts and the unit are the
 * ones the .deb, .rpm and pacman packages use, from packaging/linux.
 *
 *   node scripts/tarball.mjs [--arch x64|arm64]
 */
import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

const { values } = parseArgs({ options: { arch: { type: "string", default: process.arch } } });
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const linux = join(root, "../../packaging/linux");
const { version } = JSON.parse(await readFile(join(root, "../../package.json"), "utf8"));

const name = `canopy-controller-${version}-linux-${values.arch}`;
const staged = join(root, "release", name);
await stat(staged).catch(() => {
  throw new Error(`${name} is not staged. Run: node scripts/stage.mjs --platform linux --arch ${values.arch}`);
});

const work = join(root, "release/tarball");
const top = join(work, name);
await rm(work, { recursive: true, force: true });
await mkdir(top, { recursive: true });
await cp(staged, join(top, "controller"), { recursive: true });
for (const file of ["install.sh", "uninstall.sh", "canopy.service"]) {
  await cp(join(linux, file), join(top, file));
}

const out = join(root, "release", `${name}.tar.gz`);
// Owned by root inside the archive, whoever built it.
execFileSync("tar", ["-czf", out, "--owner=0", "--group=0", "-C", work, name]);
await rm(work, { recursive: true });
console.log(`packed ${out}`);

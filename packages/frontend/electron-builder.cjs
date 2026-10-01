/**
 * electron-builder configuration. JavaScript rather than YAML so paths resolve
 * absolutely: fpm runs from whatever directory the build was started in, and a
 * relative path handed to it would depend on that.
 *
 * Build the controller for the target first (`pnpm build:controller`): every
 * installer carries it, and it is the part that runs as the service.
 */
const { existsSync, readdirSync, readFileSync } = require("node:fs");
const { homedir } = require("node:os");
const { join, resolve } = require("node:path");

const repo = resolve(__dirname, "../..");
const linux = join(repo, "packaging/linux");
// One version for the whole product, kept in the workspace root.
const { version } = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));

/** Where scripts/stage.mjs puts the controller; ${arch} is electron-builder's. */
const controller = (platform) =>
  join(repo, `packages/backend/release/canopy-controller-${version}-${platform}-\${arch}`);

/**
 * Use the Electron zip that `install-electron` already downloaded, if it is
 * there, rather than fetching it again. The copy is the same file, and
 * electron-builder splits its own download into ranged requests, which the
 * proxy on the work network refuses (HTTP 416). Returning null downloads.
 */
function electronDist({ platformName, arch, version }) {
  const cache = process.env.electron_config_cache ?? join(homedir(), ".cache/electron");
  const zip = `electron-v${version}-${platformName}-${arch}.zip`;
  if (!existsSync(cache)) return null;
  for (const dir of readdirSync(cache)) {
    if (existsSync(join(cache, dir, zip))) return join(cache, dir, zip);
  }
  return null;
}

/**
 * Shared by the three package formats, which all go through fpm. fpm takes
 * every flag before the first file, so the two are kept apart: a flag after
 * a file is taken for a file to package.
 */
const fpmPackage = (flags = []) => ({
  afterInstall: join(linux, "after-install.sh"),
  afterRemove: join(linux, "after-remove.sh"),
  fpm: [
    "--before-remove", join(linux, "before-remove.sh"),
    ...flags,
    `${join(linux, "canopy.service")}=/usr/lib/systemd/system/canopy.service`,
  ],
});

/** @type {import("electron-builder").Configuration} */
module.exports = {
  appId: "org.canopy.app",
  productName: "Canopy",
  // The npm name, @canopy/frontend, is not a valid package or executable name.
  extraMetadata: { name: "canopy", version },
  electronDist,
  directories: { output: "dist-build", buildResources: "build" },
  files: ["out/**"],
  mac: {
    // Deferred to after Phase 8 (see ROADMAP): nothing is built for macOS yet.
    target: "dmg",
    category: "public.app-category.utilities",
  },
  win: {
    target: [{ target: "nsis", arch: ["x64"] }],
    // Installed to <install dir>\controller, where canopy-service.xml expects
    // node.exe beside WinSW.
    extraFiles: [{ from: controller("win32"), to: "controller" }],
    // Stamping Canopy.exe's version and icon runs rcedit.exe, which needs Wine
    // anywhere but Windows. A build on Linux is for testing; the installers
    // that ship are built on Windows in CI.
    signAndEditExecutable: process.platform === "win32",
  },
  nsis: {
    // Per machine: Program Files, one elevation prompt, and the rights to
    // register a service, which a per-user install does not have.
    perMachine: true,
    // Registers, upgrades and removes the controller service.
    include: join(repo, "packaging/windows/installer.nsh"),
  },
  linux: {
    // No AppImage: it has no install step, so it cannot register the service.
    target: ["deb", "rpm", "pacman"],
    category: "Utility",
    executableName: "canopy",
    maintainer: "LASR-0 <71620670+LASR-0@users.noreply.github.com>",
    // Installed to /opt/Canopy/controller, which is where canopy.service runs it.
    extraFiles: [{ from: controller("linux"), to: "controller" }],
  },
  deb: fpmPackage(),
  rpm: fpmPackage(),
  // pacman runs nothing on an upgrade unless it has a post_upgrade, which
  // would leave the old controller running on deleted files until a reboot.
  pacman: fpmPackage(["--after-upgrade", join(linux, "after-upgrade.sh")]),
};

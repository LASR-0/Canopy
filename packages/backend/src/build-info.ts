/**
 * Facts baked in when the controller is bundled for install
 * (scripts/bundle.mjs). Under `tsx` in development nothing is baked in, and
 * each falls back to what the dev environment provides.
 */

// Replaced by esbuild's `define`. `typeof` on an undeclared name is safe, so
// the unbundled source never throws a ReferenceError here.
declare const __CANOPY_VERSION__: string;

/** True in the installed controller, false under `pnpm dev`. */
export const BUNDLED = typeof __CANOPY_VERSION__ === "string";

/**
 * The controller's version. pnpm sets `npm_package_version` for its scripts,
 * but a service started by systemd or the Windows SCM has no pnpm above it,
 * which is why the installed build carries its own.
 */
export const VERSION = BUNDLED ? __CANOPY_VERSION__ : (process.env["npm_package_version"] ?? "0.0.0");

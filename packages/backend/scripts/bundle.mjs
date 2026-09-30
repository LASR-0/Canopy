/**
 * Bundle the controller into one ESM file for install: release/controller.mjs.
 *
 * Everything is inlined except better-sqlite3, which is native and is staged
 * beside the bundle with a binary for the target Node (scripts/stage.mjs).
 * The result does not depend on the platform; staging does.
 */
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// One version for the whole product, kept in the workspace root.
const { version } = JSON.parse(await readFile(join(root, "../../package.json"), "utf8"));

await build({
  entryPoints: [join(root, "src/index.ts")],
  outfile: join(root, "release/controller.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  sourcemap: "linked",
  external: [
    "better-sqlite3",
    // ws tries these optional native speedups inside a try/catch and falls
    // back to JS without them.
    "bufferutil",
    "utf-8-validate",
  ],
  define: { __CANOPY_VERSION__: JSON.stringify(version) },
  // The dependencies are CommonJS, and an ESM bundle has no `require`,
  // `__filename` or `__dirname` for them to use.
  banner: {
    js: [
      `import { createRequire as __canopyRequire } from "node:module";`,
      `import { fileURLToPath as __canopyPath } from "node:url";`,
      `import { dirname as __canopyDir } from "node:path";`,
      `const require = __canopyRequire(import.meta.url);`,
      `const __filename = __canopyPath(import.meta.url);`,
      `const __dirname = __canopyDir(__filename);`,
    ].join("\n"),
  },
  logLevel: "info",
});

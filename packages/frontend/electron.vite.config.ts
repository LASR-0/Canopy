import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// ELECTRON_RUN_AS_NODE=1 is set by Electron-based host tools (VS Code, Claude
// Code) to prevent child processes from launching Electron UI. electron-vite
// inherits this and passes it to the spawned Electron binary — which makes
// Electron run as plain Node.js, breaking require('electron') and process.type.
// Clear it here so the spawned dev binary gets the full Electron environment.
delete process.env["ELECTRON_RUN_AS_NODE"];

export default defineConfig({
  // Thin Electron shell — externalize node deps, don't bundle electron.
  main: { plugins: [externalizeDepsPlugin()] },
  preload: { plugins: [externalizeDepsPlugin()] },
  // The actual UI. Tailwind v4 plugin + the "@" alias shadcn expects.
  renderer: {
    resolve: { alias: { "@": resolve("src/renderer/src") } },
    plugins: [react(), tailwindcss()],
  },
});

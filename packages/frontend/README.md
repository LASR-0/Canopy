# @canopy/frontend

Electron + React + TypeScript UI. An unprivileged client of the controller
service (talks to it over HTTP + WebSocket). Electron's main process is thin —
just the native window; the controller lives elsewhere as an OS service.

## Layout (electron-vite)
- `src/main/`      — Electron main process (window + native chrome only)
- `src/preload/`   — context-isolated bridge (window controls)
- `src/renderer/`  — the React app
  - `src/renderer/src/shell/`      — titlebar / sidebar / main
  - `src/renderer/src/components/` — reusable primitives (+ `ui/` for shadcn)
  - `src/renderer/src/pages/`      — one view per nav item
  - `src/renderer/src/lib/`        — http client, ws, query, `cn`
  - `src/renderer/src/theme/`      — ThemeProvider (token swap on data-theme)
  - `src/renderer/src/styles/`     — Tailwind v4 + Primer token variables

## Run
From the repo root: `pnpm install`, then `pnpm --filter @canopy/frontend dev`.

## Stack
electron-vite (dev/build) · electron-builder (dmg/nsis/deb) · Tailwind v4
(`@tailwindcss/vite`) · shadcn-ready (`components.json`, `@` alias, `cn`).

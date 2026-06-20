# Canopy — Project Handoff

Open-source desktop app for managing indoor grow setups using **local** smart
devices (sensors, lighting, agricultural actuators). It discovers devices on the
LAN itself, visualises their data, and runs scheduled + reactive automations per
grow cycle and grow mode.

This document is the canonical record of decisions. **Read it before changing
anything**, and inspect the existing file structure (below) — the project is
already scaffolded; do not regenerate, re-init, or duplicate it.

---

## Instructions for the next session (read first)

1. **Use the existing generated structure.** It is scaffolded and intentional
   (see "Repository layout"). Never run `npm init` or any scaffolder — the
   manifests already exist. Add deps only with `pnpm add` inside the right
   package; never `npm install` (the repo uses the `workspace:` protocol, which
   plain npm cannot resolve).
2. **Package manager is pnpm (v11).** `pnpm install` at the repo root reads all
   manifests and populates one root `node_modules` with per-package symlinks. It
   only reads manifests; it never rewrites config.
3. **Electron install is the current blocker.** `electron` is already declared
   in `packages/frontend` devDependencies, but pnpm 11 **ignores package build
   scripts by default**, so Electron's postinstall (which downloads its binary)
   was skipped — causing `Error: Electron uninstall` on `dev`. To fix: run
   `pnpm approve-builds` and approve **electron**, **esbuild**, and
   **electron-winstaller**, then `pnpm rebuild electron` (or re-run
   `pnpm install`) so the binary downloads. If `electron` is ever missing from
   `packages/frontend/package.json`, add it back to devDependencies before
   approving. Approvals persist in the root `package.json` under
   `pnpm.onlyBuiltDependencies`.
4. **File-delivery workflow.** Deliver individual changed files with explicit
   repo-relative paths — not a re-zipped project. The user's local copy is
   canonical. Call out new files vs edits; for small edits show only the changed
   section with surrounding context.

---

## Stack

**Monorepo** — pnpm workspaces. Three packages:
- `@canopy/shared-types` — domain types + HTTP/WS contract (source of truth)
- `@canopy/backend` — the controller service
- `@canopy/frontend` — Electron + React UI

**Language** — TypeScript 6, ESM throughout. `tsconfig.base.json` is strict
(`verbatimModuleSyntax`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`).

**Frontend**
- Electron 42 + **electron-vite** 5 (dev/build) + **electron-builder** 26
  (packaging: dmg / nsis / deb). Layout is electron-vite's `main` / `preload` /
  `renderer`. Main process is **thin** — native window only; the controller is
  a separate service the renderer reaches over HTTP/WS.
- React 19.2, Vite 8.
- **Tailwind v4** via `@tailwindcss/vite` (CSS-first: `@import "tailwindcss"` +
  `@theme`; no JS config). `@` alias → `src/renderer/src`.
- **shadcn/ui** (Radix primitives, copied into the repo, added on demand with
  `npx shadcn@latest add <name>` → `components/ui`). `components.json` + `cn`
  helper (`lib/utils.ts`) already set up.
- **TanStack Table** 8 for sortable/filterable lists; **Recharts** 3 for heavy
  charts (Logging); the prototype's hand-rolled **Sparkline** for inline charts.
- **State:** TanStack Query for server state, React state/Context for local UI
  state. **Zustand is deferred** — add only when the live WebSocket stream needs
  selector-based subscriptions to avoid Context re-render storms.
- **Theme:** `ThemeProvider` swaps Primer token CSS variables on a `data-theme`
  attribute (persisted to localStorage).

**Backend**
- Node service. **SQLite** via **Drizzle ORM** (Prisma rejected — native
  query-engine binary is painful in Electron).
- Embedded **MQTT broker: Aedes** (pure JS).
- **mDNS discovery: `bonjour-service`** (pure JS). Avoid the native `mdns`
  package — it needs a compiler + Bonjour SDK and breaks cross-platform packaging.
- HTTP + WebSocket server (specific lib not yet chosen — fastify or express+ws).
- Modules: `device-manager`, `broker`, `scheduler`, `rules`, `store`, `api`, `ws`.

**Shared** — `@canopy/shared-types` holds domain entities, the `ApiRoutes` HTTP
contract, and the WebSocket `ServerMessage`/`ClientMessage` protocol. Both sides
import it so backend handlers and frontend client cannot drift.

---

## Architecture & deployment

The backend is a **long-running, OS-managed service**, independent of the UI.
Rationale: this is a grow controller — a missed light or irrigation cycle harms
plants — so "runs when the UI is closed and survives a reboot" is effectively a
requirement, not a nice-to-have.

- **Boot-level service**, registered by the **installer** with one-time
  elevation: launchd LaunchDaemon (macOS) / systemd system service (Linux) /
  Windows service. It is **never spawned or owned by the UI** — that single rule
  eliminates the child-process trap where closing the window kills the backend.
- The **UI is an unprivileged client**. It discovers the backend via
  `GET /health` and connects over HTTP + WebSocket. Closing the window never
  stops the controller; reopening just reconnects.
- The controller has explicit states: `running` / `paused` / `stopped`. The UI
  can turn it off and on (a privileged op exposed by the service's own control
  surface). "Stopped" is deliberate and distinct from "window closed."

**Two deployment shapes, one codebase:**
- **Single host (favoured / expected common case):** backend + UI on the same
  machine; backend still runs independently via the service manager.
- **Headless:** backend on a separate always-on box (e.g. a Raspberry Pi by the
  tent); UI connects across the LAN.

The HTTP/WS boundary + shared contract exist from the start, so headless needs
no retrofit. Because single-host is the expected norm, development happens as
one **monorepo**.

---

## Device support (v1 scope)

Deliberately narrow. The original "80% of devices" goal was dropped as
unrealistic. **v1 = local HTTP + MQTT only. No Home Assistant dependency** —
Canopy discovers and controls devices itself.

**Two discovery models (they differ):**
- **HTTP/Wi-Fi devices** are actively *found* — they advertise over **mDNS**.
  (A brute-force subnet/IP probe is deferred to a later opt-in "advanced scan".)
- **MQTT devices** are *broker-mediated* — they publish to the embedded Aedes
  broker and are discovered by watching topics. Canopy listens for the
  Home-Assistant-style retained discovery convention
  (`homeassistant/<type>/<id>/config`) to auto-populate devices **with their
  capabilities** — using the convention only, not HA itself.

**Adapter architecture** — two transports ≠ two integrations. One small adapter
per device family: **Shelly, Tasmota, ESPHome, generic-MQTT** (fallback). All
four speak MQTT.

**Device model** — `family` + `protocol` + detected `capabilities`
(sensor/actuator channels). **Roles** bind a capability to a functional purpose
(e.g. "exhaust fan", "canopy temp"), so automations target a role, not a device
id — hardware can be swapped without breaking rules.

**OS realities to design for:** macOS Local Network permission for discovery;
firewall allowance for the broker port.

---

## Features

**Multi-tent** — everything is scoped to a `TentSetup`. The workspace switcher
scopes all data to the selected tent. Baked into every type (`tentId`).

**Navigation groups:**
- **Monitor** — Overview, Setup View
- **Manage** — Automation, Grow Cycle, Journal
- **Service** — Maintenance, Logging
- **Config** — Settings

**Per page:**
- **Overview** — sensor cards + sparklines + activity feed; empty/configured
  states derived from data.
- **Setup View** *(not yet designed)* — visual layout of the tent (device,
  sensor, pot placement) to compare layouts across grows.
- **Automation** — capability-driven, organised by subsystem (lighting, climate,
  airflow, etc.). Two kinds: **schedule** (time → scheduler) and **rule**
  (condition → rules engine). Scopable to a grow stage/mode.
- **Grow Cycle** — stages (seedling/veg/flower/flush/harvest); status state
  machine `planned → active → completed | aborted`; harvest screen captures
  rating, yield, notes.
- **Journal** — dual purpose: live notebook for the current grow + history
  archive of completed grows, with cross-grow comparison.
- **Maintenance** *(not yet designed)* — recurring reminders: sensor cleaning,
  filter swaps, nutrient/feed top-ups, calibration; due-date tracking.
- **Logging** *(not yet designed)* — sensor data over time, chart-heavy
  (Recharts), per-tent plus log history of previous grows.
- **Settings** — device connection/scanning/provisioning, role assignment,
  protocols.

**UX convention:** forms, confirmations, and editing are **inline** (Primer /
GitHub style) rather than external modal dialogs where possible.

**Readings & retention** — tiered: keep `raw` ~a week, roll up to `hourly` /
`daily` long-term. Live operational SQLite DB stays hot and always-connected; a
separate **archive DB file** is opened on demand for completed grows (keeps the
live DB and its backups small). Internal scheduled jobs (reuse the scheduler,
not a separate cron) handle rollups, auto-archiving finished grows, and
`VACUUM INTO` backups.

---

## Theme

GitHub **Primer** design tokens. Light and dark are structurally identical —
only token *values* differ — so theming is a pure CSS-variable swap.
`ThemeProvider` toggles `data-theme` on `<html>`; Tailwind v4 exposes tokens via
`@theme inline` (`--color-*` → utilities like `bg-canvas`, `text-fg-muted`).
Custom themes later = another override block.

**Status:** only a *starter subset* of tokens is in
`src/renderer/src/styles/index.css` right now. **Porting the full Primer token
set from the prototype is the next task.** When doing it, reconcile shadcn's own
CSS-variable scheme (written by `shadcn init`) with the Primer values.

---

## Resources for development

- **High-fidelity prototypes:** `Journal_History_light.html` and
  `Journal_History_dark.html`. These are not static mockups — each is a working
  **React 18 app** (React UMD + Babel standalone), ~2,500 lines, ~50 components,
  already branded "Canopy". **Use them as the canonical reference** for screens,
  components, and CSS. Lift from them: the full Primer token set (both themes),
  the ~50 inline SVG icons (into one typed `<Icon>` component), the `Sparkline`,
  and the component anatomy (shell, cards, tags/chips, empty states, modal,
  content-header pattern).
  - **Pages already designed:** Overview, Settings, Automation, Grow Cycle,
    Journal.
  - **Not yet designed** (user will supply updated designs later): Setup View,
    Maintenance, Logging.
- **`@canopy/shared-types`** — the other key resource; it encodes every domain
  decision as types.

---

## Current build state

- **shared-types** — fully authored, type-checks clean (TS6).
- **frontend** — toolchain wired (electron-vite + React 19 + Tailwind v4 +
  shadcn-ready + electron-builder); renderer TypeScript type-checks clean;
  minimal bootable `App` with a working light/dark toggle.
- **backend** — skeleton stubs only (module folders with responsibility
  comments); no runtime code yet.
- **Blocker in progress:** Electron binary not downloaded because pnpm 11
  ignored its build script — resolve via `pnpm approve-builds` (see Instructions).
  `packageManager` field is pinned to `pnpm@11.5.0`.

**Queued next steps, in order:**
1. Finish the Electron install so `pnpm --filter @canopy/frontend dev` opens the
   window.
2. Port the full Primer token set into `index.css`.
3. Build the shell (titlebar / sidebar / main) against mock data.
4. Build the reusable primitives (Icon, Card, Tag, Toggle, Tabs, Modal,
   EmptyState, Sparkline, StarRating, SignalBars, chips).
5. Build the pages.

**Open decisions not yet made:** HTTP server library (fastify vs express+ws);
exact reading-retention policy; when to introduce Zustand; the opt-in subnet
sweep.

---

## Repository layout

```
canopy/
├── package.json                 # root: pnpm workspace, convenience scripts, packageManager
├── pnpm-workspace.yaml
├── .npmrc
├── tsconfig.base.json           # strict TS shared by all packages
├── HANDOFF.md                   # this file
└── packages/
    ├── shared-types/            # @canopy/shared-types — source of truth
    │   └── src/
    │       ├── domain/          # device, capability, reading, tent, grow,
    │       │                    #   automation, journal, maintenance, controller, common
    │       ├── api/             # envelope.ts, routes.ts (ApiRoutes contract)
    │       ├── ws/              # messages.ts (Server/Client message protocol)
    │       └── index.ts         # barrel
    ├── backend/                 # @canopy/backend — OS-managed controller (stubs only)
    │   └── src/
    │       ├── device-manager/  # discovery, pairing, per-family adapters, registry
    │       ├── broker/          # embedded MQTT (aedes) + HA-discovery listener
    │       ├── scheduler/       # time-driven automations + internal maintenance jobs
    │       ├── rules/           # event-driven automations
    │       ├── store/           # SQLite via drizzle; live + on-demand archive DB
    │       ├── api/             # HTTP, implements ApiRoutes
    │       ├── ws/              # WebSocket push
    │       └── index.ts         # service entry point
    └── frontend/                # @canopy/frontend — Electron + React UI
        ├── electron.vite.config.ts
        ├── electron-builder.yml
        ├── components.json      # shadcn config
        ├── tsconfig.json / tsconfig.node.json / tsconfig.web.json
        └── src/
            ├── main/            # thin Electron main process (window only)
            ├── preload/         # context-isolated bridge (window controls)
            └── renderer/
                ├── index.html
                └── src/
                    ├── main.tsx
                    ├── App.tsx
                    ├── shell/       # titlebar / sidebar / main
                    ├── components/  # primitives (+ ui/ for shadcn)
                    ├── pages/       # one view per nav item
                    ├── lib/         # http client, ws, query, cn
                    ├── theme/       # ThemeProvider
                    └── styles/      # index.css (Tailwind v4 + Primer tokens)
```

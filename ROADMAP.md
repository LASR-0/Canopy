# Canopy — State & Roadmap

Open-source desktop app for managing indoor grow setups using **local** smart
devices (sensors, lighting, agricultural actuators). It discovers devices on the
LAN itself, visualises their data, and runs scheduled + reactive automations per
grow cycle and grow mode.

This document supersedes `HANDOFF.md`. It is the canonical record of decisions
and the current plan. **Read it before changing anything.** The project is
already scaffolded — never run a scaffolder or re-init; add dependencies with
`pnpm add` inside the right package.

Last verified against the code: **2026-09-25**.

---

## Primary platform: Linux

**Development happens on Linux from here on.** Windows and macOS remain release
targets, but Linux is where the work gets done.

The reason is practical: the project started on a Windows home PC, but that
machine now runs **Omarchy** (Arch + Hyprland/Wayland). The only remaining
Windows box is the work machine, which has **WSL2 (Ubuntu)**. Linux is therefore
the one environment available in both places — native at home, WSL2 at work.
Developing the Windows build would mean working two days a week.

This is a change of development host, not of architecture. Nothing on the
critical path is OS-specific: telemetry ingestion, the rules engine, the
scheduler and the remaining pages are all pure TypeScript. The genuinely
OS-divergent work — service registration and packaging — comes last and is
tracked as Phase 7.

**Windows is not abandoned.** It builds and runs today (verified), and the
Wi-Fi provisioning path already has a Windows implementation. Keep it green in
CI; don't regress it.

---

## Current state (verified, not aspirational)

`HANDOFF.md` had drifted badly out of date — it described the backend as
"skeleton stubs only", the HTTP library as undecided, and the Electron install
as blocked. All three were wrong. What follows was checked against the code.

### Working

- **Windows runtime is unblocked.** `electron.exe` and `better_sqlite3.node` are
  built; the backend boots and `GET /health` responds. The pnpm
  `approve-builds` issue is resolved (approvals live in `pnpm-workspace.yaml`
  under `allowBuilds`, not `package.json`).
- **Fastify** is the chosen HTTP/WS library and is fully wired
  (`api/server.ts`, 14 route modules registered).
- **Primer token set is ported** — `styles/index.css` is ~1,300 lines.
- **Overview** (`pages/Overview.tsx`) and **Settings** (`pages/Settings.tsx`)
  are complete and wired to real endpoints, with **no mock data**.
- **SQLite + Drizzle store** — 19 tables, DDL applied at startup.
- **Device discovery** — embedded Aedes broker, mDNS scanner, HA-style retained
  config discovery, Shelly announce, heartbeat monitor, scan sessions.
- **Tests** — 7 passing across 2 files. Thin, but green.

### Recently fixed (Phase 0)

- `pnpm typecheck` now passes across all three packages. It had been failing in
  `provision.ts`, and that failure was *masking* three further errors in the
  frontend (Web Bluetooth types, and a `null` assigned to an optional-not-
  nullable `activeWorkspaceId` under `exactOptionalPropertyTypes`).
- `provision.ts` had no Linux branch — it dispatched `darwin → airport` and
  *everything else* → `netsh`, so Wi-Fi scanning silently returned nothing on
  Linux. Added an `nmcli` scanner.
- A second controller instance now exits with a clear message instead of an
  `EADDRINUSE` stack trace.
- Build artifacts untracked, `.gitattributes` added — see "Two-machine
  workflow".

### Hollow — built UI over a pipe that never delivers

This is the headline. Overview and Settings are finished, but:

- **Nothing ever writes `readings_raw`.** `mqtt-discovery.ts` parses only
  `homeassistant/+/+/config` and `shellies/announce`. It never subscribes to any
  device's `state_topic`, so telemetry reaches the broker and is discarded.
- **No actuation.** `api/routes/devices.ts` actuate is a stub.
- **`scheduler/index.ts` and `rules/index.ts` are 3-line `export {}` files.**
  The automation engine does not exist.

The consequence: you can discover a device, assign its role and set a threshold,
and no number will ever appear on the Overview. **Close this gap before building
another page.**

### Stubbed routes

Return fabricated or empty data, not persisted: `automations`, `journal`,
`controller` (status is hardcoded `brokerOnline: false, deviceCount: 0`),
`events`.

DB-backed and real: `grows`, `workspaces`, `maintenance`, `devices`, `settings`,
`chart-layouts`, `thresholds`, `readings` (read path only).

### Placeholder pages

17–18 line "coming soon" shells: `Automation`, `GrowCycle`, `Journal`,
`Logging`, `Maintenance`, `SetupView`.

Note that **Maintenance already has a complete DB-backed backend** — only the
page is missing. It is the cheapest win on the board.

### Not started

- The **boot-level OS-managed service**, which the architecture calls a
  requirement. No systemd unit, no launchd plist, no Windows service, on any
  platform. `electron-builder.yml` is 18 lines of bare targets — no service
  registration, no signing.
- WebSocket has no per-workspace subscription filtering; `broadcast` is used
  only for device status and scan events. No `reading.live` push.

### Security note — decide deliberately

The MQTT broker binds `0.0.0.0:1883` **unauthenticated**, while HTTP binds
`127.0.0.1`. LAN-reachable is presumably intentional (devices must connect), but
anonymous write access to the broker means anything on the network can inject
readings or commands. Decide on this explicitly rather than by default.

---

## Roadmap

Ordered by dependency. Each phase unblocks the next.

### Phase 0 — Unblock ✅ done

Typecheck green, `EADDRINUSE` handled, Linux Wi-Fi scan added, git hygiene
fixed. See "Recently fixed" above.

### Phase 1 — Linux development environment

Get both machines productive. See the setup notes below.

- Clone fresh from GitHub on Omarchy (do not sync the OneDrive folder).
- Verify Electron launches under Hyprland/Wayland and `better-sqlite3` rebuilds.
- Configure WSL2 at work (mirrored networking, systemd, native filesystem).
- Add `pacman` to the electron-builder Linux targets for Omarchy.

### Phase 2 — Device simulator *(new, and load-bearing)*

A small MQTT publisher that impersonates a handful of HA-discoverable devices:
announces config topics, then emits plausible drifting telemetry.

This is worth more than its size. Real hardware lives at home, and **WSL2 cannot
see LAN multicast**, so without a simulator no meaningful backend work can
happen at work. It also makes the rules and scheduler testable in CI without
hardware. Build it before the pipeline, and the pipeline becomes verifiable the
moment it exists.

### Phase 3 — Telemetry ingestion *(the keystone)*

Subscribe to each discovered device's `state_topic`, normalise payloads to
`Reading`, persist to `readings_raw`, and push `reading.live` over the
WebSocket. Add per-workspace subscription filtering while you are in `ws/`.

The broker already receives every message, so this is a change to
`handleMqttMessage`, not an architectural one. **This single item makes the
Overview you already built come alive.**

### Phase 4 — Actuation

Real command path: route → adapter → MQTT `command_topic`. Make
`controller/status` report true broker and device state. Nothing in automation
can *do* anything until this lands.

### Phase 5 — Scheduler

Time-driven automations; the lighting photoperiod is the flagship feature. The
same module carries the internal jobs: hourly/daily rollups (which Logging
depends on), auto-archiving completed grows, and `VACUUM INTO` backups.

### Phase 6 — Rules engine

Condition → action evaluated against incoming readings. Write real rows to the
`events` table, which nothing currently populates.

### Phase 7 — Pages

In dependency order:

1. **Maintenance** — backend already done, cheapest win.
2. **Automation** — needs Phases 5 and 6.
3. **Logging** — needs Phase 3 plus rollups.
4. **Grow Cycle** and **Journal** — their routes are stubs; do the backend
   persistence first.
5. **Setup View** — last, being the least operationally urgent, but it is
   *designed* and no longer blocked.

All eight pages have a high-fidelity prototype to build from — see "Reference
material". There is no design debt on this phase.

### Phase 8 — Service install & packaging

The real cross-platform push, with everything else working:

- **Linux** — systemd system service (develop at home, verify under WSL2
  systemd at work).
- **Windows** — Windows service, registered by the NSIS installer with one-time
  elevation.
- **macOS** — launchd LaunchDaemon.

The rule from the original architecture still holds: **the service is never
spawned or owned by the UI.** Closing the window must never stop the controller.

---

## Two-machine workflow

The repo syncs through `origin` (`github.com/LASR-0/Canopy.git`), currently in
sync with `main`. Two hazards to clear first:

**Tracked build artifacts.** `packages/frontend/tsconfig.node.tsbuildinfo` and
`tsconfig.web.tsbuildinfo` are committed. They are regenerated on every build,
so they will produce spurious diffs and pointless conflicts every time you move
between machines. Add them to `.gitignore` and `git rm --cached` them.

**Line endings.** `core.autocrlf=true` is set on Windows and there is **no
`.gitattributes`**. Today that is survivable. It stops being survivable in
Phase 8, when shell scripts and systemd units enter the repo and arrive on Linux
with CRLF — `bad interpreter: /bin/bash^M`. Add a `.gitattributes` with
`* text=auto eol=lf` and force `*.sh` to LF now.

**Do not sync the OneDrive folder to Linux.** Clone fresh from GitHub.
`node_modules` is correctly gitignored, so each machine builds its own native
modules — which is exactly what you want, since `better-sqlite3` and Electron
are platform-specific binaries.

### Omarchy (home, native)

- Arch + Hyprland means **Wayland**. Electron defaults to XWayland, which is
  blurry on HiDPI. Set `ELECTRON_OZONE_PLATFORM_HINT=auto` for native Wayland.
- The window is already `frame: false` on non-macOS with a renderer-drawn
  titlebar, which suits a tiling WM — but verify dragging and the window
  controls behave under Hyprland.
- This is the machine with real hardware, so mDNS discovery and real device
  testing happen here.

### WSL2 (work)

- **Work inside the WSL filesystem (`~/`), never `/mnt/c`.** Native module
  builds and pnpm are dramatically slower there, and file watching is
  unreliable.
- **Default NAT networking blocks LAN discovery.** mDNS multicast will not reach
  WSL2, and LAN devices cannot reach the broker. Create `%UserProfile%\.wslconfig`
  with `networkingMode=mirrored` (Windows 11 22H2+; this machine qualifies).
  Even mirrored, treat multicast as unreliable — this is why Phase 2 exists.
- **Enable systemd** in `/etc/wsl.conf` (`[boot]\nsystemd=true`) so the Phase 8
  service unit can be developed and tested at work too.
- WSLg handles the Electron GUI; `--no-sandbox` may be needed.
- **Corporate TLS interception.** The work network MITMs TLS — the certificate
  served for `registry.npmjs.org` is issued by `CN=firewall.intern.ksb.com`, not
  by a public root. Windows git survives this because it uses the `schannel`
  backend and the Windows cert store, where IT installed `CN=KSB-Root-CA`.
  Inside WSL, git, pnpm, node and curl each use their own CA bundle and will
  fail with SSL errors until that root is trusted there too.

  Check before assuming either way:

  ```bash
  curl -sI https://registry.npmjs.org >/dev/null && echo OK || echo "TLS blocked"
  ```

  If it fails, install the root and point Node at it:

  ```bash
  sudo cp ksb-root-ca.crt /usr/local/share/ca-certificates/
  sudo update-ca-certificates
  echo 'export NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt' >> ~/.bashrc
  ```

  Never commit the certificate to this repo — it is site-specific, and a public
  repo is the wrong home for it.

---

## Architecture (unchanged)

The backend is a **long-running, OS-managed service**, independent of the UI.
This is a grow controller — a missed light or irrigation cycle harms plants — so
"runs when the UI is closed and survives a reboot" is a requirement.

- **Boot-level service**, registered by the installer with one-time elevation.
  Never spawned or owned by the UI; that single rule eliminates the
  child-process trap where closing the window kills the backend.
- The **UI is an unprivileged client**. It finds the backend via `GET /health`
  and connects over HTTP + WebSocket.
- Controller states are explicit: `running` / `paused` / `stopped`. "Stopped" is
  deliberate and distinct from "window closed".

**Two deployment shapes, one codebase:** single host (expected common case), and
headless (backend on an always-on box such as a Pi by the tent, UI across the
LAN). The HTTP/WS boundary exists from the start, so headless needs no retrofit.
The backend is pure JS — aedes, bonjour-service and better-sqlite3 all build on
ARM Linux — so a Pi target is a packaging concern, not a porting one.

---

## Stack & decisions

**Monorepo** — pnpm 11 workspaces. `pnpm install` at the root populates one
`node_modules` with per-package symlinks. Never `npm install` — the repo uses
the `workspace:` protocol, which npm cannot resolve.

- `@canopy/shared-types` — domain entities, the `ApiRoutes` HTTP contract, and
  the WebSocket `ServerMessage`/`ClientMessage` protocol. Both sides import it,
  so backend handlers and the frontend client cannot drift. This is the source
  of truth for every domain decision.
- `@canopy/backend` — the controller service.
- `@canopy/frontend` — Electron + React UI.

**Language** — TypeScript, ESM throughout. `tsconfig.base.json` is strict:
`verbatimModuleSyntax`, `exactOptionalPropertyTypes`,
`noUncheckedIndexedAccess`. (That last one is what the `provision.ts` break is.)

**Frontend** — Electron 42 + electron-vite 5 + electron-builder 26. React 19,
Vite 8. Tailwind v4 via `@tailwindcss/vite` (CSS-first, no JS config).
shadcn/ui on Radix, copied into the repo. TanStack Table for lists, Recharts for
the Logging charts, hand-rolled `Sparkline` inline. TanStack Query for server
state; **Zustand deferred** until the live WebSocket stream needs
selector-based subscriptions. The Electron main process is deliberately thin —
native window only.

**Backend** — Node service. SQLite via **Drizzle** (*Prisma rejected: its native
query-engine binary is painful in Electron*). Embedded **Aedes** MQTT broker
(pure JS). **`bonjour-service`** for mDNS (*avoid the native `mdns` package — it
needs a compiler and the Bonjour SDK, and breaks cross-platform packaging*).
**Fastify** for HTTP + WebSocket.

**Theme** — GitHub Primer tokens. Light and dark are structurally identical,
only token values differ, so theming is a pure CSS-variable swap on a
`data-theme` attribute.

---

## Device support (v1 scope)

Deliberately narrow: **local HTTP + MQTT only, no Home Assistant dependency.**
Canopy discovers and controls devices itself.

**Two discovery models:**

- **HTTP/Wi-Fi devices** advertise over **mDNS** and are actively found. A
  brute-force subnet probe is deferred to a later opt-in "advanced scan".
- **MQTT devices** are broker-mediated — they publish to the embedded broker and
  are found by watching topics. Canopy listens for the Home-Assistant-style
  retained discovery convention (`homeassistant/<type>/<id>/config`) to
  auto-populate devices *with their capabilities* — the convention only, not HA.

**Adapters** — one small adapter per family: Shelly, Tasmota, ESPHome,
generic-MQTT (fallback). Two transports does not mean two integrations.

**Device model** — `family` + `protocol` + detected `capabilities`
(sensor/actuator channels). **Roles** bind a capability to a functional purpose
("exhaust fan", "canopy temp"), so automations target a role, not a device id,
and hardware can be swapped without breaking rules.

**OS realities:** macOS Local Network permission for discovery; firewall
allowance for the broker port on every platform; WSL2 NAT as covered above.

---

## Features

Everything is scoped to a workspace (tent). The switcher scopes all data.

**Navigation:** Monitor (Overview, Setup View) · Manage (Automation, Grow Cycle,
Journal) · Service (Maintenance, Logging) · Config (Settings).

- **Overview** — sensor cards, sparklines, activity feed; empty and configured
  states derived from data.
- **Setup View** — visual tent layout (device, sensor, pot placement) to compare
  layouts across grows.
- **Automation** — capability-driven, organised by subsystem. Two kinds:
  **schedule** (time → scheduler) and **rule** (condition → rules engine).
  Scopable to a grow stage or mode.
- **Grow Cycle** — stages (seedling/veg/flower/flush/harvest); status machine
  `planned → active → completed | aborted`; harvest screen captures rating,
  yield and notes.
- **Journal** — live notebook for the current grow plus a history archive of
  completed grows, with cross-grow comparison.
- **Maintenance** — recurring reminders: sensor cleaning, filter swaps, nutrient
  top-ups, calibration; due-date tracking.
- **Logging** — sensor data over time, chart-heavy, per-workspace plus history.
- **Settings** — device connection, scanning, provisioning, role assignment.

**UX convention:** forms, confirmations and editing are **inline** (Primer /
GitHub style), not external modal dialogs, wherever possible.

**Retention** — tiered: keep `raw` about a week, roll up to `hourly` / `daily`
long-term. The live operational SQLite DB stays hot; a separate archive DB file
is opened on demand for completed grows, keeping the live DB and its backups
small. Rollups, archiving and `VACUUM INTO` backups run as internal scheduled
jobs (reusing the scheduler, not a separate cron).

---

## Reference material

- **High-fidelity prototypes** in `prototype/` — working React apps, not static
  mockups, already branded Canopy. Canonical reference for screens and
  components.
  - `SetupView_Configured_{light,dark}.html` (~268 KB) are the current full
    prototype and cover **all eight pages**. `Overview_Empty_light.html` is an
    older, narrower snapshot.
  - **Every page is designed** — including Maintenance (with Today / Week /
    History sub-views), Logging and Setup View, all three of which `HANDOFF.md`
    wrongly listed as pending. Most pages also have a designed empty state
    (`OverviewEmpty`, `AutomationEmpty`, `LoggingEmpty`, `MaintenanceEmpty`,
    `SettingsEmpty`, `SetupViewEmpty`).
  - There is no design debt left. Every remaining page can be built straight
    from these files.
- **`@canopy/shared-types`** — every domain decision, encoded as types.

---

## Commands

```bash
pnpm install          # root; populates node_modules for all packages
pnpm dev              # backend + UI together (parallel)
pnpm dev:backend      # controller only
pnpm dev:ui           # Electron UI only
pnpm typecheck        # all packages
pnpm test             # backend vitest suite
pnpm build:ui         # electron-vite build
```

Default ports: HTTP/WS `7001` (localhost), MQTT `1883` (all interfaces).

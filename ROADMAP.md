# Canopy — State & Roadmap

Open-source desktop app for managing indoor grow setups using **local** smart
devices (sensors, lighting, agricultural actuators). It discovers devices on the
LAN itself, visualises their data, and runs scheduled + reactive automations per
grow cycle and grow mode.

This document supersedes `HANDOFF.md`. It is the canonical record of decisions
and the current plan. **Read it before changing anything.** The project is
already scaffolded — never run a scaffolder or re-init; add dependencies with
`pnpm add` inside the right package.

Last verified against the code: **2026-09-29**.

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
tracked as Phase 8.

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
- **Linux runtime is unblocked.** `pnpm dev` launches the Electron window under
  Hyprland/Wayland on Omarchy. See "Electron on Linux" below for the two faults
  that had to be cleared.
- **Fastify** is the chosen HTTP/WS library and is fully wired
  (`api/server.ts`, 14 route modules registered).
- **Primer token set is ported** — `styles/index.css` is ~1,300 lines.
- **Overview** (`pages/Overview.tsx`) and **Settings** (`pages/Settings.tsx`)
  are complete and wired to real endpoints, with **no mock data** — and since
  Phase 3 they show live values rather than empty cards.
- **SQLite + Drizzle store** — 19 tables, DDL applied at startup.
- **Device discovery** — embedded Aedes broker, mDNS scanner, HA-style retained
  config discovery, Shelly announce, heartbeat monitor, scan sessions.
- **Device simulator** — a full tent's worth of HA-discoverable MQTT devices
  over loopback. See Phase 2.
- **Telemetry ingestion** — sensor readings reach `readings_raw` and the
  websocket. See Phase 3.
- **Actuation** — devices can be driven over MQTT, and the controller has a
  real pause/resume/stop lifecycle. See Phase 4.
- **Scheduler** — photoperiod windows and cron automations drive real hardware;
  reading rollups and retention pruning run as tracked jobs. See Phase 5.
- **Rules engine** — readings drive condition → action automations, with
  threshold alerts and device up/down recorded to the timeline. See Phase 6.
- **Broker publish ACL** — command topics are closed to MQTT clients, so nothing
  on the LAN can switch hardware. See "MQTT hardening".
- **All eight pages are built** and wired to real endpoints; the Setup View
  3D render is the one piece left, as Phase 9. See Phase 7.
- **Tests** — 359 passing across 20 files.

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

### Recently fixed — `useLiveReadings` held its own state

Two defects, one cause. The hook accumulated readings into a `useRef` that
nothing cleared and fetched its snapshot outside the query cache.

- **Switching workspace left the previous tent's sensors on the Overview.** The
  effect did re-run, but it merged the new tent's readings *into* the old map —
  and a tent with no readings returned nothing to merge, so the old values simply
  stayed. Only a remount cleared it, which is why navigating away and back showed
  the correct empty state. Every other page was fine because every other hook is
  a `useQuery` keyed by workspace.
- **The Overview refresh button did not refresh the readings.** It invalidates
  `["readings", workspaceId]`, and while the snapshot lived in local state that
  key matched nothing. Invisible with the socket up; after a dropped socket the
  numbers could not be recovered without reopening the app.

The snapshot now lives in the query cache under that key, and live pushes are
held per workspace and reset on change. The two are reconciled **by `ts` rather
than by precedence**, because neither source is reliably newer: a push beats a
snapshot taken before it, and a refetch beats a push left stale by a dropped
socket.

### The data pipe — now connected inbound, still open outbound

This was the headline: a finished UI over a pipe that never delivered. The
inbound half is closed as of Phase 3. Readings flow, so the Overview shows real
numbers. What remains:

- **Actuator state ✅ built** (see "Before Phase 9", A). Devices' echoes are
  held and shown on the Overview and in Settings.
- **Grow archives ✅ built** (see "Before Phase 9", D). The live database
  was already bounded by retention; what grows lost was hourly detail, which
  now moves into each grow's own archive instead of being pruned.
- **Derived metrics: VPD and DLI done.** VPD is computed on the ingest
  path and stored under `device_id = "__derived__"`, so the Overview's VPD card
  fills once the canopy roles are assigned. DLI is worked out from the canopy
  light's readings and never stored. See "Derived metrics" below.

### Stubbed routes

None. `journal` and grow `milestones` were the last two, and are DB-backed as
of Phase 7.

`events` is written by the scheduler, the rules engine, threshold checking and
the heartbeat monitor as of Phase 6. It still has no write route, which is
correct: events are recorded by the subsystem that caused them, not posted.

`automations` is DB-backed as of Phase 5, with trigger validation on write.

`controller` is fully real: `brokerOnline` and `deviceCount` since Phase 3, and
`POST /controller/command` honours pause/resume/stop since Phase 4.

DB-backed and real: `grows`, `milestones`, `journal`, `layout` (placements
and plants), `workspaces`,
`maintenance`, `devices`, `settings`, `chart-layouts`, `thresholds`, `readings`
(read and write paths).

### Placeholder pages

None. Setup View was the last; its 3D mode is a deliberate placeholder until
Phase 9.

**Maintenance, Automation, Logging, Grow Cycle, Journal and Setup View are built** (Phase 7). Their CSS was
ported wholesale from the prototype and resolves entirely against the existing
Primer tokens, which is the pattern to repeat for the remaining pages: the design
debt is zero, but the stylesheet still has to be carried across.

**Target ranges is its own page now** (Phase 7 item 7), not a modal on the
Overview. It is the one page with no prototype design behind it.

### Not started

- WebSocket has no per-workspace subscription filtering. `subscribe` /
  `unsubscribe` frames are parsed and then ignored, so every client receives
  every workspace's traffic. Harmless with one tent and one window; wrong as
  soon as there are two. Tagged Phase 6 in the source and deliberately left:
  the renderer never *sends* a subscribe frame, so server-side filtering today
  would be either inert or would cut the UI off from its own data. Both halves
  belong with the first multi-tent screen.
### Reading volume and query cost — measured, then optimised (before Phase 9, C)

Loading the 6H and 24H ranges is slow. Measured on the dev database rather than
guessed at, because the obvious diagnosis was wrong.

**The sample rate is not the intended one.** `SIM_TELEMETRY_MS` defaults to 5000,
so each channel should produce 0.2 readings a second. Measured over ten minutes:

```
vpd            19.97 /s     ← twice every other channel (fixed, see below)
canopy-temp     9.99 /s
canopy-rh       9.99 /s
… every other channel   9.99 /s
```

Roughly **50× the configured rate**: 807,263 raw rows over 6.34 hours, 127,233 an
hour, a 170 MB database, and a 7-day projection of ~21 million rows. Samples
arrive in bursts of a dozen within milliseconds carrying *different* values, so
they are independent publishers rather than one message ingested repeatedly — and
at least three `tsx src/index.ts` simulator processes were alive at once, orphaned
by watch-mode restarts. A third cause turned up in Phase 8 G: the
simulator started a new set of publish timers on every reconnect without
stopping the old ones, so each broker restart added another copy of the
fleet. Fixed. **Before changing the sample rate or the storage design,
kill the strays and confirm a single simulator gives 0.2/s.** The volume is
probably an artefact of the dev loop, not a property of the app.

**VPD was written at double rate.** `deriveFromReading` fired on the temperature
sample *and* the humidity sample, so it stored two rows per cycle when only one
input had moved. It now writes once per *complete* pair of inputs. Fixed.

**Where the time actually goes.** A 6H raw request scans ~85,000 rows per metric,
materialises all of them through Drizzle, and then `decimate` throws about 98 %
away in JavaScript. Nine metrics on screen means nine of those in parallel. The
fix is to decimate in **SQL** — a stride over `rowid`, or a bucketed
`GROUP BY` — so the rows never cross the boundary. The cap exists; it is applied
in the wrong place.

Two things to do when this is picked up: move decimation into SQL, and give the
chart cards a real loading state. The page currently holds the previous render at
reduced opacity, which is right for a refetch and says nothing on a first load.
Both done, 2026-10-02: see "Before Phase 9", C.

### Derived metrics — VPD, and DLI since "Before Phase 9", E

`device_id = "__derived__"` had been reserved since the first commit with nothing
writing it, which is why the Overview's VPD card was empty from the moment
telemetry started flowing. `device-manager/derived.ts` now computes VPD on the
ingest path and stores it like any measured reading, so rollups average it,
retention prunes it, the series route charts it and a rule can trigger on it —
none of them needing to know it was computed.

Its inputs resolve by **role**, not by metric: a tent has a reservoir temperature
probe as well as a canopy one, and deriving VPD from the reservoir would be a
confident, meaningless number. A workspace with no canopy roles assigned computes
nothing, which is correct.

It reports *air* VPD, assuming leaf temperature equals air temperature. Leaf VPD
is what many growers prefer, but the offset is a property of the canopy and the
airflow and is not derivable from two numbers — inventing a constant would produce
a figure that looks authoritative and is wrong by an unknown amount. A leaf-offset
setting is the honest way to add it.

DLI is the prototype's other derived metric. It needs PPFD integrated across each
photoperiod rather than a reading-to-reading function. Done since, without
storing it: see "Before Phase 9", E.

### Chart palette — adopted from the prototype

`METRIC_META` carried invented hexes that appear **nowhere** in the prototype,
which uses real Primer steps. That drift is why the old set failed contrast on the
light theme. The prototype's palette is now the app's, so Logging and Overview
agree and both sit on the design system.

Seven colours come straight from the prototype. `ph`, `ec`, `power` and
`water_level` are metrics it does not chart; those were stepped to Primer values
and checked with the validator for separation against the seven.

The palette cannot carry every metric on one plot, and the page does not pretend
it can. Under `--pairs all` the validator fails `vpd` against `humidity` for
protanopia (ΔE 0.4) and `ppfd` against `soil_moisture` for normal vision (ΔE 7.2)
— and both pairs are the prototype's own colours. Overlay therefore never relies
on colour alone: every line is labelled at its end and named in the legend. Stack
mode is the answer for many metrics at once — one lane each, one hue per lane,
nothing to tell apart. `lux` and `ppfd` are the same quantity in different units,
so a device reports one or the other and they are not expected to share a plot.

### MQTT hardening — Tiers 1, 2 and 3 done

The broker binds `0.0.0.0:1883` **unauthenticated**, while HTTP binds
`127.0.0.1`. LAN-reachable is intentional — devices have to connect — but
anonymous access means anything on the network can reach it.

That is two problems, not one, and they cost very different amounts to fix:
anything on the LAN can **switch hardware**, and anything on the LAN can
**connect and inject readings**. Splitting them is what made the first one
shippable on its own.

**Tier 1 — command-topic ACL ✅ done.** `broker/acl.ts` refuses any *client*
publish to a command topic. No connected client ever has cause to publish to
one: commands originate from the controller, and the controller does not publish
as a client. `publishToBroker()` calls `Aedes.prototype.publish`, which never
runs `authorizePublish` — aedes invokes that hook only from the client PUBLISH
path and the will path. So the rule needs no exception carved for the
controller, which is the reason it is safe to make it absolute.

The topic set is rebuilt from the devices table, because command topics are
declared by the device at discovery (`config.command_topic`, or the Shelly
prefix) and are not reconstructable from a device id. Forgotten devices are
**included**: forgetting a device stops Canopy talking to it, it does not unplug
it, and the "forget" button must not quietly open a hole. `refreshDeviceTopics()`
rebuilds the ingest index and the ACL together — refreshing them at separate
call sites would fail silently and in one direction, leaving a newly paired
device ingested but drivable from the LAN.

Overriding `authorizePublish` also replaces aedes' default, which is the only
thing refusing client writes to `$SYS`, so that check is carried across
explicitly rather than inherited.

Verified against a live broker with a real MQTT client: a publish to
`tent/fan/command` is refused and the connection closed, state topics, discovery
topics and unrelated topics are accepted, and `POST /devices/:id/actuate` still
lands on that same command topic.

**Tier 2 — authentication ✅ done** in Phase 8 F: one shared broker
credential, required on fresh installs, with the scan window as the only way
in without it. See Phase 8 F.

**Tier 3 — per-device credentials ✅ built** in Phase 8 G: a credential
per device, limited to that device's own topics, and pushed to Shelly over
its HTTP API. ESPHome and generic MQTT firmware still take it by hand. The
shared credential stays, as the "any device" login. See Phase 8 G.

**TLS** comes after v1, after Tier 3 and after the real-device testing that
follows Phase 9. Decided 2026-10-01; see "After Phase 9".

---

## Roadmap

Ordered by dependency. Each phase unblocks the next.

### Phase 0 — Unblock ✅ done

Typecheck green, `EADDRINUSE` handled, Linux Wi-Fi scan added, git hygiene
fixed. See "Recently fixed" above.

### Phase 1 — Linux development environment ✅ done at home

Omarchy is productive: a fresh clone builds, `better-sqlite3` compiles, and
`pnpm dev` opens the Electron window under Hyprland/Wayland. See "Electron on
Linux" below for what had to be fixed.

Still open, and neither is on the critical path:

- Configure WSL2 at work (mirrored networking, systemd, native filesystem).
- Add `pacman` to the electron-builder Linux targets for Omarchy.

### Phase 2 — Device simulator ✅ done

`packages/simulator` impersonates a tent's worth of HA-discoverable MQTT
devices: 8 drifting analogue sensors, 3 actuators, plus a Shelly Gen 1 announce
so the second discovery surface is exercised too. It connects **outbound** to
the embedded broker on loopback, so it needs no LAN multicast and works under
WSL2 NAT — which is the whole reason it exists.

Run it alongside the controller with `pnpm dev:sim`. Useful knobs:
`SIM_TELEMETRY_MS` (default 5000), `SIM_SEED` (same seed, same telemetry),
`SIM_ANNOUNCE_MS`. Actuator commands are reflected back as state, so Phase 4
has something to drive on day one.

Two invariants in `fleet.ts` are easy to break by accident — device dedup keys
off the first two topic segments, and a `device_class` outside
`SENSOR_COMPONENT_MAP` silently degrades to temperature. Both are commented
there. Since Phase 8 G a device is matched by `device.identifiers` first, so
the first matters only for firmware that sends none.

### Phase 3 — Telemetry ingestion ✅ done *(the keystone)*

Readings now reach `readings_raw` and the websocket, so the Overview shows live
values. Three parts:

- **Discovery records topics.** `state_topic` and `command_topic` are kept on
  the capability (`MqttTopics` in `shared-types`) instead of being reduced to a
  prefix. They are arbitrary strings chosen by the firmware and cannot be
  reconstructed later. Shelly announces carry no topics at all, so the adapter
  derives them from the documented Gen 1 layout. Capabilities are stored as
  JSON, so this needed no migration.
- **`device-manager/ingest.ts`** holds a topic index rebuilt from the devices
  table, and registers on the broker's message hook. It is deliberately **not**
  gated on a scan session: discovery only listens during a scan's 20s window,
  whereas telemetry must be ingested for the life of the service. The index
  reloads at startup and after any change to the device set, so forgetting a
  device stops its telemetry immediately.
- **Only sensor channels produce readings.** An actuator publishing `ON` counts
  as proof of life and refreshes the heartbeat, which until now was written but
  never called by anything.

Known limits, deliberately not addressed: payload parsing handles bare numbers
and a few conventional JSON keys, **not** HA `value_template` expressions; and
a sensor whose `device_class` is outside `SENSOR_COMPONENT_MAP` is recorded as
temperature/°C rather than rejected, so it now writes mislabelled rows instead
of nothing. Both want attention before real hardware.

Per-workspace WebSocket filtering was listed here and was **not** done — see
"Not started".

### Phase 4 — Actuation ✅ done

`POST /devices/:deviceId/actuate` publishes a real command. The path is
route → `device-manager/actuate.ts` → family adapter → broker.

- **Adapters encode, they do not publish.** Each family returns a topic and a
  payload; `actuate.ts` publishes it. That split is what makes the wire format
  testable without a running broker, and it matters because a wrong payload
  fails *silently* — the broker accepts it and the device ignores it.
- **The formats genuinely differ.** Home Assistant style takes `ON`/`OFF` (or
  whatever `payload_on`/`payload_off` declared) on the command topic, with
  brightness rescaled onto its own topic when one was declared. Shelly Gen 1
  takes lowercase `on`/`off`, and a dimmer's level as JSON on `.../set`.
  Tasmota and ESPHome share the HA encoder until one of them needs something it
  cannot express.
- **Ambiguity is refused, not guessed.** `ActuateBody.channel` is optional for
  a device with one actuator and required for a two-relay Shelly, where picking
  wrong would switch the wrong load.
- **202, not 200.** The command reached the broker; that is not the same as the
  device having acted. Confirmation is the device echoing state, which arrives
  through ingestion.

Discovery now also captures `payload_on` / `payload_off` /
`brightness_command_topic` / `brightness_scale`, for the same reason it captures
topics: the firmware chooses them and they cannot be reconstructed later.

**Controller lifecycle** also landed here. `POST /controller/command` honours
pause/resume/stop and pushes the new status over the websocket so every open
window agrees:

| State | Ingests | Actuates |
|---|---|---|
| `running` | yes | yes |
| `paused` | yes | no |
| `stopped` | no | no |

`paused` is the state to use while working in the tent — readings keep
accumulating and nothing turns a fan on behind you. Actuation attempts are
refused with `controller_paused` (HTTP 409).

The state is **in memory only**: a restarted controller comes back `running`.
That is the deliberate choice — a grow controller that silently stays stopped
across a reboot is the more dangerous default. Worth revisiting in Phase 8,
when the service starts at boot without anyone present.

Not done here: nothing records or reports **actuator state**. The device echoes
it on the state topic and ingestion treats it as proof of life only, because
there is no `ServerMessage` for it and no UI consuming one. Done since: see
"Before Phase 9", A.

### Phase 5 — Scheduler ✅ done

One interval in `scheduler/` drives two things that answer to different rules.

**Time-driven automations**, evaluated every tick against the *workspace's*
timezone, not the host's. Two trigger shapes, and the distinction is the main
design decision of this phase:

- **`window`** (new) is a *state*: "on 06:00, off 18:00" says what the tent
  should look like at any instant. Each tick derives the desired state and acts
  only when it differs from what was last applied. A controller that reboots at
  10:00 mid-photoperiod therefore re-derives the window and switches the lights
  on. A pure cron scheduler would have missed the 06:00 edge and left the tent
  dark all day, and "a missed light cycle harms plants" is the reason this
  service exists at all. Applied state is held in memory precisely so a restart
  re-applies rather than assumes.
- **`schedule`** (cron) is an *event*. It fires when an occurrence falls in the
  elapsed tick interval, and one missed during downtime stays missed —
  replaying a skipped irrigation pulse hours late is worse than skipping it.
  The first tick after a restart only establishes a baseline.

A window's `actions` describe the state *inside* it; outside, each action's
role is driven off. So the prototype's "on 06:00 · off 00:00 · 100%" card is one
automation, not two. Automations target **roles**, so the scheduler resolves
role → device + channel at fire time and hardware can be swapped underneath.

`cron-parser` is lenient in a way that matters here: an empty expression parses
as *every minute*, and a four-field one as every minute for a whole day. Field
count is validated before anything reaches it.

**Internal jobs** are rows in the `jobs` table, not timers, so a controller that
was off for a day resumes with everything due rather than restarting every
schedule from now. Implemented: `rollup_hourly`, `rollup_daily`, `prune_raw`,
`prune_hourly`, `vacuum`.

Two properties worth not breaking:

- **Rollups are idempotent.** Each deletes the buckets it is about to write.
  Re-running repairs a partial result rather than doubling it, which matters
  because the controller can be stopped mid-job. Both aggregate from
  `readings_raw`, never chaining daily off hourly: averaging an average is only
  correct when every hour has the same sample count, and a device dropping out
  for twenty minutes breaks that.
- **Pruning is guarded by the rollups.** Neither prune will delete past the
  point its downstream aggregate has actually reached, even when the retention
  window says it may. Deleting un-aggregated raw destroys it permanently. A
  stalled rollup now shows up as a growing database instead of silently missing
  history.

Lifecycle: jobs keep running while `paused` (aggregating is monitoring);
automations do not (acting is not). `stopped` halts both.

Not done here, and both deliberately: **`archive_grow`** needs the separate
archive-database design from "Retention" below (done since: "Before Phase 9",
D), and **`maintenance_check`**
cannot do anything useful while nothing accumulates device runtime hours. Both
job types are rescheduled rather than repeatedly failed.

### Phase 6 — Rules engine ✅ done

Condition → action, evaluated on the **ingest path** so a rule reacts to a
reading as it arrives rather than on a polling interval.

The hazard a rules engine has and a scheduler does not is **flapping**: a sensor
sitting on its threshold would toggle an extractor fan every few seconds, and
relays and compressors do not survive that. Two guards:

- **Edge-triggered.** Actions fire on the transition into the condition, not on
  every reading that satisfies it. The rule re-arms only once the condition
  lapses.
- **Dwell** (`forSeconds`). The condition must hold *continuously* for that long
  before anything fires, and the counter resets the moment it lapses, so a
  single noisy sample cannot trip a rule and a flapping one cannot accumulate
  its way to a firing.

Rule state is in memory: a restart re-arms everything rather than inheriting a
stale belief about the tent. Re-firing a correct action after a restart is safe;
skipping one because of remembered state is not. Rules are cached and reloaded
whenever an automation changes, so one the user just saved arms immediately.

**Threshold alerts** are the other half. A rule *does* something; an alert
*says* something, and the two must agree — so both judge a reading with the same
`evalThreshold`, which moved into `shared-types` for exactly that reason. The
frontend now re-exports it rather than keeping a second copy. `calcGrowStage`
moved with it, because thresholds are stage-scoped and the controller needs the
same answer the UI is displaying.

Alerts are edge-triggered per channel for the same reason rules are: a row per
reading that is still too hot buries the crossing that mattered. Recovery is
recorded too, so the feed's last word on a metric is not always alarming.

**The `events` table is now populated** from four sources: automation firings
(Phase 5 and 6), threshold crossings and recoveries, and devices going offline
and coming back. The Overview's activity feed has real content.

Shared `automation/apply.ts` holds role resolution, actuation and event
recording, used by both the scheduler and the rules engine. A feed where a
scheduled firing and a rule firing were described differently would be worse
than no feed.

Not done here: **per-workspace websocket filtering**, which the source comments
tagged Phase 6. The server side is easy; the reason it was left is that the
renderer never sends a `subscribe` frame, so filtering would either be inert or
would silently cut the UI off from its own data. It belongs with the first
multi-tent screen. See "Not started".

### Phase 7 — Pages ✅ done

In dependency order:

1. **Maintenance** ✅ done — Today / Week / History, built from the prototype.

   Three backend gaps surfaced while building it, all invisible until a screen
   actually used the data. Completing a task set `lastDoneAt` but never advanced
   `nextDueAt`, so a completed daily task stayed due forever and the completion
   looked like it had not registered; a skip did the same. There was no way to
   list completions, which History needs — a task carries only its *last*
   completion, so anything done twice or skipped was invisible. And there was no
   delete.

   `nextDueAfter` returns null for `stage` and `runtime` deliberately rather
   than inventing a date: a stage task is moved on by the grow, and a runtime
   task needs device hours that nothing accumulates. The Week view lists those
   under "Not on a date" instead of guessing them onto a day, and carries
   anything already overdue into Today — a task that fell due last week has a
   date outside the window, and dropping it would hide the one task most needing
   attention.

   "Needs attention" is derived from real state, offline devices and overdue
   tasks, rather than a separate health model.

2. **Automation** ✅ done — all three trigger kinds, grouped by subsystem.

   The grower is asked for a name, a trigger and the equipment to drive.
   `kind`, `subsystem`, `driver` and `controlRes` are derived from those, because
   asking would allow two answers that contradict each other — a "lighting"
   automation driving a pump — and the list would group itself wrongly with no
   way to tell which answer was meant.

   Cron is offered as "daily at a time" or "every N hours" rather than an
   expression field, with the generated cron shown beside it. A grower should not
   have to write `0 */6 * * *`, but hiding what got stored would make the
   shortcut a black box.

   Two gaps surfaced that only a screen could find. **A typed client could not
   release a manual override.** The PATCH route clears `overrideUntil` on an
   explicit null, but the body type was `Partial<Automation>` and those fields
   are optional-not-nullable, so under `exactOptionalPropertyTypes` no value
   existed that a caller could send — omitting the key means "leave unchanged".
   `AutomationPatch` now expresses the three clearable fields, and the Release
   button works. **And the role and metric catalogues were page-local**, so
   Settings and Automation could have disagreed about what a role is called;
   both now read `lib/roles.ts` and `lib/metrics.ts`, the same move that shared
   `evalThreshold`.

   `windowHours` treats equal on/off times as 24h rather than a zero-length
   window, matching the domain's note that equal times mean always on — a real
   24h seedling setting.
3. **Logging** ✅ done — ported from the prototype.

   One measurement shaped the whole page: the tent samples every few seconds, so
   raw is ~7,000 points **per metric per 2.7 hours**. A day of raw is ~25,000
   points a metric and a week is ~200,000, which is a multi-megabyte response the
   renderer cannot chart. The series route had no `ORDER BY`, no cap and no
   downsampling, so this was not polish — the page could not have worked.

   Four backend gaps, all invisible until a screen asked for the data:

   - **No ordering.** Rollup rows are written by a DELETE-then-INSERT whose order
     follows the `GROUP BY`, so a chart connecting them as they arrived drew a
     scribble rather than a line. Now ordered in SQL.
   - **Devices collapsed into one line.** The route filtered by metric and
     flattened every matching row into one array, so two temperature sensors
     interleaved into swings that were an artefact of the merge. `ReadingSeries`
     now carries one entry per (device, channel), with the device name resolved
     on read so a legend needs no second request.
   - **Raw over any real range.** `resolutionFor` upgrades a raw request past six
     hours to hourly or daily and reports what it actually used, and `decimate`
     caps each line at 2,000 points. Upgrading rather than refusing: the caller
     wants the range charted, and a coarser answer is useful where an error is
     not.
   - **Rollups stored only the average**, so a spike that tripped a threshold
     vanished into its hour. Buckets now carry `min_value` and `max_value`, and
     the chart draws the average inside a min–max band. On the real data this was
     not marginal: an hour reading `avg 24.4` was hiding a 23.2–25.9 °C swing.

   **Canopy had no migration path.** `applyDDL` is all `CREATE TABLE IF NOT
   EXISTS`, which does nothing to a database that already exists, so a column
   added to a CREATE reaches new installs only — the first write against an older
   database fails with "no such column". `applyColumnAdditions` guards each
   addition with `PRAGMA table_info`, additive and nullable only, idempotent like
   the rest of that file. It is deliberately not a migration framework; a
   `user_version` ladder belongs with Phase 8, where databases stop being ours.

   The backfill is **bounded by raw retention**, which is the subtle part: a
   re-roll deletes its range before rebuilding it, so resuming from the oldest
   bucket with null extremes would delete months of rollups it could not rebuild.
   The resume point is clamped to the *bucket containing* the oldest surviving raw
   sample — clamping to the raw timestamp itself left the delete boundary
   mid-bucket and inserted a duplicate alongside the original.

   **This page was built twice.** The first attempt was designed from first
   principles because `prototype/` lists three filenames and none of them says
   Logging — but "Reference material" above says plainly that the two SetupView
   files cover all eight pages, and `LoggingPage` is in them. Read that section
   before building a page.

   The port follows the prototype: an **Overlay / Stack** toggle, a **metric panel**
   down the left with Raw and Derived groups, a **stat strip** of avg/min/max per
   metric, **saved layouts** as chips, **night shading**, **target bands**,
   **out-of-range** marks, events on the plot, and CSV/PNG export.

   The chart is hand-rolled SVG, as the prototype's is and as `Sparkline` already
   was. Recharts had been added for the first attempt and is now removed: ~880 KB
   of bundle (2.01 MB → 1.13 MB) for something the design does in SVG, and it
   fights 86 px lanes, a hatch pattern and per-metric target bands rather than
   helping.

   Overlay is not a dual-axis chart in the misleading sense. Each metric declares
   an `axis`, and metrics sharing one are drawn against a single scale — humidity
   and soil moisture are both percentages and compare directly. Where the palette
   cannot separate every line, identity does not rest on colour: each line carries
   a direct end-label, and the legend names every metric with its value.

   Three places the port deliberately diverges from the prototype, all because the
   prototype had mock data and this does not:

   - **Night shading is read from the photoperiod automation**, not a hard-coded
     six-hour night. A window trigger driving the `light` role already states when
     the lights are on. With no such automation the option is disabled rather than
     guessing.
   - **Target bands come from `sensor_thresholds`** for the stage in force, via the
     same `thresholdFor` the Overview colours cards with.
   - **Points are placed by time, not by index.** The prototype spaced generated
     samples evenly; a real device that drops out for an hour would otherwise have
     that hour squeezed to the width of one sample, hiding the gap instead of
     showing it.

   Gridlines are solid where the prototype dashed them — a dashed grid reads as a
   threshold or a projection when it is neither, and the target bands are what
   should carry the dash. That is the one visual deviation.

   `chart-layouts` is now wired: the route had been DB-backed since the first
   commit with nothing reading it, and this is the screen it was written for.
4. **Grow Cycle** ✅ done — setup, timeline, stage steppers, abort and complete.

   **Stage-scoped automations now run only in their stage.** `grow/stage.ts`
   caches the active grow per workspace and answers `appliesInCurrentStage` for
   both the scheduler and the rules engine, so three subsystems read one answer
   rather than three copies drifting apart. Refreshed whenever a grow is
   created, started, re-planned or ended, so a change takes effect without a
   restart.

   The open question is decided: **a stage-scoped automation idles when no grow
   is running.** There is no stage for the scope to match, and running it anyway
   would make the setting a lie. Unscoped automations are unaffected, so the tent
   is not unmanaged, and the Grow Cycle page names the automations that are idle
   for this reason rather than leaving it silent. Thresholds keep their own rule:
   a stage band refines an unscoped default, so an absent grow degrades to the
   default instead of idling.

   Left for later, deliberately:

   - **The Automation page still has no stage control.** The engines honour
     `stage` now, so the control would be real, but it has not been added.
     Small, and the next thing to pull forward if it is wanted.
   - **The harvest report is not built.** Completing a grow records the actual
     stage weeks, but nothing yet asks for yield, rating or notes, and the
     `env*` summary fields are never compiled. Journal → History shows these as
     "—" rather than inventing them, so the page works now and will fill in
     once the report writes them.

5. **Journal** ✅ done — Current (activity graph, milestones, composer,
   notebook) and History (archive with a two-grow compare), from the prototype.

   **The day and the conditions are stamped by the server, once.** `growDay`
   and `growWeek` come from the grow's `startedAt` at write time, and any value
   in the request body is ignored; accepting them would let two clocks disagree
   about which day an entry belongs to. The environment snapshot is read by
   **role**, as VPD derivation is, so a reservoir probe is never stamped as air
   temperature. Readings older than **15 minutes** are not stamped: a sensor
   that dropped out an hour ago still has a "latest" value, and stamping it
   would put a confident, wrong number beside the note. The field is left empty
   and shows as "—".

   VPD is computed from the stamped pair rather than read from the derived
   series, so the three numbers on an entry always agree with each other.
   `computeVpd` moved to `@canopy/shared-types` so the composer's live preview
   uses the same formula (`derived.ts` re-exports it), the same move that
   `calcGrowStage` made.

   Three places the port diverges from the prototype, all because the prototype
   had mock data:

   - **The activity graph shows only what happened.** The prototype padded quiet
     days with invented activity. Here the shade is the number of entries that
     day, and a milestone reached lifts an empty day to the first step. The
     graph exists to show gaps, and fake activity would hide them.
   - **Photo entries are not offered.** Attachments need file storage and
     serving that do not exist, so offering the type would file a text note as
     "Photo" beside an "Attach photo" button that does nothing. An existing
     photo entry still renders.
   - **Milestones can be added, ticked and removed** from the Journal, and
     entries can be edited and deleted. The prototype only displayed them. An
     experiment's result is usually known a week after its hypothesis, so
     editing is what makes the experiment type work.

   History opens a finished grow's journal read-only in place of the prototype's
   "Open report", which links to the harvest report that does not exist yet.

   Milestone routes were stubs as well (no persistence, no delete) and are now
   real, scoped to the grow *and* the workspace. A `DELETE` route was added to
   `ApiRoutes`.

   **The sidebar counts are hard-coded** (`Journal 28`, `Automation 6`, …),
   left from the prototype. Harmless but wrong; wire them or drop them.
6. **Setup View — the 2D floor plan** ✅ done. The prototype's Layout mode,
   ported against real data, plus plants. The 3D view is split out to Phase 9.
   Decided 2026-09-29, and built that way:

   - **One tent per workspace.** The workspace is the tent, and that is the
     reason workspaces exist: each tent gets its own metrics. There is no
     multi-enclosure or room model. The enclosure is the `width_cm` /
     `depth_cm` / `height_cm` columns on `workspaces`, stored since the first
     commit with nothing writing them. The workspace PATCH now validates them.
   - **Size cap: 600 × 600 cm footprint, 300 cm tall, 30 cm minimum**
     (`ENCLOSURE_LIMITS` in shared-types). Out-of-range sizes are **rejected
     with a message, not clamped**: storing 600 when someone typed 800 would
     leave them believing the tent is 8 m wide.
   - **A resize rescales everything proportionally.** Each placement and plant
     keeps the same fraction of each dimension, in the same transaction as the
     resize, so a half-applied resize is impossible. Positions are stored as
     `REAL`, so resizing and resizing back returns everything to exactly where
     it was. The dimension fields commit on blur or Enter, never per
     keystroke: typing "150" over "120" passes through "1" and "15", and each
     would rescale the whole tent.
   - **Devices are placed on the plan**, as the prototype does it: drag in
     from the side list, or press +, drag to move, and set X / Y / Z in the
     editor. `device_placements` has one row per device per workspace.
     Positions are **clamped** to the walls rather than rejected, because a
     pin dragged hard against the edge lands a fraction outside it. A
     forgotten device's placement is hidden, not deleted, so re-adopting the
     device puts it back where it was mounted.
   - **Coordinates run from the back-left corner**, with y increasing toward
     the door. The prototype's comment said "front-left" while its plan drew
     y = 0 against the back wall. The drawing is what a grower sees, so the
     drawing wins.
   - **Plants are their own component.** Add as many as you like from the
     Plants panel, by + or by dragging onto the plan. Each has an optional
     label and a **pot size in litres**, picked from `POT_SIZES` (1–50 L,
     13 sizes). Each size records the pot's rim diameter and height, taken
     from a typical tapered round nursery pot and each within 10 % of its
     nominal volume. The plan draws the pot at its real diameter. Plants
     belong to the workspace, not to a grow.
   - **Facing is stored for every placement** (`rotation_deg`, 0 = toward the
     door, clockwise seen from above), so Phase 9 needs no migration. The
     plan offers it only for equipment, as eight compass points, and draws it
     as a tick on the pin.

   **Roles have one owner.** The pin editor's role select calls the same
   route as Settings. `rolesFor` and `roleChannel` moved into `lib/roles.ts`
   and Settings now uses them too, so the two screens cannot offer different
   roles or bind different channels.

   Not done:

   - **New items land mid-floor**, on top of each other when several are
     added with +. Dragging from the list places them where they are dropped.
   - **The plan does not show live readings.** A current value on each
     sensor pin is an obvious next step, and useful long before the 3D view
     exists.

7. **Target ranges** ✅ done — its own page in the sidebar (Manage), with a
   **Ranges · Alerts** toggle in the style of Setup View's Layout · 3D. The
   Overview's "Configure thresholds" link now opens it, and the modal is gone.
   Decided 2026-09-29.

   **Ranges** is the matrix a modal could not show: one row per metric, with
   **All stages** and the four stage columns side by side. Each cell edits in
   place, in a small editor that floats over its neighbours. The current
   stage's column is marked "now", and the one band judging readings right now
   has a green edge wherever it comes from: the stage override if one exists,
   otherwise the default. A stage cell with no override reads "↳ default". An
   override is cleared with ×, and the stage falls back to the default.
   Metrics come from what the sensors report, plus any metric with a stored
   band but no sensor, so a range left behind by a removed sensor can still be
   seen and cleared. Two sensors on one metric share one row.

   **Alerts** is new: per metric, whether crossings reach the activity feed,
   how wide the "drifting" shoulder is, and how long a worse reading must last
   before it is reported. Stored in `threshold_alert_settings`, one row per
   metric. Only metrics that differ from the default have a row, and the
   default (on, 10 %, immediately) is exactly how alerts behaved before.

   - **The margin is passed into `evalThreshold`**, which both the Overview
     cards (via `statusOf`) and the controller use, so a card and the feed
     still agree about what "drifting" means. It is capped at 40 %: at 50 % the
     two shoulders meet and no reading could ever be "ok". At 0 there are no
     warnings, only breaches.
   - **The delay holds back only a *worse* status.** A reading that recovers
     inside it is never reported, and warn-then-err is timed from the first
     worse reading. Recoveries are recorded at once, because a grower waiting
     on a fix wants to know it worked.
   - **Off silences the feed only.** The card still colours and Logging still
     draws the band, because the range is still the range. The status keeps
     being tracked while alerts are off, so turning them back on does not
     report a breach that has held for hours.

   Two backend gaps found by building it:

   - **Default bands could be duplicated.** The table's
     `UNIQUE (workspace_id, stage, metric)` does not cover the default band,
     whose `stage` is NULL, because SQLite treats NULLs as distinct. The modal
     avoided this only by reusing ids. The PUT now upserts by metric and scope,
     and uses the path id only for a new band.
   - **There was no `DELETE`**, so an override could be moved but never
     cleared. Added. The PUT also validates now: an inverted band or an
     unknown stage is a 400 rather than a row that alerts on every reading.

   **Pages can link to each other now.** `shell/navigation.tsx` exposes the
   Shell's page state as `useNavigate()`, because the Overview's link had no
   way to reach another page. It is a context rather than a router: there are
   nine pages and no URLs. The prototype's other cross-page links ("Open
   Automation", "Open Journal") can use it too.

Phase 7 is complete, apart from the small follow-ups noted under items 4, 5
and 6. Those, and a walk through the running app, feed Phase 7.5.

### Phase 7.5 — Polish & additions ✅ done, apart from I

**Checked by hand, 2026-10-02**: everything in B to G that shows on screen.
Left until there is a setup with real data, rather than the simulator's:
the exports and imports. That is the Logging report with its CSV and PNG,
the quick CSV and PNG buttons (D.4), the Journal's PDF (E.2), and the
`.canopy` export and import (F), including Electron's save dialogs.

Everything needed before Canopy becomes a service. Most of it is polish or
builds on pages that already work. Numbered 7.5 rather than renumbering, so
the many "Phase 8" references in this document stay true. Listed 2026-09-29
from a walk through the running app, and grouped by what each item touches.
The order inside a group is the suggested build order.

#### A. Bug — threshold alerts flap at the band edges ✅ done

The "random dotted lines" on the Logging chart are **event markers**: every
row in `events` is drawn as a dashed vertical line where it happened. The
controller was not restarting. The live database held **13,387
`threshold_alert` rows in about 21 hours**, against 15 automation firings.

The cause was **no hysteresis**. A reading sitting on a band edge crossed it
with sensor noise, and every crossing was recorded. Soil moisture at
44.7 / 45.0 / 46.4 / 46.7 % against 45–60 % went err → warn → ok → warn every
few seconds. Light power at 303–310 W against 300–350 W did the same across
its 5 W warning shoulder. Phase 7's delay setting holds back escalations
only, so it could not stop an ok ⇄ warn flap.

- **Hysteresis in `checkThresholds`, on the way back only.** A recovery counts
  when the reading clears the edge by `RECOVERY_DEADBAND` (5 % of the band
  width) *and* stays clear for `RECOVERY_DWELL_MS` (60 s). Both are needed:
  the deadband cannot know a sensor's noise (the light's 7 W swing is 14 % of
  its band), and the dwell alone would still flap every few minutes on a
  reading hovering just inside the edge. Escalations are unchanged. A test
  replays the live soil sequence and gets one alert where there were a dozen.
  This reverses Phase 7's "recoveries are recorded at once": they are now
  recorded once they hold, which is what made them trustworthy.
- **The chart no longer draws a line per event.** Markers closer than a few
  pixels merge into one with a count, and the hover tooltip lists what it
  holds. Event types are toggles in the chart's options bar (Automations /
  Alerts / Devices / Grow). **Alerts are off by default**, because the
  out-of-range marks already show when a reading left its band.
- **The chart fetches its own window.** It used the newest-200 feed, so a
  week-long range showed markers for the last few hours only. `GET /events`
  now takes `from`, `to` and `types`, which the Logs tab (D.1) will need too.
- **Events have a retention policy**: `event_retention_days` (default 90,
  7–365), a daily `prune_events` job, and a slider in Settings → Data &
  Storage. There is no rollup to protect, so it is a plain cutoff. The 13,387
  flapping rows were deleted from the dev database, after a backup.

#### B. Layout & sizing ✅ built — awaiting a hands-on check

1. **Minimum window 1100 × 700** (was 960 × 600), set on the `BrowserWindow`.
   At 960 the content area beside the sidebar was about 710 px, which the
   Overview's stage chips, the Setup View plan and the Target ranges matrix
   (which overflowed) did not fit. 700 tall still fits a 1366 × 768 laptop
   with its taskbar. **Content stops at 1600 px** (`--content-max`) and
   centres on wider screens, with the header row aligned to it.
   `PageBody` replaces the two scroll-container patterns the pages had grown,
   so padding and max width are set in one place.
2. **The two SVG views draw at their real pixel size.** The Logging chart and
   the Setup View plan each drew into a fixed viewBox scaled to fit, so their
   text scaled with the window: huge at 2560, unreadable at 960. The chart
   also used `preserveAspectRatio="none"`, which squashed text and made
   labels collide. Both now measure themselves (`useElementWidth`, a
   ResizeObserver) and draw in that width, so text stays at its CSS size and
   only the plot grows. The plan's height follows its width, between 380 and
   760 px.
3. **Settings re-layout** as asked: Notifications, Preferences and
   Workspaces down a 320 px side column. Connection and Discovered devices
   fill the main column, and the device cards now fit as many across as the
   column allows, not a fixed two. Device roles and Data & Storage run full
   width underneath, with the retention rows flowing into columns. The side
   column no longer collapses below a 1200 px viewport, which was above the
   new minimum.
4. **Overview stage indicator** replaced. Each fixed-width chip clipped
   "Flowering", and the current stage's progress bar, 0 % full on day 1,
   left a stray dot under "Seedling". It is now the Grow Cycle timeline in
   miniature: segments sized by planned weeks, the current stage filled, and a
   "today" line. Stage colours moved to `STAGE_DEFS` in `lib/growStage.ts`,
   shared with Grow Cycle and Journal.
5. **Logging stat cards**: the unit moved beside the metric name, where it
   no longer wraps. Values size to the card (a container query) and truncate
   with the full value on hover only as a last resort. Minimum card width is
   now 200 px.
6. **Refined after a hands-on look:**
   - **The Overlay chart ends level with the metric panel.** The row is as
     tall as the panel, the chart box stretches to it, and the lane is drawn
     to fill the measured space. The SVG is taken out of flow, so its height
     cannot feed back into the size it is drawn from. Stack mode keeps its
     natural height, one fixed lane per metric.
   - **`--content-max` is 1920 px**, up from 1600. At 1600 a 2560 screen left
     the chart short and wide, with wide empty margins either side.
   - **The Settings workspace form is one width.** The three buttons set it,
     and Name and Timezone match exactly (`width: 0; min-width: 100%`), with
     space above the section. The form, with its name and "active" header,
     centres in the side column rather than sitting at its left edge.
7. **Also fixed**: the Logging metric panel dropped under the chart below
   1100 px, which is now the minimum, so it stays beside the chart and
   narrows. Long MQTT topics in Settings' device cards run into the badges
   no longer.

#### C. Consistency ✅ built — awaiting a hands-on check

1. **One delete-button style everywhere** ✅, modelled on the workspace delete
   in Settings, including its red hover. `components/DeleteButton.tsx` is a
   ghost button that turns red on hover, and it now **confirms before it
   deletes**: the first click arms it (it stays red and asks "Are you sure?"),
   and a second click deletes. Moving focus away, or five seconds, disarms it.
   Deleting an automation, a maintenance task or a device used to take one
   click. `countdown` adds the workspace delete's three-second traced ring,
   which a third click cancels. It is used for Settings' "Forget all",
   which had no confirmation at all, and (since G) for deleting a workspace
   for good from Recently deleted. Without a label
   the button is a trash icon that widens to "Delete?" when armed. It replaced
   the icon buttons on device cards, automations, maintenance tasks and journal
   entries (the Journal's own Delete entry / Keep pair went with it). The
   small "×" clears inside chips and cells (milestones, target-range cells, an
   automation's action rows) are left as they are. They remove one value
   rather than a record, and already turn red on hover. The Automation card's
   edit button is now the Journal's pencil. The gear it used drew like a sun.
2. **Tooltips** ✅: `components/Tip.tsx`, on Radix Tooltip, replaces the
   browser's native `title` popups. Those waited about a second, ignored the
   theme and could not be styled. It uses the Logging chart tooltip's surface
   at label size, opens after 400 ms, and skips the delay when moving between
   tips. 44 were converted; the other `title=` props in the app are page
   headings and empty states. Empty `content` renders the child alone, so
   conditional tips need no branch. A disabled button gets no pointer events,
   so `Tip` wraps it in a span that carries the tip. Those are often the tips
   that say why the button is disabled ("Cannot delete the only workspace").
   Watch for layout rules that target the button itself (see `.au-action`).
3. **A better time input** ✅: `components/TimeField.tsx` replaces the native
   `<input type="time">` in the Automation form (window on and off, and a
   daily schedule's time). The native one's look and picker come from the OS.
   Hours and minutes are separate segments. You type into them ("0730" fills
   both and moves across on its own) or step them with the arrow keys. A
   click opens a grid of the 24 hours and five-minute steps, and picking a
   minute closes it. Other minutes are typed. The value is still `"HH:MM"`,
   24-hour.
4. **Sidebar icons** ✅: Settings takes the sliders icon Setup View used,
   Maintenance is a wrench (its old circle-with-rays was nearly the sun), and
   Setup View is the cube its page already uses for the enclosure.
5. **Theme toggle** ✅: the gear in the sidebar footer, which duplicated the
   Settings nav item, is now a light / dark toggle. It shows where a click
   goes: a sun in dark mode, and a moon (new) in light mode. A click sets an
   explicit theme, so a "System" preference becomes Light or Dark. The theme
   provider now re-renders when the OS theme changes, which it did not before,
   so the icon stays correct under "System".
6. **Titlebar controls** ✅, decided 2026-09-29. All of them were dead.
   - **Refresh** re-fetches the queries mounted now, which are the current
     page's and the shell's (`refetchQueries({ type: "active" })`). The icon
     spins until they are back. The Overview's own refresh button, which
     duplicated it, is gone.
   - **Bell** opens the recent notifications from every page (see 7), with
     the unseen total on the bell. Opening it marks everything seen, but the
     items that were new stay dotted until it closes. Clicking one opens its
     page, and lands on the automation, task or device it is about.
   - **Search** is a palette (`shell/SearchPalette.tsx`) opened from the box
     or with Ctrl+K (⌘K on a Mac). Its scope is pages, devices, automations,
     maintenance tasks, and the active grow's journal entries. Matching is
     plain substring, ranked start, then word start, then anywhere. Empty, it
     is a page switcher. Picking a result opens the page and scrolls to the
     item with a brief outline. The navigation context now takes an optional
     `focusId`, and the Shell brings `[data-search-id]` into view once it
     renders. The keyboard-first side stays with I.
   - **The profile avatar ("L") is gone.**
   - **Also**: the Overview's "New automation" button had no handler. It
     opens the Automation page now.
7. **Sidebar badges count what you have not seen** ✅. The hard-coded numbers
   (6, 28, 2, 8) are gone. A page shows a badge only while it has unseen
   notifications. Decided 2026-09-30: **alerts only**. Routine activity never
   counts, because a badge that climbs daily while nothing is wrong teaches
   the grower to ignore it.
   - **Which page owns what** (`backend/src/notifications`): *Logging* takes
     threshold alerts at warn or err (a recovery is not news). *Automation*
     takes failed runs and failsafe trips. *Maintenance* takes tasks falling
     due. *Settings* takes devices going offline. Grow Cycle and Journal
     have none.
   - **Two new event types.** `automation_failed` is recorded when a device
     refuses or cannot be reached. It is recorded once per automation, role
     and device until that target next succeeds, because a failing window
     automation retries every tick and would otherwise write one event a
     minute. `maintenance_due` is recorded once per due date, only for tasks
     with their bell on (`due_notified_at` holds the due date announced). The
     scheduler checks every tick, because a task falls due at its own time of
     day.
   - **Failsafe trips have no source yet.** `failsafe_trip` has been a
     declared type all along, but no automation can have the failsafe
     subsystem and nothing writes one. The channel counts them once they
     exist.
   - **"Seen" is one timestamp per workspace and page** (`notification_seen`),
     not a flag per event. A page never marked seen counts back 7 days, so an
     upgrade does not open on months of history. `GET /notifications` returns
     the counts and the 30 most recent; `POST /notifications/seen` takes the
     channels, or none for all, and answers with the new summary. The frontend
     polls every 15 s and clears badges optimistically.
   - **Marking seen**: resting on a nav item for half a second, being on the
     page (including what arrives while you are there), or opening the bell.
   - **Seen in the live data**: soil moisture still moves between warn and
     err every minute or two. A's hysteresis delays recoveries only, and
     moves between warn and err are escalations and de-escalations it does
     not hold back, so they fill the Logging badge. Worth a look before
     Phase 8.
8. **Automation page** ✅: collapsible sections per subsystem, as in the
   prototype, whose `.auto-sec` styles were already in `index.css`. Each
   header has the subsystem's tinted icon, how many automations it holds, and
   how many are on or held. Sections are open by default, and the ones a
   viewer closes are remembered in browser storage. That is a per-viewer
   convenience, and the page works without it. A new automation opens the
   section it lands in. A closed section's cards stay rendered, only hidden,
   so search can still reach one: the Shell sends the closed ancestor
   (`[data-collapsed]`) a `reveal` event, and it opens before the scroll.

#### D. Logging becomes the record ✅ built — awaiting a hands-on check

1. **Tabs on the Logging page** ✅: *Graph* (the chart), *Logs* and
   *Activity*, in the page header like the Journal's. Decided 2026-09-30:
   **Logs is the problems, Activity is everything.**
   - **Logs** (`pages/logging/LogsTab.tsx`, `GET /logs`) is one table over a
     window of 24H, 7D, 30D or 90D, filtered by kind (out of range,
     automations, devices, maintenance) and by metric. Threshold alerts are
     **folded into out-of-range periods**, one row per excursion. A period
     runs from the first alert on a channel to its recovery and shows its
     worst level, duration (or "ongoing"), device and channel, and it expands
     to the steps inside it. The controller builds the periods
     (`backend/src/logs`), reading 7 days before the window so a period that
     began earlier keeps its real start. Failed runs, failsafe trips, devices
     going offline or coming back, and tasks falling due are listed as they
     are. On the live data, 24 hours of flapping alerts became 54 rows.
   - **Activity** (`pages/logging/ActivityTab.tsx`) is the full record,
     newest first, grouped by day, filtered by event group and paged 100 at a
     time. `GET /events` takes a `before` cursor, so a page boundary never
     repeats a row.
   - **Events have a `metric` column**, filled for threshold alerts from now
     on. Older rows read it from their description, which always starts with
     the metric. Descriptions are shown with the metric's label ("Soil
     moisture 44.9%…", not "soil_moisture 44.9%…") everywhere events appear.
   - **Pages can open a tab**: `navigate(page, { tab })`, read with
     `useTabRequest`. The search palette's `focusId` moved into the same
     options.
   - **Fixed on the way, a restart left alert periods open for good.** The
     threshold checker kept each channel's status in memory, so after a
     restart a channel that had been out of range came back as "never left",
     and its recovery was never written. A restart while it was still out of
     range wrote the crossing twice. Each channel is now seeded from its last
     recorded alert the first time it reports (`rules/threshold-history.ts`).
   - **Fixed on the way, the controller stalled for seconds at a time.**
     `GET /readings/latest` ran a GROUP BY over every raw reading: 2.2 s
     against 1.7 million rows, during which better-sqlite3 (synchronous)
     blocked every other request, ingest included. A page asking twice froze
     the API for about 7 s. The latest reading per channel is now kept in
     memory at the two insert sites (`device-manager/latest.ts`), seeded
     once per workspace. A new index, `idx_readings_raw_latest`, brings that
     seed down to 0.2 s. It is built on the first start after this change,
     which takes a few seconds on a large database.
   - **Fixed on the way, the sidebar could flood the controller.** Marking a
     page seen is optimistic. When the request failed, the badge rolled back,
     which fired the request again in a tight loop (133 requests in 4 s while
     the controller was unreachable). It now tries once per page and newest
     notification.
2. **Overview previews** ✅: a *Problems* section under Devices shows the
   five newest rows of the Logs tab for the last 24 hours, with an ongoing
   count and "Show all" into Logs. The activity feed in the Overview's side
   column already is the activity preview, so it gets "Show all activity"
   into the Activity tab rather than a second copy at the bottom.
3. **Chart templates** ✅: a saved layout now holds how the chart is drawn,
   not only which metrics: Overlay or Stack, the night, targets and
   out-of-range options, and which event markers show (`view`, stored as
   `chart_layouts.view_json`). Decided 2026-09-30: **not the time range**,
   so applying "Root zone" keeps whether you are looking at today or last
   month. Layouts saved before this apply their metrics only. Changing the
   mode, an option or a marker group leaves the template, as toggling a
   metric already did. The UI calls them templates now.
4. **Export** ✅: a **Report…** button on the Graph tab opens the report
   generator (`pages/logging/ReportModal.tsx`). You pick a window (24 hours,
   7 days, 30 days, this grow, or custom dates), the metrics, and a
   resolution (raw, hourly or daily). It exports as:
   - **CSV data** (`GET /readings/export`): long format, one row per reading
     (timestamp, metric, unit, value or average/min/max, device, channel),
     because raw readings from different devices share no timestamps. It is
     written a page of 5,000 rows at a time, yielding between pages, so a
     large export never stalls the controller. On the live data, a week of
     raw readings (1.7 million rows, 113 MB) took 6 s, and the API answered
     within 150 ms throughout. It downloads natively, so Electron streams it
     to disk instead of holding it in the renderer. Raw readings are kept 7
     days by default, and the generator says so when a window reaches
     further back.
   - **PNG report**: decided 2026-09-30, **a composed sheet**. Title (tent
     and grow), the window and resolution, a card per metric with average,
     min and max, then the chart. It is drawn on a canvas in the theme's own
     colours, and a live preview in the dialog shows what will be exported.
   - The quick **CSV** and **PNG** buttons stay, for the chart as shown.
   - **Fixed on the way, the PNG export's text was black.** The chart SVG
     takes its colours from CSS variables and its text styles from
     stylesheet classes, and neither survives serialisation, so every label
     came out black on the dark surface. Computed styles are now copied
     inline before rasterising (`svgToImage`).
   - **Fixed on the way, a date went missing on 7D and 30D.** Ticks were
     evenly spaced, so seven across seven days fell 28 h apart and one date
     never showed. Day-scale ticks now sit on local midnights.
   - The chart and its helpers moved out of `Logging.tsx` into
     `pages/logging/chart.tsx`, which the Graph tab and the report share.
   - Custom report dates use the native `<input type="date">`. Only the
     time input was replaced in C.3.

#### E. Journal ✅ built — awaiting a hands-on check

The notebook stays one long log in day order, as in the prototype. Day
navigation was planned here on 2026-09-30 and dropped the same day.

1. **Photos on every entry type** ✅. Every entry form has "Add photos",
   the "Photo" type is back in the composer, and an entry of only photos is
   valid. It is titled by its first caption, or "Photo" / "Photos".
   - **One photo is a Polaroid. Several are a carousel of Polaroids** with
     arrows, dots, a "2 / 5" count, and arrow keys when focused. The frame is
     white in both themes, since a Polaroid is white. The picture is square,
     as the originals were, so portrait and landscape shots sit the same
     size. The caption is written in the deeper bottom band. A click opens
     the whole photo, uncropped, in a lightbox with its caption, arrows and
     Esc.
   - **In the composer**, photos show at once from a local preview and upload
     in the background. Each gets a caption, can be reordered by dragging or
     with the arrow buttons, and can be removed. Photos can also be dropped
     anywhere on the composer. Saving waits for uploads still running.
   - **The renderer shrinks each photo before upload**: long edge 2400 px,
     JPEG at 85 %. A phone original is several megabytes, and the controller
     may be a Pi on Wi-Fi. Re-encoding also strips the metadata, location
     included, and applies the camera's rotation. The controller stores the
     bytes as sent, so it needs no image library, and it checks the file's
     signature rather than trusting its content type. HEIC cannot be read by
     Chromium; the composer says to export it as JPEG.
   - **Storage** (`grow/journal-photos.ts`): files in
     `data/attachments/journal/`, rows in a new `journal_photos` table. A
     photo is uploaded before its entry exists (`POST /journal-photos`, the
     image bytes as the body, with no multipart dependency) and is attached
     when the entry is saved. A create or edit names the entry's photos in
     order, with captions, and any left out are deleted. Files are served at
     `GET /journal-photos/:id` with a permanent cache, since an id never
     names different bytes.
   - **Cleanup**: deleting an entry deletes its files. A daily
     `prune_attachments` job removes uploads never attached within a day,
     and files nothing points at, which is what a deleted grow or workspace
     leaves behind, since the database cascade cannot reach the disk.
   - The unused `attachments_json` column is left in place for older
     databases.
2. **PDF export** ✅: "Export PDF" in the Journal header, for the current
   grow or one opened from History. It is Electron's `printToPDF` of the page
   itself (`lib/pdf.ts`), A4, so the PDF matches the screen without a second
   layout. For the render the page switches to the light theme and loads
   every photo, since lazy images below the fold would print blank. Print
   styles leave off the titlebar, sidebar, composer and every control, let
   the notebook run across pages instead of scrolling inside the window, and
   lay each entry's photos out side by side instead of as a carousel. Two
   IPC steps, render then save, so the app is back to normal before the save
   dialog opens. Only the print layout was checked here (headless Chromium,
   which renders it the same way); the save dialog needs a run in Electron.

#### F. Database import / export ✅ built — awaiting a hands-on check

Decided 2026-09-30: **export is everything, and import adds**. An import
brings a file's workspaces in beside yours, with their grows, journal,
photos, automations, devices and history, and replaces nothing. It loads
straight away, with no restart. Both live in Settings → Data & Storage.

1. **Export** (`GET /data/export`, `data/export.ts`): one `.canopy` file, a
   gzipped tar of a manifest, a database snapshot and every journal photo.
   It opens in any archive tool once renamed `.tar.gz`. The snapshot uses
   SQLite's online backup API: consistent while the controller writes, and
   copied a few pages at a time rather than in one blocking statement. The
   tar reader and writer are ~150 lines (`data/tar.ts`), so there is no
   archive dependency. It downloads natively, so Electron streams it to
   disk. On the live data, 609 MB of database became a 55 MB file in 16 s,
   with the API answering throughout (one probe at 233 ms).
2. **Import, in two steps** (`data/import.ts`), in a modal like
   provisioning's (choose file → review → import):
   - **Stage.** The upload streams to disk. Only the entries an export
     writes are unpacked, and no name from the archive is used as a path. It
     must be a Canopy export this version can read (a newer version is
     refused with "update Canopy") holding an intact database, which is then
     brought up to the current schema the same way the live database is on
     start. The review lists the file's workspaces with their counts, and
     archived ones start unticked. A name you already have becomes "Tent 1
     (imported)". Devices whose hardware is already here are counted.
   - **Apply.** The staged database is attached and the chosen workspaces
     are copied in with **new ids**, every reference between rows remapped,
     so a file can be imported twice, or into the controller it came from,
     without colliding. Everything but the readings goes in one transaction.
     Readings are copied 5,000 at a time, yielding between batches, so ingest
     and the API carry on. On the live data, 2.04 million readings took
     12.5 s, with the event loop's p99 stall at 68 ms. The photos are copied
     under their new ids. Afterwards the new workspaces are loaded into the
     controller's caches (device topics, derived roles, rules, thresholds,
     active grows), which is why no restart is needed. A failure removes
     whatever went in. Imported history does not light the badges.
3. **A device already here stays where it is** (decided 2026-09-30). An
   imported device whose MQTT topics belong to a device here is copied with
   its workspace's history, roles and placement, but **detached**
   (`devices.detached_at`): the topic index leaves it out and actuation
   refuses it, so readings and commands never go to two places. Its card
   says "detached", with the reason on hover. Other imported devices are
   live and start offline until the heartbeat hears from them.
4. **Fixed on the way, tests opened the dev database.** The DDL helpers
   moved to `store/ddl.ts` and the data paths to `store/paths.ts`, so code
   working on another database (a test's, a staged import) no longer opens
   the live one just by importing the store.
5. **Fixed on the way, `.gitignore` hid a source folder.** Its bare
   `data/` rule, meant for the controller's data folder, also matched
   `backend/src/data/`, so the export and import code would never have been
   committed. The rule is anchored to `/packages/data/` now.
6. **Still to check by hand**: Electron's save dialog for the export
   download, which the headless checks cannot reach.

#### G. Workspaces: archive and recently deleted ✅ built — awaiting a hands-on check

Before this, a workspace's **Delete and Archive buttons did the same thing**
(set `archived`), nothing showed an archived workspace or brought one back,
and **archiving stopped nothing**: the scheduler, rules, alerts, ingest and
heartbeat never looked at the flag, so an archived tent's lights kept
switching.

1. **Archive** puts a workspace away indefinitely, restorable at any time,
   with its history kept whole.
2. **Delete** moves it to **Recently deleted**, restorable for **7 days**
   (`WORKSPACE_RESTORE_DAYS`, fixed). A daily `purge_workspaces` job then
   removes it with everything under it. Readings have no foreign key and can
   run to millions, so they go in batches of 5,000 that yield; the rest
   cascades, and photo files are removed by hand. Deleting a live workspace
   no longer uses the countdown, since it can be undone. The countdown moved
   to **Delete now** in Recently deleted, which cannot.
3. **Put away, the controller does nothing for it.** Its devices leave the
   ingest topic index, so no readings are recorded, and with no readings no
   thresholds are judged, no rules fire and no VPD is derived. The scheduler
   skips its automations, the heartbeat raises no offline alerts for it, and
   no maintenance falls due. These are the choke points, so the rules and
   threshold caches need no filter of their own.
4. **Devices are held, idle, until a restore** (decided 2026-09-30). Their
   hardware is free meanwhile: another workspace can scan and find it.
   Restoring re-checks the claims (`device-manager/claims.ts`, shared with
   import), and a device whose hardware another live workspace now holds
   comes back **detached**, history intact. Settings says so after a
   restore.
5. **One live workspace always remains**, since the app needs one to open.
   Putting away the active workspace moves the app to another. Both are
   enforced on the controller as well as in the UI.
6. **Settings → Workspaces** has two collapsed lists under the live ones:
   *Archived* (each with its date and Restore) and *Recently deleted* (each
   with the days left, Restore, and Delete now).
7. **Schema**: `archived_at` and `deleted_at` timestamps. The old `archived`
   flag is left unused. Databases that had it set are migrated as archived,
   since both buttons set it. Import leaves out a file's recently deleted
   workspaces and keeps its archived ones archived.
8. Routes: `GET /workspaces` (live), `GET /workspaces/stored`,
   `POST /workspaces/:id/archive`, `POST /workspaces/:id/restore`,
   `DELETE /workspaces/:id` (to Recently deleted),
   `DELETE /workspaces/:id/permanent`. Each reloads the controller's
   workspace caches (`controller/reload.ts`, shared with import).

#### H. Grow stages in Automation and Maintenance ✅ done

Decided 2026-09-30. Both pages had stage support that could not be used.
Automations had a `stage` field the engines respected but no editor field
for it. Maintenance's "By stage" cadence never fell due: `nextDueAfter`
returned nothing for it and nothing watched stage changes.

1. **Automations run in any set of stages** (`stages`, stored as
   `stages_json`). Empty means every stage. The old single `stage` carries
   over as a one-stage list. The editor has a **Runs in** field (*Every
   stage*, or any stages ticked), and a card shows its stages as tags. The
   engines ask `appliesInCurrentStage` with the list. A scoped automation
   idles outside its stages, and while no grow runs, as before.
2. **The prototype's Growth mode strip, at the top of Automation**, with
   the prototype's own styles. Its four mode cards are the grow's stages,
   each with its icon and its weeks in the plan ("weeks 9–14"), the current
   one marked "now". An **All stages** card sits in front; the prototype had
   none. Picking a stage shows *Only in Flower* (the automations scoped to
   it), then *Every stage* (the rest), each grouped by subsystem as usual.
   "New automation" defaults to the stage picked. Where the prototype showed
   fixed "bundled targets", the panel beside the cards shows the real target
   ranges in force for that stage (its own band, else the default), as
   icon-and-range chips named on hover, with a link to Target ranges. With
   no grow running and scoped automations present, it says they are idle.
3. **"Copy to stage…"** on each card makes a scoped copy, named "… (Flower)",
   and opens it in the editor. **Copies start switched off**: a copy of an
   every-stage light schedule would otherwise run beside its original in
   Flower, two schedules driving one light.
4. **Maintenance tasks can be scoped to stages** ("Runs in" on the new-task
   form and in the cadence editor). Outside its stages a task is left off
   Today (a note says how many are, and why), never falls due and is never
   announced. Its due date moves to the start of its next stage, so it does
   not open that stage weeks overdue. With no grow it idles.
   **A stage filter** above Today and Week (a plain segmented row, not
   Automation's cards) follows the current stage until one is picked. Any
   stage shows what runs then: every-stage tasks, tasks scoped to it, and
   tasks due when it starts. *All stages* shows everything, and the hidden
   note has a "Show all" link.
5. **"By stage" is now "When a stage starts"** (`start_stage`): due once, on
   the day the grow's plan says the stage begins. Done for this grow, it
   waits for the next grow. The date comes from the plan (`stageStartDate`
   in shared-types), so editing the plan moves it. `grow/stage-tasks.ts`
   keeps these dates in step every scheduler tick, before due tasks are
   announced, and straight after a task is edited, so no stage-change hook
   is needed.
6. **Grow Cycle's stage chip** shows how many automations are scoped to that
   stage and opens Automation with the stage picked (`navigate(page, { tab
   })`).

7. **Also, from a hands-on look (2026-09-30):**
   - A workspace's armed "Are you sure?" wrapped onto two lines and
     stretched the buttons beside it. The row keeps each button on one line
     now, and the armed label sets a size smaller.
   - The Overview's *Current readings* has space above it, with or without
     readings.
   - Setup View's *Placed*, *Plants* and *Available* panels collapse to their
     headers, remembered per viewer.
   - Automation's "Edit target ranges" is a blue link with a pointer.
   - The automation editor's "Add equipment" keeps its icon and text on one
     line.
   - Text links (`.link`) are blue with a pointer and an underline on hover
     wherever they sit. They were only styled inside a section heading, so
     the Overview activity feed's "Show all activity" and the Maintenance
     stage note's "Show all" read as plain text.

#### I. Keyboard-only use *(low priority)*

Navigate, open menus and trigger actions without a mouse. Do this last,
because it touches every page, and it is easier once B and C have settled
the layout and controls.

Set aside on 2026-10-01 so Phase 8 can start. Pick it up either before
Phase 9 or after it.

### Phase 8 — Service install & packaging ✅ done

The real cross-platform push, with everything else working. Planned
2026-10-01, with 7.5 I (keyboard-only use) set aside to pick up before or
after Phase 9.

The rule from the original architecture still holds: **the service is never
spawned or owned by the UI.** Closing the window must never stop the controller.

Decided 2026-10-01:

- **The controller ships with its own Node runtime.** One artifact per
  platform and architecture: a pinned Node binary, the controller bundled to
  a single file, and better-sqlite3's prebuilt binary for that Node. The
  desktop installers carry it, and the same artifact is the headless build.
  That costs about 100 MB and a second native-module ABI next to Electron's.
  In return, headless works from day one, and the service does not depend on
  the UI's runtime or its GUI libraries.
- **Linux: cover the most distros reliably.** Native packages for the three
  big families, **.deb, .rpm and pacman**, each with install scripts that
  enable and start the unit. For everything else there is a
  **controller-only tarball** with an install script. The bundled Node makes
  it independent of the distro, and it needs systemd and glibc, nothing more.
  **AppImage is dropped**, because it has no install step and cannot register
  a system service. Flatpak and Snap cannot either. Distros without systemd
  (OpenRC, runit) and musl distros (Alpine) are out of scope for v1, and that
  is stated rather than left to fail.
- **macOS is deferred** until there is a Mac to test on. The launchd notes
  are kept below so they are not lost.
- **The simulator gets a dev credential** when Tier 2 lands. It connects the
  way a real device does, so nothing is exempt and `pnpm dev` exercises the
  real auth path.

#### A. The controller as a deployable ✅ done

Before this it only ran as `tsx watch src/index.ts` inside the repo.
`pnpm build:controller` now produces an install that runs on its own.

1. **Bundle** (`scripts/bundle.mjs`): esbuild inlines everything into one ESM
   file, `release/controller.mjs` (3 MB, with a source map), better-sqlite3's
   JavaScript included. A banner gives the CommonJS dependencies the
   `require` and `__dirname` an ESM file lacks.
2. **Stage** (`scripts/stage.mjs [--platform] [--arch]`): puts together
   `release/canopy-controller-<version>-<platform>-<arch>/`. It holds Node
   24.20.0 from nodejs.org, checked against the published SHASUMS, the
   bundle, and better-sqlite3's own prebuilt binary for that Node's ABI
   (137). There is no `node_modules` (see B.3). The ABI is read from nodejs.org's release index
   rather than hardcoded. It stages linux and win32, x64 and arm64, from any
   host, and caches the downloads in `.cache/`. It is 131 MB unpacked, most
   of it the Node binary. Start it with
   `DATA_DIR=<dir> ./node --enable-source-maps controller.mjs`.
3. **Data directory.** The installed controller **refuses to start without
   `DATA_DIR`**: relative to the bundle, the default would land in the
   install directory, which an upgrade replaces. `pnpm dev` keeps
   `packages/data`. Dev data moves into an install through 7.5 F's
   export/import. Nothing is migrated automatically.
4. **Graceful shutdown** on SIGTERM (systemd) and SIGINT (Ctrl+C, and what
   WinSW sends), in reverse order of starting. It stops the heartbeat and any
   scan, then lets a scheduler pass in progress finish, so a backup or rollup
   is not cut off. Next it closes HTTP, which lets requests in flight, such
   as an export download, complete. It waits for an import being applied,
   which runs detached from its request, then closes the broker. Last, it
   checkpoints the WAL and closes the database, leaving one self-contained
   `canopy.db`. A second signal, or 30 s without finishing, forces the exit.
   Nothing touches hardware on the way down.
5. **Version** is baked in at bundle time from the root `package.json`
   (`build-info.ts`), because a service has no pnpm above it to set
   `npm_package_version`. The root is the one version for the product. It is
   still 0.0.0: the first real number comes with E.
6. **Logs** go to stdout/stderr as before, for journald.
7. **Verified**: the staged linux-x64 build was copied out of the repo and
   run with a bare `PATH`, on its own Node, against a copy of the real dev
   data (1.1 GB). It loaded the tent's 13 device topics, 4 closed command
   topics, a rule and derived roles, then stopped cleanly. A stop with the
   simulator and a WebSocket client connected took 238 ms, and the client
   got a close frame. The linux-arm64 build stages with aarch64 binaries,
   but it has not been run, because there is no ARM machine yet. win32 is
   staged in CI (E), because of the proxy.
8. **Found on the way**: `.gitignore`'s bare `build/` rule also matches
   `packages/frontend/build/`, electron-builder's resources folder. B put
   its files in `packaging/linux/` instead, so the rule could stay, but
   anything placed in `frontend/build/` later is silently untracked.
9. **Fixed in B**: the backend's script was first called `stage`, which pnpm
   11 treats as its own built-in command, so `pnpm build:controller` failed.
   It is `build:controller` in both places now.

#### B. Linux: systemd service ✅ done — pacman installed on Omarchy, .deb in CI (item 9)

`pnpm package:linux` builds the controller, the controller tarball and the
desktop packages. Everything for Linux is in `packaging/linux/`.

1. **`canopy.service`** runs `/opt/Canopy/controller/node controller.mjs`
   with `DATA_DIR=/var/lib/canopy`. It uses `Restart=always` (a deliberate
   `systemctl stop` is not restarted) and `TimeoutStopSec=45` around the
   controller's own 30 s. Hardening: `ProtectSystem=strict`, `ProtectHome`,
   `PrivateTmp`, `PrivateDevices`, no capabilities at all, and address
   families limited to IP, Unix and netlink. Node needs netlink to list
   network interfaces, and mDNS needs that list. `MemoryDenyWriteExecute`
   is left off, because V8's JIT needs writable executable memory.
   `systemd-analyze security` rates it 2.9, "OK".
2. **`DynamicUser=yes` instead of `sysusers.d`** (changed from the plan).
   systemd allocates the account when the service starts, so no package
   script creates a user, and it is the same on every systemd distro.
   `StateDirectory=canopy` keeps `/var/lib/canopy` (really
   `/var/lib/private/canopy`) across restarts, upgrades and uninstalls.
3. **The controller has no `node_modules`.** electron-builder always drops a
   `node_modules` folder at the top of any folder it copies, whatever the
   filter says (`util/filter.js`), so the first .deb shipped a controller
   without better-sqlite3. Now better-sqlite3's JavaScript is bundled, and
   its binary sits beside the bundle, passed by path through
   `store/sqlite.ts`, which every database open goes through.
4. **Packages: .deb, .rpm and pacman**, all built by electron-builder through
   fpm, and all installing to `/opt/Canopy`. `electron-builder.yml` became
   `electron-builder.cjs`, so paths resolve absolutely (fpm runs from
   wherever the build started) and the version comes from the root. Two
   more fixes on the way: the package name was `@canopy/frontend`, which is
   no valid package name (now `canopy`), and electron-builder was shipping
   the frontend's `dependencies` a second time inside the app. Everything
   there is bundled by Vite, so they are all devDependencies now.
5. **Install and upgrade scripts.** electron-builder's own after-install and
   after-remove are kept verbatim inside ours: the `/usr/bin/canopy` link,
   chrome-sandbox, the desktop database and AppArmor. Re-copy them when
   upgrading electron-builder. Then:
   - **A first install** enables and starts the controller.
   - **An upgrade** runs `try-restart`, so the new files are picked up, but
     a controller someone stopped or disabled stays that way.
   - **Removal** stops and disables it before the files go.
     `/var/lib/canopy` is never deleted.

   The three formats signal an upgrade differently. The .deb passes
   `configure <old version>` or `upgrade`, and the .rpm passes a count of
   installed versions. The scripts read those arguments directly. pacman
   has separate functions, and fpm writes a `post_upgrade` only when given
   one, which is what `after-upgrade.sh` is for. Without it, a `pacman -U`
   upgrade would have left the old controller running on deleted files. The
   .deb and .rpm must not get `--after-upgrade`: it switches fpm to wrapping
   every script in `/bin/sh`, and electron-builder's part is bash.
6. **The controller tarball** (`canopy-controller-<version>-linux-<arch>.tar.gz`,
   47 MB) is for headless machines and other distros. Its `install.sh`
   checks for root and systemd, and runs the bundled Node once to catch the
   wrong architecture or a musl system before changing anything. It swaps
   the new files in beside the old, and installs the same unit into
   `/etc/systemd/system`. Running it again upgrades. It refuses when the
   desktop package is installed, and `uninstall.sh` keeps the data.
7. **Electron comes from the local cache.** electron-builder's own download
   uses ranged requests, which the work proxy refuses (HTTP 416). The
   config hands it the zip `install-electron` already cached, when it is
   there, and downloads otherwise.
8. **Verified here**: the .deb's contents and maintainer scripts, and the
   scripts' upgrade test under bash and dash for each format's arguments.
   The unit was run through the user systemd instance, with everything but
   `DynamicUser`, and with `PrivateTmp` and `ProtectHome` relaxed so it
   could reach a test copy under `/tmp`. Under that sandbox, a scan found
   the simulator's 12 devices, an export ran, a `kill -9` was restarted in
   5 s, and `systemctl stop` shut down cleanly.
9. **Checked by hand** (noted 2026-10-01):
   - **pacman on Omarchy ✅ install test passed, 2026-10-01.** Built with
     `pnpm build:controller`, then in `packages/frontend`
     `npx electron-vite build && npx electron-builder --linux pacman`
     (`pnpm package:linux` stops at the rpm step without `rpmbuild`).
     The first build would not have installed: electron-builder's default
     pacman depends include `http-parser` and `libappindicator-gtk3`, which
     have both left Arch's repos for the AUR, so `pacman -U` refuses them.
     `electron-builder.cjs` now gives pacman its own list without the two.
     There is no tray icon to need an indicator. Then
     `packaging/linux/test-install.sh` passed every check: starts, enabled,
     runs as the `canopy` DynamicUser, clean stop, restart after `kill -9`,
     an upgrade restarts a running controller and leaves a stopped one
     stopped (so `post_upgrade` works), and removal keeps the data.
     Then installed again and launched from the menu: the app connected
     to the installed controller, and a scan found the dev simulator's
     devices through it.
   - **.deb**: now automated in CI (E), by `packaging/linux/test-install.sh`
     on a fresh Ubuntu runner.
   - **.rpm** is built in CI (E) and never installed on a real Fedora.
10. **While it is installed** it holds 7001 and 1883, so `pnpm dev:backend`
    exits with "already running". `pnpm dev:ui` talks to the installed
    controller instead. Stop the service to develop the backend.

#### C. The UI as a client of an installed service ✅ done

1. **Offline state** (`shell/ControllerOffline.tsx`). Before this, a window
   with no controller showed each page's empty state. The Overview said "No
   workspace selected, create one in Settings", and Settings said "No
   devices connected yet" with a Scan button, while the workspace and its
   devices were fine and only out of reach. Now, when `/health` fails, the
   page is replaced by "The controller isn't answering". It says what the
   controller is, that nothing is being automated while it is stopped, and
   how to check on it here: `systemctl status / start canopy` and
   `journalctl -u canopy` on Linux, `Get-Service / Start-Service Canopy` on
   Windows, and `pnpm dev:backend` in a dev build. Each command has a copy
   button. There is no start button: the window does not own the service.
2. **The app notices within a second either way** (`useControllerConnection`,
   mounted once by the shell). `/health` is polled every 3 s while offline
   rather than every 30 s, and a dropped or restored WebSocket re-checks at
   once. When the controller comes back, every query is refetched, so pages
   do not stay on the errors they got meanwhile. Measured in the running
   app: after a controller started, the page was back 0.8 s later, with
   its workspace loaded. After `systemctl`-style SIGTERM, the panel was up
   in 0.1 s.
3. **Settings → About reports what the controller says about itself.**
   `ControllerStatus` gained `installed`, `dataDir`, `httpPort` and
   `mqttPort`. About shows the state (running, paused or stopped), the
   version with "service" or "from the repo", both ports, and the data
   directory. It used to say the MQTT broker was "local only · 127.0.0.1",
   which was wrong: the broker listens on every interface, because devices
   on the LAN connect to it.
4. **One controller URL.** `ProvisionModal` had its own
   `http://localhost:7001`, now `BACKEND_URL`. That was a bug as well as a
   duplicate: the controller binds `127.0.0.1` only, and `localhost` can
   resolve to `::1` first, which would fail provisioning alone.
5. **Fixed on the way: the WebSocket only opened on the Settings page.**
   `ws.ts` says to connect once at start, but only Settings ever called it,
   so Overview's live readings waited for a visit to Settings. The shell
   connects it now.
6. **D must name the Windows service `Canopy`**, because the offline state's
   PowerShell commands use that name.
7. The headless shape (a controller on another machine) still needs a
   configurable address. `BACKEND_URL` reads `VITE_BACKEND_URL` at build
   time only. Not built yet.

#### D. Windows service ✅ done — installed and tested on a Windows runner (E.8)

Everything for Windows is in `packaging/windows/`.

1. **WinSW 2.12 wraps `node.exe`** (`canopy-service.xml`), because node.exe
   cannot answer the Service Control Manager itself. It is the .NET
   Framework 4.6.1 build, 656 KB: every supported Windows ships .NET
   Framework 4.8. WinSW publishes no checksums and does not sign its
   releases, so `stage.mjs` pins the SHA-256 of the GitHub release, taken
   2026-10-01. The service id is `Canopy`, matching the UI's
   `Get-Service Canopy`. It starts automatically, restarts 5 s after a
   crash, waits 45 s on stop, and keeps rolling logs (8 × 10 MB) in
   `%ProgramData%\Canopy\logs`.
2. **The installer** (`installer.nsh`, included in electron-builder's NSIS
   installer, which is now per machine) does the following:
   - **A first install** registers the service through WinSW and runs it as
     the virtual account `NT SERVICE\Canopy`, not LocalSystem. It restricts
     `%ProgramData%\Canopy` to SYSTEM, Administrators and that account,
     using SIDs, because the names are localised. By default every user
     could read ProgramData. It adds inbound firewall rules for 1883/TCP
     and 5353/UDP, scoped to Canopy's `node.exe` and to private and domain
     networks only, so a laptop on public Wi-Fi does not offer a broker that
     can switch hardware. Then it starts the service.
   - **An upgrade**: electron-builder first runs the *old* uninstaller with
     `--updated`, whose `customUnInstall` runs before any file is removed.
     That stops the service, so its locked `node.exe` can be replaced. The
     new install keeps the registration and starts the service again. A
     service an administrator set to Disabled refuses to start and stays
     off.
   - **Uninstall** stops the service, unregisters it and removes the firewall
     rules. The data stays.
3. **Ctrl+C is the stop signal, and it does reach Node.** WinSW stops the
   child with `GenerateConsoleCtrlEvent(CTRL_C_EVENT)`, which Node raises as
   SIGINT, and A's shutdown handles SIGINT. A first test said otherwise: the
   signal never arrived. Reading WinSW's source showed why. It calls
   `SetConsoleCtrlHandler(null, false)` before starting the child, to clear
   an "ignore Ctrl+C" flag the child would otherwise inherit, and the test
   harness had not. Done the way WinSW does it, the controller stopped
   cleanly.
4. **Staging is portable.** `stage.mjs` extracts Node's zip with `unzip` on
   Linux and with Windows' own bsdtar `tar` on Windows, so CI can stage on
   either. It now always rebundles first: staging a leftover bundle had
   packed a 0.0.1 controller into a folder named 0.0.0.
   `pnpm package:win` builds it on Windows.
5. **The installer cannot be built on Linux.** electron-builder makes the
   NSIS uninstaller by compiling a stub and running it, which takes Wine on
   Linux. Stamping `Canopy.exe` (rcedit) does too, so that is switched off
   off Windows. The installers are built on a Windows runner (E).
6. **Verified**, from WSL2 through interop on the work machine's Windows 11,
   unprivileged:
   - The staged Windows controller ran on real Windows. Its `node.exe` and
     better-sqlite3 binary loaded, nothing on the managed machine blocked
     them, and it created its database and answered `/health`.
   - Ctrl+C, sent the way WinSW sends it, gave exit 0 in 72 ms with the WAL
     merged.
   - `installer.nsh` compiles with electron-builder's own `makensis` under
     `-WX` (warnings as errors), both macros.
   - The proxy does **not** block these Windows binaries. Node's zip, the
     better-sqlite3 prebuild, WinSW, Electron's win32 zip and the NSIS
     tooling all came through with matching checksums. Only npm tarballs
     carrying `.exe` files are cut off.
7. **Verified since in CI (E.8)**, everything below passed on the first run.
   Originally **not verified: anything that needs elevation.** WinSW's own `testwait`
   asks for UAC, and the work machine has no admin rights (the prompt was
   declined). There is no Windows machine at home, so E has to run the
   install test on a GitHub Windows runner, which has admin. The test:
   install silently, check that `Canopy` runs as `NT SERVICE\Canopy` and
   `/health` answers, check the data folder's ACL, stop and start it,
   upgrade, uninstall, and check that the data is kept. WinSW's `<log>`
   settings, the virtual account and the firewall rules are only proven by
   that run.
8. **Risk to check with E: the Wi-Fi scan in provisioning** runs inside the
   controller (`netsh wlan show networks`, or `nmcli` on Linux). As a
   session-0 virtual account, or as B's sandboxed DynamicUser, it may get
   no results. Recent Windows 11 gates Wi-Fi scan results behind location
   permission, and NetworkManager's polkit gives a rescan only to active
   sessions. The scan belongs in the window's own process anyway: the
   computer joining the device's access point is the one running the UI,
   which in the headless shape is not the controller's machine.
9. **Code signing, for later:** with a certificate configured,
   electron-builder signs every `.exe` it ships, so it would re-sign
   `node.exe` (signed by the OpenJS Foundation) and WinSW. Exclude them
   when signing arrives.

#### E. CI ✅ done — all green since the second run

The roadmap had said "keep it green in CI" since Phase 1, with no CI. There
are two workflows in `.github/workflows/` now. Both pin Node to the repo's
`.node-version`, which is also the Node `stage.mjs` ships with. Dev, CI and
the installed controller now run one version, from one file.

1. **`ci.yml`** typechecks and runs the backend tests on Ubuntu and Windows,
   on every push to main and on every pull request.
2. **`package.yml`** runs on demand, on `v*` tags (which must match
   `package.json`'s version), and on pushes to main that touch packaging.
   - **Linux** builds the .deb, .rpm and pacman packages and the controller
     tarballs for x64 and arm64, and prints the .rpm's scriptlets. There is
     no Fedora runner, so that is as far as the .rpm is checked.
   - **Linux install** runs `packaging/linux/test-install.sh` on a fresh
     Ubuntu runner, first on the .deb and then on the tarball. That is B's
     .deb hand-check, automated.
   - **Windows** builds the NSIS installer, which only builds on Windows
     (D.5), and runs `packaging/windows/test-install.ps1` on the runner,
     which has admin. That is D.7.
   - The artifacts are kept for 14 days. Signing and publishing releases are
     not part of this phase.
3. **The install tests check, on each platform**: the service is running,
   enabled and not root. The controller reports `installed` and the right
   data directory. A stop is clean, which on Windows proves WinSW's Ctrl+C
   reaches Node. A killed controller is restarted. An upgrade restarts a
   running controller, but leaves a stopped one (Linux) or a Disabled one
   (Windows) off. Removal unregisters the service and keeps the data.
   Windows adds three more: the service runs as `NT SERVICE\Canopy`, the
   data folder grants nothing to Users or Everyone, and the firewall rules
   are private and domain only. Both scripts also run by hand: the pacman
   check at home is now
   `packaging/linux/test-install.sh packages/frontend/dist-build/canopy-*.pacman`.
4. **Fixed for Windows runners**: `stage.mjs` calls Windows' own
   `System32\tar.exe` by full path. On a runner, Git's GNU tar can come
   first on the PATH, and it reads no zip and takes `C:` for a remote host.
   The same `tar` calls were run with the Windows `node.exe` on the work
   machine's Windows, and extracted both archives.
5. **Checked before the first push**: both workflows pass actionlint, with
   shellcheck over their `run:` blocks. Every script in `packaging/linux`
   passes shellcheck, apart from the part of `after-install.sh` copied
   verbatim from electron-builder. `test-install.ps1` parses with Windows
   PowerShell's own parser. None of it has run on a runner yet, and Windows
   tests are likely to turn something up the first time.
6. **Not covered**:
   - pacman, which needs an Arch box with systemd. The check stays at home.
   - The .rpm, which is only built, not installed.
   - The provisioning Wi-Fi scan (D.8): runners have no Wi-Fi.
   - An arm64 desktop package. Only the arm64 controller tarball is built.
7. **The version is still 0.0.0.** A first real number, and a tag to build
   it, is a release decision rather than part of CI.
8. **First runs, 2026-10-01** (commit c753d98):
   - **`ci.yml` passed on Ubuntu and on Windows.** The backend suite had
     never run on Windows before.
   - **The Windows job passed on its first run**, installer build and
     install test both. So WinSW's Ctrl+C clean stop, the
     `NT SERVICE\Canopy` account, the data folder's ACL, the
     private/domain firewall rules, crash restart, upgrade, Disabled-stays-off
     and uninstall-keeps-data are verified on real Windows. That closes D.7.
   - **The Linux build failed, and B was wrong.** fpm takes every flag before
     the first file. The pacman config had `--after-upgrade` after the
     `canopy.service=…` file mapping, so fpm took it for a file to package.
     The .deb and .rpm passed only because their one extra flag came first.
     `electron-builder.cjs` now builds the fpm arguments as flags, then
     files. The pacman package and the .rpm were then built on the WSL2 box,
     with bsdtar and rpmbuild unpacked from `apt-get download` without root.
     Both build, and the pacman `.INSTALL` has all four hooks. The workflow
     rerun comes with the next push.
   - Not yet run at all: `linux-install`, which waits on the Linux build.
   - GitHub warns that `pnpm/action-setup@v4` targets Node 20 and is being
     run on Node 24. It still works. Move to its next major when one ships.
9. **Second run, 2026-10-01** (commit eb29fe1, run 36827750689): all three
   Packages jobs passed, so the fpm fix holds, and `linux-install` ran
   `test-install.sh` on the .deb and the tarball on a fresh Ubuntu runner.

#### F. Tier 2 MQTT authentication ✅ done

The broker used to accept any client. Now a device needs the broker
credential, except while a scan is open. Decided 2026-10-01:

- **One shared credential** (username `canopy`, a random 24-character
  password), seeded on first start. It is stored in `mqtt_credentials`, whose
  nullable `device_id` is where G ties a credential to one device.
- **Required on fresh installs.** An install upgraded with devices already
  paired starts with it off, because they connect without one and enforcing
  it would cut them all off. Settings names those devices until they have
  it. The column migration does this: it sets the value to 0 when devices
  exist.
- **Plaintext on the LAN for v1**, written down rather than drifted into.
  Settings says so in the UI.
- **The broker listens on every interface by default**. `MQTT_HOST` (in the
  service files, commented) overrides it, and Settings has an Advanced
  "Listen on" choice.

1. **Who may connect** (`broker/auth.ts`, pure and unit-tested):

   | the client presents        | required, no scan | required, scan open           | not required |
   |----------------------------|-------------------|-------------------------------|--------------|
   | the credential             | full rights       | full rights                   | full rights  |
   | nothing, or a wrong login  | refused (CONNACK 4) | discovery only ("unprovisioned") | full rights, recorded as anonymous |

   **A wrong login counts as none.** Tasmota ships with `DVES_USER` /
   `DVES_PASS`, and the broker never asked before. Refusing wrong logins
   outright would have cut off every existing Tasmota device on upgrade, and
   made a freshly flashed one impossible to discover. Comparisons are
   constant-time.
2. **Unprovisioned clients are not refused their other publishes.** In aedes
   a refused publish closes the connection, and ESPHome publishes its
   `online` status before its discovery config, so a refusal would cut it off
   before it announced. Instead their messages pass through the broker:
   - only discovery topics are acted on,
   - the ACL strips their retain flag, so a 20-second visitor leaves nothing
     behind,
   - when the last scan closes, they are disconnected. Replacing a running
     scan does not close the window.
3. **Changing the rules applies to clients already connected.** Switching
   enforcement on drops the anonymous ones. A new password drops every
   device on the old one, because a new password usually means the old one
   got out. A refusal is logged once an hour per client, since a refused
   device retries every few seconds.
4. **How each device connects is recorded** (`devices.mqtt_auth`), from
   ingest when it changes and from discovery. The device card says "no
   password", and Settings lists those devices.
5. **Settings → Device connections** (`BrokerSettings.tsx`, `/mqtt` API):
   - the broker address for each network interface, the username and the
     password, each with copy, and the password hidden until shown,
   - "New password", which asks first because it disconnects every device,
   - the require switch, whose text changes with it, and the devices still
     without a password,
   - Advanced: "Listen on". An address not on the machine is refused with a
     400. One that disappears later (a DHCP lease, an unplugged adapter)
     falls back to every interface, logged and shown, rather than taking
     every device offline.
6. **The simulator connects with the credential**, read from `GET /mqtt` the
   way the UI reads it, waiting up to 30 s for the controller. Without a
   controller it connects without one, which only an install not requiring
   credentials accepts.
7. **Verified**:
   - 26 new tests (462 in total): the decision table, discovery topics, the
     refusal code, the bind choice, retain stripping, and the migration in
     both directions on real SQLite. Breaking the "wrong login counts as
     none" rule fails three of them.
   - A live run against a fresh controller with real MQTT clients passed all
     22 checks: refusals, including Tasmota's default login; a scan letting
     a device announce without being cut off by its status message; nothing
     retained; the window closing and dropping it; the switch both ways;
     a new password; rebinding.
   - A copy of the real dev database came up with enforcement off. The
     simulator, run without a credential, was listed in Settings with all 11
     devices, and switching enforcement on in the UI refused the next
     anonymous connection.
   - Still to verify on hardware: a real Tasmota, ESPHome and Shelly given
     the credential. That belongs to the real-device testing after Phase 9.
8. **Known limits, for G and later**:
   - Any device with the shared credential may publish any device's state
     topic. G's per-device credentials and topic limits close that.
   - While a scan is open, an unprovisioned client may subscribe to
     anything, so it could read live telemetry for 20 seconds. Not worth a
     rule before G.
   - The password is readable through the loopback API. Anything on the
     machine can already drive devices through it.
   - A `.canopy` export contains the database, credential included.

#### G. Tier 3: per-device credentials ✅ done — checked by hand on WSL2

Every MQTT device now gets its own broker login when it is paired, limited
to its own topics, beside F's shared one. Planned 2026-10-01; three things
were settled when it was built, the same day:

- **Device identity was fixed first.** A Canopy device was not one MQTT
  connection. HA discovery made a device of each entity's first two topic
  segments, so a real ESPHome or Tasmota board (`node/sensor/temp`,
  `node/switch/relay`) became several devices over one connection, which
  can only log in once. Worse, two sensors under one prefix collapsed into
  one device and each announcement *replaced* its capabilities, so it kept
  only the last. The simulator escaped both only because each of its
  devices has its own prefix.
- **Out-of-scope publishes are ignored, not refused.** aedes can refuse a
  publish only by disconnecting the client, and firmware publishes topics
  Canopy never learns (ESPHome's `<node>/status`, Tasmota's
  `tele/<topic>/LWT`), so a refusal would loop it reconnecting forever.
- **The shared credential stays** (point 5 of the plan), as the "any device"
  login. The simulator is one connection for 12 devices, so it needs it,
  and so does firmware that can be given only one login by hand.

1. **One device per board.** `parseHaDiscovery` gives each entity a
   `discoveryKey` from Home Assistant's `device.identifiers` (falling back
   to the node id), stored in `devices.discovery_key`. Entities with the
   same key become one device, their capabilities merged by channel
   (`mergeCapabilities`); an entity announced again replaces itself. The
   node-id topic form, `homeassistant/<component>/<node>/<object>/config`,
   which ESPHome and Tasmota use, was not matched at all before and is now.
   A device found before G is matched by its prefix once and given its key.
2. **Pairing is one discovery at a time.** A board announces its entities
   together, and the upserts raced: each missed the others and inserted its
   own row, so the board became three devices. The live test caught it.
   `scan-session.ts` now chains them.
3. **A credential per device** (`broker/credentials.ts`): a row in
   `mqtt_credentials` with its `device_id`, username `canopy-` and 8 random
   hex characters (not the device's name, which is not unique and would say
   which device is which on the wire), created when an MQTT device is paired,
   or on first look at its card for one paired before G.
4. **Who may connect** (`broker/auth.ts`): every credential is compared, both
   halves of each in constant time, so the time taken says nothing about
   which usernames exist. A device's own login connects as `device` with its
   device id; the shared one as `shared`. `MqttAuth` was
   `"credential" | "anonymous"` and is now `"device" | "shared" | "anonymous"`;
   the stored value is renamed at startup, and in an imported file.
5. **What it may publish** (`broker/acl.ts`, `mayPublish`): its device's
   state topics, anything under its topic prefix, and discovery. Anything
   else is not ingested, not retained, and logged once an hour per topic.
   Command topics stay refused for everyone (Tier 1).
6. **Changes apply at once.** Each connected client remembers the credential
   it used, and `applyAuthConfig` drops any whose credential is gone or has a
   new password (`stillValid`). That replaced F's `credentialChanged` flag,
   and covers the shared password, a device's new password and revocation.
7. **Forgetting revokes.** Forget-all and Remove delete the device's
   credential and drop its client. Paired again, it gets a new one and keeps
   its capabilities.
8. **Shelly gets its credential pushed** (`shelly-push.ts`) when it is paired:
   `GET /shelly` tells the generations apart, then Gen 1
   `/settings?mqtt_enable=true&mqtt_server=…&mqtt_user=…&mqtt_pass=…` and
   `/reboot`, or Gen 2+ `MQTT.SetConfig` and `Shelly.Reboot` when it asks.
   The broker address sent is this machine's on the device's subnet
   (`brokerAddressFor`), or the address the broker is pinned to. A Shelly
   with a web login answers 401 and is left to be set by hand; the card
   says so. ESPHome and Tasmota still take theirs by hand, or at flash time.
9. **The UI.** Each MQTT device card has a **Broker login** button that opens
   its broker address, username and password (copy, show), "New password"
   (asks first, as it disconnects the device), "Send to device" for a
   Shelly, and how the device connects now. Settings → Device connections
   names the devices still on the shared password.
10. **Verified**:
    - 29 new tests (491 in total): the login table with device credentials,
      `stillValid`, scopes and retain stripping, discovery keys and the
      node-id form, merging, the broker address chooser, the Gen 1 and Gen 2
      push against a fake device API, 401 and no answer, the rename
      migration, and the credential going with its device.
    - A live run against a fresh controller with real MQTT clients and a
      fake Shelly HTTP API passed all 31 checks: three entities become one
      device; its login is created at pairing and works; its readings are
      ingested and another device's are not; an out-of-scope publish neither
      disconnects nor is retained; its command topic is still refused; a new
      password drops the old one; the Shelly is sent its login and rebooted;
      forget-all drops and refuses it; paired again it gets a new login.
    - The simulator, run against it, still pairs as 12 devices (each its own
      key) on the shared credential. Its Shelly's push fails at once, since
      nothing answers HTTP on 127.0.0.1, and the card says it did not answer.
11. **Checked by hand, 2026-10-02**, on WSL2 with `pnpm dev` and the
    simulator:
    - A device's Broker login shows its address, username and password, and
      "New password" asks first. Settings names the devices on the shared
      password. The simulated Shelly's "Send to device" says it did not
      answer.
    - A test client on one device's own login connected, its readings were
      ingested, another device's topic was ignored, an out-of-scope retained
      publish neither disconnected it nor stayed retained, and a command
      topic disconnected it. With "require" on, a wrong password was refused.
    - Forget-all and a rescan brought every device back, and the device's
      login came back under a new username, the old one gone.
    - **Found on the way, in the simulator.** It read the shared password
      once, at startup. A new password in Settings dropped it, as it should,
      but it reconnected on the old one, which counts as none: so with
      "require" off it came back as anonymous, and switching "require" on
      cut it off. It now reads the password again whenever its connection
      closes, before mqtt.js retries. Its `connect` handler also started new
      publish timers on every reconnect without stopping the old ones, so
      each reconnect added another full copy of the fleet's telemetry.
      Fixed too.
    - Still to do, on hardware after Phase 9: a real Shelly Gen 1 and Gen 2
      sent its login, and an ESPHome board given one.
12. **Known limits**:
    - A client on a device's own login may announce *other* devices during a
      scan, since discovery is open to every login. A scan is short and
      watched, so it is left.
    - While a scan is open, a wrong login is let in to announce itself (F),
      so a revoked login connects again for those 20 seconds, as anything
      unprovisioned can, discovery only.
    - Readings for a topic two devices claim go to the first, as before. Two
      workspaces scanning at once both pair what they hear.

#### Suggested order

A → B → C → E → D → F → G. A and B make the dev box a real install. C follows
once the controller can be absent. E was to come before D because the Windows
artifacts have to be built in CI. In the end D was built first, as far as an
unprivileged machine allows, and E finishes it. F is independent of packaging
and can move if it becomes urgent.

#### Deferred: macOS

A launchd LaunchDaemon in `/Library/LaunchDaemons`, installed by a `.pkg`
rather than the `.dmg`, because a disk image cannot run install scripts. The
bundled Node runtime from A already covers darwin, so this is mostly the
plist and the installer. Pick it up when there is a Mac to verify it on.
Until then `mac:` stays in `electron-builder.yml`, but nothing is built for it.

### Before Phase 9 — the remaining gaps

Phase 9 starts once the functionality is where it should be. Listed
2026-10-02, after Phase 8, in the order to build them. The ones that matter
for real hardware come first.

#### A. Actuator state ✅ done — two hands-on checks left (item 7)

Decided 2026-10-02: **show state, no manual switch.** Switching stays with
automations, so nothing in the UI fights the next automation tick. Shown on
the Overview's device strip and on each control chip in Settings' device
cards.

1. **The device's word, not the last command.** `actuate` answers 202
   because a command published at QoS 0 is not a device that acted. What a
   channel reports on its state topic is held instead
   (`device-manager/actuator-state.ts`).
2. **Parsing.** The channel's declared words first, exactly as declared
   (Home Assistant's `state_on` / `state_off`, now captured at discovery,
   then `payload_on` / `payload_off`). Then on/off, true/false, 1/0 and
   open/closed, in any case. A JSON object is read by its `state` (HA's JSON
   schema), `POWER` (Tasmota) or `ison` (Shelly) key. A variable channel
   also takes a level: `brightness` on its declared scale, Tasmota's
   `Dimmer`, or a bare number echoed back. A dimmer's plain "ON" keeps the
   last level it reported.
3. **In memory only**, like the latest readings. The broker is embedded, so a
   controller restart drops every device's connection, and firmware reports
   its state again when it reconnects. A table would have meant a schema
   change and an import path for something that returns within seconds.
   `since` is when it changed as far as this controller has seen, so the
   first report after a restart counts as a change.
4. **Changes only.** Devices repeat their state on a timer, so a repeat is
   not pushed. `actuator.state` is a new `ServerMessage`, and
   `GET /workspaces/:id/actuators/state` is the snapshot the UI starts from.
   `useActuatorStates` merges the two by `since`, the way `useLiveReadings`
   merges readings by `ts`.
5. **The UI** shows "On", "Off" or a dimmer's "40%", with when it changed on
   hover. Nothing is shown until a channel has reported. An offline device's
   last report is shown faded, and its tip says it may have changed.
6. **Verified**: 34 new tests (525 in total): the parser across HA, Shelly,
   Tasmota, declared and inverted words, levels and junk; changes-only;
   dimmer levels kept; workspaces kept apart; the index's actuator bindings.
   Against the running dev controller and simulator: all three actuators
   reported, switching the pump on and off through `actuate` pushed each
   echo to a websocket client in about 60 ms, and 6 s of the simulator's
   repeats pushed nothing.
7. **Checked by hand, 2026-10-02**: the tags on the Overview and in
   Settings, their tooltips, both themes, live flips from `actuate`, and an
   automation switching the pump. **Still to try**: an offline device's tag
   fading, and the tags coming back after a controller restart.
8. **Not covered**: a Shelly dimmer's level, which Gen 1 reports on
   `light/0/status` rather than its state topic.

#### B. Found on the way: abbreviated discovery keys *(open)*

Home Assistant discovery allows abbreviated keys (`stat_t`, `cmd_t`,
`pl_on`, `dev`, `ids`, and a `~` topic base), and ESPHome and Tasmota send
them. `parseHaDiscovery` reads only the full names, so such a device
would likely pair with no topics: nothing ingested and nothing to command.
The simulator uses full names, which is why nothing has shown it. Worth
fixing before the real-device testing.

#### C. Slow 6H and 24H charts ✅ built — awaiting a hands-on check

1. **Measured first, 2026-10-02.** 24H was not slow: it reads the hourly
   rollups, about 50 ms for all nine metrics. 6H reads raw rows, and took
   411 ms for nine metrics on the dev database. SQLite found one metric's
   5,472 rows in 25 ms through `idx_readings_raw_lookup`; the rest went on
   building an object per row and then `decimate` dropping most of them,
   with nine requests queued behind a synchronous driver.
2. **The sample rate was doubled again**, by a second simulator: one started
   by hand for a test in Phase 8 G, whose `npx` wrapper was killed but not
   the simulator under it. Stopped. With one simulator the rate is back to
   0.2 a second per channel.
3. **Raw is thinned in SQL** (`readings/raw-series.ts`). The window is cut
   into 2,000 equal time buckets per line, and SQLite keeps the first
   reading of each, using its bare-column rule with `MIN(recorded_at)`.
   Every point is still a real sample, never an average, since raw has no
   min/max band to show an average's spread. Buckets are by time, so a gap
   stays a gap. At 0.2 a second nothing is dropped up to almost three hours.
   The bucket is integer milliseconds over an integer width: with
   `julianday()` alone, a reading on a bucket's edge came out a hair short
   and fell into the bucket before, and better-sqlite3 binds every
   JavaScript number as REAL, so the parameters are cast. Rollups keep the
   Drizzle query, with `decimate` left as a guard.
4. **Result**: 6H for all nine metrics in about 210 ms, from 411; 1H in
   58 ms, from 110. What remains is SQLite reading the rows in the window,
   which is the only part still growing with the sample rate.
5. **Loading state.** A range with nothing loaded yet shows "Loading
   readings…" over the empty chart instead of an empty chart that reads as
   "no data". A refetch still holds the old lines at reduced opacity.
6. **Verified**: 7 tests against real SQLite (532 in total): no loss at the
   normal rate, at most `limit` points, first sample per bucket, a reading
   at exactly `to`, gaps kept, lines thinned separately, one device.
7. **Still to check by hand**: the Logging page's 6H and 24H, and the
   loading overlay when opening a range for the first time.

#### D. Grow archives ✅ built — awaiting a hands-on check

**Measured first, 2026-10-02, and the plan changed.** "Retention" planned
moving completed grows out of the live database to keep it small. But the
live database is already bounded: raw is pruned at 7 days, hourly at 90,
and daily grows by a few thousand rows a year. At 0.2 readings a second per
channel that is about 350 MB, nearly all of it raw, which no grow archive
would touch. What a grow does lose is detail: 90 days on, only daily
averages are left, and a grow often runs longer than that. Decided
2026-10-02: **keep each grow's hourly detail, and fill in its summary.**

1. **The hourly prune archives instead of deleting** rows that fall inside a
   grow (`grow/archive.ts`, `archiveBeforePrune`, called from `prune_hourly`
   with the cutoff the prune really uses, which the daily rollup may hold
   back). They go into `archive/grow-<id>.db` in the data folder, during the
   grow as much as after it, so a grow longer than the retention window
   keeps all of it. Rows outside every grow are deleted as before. Raw is
   not archived: hourly carries each hour's min and max, which is what a
   past grow's chart draws, and a week of raw is a million rows.
2. **Moving is two steps.** SQLite under WAL does not make a transaction
   across attached databases atomic, so rows are inserted into the archive
   first (ignoring any already there, by a unique key) and deleted from live
   after. A crash between leaves a row in both, which the next prune
   finishes and readers drop; it can never leave one in neither. If the
   archiving throws, nothing is deleted.
3. **Reading.** An hourly chart whose window reaches back past what live
   holds adds the archived rows of the workspace's grows overlapping it
   (`archivedHourly`, `withArchived`), and so does the hourly CSV export.
   Daily is kept in live for good, so it needs nothing.
4. **The environment summary**, which Compare in the Journal shows, had
   been "stored at completion" since the first commit with nothing writing
   it, so Compare's Avg VPD, Temp and RH were always "—". `archive_grow`
   now works it out, hourly, for finished grows (completed or aborted)
   without one, once the hourly rollup has run past the grow's end.
   Temperature and humidity come from the **canopy** roles, as VPD does, so
   a reservoir probe is never averaged in; with no role, that part stays
   empty. Each hour counts once, with its own min and max for the range. A
   grow from before this whose hourly rows are gone falls back to daily. A
   grow with no readings is marked done, so it is not looked at again, and
   any change of status clears it to be worked out again.
5. **Export, import and deletion.** A `.canopy` export carries the archives
   (`archive/…`, snapshotted with the backup API, as the database is).
   Import copies each imported grow's archive under the grow's new id and
   rewrites the workspace and device ids inside it. Deleting a workspace for
   good removes its grows' archives.
6. **Verified**: 13 new tests against real SQLite files (545 in total):
   moving inside and outside grows, an active grow, the daily rollup's hold
   on the cutoff, a re-run after a crash, a failed move deleting nothing,
   reading back with live, the duplicate dropped, the summary with archived
   hours and the reservoir left out, waiting on the rollup, an empty grow,
   active grows left alone, deletion removing the files, and an export and
   import carrying an archive with its ids remapped. The dev controller
   picked up the new job and column, and the charts' timings are unchanged.
7. **Still to check by hand**: complete or abort a grow, and after the next
   hour's rollup see Compare's Avg VPD, Temp and RH filled in. The archiving
   itself only shows after 90 days, so the tests stand in for it.

#### E. DLI ✅ built — awaiting a hands-on check

Daily light integral, mol/m²/day: the canopy's PPFD summed over a day. In
the prototype it is a Logging metric with a 35–45 target. Decided
2026-10-02: **estimate it from lux too**, by the tent's grow light.

1. **Worked out, never stored** (`device-manager/dli.ts`). An hour's
   average PPFD × 3,600 s is exactly that hour's light, so a past day's DLI
   is the sum of its hourly rollups, live and archived (D). Stored as a
   reading, a running total would have made the hourly and daily averages
   nonsense. Today's total is kept in memory from the readings as they
   arrive, seeded from raw after a restart or at midnight without counting
   the newest reading twice, and pushed like a reading, so the Overview and
   Logging take it up unchanged. No threshold or rule judges it: "so far
   today" is below any target every morning.
2. **The day runs from local midnight** in the workspace's timezone. With a
   fixed daily schedule, any 24 hours hold exactly one photoperiod's light,
   so a whole day is right however the lights sit across midnight, and
   nothing reads the light automation, which changes between stages. Hourly
   rows go to the day their middle falls in, which settles hours a
   half-hour timezone (Adelaide) splits. DST days have 23 or 25 hours.
3. **The input is the canopy light role**, as VPD's are canopy roles. PPFD
   is used as read. Lux is converted by the workspace's **grow light**
   (Settings → Workspaces): white LED × 0.017, HPS × 0.0122, sunlight
   × 0.0185, or a custom factor. These are typical, spectrum-dependent
   factors, so DLI from lux carries `estimated` and shows "est." wherever
   it appears. Changing the light or the timezone restarts today's total.
4. **Partial days.** A day with fewer hours of readings than it has is
   `partial` (and today always is): missing hours count as no light. The
   Logging stat cards leave partial days out of DLI's average, min and max.
   A day with no readings at all is left off the chart and the CSV, since
   it is a day without data, not a day without light.
5. **Where**: the Overview's "DLI so far today" card (not judged against a
   target), Logging's DLI metric, one point per local day at any range,
   the report's PNG, and the CSV, one row per day.
6. **Verified**: 12 tests against real SQLite (557 in total): Adelaide's
   midnight and Sydney's 23-hour DST day, an unknown timezone, 12 hours at
   500 µmol as 21.6 mol, partial days, the lux factor, half-hour hours,
   empty days, today from raw, the live total matching a recount, midnight,
   and estimation. On the dev controller, the simulator's lux sensor gave an
   estimated 15.29 so far today; switching the grow light to HPS gave 10.98,
   exactly the factors' ratio, and a custom factor of 2 was refused.
7. **Still to check by hand**: the Overview card and its "est." tag, Logging
   on 7D and 30D, and the grow light setting in Settings → Workspaces.
8. **Not covered**: the simulator's lux is constant day and night, so its
   DLI is far above a real tent's. A Shelly or ESPHome PAR sensor reporting
   in µmol/m²/s with no `device_class` is not recognised as PPFD at
   discovery yet; that belongs with B.

#### F. After Phase 9, or with the first screen that needs it

Per-workspace WebSocket filtering, and keyboard-only use (7.5 I).

### Phase 9 — Setup View 3D render *(last)*

Deliberately the final phase. It starts only after everything else is
polished and the functionality is where we want it. It is the most ambitious
piece and the least operationally useful: nothing is controlled from it.

This view **renders the floor plan and never edits it.** All placement stays
in the Phase 7 plan, so this phase adds no data, only a way of looking at it.
Decided 2026-09-29:

- **Low-poly, grayscale, isometric.** An orthographic camera at a fixed
  isometric elevation. No colour, except possibly as state later.
- **Rotation is yaw only.** It works like a CAD view cube, but only left and
  right: no tilt, no change of elevation, and the projection never leaves
  isometric.
- **The tent structure is generated from its dimensions** (frame poles,
  panels, door), so it is accurate for any size up to the cap without
  rescaling a model.
- **Equipment, sensors, pots and plants come from CC0 low-poly packs** that
  match the style, chosen per device by family and role. They may be
  replaced later with our own or generated assets. Keep the choice behind
  one lookup so swapping a pack touches one file. They ship with the app,
  because it has to work offline.

Settle two things before building:

- **WebGL on both hosts.** WSLg and Hyprland may fall back to software
  rendering. Spend a day on a spike that renders a generated tent on each
  machine before committing to a renderer.
- **Bundle.** Three.js (probably via react-three-fiber) is a large
  dependency. Unlike Recharts in Logging, it earns its weight, because SVG
  can't do this. Load it lazily when the view is opened, so it stays out of
  the main bundle.


### After Phase 9 — real devices, then TLS

Decided 2026-10-01. Once Phase 9 is done, the whole project is tested with
real hardware: sensors and switches (ESP32 boards on ESPHome or Tasmota, or
ready-made Shelly devices), and the controller installed on a Linux
single-board computer such as a Raspberry Pi 4 or 5, using the linux-arm64
controller tarball (B.6). The controller cannot run on a microcontroller,
because it needs Linux, Node and SQLite. Bugs found with real data are fixed
then.

**TLS comes after that.** It depends on per-device identity (G) and on which
device firmwares can take a certificate, which the real-device testing will
show.
---

## Two-machine workflow

The repo syncs through `origin` (`github.com/LASR-0/Canopy.git`). Two hazards
were cleared in Phase 0 and are recorded here so they are not reintroduced:

**Tracked build artifacts.** `tsconfig.node.tsbuildinfo` and
`tsconfig.web.tsbuildinfo` were committed. They are regenerated on every build,
so they produced spurious diffs on every machine switch. Now gitignored and
untracked — keep them that way.

**Line endings.** `core.autocrlf=true` is set on Windows and there was no
`.gitattributes`. That stops being survivable in Phase 8, when shell scripts
and systemd units arrive on Linux with CRLF — `bad interpreter: /bin/bash^M`.
`.gitattributes` now sets `* text=auto eol=lf` and forces `*.sh` to LF.

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
- Chromium logs two harmless errors at startup and during rendering on this
  NVIDIA + Wayland combination: `'--ozone-platform=wayland' is not compatible
  with Vulkan`, and intermittent `Frame latency is negative`. Both are noise.
  Resist "fixing" them with GPU switches — disabling Vulkan did not silence the
  Vulkan warning, so the mechanism is not what it appears to be, and the flags
  would change rendering for every Linux user to quiet a log line.
- **Do not run `pnpm dev` from a VS Code integrated terminal that inherits
  `ELECTRON_RUN_AS_NODE=1`.** Electron then runs as plain Node and no window
  ever opens, with no error to explain it.

### Electron on Linux — two faults, one symptom

Both surfaced as the same message, `Error: Electron uninstall`, and neither is
obvious from it. Recorded because they will recur on any fresh clone or Node
upgrade.

1. **Electron 42 dropped its install-time download.** It has no `postinstall`
   at all and fetches the runtime lazily on the first `require("electron")`.
   electron-vite never takes that path — it reads `node_modules/electron/path.txt`
   directly — so nothing ever triggered the download. Fixed with an explicit
   `postinstall: install-electron` in `packages/frontend`. `install-electron` is
   Electron's own downloader and is a no-op once the runtime is present.
2. **The unzip silently fails on modern Node.** Electron unzips via
   `extract-zip`, which pins the abandoned yauzl 2 / fd-slicer 1.1.0 pair.
   fd-slicer assigns `this.destroyed` directly; on current Node that is a setter
   marking the readable destroyed, so its final `push(null)` is dropped, no
   `end` is emitted, and extraction stalls after one file of 74 — **exiting 0**.
   Fixed with a pnpm override pinning yauzl 3 inside `extract-zip`; yauzl 3
   dropped fd-slicer and is API-compatible.

Note that pnpm does not always re-read `pnpm-workspace.yaml` settings when
nothing else changed — it can report "Already up to date" and skip the new
override entirely. If a settings change appears to do nothing, force a
re-resolve.

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

  **The proxy also scans content, and drops Windows executables.** Seen
  2026-09-25 with `electron-winstaller`: every download died at the same byte
  offset (~5.15 MB), while an ordinary tarball and Electron's 118 MB Linux zip
  came through fine. A download that stalls at a byte-exact point is this
  scanner, not the network, so don't retry it. It is why the Squirrel target
  was dropped, and why Phase 8 builds the Windows artifacts in CI.

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
- **Setup View** — a to-scale floor plan of the workspace's one tent: devices
  with mounting heights, and freely placed plants. A grayscale isometric 3D
  render of the same plan follows in Phase 9.
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
long-term. The live operational SQLite DB stays hot, bounded by those windows.
Each grow has its own archive file, opened on demand, holding its hourly
readings once they age out of the live DB (see "Before Phase 9", D). Rollups, archiving and `VACUUM INTO` backups run as internal scheduled
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
pnpm dev:sim          # simulated devices; run alongside pnpm dev
pnpm typecheck        # all packages
pnpm test             # backend vitest suite
pnpm build:ui         # electron-vite build
pnpm build:controller # the installable controller for this machine (Phase 8 A)
pnpm package:linux    # controller tarball + .deb/.rpm/pacman (Phase 8 B)
pnpm package:win      # NSIS installer with the service; Windows only (Phase 8 D)
```

Default ports: HTTP/WS `7001` (localhost), MQTT `1883` (all interfaces).

Only one controller may run at a time — it owns the database and the broker. A
second one exits with a clear message rather than an `EADDRINUSE` stack trace,
so if the UI says the controller is offline, check for a stray instance holding
`7001`/`1883` before debugging anything else.

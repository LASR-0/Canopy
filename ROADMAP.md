# Canopy — State & Roadmap

Open-source desktop app for managing indoor grow setups using **local** smart
devices (sensors, lighting, agricultural actuators). It discovers devices on the
LAN itself, visualises their data, and runs scheduled + reactive automations per
grow cycle and grow mode.

This document supersedes `HANDOFF.md`. It is the canonical record of decisions
and the current plan. **Read it before changing anything.** The project is
already scaffolded — never run a scaffolder or re-init; add dependencies with
`pnpm add` inside the right package.

Last verified against the code: **2026-09-26**.

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
- **Maintenance and Automation pages** are built and wired to real endpoints.
  See Phase 7.
- **Tests** — 295 passing across 17 files.

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

- **No actuator state.** Commands go out and devices echo their new state on
  the state topic, but ingestion treats that as proof of life only. Nothing
  stores or reports whether a fan is actually running, so a rule can fire and
  the UI still cannot show the result.
- **No archive database.** Completed grows are never moved out of the live DB,
  so it grows without bound. The `archive_grow` job type exists and has no
  handler. See "Retention".
- **Derived metrics: VPD done, DLI outstanding.** VPD is computed on the ingest
  path and stored under `device_id = "__derived__"`, so the Overview's VPD card
  fills once the canopy roles are assigned. DLI still needs PPFD integrated over
  the photoperiod. See "Derived metrics" below.

### Stubbed routes

Return fabricated or empty data, not persisted: `journal`.

`events` is written by the scheduler, the rules engine, threshold checking and
the heartbeat monitor as of Phase 6. It still has no write route, which is
correct: events are recorded by the subsystem that caused them, not posted.

`automations` is DB-backed as of Phase 5, with trigger validation on write.

`controller` is fully real: `brokerOnline` and `deviceCount` since Phase 3, and
`POST /controller/command` honours pause/resume/stop since Phase 4.

DB-backed and real: `grows`, `workspaces`, `maintenance`, `devices`, `settings`,
`chart-layouts`, `thresholds`, `readings` (read and write paths).

### Placeholder pages

17–18 line "coming soon" shells: `GrowCycle`, `Journal`, `SetupView`.

**Maintenance is built** (Phase 7). Its CSS was ported wholesale from the
prototype and resolves entirely against the existing Primer tokens, which is
the pattern to repeat for the remaining pages: the design debt is zero, but the
stylesheet still has to be carried across.

### Not started

- The **boot-level OS-managed service**, which the architecture calls a
  requirement. No systemd unit, no launchd plist, no Windows service, on any
  platform. `electron-builder.yml` is 18 lines of bare targets — no service
  registration, no signing.
- WebSocket has no per-workspace subscription filtering. `subscribe` /
  `unsubscribe` frames are parsed and then ignored, so every client receives
  every workspace's traffic. Harmless with one tent and one window; wrong as
  soon as there are two. Tagged Phase 6 in the source and deliberately left:
  the renderer never *sends* a subscribe frame, so server-side filtering today
  would be either inert or would cut the UI off from its own data. Both halves
  belong with the first multi-tent screen.
### Reading volume and query cost — measured, not yet optimised

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
by watch-mode restarts. **Before changing the sample rate or the storage design,
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

### Derived metrics — VPD lands, DLI does not

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
photoperiod rather than a reading-to-reading function, so it is not done.

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

### MQTT hardening — Tier 1 done, Tier 2 in Phase 8

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

**Tier 2 — authentication.** Deferred to Phase 8, where it belongs: see below.

**Tier 3 — per-device credentials.** Only meaningful for devices with a config
channel to push a credential through — Shelly has an HTTP API, ESPHome and
generic MQTT firmware are configured out of band at flash time. Revisit when
Tier 2 lands, scoped to the families that can actually be provisioned.

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
there.

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
there is no `ServerMessage` for it and no UI consuming one. Adding both belongs
with the first screen that shows a control.

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
archive-database design from "Retention" below, and **`maintenance_check`**
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

### Phase 7 — Pages *(in progress)*

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
4. **Grow Cycle** and **Journal** *(next)* — their routes are stubs; do the
   backend persistence first.

   **Stage-scoped automations belong here.** `Automation.stage` is stored, and
   both the scheduler and the rules engine read it back — and neither filters on
   it, so a "flowering only" automation currently runs in every stage. It was
   left out of the Automation page rather than shipped as a control that does
   nothing.

   The filter is two lines in each engine. What is not mechanical is what a
   stage-scoped automation should do when there is *no* active grow, which is
   the state today: skip it, and a forgotten grow leaves the tent doing nothing;
   ignore the scope, and the setting is a lie. Thresholds avoid the question
   because their `stage` is a refinement over an unscoped default, so an absent
   grow degrades to the workspace band. An automation has no such fallback —
   `stage` there is a gate. The decision needs the screen where a grow is
   started and ended, which is this one. `rules/thresholds.ts` already caches
   the active grow per workspace and resolves `calcGrowStage`, so the resolution
   pattern to copy exists.
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

**Tier 2 MQTT authentication** belongs here, because this is the phase where
Canopy stops being a dev box and becomes a service that boots unattended.

The chicken-and-egg: devices are discovered *over MQTT itself* — retained
`homeassistant/+/+/config` and `shellies/announce` — so requiring credentials at
CONNECT breaks zero-config discovery outright. A device cannot present a
credential it has not been given, and it cannot be given one before it has been
found.

The scan session is the seam that resolves it. `SCAN_DURATION_MS` is already a
20-second window opened by a deliberate user action, so use it as the security
boundary in an `authenticate` hook:

- **Known device** (credential on file) — authenticate, full rights.
- **Anonymous, scan open** — accept, but mark the client unprovisioned so the
  Tier 1 ACL narrows it to discovery topics only. It can announce itself; it
  cannot inject readings.
- **Anonymous, no scan open** — reject with `BAD_USERNAME_OR_PASSWORD`.

This keeps the "press scan, devices appear" flow exactly as it is, and shrinks
the anonymous surface from *always, everything* to *20 seconds, discovery
topics only, while a human is watching the screen*.

Three things to settle when it is built, none of which have an obvious default:

- **The simulator** connects to `mqtt://127.0.0.1:1883` with no credentials, so
  Tier 2 breaks `pnpm dev` unless loopback is exempted via `preConnect` or the
  simulator is issued a dev credential. Exempting loopback also exempts anything
  else running on the host.
- **TLS, or not.** Without it, credentials cross the LAN in cleartext inside the
  CONNECT packet. Cheap-device TLS support is patchy and cert distribution is its
  own project. Accepting plaintext credentials on a trusted segment is
  defensible for v1 — but decide it rather than drift into it.
- **The bind address.** If devices live on one interface or VLAN, narrowing off
  `0.0.0.0` is free defence in depth.

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
pnpm dev:sim          # simulated devices; run alongside pnpm dev
pnpm typecheck        # all packages
pnpm test             # backend vitest suite
pnpm build:ui         # electron-vite build
```

Default ports: HTTP/WS `7001` (localhost), MQTT `1883` (all interfaces).

Only one controller may run at a time — it owns the database and the broker. A
second one exits with a clear message rather than an `EADDRINUSE` stack trace,
so if the UI says the controller is offline, check for a stray instance holding
`7001`/`1883` before debugging anything else.

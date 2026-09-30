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

### Phase 8 — Service install & packaging *(next)*

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
  create the service user and enable the unit. For everything else there is a
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

#### A. The controller as a deployable

Today it only runs as `tsx watch src/index.ts` inside the repo.

1. **Bundle.** esbuild bundles `src/index.ts` into one ESM file, with
   better-sqlite3 left external because it is native. Everything else is
   pure JS.
2. **Stage.** A script assembles `canopy-controller/<platform>-<arch>/`: the
   Node binary from nodejs.org (pinned, checksum verified), the bundle, and
   better-sqlite3 with the prebuilt binary for that Node's ABI. It runs with
   no pnpm, tsx or repo present.
3. **Data directory.** The dev default (`packages/data`) stays. The service
   sets `DATA_DIR`: `/var/lib/canopy` on Linux, `%ProgramData%\Canopy` on
   Windows. The existing dev data moves in through 7.5 F's export/import.
   Nothing is migrated automatically.
4. **Graceful shutdown.** There is no SIGTERM handling today, so a
   `systemctl stop` kills the process mid-write. On SIGTERM/SIGINT the
   controller should stop the scheduler, close the HTTP server and the broker,
   checkpoint the WAL, close the database and exit 0.
5. **Version.** `/health` and `/controller` read `npm_package_version`, which
   only pnpm sets. Under systemd it would report 0.0.0, so the bundle bakes
   the version in at build time.
6. **Logs** go to stdout/stderr as they do now, so journald picks them up.
   Windows handles them in D.

#### B. Linux: systemd service

1. **`canopy.service`**: `User=canopy`, `StateDirectory=canopy` (which
   creates `/var/lib/canopy` and owns it), `Restart=on-failure`,
   `After=network-online.target`, and hardening (`ProtectSystem=strict`,
   `ProtectHome`, `PrivateTmp`, `NoNewPrivileges`). None of it needs root:
   1883 and 7001 are unprivileged ports, and mDNS is plain multicast UDP.
2. **The service user comes from `sysusers.d`**, not `useradd` in a script.
   It is the one mechanism every systemd distro shares.
3. **Package scripts** (deb, rpm and pacman each call them differently, but
   they do the same things): after install, run `systemd-sysusers`,
   `daemon-reload` and `enable --now`. On upgrade, restart. Before removal,
   `disable --now`. Removal leaves `/var/lib/canopy` in place. Grow history
   is never deleted by an uninstall.
4. **The controller-only tarball** has an `install.sh` and an
   `uninstall.sh` that do the same: the unit, sysusers, enable. This is the
   headless build, and linux-arm64 is built as well for a Pi.
5. **Verify** the .deb under WSL2 systemd at work (it is enabled on this box
   already) and pacman at home. There is no Fedora box, so the .rpm is
   checked for contents and scriptlets in a container, and recorded as such.
6. **Firewall** is left to the user and documented. ufw and firewalld are not
   touched by the packages.

#### C. The UI as a client of an installed service

1. **Offline state.** When `/health` does not answer, say the controller
   service is not running and how to check it on this platform
   (`systemctl status canopy`, or Services on Windows). There is no start
   button: the UI does not own the service.
2. **One controller URL.** `ProvisionModal.tsx` hardcodes
   `http://localhost:7001`, apart from `lib/http.ts`. It should use the same
   constant. A configurable address for the headless shape is noted here and
   not built yet.
3. **Settings → Controller** shows the version and data directory that the
   controller reports, rather than fixed strings.

#### D. Windows service

1. **Service wrapper: WinSW.** `node.exe` cannot answer the Service Control
   Manager itself, so `sc create` on it alone does not work. WinSW is a
   single MIT-licensed executable with an XML config. NSSM is unmaintained,
   and node-windows is WinSW with a wrapper around it.
2. **Registered by the NSIS installer** with one-time elevation
   (`perMachine: true`, and `customInstall` / `customUnInstall` in
   `build/installer.nsh`). It runs as a virtual account (`NT SERVICE\Canopy`),
   not LocalSystem, with write access granted on `%ProgramData%\Canopy` only.
   It also adds an inbound firewall rule for 1883.
3. **Logs** go to WinSW's rolling log files under the data directory.
4. **Build in CI (E), not at work.** The corporate proxy blocks downloads
   that carry Windows executables (see WSL2 below), and `node.exe` and WinSW
   are exactly that. Not tested against them, but not worth finding out. Verify the installer by hand on the work Windows host.

#### E. CI

The roadmap has said "keep it green in CI" since Phase 1, but there is no
CI. GitHub Actions:

1. **Checks** on every push: typecheck and the backend tests, on Ubuntu and
   Windows.
2. **Packages** on demand and on tags: the controller artifacts (linux x64 and
   arm64, windows x64), the Linux packages and the NSIS installer, uploaded
   as workflow artifacts. Signing and publishing releases are not part of
   this phase.

#### F. Tier 2 MQTT authentication

This belongs here, because this is the phase where Canopy stops being a dev
box and becomes a service that boots unattended.

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

Settled 2026-10-01:

- **The simulator** gets a dev credential, the same as a real device. It reads
  the credential from the controller's HTTP API, which is loopback-only, as
  the UI is.

Still to settle when it is built:

- **Where a device's credential comes from.** Tier 3 is the per-device
  credential, so Tier 2 is one broker credential, generated on first start.
  Settings shows it for the user to type into Tasmota or ESPHome, and it is
  pushed to Shelly over its HTTP API. A device found anonymously appears, but
  sends no readings until it has the credential, and Settings has to say so.
- **Upgrading.** Devices that connect anonymously today stop working the
  moment Tier 2 is enforced. An upgraded install may need to start with
  enforcement off and a prompt to turn it on.
- **TLS, or not.** Without it, credentials cross the LAN in cleartext inside the
  CONNECT packet. Cheap-device TLS support is patchy and cert distribution is its
  own project. Accepting plaintext credentials on a trusted segment is
  defensible for v1 — but decide it rather than drift into it.
- **The bind address.** If devices live on one interface or VLAN, narrowing off
  `0.0.0.0` is free defence in depth.

#### Suggested order

A → B → C → E → D → F. A and B make the dev box a real install. C follows
once the controller can be absent. E comes before D because the Windows
artifacts have to be built in CI. F is independent of packaging and can move
if it becomes urgent.

#### Deferred: macOS

A launchd LaunchDaemon in `/Library/LaunchDaemons`, installed by a `.pkg`
rather than the `.dmg`, because a disk image cannot run install scripts. The
bundled Node runtime from A already covers darwin, so this is mostly the
plist and the installer. Pick it up when there is a Mac to verify it on.
Until then `mac:` stays in `electron-builder.yml`, but nothing is built for it.

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

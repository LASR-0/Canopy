# @canopy/backend

The controller. Long-running, OS-managed, independent of the UI.

- **device-manager** — discovery, pairing, per-family adapters, device registry
- **broker** — embedded MQTT broker (aedes) + HA-style discovery listener
- **scheduler** — time-driven automations + internal maintenance jobs
- **rules** — event-driven automations against live readings
- **store** — SQLite (drizzle); live DB + on-demand archive DB; tiered readings
- **api** — HTTP, implements `ApiRoutes` from `@canopy/shared-types`
- **ws** — WebSocket push of `ServerMessage`s

Lifecycle: registered as a **boot-level** service by the installer. The UI
discovers it via `GET /health` and connects; closing the UI never stops it.

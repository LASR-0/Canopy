/**
 * Canopy controller service entry point.
 *
 * Runs as an OS-managed service (launchd / systemd / Windows service).
 * NEVER spawned by the UI — the renderer connects over HTTP + WebSocket.
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { closeStore, initSchema } from "./store/index.js";
import { IMPORT_DIR, TMP_DIR } from "./store/paths.js";
import { clearStaging, importsSettled } from "./data/import.js";
import { db } from "./store/index.js";
import { workspaces, appSettings } from "./store/schema.js";
import { buildServer, PORT } from "./api/server.js";
import { startBroker, stopBroker, MQTT_PORT } from "./broker/index.js";
import { cancelAllScans, startDeviceManager, stopHeartbeatMonitor } from "./device-manager/index.js";
import { drainScheduler, startScheduler } from "./scheduler/index.js";
import { VERSION } from "./build-info.js";
import { and, eq, isNull } from "drizzle-orm";

async function ensureDefaultWorkspace(): Promise<void> {
  // Only a live workspace counts: the app always needs one to open.
  const existing = await db.select().from(workspaces).where(and(isNull(workspaces.archivedAt), isNull(workspaces.deletedAt)));
  if (existing.length > 0) return;

  const id = randomUUID();
  const now = new Date().toISOString();
  await db.insert(workspaces).values({
    id,
    name: "My Workspace",
    createdAt: now,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC",
  });

  // Set as active workspace in settings
  await db.update(appSettings).set({ activeWorkspaceId: id }).where(eq(appSettings.id, 1));
  console.log(`[startup] created default workspace: ${id}`);
}

async function main() {
  initSchema();
  await ensureDefaultWorkspace();
  // An import staged before a stop can never be applied: its session was in memory.
  await clearStaging(IMPORT_DIR);
  await clearStaging(TMP_DIR);

  await startBroker();
  await startDeviceManager();
  await startScheduler();

  const app = await buildServer();
  await app.listen({ port: PORT, host: "127.0.0.1" });
  console.log(`Canopy controller ${VERSION} listening on http://127.0.0.1:${PORT}`);

  // SIGTERM is how systemd stops a service; SIGINT is Ctrl+C in a terminal,
  // and what the Windows service wrapper sends.
  process.once("SIGTERM", () => void shutdown(app, "SIGTERM"));
  process.once("SIGINT", () => void shutdown(app, "SIGINT"));
}

/**
 * Longer than any one scheduler pass or import should take, and well inside
 * systemd's 90-second default, after which it would send SIGKILL anyway.
 */
const SHUTDOWN_TIMEOUT_MS = 30_000;

/**
 * Stop in the reverse order of starting, letting work in flight finish, so a
 * stop never leaves a backup half-written, an import half-copied or the WAL
 * unmerged. Nothing here touches hardware: a device stays in whatever state
 * the controller last put it in, and the scheduler re-asserts schedules on
 * the next start.
 */
async function shutdown(app: FastifyInstance, signal: string): Promise<void> {
  console.log(`[shutdown] ${signal} received, stopping`);

  // A second signal means "now", and so does a stop that has stalled.
  const force = (reason: string) => {
    console.error(`[shutdown] ${reason}, exiting without a clean stop`);
    process.exit(1);
  };
  process.once("SIGTERM", () => force("second signal"));
  process.once("SIGINT", () => force("second signal"));
  setTimeout(() => force(`still stopping after ${SHUTDOWN_TIMEOUT_MS / 1000} s`), SHUTDOWN_TIMEOUT_MS).unref();

  try {
    stopHeartbeatMonitor();
    cancelAllScans();
    await drainScheduler();
    // Stops accepting requests and waits for those in flight, such as an
    // export still streaming, then closes the WebSockets.
    await app.close();
    // An import's copy outlives the request that started it.
    await importsSettled();
    await stopBroker();
    // Readings already received finish their writes before the database closes.
    await new Promise<void>((resolve) => setImmediate(resolve));
    closeStore();
  } catch (err) {
    console.error("[shutdown] failed:", err);
    process.exit(1);
  }

  console.log("[shutdown] stopped cleanly");
  process.exit(0);
}

/** Node attaches `code` to syscall failures; narrow without asserting a shape. */
function errorCode(err: unknown): string | undefined {
  return typeof err === "object" && err !== null && "code" in err
    ? String((err as { code: unknown }).code)
    : undefined;
}

main().catch((err: unknown) => {
  if (errorCode(err) === "EADDRINUSE") {
    // Overwhelmingly this is a second instance, not a misconfiguration:
    // the controller is a long-running service, so it is easy to start twice.
    console.error(
      `A Canopy controller is already running (or ports ${PORT}/${MQTT_PORT} are taken).\n` +
        "Only one instance may run at a time — it owns the database and the MQTT broker.\n" +
        "Stop the existing controller, or set PORT / MQTT_PORT to run a second one.",
    );
    process.exit(1);
  }
  console.error("Fatal startup error:", err);
  process.exit(1);
});

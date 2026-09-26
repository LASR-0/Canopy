/**
 * Canopy controller service entry point.
 *
 * Runs as an OS-managed service (launchd / systemd / Windows service).
 * NEVER spawned by the UI — the renderer connects over HTTP + WebSocket.
 */
import { randomUUID } from "node:crypto";
import { initSchema } from "./store/index.js";
import { db } from "./store/index.js";
import { workspaces, appSettings } from "./store/schema.js";
import { buildServer, PORT } from "./api/server.js";
import { startBroker, MQTT_PORT } from "./broker/index.js";
import { startDeviceManager } from "./device-manager/index.js";
import { eq } from "drizzle-orm";

async function ensureDefaultWorkspace(): Promise<void> {
  const existing = await db.select().from(workspaces).where(eq(workspaces.archived, false));
  if (existing.length > 0) return;

  const id = randomUUID();
  const now = new Date().toISOString();
  await db.insert(workspaces).values({
    id,
    name: "My Workspace",
    createdAt: now,
    archived: false,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC",
  });

  // Set as active workspace in settings
  await db.update(appSettings).set({ activeWorkspaceId: id }).where(eq(appSettings.id, 1));
  console.log(`[startup] created default workspace: ${id}`);
}

async function main() {
  initSchema();
  await ensureDefaultWorkspace();

  await startBroker();
  await startDeviceManager();

  const app = await buildServer();
  await app.listen({ port: PORT, host: "127.0.0.1" });
  console.log(`Canopy controller listening on http://127.0.0.1:${PORT}`);
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

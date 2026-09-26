import type { FastifyInstance } from "fastify";
import { eq, sql } from "drizzle-orm";
import { db } from "../../store/index.js";
import { devices } from "../../store/schema.js";
import { isBrokerOnline } from "../../broker/index.js";
import { ok } from "../reply.js";
import type { ControllerStatus } from "@canopy/shared-types";

const startedAt = Date.now();
const VERSION = process.env["npm_package_version"] ?? "0.0.0";

/**
 * Count paired devices across every workspace.
 *
 * Controller status is service-wide, not workspace-scoped, so this is every
 * device the controller is responsible for. Forgotten devices are excluded:
 * the user has said they no longer care about them.
 */
async function pairedDeviceCount(): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(devices)
    .where(eq(devices.forgotten, false));
  return row?.count ?? 0;
}

async function currentStatus(): Promise<ControllerStatus> {
  return {
    state: "running",
    version: VERSION,
    uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
    brokerOnline: isBrokerOnline(),
    deviceCount: await pairedDeviceCount(),
    ts: new Date().toISOString(),
  };
}

export async function controllerRoutes(app: FastifyInstance): Promise<void> {
  app.get("/controller/status", async (_req, reply) => {
    return reply.send(ok(await currentStatus()));
  });

  app.post("/controller/command", async (_req, reply) => {
    // Phase 6: honour pause / resume / stop commands. Until then the reply is
    // the unchanged current status rather than a pretended state change.
    return reply.send(ok(await currentStatus()));
  });
}

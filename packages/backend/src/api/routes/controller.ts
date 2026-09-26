import type { FastifyInstance } from "fastify";
import { eq, sql } from "drizzle-orm";
import { db } from "../../store/index.js";
import { devices } from "../../store/schema.js";
import { isBrokerOnline } from "../../broker/index.js";
import { getControllerState, setControllerState } from "../../controller/state.js";
import { broadcast } from "../../ws/index.js";
import { ok, err } from "../reply.js";
import type { ControllerCommand, ControllerState, ControllerStatus } from "@canopy/shared-types";

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
    state: getControllerState(),
    version: VERSION,
    uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
    brokerOnline: isBrokerOnline(),
    deviceCount: await pairedDeviceCount(),
    ts: new Date().toISOString(),
  };
}

const STATE_FOR_OP: Record<ControllerCommand["op"], ControllerState> = {
  pause: "paused",
  resume: "running",
  stop: "stopped",
};

function isControllerCommand(body: unknown): body is ControllerCommand {
  if (typeof body !== "object" || body === null) return false;
  const op = (body as { op?: unknown }).op;
  return op === "pause" || op === "resume" || op === "stop";
}

export async function controllerRoutes(app: FastifyInstance): Promise<void> {
  app.get("/controller/status", async (_req, reply) => {
    return reply.send(ok(await currentStatus()));
  });

  app.post<{ Body: ControllerCommand }>("/controller/command", async (req, reply) => {
    if (!isControllerCommand(req.body)) {
      return reply
        .status(400)
        .send(err("validation_failed", 'op must be "pause", "resume" or "stop"'));
    }

    setControllerState(STATE_FOR_OP[req.body.op]);
    const status = await currentStatus();

    // Every open window shares one controller, so they all need to learn that
    // it is no longer acting — otherwise a second window keeps offering
    // controls that will now be refused.
    broadcast({ type: "controller.status", payload: status });

    return reply.send(ok(status));
  });
}

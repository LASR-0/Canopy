import type { FastifyInstance } from "fastify";
import { eq, sql } from "drizzle-orm";
import { db } from "../../store/index.js";
import { devices } from "../../store/schema.js";
import { isBrokerOnline, MQTT_PORT } from "../../broker/index.js";
import { DATA_DIR } from "../../store/paths.js";
import { getControllerState, setControllerState } from "../../controller/state.js";
import { broadcast } from "../../ws/index.js";
import { ok, err } from "../reply.js";
import type { ControllerCommand, ControllerState, ControllerStatus } from "@canopy/shared-types";
import { BUNDLED, VERSION } from "../../build-info.js";

const startedAt = Date.now();

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

/**
 * `httpPort` is the port the request came in on, which is the one that
 * matters to whoever asked, without importing the server's own constant.
 */
async function currentStatus(httpPort: number): Promise<ControllerStatus> {
  return {
    state: getControllerState(),
    version: VERSION,
    uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
    brokerOnline: isBrokerOnline(),
    deviceCount: await pairedDeviceCount(),
    ts: new Date().toISOString(),
    installed: BUNDLED,
    dataDir: DATA_DIR,
    httpPort,
    mqttPort: MQTT_PORT,
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
  app.get("/controller/status", async (req, reply) => {
    return reply.send(ok(await currentStatus(req.socket.localPort ?? 0)));
  });

  app.post<{ Body: ControllerCommand }>("/controller/command", async (req, reply) => {
    if (!isControllerCommand(req.body)) {
      return reply
        .status(400)
        .send(err("validation_failed", 'op must be "pause", "resume" or "stop"'));
    }

    setControllerState(STATE_FOR_OP[req.body.op]);
    const status = await currentStatus(req.socket.localPort ?? 0);

    // Every open window shares one controller, so they all need to learn that
    // it is no longer acting — otherwise a second window keeps offering
    // controls that will now be refused.
    broadcast({ type: "controller.status", payload: status });

    return reply.send(ok(status));
  });
}

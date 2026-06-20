import type { FastifyInstance } from "fastify";
import { ok } from "../reply.js";

const startedAt = Date.now();
const VERSION = process.env["npm_package_version"] ?? "0.0.0";

export async function controllerRoutes(app: FastifyInstance): Promise<void> {
  app.get("/controller/status", async (_req, reply) => {
    return reply.send(
      ok({
        state: "running" as const,
        version: VERSION,
        uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
        brokerOnline: false,
        deviceCount: 0,
        ts: new Date().toISOString(),
      }),
    );
  });

  app.post("/controller/command", async (_req, reply) => {
    // Phase 6: honour pause / resume / stop commands
    return reply.send(
      ok({
        state: "running" as const,
        version: VERSION,
        uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
        brokerOnline: false,
        deviceCount: 0,
        ts: new Date().toISOString(),
      }),
    );
  });
}

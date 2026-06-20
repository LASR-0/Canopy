import type { FastifyInstance } from "fastify";
import { ok } from "../reply.js";

const VERSION = process.env["npm_package_version"] ?? "0.0.0";
const startedAt = Date.now();

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async (_req, reply) => {
    return reply.send(
      ok({
        ok: true as const,
        version: VERSION,
        ts: new Date().toISOString(),
        uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
      }),
    );
  });
}

import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { ok } from "../reply.js";
import type { Automation } from "@canopy/shared-types";

// Phase 6: full automation implementation with seeded templates.
export async function automationRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { workspaceId: string } }>(
    "/workspaces/:workspaceId/automations",
    async (_req, reply) => reply.send(ok([])),
  );

  app.post<{ Params: { workspaceId: string }; Body: Partial<Automation> }>(
    "/workspaces/:workspaceId/automations",
    async (req, reply) => {
      const stub: Automation = {
        id: randomUUID(),
        workspaceId: req.params.workspaceId,
        name: req.body.name ?? "New automation",
        enabled: req.body.enabled ?? true,
        kind: req.body.kind ?? "schedule",
        subsystem: req.body.subsystem ?? "lighting",
        driver: req.body.driver ?? "schedule",
        trigger: req.body.trigger ?? { kind: "schedule", cron: "0 6 * * *" },
        actions: req.body.actions ?? [],
        sortOrder: 0,
      };
      return reply.status(201).send(ok(stub));
    },
  );

  app.patch<{ Params: { workspaceId: string; id: string }; Body: Partial<Automation> }>(
    "/workspaces/:workspaceId/automations/:id",
    async (req, reply) => reply.send(ok({ id: req.params.id, workspaceId: req.params.workspaceId, ...req.body } as Automation)),
  );
}

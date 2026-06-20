import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { ok } from "../reply.js";
import type { JournalEntry } from "@canopy/shared-types";

// Phase 6: full journal implementation.
export async function journalRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { workspaceId: string; growId: string } }>(
    "/workspaces/:workspaceId/grows/:growId/journal",
    async (_req, reply) => reply.send(ok([])),
  );

  app.post<{ Params: { workspaceId: string; growId: string }; Body: Partial<JournalEntry> }>(
    "/workspaces/:workspaceId/grows/:growId/journal",
    async (req, reply) => {
      const stub: JournalEntry = {
        id: randomUUID(),
        workspaceId: req.params.workspaceId,
        growId: req.params.growId,
        growDay: req.body.growDay ?? 1,
        growWeek: req.body.growWeek ?? 1,
        type: req.body.type ?? "observation",
        title: req.body.title ?? "",
        createdAt: new Date().toISOString(),
      };
      return reply.status(201).send(ok(stub));
    },
  );

  app.patch<{ Params: { workspaceId: string; growId: string; id: string }; Body: Partial<JournalEntry> }>(
    "/workspaces/:workspaceId/grows/:growId/journal/:id",
    async (req, reply) => reply.send(ok({ id: req.params.id, ...req.body } as JournalEntry)),
  );

  app.delete<{ Params: { workspaceId: string; growId: string; id: string } }>(
    "/workspaces/:workspaceId/grows/:growId/journal/:id",
    async (_req, reply) => reply.send(ok({ deleted: true as const })),
  );
}

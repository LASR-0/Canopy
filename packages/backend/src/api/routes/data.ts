import type { FastifyInstance } from "fastify";
import { sqliteConnection } from "../../store/index.js";
import { IMPORT_DIR, PHOTO_DIR, TMP_DIR } from "../../store/paths.js";
import { exportArchive, exportFileName } from "../../data/export.js";
import { ImportError, applyImport, discardImport, importStatus, stageImport } from "../../data/import.js";
import { reloadWorkspaceCaches } from "../../controller/reload.js";
import { err, ok } from "../reply.js";

export async function dataRoutes(app: FastifyInstance): Promise<void> {
  // An upload can be hundreds of megabytes, so it is handed over as a stream
  // and written to disk as it arrives, never held in memory.
  app.addContentTypeParser(
    ["application/octet-stream", "application/gzip"],
    { bodyLimit: Number.MAX_SAFE_INTEGER },
    (_req, payload, done) => done(null, payload),
  );

  /** Everything, as a `.canopy` file download. */
  app.get("/data/export", async (_req, reply) => {
    const stream = await exportArchive(sqliteConnection, PHOTO_DIR, TMP_DIR);
    return reply
      .header("content-type", "application/octet-stream")
      .header("content-disposition", `attachment; filename="${exportFileName()}"`)
      .send(stream);
  });

  /** Upload a `.canopy` file. Answers with what is in it, to choose from. */
  app.post<{ Body: AsyncIterable<Buffer> }>("/data/import", async (req, reply) => {
    try {
      const preview = await stageImport(req.body, IMPORT_DIR, sqliteConnection);
      return reply.status(201).send(ok(preview));
    } catch (e) {
      if (e instanceof ImportError) return reply.status(400).send(err("validation_failed", e.message));
      throw e;
    }
  });

  /**
   * Import the chosen workspaces. Answers at once; the copy runs in the
   * background and `GET /data/import/:token` reports its progress.
   */
  app.post<{ Params: { token: string }; Body: { workspaceIds?: unknown } }>(
    "/data/import/:token/apply",
    async (req, reply) => {
      const status = importStatus(req.params.token);
      if (!status) return reply.status(404).send(err("not_found", "That import has expired. Upload the file again."));
      if (status.state !== "staged") return reply.status(409).send(err("conflict", "That import has already run"));
      const ids = req.body?.workspaceIds;
      if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === "string")) {
        return reply.status(400).send(err("validation_failed", "Choose at least one workspace from the file"));
      }
      void applyImport(sqliteConnection, req.params.token, ids as string[], PHOTO_DIR, reloadWorkspaceCaches);
      return reply.status(202).send(ok(importStatus(req.params.token)!));
    },
  );

  app.get<{ Params: { token: string } }>("/data/import/:token", async (req, reply) => {
    const status = importStatus(req.params.token);
    if (!status) return reply.status(404).send(err("not_found", "No such import"));
    return reply.send(ok(status));
  });

  app.delete<{ Params: { token: string } }>("/data/import/:token", async (req, reply) => {
    await discardImport(req.params.token);
    return reply.send(ok({ deleted: true as const }));
  });
}

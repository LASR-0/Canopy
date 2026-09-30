import type { FastifyInstance } from "fastify";
import { createReadStream } from "node:fs";
import { sqliteConnection } from "../../store/index.js";
import { PHOTO_DIR } from "../../store/paths.js";
import { MAX_PHOTO_BYTES, findPhoto, storePhoto } from "../../grow/journal-photos.js";
import { err, ok } from "../reply.js";

export async function journalPhotoRoutes(app: FastifyInstance): Promise<void> {
  // The upload is the image itself, not JSON or a form: one photo per request,
  // which needs no multipart parser. Registered inside this plugin, so the
  // raised body limit applies to these routes only.
  app.addContentTypeParser(
    ["image/jpeg", "image/png", "image/webp"],
    { parseAs: "buffer", bodyLimit: MAX_PHOTO_BYTES },
    (_req, body, done) => done(null, body),
  );

  /**
   * Store a photo for an entry not saved yet. `width` and `height` come from
   * the renderer, which has already decoded the image to shrink it.
   */
  app.post<{ Params: { workspaceId: string }; Querystring: { width?: string; height?: string }; Body: Buffer }>(
    "/workspaces/:workspaceId/journal-photos",
    async (req, reply) => {
      if (!Buffer.isBuffer(req.body)) {
        return reply.status(415).send(err("validation_failed", "Send the photo as image/jpeg, image/png or image/webp"));
      }
      const photo = await storePhoto(sqliteConnection, PHOTO_DIR, {
        workspaceId: req.params.workspaceId,
        bytes: req.body,
        width: Number(req.query.width),
        height: Number(req.query.height),
      });
      if (typeof photo === "string") return reply.status(400).send(err("validation_failed", photo));
      return reply.status(201).send(ok(photo));
    },
  );

  /** The file. An id never names different bytes, so it can be cached for good. */
  app.get<{ Params: { id: string } }>("/journal-photos/:id", async (req, reply) => {
    const found = findPhoto(sqliteConnection, PHOTO_DIR, req.params.id);
    if (!found) return reply.status(404).send(err("not_found", "Photo not found"));
    return reply
      .header("content-type", found.type)
      .header("cache-control", "private, max-age=31536000, immutable")
      .send(createReadStream(found.file));
  });
}

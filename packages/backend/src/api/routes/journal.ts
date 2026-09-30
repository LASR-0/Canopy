import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { ok, err } from "../reply.js";
import type { JournalEntry, JournalEntryBody, JournalPhotoRef } from "@canopy/shared-types";
import { db, sqliteConnection } from "../../store/index.js";
import { PHOTO_DIR } from "../../store/paths.js";
import {
  deleteEntryPhotoFiles,
  photoRefsProblem,
  photosForEntries,
  setEntryPhotos,
} from "../../grow/journal-photos.js";
import { grows, journalEntries } from "../../store/schema.js";
import {
  JOURNAL_TYPES,
  MAX_TITLE_LENGTH,
  envSnapshot,
  growDayAt,
  parseMeasurements,
  parseNewEntry,
  photoTitle,
  titleFrom,
} from "../../grow/journal.js";

function rowToEntry(row: typeof journalEntries.$inferSelect): JournalEntry {
  const e: JournalEntry = {
    id: row.id,
    workspaceId: row.workspaceId,
    growId: row.growId,
    growDay: row.growDay,
    growWeek: row.growWeek,
    type: row.type as JournalEntry["type"],
    title: row.title,
    createdAt: row.createdAt,
  };
  if (row.body)       e.body = row.body;
  if (row.hypothesis) e.hypothesis = row.hypothesis;
  if (row.result)     e.result = row.result;
  if (row.measurementsJson) {
    try { e.measurements = JSON.parse(row.measurementsJson) as [string, string][]; } catch { /* skip */ }
  }
  if (row.envTempC != null)  e.envTempC = row.envTempC;
  if (row.envRhPct != null)  e.envRhPct = row.envRhPct;
  if (row.envVpdKpa != null) e.envVpdKpa = row.envVpdKpa;
  if (row.updatedAt)         e.updatedAt = row.updatedAt;
  return e;
}

async function findGrow(workspaceId: string, growId: string) {
  const [grow] = await db
    .select()
    .from(grows)
    .where(and(eq(grows.id, growId), eq(grows.workspaceId, workspaceId)));
  return grow;
}

type Params = { workspaceId: string; growId: string };

/** Entries with their photos, in one query for the lot. */
function withPhotos(entries: JournalEntry[]): JournalEntry[] {
  const photos = photosForEntries(sqliteConnection, entries.map((e) => e.id));
  return entries.map((e) => {
    const list = photos.get(e.id);
    return list ? { ...e, photos: list } : e;
  });
}

export async function journalRoutes(app: FastifyInstance): Promise<void> {
  /** Newest first, which is how the notebook reads. */
  app.get<{ Params: Params }>(
    "/workspaces/:workspaceId/grows/:growId/journal",
    async (req, reply) => {
      const rows = await db
        .select()
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.workspaceId, req.params.workspaceId),
            eq(journalEntries.growId, req.params.growId),
          ),
        )
        .orderBy(desc(journalEntries.createdAt));
      return reply.send(ok(withPhotos(rows.map(rowToEntry))));
    },
  );

  /**
   * The day, week and environment are stamped here and ignored in the body.
   *
   * Accepting them from the caller would let two clocks disagree about which day
   * an entry belongs to, and would let a note carry conditions nobody measured.
   */
  app.post<{ Params: Params; Body: JournalEntryBody }>(
    "/workspaces/:workspaceId/grows/:growId/journal",
    async (req, reply) => {
      const { workspaceId, growId } = req.params;
      const grow = await findGrow(workspaceId, growId);
      if (!grow) return reply.status(404).send(err("not_found", "Grow not found"));
      if (!grow.startedAt) {
        return reply
          .status(409)
          .send(err("conflict", "This grow has not started, so there is no grow day to file an entry under"));
      }

      const content = parseNewEntry(req.body ?? {});
      if (typeof content === "string") {
        return reply.status(400).send(err("validation_failed", content));
      }

      const now = new Date();
      const id = randomUUID();
      const photos = req.body?.photos;
      if (photos !== undefined) {
        const problem = photoRefsProblem(sqliteConnection, workspaceId, id, photos);
        if (problem) return reply.status(400).send(err("validation_failed", problem));
      }
      await db.insert(journalEntries).values({
        id,
        workspaceId,
        growId,
        ...growDayAt(grow.startedAt, now),
        type: content.type,
        title: content.title,
        body: content.body,
        hypothesis: content.hypothesis,
        result: content.result,
        measurementsJson: content.measurements ? JSON.stringify(content.measurements) : null,
        ...(await envSnapshot(workspaceId, now)),
        createdAt: now.toISOString(),
      });

      if (photos?.length) await setEntryPhotos(sqliteConnection, PHOTO_DIR, workspaceId, id, photos);

      const [row] = await db.select().from(journalEntries).where(eq(journalEntries.id, id));
      return reply.status(201).send(ok(withPhotos([rowToEntry(row!)])[0]!));
    },
  );

  /**
   * Edits the content only. An empty string clears a field, which is how a
   * typed client says "remove this" when the field is optional-not-nullable.
   */
  app.patch<{ Params: Params & { id: string }; Body: JournalEntryBody }>(
    "/workspaces/:workspaceId/grows/:growId/journal/:id",
    async (req, reply) => {
      const { workspaceId, growId, id } = req.params;
      const where = and(
        eq(journalEntries.id, id),
        eq(journalEntries.workspaceId, workspaceId),
        eq(journalEntries.growId, growId),
      );
      const [existing] = await db.select().from(journalEntries).where(where);
      if (!existing) return reply.status(404).send(err("not_found", "Journal entry not found"));

      const b = req.body ?? {};
      const photos: JournalPhotoRef[] | undefined = b.photos;
      if (photos !== undefined) {
        const problem = photoRefsProblem(sqliteConnection, workspaceId, id, photos);
        if (problem) return reply.status(400).send(err("validation_failed", problem));
      }
      const clean = (v: string) => (v.trim() ? v.trim() : null);
      const updates: Partial<typeof journalEntries.$inferInsert> = {};

      if (b.type !== undefined) {
        if (!JOURNAL_TYPES.includes(b.type)) {
          return reply.status(400).send(err("validation_failed", `Unknown entry type "${String(b.type)}"`));
        }
        updates.type = b.type;
      }
      if (b.body !== undefined)       updates.body = clean(b.body);
      if (b.hypothesis !== undefined) updates.hypothesis = clean(b.hypothesis);
      if (b.result !== undefined)     updates.result = clean(b.result);
      if (b.measurements !== undefined) {
        const measurements = parseMeasurements(b.measurements);
        if (typeof measurements === "string") {
          return reply.status(400).send(err("validation_failed", measurements));
        }
        updates.measurementsJson = measurements ? JSON.stringify(measurements) : null;
      }
      if (b.title !== undefined) {
        // A blank title falls back to the body rather than leaving the entry
        // unnamed in the notebook.
        const body = updates.body !== undefined ? updates.body : existing.body;
        const photoList = photos ?? photosForEntries(sqliteConnection, [id]).get(id) ?? [];
        const title = clean(b.title) ?? (titleFrom(body ?? "") || photoTitle(photoList));
        if (!title) return reply.status(400).send(err("validation_failed", "An entry needs a title or a body"));
        updates.title = title.slice(0, MAX_TITLE_LENGTH);
      }

      if (photos !== undefined) {
        await setEntryPhotos(sqliteConnection, PHOTO_DIR, workspaceId, id, photos);
        updates.updatedAt = new Date().toISOString();
      }
      if (Object.keys(updates).length > 0) {
        updates.updatedAt = new Date().toISOString();
        await db.update(journalEntries).set(updates).where(where);
      }
      const [row] = await db.select().from(journalEntries).where(where);
      return reply.send(ok(withPhotos([rowToEntry(row!)])[0]!));
    },
  );

  app.delete<{ Params: Params & { id: string } }>(
    "/workspaces/:workspaceId/grows/:growId/journal/:id",
    async (req, reply) => {
      const { workspaceId, growId, id } = req.params;
      // The rows cascade with the entry; the files have to be removed by hand.
      await deleteEntryPhotoFiles(sqliteConnection, PHOTO_DIR, id);
      const removed = await db
        .delete(journalEntries)
        .where(
          and(
            eq(journalEntries.id, id),
            eq(journalEntries.workspaceId, workspaceId),
            eq(journalEntries.growId, growId),
          ),
        )
        .returning({ id: journalEntries.id });
      if (removed.length === 0) return reply.status(404).send(err("not_found", "Journal entry not found"));
      return reply.send(ok({ deleted: true as const }));
    },
  );
}

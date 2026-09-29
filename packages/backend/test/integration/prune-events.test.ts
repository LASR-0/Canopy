/**
 * Integration — event retention (Phase 7.5)
 *
 * Events had no retention at all, and a flapping threshold alert wrote 13,387
 * rows in a day. They have no rollup to protect, so the prune is a plain
 * cutoff — but it must spare everything inside the window.
 */
import { describe, it, expect, afterEach } from "vitest";
import { createTestDb, type TestDb } from "../helpers/db.js";
import { pruneEvents } from "../../src/scheduler/jobs/prune.js";

let testDb: TestDb | undefined;
afterEach(() => testDb?.close());

const NOW = new Date("2026-09-29T12:00:00.000Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

function seed(db: TestDb["sqlite"]) {
  db.prepare(`INSERT INTO workspaces (id, name, created_at) VALUES ('ws-1', 'Tent', ?)`).run(daysAgo(400));
  const insert = db.prepare(
    `INSERT INTO events (id, workspace_id, type, description, occurred_at) VALUES (?, 'ws-1', 'threshold_alert', 'x', ?)`,
  );
  insert.run("old", daysAgo(120));
  insert.run("edge", daysAgo(89));
  insert.run("new", daysAgo(1));
}

describe("pruneEvents", () => {
  it("drops events past the window and keeps the rest", () => {
    testDb = createTestDb();
    seed(testDb.sqlite);

    const outcome = pruneEvents(testDb.sqlite, 90, NOW);

    expect(outcome.deleted).toBe(1);
    const left = testDb.sqlite.prepare(`SELECT id FROM events ORDER BY id`).all() as { id: string }[];
    expect(left.map((r) => r.id)).toEqual(["edge", "new"]);
  });

  it("defaults the setting to 90 days on a fresh database", () => {
    testDb = createTestDb();
    const row = testDb.sqlite.prepare(`SELECT event_retention_days AS d FROM app_settings WHERE id = 1`).get() as { d: number };
    expect(row.d).toBe(90);
  });
});

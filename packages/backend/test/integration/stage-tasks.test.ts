/**
 * Integration — maintenance that follows the grow's stages (Phase 7.5 H)
 *
 * A stage task that never falls due, or a Flower-only task that opens Flower
 * weeks overdue, fails silently: the list just looks quiet or looks wrong.
 */
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { createTestDb, type TestDb } from "../helpers/db.js";
import { syncStageTasks } from "../../src/grow/stage-tasks.js";

let testDb: TestDb;
const DAY = 86_400_000;
// Plan: 2 weeks seedling, 4 veg, 8 flower, 1 flush. Started 20 days before NOW: in veg.
const STARTED = "2026-09-10T08:00:00.000Z";
const NOW = new Date(Date.parse(STARTED) + 20 * DAY);
const FLOWER_STARTS = new Date(Date.parse(STARTED) + 42 * DAY).toISOString();
const VEG_STARTS = new Date(Date.parse(STARTED) + 14 * DAY).toISOString();

beforeEach(() => {
  testDb = createTestDb();
  const db = testDb.sqlite;
  db.prepare(`INSERT INTO workspaces (id, name, created_at) VALUES ('ws', 'Tent', ?)`).run(STARTED);
  db.prepare(`INSERT INTO grows (id, workspace_id, name, status, started_at, planned_seedling_weeks, planned_veg_weeks, planned_flower_weeks, planned_flush_weeks)
    VALUES ('g', 'ws', 'Grow', 'active', ?, 2, 4, 8, 1)`).run(STARTED);
  db.prepare(`UPDATE workspaces SET active_grow_id = 'g' WHERE id = 'ws'`).run();
});
afterEach(() => testDb.close());

function task(id: string, fields: { cadence?: string; stages?: string[]; startStage?: string; nextDueAt?: string; lastDoneAt?: string }) {
  testDb.sqlite.prepare(`INSERT INTO maintenance_tasks (id, workspace_id, name, cadence, stages_json, start_stage, next_due_at, last_done_at, created_at)
    VALUES (?, 'ws', ?, ?, ?, ?, ?, ?, ?)`).run(
    id, id, fields.cadence ?? "daily", fields.stages ? JSON.stringify(fields.stages) : null,
    fields.startStage ?? null, fields.nextDueAt ?? null, fields.lastDoneAt ?? null, STARTED,
  );
}
const due = (id: string) => (testDb.sqlite.prepare(`SELECT next_due_at d FROM maintenance_tasks WHERE id = ?`).get(id) as { d: string | null }).d;

describe("when a stage starts", () => {
  it("falls due on the day the plan says the stage begins", () => {
    task("bloom-nutes", { cadence: "stage", startStage: "flowering" });
    syncStageTasks(testDb.sqlite, NOW);
    expect(due("bloom-nutes")).toBe(FLOWER_STARTS);
  });

  it("moves when the plan is edited", () => {
    task("bloom-nutes", { cadence: "stage", startStage: "flowering" });
    testDb.sqlite.prepare(`UPDATE grows SET planned_veg_weeks = 5`).run();
    syncStageTasks(testDb.sqlite, NOW);
    expect(due("bloom-nutes")).toBe(new Date(Date.parse(STARTED) + 49 * DAY).toISOString());
  });

  it("is done for this grow once completed after the stage began", () => {
    task("veg-feed", { cadence: "stage", startStage: "vegetative", lastDoneAt: new Date(Date.parse(VEG_STARTS) + DAY).toISOString() });
    syncStageTasks(testDb.sqlite, NOW);
    expect(due("veg-feed")).toBeNull();
  });

  it("has no date while no grow is running", () => {
    testDb.sqlite.prepare(`UPDATE workspaces SET active_grow_id = NULL`).run();
    task("bloom-nutes", { cadence: "stage", startStage: "flowering", nextDueAt: FLOWER_STARTS });
    syncStageTasks(testDb.sqlite, NOW);
    expect(due("bloom-nutes")).toBeNull();
  });
});

describe("stage-scoped recurring tasks", () => {
  it("keep their date inside their stages", () => {
    const tomorrow = new Date(NOW.getTime() + DAY).toISOString();
    task("veg-check", { stages: ["vegetative"], nextDueAt: tomorrow });
    syncStageTasks(testDb.sqlite, NOW);
    expect(due("veg-check")).toBe(tomorrow);
  });

  it("come due at once when they enter scope with no date", () => {
    task("veg-check", { stages: ["vegetative"] });
    syncStageTasks(testDb.sqlite, NOW);
    expect(due("veg-check")).toBe(NOW.toISOString());
  });

  it("wait for the start of their next stage outside it, rather than piling up overdue", () => {
    task("trichomes", { stages: ["flowering"], nextDueAt: STARTED });
    syncStageTasks(testDb.sqlite, NOW);
    expect(due("trichomes")).toBe(FLOWER_STARTS);
  });

  it("have no date once their stages are past", () => {
    task("seedling-dome", { stages: ["seedling"], nextDueAt: STARTED });
    syncStageTasks(testDb.sqlite, NOW);
    expect(due("seedling-dome")).toBeNull();
  });

  it("leave unscoped tasks alone", () => {
    task("daily", { nextDueAt: STARTED });
    expect(syncStageTasks(testDb.sqlite, NOW)).toBe(0);
    expect(due("daily")).toBe(STARTED);
  });
});

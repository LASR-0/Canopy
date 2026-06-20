/**
 * Integration — schema bootstrap
 *
 * Verifies that createTestDb() produces a correctly structured, seeded database.
 * This is the baseline test — if these pass, integration tests for job handlers
 * and store queries can trust their DB scaffolding.
 */
import { describe, it, expect, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "../helpers/db.js";

describe("createTestDb", () => {
  let testDb: TestDb;

  afterEach(() => testDb?.close());

  it("creates all 19 tables", () => {
    testDb = createTestDb();
    const tables = testDb.sqlite
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
      .all() as { name: string }[];

    const names = tables.map((t) => t.name);
    expect(names).toContain("workspaces");
    expect(names).toContain("app_settings");
    expect(names).toContain("devices");
    expect(names).toContain("role_assignments");
    expect(names).toContain("sensor_thresholds");
    expect(names).toContain("readings_raw");
    expect(names).toContain("readings_hourly");
    expect(names).toContain("readings_daily");
    expect(names).toContain("grow_templates");
    expect(names).toContain("grows");
    expect(names).toContain("grow_milestones");
    expect(names).toContain("journal_entries");
    expect(names).toContain("events");
    expect(names).toContain("automations");
    expect(names).toContain("maintenance_tasks");
    expect(names).toContain("maintenance_completions");
    expect(names).toContain("maintenance_day_notes");
    expect(names).toContain("chart_layouts");
    expect(names).toContain("jobs");
  });

  it("seeds the 4 grow templates", async () => {
    testDb = createTestDb();
    const { db, sqlite: s } = testDb;
    const { growTemplates } = await import("../../src/store/schema.js");

    const rows = await db.select().from(growTemplates);
    expect(rows).toHaveLength(4);

    const ids = rows.map((r) => r.id);
    expect(ids).toContain("photo");
    expect(ids).toContain("auto");
    expect(ids).toContain("sog");
    expect(ids).toContain("longveg");

    const photo = rows.find((r) => r.id === "photo")!;
    expect(photo.seedlingWeeks).toBe(2);
    expect(photo.vegWeeks).toBe(4);
    expect(photo.flowerWeeks).toBe(8);
    expect(photo.flushWeeks).toBe(1);
  });

  it("seeds app_settings row with correct defaults", () => {
    testDb = createTestDb();
    const row = testDb.sqlite
      .prepare(`SELECT * FROM app_settings WHERE id = 1`)
      .get() as Record<string, unknown>;

    expect(row).toBeTruthy();
    expect(row["theme"]).toBe("dark");
    expect(row["unit_temperature"]).toBe("C");
    expect(row["raw_retention_days"]).toBe(7);
    expect(row["hourly_retention_days"]).toBe(90);
    expect(row["archive_after_days"]).toBe(30);
    expect(row["backup_enabled"]).toBe(0);
  });

  it("starts with an empty schema when seed = false", async () => {
    testDb = createTestDb({ seed: false });
    const { growTemplates } = await import("../../src/store/schema.js");

    const rows = await testDb.db.select().from(growTemplates);
    expect(rows).toHaveLength(0);
  });

  it("each call returns an isolated database — no shared state", async () => {
    const a = createTestDb();
    const b = createTestDb();

    const { workspaces } = await import("../../src/store/schema.js");

    await a.db.insert(workspaces).values({
      id: "ws-a",
      name: "Workspace A",
      createdAt: new Date().toISOString(),
      archived: false,
      timezone: "UTC",
    });

    const rowsInB = await b.db.select().from(workspaces).where(eq(workspaces.id, "ws-a"));
    expect(rowsInB).toHaveLength(0);

    a.close();
    b.close();
  });
});

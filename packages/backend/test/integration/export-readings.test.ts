/**
 * Integration — readings export (Phase 7.5 D)
 *
 * The export pages through the table so a large one never stalls the
 * controller. Paging is where rows go missing or repeat, so that is what these
 * pin: every row exactly once, including across a page boundary that falls
 * inside a run of identical timestamps.
 */
import { describe, it, expect, afterEach } from "vitest";
import { createTestDb, type TestDb } from "../helpers/db.js";
import { EXPORT_PAGE, csvField, readingsCsv } from "../../src/export/readings.js";

let testDb: TestDb | undefined;
afterEach(() => testDb?.close());

async function collect(gen: AsyncGenerator<string>): Promise<string[]> {
  let text = "";
  for await (const chunk of gen) text += chunk;
  return text.trimEnd().split("\n");
}

describe("readingsCsv", () => {
  it("exports every row once across page boundaries, even at a shared timestamp", async () => {
    testDb = createTestDb();
    const db = testDb.sqlite;
    const insert = db.prepare(
      `INSERT INTO readings_raw (workspace_id, device_id, channel, metric, unit, value, recorded_at) VALUES ('ws-1', 'dev-1', 'temp', 'temperature', 'C', ?, ?)`,
    );
    const total = EXPORT_PAGE + 250;
    db.transaction(() => {
      for (let i = 0; i < total; i++) {
        // The first page ends inside a block of identical timestamps.
        const at = i >= EXPORT_PAGE - 100 && i < EXPORT_PAGE + 100
          ? "2026-09-30T00:10:00.000Z"
          : new Date(Date.parse("2026-09-30T00:00:00Z") + i * 1000).toISOString();
        insert.run(i, at);
      }
    })();

    const lines = await collect(readingsCsv(db, {
      workspaceId: "ws-1", metrics: ["temperature"], from: "2026-09-29T00:00:00Z", to: "2026-10-01T00:00:00Z", resolution: "raw",
    }, new Map([["dev-1", "Canopy Temperature"]])));

    expect(lines[0]).toBe("timestamp,metric,unit,value,device,channel");
    const values = lines.slice(1).map((l) => Number(l.split(",")[3]));
    expect(values).toHaveLength(total);
    expect(new Set(values).size).toBe(total);
    expect(lines[1]).toContain("Canopy Temperature");
  });

  it("keeps to the window and the metrics asked for", async () => {
    testDb = createTestDb();
    const db = testDb.sqlite;
    const insert = db.prepare(
      `INSERT INTO readings_raw (workspace_id, device_id, channel, metric, unit, value, recorded_at) VALUES ('ws-1', 'dev-1', 'c', ?, 'u', 1, ?)`,
    );
    insert.run("temperature", "2026-09-30T00:00:00.000Z");  // exactly at `from`
    insert.run("temperature", "2026-09-29T23:59:59.000Z");  // before
    insert.run("humidity", "2026-09-30T01:00:00.000Z");     // not asked for

    const lines = await collect(readingsCsv(db, {
      workspaceId: "ws-1", metrics: ["temperature"], from: "2026-09-30T00:00:00.000Z", to: "2026-09-30T02:00:00.000Z", resolution: "raw",
    }, new Map()));

    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("2026-09-30T00:00:00.000Z");
  });

  it("adds min and max at rollup resolutions", async () => {
    testDb = createTestDb();
    testDb.sqlite.prepare(
      `INSERT INTO readings_hourly (workspace_id, device_id, channel, metric, unit, value, min_value, max_value, recorded_at)
       VALUES ('ws-1', 'dev-1', 'c', 'temperature', 'C', 24, 22, 26, '2026-09-30T01:00:00.000Z')`,
    ).run();

    const lines = await collect(readingsCsv(testDb.sqlite, {
      workspaceId: "ws-1", metrics: ["temperature"], from: "2026-09-30T00:00:00Z", to: "2026-09-30T02:00:00Z", resolution: "hourly",
    }, new Map()));

    expect(lines[0]).toBe("timestamp,metric,unit,average,min,max,device,channel");
    expect(lines[1]).toBe("2026-09-30T01:00:00.000Z,temperature,C,24,22,26,dev-1,c");
  });
});

describe("csvField", () => {
  it("quotes only what needs it", () => {
    expect(csvField("Tent 1")).toBe("Tent 1");
    expect(csvField('Fan, "big"')).toBe('"Fan, ""big"""');
    expect(csvField(null)).toBe("");
  });
});

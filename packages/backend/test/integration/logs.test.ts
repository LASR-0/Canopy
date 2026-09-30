/**
 * Integration — the Logs tab (Phase 7.5 D)
 *
 * Threshold alerts are folded into out-of-range periods. Getting the fold
 * wrong either splits one excursion into many rows, which is the noise the tab
 * exists to remove, or merges two, which hides that a reading came back.
 */
import { describe, it, expect, afterEach } from "vitest";
import { createTestDb, type TestDb } from "../helpers/db.js";
import { logsFor } from "../../src/logs/index.js";

let testDb: TestDb | undefined;
afterEach(() => testDb?.close());

const NOW = Date.parse("2026-09-30T12:00:00.000Z");
const minsAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();
const TO = minsAgo(0);
const FROM = minsAgo(24 * 60);

let n = 0;
function setup(): TestDb["sqlite"] {
  testDb = createTestDb();
  testDb.sqlite.prepare(`INSERT INTO workspaces (id, name, created_at) VALUES ('ws-1', 'Tent', ?)`).run(minsAgo(99_999));
  return testDb.sqlite;
}
function alert(db: TestDb["sqlite"], at: string, severity: string | null, channel = "soil", description = "soil_moisture 44% below range 45–60") {
  db.prepare(
    `INSERT INTO events (id, workspace_id, type, source_id, source_label, description, severity, occurred_at)
     VALUES (?, 'ws-1', 'threshold_alert', 'dev-1', ?, ?, ?, ?)`,
  ).run(`a${++n}`, channel, description, severity, at);
}
function event(db: TestDb["sqlite"], type: string, at: string) {
  db.prepare(
    `INSERT INTO events (id, workspace_id, type, description, occurred_at) VALUES (?, 'ws-1', ?, 'x', ?)`,
  ).run(`e${++n}`, type, at);
}

describe("logsFor — out-of-range periods", () => {
  it("folds an excursion's steps into one period with its worst level", () => {
    const db = setup();
    alert(db, minsAgo(60), "warn");
    alert(db, minsAgo(55), "err");
    alert(db, minsAgo(50), "warn");
    alert(db, minsAgo(40), null);

    const { periods } = logsFor(db, "ws-1", FROM, TO);

    expect(periods).toHaveLength(1);
    expect(periods[0]).toMatchObject({
      startedAt: minsAgo(60), endedAt: minsAgo(40), worst: "err", metric: "soil_moisture", channel: "soil",
    });
    expect(periods[0]!.steps).toHaveLength(4);
  });

  it("keeps two excursions apart when the reading came back between them", () => {
    const db = setup();
    alert(db, minsAgo(60), "warn");
    alert(db, minsAgo(50), null);
    alert(db, minsAgo(30), "err");
    alert(db, minsAgo(20), null);

    expect(logsFor(db, "ws-1", FROM, TO).periods.map((p) => p.worst)).toEqual(["err", "warn"]);
  });

  it("leaves a period without a recovery ongoing", () => {
    const db = setup();
    alert(db, minsAgo(10), "err");

    expect(logsFor(db, "ws-1", FROM, TO).periods[0]!.endedAt).toBeUndefined();
  });

  it("shows the real start of a period that began before the window", () => {
    const db = setup();
    alert(db, minsAgo(26 * 60), "warn");
    alert(db, minsAgo(60), null);

    const [period] = logsFor(db, "ws-1", FROM, TO).periods;
    expect(period!.startedAt).toBe(minsAgo(26 * 60));
  });

  it("leaves out periods that ended before the window", () => {
    const db = setup();
    alert(db, minsAgo(30 * 60), "warn");
    alert(db, minsAgo(29 * 60), null);

    expect(logsFor(db, "ws-1", FROM, TO).periods).toHaveLength(0);
  });

  it("tracks channels separately", () => {
    const db = setup();
    alert(db, minsAgo(60), "warn", "soil");
    alert(db, minsAgo(55), "err", "temp", "temperature 31 C above range 18–28");
    alert(db, minsAgo(50), null, "soil");

    const { periods } = logsFor(db, "ws-1", FROM, TO);
    expect(periods).toHaveLength(2);
    expect(periods.find((p) => p.channel === "temp")).toMatchObject({ metric: "temperature", worst: "err" });
    expect(periods.find((p) => p.channel === "soil")!.endedAt).toBe(minsAgo(50));
  });
});

describe("logsFor — other problems", () => {
  it("lists failed runs, device changes and due tasks, but not routine firings", () => {
    const db = setup();
    event(db, "automation_failed", minsAgo(30));
    event(db, "device_offline", minsAgo(20));
    event(db, "device_online", minsAgo(10));
    event(db, "maintenance_due", minsAgo(5));
    event(db, "automation_fired", minsAgo(4));

    const { events } = logsFor(db, "ws-1", FROM, TO);
    expect(events.map((e) => e.type)).toEqual(["maintenance_due", "device_online", "device_offline", "automation_failed"]);
  });
});

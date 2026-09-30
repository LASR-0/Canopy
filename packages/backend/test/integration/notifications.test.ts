/**
 * Integration — notifications (Phase 7.5 C.7)
 *
 * The sidebar badges count what the grower has not seen, and a badge that
 * counts the wrong things is worse than none: routine activity would keep it
 * permanently lit, and a missed alert would leave it dark when it matters.
 */
import { describe, it, expect, afterEach } from "vitest";
import { createTestDb, type TestDb } from "../helpers/db.js";
import {
  announceDueTasks,
  markNotificationsSeen,
  notificationSummary,
} from "../../src/notifications/index.js";

let testDb: TestDb | undefined;
afterEach(() => testDb?.close());

const NOW = new Date("2026-09-30T12:00:00.000Z");
const minsAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();
const daysAgo = (d: number) => minsAgo(d * 1440);

function setup(): TestDb["sqlite"] {
  testDb = createTestDb();
  const db = testDb.sqlite;
  db.prepare(`INSERT INTO workspaces (id, name, created_at) VALUES ('ws-1', 'Tent', ?)`).run(daysAgo(30));
  return db;
}

let n = 0;
function event(db: TestDb["sqlite"], type: string, at: string, severity: string | null = null, ws = "ws-1") {
  db.prepare(
    `INSERT INTO events (id, workspace_id, type, description, severity, occurred_at) VALUES (?, ?, ?, 'x', ?, ?)`,
  ).run(`e${++n}`, ws, type, severity, at);
}

describe("notificationSummary", () => {
  it("counts alerts per page and ignores routine activity", () => {
    const db = setup();
    event(db, "threshold_alert", minsAgo(5), "warn");
    event(db, "threshold_alert", minsAgo(4), "err");
    event(db, "threshold_alert", minsAgo(3));            // a recovery
    event(db, "automation_failed", minsAgo(3), "err");
    event(db, "automation_fired", minsAgo(2));
    event(db, "device_offline", minsAgo(2), "warn");
    event(db, "device_online", minsAgo(1));
    event(db, "maintenance_due", minsAgo(1), "warn");

    const { unseen, recent } = notificationSummary(db, "ws-1", NOW);

    expect(unseen).toEqual({ logging: 2, automation: 1, maintenance: 1, settings: 1 });
    expect(recent).toHaveLength(5);
    expect(recent[0]!.channel).toBe("maintenance");
  });

  it("reaches back a week for a page never marked seen, not through all history", () => {
    const db = setup();
    event(db, "device_offline", daysAgo(10));
    event(db, "device_offline", daysAgo(2));

    expect(notificationSummary(db, "ws-1", NOW).unseen.settings).toBe(1);
  });

  it("keeps workspaces apart", () => {
    const db = setup();
    db.prepare(`INSERT INTO workspaces (id, name, created_at) VALUES ('ws-2', 'Other', ?)`).run(daysAgo(30));
    event(db, "device_offline", minsAgo(5), null, "ws-2");

    expect(notificationSummary(db, "ws-1", NOW).unseen.settings).toBe(0);
  });
});

describe("markNotificationsSeen", () => {
  it("clears the page's count and marks its items seen", () => {
    const db = setup();
    event(db, "threshold_alert", minsAgo(5), "warn");
    markNotificationsSeen(db, "ws-1", ["logging"], NOW);

    const { unseen, recent } = notificationSummary(db, "ws-1", NOW);
    expect(unseen.logging).toBe(0);
    expect(recent[0]!.seen).toBe(true);
  });

  it("leaves other pages alone", () => {
    const db = setup();
    event(db, "threshold_alert", minsAgo(5), "warn");
    event(db, "device_offline", minsAgo(5));
    markNotificationsSeen(db, "ws-1", ["logging"], NOW);

    expect(notificationSummary(db, "ws-1", NOW).unseen.settings).toBe(1);
  });

  it("counts what arrives afterwards", () => {
    const db = setup();
    event(db, "threshold_alert", minsAgo(5), "warn");
    markNotificationsSeen(db, "ws-1", undefined, new Date(minsAgo(2)));
    event(db, "threshold_alert", minsAgo(1), "err");

    const { unseen, recent } = notificationSummary(db, "ws-1", NOW);
    expect(unseen.logging).toBe(1);
    expect(recent.map((r) => r.seen)).toEqual([false, true]);
  });
});

describe("announceDueTasks", () => {
  function task(db: TestDb["sqlite"], id: string, nextDueAt: string | null, notifications = 1, ws = "ws-1") {
    db.prepare(
      `INSERT INTO maintenance_tasks (id, workspace_id, name, cadence, notifications, next_due_at, created_at)
       VALUES (?, ?, ?, 'daily', ?, ?, ?)`,
    ).run(id, ws, `Task ${id}`, notifications, nextDueAt, daysAgo(10));
  }
  const dueEvents = (db: TestDb["sqlite"]) =>
    db.prepare(`SELECT source_id FROM events WHERE type = 'maintenance_due' ORDER BY source_id`).all() as { source_id: string }[];

  it("announces a task that has come due, once", () => {
    const db = setup();
    task(db, "t1", minsAgo(10));

    expect(announceDueTasks(db, NOW)).toBe(1);
    expect(announceDueTasks(db, new Date(NOW.getTime() + 60_000))).toBe(0);
    expect(dueEvents(db)).toEqual([{ source_id: "t1" }]);
  });

  it("skips tasks not yet due, without a due date, or with their bell off", () => {
    const db = setup();
    task(db, "future", minsAgo(-60));
    task(db, "undated", null);
    task(db, "muted", minsAgo(10), 0);

    expect(announceDueTasks(db, NOW)).toBe(0);
  });

  it("announces again once the task has moved on to its next due date", () => {
    const db = setup();
    task(db, "t1", minsAgo(10));
    announceDueTasks(db, NOW);

    // Completed: next due tomorrow, then that arrives.
    db.prepare(`UPDATE maintenance_tasks SET next_due_at = ? WHERE id = 't1'`).run(minsAgo(-1440));
    expect(announceDueTasks(db, new Date(NOW.getTime() + 1441 * 60_000))).toBe(1);
  });

  it("leaves archived workspaces alone", () => {
    const db = setup();
    db.prepare(`INSERT INTO workspaces (id, name, created_at, archived_at) VALUES ('ws-old', 'Old', ?, ?)`).run(daysAgo(30), daysAgo(1));
    task(db, "t1", minsAgo(10), 1, "ws-old");

    expect(announceDueTasks(db, NOW)).toBe(0);
  });
});

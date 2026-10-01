/**
 * Integration — additive column migration (Phase 7, Logging)
 *
 * `applyDDL` is all `CREATE TABLE IF NOT EXISTS`, which does nothing at all to a
 * database that already exists. A column added to a CREATE therefore reaches new
 * installs only, and the first write against an older database fails with "no
 * such column" — which is exactly how the rollup extremes would have broken the
 * existing dev database.
 *
 * Run against real SQLite: the whole behaviour under test is `PRAGMA table_info`
 * and `ALTER TABLE`, which a mock would assume rather than prove.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { addColumnIfMissing, applyColumnAdditions, applyDDL, seedData } from "../../src/store/ddl.js";

let sqlite: Database.Database;

/** A table shaped the way it was before the extremes columns were added. */
function createLegacyRollupTable(): void {
  sqlite.exec(`
    CREATE TABLE readings_hourly (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id  TEXT NOT NULL,
      device_id     TEXT NOT NULL,
      channel       TEXT NOT NULL,
      metric        TEXT NOT NULL,
      unit          TEXT NOT NULL,
      value         REAL NOT NULL,
      recorded_at   TEXT NOT NULL
    );
  `);
}

function columns(table: string): string[] {
  return (sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
    (c) => c.name,
  );
}

beforeEach(() => {
  sqlite = new Database(":memory:");
});

afterEach(() => sqlite?.close());

describe("addColumnIfMissing", () => {
  it("adds a column that is absent", () => {
    createLegacyRollupTable();
    expect(columns("readings_hourly")).not.toContain("min_value");

    expect(addColumnIfMissing(sqlite, "readings_hourly", "min_value", "REAL")).toBe(true);
    expect(columns("readings_hourly")).toContain("min_value");
  });

  it("is a no-op when the column is already there", () => {
    createLegacyRollupTable();
    addColumnIfMissing(sqlite, "readings_hourly", "min_value", "REAL");

    expect(addColumnIfMissing(sqlite, "readings_hourly", "min_value", "REAL")).toBe(false);
    expect(columns("readings_hourly").filter((c) => c === "min_value")).toHaveLength(1);
  });

  it("does nothing when the table does not exist", () => {
    // The CREATE owns a missing table. Reaching for ALTER here would throw on a
    // database being built from scratch, where this runs before nothing at all.
    expect(addColumnIfMissing(sqlite, "not_a_table", "min_value", "REAL")).toBe(false);
  });

  it("preserves existing rows, leaving the new column null", () => {
    createLegacyRollupTable();
    sqlite
      .prepare(
        `INSERT INTO readings_hourly
           (workspace_id, device_id, channel, metric, unit, value, recorded_at)
         VALUES ('ws-1','dev-1','ch','temperature','C', 21.5, '2026-03-01T00:00:00.000Z')`,
      )
      .run();

    addColumnIfMissing(sqlite, "readings_hourly", "min_value", "REAL");

    const row = sqlite
      .prepare("SELECT value, min_value FROM readings_hourly")
      .get() as { value: number; min_value: number | null };
    expect(row.value).toBe(21.5);
    expect(row.min_value).toBeNull();
  });
});

describe("applyColumnAdditions", () => {
  it("brings a legacy rollup table up to date", () => {
    createLegacyRollupTable();
    applyColumnAdditions(sqlite);

    expect(columns("readings_hourly")).toContain("min_value");
    expect(columns("readings_hourly")).toContain("max_value");
  });

  it("is safe to run repeatedly, as startup does", () => {
    createLegacyRollupTable();
    applyColumnAdditions(sqlite);
    applyColumnAdditions(sqlite);
    applyColumnAdditions(sqlite);

    expect(columns("readings_hourly").filter((c) => c === "min_value")).toHaveLength(1);
  });

  it("does not throw on a database with none of the tables yet", () => {
    // Startup order is applyDDL then applyColumnAdditions, but a caller running
    // them the other way round must not crash the controller on boot.
    expect(() => applyColumnAdditions(sqlite)).not.toThrow();
  });

  it("leaves a rollup insert with extremes working afterwards", () => {
    createLegacyRollupTable();
    applyColumnAdditions(sqlite);

    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO readings_hourly
             (workspace_id, device_id, channel, metric, unit,
              value, min_value, max_value, recorded_at)
           VALUES ('ws-1','dev-1','ch','temperature','C', 25, 20, 30, '2026-03-01T01:00:00.000Z')`,
        )
        .run(),
    ).not.toThrow();
  });
});

describe("MQTT credentials (Phase 8 F)", () => {
  /** app_settings and devices as they were before Phase 8 F. */
  function createLegacyTables(withDevice: boolean): void {
    sqlite.exec(`
      CREATE TABLE app_settings (id INTEGER PRIMARY KEY DEFAULT 1, theme TEXT NOT NULL DEFAULT 'dark');
      INSERT INTO app_settings (id) VALUES (1);
      CREATE TABLE devices (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    `);
    if (withDevice) sqlite.exec(`INSERT INTO devices (id, name) VALUES ('d1', 'Fan')`);
  }

  const required = () =>
    (sqlite.prepare(`SELECT mqtt_require_credentials r FROM app_settings`).get() as { r: number }).r;

  it("leaves an upgraded install with devices open: they connect without a credential today", () => {
    createLegacyTables(true);
    applyColumnAdditions(sqlite);
    expect(required()).toBe(0);
  });

  it("requires credentials on an upgraded install with no devices yet", () => {
    createLegacyTables(false);
    applyColumnAdditions(sqlite);
    expect(required()).toBe(1);
  });

  it("requires credentials on a fresh install, and seeds one shared credential once", () => {
    applyDDL(sqlite);
    applyColumnAdditions(sqlite);
    seedData(sqlite);
    seedData(sqlite);
    expect(required()).toBe(1);
    const creds = sqlite.prepare(`SELECT username, password, device_id FROM mqtt_credentials`).all() as
      { username: string; password: string; device_id: string | null }[];
    expect(creds).toHaveLength(1);
    expect(creds[0]).toMatchObject({ username: "canopy", device_id: null });
    expect(creds[0]!.password).toMatch(/^[A-Za-z0-9_-]{24}$/);
  });
});

describe("per-device credentials (Phase 8 G)", () => {
  it("renames how a device connected from 'credential' to 'shared', and adds discovery_key", () => {
    sqlite.exec(`
      CREATE TABLE devices (id TEXT PRIMARY KEY, name TEXT NOT NULL, mqtt_auth TEXT);
      INSERT INTO devices VALUES ('d1', 'Fan', 'credential'), ('d2', 'Pump', 'anonymous');
    `);
    applyColumnAdditions(sqlite);
    applyColumnAdditions(sqlite);
    const rows = sqlite.prepare(`SELECT id, mqtt_auth, discovery_key FROM devices ORDER BY id`).all();
    expect(rows).toEqual([
      { id: "d1", mqtt_auth: "shared", discovery_key: null },
      { id: "d2", mqtt_auth: "anonymous", discovery_key: null },
    ]);
  });

  it("deletes a device's credential with the device", () => {
    applyDDL(sqlite);
    applyColumnAdditions(sqlite);
    seedData(sqlite);
    sqlite.pragma("foreign_keys = ON");
    sqlite.exec(`
      INSERT INTO workspaces (id, name, created_at) VALUES ('w1', 'Tent', '2026-10-01');
      INSERT INTO devices (id, workspace_id, name, family, protocol, discovered_via) VALUES ('d1', 'w1', 'Fan', 'generic-mqtt', 'mqtt', 'mqtt-discovery');
      INSERT INTO mqtt_credentials (id, username, password, device_id, created_at) VALUES ('c1', 'canopy-00000001', 'x', 'd1', '2026-10-01');
    `);
    sqlite.exec(`DELETE FROM devices WHERE id = 'd1'`);
    const left = sqlite.prepare(`SELECT device_id FROM mqtt_credentials`).all();
    expect(left).toEqual([{ device_id: null }]);
  });
});

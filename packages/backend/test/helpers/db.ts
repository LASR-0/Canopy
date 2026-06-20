/**
 * Test database factory.
 *
 * Creates a fresh in-memory SQLite instance with the full schema applied.
 * Each call returns an isolated database — tests never share state.
 *
 * Usage:
 *   const { db, sqlite } = createTestDb();
 *   // seed specific rows, run the function under test, assert DB state
 */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { applyDDL, seedData } from "../../src/store/index.js";
import * as schema from "../../src/store/schema.js";

export interface TestDb {
  /** Drizzle ORM instance backed by the in-memory DB. */
  db: ReturnType<typeof drizzle<typeof schema>>;
  /** Raw better-sqlite3 connection — use for DDL-level assertions or seeding. */
  sqlite: Database.Database;
  /** Tear down the in-memory connection. Call in afterEach if desired. */
  close: () => void;
}

/**
 * @param seed  Whether to seed grow_templates and app_settings (default true).
 *              Pass false for tests that need a completely empty schema.
 */
export function createTestDb({ seed = true } = {}): TestDb {
  const sqlite = new Database(":memory:");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  applyDDL(sqlite);
  if (seed) seedData(sqlite);

  const db = drizzle(sqlite, { schema });

  return {
    db,
    sqlite,
    close: () => sqlite.close(),
  };
}

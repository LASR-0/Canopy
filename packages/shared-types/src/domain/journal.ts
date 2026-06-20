import type { Id, Timestamp } from "./common.js";

export type JournalEntryType =
  | "observation"
  | "experiment"
  | "technique"
  | "measurement"
  | "photo";

/**
 * A journal entry — always scoped to a grow.
 * grow_day and grow_week are computed at write time from the grow start date
 * and stored so the activity graph and history remain stable even if the grow
 * start date is later corrected.
 */
export interface JournalEntry {
  id: Id;
  workspaceId: Id;
  growId: Id;
  /** Which day of the grow this entry was created on. Stored at write time. */
  growDay: number;
  /** Which week of the grow. Stored at write time. */
  growWeek: number;
  type: JournalEntryType;
  title: string;
  /** Main text body — present on all entry types. */
  body?: string;

  // ── Experiment fields ────────────────────────────────────────────────────
  hypothesis?: string;
  result?: string;

  // ── Measurement fields ───────────────────────────────────────────────────
  /** Freeform key-value spot checks: [["pH","6.2"], ["EC","1.4 mS/cm"]] */
  measurements?: [string, string][];

  // ── Photo fields ─────────────────────────────────────────────────────────
  /** Local file paths, relative to Canopy data directory. */
  attachments?: string[];

  // ── Auto-stamped environment snapshot ───────────────────────────────────
  envTempC?: number;
  envRhPct?: number;
  envVpdKpa?: number;

  createdAt: Timestamp;
  updatedAt?: Timestamp;
}

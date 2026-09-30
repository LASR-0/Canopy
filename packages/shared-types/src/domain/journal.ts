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

  /** Photos, in order. Any entry type can have them. Absent when there are none. */
  photos?: JournalPhoto[];

  // ── Auto-stamped environment snapshot ───────────────────────────────────
  envTempC?: number;
  envRhPct?: number;
  envVpdKpa?: number;

  createdAt: Timestamp;
  updatedAt?: Timestamp;
}

/**
 * A photo on a journal entry. Stored by the controller in its data directory
 * and served at `GET /journal-photos/:id`. Uploaded before the entry is saved,
 * so the composer can show it straight away; saving the entry attaches it.
 */
export interface JournalPhoto {
  id: Id;
  /** Written beneath the photo, like on a Polaroid. */
  caption?: string;
  width: number;
  height: number;
}

/** How a create or edit names an entry's photos: in order, each with its caption. */
export interface JournalPhotoRef {
  id: Id;
  caption?: string;
}

/**
 * The body of a create or edit. `photos` replaces the entry's photos
 * wholesale: one left out is deleted.
 */
export type JournalEntryBody = Omit<Partial<JournalEntry>, "photos"> & { photos?: JournalPhotoRef[] };

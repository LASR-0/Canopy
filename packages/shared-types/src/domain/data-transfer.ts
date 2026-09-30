import type { Id, Timestamp } from "./common.js";

/**
 * Moving data between controllers: an export is everything in one `.canopy`
 * file; an import adds the workspaces chosen from one, beside the ones here,
 * and never replaces anything.
 */

/** One workspace in a file being imported, as the review step shows it. */
export interface ImportWorkspacePreview {
  /** Its id in the file. The import gives it a new one. */
  id: Id;
  name: string;
  /** Set when a workspace here already has the name; the import adds " (imported)". */
  importedName?: string;
  archived: boolean;
  grows: number;
  entries: number;
  photos: number;
  automations: number;
  devices: number;
  /**
   * Devices whose hardware (MQTT topics) already belongs to a device here.
   * They stay where they are; the imported copies are kept for history but
   * detached, so readings and commands never go to two places.
   */
  devicesAlreadyHere: number;
  readings: number;
}

/** A file uploaded, checked and waiting for the grower to choose what to import. */
export interface ImportPreview {
  token: string;
  exportedAt: Timestamp;
  workspaces: ImportWorkspacePreview[];
}

export interface ImportedWorkspace {
  /** Its new id here. */
  id: Id;
  name: string;
  grows: number;
  devices: number;
  detachedDevices: number;
  automations: number;
  readings: number;
  photos: number;
}

export type ImportState = "staged" | "importing" | "done" | "failed";

export interface ImportStatus {
  state: ImportState;
  /** What the import is doing, for the progress line. */
  step?: string;
  /** Readings copied so far, and in all: the long part. */
  done?: number;
  total?: number;
  result?: ImportedWorkspace[];
  error?: string;
}

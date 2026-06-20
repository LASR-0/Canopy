import type { Id, Timestamp } from "./common.js";

export type GrowStageName = "seedling" | "vegetative" | "flowering" | "flush" | "harvest";

export type GrowStatus = "planned" | "active" | "completed" | "aborted";

/** Predefined grow cycle template — defines default stage durations. */
export interface GrowTemplate {
  id: Id;
  name: string;
  seedlingWeeks: number;
  vegWeeks: number;
  flowerWeeks: number;
  flushWeeks: number;
}

/**
 * A grow cycle. Everything from planning through harvest (or abort) lives here.
 * The four stage week fields are always present; planned is set at setup, actual
 * is filled when the grow completes.
 */
export interface GrowCycle {
  id: Id;
  workspaceId: Id;
  name: string;
  /** What is being grown — plant variety / strain. Generic field, not cannabis-specific. */
  strain?: string;
  plantCount?: number;
  templateId?: Id;
  status: GrowStatus;

  // ── Stage planning (weeks per stage, set at grow setup) ─────────────────
  plannedSeedlingWeeks: number;
  plannedVegWeeks: number;
  plannedFlowerWeeks: number;
  plannedFlushWeeks: number;

  // ── Stage actuals (filled at grow completion for the harvest report) ─────
  actualSeedlingWeeks?: number;
  actualVegWeeks?: number;
  actualFlowerWeeks?: number;
  actualFlushWeeks?: number;

  // ── Lifecycle dates ──────────────────────────────────────────────────────
  startedAt?: Timestamp;
  completedAt?: Timestamp;

  // ── Harvest data (completed grows) ───────────────────────────────────────
  wetWeightG?: number;
  dryWeightG?: number;
  /** 0.5–5.0 with half-star increments. */
  rating?: number;
  notesWorked?: string;
  notesChange?: string;
  /** e.g. ["LST", "Defoliation", "CO₂ purge"] */
  techniques?: string[];

  // ── Abort data ────────────────────────────────────────────────────────────
  abortReason?: string;
  abortNote?: string;

  // ── Auto-compiled environment summary (stored at completion) ─────────────
  envAvgVpd?: number;
  envTempMin?: number;
  envTempMax?: number;
  envTempAvg?: number;
  envRhMin?: number;
  envRhMax?: number;
  envRhAvg?: number;
  envFailsafeTrips?: number;
  envFailsafeNote?: string;
}

/** A milestone within a grow — appears in Journal and Harvest Report. */
export interface GrowMilestone {
  id: Id;
  growId: Id;
  label: string;
  /** Which day of the grow this milestone falls on. */
  day: number;
  done: boolean;
  doneAt?: Timestamp;
}

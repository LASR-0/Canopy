/**
 * The grow stage in force per workspace.
 *
 * Three subsystems need the same answer: thresholds pick a stage-scoped band over
 * the workspace default, and the scheduler and the rules engine decide whether a
 * stage-scoped automation applies at all. Three copies of "which grow is running
 * and what stage is it in" would drift, and the drift would show as an alert that
 * contradicts the automation that should have prevented it.
 *
 * Cached rather than queried per reading: rules are evaluated on the ingest path,
 * which runs several times a second. Reloaded when a grow changes, so starting or
 * completing one takes effect without a restart.
 */
import { inArray } from "drizzle-orm";
import { db } from "../store/index.js";
import { grows, workspaces } from "../store/schema.js";
import { calcGrowStage, stageScopeApplies } from "@canopy/shared-types";
import type { GrowCycle, GrowStageName } from "@canopy/shared-types";

/** null means the workspace exists and has no grow running. */
let activeGrows = new Map<string, GrowCycle | null>();

export async function refreshActiveGrows(): Promise<void> {
  try {
    const spaces = await db
      .select({ id: workspaces.id, activeGrowId: workspaces.activeGrowId })
      .from(workspaces);

    const growIds = spaces.map((w) => w.activeGrowId).filter((id): id is string => !!id);
    const growRows = growIds.length
      ? await db.select().from(grows).where(inArray(grows.id, growIds))
      : [];
    const byId = new Map(growRows.map((g) => [g.id, g]));

    const next = new Map<string, GrowCycle | null>();
    for (const space of spaces) {
      const grow = space.activeGrowId ? byId.get(space.activeGrowId) : undefined;
      next.set(space.id, grow ? (grow as unknown as GrowCycle) : null);
    }
    activeGrows = next;
  } catch (err) {
    // Keep the previous map. Dropping it would idle every stage-scoped
    // automation in the tent on a transient database error.
    console.error("[grow] failed to reload active grows:", err);
  }
}

export function activeGrowFor(workspaceId: string): GrowCycle | null {
  return activeGrows.get(workspaceId) ?? null;
}

/** The stage a workspace is in, or undefined when no grow is running. */
export function currentStage(workspaceId: string, now: Date = new Date()): GrowStageName | undefined {
  const grow = activeGrows.get(workspaceId);
  return grow ? calcGrowStage(grow, now)?.stage : undefined;
}

/**
 * Whether work scoped to a stage should run right now.
 *
 * The rule, decided deliberately rather than by default:
 *
 * - **No scope** always applies. Most automations are not stage-specific.
 * - **A scope with no active grow idles.** There is no stage, so "flowering only"
 *   has no answer, and running it anyway would make the setting a lie. Unscoped
 *   automations keep running, so the tent is not unmanaged — but stage-specific
 *   control is off, which the UI surfaces rather than leaving silent.
 * - **A scope matching the current stage** applies; any other scope does not.
 *
 * Thresholds deliberately do *not* use this. There, a stage band is a refinement
 * over an unscoped default, so an absent grow degrades to the default and nothing
 * stops working. For an automation the scope is a gate with nothing behind it.
 */
export function appliesInCurrentStage(
  workspaceId: string,
  scope: readonly GrowStageName[] | undefined,
  now: Date = new Date(),
): boolean {
  if (!scope || scope.length === 0) return true;
  return stageScopeApplies(scope, currentStage(workspaceId, now));
}

/** Load the map directly, bypassing the database. Tests only. */
export function setActiveGrowsForTesting(entries: [string, GrowCycle | null][]): void {
  activeGrows = new Map(entries);
}

export function resetGrowStageForTesting(): void {
  activeGrows = new Map();
}

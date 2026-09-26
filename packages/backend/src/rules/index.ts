/**
 * Rules engine: condition → action, evaluated against incoming readings.
 *
 * Kept separate from the time-driven scheduler on purpose. A schedule knows
 * when it will act; a rule does not, and the difference shows up in what can go
 * wrong. The hazard here is **flapping**: a sensor sitting on its threshold
 * would toggle an extractor fan on and off every few seconds, and relays and
 * compressors do not survive that.
 *
 * Two mechanisms guard against it:
 *
 *  - **Edge-triggered.** Actions fire on the transition into the condition, not
 *    on every reading that satisfies it. A fan does not get told "on" sixty
 *    times while the tent is hot.
 *  - **Dwell** (`forSeconds`). The condition must hold continuously for that
 *    long before anything fires. A single noisy sample cannot trip a rule, and
 *    the counter resets the moment the condition lapses.
 *
 * Evaluated on the ingest path, so a rule reacts to a reading as it arrives
 * rather than on a polling interval.
 */
import { eq, and } from "drizzle-orm";
import { db } from "../store/index.js";
import { automations } from "../store/schema.js";
import { canActuate } from "../controller/state.js";
import { applyActions, recordFiring } from "../automation/apply.js";
import type {
  Automation,
  AutomationAction,
  Comparator,
  Reading,
  RuleTrigger,
} from "@canopy/shared-types";

/** A rule automation, pre-parsed so the hot path does no JSON work. */
interface CompiledRule {
  id: string;
  workspaceId: string;
  name: string;
  trigger: RuleTrigger;
  actions: AutomationAction[];
  overrideUntil?: string;
}

/**
 * Per-rule evaluation state.
 *
 * In memory: a restart re-arms every rule rather than inheriting a stale belief
 * about what the tent was doing. Re-firing a correct action after a restart is
 * safe; skipping one because of remembered state is not.
 */
interface RuleState {
  /** When the condition most recently became true. */
  metSince?: number;
  /** Whether actions have already fired for the current met period. */
  fired: boolean;
}

let rules: CompiledRule[] = [];
const state = new Map<string, RuleState>();

export function compare(value: number, comparator: Comparator, threshold: number): boolean {
  switch (comparator) {
    case "lt":  return value < threshold;
    case "lte": return value <= threshold;
    case "gt":  return value > threshold;
    case "gte": return value >= threshold;
  }
}

/**
 * Decide what a rule should do for one reading.
 *
 * Pure, given the previous state, so the flapping and dwell behaviour can be
 * tested without a database, a clock or a broker.
 */
export function evaluateRule(
  trigger: RuleTrigger,
  value: number,
  previous: RuleState | undefined,
  nowMs: number,
): { next: RuleState; fire: boolean } {
  const met = compare(value, trigger.comparator, trigger.threshold);

  if (!met) {
    // Lapsing re-arms the rule, so the next crossing fires again.
    return { next: { fired: false }, fire: false };
  }

  const metSince = previous?.metSince ?? nowMs;
  const alreadyFired = previous?.fired ?? false;

  if (alreadyFired) return { next: { metSince, fired: true }, fire: false };

  const dwellMs = (trigger.forSeconds ?? 0) * 1000;
  if (dwellMs > 0 && nowMs - metSince < dwellMs) {
    // Holding, but not yet long enough to count.
    return { next: { metSince, fired: false }, fire: false };
  }

  return { next: { metSince, fired: true }, fire: true };
}

function compile(row: typeof automations.$inferSelect): CompiledRule | null {
  try {
    const trigger = JSON.parse(row.triggerJson) as { kind?: string };
    if (trigger.kind !== "rule") return null;

    return {
      id: row.id,
      workspaceId: row.workspaceId,
      name: row.name,
      trigger: trigger as RuleTrigger,
      actions: JSON.parse(row.actionsJson) as AutomationAction[],
      ...(row.overrideUntil ? { overrideUntil: row.overrideUntil } : {}),
    };
  } catch {
    console.error(`[rules] automation ${row.id} has unreadable trigger or actions`);
    return null;
  }
}

/**
 * Reload the rule set from the database.
 *
 * Rules are evaluated per reading, so they are cached rather than re-queried
 * every time. Called at startup and whenever an automation changes; a rule the
 * user just saved has to take effect without a restart.
 */
export async function refreshRules(): Promise<void> {
  try {
    const rows = await db
      .select()
      .from(automations)
      .where(and(eq(automations.enabled, true), eq(automations.kind, "rule")));

    const compiled = rows.map(compile).filter((r): r is CompiledRule => r !== null);
    rules = compiled;

    // Drop state for rules that no longer exist, so a deleted and recreated
    // rule starts disarmed rather than inheriting the old one's history.
    const live = new Set(compiled.map((r) => r.id));
    for (const id of state.keys()) {
      if (!live.has(id)) state.delete(id);
    }
  } catch (err) {
    console.error("[rules] failed to reload rules:", err);
  }
}

/** How many rules are armed. Surfaced for the startup log. */
export function activeRuleCount(): number {
  return rules.length;
}

/**
 * Evaluate every rule against one incoming reading.
 *
 * Called from the ingest path, so it must stay cheap for the common case where
 * no rule watches this metric.
 */
export async function onReading(reading: Reading, now: Date = new Date()): Promise<number> {
  if (rules.length === 0) return 0;

  // A paused controller must not drive hardware. State is left untouched so
  // that resuming re-evaluates rather than firing on a stale edge.
  if (!canActuate()) return 0;

  const nowMs = now.getTime();
  let fired = 0;

  for (const rule of rules) {
    if (rule.workspaceId !== reading.workspaceId) continue;
    if (rule.trigger.metric !== reading.metric) continue;
    if (rule.overrideUntil && rule.overrideUntil > now.toISOString()) continue;

    const { next, fire } = evaluateRule(rule.trigger, reading.value, state.get(rule.id), nowMs);
    state.set(rule.id, next);
    if (!fire) continue;

    const automation: Pick<Automation, "id" | "workspaceId" | "name"> = {
      id: rule.id,
      workspaceId: rule.workspaceId,
      name: rule.name,
    };

    const sent = await applyActions(automation, rule.actions, "rules");
    if (!sent) {
      // Nothing reached hardware, so the rule stays armed and will try again on
      // the next reading rather than believing it has acted.
      state.set(rule.id, { ...next, fired: false });
      continue;
    }

    await recordFiring(
      automation,
      `${reading.metric} ${rule.trigger.comparator} ${rule.trigger.threshold} (${reading.value}${unitSuffix(reading)})`,
      now,
    );
    fired++;
  }

  return fired;
}

function unitSuffix(reading: Reading): string {
  return reading.unit === "percent" ? "%" : ` ${reading.unit}`;
}

/** Forget armed state and the cached rule set. Tests only. */
export function resetRuleState(): void {
  rules = [];
  state.clear();
}

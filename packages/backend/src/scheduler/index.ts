/**
 * Scheduler: time-driven automations + internal maintenance jobs
 * (reading rollups, retention pruning, VACUUM INTO backups).
 *
 * One interval drives both, but they answer to different lifecycle rules and
 * different cadences:
 *
 *  - **Automations** are evaluated every tick, because a photoperiod boundary
 *    should be acted on within a minute of arriving, and are suspended while
 *    the controller is paused.
 *  - **Jobs** are rows with their own next-run times, so a controller that was
 *    off for a day resumes with everything due. They keep running while paused,
 *    since aggregating readings is monitoring, not acting.
 */
import { evaluateAutomations } from "./automations.js";
import { recoverStaleJobs, tickJobs } from "./runner.js";

export { runDueJobs, tickJobs } from "./runner.js";
export { evaluateAutomations, resetAutomationState } from "./automations.js";

/**
 * A minute is the resolution of the domain: schedules are set in HH:MM and
 * cron's finest field is minutes. Ticking faster would burn cycles re-deriving
 * states that cannot have changed.
 */
const TICK_MS = 60_000;

let timer: ReturnType<typeof setInterval> | null = null;
let ticking = false;

async function tick(): Promise<void> {
  // A slow tick must not overlap the next one: two passes at once would double
  // up job claims and race the applied-state map.
  if (ticking) return;
  ticking = true;

  try {
    await evaluateAutomations();
    await tickJobs();
  } catch (err) {
    // The loop must survive anything a single pass throws, or the controller
    // silently stops scheduling for the rest of its life.
    console.error("[scheduler] tick failed:", err);
  } finally {
    ticking = false;
  }
}

export async function startScheduler(): Promise<void> {
  if (timer) return;

  const recovered = await recoverStaleJobs();
  if (recovered > 0) {
    console.log(`[scheduler] released ${recovered} job(s) interrupted by a restart`);
  }

  // Run once immediately. Waiting a full minute would leave the tent in
  // whatever state it was in when the controller stopped.
  void tick();

  timer = setInterval(() => void tick(), TICK_MS);
  console.log("[scheduler] started");
}

export function stopScheduler(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

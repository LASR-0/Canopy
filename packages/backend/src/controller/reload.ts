/**
 * Reload what the controller keeps in memory about workspaces: device topics,
 * derived-metric roles, rules, thresholds and active grows. The same caches a
 * start fills, for when workspaces come or go without a restart (an import,
 * an archive, a restore).
 */
import { refreshTopicIndex } from "../device-manager/ingest.js";
import { refreshDerivedRoles } from "../device-manager/derived.js";
import { refreshRules } from "../rules/index.js";
import { refreshThresholds } from "../rules/thresholds.js";
import { refreshActiveGrows } from "../grow/stage.js";

export async function reloadWorkspaceCaches(): Promise<void> {
  await refreshTopicIndex();
  await refreshDerivedRoles();
  await refreshRules();
  await refreshThresholds();
  await refreshActiveGrows();
}

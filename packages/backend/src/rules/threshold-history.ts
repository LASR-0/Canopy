/**
 * What a channel's alerts last said, from the database.
 *
 * The threshold checker keeps each channel's recorded status in memory, so a
 * restart forgot it. A channel that was out of range when the controller
 * stopped then came back as "never left range": its recovery was never
 * written, and the Logs tab showed the period as ongoing for good. A restart
 * while it was still out of range wrote the same crossing a second time.
 * Seeding from the last recorded alert fixes both. Its own module so the
 * checker's tests can stub it without a database.
 */
import { and, desc, eq } from "drizzle-orm";
import { db } from "../store/index.js";
import { events } from "../store/schema.js";
import type { ThresholdStatus } from "@canopy/shared-types";

export async function lastRecordedStatus(
  workspaceId: string,
  deviceId: string,
  channel: string,
): Promise<ThresholdStatus> {
  const [last] = await db
    .select({ severity: events.severity })
    .from(events)
    .where(
      and(
        eq(events.workspaceId, workspaceId),
        eq(events.type, "threshold_alert"),
        eq(events.sourceId, deviceId),
        eq(events.sourceLabel, channel),
      ),
    )
    .orderBy(desc(events.occurredAt))
    .limit(1);
  return last?.severity === "err" ? "err" : last?.severity === "warn" ? "warn" : "ok";
}

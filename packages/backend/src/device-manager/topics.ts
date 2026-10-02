/**
 * The one entry point for "the device set changed".
 *
 * Two in-memory views are derived from the devices table: the ingest index,
 * which decides whether a message becomes a reading, and the broker's
 * command-topic ACL, which decides whether a client may publish at all. Both
 * are rebuilt from the same rows and on exactly the same events.
 *
 * They are refreshed together through this function rather than side by side at
 * each call site, because the failure mode of forgetting one is silent and
 * one-directional: a device paired since the last restart would be ingested but
 * its command topic left open to the LAN.
 */
import { refreshCommandTopics } from "../broker/acl.js";
import { refreshDerivedRoles } from "./derived.js";
import { refreshTopicIndex } from "./ingest.js";
import { refreshDliSources } from "./dli.js";

export async function refreshDeviceTopics(): Promise<void> {
  await refreshTopicIndex();
  await refreshCommandTopics();
  // Which devices are the canopy sensors is a role question, so this also has to
  // run when a role is assigned — see the roles route.
  await refreshDerivedRoles();
  await refreshDliSources();
}

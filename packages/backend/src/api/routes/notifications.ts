import type { FastifyInstance } from "fastify";
import { sqliteConnection } from "../../store/index.js";
import {
  isNotificationChannel,
  markNotificationsSeen,
  notificationSummary,
} from "../../notifications/index.js";
import { err, ok } from "../reply.js";
import type { NotificationChannel } from "@canopy/shared-types";

export async function notificationRoutes(app: FastifyInstance): Promise<void> {
  /** Unseen counts per page, for the sidebar badges, and the recent list, for the bell. */
  app.get<{ Params: { workspaceId: string } }>(
    "/workspaces/:workspaceId/notifications",
    async (req, reply) => reply.send(ok(notificationSummary(sqliteConnection, req.params.workspaceId))),
  );

  /**
   * Mark pages' notifications seen up to now. Returns the new summary, so the
   * caller's badges update from one round trip.
   */
  app.post<{ Params: { workspaceId: string }; Body: { channels?: unknown } | undefined }>(
    "/workspaces/:workspaceId/notifications/seen",
    async (req, reply) => {
      const raw = req.body?.channels;
      let channels: NotificationChannel[] | undefined;
      if (raw !== undefined) {
        if (!Array.isArray(raw) || !raw.every(isNotificationChannel)) {
          return reply.status(400).send(err("validation_failed", "channels must be a list of notification channels"));
        }
        channels = raw;
      }
      markNotificationsSeen(sqliteConnection, req.params.workspaceId, channels);
      return reply.send(ok(notificationSummary(sqliteConnection, req.params.workspaceId)));
    },
  );
}

import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { db } from "../../store/index.js";
import { appSettings } from "../../store/schema.js";
import { ok } from "../reply.js";
import type { AppSettings } from "@canopy/shared-types";

function rowToSettings(row: typeof appSettings.$inferSelect): AppSettings {
  return {
    theme: row.theme as AppSettings["theme"],
    unitTemperature: row.unitTemperature as AppSettings["unitTemperature"],
    unitWeight: row.unitWeight as AppSettings["unitWeight"],
    unitVolume: row.unitVolume as AppSettings["unitVolume"],
    unitDimension: row.unitDimension as AppSettings["unitDimension"],
    startupPage: row.startupPage,
    notificationsEnabled: row.notificationsEnabled,
    notifyThresholdWarn: row.notifyThresholdWarn,
    notifyThresholdErr: row.notifyThresholdErr,
    notifyFailsafe: row.notifyFailsafe,
    notifyDeviceOffline: row.notifyDeviceOffline,
    notifyMaintenanceDue: row.notifyMaintenanceDue,
    notifyGrowStage: row.notifyGrowStage,
    notifyAutomationOverride: row.notifyAutomationOverride,
    rawRetentionDays: row.rawRetentionDays,
    hourlyRetentionDays: row.hourlyRetentionDays,
    archiveAfterDays: row.archiveAfterDays,
    backupEnabled: row.backupEnabled,
    backupIntervalDays: row.backupIntervalDays,
    ...(row.activeWorkspaceId ? { activeWorkspaceId: row.activeWorkspaceId } : {}),
    ...(row.backupPath ? { backupPath: row.backupPath } : {}),
  };
}

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/settings", async (_req, reply) => {
    const [row] = await db.select().from(appSettings).where(eq(appSettings.id, 1));
    return reply.send(ok(rowToSettings(row!)));
  });

  app.patch<{ Body: Partial<AppSettings> }>("/settings", async (req, reply) => {
    const updates: Partial<typeof appSettings.$inferInsert> = {};
    const b = req.body;
    if (b.theme !== undefined)                  updates.theme = b.theme;
    if (b.unitTemperature !== undefined)         updates.unitTemperature = b.unitTemperature;
    if (b.unitWeight !== undefined)              updates.unitWeight = b.unitWeight;
    if (b.unitVolume !== undefined)              updates.unitVolume = b.unitVolume;
    if (b.unitDimension !== undefined)           updates.unitDimension = b.unitDimension;
    if (b.startupPage !== undefined)             updates.startupPage = b.startupPage;
    if (b.activeWorkspaceId !== undefined)       updates.activeWorkspaceId = b.activeWorkspaceId;
    if (b.notificationsEnabled !== undefined)       updates.notificationsEnabled = b.notificationsEnabled;
    if (b.notifyThresholdWarn !== undefined)        updates.notifyThresholdWarn = b.notifyThresholdWarn;
    if (b.notifyThresholdErr !== undefined)         updates.notifyThresholdErr = b.notifyThresholdErr;
    if (b.notifyFailsafe !== undefined)             updates.notifyFailsafe = b.notifyFailsafe;
    if (b.notifyDeviceOffline !== undefined)        updates.notifyDeviceOffline = b.notifyDeviceOffline;
    if (b.notifyMaintenanceDue !== undefined)       updates.notifyMaintenanceDue = b.notifyMaintenanceDue;
    if (b.notifyGrowStage !== undefined)            updates.notifyGrowStage = b.notifyGrowStage;
    if (b.notifyAutomationOverride !== undefined)   updates.notifyAutomationOverride = b.notifyAutomationOverride;
    if (b.rawRetentionDays !== undefined)           updates.rawRetentionDays = b.rawRetentionDays;
    if (b.hourlyRetentionDays !== undefined)     updates.hourlyRetentionDays = b.hourlyRetentionDays;
    if (b.archiveAfterDays !== undefined)        updates.archiveAfterDays = b.archiveAfterDays;
    if (b.backupEnabled !== undefined)           updates.backupEnabled = b.backupEnabled;
    if (b.backupIntervalDays !== undefined)      updates.backupIntervalDays = b.backupIntervalDays;
    if (b.backupPath !== undefined)              updates.backupPath = b.backupPath;

    if (Object.keys(updates).length > 0) {
      await db.update(appSettings).set(updates).where(eq(appSettings.id, 1));
    }
    const [row] = await db.select().from(appSettings).where(eq(appSettings.id, 1));
    return reply.send(ok(rowToSettings(row!)));
  });
}

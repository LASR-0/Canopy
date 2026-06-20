import type { Id } from "./common.js";

export type TemperatureUnit = "C" | "F";
export type WeightUnit = "g" | "oz";
export type VolumeUnit = "ml" | "L" | "fl_oz";
export type DimensionUnit = "cm" | "in";

/** Global application preferences and data-retention policy. Single row, id always 1. */
export interface AppSettings {
  theme: "dark" | "light" | "system";
  unitTemperature: TemperatureUnit;
  unitWeight: WeightUnit;
  unitVolume: VolumeUnit;
  unitDimension: DimensionUnit;
  startupPage: string;
  activeWorkspaceId?: Id;

  // ── Notifications ────────────────────────────────────────────────────────
  notificationsEnabled: boolean;
  notifyThresholdWarn: boolean;
  notifyThresholdErr: boolean;
  notifyFailsafe: boolean;
  notifyDeviceOffline: boolean;
  notifyMaintenanceDue: boolean;
  notifyGrowStage: boolean;
  notifyAutomationOverride: boolean;

  // ── Data retention ───────────────────────────────────────────────────────
  /** Days to keep raw readings before rolling up to hourly. Default 7. */
  rawRetentionDays: number;
  /** Days to keep hourly rollups before rolling up to daily. Default 90. */
  hourlyRetentionDays: number;
  /** Days after grow completion before auto-archiving to archive DB. Default 30. */
  archiveAfterDays: number;

  // ── Backup ───────────────────────────────────────────────────────────────
  backupEnabled: boolean;
  backupIntervalDays: number;
  backupPath?: string;
}

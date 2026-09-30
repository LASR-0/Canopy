/**
 * Unit — the latest-readings cache (Phase 7.5 D)
 *
 * It replaced a query that stalled the controller for seconds, so it must
 * answer exactly what the query did: the newest reading of every channel.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { seedRows, mockSelect } = vi.hoisted(() => {
  const seedRows: unknown[] = [];
  const mockSelect = vi.fn(() => ({ from: () => ({ where: async () => seedRows }) }));
  return { seedRows, mockSelect };
});
vi.mock("../../src/store/index.js", () => ({ db: { select: mockSelect } }));

const { latestReadings, rememberReading, resetLatestReadings } = await import("../../src/device-manager/latest.js");

const reading = (channel: string, value: number, ts: string) => ({
  workspaceId: "ws-1", deviceId: "dev-1", channel, metric: "temperature" as const, unit: "C" as const, value, ts,
});

beforeEach(() => {
  vi.clearAllMocks();
  resetLatestReadings();
  seedRows.length = 0;
});

describe("latestReadings", () => {
  it("seeds from the database once, then answers from memory", async () => {
    seedRows.push({ workspaceId: "ws-1", deviceId: "dev-1", channel: "a", metric: "temperature", unit: "C", value: 20, recordedAt: "2026-09-30T00:00:00Z" });

    expect(await latestReadings("ws-1")).toHaveLength(1);
    await latestReadings("ws-1");
    expect(mockSelect).toHaveBeenCalledTimes(1);
  });

  it("keeps the newest reading per channel", async () => {
    await latestReadings("ws-1");
    rememberReading(reading("a", 20, "2026-09-30T00:00:01Z"));
    rememberReading(reading("a", 21, "2026-09-30T00:00:02Z"));
    rememberReading(reading("b", 50, "2026-09-30T00:00:02Z"));

    const byChannel = Object.fromEntries((await latestReadings("ws-1")).map((r) => [r.channel, r.value]));
    expect(byChannel).toEqual({ a: 21, b: 50 });
  });

  it("does not let an older seeded row replace a reading that arrived first", async () => {
    rememberReading(reading("a", 22, "2026-09-30T00:00:05Z"));
    seedRows.push({ workspaceId: "ws-1", deviceId: "dev-1", channel: "a", metric: "temperature", unit: "C", value: 20, recordedAt: "2026-09-30T00:00:00Z" });

    expect((await latestReadings("ws-1"))[0]!.value).toBe(22);
  });
});

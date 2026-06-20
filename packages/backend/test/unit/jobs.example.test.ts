/**
 * Unit test PATTERN REFERENCE — vi.mock with Drizzle
 *
 * Shows the correct vi.hoisted / vi.mock / describe/it structure to use when
 * writing unit tests for job handlers in Phase 6+.
 *
 * Copy this file and replace the inline handler with the real import:
 *   import { pruneRawHandler } from "../../src/scheduler/jobs/prune-raw.js";
 *
 * For tests that need real SQL behaviour (rollup aggregation, retention logic)
 * use createTestDb() from test/helpers/db.ts instead of mocking.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── 1. Hoist mocks before any imports ────────────────────────────────────────
const { mockBroadcast } = vi.hoisted(() => {
  return { mockBroadcast: vi.fn() };
});

vi.mock("../../src/ws/index.js", () => ({ broadcast: mockBroadcast }));

// ── 2. A minimal handler that uses only broadcast (no DB) ─────────────────────
// Replace with a real import once the handler exists.
async function exampleNotifyHandler(workspaceId: string) {
  const { broadcast } = await import("../../src/ws/index.js");

  if (!workspaceId) return { notified: false };

  broadcast({
    type: "device.status",
    payload: { deviceId: "sys", online: true },
  });

  return { notified: true };
}

// ── 3. Tests ──────────────────────────────────────────────────────────────────
beforeEach(() => {
  vi.clearAllMocks();
  mockBroadcast.mockReturnValue(undefined);
});

describe("exampleNotifyHandler (pattern reference)", () => {
  it("returns { notified: false } and skips broadcast when no workspaceId", async () => {
    const result = await exampleNotifyHandler("");

    expect(result).toEqual({ notified: false });
    expect(mockBroadcast).not.toHaveBeenCalled();
  });

  it("calls broadcast exactly once when a workspaceId is provided", async () => {
    const result = await exampleNotifyHandler("ws-123");

    expect(result).toEqual({ notified: true });
    expect(mockBroadcast).toHaveBeenCalledTimes(1);
    expect(mockBroadcast).toHaveBeenCalledWith({
      type: "device.status",
      payload: { deviceId: "sys", online: true },
    });
  });
});

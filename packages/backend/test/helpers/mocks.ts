/**
 * Shared mock factories for unit tests.
 *
 * Use vi.hoisted() in your test file when mocking modules — this file provides
 * the typed shapes that make the mocks type-safe and reusable.
 *
 * Pattern (copy into your test file and adapt):
 *
 *   const { mockDb, mockBroadcast } = vi.hoisted(() => {
 *     const mockDb = createDbMock();
 *     const mockBroadcast = vi.fn();
 *     return { mockDb, mockBroadcast };
 *   });
 *
 *   vi.mock("../../store/index.js", () => ({ db: mockDb }));
 *   vi.mock("../../ws/index.js",    () => ({ broadcast: mockBroadcast }));
 */
import { vi } from "vitest";
import type { ServerMessage } from "@canopy/shared-types";

/**
 * Minimal Drizzle query-builder mock.
 *
 * Covers the most common patterns:
 *   db.select().from(...).where(...)
 *   db.insert(...).values(...)
 *   db.update(...).set(...).where(...)
 *   db.delete(...).where(...)
 *
 * Override individual vi.fn() returns per test to control what the DB "returns".
 */
export function createDbMock() {
  // Each builder method returns `this` so chains compile.
  // The LAST method in a chain needs a mockResolvedValue / mockReturnValue override
  // in the individual test to return the actual data.
  const self: Record<string, ReturnType<typeof vi.fn>> = {};

  const chain = () => new Proxy(self, {
    get(_t, prop: string) {
      if (!self[prop]) self[prop] = vi.fn().mockReturnValue(chain());
      return self[prop];
    },
  });

  return chain() as {
    select: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    [key: string]: ReturnType<typeof vi.fn>;
  };
}

/** A mock for the WS broadcast function. */
export function createBroadcastMock() {
  return vi.fn<(msg: ServerMessage) => void>();
}

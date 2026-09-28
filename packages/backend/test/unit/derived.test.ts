/**
 * Unit — derived metrics (Phase 7, Logging)
 *
 * VPD is the first thing written to the `__derived__` device id the schema has
 * reserved since the first commit. It is judged, alerted on and charted exactly
 * like a measured reading, so a wrong value is not a cosmetic problem — it is a
 * number a grower would steer the tent by.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Reading } from "@canopy/shared-types";

const { mockInsertValues, mockBroadcast } = vi.hoisted(() => ({
  mockInsertValues: vi.fn(async (_row: unknown) => undefined),
  mockBroadcast: vi.fn(),
}));

vi.mock("../../src/store/index.js", () => ({
  db: { insert: () => ({ values: mockInsertValues }) },
}));
vi.mock("../../src/ws/index.js", () => ({ broadcast: mockBroadcast }));

const {
  DERIVED_DEVICE_ID,
  computeVpd,
  deriveFromReading,
  resetDerivedForTesting,
  saturationVapourPressure,
  setDerivedRolesForTesting,
} = await import("../../src/device-manager/derived.js");

const NOW = new Date("2026-09-28T04:00:00.000Z");

function reading(overrides: Partial<Reading>): Reading {
  return {
    workspaceId: "ws-1",
    deviceId: "dev-temp",
    channel: "canopy-temp",
    metric: "temperature",
    unit: "C",
    value: 24,
    ts: NOW.toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  resetDerivedForTesting();
  vi.clearAllMocks();
});

describe("saturationVapourPressure", () => {
  it("matches the published value at 20 °C", () => {
    // Tetens at 20 °C is ~2.339 kPa, a standard reference point.
    expect(saturationVapourPressure(20)).toBeCloseTo(2.339, 2);
  });

  it("rises with temperature", () => {
    expect(saturationVapourPressure(30)).toBeGreaterThan(saturationVapourPressure(20));
  });
});

describe("computeVpd", () => {
  it("is zero at saturation", () => {
    // 100 % RH means the air holds all it can: no deficit, no transpiration.
    expect(computeVpd(24, 100)).toBe(0);
  });

  it("equals the saturation pressure in bone-dry air", () => {
    expect(computeVpd(20, 0)).toBeCloseTo(saturationVapourPressure(20), 3);
  });

  it("computes a typical tent figure", () => {
    // 24 °C / 60 % RH — SVP 2.985 kPa, so VPD ≈ 1.19 kPa.
    expect(computeVpd(24, 60)).toBeCloseTo(1.194, 2);
  });

  it("falls as humidity rises at a fixed temperature", () => {
    const dry = computeVpd(25, 40)!;
    const humid = computeVpd(25, 80)!;
    expect(dry).toBeGreaterThan(humid);
  });

  it("rises with temperature at a fixed humidity", () => {
    expect(computeVpd(28, 60)!).toBeGreaterThan(computeVpd(22, 60)!);
  });

  it("refuses humidity outside 0–100 rather than inventing a figure", () => {
    // A miscalibrated sensor reporting 140 % would otherwise write a negative
    // VPD into the history and alert on it.
    expect(computeVpd(24, 140)).toBeNull();
    expect(computeVpd(24, -5)).toBeNull();
  });

  it("refuses non-finite inputs", () => {
    expect(computeVpd(Number.NaN, 60)).toBeNull();
    expect(computeVpd(24, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("refuses a temperature the equation cannot serve", () => {
    expect(computeVpd(-300, 50)).toBeNull();
  });
});

describe("deriveFromReading", () => {
  const roles: [string, "temp" | "humidity"][] = [
    ["dev-temp:canopy-temp", "temp"],
    ["dev-rh:canopy-rh", "humidity"],
  ];

  it("ignores a device holding neither canopy role", () => {
    setDerivedRolesForTesting(roles);
    return expect(
      deriveFromReading(reading({ deviceId: "dev-res", channel: "res-temp" }), NOW),
    ).resolves.toBeNull();
  });

  it("writes nothing until both halves of the pair are known", async () => {
    setDerivedRolesForTesting(roles);
    expect(await deriveFromReading(reading({ value: 24 }), NOW)).toBeNull();
    expect(mockInsertValues).not.toHaveBeenCalled();
  });

  it("writes VPD once both halves have arrived", async () => {
    setDerivedRolesForTesting(roles);
    await deriveFromReading(reading({ value: 24 }), NOW);
    const derived = await deriveFromReading(
      reading({ deviceId: "dev-rh", channel: "canopy-rh", metric: "humidity", unit: "percent", value: 60 }),
      NOW,
    );

    expect(derived).toMatchObject({
      workspaceId: "ws-1",
      deviceId: DERIVED_DEVICE_ID,
      channel: "vpd",
      metric: "vpd",
      unit: "kPa",
    });
    expect(derived!.value).toBeCloseTo(1.194, 2);
    expect(mockInsertValues).toHaveBeenCalledTimes(1);
  });

  it("broadcasts the derived reading so the UI updates live", async () => {
    setDerivedRolesForTesting(roles);
    await deriveFromReading(reading({ value: 24 }), NOW);
    await deriveFromReading(
      reading({ deviceId: "dev-rh", channel: "canopy-rh", metric: "humidity", value: 60 }),
      NOW,
    );
    expect(mockBroadcast).toHaveBeenCalledWith(
      expect.objectContaining({ type: "reading" }),
    );
  });

  it("writes once per complete pair, not once per half", async () => {
    // Writing on each half stored VPD at twice the rate of the channels it comes
    // from, and the second write carried no new information: only one of its two
    // inputs had moved. Measured on real data as 19.97 rows/s of VPD against
    // 9.99/s of temperature.
    setDerivedRolesForTesting(roles);
    const rh = () =>
      reading({ deviceId: "dev-rh", channel: "canopy-rh", metric: "humidity", value: 60 });

    await deriveFromReading(reading({ value: 24 }), NOW);
    expect(await deriveFromReading(rh(), NOW)).not.toBeNull();
    // Temperature alone: the pair is no longer complete, so nothing is written.
    expect(await deriveFromReading(reading({ value: 28 }), NOW)).toBeNull();
    expect(mockInsertValues).toHaveBeenCalledTimes(1);
  });

  it("writes again once both halves have refreshed", async () => {
    setDerivedRolesForTesting(roles);
    const rh = (value: number) =>
      reading({ deviceId: "dev-rh", channel: "canopy-rh", metric: "humidity", value });

    await deriveFromReading(reading({ value: 24 }), NOW);
    const first = await deriveFromReading(rh(60), NOW);
    await deriveFromReading(reading({ value: 28 }), NOW);
    const second = await deriveFromReading(rh(60), NOW);

    expect(second).not.toBeNull();
    // Hotter air at the same humidity is a larger deficit.
    expect(second!.value).toBeGreaterThan(first!.value);
    expect(mockInsertValues).toHaveBeenCalledTimes(2);
  });

  it("does not write n VPD rows for n samples of one channel", async () => {
    setDerivedRolesForTesting(roles);
    await deriveFromReading(
      reading({ deviceId: "dev-rh", channel: "canopy-rh", metric: "humidity", value: 60 }),
      NOW,
    );
    for (let i = 0; i < 20; i++) {
      await deriveFromReading(reading({ value: 24 + i * 0.01 }), NOW);
    }
    // One complete pair arrived, so one row — not twenty.
    expect(mockInsertValues).toHaveBeenCalledTimes(1);
  });

  it("keeps workspaces separate", async () => {
    // Two tents must not derive VPD from each other's sensors.
    setDerivedRolesForTesting(roles);
    await deriveFromReading(reading({ workspaceId: "ws-1", value: 24 }), NOW);
    const crossed = await deriveFromReading(
      reading({
        workspaceId: "ws-2",
        deviceId: "dev-rh",
        channel: "canopy-rh",
        metric: "humidity",
        value: 60,
      }),
      NOW,
    );
    expect(crossed).toBeNull();
    expect(mockInsertValues).not.toHaveBeenCalled();
  });

  it("derives nothing when no canopy roles are assigned", async () => {
    // A workspace with no canopy roles has no canopy reading to derive from,
    // and a reservoir probe must not stand in for one.
    setDerivedRolesForTesting([]);
    expect(await deriveFromReading(reading({ value: 24 }), NOW)).toBeNull();
  });

  it("does not write when the pair is physically impossible", async () => {
    setDerivedRolesForTesting(roles);
    await deriveFromReading(reading({ value: 24 }), NOW);
    const bad = await deriveFromReading(
      reading({ deviceId: "dev-rh", channel: "canopy-rh", metric: "humidity", value: 130 }),
      NOW,
    );
    expect(bad).toBeNull();
    expect(mockInsertValues).not.toHaveBeenCalled();
  });
});

/**
 * Unit — tent layout rules (Phase 7, Setup View)
 *
 * The enclosure was three integer columns that nothing wrote, and there was
 * nowhere to store a placement or a plant. The rules decided for the floor plan
 * are pinned here: the size cap, proportional rescaling on resize, clamping to
 * the walls, and pot sizes from a fixed table.
 */
import { describe, it, expect } from "vitest";
import {
  POT_SIZES,
  defaultMountCm,
  dimensionsProblem,
  potSize,
  rescalePoint,
  type EnclosureDimensions,
} from "@canopy/shared-types";
import {
  DEFAULT_MOUNT_CM,
  dimensionsChanged,
  normaliseRotation,
  resolvePlacement,
  resolvePlant,
} from "../../src/layout/index.js";

const TENT: EnclosureDimensions = { widthCm: 120, depthCm: 120, heightCm: 200 };

describe("dimensionsProblem", () => {
  it("accepts the full 6 × 6 × 3 m tent", () => {
    expect(dimensionsProblem({ widthCm: 600, depthCm: 600, heightCm: 300 })).toBeNull();
  });

  it("rejects a footprint over 6 m and a height over 3 m", () => {
    expect(dimensionsProblem({ widthCm: 601, depthCm: 120, heightCm: 200 })).toMatch(/Width/);
    expect(dimensionsProblem({ widthCm: 120, depthCm: 800, heightCm: 200 })).toMatch(/Depth/);
    expect(dimensionsProblem({ widthCm: 120, depthCm: 120, heightCm: 301 })).toMatch(/Height.*300/);
  });

  it("rejects a tent smaller than 30 cm, and a non-number", () => {
    expect(dimensionsProblem({ widthCm: 29, depthCm: 120, heightCm: 200 })).toMatch(/between 30/);
    expect(dimensionsProblem({ widthCm: Number.NaN, depthCm: 120, heightCm: 200 })).toMatch(/number/);
  });
});

describe("rescalePoint", () => {
  it("keeps each point at the same fraction of the tent", () => {
    const moved = rescalePoint({ xCm: 60, yCm: 30, zCm: 150 }, TENT, { widthCm: 240, depthCm: 60, heightCm: 100 });
    expect(moved).toEqual({ xCm: 120, yCm: 15, zCm: 75 });
  });

  it("leaves z alone on a point that has none, as a plant does", () => {
    const moved = rescalePoint({ xCm: 60, yCm: 60 }, TENT, { widthCm: 60, depthCm: 60, heightCm: 100 });
    expect(moved).toEqual({ xCm: 30, yCm: 30 });
  });

  it("returns a point to where it started after a resize and its reverse", () => {
    const small = { widthCm: 90, depthCm: 70, heightCm: 170 };
    const start = { xCm: 37, yCm: 101, zCm: 163 };
    const back = rescalePoint(rescalePoint(start, TENT, small), small, TENT);
    expect(back.xCm).toBeCloseTo(37, 9);
    expect(back.yCm).toBeCloseTo(101, 9);
    expect(back.zCm).toBeCloseTo(163, 9);
  });

  it("carries other fields through untouched", () => {
    const moved = rescalePoint({ id: "p1", xCm: 0, yCm: 0, potLitres: 12 }, TENT, TENT);
    expect(moved).toMatchObject({ id: "p1", potLitres: 12 });
  });
});

describe("dimensionsChanged", () => {
  it("is false for the same size, so a no-op PATCH rewrites nothing", () => {
    expect(dimensionsChanged(TENT, { ...TENT })).toBe(false);
    expect(dimensionsChanged(TENT, { ...TENT, heightCm: 201 })).toBe(true);
  });
});

describe("resolvePlacement", () => {
  it("places a new device mid-floor at the default mounting height", () => {
    expect(resolvePlacement(undefined, {}, TENT)).toEqual({ xCm: 60, yCm: 60, zCm: DEFAULT_MOUNT_CM, rotationDeg: 0 });
  });

  it("caps the default mounting height at a tent shorter than it", () => {
    expect(resolvePlacement(undefined, {}, { ...TENT, heightCm: 60 })).toMatchObject({ zCm: 60 });
  });

  it("keeps stored fields the request leaves out", () => {
    const existing = { xCm: 10, yCm: 20, zCm: 180, rotationDeg: 90 };
    expect(resolvePlacement(existing, { xCm: 50 }, TENT)).toEqual({ ...existing, xCm: 50 });
  });

  it("clamps to the walls rather than refusing a pin dragged past the edge", () => {
    expect(resolvePlacement(undefined, { xCm: -4, yCm: 125, zCm: 999 }, TENT)).toMatchObject({
      xCm: 0,
      yCm: 120,
      zCm: 200,
    });
  });

  it("rejects a non-number", () => {
    expect(resolvePlacement(undefined, { xCm: "left" as never }, TENT)).toMatch(/xCm/);
  });
});

describe("normaliseRotation", () => {
  it("folds any angle into [0, 360)", () => {
    expect(normaliseRotation(450)).toBe(90);
    expect(normaliseRotation(-270)).toBe(90);
    expect(normaliseRotation(360)).toBe(0);
  });
});

describe("resolvePlant", () => {
  it("defaults a new plant to mid-floor in the default pot", () => {
    expect(resolvePlant(undefined, {}, TENT, 12)).toEqual({ xCm: 60, yCm: 60, potLitres: 12, label: null });
  });

  it("rejects a pot size that is not in the table", () => {
    expect(resolvePlant(undefined, { potLitres: 13 }, TENT, 12)).toMatch(/13 L/);
  });

  it("clears the label on an empty string and keeps it when omitted", () => {
    const existing = { xCm: 1, yCm: 1, potLitres: 20, label: "Mother" };
    expect(resolvePlant(existing, {}, TENT, 20)).toMatchObject({ label: "Mother" });
    expect(resolvePlant(existing, { label: "  " }, TENT, 20)).toMatchObject({ label: null });
  });
});

describe("POT_SIZES", () => {
  it("runs from 1 L to 50 L in increasing order", () => {
    expect(POT_SIZES[0]!.litres).toBe(1);
    expect(POT_SIZES.at(-1)!.litres).toBe(50);
    for (let i = 1; i < POT_SIZES.length; i++) {
      expect(POT_SIZES[i]!.litres).toBeGreaterThan(POT_SIZES[i - 1]!.litres);
      expect(POT_SIZES[i]!.diameterCm).toBeGreaterThanOrEqual(POT_SIZES[i - 1]!.diameterCm);
    }
  });

  it("gives each pot dimensions that hold its nominal volume, within 10 %", () => {
    // Tapered round pot: base 85 % of the rim, as the table assumes.
    for (const pot of POT_SIZES) {
      const top = pot.diameterCm;
      const base = top * 0.85;
      const litres = (Math.PI * pot.heightCm * (top * top + top * base + base * base)) / 12 / 1000;
      expect(Math.abs(litres - pot.litres) / pot.litres).toBeLessThan(0.1);
    }
  });

  it("looks sizes up by litres", () => {
    expect(potSize(12)).toEqual({ litres: 12, diameterCm: 27, heightCm: 24 });
    expect(potSize(13)).toBeUndefined();
  });
});

describe("defaultMountCm", () => {
  it("starts floor equipment, plugs, reservoirs and their probes on the floor", () => {
    for (const role of ["pump", "power_draw", "res_ph", "res_ec", "res_temp", "rootzone", "humidifier", "dehumidifier", "heater", "co2_valve"] as const) {
      expect(defaultMountCm(role, TENT, true)).toBe(0);
    }
  });
  it("hangs the light and inline fans high, inside the tent", () => {
    expect(defaultMountCm("light", TENT, true)).toBe(160);
    expect(defaultMountCm("exhaust", TENT, true)).toBe(170);
    expect(defaultMountCm("light", { widthCm: 60, depthCm: 60, heightCm: 30 }, true)).toBeLessThanOrEqual(30);
  });
  it("puts canopy sensors at canopy height", () => {
    expect(defaultMountCm("canopy_temp", TENT, false)).toBe(100);
    expect(defaultMountCm("co2_probe", TENT, false)).toBe(100);
  });
  it("places a device with no role by kind: a controllable one on the floor, a sensor at the canopy", () => {
    expect(defaultMountCm(undefined, TENT, true)).toBe(0);
    expect(defaultMountCm(undefined, TENT, false)).toBe(100);
  });
});

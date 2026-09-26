/**
 * Unit — controller lifecycle (Phase 4)
 *
 * The three states differ in what they permit, and the difference matters in
 * the tent: pausing must keep readings flowing while stopping hardware from
 * moving, so the two permissions are deliberately not the same flag.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  canActuate,
  canIngest,
  getControllerState,
  resetControllerState,
  setControllerState,
} from "../../src/controller/state.js";

beforeEach(() => resetControllerState());

describe("controller state", () => {
  it("starts running", () => {
    expect(getControllerState()).toBe("running");
    expect(canActuate()).toBe(true);
    expect(canIngest()).toBe(true);
  });

  it("keeps monitoring but stops acting when paused", () => {
    setControllerState("paused");

    expect(canIngest()).toBe(true);
    expect(canActuate()).toBe(false);
  });

  it("stops both when stopped", () => {
    setControllerState("stopped");

    expect(canIngest()).toBe(false);
    expect(canActuate()).toBe(false);
  });

  it("returns to acting on resume, from either state", () => {
    setControllerState("paused");
    expect(setControllerState("running")).toBe("running");
    expect(canActuate()).toBe(true);

    setControllerState("stopped");
    setControllerState("running");
    expect(canActuate()).toBe(true);
    expect(canIngest()).toBe(true);
  });

  it("treats a repeated transition as a no-op rather than an error", () => {
    setControllerState("paused");

    expect(setControllerState("paused")).toBe("paused");
    expect(getControllerState()).toBe("paused");
  });

  it("allows stopping straight from paused without resuming first", () => {
    setControllerState("paused");
    setControllerState("stopped");

    expect(getControllerState()).toBe("stopped");
  });
});

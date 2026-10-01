/**
 * Unit — sending a Shelly its broker credential (Phase 8 G)
 *
 * The device's HTTP API is stood in for by a fake fetch, which records what
 * was asked of it. Real Gen 1 and Gen 2 hardware is for the real-device
 * testing after Phase 9.
 */
import { describe, it, expect, vi } from "vitest";
import { lastPush, pushAndRecord, pushShellyCredential } from "../../src/device-manager/shelly-push.js";

const target = { host: "192.168.1.50", server: "192.168.1.20:1883", username: "canopy-0a1b2c3d", password: "p@ss/word+=" };

interface Call { url: string; method: string; body?: string }

/** A fake device: answers each path from the table, 404 otherwise, and records every call. */
function fakeShelly(routes: Record<string, { status?: number; json?: unknown }>) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    calls.push({ url: href, method: init?.method ?? "GET", ...(typeof init?.body === "string" ? { body: init.body } : {}) });
    const path = new URL(href).pathname;
    const route = routes[path];
    if (!route) return new Response("", { status: 404 });
    return new Response(route.json === undefined ? "" : JSON.stringify(route.json), { status: route.status ?? 200 });
  });
  return { calls, fetchImpl: fetchImpl as unknown as typeof fetch };
}

describe("pushShellyCredential", () => {
  it("sets a Gen 1 device's MQTT settings and reboots it so they take effect", async () => {
    const { calls, fetchImpl } = fakeShelly({
      "/shelly": { json: { type: "SHPLG-S", mac: "AABBCC" } },
      "/settings": { json: {} },
      "/reboot": { json: { ok: true } },
    });
    await pushShellyCredential(target, fetchImpl);

    expect(calls.map((c) => new URL(c.url).pathname)).toEqual(["/shelly", "/settings", "/reboot"]);
    const query = new URL(calls[1]!.url).searchParams;
    expect(query.get("mqtt_enable")).toBe("true");
    expect(query.get("mqtt_server")).toBe("192.168.1.20:1883");
    expect(query.get("mqtt_user")).toBe(target.username);
    // Escaped on the way, so a password with URL characters arrives intact.
    expect(query.get("mqtt_pass")).toBe(target.password);
  });

  it("uses MQTT.SetConfig on Gen 2, and reboots only when it asks", async () => {
    const { calls, fetchImpl } = fakeShelly({
      "/shelly": { json: { gen: 2, id: "shellyplus1-aabbcc" } },
      "/rpc/MQTT.SetConfig": { json: { restart_required: true } },
      "/rpc/Shelly.Reboot": { json: null },
    });
    await pushShellyCredential(target, fetchImpl);

    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([
      "GET /shelly", "POST /rpc/MQTT.SetConfig", "POST /rpc/Shelly.Reboot",
    ]);
    expect(JSON.parse(calls[1]!.body!)).toEqual({
      config: { enable: true, server: "192.168.1.20:1883", user: target.username, pass: target.password },
    });

    const quiet = fakeShelly({
      "/shelly": { json: { gen: 3 } },
      "/rpc/MQTT.SetConfig": { json: { restart_required: false } },
    });
    await pushShellyCredential(target, quiet.fetchImpl);
    expect(quiet.calls).toHaveLength(2);
  });

  it("explains a device with a web login, rather than sending it a password", async () => {
    const { fetchImpl } = fakeShelly({ "/shelly": { status: 401 } });
    await expect(pushShellyCredential(target, fetchImpl)).rejects.toThrow(/web login/);
  });

  it("explains a device that does not answer", async () => {
    const fetchImpl = vi.fn(async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
    await expect(pushShellyCredential(target, fetchImpl)).rejects.toThrow(/did not answer/);
  });
});

describe("pushAndRecord", () => {
  it("records the outcome for the device card, and never throws", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});

    const failing = fakeShelly({ "/shelly": { status: 401 } });
    const failed = await pushAndRecord("dev-1", target, failing.fetchImpl);
    expect(failed).toMatchObject({ state: "failed", error: expect.stringMatching(/web login/) });
    expect(lastPush("dev-1")).toEqual(failed);

    const working = fakeShelly({ "/shelly": { json: {} }, "/settings": { json: {} }, "/reboot": { json: {} } });
    expect((await pushAndRecord("dev-1", target, working.fetchImpl)).state).toBe("sent");
    expect(lastPush("dev-1")?.state).toBe("sent");
  });
});

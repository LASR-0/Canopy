/**
 * Unit — broker authentication (Tier 2 MQTT hardening, Phase 8 F)
 *
 * Who may connect is one pure decision over three inputs: what the client
 * presented, whether credentials are required, and whether a scan is open.
 * The table below is the whole rule; the live broker test in the roadmap
 * exercised it end to end against real MQTT clients.
 */
import { describe, it, expect, vi } from "vitest";

// settings.ts reads the database only in its load and save functions; the
// bind choice under test is pure, so the store is stubbed to keep the import
// from opening the live one.
vi.mock("../../src/store/index.js", () => ({ db: {} }));

const { authenticateClient, clientAuth, decideConnection, isDiscoveryTopic } = await import("../../src/broker/auth.js");
const { chooseBindHost } = await import("../../src/broker/settings.js");

const config = { username: "canopy", password: "s3cret-s3cret-s3cret-s3c", requireCredentials: true };
const pw = (s: string) => Buffer.from(s, "utf8");

describe("decideConnection", () => {
  it("lets the right credential in with full rights, scan or not", () => {
    for (const scan of [false, true]) {
      expect(decideConnection("canopy", pw(config.password), config, scan)).toEqual({ auth: "credential", provisioned: true });
    }
  });

  it("refuses a client without the credential when one is required and no scan is open", () => {
    expect(decideConnection(undefined, undefined, config, false)).toBeNull();
  });

  it("treats a wrong login like none, so Tasmota's default login is not a special case", () => {
    expect(decideConnection("DVES_USER", pw("DVES_PASS"), config, false)).toBeNull();
    expect(decideConnection("canopy", pw("wrong"), config, false)).toBeNull();
    // Right password, wrong user: still none.
    expect(decideConnection("someone", pw(config.password), config, false)).toBeNull();
  });

  it("lets a client without the credential in during a scan, unprovisioned", () => {
    expect(decideConnection(undefined, undefined, config, true)).toEqual({ auth: "anonymous", provisioned: false });
    expect(decideConnection("DVES_USER", pw("DVES_PASS"), config, true)).toEqual({ auth: "anonymous", provisioned: false });
  });

  it("lets anything in with full rights when credentials are not required, recorded as anonymous", () => {
    const open = { ...config, requireCredentials: false };
    expect(decideConnection(undefined, undefined, open, false)).toEqual({ auth: "anonymous", provisioned: true });
    expect(decideConnection("DVES_USER", pw("DVES_PASS"), open, false)).toEqual({ auth: "anonymous", provisioned: true });
  });

  it("never accepts an empty credential as the right one", () => {
    // Before the controller loads its settings the expected credential is empty.
    const unloaded = { username: "", password: "", requireCredentials: true };
    expect(decideConnection("", pw(""), unloaded, false)).toBeNull();
  });
});

describe("authenticateClient", () => {
  it("refuses with CONNACK 4, bad user name or password", () => {
    let error: { returnCode?: number } | null = null;
    let success: boolean | null = null;
    authenticateClient({ id: "anon" } as never, undefined, undefined, (e, s) => { error = e; success = s; });
    expect(success).toBe(false);
    expect(error).toMatchObject({ returnCode: 4 });
  });
});

describe("clientAuth", () => {
  it("is undefined for the controller's own publishes, which have no client", () => {
    expect(clientAuth(null)).toBeUndefined();
  });
});

describe("isDiscoveryTopic", () => {
  it.each([
    ["homeassistant/sensor/tent_temp/config", true],
    ["homeassistant/sensor/node/tent_temp/config", true], // with a node id
    ["shellies/announce", true],
    ["homeassistant/sensor/tent_temp/state", false],
    ["tele/tasmota_1/SENSOR", false],
    ["esphome-node/status", false],
    ["shellies/shelly1-abc/relay/0", false],
  ])("%s → %s", (topic, expected) => {
    expect(isDiscoveryTopic(topic)).toBe(expected);
  });
});

describe("chooseBindHost", () => {
  const here = ["192.168.1.20", "10.0.0.5"];

  it("listens on every interface by default", () => {
    expect(chooseBindHost(null, undefined, here)).toEqual({ host: "0.0.0.0" });
  });

  it("listens on the address chosen in Settings", () => {
    expect(chooseBindHost("192.168.1.20", undefined, here)).toEqual({ host: "192.168.1.20" });
  });

  it("lets MQTT_HOST override the setting", () => {
    expect(chooseBindHost("192.168.1.20", "10.0.0.5", here)).toEqual({ host: "10.0.0.5" });
  });

  it("falls back to every interface when the address is gone, and says so", () => {
    // A changed DHCP lease must not take every device offline.
    expect(chooseBindHost("192.168.1.99", undefined, here)).toEqual({ host: "0.0.0.0", unavailable: "192.168.1.99" });
  });

  it("always allows loopback", () => {
    expect(chooseBindHost("127.0.0.1", undefined, [])).toEqual({ host: "127.0.0.1" });
  });
});

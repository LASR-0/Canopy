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

const { authenticateClient, clientAuth, decideConnection, isDiscoveryTopic, stillValid } = await import("../../src/broker/auth.js");
const { brokerAddressFor, chooseBindHost } = await import("../../src/broker/settings.js");

const shared = { username: "canopy", password: "s3cret-s3cret-s3cret-s3c" };
const fan = { username: "canopy-0a1b2c3d", password: "fan-fan-fan-fan-fan-fan-", deviceId: "dev-fan" };
const config = { credentials: [shared, fan], requireCredentials: true };
const pw = (s: string) => Buffer.from(s, "utf8");

describe("decideConnection", () => {
  it("lets the shared credential in with full rights, scan or not", () => {
    for (const scan of [false, true]) {
      expect(decideConnection("canopy", pw(shared.password), config, scan)).toEqual({ auth: "shared", provisioned: true, credential: shared });
    }
  });

  it("lets a device's own credential in as that device (Phase 8 G)", () => {
    expect(decideConnection(fan.username, pw(fan.password), config, false))
      .toEqual({ auth: "device", provisioned: true, deviceId: "dev-fan", credential: fan });
  });

  it("does not mix one credential's username with another's password", () => {
    expect(decideConnection(fan.username, pw(shared.password), config, false)).toBeNull();
    expect(decideConnection("canopy", pw(fan.password), config, false)).toBeNull();
  });

  it("refuses a client without the credential when one is required and no scan is open", () => {
    expect(decideConnection(undefined, undefined, config, false)).toBeNull();
  });

  it("treats a wrong login like none, so Tasmota's default login is not a special case", () => {
    expect(decideConnection("DVES_USER", pw("DVES_PASS"), config, false)).toBeNull();
    expect(decideConnection("canopy", pw("wrong"), config, false)).toBeNull();
    // Right password, wrong user: still none.
    expect(decideConnection("someone", pw(shared.password), config, false)).toBeNull();
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
    // Before the controller loads its settings there are no credentials, and
    // a stored one is never empty, but an empty login must not match either way.
    expect(decideConnection("", pw(""), { credentials: [], requireCredentials: true }, false)).toBeNull();
    const blank = { credentials: [{ username: "", password: "" }], requireCredentials: true };
    expect(decideConnection("", pw(""), blank, false)).toBeNull();
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

describe("stillValid", () => {
  const connected = decideConnection(fan.username, pw(fan.password), config, false)!;

  it("keeps a client whose credential is unchanged", () => {
    expect(stillValid(connected, config)).toBe(true);
  });

  it("drops a client whose device was forgotten, taking its credential", () => {
    expect(stillValid(connected, { ...config, credentials: [shared] })).toBe(false);
  });

  it("drops a client whose credential has a new password", () => {
    expect(stillValid(connected, { ...config, credentials: [shared, { ...fan, password: "new" }] })).toBe(false);
  });

  it("is not about clients without a credential, which requireCredentials judges", () => {
    expect(stillValid({ auth: "anonymous", provisioned: true }, { credentials: [], requireCredentials: true })).toBe(true);
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

describe("brokerAddressFor", () => {
  const nics = [
    { address: "127.0.0.1", netmask: "255.0.0.0", family: "IPv4", internal: true },
    { address: "10.0.0.5", netmask: "255.255.255.0", family: "IPv4", internal: false },
    { address: "192.168.1.20", netmask: "255.255.255.0", family: "IPv4", internal: false },
  ];

  it("tells a device the address on its own network", () => {
    expect(brokerAddressFor("192.168.1.77", "0.0.0.0", nics)).toBe("192.168.1.20");
    expect(brokerAddressFor("10.0.0.9", "0.0.0.0", nics)).toBe("10.0.0.5");
  });

  it("uses the address the broker is pinned to, whatever the device's network", () => {
    expect(brokerAddressFor("10.0.0.9", "192.168.1.20", nics)).toBe("192.168.1.20");
  });

  it("falls back to the first address for a device on no network of ours", () => {
    expect(brokerAddressFor("172.16.0.4", "0.0.0.0", nics)).toBe("10.0.0.5");
    expect(brokerAddressFor(undefined, "0.0.0.0", nics)).toBe("10.0.0.5");
  });

  it("sends a device on this machine to loopback", () => {
    expect(brokerAddressFor("127.0.0.1", "0.0.0.0", nics)).toBe("127.0.0.1");
  });
});

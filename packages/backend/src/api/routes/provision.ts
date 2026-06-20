import type { FastifyInstance } from "fastify";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

const DEVICE_AP_PATTERN = /^canopy[-_]/i;

interface WifiNetwork {
  ssid: string;
  signal: number;
  isDeviceAp: boolean;
}

async function scanWifiWindows(): Promise<WifiNetwork[]> {
  try {
    const { stdout } = await execAsync("netsh wlan show networks mode=bssid", { timeout: 8000 });
    const networks: WifiNetwork[] = [];
    const blocks = stdout.split(/\r?\n\r?\n/);
    for (const block of blocks) {
      const ssidMatch = block.match(/^SSID\s+\d*\s*:\s+(.+)$/m);
      const signalMatch = block.match(/Signal\s+:\s+(\d+)%/);
      if (ssidMatch) {
        const ssid = ssidMatch[1].trim();
        const signal = signalMatch ? parseInt(signalMatch[1]) : 0;
        if (ssid) networks.push({ ssid, signal, isDeviceAp: DEVICE_AP_PATTERN.test(ssid) });
      }
    }
    return networks;
  } catch {
    return [];
  }
}

async function scanWifiMac(): Promise<WifiNetwork[]> {
  try {
    const { stdout } = await execAsync(
      "/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport -s",
      { timeout: 8000 },
    );
    return stdout
      .split("\n")
      .slice(1)
      .filter((l) => l.trim())
      .map((l) => {
        const parts = l.trim().split(/\s+/);
        const ssid = parts[0] ?? "";
        const rssi = parseInt(parts[2] ?? "-100");
        return { ssid, signal: Math.max(0, Math.min(100, (rssi + 100) * 2)), isDeviceAp: DEVICE_AP_PATTERN.test(ssid) };
      })
      .filter((n) => n.ssid);
  } catch {
    return [];
  }
}

export async function provisionRoutes(app: FastifyInstance): Promise<void> {
  app.get("/provision/wifi-scan", async (_req, reply) => {
    const networks = process.platform === "darwin" ? await scanWifiMac() : await scanWifiWindows();
    return reply.send({ networks });
  });

  app.post<{ Body: { deviceIp: string; ssid: string; password: string } }>(
    "/provision/softap/credentials",
    async (req, reply) => {
      const { deviceIp, ssid, password } = req.body;
      if (!deviceIp || !ssid || !password) {
        return reply.status(400).send({ error: "deviceIp, ssid, and password are required" });
      }
      try {
        const res = await fetch(`http://${deviceIp}/provisioning`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ssid, password }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) return reply.status(502).send({ error: `Device returned ${res.status}` });
        return reply.send({ sent: true });
      } catch (e) {
        return reply.status(502).send({ error: `Could not reach device: ${e instanceof Error ? e.message : String(e)}` });
      }
    },
  );
}

/**
 * mDNS scanner — uses bonjour-service to browse the local network.
 *
 * Scans _http._tcp for HTTP/mDNS devices (Shelly, ESPHome HTTP mode, etc.)
 * Emits discovered devices via a callback so the scan session manager
 * can persist them and push WS events.
 */
import Bonjour from "bonjour-service";
import { isShellyHostname, deviceFromShellyMdns } from "./adapters/shelly.js";
import type { Device } from "@canopy/shared-types";

type DiscoveryCallback = (device: Omit<Device, "id">) => void;

const SCAN_DURATION_MS = 15_000;

/** Service types to browse */
const SERVICE_TYPES = ["http", "esphomelib"];

export function runMdnsScan(workspaceId: string, onFound: DiscoveryCallback): () => void {
  const bonjour = new Bonjour();
  const browsers: ReturnType<typeof bonjour.find>[] = [];

  for (const type of SERVICE_TYPES) {
    const browser = bonjour.find({ type }, (service) => {
      const hostname = service.host ?? service.name;
      const host = service.addresses?.[0] ?? service.host;
      const port = service.port ?? 80;

      if (!hostname || !host) return;

      // Shelly
      if (isShellyHostname(hostname)) {
        onFound(deviceFromShellyMdns(hostname, host, port, workspaceId));
        return;
      }

      // Generic HTTP device (ESPHome, others)
      if (service.name) {
        const device: Omit<Device, "id"> = {
          workspaceId,
          name: service.name,
          family: "generic-mqtt",
          address: { protocol: "http" as const, host, port },
          ...(service.txt?.["model"] ? { model: String(service.txt["model"]) } : {}),
          capabilities: [],
          discoveredVia: "mdns" as const,
          online: true,
          runtimeHours: 0,
        };
        onFound(device);
      }
    });

    browsers.push(browser);
  }

  // Auto-stop after scan window
  const timer = setTimeout(() => {
    browsers.forEach((b) => b.stop());
    bonjour.destroy();
  }, SCAN_DURATION_MS);

  // Return a cancel function
  return () => {
    clearTimeout(timer);
    browsers.forEach((b) => b.stop());
    bonjour.destroy();
  };
}

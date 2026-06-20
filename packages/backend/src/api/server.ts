import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { healthRoutes }       from "./routes/health.js";
import { controllerRoutes }   from "./routes/controller.js";
import { workspaceRoutes }    from "./routes/workspaces.js";
import { settingsRoutes }     from "./routes/settings.js";
import { deviceRoutes }       from "./routes/devices.js";
import { thresholdRoutes }    from "./routes/thresholds.js";
import { readingsRoutes }     from "./routes/readings.js";
import { growRoutes }         from "./routes/grows.js";
import { automationRoutes }   from "./routes/automations.js";
import { journalRoutes }      from "./routes/journal.js";
import { maintenanceRoutes }  from "./routes/maintenance.js";
import { eventRoutes }        from "./routes/events.js";
import { chartLayoutRoutes }  from "./routes/chart-layouts.js";
import { provisionRoutes }    from "./routes/provision.js";
import { registerWs }         from "../ws/index.js";

export const PORT = Number(process.env["PORT"] ?? 7001);

export async function buildServer() {
  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });
  await app.register(websocket);

  await app.register(healthRoutes);
  await app.register(controllerRoutes);
  await app.register(workspaceRoutes);
  await app.register(settingsRoutes);
  await app.register(deviceRoutes);
  await app.register(thresholdRoutes);
  await app.register(readingsRoutes);
  await app.register(growRoutes);
  await app.register(automationRoutes);
  await app.register(journalRoutes);
  await app.register(maintenanceRoutes);
  await app.register(eventRoutes);
  await app.register(chartLayoutRoutes);
  await app.register(provisionRoutes);

  registerWs(app);

  return app;
}

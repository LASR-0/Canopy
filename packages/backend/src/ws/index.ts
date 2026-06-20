import type { FastifyInstance } from "fastify";
import type { WebSocket } from "@fastify/websocket";
import type { WsEnvelope, ServerMessage, ClientMessage } from "@canopy/shared-types";
import { WS_PROTOCOL_VERSION } from "@canopy/shared-types";

/** All currently connected renderer clients. */
const clients = new Set<WebSocket>();

/**
 * Push a message to all connected clients.
 * Phase 6: add per-tent subscription filtering here.
 */
export function broadcast(msg: ServerMessage): void {
  const envelope: WsEnvelope<ServerMessage> = {
    v: WS_PROTOCOL_VERSION,
    ts: new Date().toISOString(),
    msg,
  };
  const json = JSON.stringify(envelope);
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) ws.send(json);
  }
}

export function registerWs(app: FastifyInstance): void {
  app.get("/ws", { websocket: true }, (socket) => {
    clients.add(socket);

    socket.on("message", (raw: Buffer | string) => {
      try {
        const envelope = JSON.parse(raw.toString()) as WsEnvelope<ClientMessage>;
        if (envelope.v !== WS_PROTOCOL_VERSION) return;
        // Phase 6: honour subscribe / unsubscribe per tent
      } catch {
        // Ignore malformed frames
      }
    });

    socket.on("close", () => {
      clients.delete(socket);
    });
  });
}

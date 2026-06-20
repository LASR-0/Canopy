import type { WsEnvelope, ServerMessage } from "@canopy/shared-types";
import { WS_PROTOCOL_VERSION } from "@canopy/shared-types";
import { BACKEND_URL } from "./http.js";

type MessageHandler = (msg: ServerMessage) => void;

class WsManager {
  private socket: WebSocket | null = null;
  private handlers = new Set<MessageHandler>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _connected = false;

  get connected() {
    return this._connected;
  }

  connect(): void {
    if (this.socket?.readyState === WebSocket.OPEN) return;
    const wsUrl = BACKEND_URL.replace(/^http/, "ws") + "/ws";
    const socket = new WebSocket(wsUrl);
    this.socket = socket;

    socket.onopen = () => {
      this._connected = true;
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
    };

    socket.onmessage = (event) => {
      try {
        const envelope = JSON.parse(event.data as string) as WsEnvelope<ServerMessage>;
        if (envelope.v !== WS_PROTOCOL_VERSION) return;
        for (const handler of this.handlers) handler(envelope.msg);
      } catch {
        // Ignore malformed frames
      }
    };

    socket.onclose = () => {
      this._connected = false;
      this.scheduleReconnect();
    };

    socket.onerror = () => {
      socket.close();
    };
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.close();
    this.socket = null;
    this._connected = false;
  }

  subscribe(handler: MessageHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 3000);
  }
}

/** Singleton WS manager — import and call `.connect()` once at app start. */
export const wsManager = new WsManager();

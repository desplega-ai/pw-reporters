import WebSocket from "ws";
import type { ReporterEvent } from "../types";
import { MessageQueue } from "./message-queue";

export interface WebSocketClientConfig {
  /** WebSocket endpoint URL */
  endpoint: string;
  /** API key for authentication */
  apiKey: string;
  /** Reconnection settings */
  reconnect?: {
    enabled?: boolean;
    maxAttempts?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
  };
  /** Enable debug logging */
  debug?: boolean;
}

type ConnectionState = "disconnected" | "connecting" | "connected" | "closing";

/**
 * WebSocket client with automatic reconnection and message buffering.
 * Uses exponential backoff with jitter for reconnection attempts.
 */
export class WebSocketClient {
  private config: WebSocketClientConfig;
  private ws: WebSocket | null = null;
  private state: ConnectionState = "disconnected";
  private messageQueue: MessageQueue;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private debug: boolean;

  // Reconnection defaults
  private readonly reconnectEnabled: boolean;
  private readonly maxReconnectAttempts: number;
  private readonly initialDelayMs: number;
  private readonly maxDelayMs: number;

  // Heartbeat interval (30 seconds)
  private readonly heartbeatIntervalMs = 30000;

  constructor(config: WebSocketClientConfig) {
    this.config = config;
    this.debug = config.debug ?? false;

    // Set reconnection parameters
    this.reconnectEnabled = config.reconnect?.enabled ?? true;
    this.maxReconnectAttempts = config.reconnect?.maxAttempts ?? 10;
    this.initialDelayMs = config.reconnect?.initialDelayMs ?? 1000;
    this.maxDelayMs = config.reconnect?.maxDelayMs ?? 30000;

    // Initialize message queue
    this.messageQueue = new MessageQueue({ debug: this.debug });

    // Connect immediately
    this.connect();
  }

  private log(...args: unknown[]): void {
    if (this.debug) {
      console.log("[ws-client]", ...args);
    }
  }

  /**
   * Calculate reconnection delay with exponential backoff and jitter
   */
  private getReconnectDelay(): number {
    // Exponential backoff: initialDelay * 2^attempt
    const exponentialDelay =
      this.initialDelayMs * Math.pow(2, this.reconnectAttempts);

    // Cap at max delay
    const cappedDelay = Math.min(exponentialDelay, this.maxDelayMs);

    // Add jitter (0-25% of the delay)
    const jitter = cappedDelay * Math.random() * 0.25;

    return cappedDelay + jitter;
  }

  /**
   * Establish WebSocket connection
   */
  private connect(): void {
    if (this.state === "connecting" || this.state === "connected") {
      return;
    }

    this.state = "connecting";
    this.log("Connecting to", this.config.endpoint);

    try {
      // Create WebSocket with authorization header via URL protocol
      // Note: Browser WebSocket doesn't support custom headers, so we pass token as query param
      const url = new URL(this.config.endpoint);
      url.searchParams.set("token", this.config.apiKey);

      this.ws = new WebSocket(url.toString());

      this.ws.onopen = () => {
        this.log("Connected");
        this.state = "connected";
        this.reconnectAttempts = 0;

        // Start heartbeat
        this.startHeartbeat();

        // Drain queued messages
        this.drainQueue();
      };

      this.ws.onclose = (event) => {
        this.log("Connection closed:", event.code, event.reason);
        this.stopHeartbeat();

        if (this.state !== "closing") {
          this.state = "disconnected";
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = (error) => {
        this.log("Connection error:", error);
        // onclose will be called after onerror
      };

      this.ws.onmessage = (event) => {
        this.log("Received message:", event.data);
        // Handle server acknowledgments or commands if needed
      };
    } catch (error) {
      this.log("Failed to create WebSocket:", error);
      this.state = "disconnected";
      this.scheduleReconnect();
    }
  }

  /**
   * Schedule a reconnection attempt
   */
  private scheduleReconnect(): void {
    if (!this.reconnectEnabled) {
      this.log("Reconnection disabled");
      return;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.log("Max reconnection attempts reached");
      return;
    }

    const delay = this.getReconnectDelay();
    this.reconnectAttempts++;

    this.log(
      `Scheduling reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms`,
    );

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  /**
   * Start heartbeat ping to detect stale connections
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        // Send ping frame (WebSocket protocol level)
        // Note: Browser WebSocket auto-handles ping/pong, this is application-level
        try {
          this.ws.send(JSON.stringify({ type: "ping" }));
          this.log("Sent heartbeat ping");
        } catch {
          this.log("Failed to send heartbeat");
        }
      }
    }, this.heartbeatIntervalMs);
  }

  /**
   * Stop heartbeat timer
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Drain queued messages after reconnection
   */
  private drainQueue(): void {
    if (this.messageQueue.isEmpty) {
      return;
    }

    this.log("Draining", this.messageQueue.size, "queued messages");

    const messages = this.messageQueue.drain();
    for (const message of messages) {
      this.sendImmediate(message);
    }
  }

  /**
   * Send message immediately (no queuing)
   */
  private sendImmediate(message: ReporterEvent): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      return false;
    }

    try {
      this.ws.send(JSON.stringify(message));
      return true;
    } catch (error) {
      this.log("Failed to send message:", error);
      return false;
    }
  }

  /**
   * Send a message. If disconnected, queues for later delivery.
   */
  send(message: ReporterEvent): void {
    if (this.state === "connected" && this.sendImmediate(message)) {
      // this.log("Sent:", message.event);
      return;
    }

    // Queue for later
    this.messageQueue.enqueue(message);
    this.log("Queued:", message.event);
  }

  /**
   * Close the WebSocket connection gracefully
   */
  async close(): Promise<void> {
    this.state = "closing";

    // Cancel any pending reconnection
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Stop heartbeat
    this.stopHeartbeat();

    // Close WebSocket
    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.close(1000, "Reporter finished");
      }
      this.ws = null;
    }

    this.log("Closed");
  }

  /**
   * Get current connection state
   */
  getState(): ConnectionState {
    return this.state;
  }

  /**
   * Get number of queued messages
   */
  getQueueSize(): number {
    return this.messageQueue.size;
  }
}

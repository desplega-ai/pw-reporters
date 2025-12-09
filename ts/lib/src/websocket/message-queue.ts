import type { ReporterEvent } from "../types";

/**
 * Message queue for buffering WebSocket messages during disconnection.
 * Uses a simple array with configurable max size.
 */
export class MessageQueue {
  private queue: ReporterEvent[] = [];
  private maxSize: number;
  private debug: boolean;

  constructor(options: { maxSize?: number; debug?: boolean } = {}) {
    this.maxSize = options.maxSize ?? 1000;
    this.debug = options.debug ?? false;
  }

  private log(...args: unknown[]): void {
    if (this.debug) {
      console.log("[message-queue]", ...args);
    }
  }

  /**
   * Add a message to the queue
   * If queue is full, drops oldest messages
   */
  enqueue(message: ReporterEvent): void {
    if (this.queue.length >= this.maxSize) {
      const dropped = this.queue.shift();
      this.log("Queue full, dropped oldest message:", dropped?.event);
    }
    this.queue.push(message);
    this.log(
      "Enqueued message:",
      message.event,
      "Queue size:",
      this.queue.length,
    );
  }

  /**
   * Get all queued messages and clear the queue
   */
  drain(): ReporterEvent[] {
    const messages = this.queue;
    this.queue = [];
    this.log("Drained", messages.length, "messages");
    return messages;
  }

  /**
   * Get current queue size
   */
  get size(): number {
    return this.queue.length;
  }

  /**
   * Check if queue is empty
   */
  get isEmpty(): boolean {
    return this.queue.length === 0;
  }

  /**
   * Clear all messages from the queue
   */
  clear(): void {
    const count = this.queue.length;
    this.queue = [];
    this.log("Cleared", count, "messages");
  }
}

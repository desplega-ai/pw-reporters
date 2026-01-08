import type { SemanticBatch } from "../types";

export interface HttpBatchClientConfig {
  /** HTTP endpoint for batch submissions (e.g., "https://api.desplega.ai/pw-reporter/batch") */
  endpoint: string;
  /** API key for authentication */
  apiKey: string;
  /** Number of retry attempts (default: 3) */
  retries?: number;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * HTTP client for sending semantic batches with retry support.
 * Manages sequence numbers to ensure server-side ordering.
 */
export class HttpBatchClient {
  private config: HttpBatchClientConfig;
  private sequence = 0;
  private debug: boolean;
  private readonly maxRetries: number;

  constructor(config: HttpBatchClientConfig) {
    this.config = config;
    this.debug = config.debug ?? false;
    this.maxRetries = config.retries ?? 3;
  }

  private log(...args: unknown[]): void {
    if (this.debug) {
      console.log("[http-batch]", ...args);
    }
  }

  /**
   * Send a batch, automatically adding sequence number.
   * Retries on server errors with exponential backoff.
   */
  async sendBatch(batch: Omit<SemanticBatch, "sequence">): Promise<void> {
    const fullBatch: SemanticBatch = {
      ...batch,
      sequence: ++this.sequence,
    };

    this.log(
      `Sending batch: ${fullBatch.batch_type} (seq: ${fullBatch.sequence}, events: ${fullBatch.events.length})`,
    );

    await this.sendWithRetry(fullBatch);
  }

  /**
   * Send batch with exponential backoff retry on server errors
   */
  private async sendWithRetry(
    batch: SemanticBatch,
    attempt = 0,
  ): Promise<void> {
    try {
      const response = await fetch(this.config.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(batch),
      });

      if (response.ok) {
        this.log(`Batch sent successfully (seq: ${batch.sequence})`);
        return;
      }

      // Retry on server errors (5xx)
      if (response.status >= 500 && attempt < this.maxRetries) {
        const delay = this.getRetryDelay(attempt);
        this.log(
          `Server error ${response.status}, retrying in ${delay}ms (attempt ${attempt + 1}/${this.maxRetries})`,
        );
        await this.sleep(delay);
        return this.sendWithRetry(batch, attempt + 1);
      }

      // Non-retryable error
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    } catch (error) {
      // Network errors - retry
      if (attempt < this.maxRetries && this.isNetworkError(error)) {
        const delay = this.getRetryDelay(attempt);
        this.log(
          `Network error, retrying in ${delay}ms (attempt ${attempt + 1}/${this.maxRetries})`,
        );
        await this.sleep(delay);
        return this.sendWithRetry(batch, attempt + 1);
      }
      throw error;
    }
  }

  /**
   * Calculate retry delay with exponential backoff (1s, 2s, 4s, 8s...)
   */
  private getRetryDelay(attempt: number): number {
    return Math.min(1000 * Math.pow(2, attempt), 10000);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private isNetworkError(error: unknown): boolean {
    return (
      error instanceof TypeError ||
      (error instanceof Error &&
        (error.message.includes("fetch") ||
          error.message.includes("network") ||
          error.message.includes("ECONNREFUSED")))
    );
  }

  /**
   * Get current sequence number (for debugging/testing)
   */
  getSequence(): number {
    return this.sequence;
  }
}

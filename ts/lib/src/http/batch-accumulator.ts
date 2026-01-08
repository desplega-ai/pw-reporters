import type { HttpBatchClient } from "./client";
import type {
  ReporterEvent,
  OnBeginEvent,
  OnTestBeginEvent,
  OnTestEndEvent,
  OnStepBeginEvent,
  OnStepEndEvent,
  OnErrorEvent,
  OnEndEvent,
  OnExitEvent,
  OnStdOutEvent,
  OnStdErrEvent,
  ShardInfo,
} from "../types";

/**
 * Accumulates Playwright reporter events into semantic batches.
 *
 * Batch types:
 * - run_begin: onBegin event (sent immediately)
 * - test_complete: onTestBegin + all steps + onTestEnd for ONE test
 * - run_end: onEnd + onExit events
 * - error: onError events (sent immediately)
 * - output: buffered stdout/stderr (flushed periodically or with other batches)
 */
export class BatchAccumulator {
  private client: HttpBatchClient;
  private debug: boolean;

  // Run metadata
  private runId: string = "";
  private configFile?: string;
  private shard?: ShardInfo;

  // Per-test event accumulation (supports parallel tests)
  private currentTestEvents: Map<string, ReporterEvent[]> = new Map();

  // Output buffering
  private outputBuffer: ReporterEvent[] = [];
  private outputFlushTimer?: ReturnType<typeof setTimeout>;
  private readonly outputFlushIntervalMs = 5000;

  constructor(client: HttpBatchClient, debug = false) {
    this.client = client;
    this.debug = debug;
  }

  private log(...args: unknown[]): void {
    if (this.debug) {
      console.log("[batch-accumulator]", ...args);
    }
  }

  /**
   * Handle onBegin - sends run_begin batch immediately
   */
  async handleRunBegin(event: OnBeginEvent): Promise<void> {
    this.runId = event.runId;
    this.configFile = event.config.configFile ?? undefined;
    this.shard = event.config.shard ?? undefined;

    this.log("Run begin:", this.runId);

    await this.client.sendBatch({
      run_id: this.runId,
      batch_type: "run_begin",
      events: [event],
      timestamp: new Date().toISOString(),
      config_file: this.configFile,
      shard: this.shard,
    });
  }

  /**
   * Handle onTestBegin - start accumulating events for this test
   */
  handleTestBegin(event: OnTestBeginEvent): void {
    const testId = event.test.id;
    this.log("Test begin:", testId);
    this.currentTestEvents.set(testId, [event]);
  }

  /**
   * Handle onStepBegin - accumulate with test events
   */
  handleStepBegin(event: OnStepBeginEvent): void {
    const testId = event.test.id;
    const events = this.currentTestEvents.get(testId);
    if (events) {
      events.push(event);
    } else {
      this.log("Warning: Step begin for unknown test:", testId);
    }
  }

  /**
   * Handle onStepEnd - accumulate with test events
   */
  handleStepEnd(event: OnStepEndEvent): void {
    const testId = event.test.id;
    const events = this.currentTestEvents.get(testId);
    if (events) {
      events.push(event);
    } else {
      this.log("Warning: Step end for unknown test:", testId);
    }
  }

  /**
   * Handle onTestEnd - send complete test_complete batch
   */
  async handleTestEnd(event: OnTestEndEvent): Promise<void> {
    const testId = event.test.id;
    const events = this.currentTestEvents.get(testId);

    if (!events) {
      // Edge case: test end without begin (shouldn't happen, but handle gracefully)
      this.log("Warning: Test end without begin, sending standalone:", testId);
      await this.client.sendBatch({
        run_id: this.runId,
        batch_type: "test_complete",
        events: [event],
        test_id: testId,
        retry_count: event.result.retry,
        timestamp: new Date().toISOString(),
        config_file: this.configFile,
        shard: this.shard,
      });
      return;
    }

    // Add end event and send batch
    events.push(event);

    this.log(
      `Test complete: ${testId} (${events.length} events, retry: ${event.result.retry})`,
    );

    await this.client.sendBatch({
      run_id: this.runId,
      batch_type: "test_complete",
      events: events,
      test_id: testId,
      retry_count: event.result.retry,
      timestamp: new Date().toISOString(),
      config_file: this.configFile,
      shard: this.shard,
    });

    // Clean up
    this.currentTestEvents.delete(testId);
  }

  /**
   * Handle onError - sends error batch immediately
   */
  async handleError(event: OnErrorEvent): Promise<void> {
    this.log("Error:", event.error.message?.slice(0, 100));

    // Flush any pending output first to maintain ordering
    await this.flushOutput();

    await this.client.sendBatch({
      run_id: this.runId,
      batch_type: "error",
      events: [event],
      timestamp: new Date().toISOString(),
      config_file: this.configFile,
      shard: this.shard,
    });
  }

  /**
   * Handle onStdOut - buffer for periodic flush
   */
  handleStdOut(event: OnStdOutEvent): void {
    this.outputBuffer.push(event);
    this.scheduleOutputFlush();
  }

  /**
   * Handle onStdErr - buffer for periodic flush
   */
  handleStdErr(event: OnStdErrEvent): void {
    this.outputBuffer.push(event);
    this.scheduleOutputFlush();
  }

  /**
   * Schedule output flush if not already scheduled
   */
  private scheduleOutputFlush(): void {
    if (this.outputFlushTimer) return;
    this.outputFlushTimer = setTimeout(
      () => this.flushOutput(),
      this.outputFlushIntervalMs,
    );
  }

  /**
   * Flush buffered output as an output batch
   */
  async flushOutput(): Promise<void> {
    // Clear timer
    if (this.outputFlushTimer) {
      clearTimeout(this.outputFlushTimer);
      this.outputFlushTimer = undefined;
    }

    // Nothing to flush
    if (this.outputBuffer.length === 0) return;

    const events = this.outputBuffer;
    this.outputBuffer = [];

    this.log(`Flushing ${events.length} output events`);

    await this.client.sendBatch({
      run_id: this.runId,
      batch_type: "output",
      events: events,
      timestamp: new Date().toISOString(),
      config_file: this.configFile,
      shard: this.shard,
    });
  }

  /**
   * Handle onEnd + onExit - sends run_end batch
   */
  async handleRunEnd(
    endEvent: OnEndEvent,
    exitEvent: OnExitEvent,
  ): Promise<void> {
    this.log("Run end");

    // Flush any remaining output first
    await this.flushOutput();

    await this.client.sendBatch({
      run_id: this.runId,
      batch_type: "run_end",
      events: [endEvent, exitEvent],
      timestamp: new Date().toISOString(),
      config_file: this.configFile,
      shard: this.shard,
    });
  }

  /**
   * Store onEnd event to be sent with onExit
   */
  private pendingEndEvent: OnEndEvent | null = null;

  /**
   * Handle onEnd - store for later (will be sent with onExit)
   */
  handleEnd(event: OnEndEvent): void {
    this.log("Storing onEnd event");
    this.pendingEndEvent = event;
  }

  /**
   * Handle onExit - send run_end batch with stored onEnd event
   */
  async handleExit(event: OnExitEvent): Promise<void> {
    if (this.pendingEndEvent) {
      await this.handleRunEnd(this.pendingEndEvent, event);
      this.pendingEndEvent = null;
    } else {
      // Edge case: exit without end (shouldn't happen)
      this.log("Warning: onExit without onEnd");
      await this.flushOutput();
      await this.client.sendBatch({
        run_id: this.runId,
        batch_type: "run_end",
        events: [event],
        timestamp: new Date().toISOString(),
        config_file: this.configFile,
        shard: this.shard,
      });
    }
  }
}

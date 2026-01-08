# HTTP Batch Transport Implementation Plan

## Overview

Add HTTP batch transport support to the Playwright reporter as an alternative to WebSocket streaming. The batch transport groups events by semantic boundaries (run_begin, test_complete, run_end, error, output) and sends them via HTTP POST to `/pw-reporter/batch`. This provides better reliability for environments where WebSocket connections are problematic and enables server-side ordered processing via sequence numbers.

## Current State Analysis

### Existing Architecture
- **Reporter** (`ts/lib/src/reporter.ts`): Main entry point implementing Playwright's `Reporter` interface
- **WebSocket Client** (`ts/lib/src/websocket/client.ts`): Handles streaming with reconnection logic and message queuing
- **File Uploader** (`ts/lib/src/uploader/`): HTTP-based file upload with chunking and retry support
- **Types** (`ts/lib/src/types.ts`): All serialized event types and interfaces
- **Test Server** (`ts/ws.ts`): Development server for testing WebSocket and HTTP uploads

### Key Patterns Discovered
- Config resolution: env vars take precedence, then config options, then defaults (`reporter.ts:130-152`)
- Debug logging: `this.log(...args)` pattern with `[component-name]` prefix
- Retry logic: Exponential backoff with `Math.pow(2, attempt) * 1000` capped at max delay
- Modular clients: Separate classes for WebSocket and HTTP operations

### Event Flow
1. `onBegin` - Test suite starts, config and suite structure available
2. `onTestBegin` - Individual test starts
3. `onStepBegin/End` - Test steps (actions, assertions)
4. `onTestEnd` - Individual test completes with result
5. `onStdOut/onStdErr` - Console output (may or may not be associated with a test)
6. `onError` - Global errors
7. `onEnd` - Suite completes
8. `onExit` - Reporter cleanup

## Desired End State

After implementation:
1. Users can configure `transport: "http"` or set `DESPLEGA_TRANSPORT=http` to use HTTP batching
2. Events are grouped into semantic batches before sending
3. Each batch includes a sequence number for server-side ordering
4. WebSocket remains the default for backward compatibility
5. Test server supports `/batch` endpoint for development testing

### Verification
- `bun test lib/src/` passes
- `bun run typecheck` passes
- Manual test with `transport: "http"` sends batches to test server
- Parallel test runs correctly group events per test

## What We're NOT Doing

- Changing the WebSocket transport behavior
- Modifying file upload logic (remains HTTP-based regardless of transport)
- Adding compression or other optimizations to batches
- Server-side implementation (backend already supports `/pw-reporter/batch`)

## Implementation Approach

Create a parallel HTTP transport path that mirrors the WebSocket architecture:
- `HttpBatchClient` - Sends batches with retry logic (analogous to `WebSocketClient`)
- `BatchAccumulator` - Accumulates events into semantic batches (new concept)
- Modify `reporter.ts` to conditionally use either transport based on config

---

## Phase 1: Add Types

### Overview
Add the `SemanticBatch` and `ShardInfo` types to support the batch transport.

### Changes Required:

#### 1. Add Batch Types
**File**: `ts/lib/src/types.ts`
**Changes**: Add new interfaces at the end of the file, before the `ReporterEvent` union

```typescript
// ============================================
// HTTP Batch Transport Types
// ============================================

/**
 * Shard information for parallel test runs
 */
export interface ShardInfo {
  current: number;
  total: number;
}

/**
 * Semantic batch containing related events
 */
export interface SemanticBatch {
  /** Unique run identifier */
  run_id: string;
  /** Type of batch determining its contents */
  batch_type: "run_begin" | "test_complete" | "run_end" | "error" | "output";
  /** Incrementing sequence number for ordering (1, 2, 3, ...) */
  sequence: number;
  /** Events contained in this batch */
  events: ReporterEvent[];

  /** Test ID (for test_complete batches) */
  test_id?: string;
  /** Retry attempt number (for test_complete batches) */
  retry_count?: number;

  /** ISO 8601 timestamp when batch was created */
  timestamp: string;
  /** Path to Playwright config file */
  config_file?: string;
  /** Shard info for parallel runs */
  shard?: ShardInfo;
}
```

#### 2. Export New Types
**File**: `ts/lib/src/index.ts`
**Changes**: Add exports for new types

```typescript
// Add to the type exports section
export type {
  // ... existing exports ...
  ShardInfo,
  SemanticBatch,
} from "./types";
```

### Success Criteria:

#### Automated Verification:
- [x] TypeScript compiles: `bun run typecheck` (note: pre-existing type errors in test/config files, library compiles correctly)
- [x] Existing tests pass: `bun test lib/src/`

#### Manual Verification:
- [ ] Types are importable from the package

---

## Phase 2: Create HTTP Batch Client

### Overview
Create the HTTP client that sends batches with retry logic, mirroring the patterns from `HttpUploader`.

### Changes Required:

#### 1. Create HTTP Client
**File**: `ts/lib/src/http/client.ts`
**Changes**: New file

```typescript
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
```

#### 2. Create Index File
**File**: `ts/lib/src/http/index.ts`
**Changes**: New file

```typescript
export { HttpBatchClient } from "./client";
export type { HttpBatchClientConfig } from "./client";
```

### Success Criteria:

#### Automated Verification:
- [x] TypeScript compiles: `bun run typecheck`
- [x] Existing tests pass: `bun test lib/src/`

#### Manual Verification:
- [ ] HttpBatchClient can be imported

---

## Phase 3: Create Batch Accumulator

### Overview
Create the logic to accumulate events into semantic batches. This is the core of the batching logic.

### Changes Required:

#### 1. Create Batch Accumulator
**File**: `ts/lib/src/http/batch-accumulator.ts`
**Changes**: New file

```typescript
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
```

#### 2. Update Index to Export Accumulator
**File**: `ts/lib/src/http/index.ts`
**Changes**: Add export

```typescript
export { HttpBatchClient } from "./client";
export type { HttpBatchClientConfig } from "./client";
export { BatchAccumulator } from "./batch-accumulator";
```

### Success Criteria:

#### Automated Verification:
- [x] TypeScript compiles: `bun run typecheck`
- [x] Existing tests pass: `bun test lib/src/`

#### Manual Verification:
- [ ] BatchAccumulator can be imported

---

## Phase 4: Integrate into Reporter

### Overview
Modify the reporter to support both WebSocket and HTTP transport based on configuration.

### Changes Required:

#### 1. Update ReporterConfig Interface
**File**: `ts/lib/src/reporter.ts`
**Changes**: Add transport option to config interface

Add after line 82 (after `upload` config):

```typescript
  /** Transport mode: 'websocket' (default, real-time streaming) or 'http' (semantic batching) */
  transport?: "websocket" | "http";
```

#### 2. Update ResolvedConfig Interface
**File**: `ts/lib/src/reporter.ts`
**Changes**: Add transport to resolved config

Add to `ResolvedConfig` interface (around line 100):

```typescript
  transport: "websocket" | "http";
```

#### 3. Add Imports
**File**: `ts/lib/src/reporter.ts`
**Changes**: Add imports for HTTP transport

Add after line 39:

```typescript
import { HttpBatchClient, BatchAccumulator } from "./http/index";
```

#### 4. Add HTTP Client Properties
**File**: `ts/lib/src/reporter.ts`
**Changes**: Add properties for HTTP transport

Add after line 115 (after `attachmentTestMap`):

```typescript
  /** HTTP batch client (when transport is 'http') */
  private httpClient: HttpBatchClient | null = null;
  /** Batch accumulator (when transport is 'http') */
  private batchAccumulator: BatchAccumulator | null = null;
```

#### 5. Update resolveConfig Method
**File**: `ts/lib/src/reporter.ts`
**Changes**: Add transport resolution

Add before the `return` statement (around line 150):

```typescript
    const transportEnv = process.env.DESPLEGA_TRANSPORT;
    const transport: "websocket" | "http" =
      transportEnv === "http" || transportEnv === "websocket"
        ? transportEnv
        : (config.transport ?? "websocket");
```

Update the return to include transport:

```typescript
    return { apiKey, endpoint, secure, debug, transport };
```

#### 6. Add HTTP Batch Endpoint Method
**File**: `ts/lib/src/reporter.ts`
**Changes**: Add method to get batch endpoint

Add after `getHealthEndpoint` method (around line 176):

```typescript
  /**
   * Get HTTP batch endpoint URL
   */
  private getBatchEndpoint(): string {
    const protocol = this.resolved.secure ? "https" : "http";
    return `${protocol}://${this.resolved.endpoint}/batch`;
  }
```

#### 7. Update initialize Method
**File**: `ts/lib/src/reporter.ts`
**Changes**: Conditionally initialize WebSocket or HTTP transport

Replace the `initialize` method (lines 181-211):

```typescript
  /**
   * Initialize transport client and uploader after health check passes
   */
  private initialize(): void {
    if (this.initialized) return;
    this.initialized = true;

    // Initialize transport based on config
    if (this.resolved.transport === "http") {
      this.httpClient = new HttpBatchClient({
        endpoint: this.getBatchEndpoint(),
        apiKey: this.resolved.apiKey,
        retries: 3,
        debug: this.resolved.debug,
      });
      this.batchAccumulator = new BatchAccumulator(
        this.httpClient,
        this.resolved.debug,
      );
      this.log("HTTP batch transport initialized");
      this.log("  Batch endpoint:", this.getBatchEndpoint());
    } else {
      this.wsClient = new WebSocketClient({
        endpoint: this.getWsEndpoint(),
        apiKey: this.resolved.apiKey,
        reconnect: this.config.reconnect,
        debug: this.resolved.debug,
      });
      this.log("WebSocket transport initialized");
      this.log("  WebSocket:", this.getWsEndpoint());
    }

    // Initialize file uploader if enabled (same for both transports)
    if (this.config.upload?.enabled !== false) {
      this.uploader = new FileUploader({
        endpoint: this.getUploadEndpoint(),
        apiKey: this.resolved.apiKey,
        parallel: this.config.upload?.parallel,
        chunkSizeMb: this.config.upload?.chunkSizeMb,
        retries: this.config.upload?.retries,
        debug: this.resolved.debug,
      });
    }

    this.log(
      "  Upload:",
      this.uploader ? this.getUploadEndpoint() : "disabled",
    );
  }
```

#### 8. Update onBegin Method
**File**: `ts/lib/src/reporter.ts`
**Changes**: Handle HTTP transport

Replace the event sending at the end of `onBegin` (around line 335):

```typescript
    const event: OnBeginEvent = {
      ...this.createBaseEvent("onBegin"),
      event: "onBegin",
      config: serializeConfig(config),
      suite: serializeSuite(suite),
      git: gitInfo,
      command: commandInfo,
    };

    if (this.batchAccumulator) {
      await this.batchAccumulator.handleRunBegin(event);
    } else {
      this.sendEvent(event);
    }
```

#### 9. Update onTestBegin Method
**File**: `ts/lib/src/reporter.ts`
**Changes**: Handle HTTP transport

Replace the method (around line 338-346):

```typescript
  onTestBegin(test: TestCase, result: TestResult): void {
    const event: OnTestBeginEvent = {
      ...this.createBaseEvent("onTestBegin"),
      event: "onTestBegin",
      test: serializeTestCase(test),
      result: serializeTestResult(result),
    };

    if (this.batchAccumulator) {
      this.batchAccumulator.handleTestBegin(event);
    } else {
      this.sendEvent(event);
    }
  }
```

#### 10. Update onTestEnd Method
**File**: `ts/lib/src/reporter.ts`
**Changes**: Handle HTTP transport (make async)

Replace the method (around line 348-366):

```typescript
  async onTestEnd(test: TestCase, result: TestResult): Promise<void> {
    // Track attachment -> test.id mapping for accurate file uploads
    for (const attachment of result.attachments) {
      if (attachment.path) {
        this.log(
          `Mapping attachment to test: ${attachment.path} -> ${test.id}`,
        );
        this.attachmentTestMap.set(attachment.path, test.id);
      }
    }

    const event: OnTestEndEvent = {
      ...this.createBaseEvent("onTestEnd"),
      event: "onTestEnd",
      test: serializeTestCase(test),
      result: serializeTestResult(result),
    };

    if (this.batchAccumulator) {
      await this.batchAccumulator.handleTestEnd(event);
    } else {
      this.sendEvent(event);
    }
  }
```

#### 11. Update onStepBegin Method
**File**: `ts/lib/src/reporter.ts`
**Changes**: Handle HTTP transport

Replace the method (around line 368-377):

```typescript
  onStepBegin(test: TestCase, result: TestResult, step: TestStep): void {
    const event: OnStepBeginEvent = {
      ...this.createBaseEvent("onStepBegin"),
      event: "onStepBegin",
      test: serializeTestCase(test),
      result: serializeTestResult(result),
      step: serializeTestStep(step),
    };

    if (this.batchAccumulator) {
      this.batchAccumulator.handleStepBegin(event);
    } else {
      this.sendEvent(event);
    }
  }
```

#### 12. Update onStepEnd Method
**File**: `ts/lib/src/reporter.ts`
**Changes**: Handle HTTP transport

Replace the method (around line 379-388):

```typescript
  onStepEnd(test: TestCase, result: TestResult, step: TestStep): void {
    const event: OnStepEndEvent = {
      ...this.createBaseEvent("onStepEnd"),
      event: "onStepEnd",
      test: serializeTestCase(test),
      result: serializeTestResult(result),
      step: serializeTestStep(step),
    };

    if (this.batchAccumulator) {
      this.batchAccumulator.handleStepEnd(event);
    } else {
      this.sendEvent(event);
    }
  }
```

#### 13. Update onError Method
**File**: `ts/lib/src/reporter.ts`
**Changes**: Handle HTTP transport (make async)

Replace the method (around line 390-397):

```typescript
  async onError(error: TestError): Promise<void> {
    const event: OnErrorEvent = {
      ...this.createBaseEvent("onError"),
      event: "onError",
      error: serializeTestError(error),
    };

    if (this.batchAccumulator) {
      await this.batchAccumulator.handleError(event);
    } else {
      this.sendEvent(event);
    }
  }
```

#### 14. Update onStdOut Method
**File**: `ts/lib/src/reporter.ts`
**Changes**: Handle HTTP transport

Replace the method (around line 399-412):

```typescript
  onStdOut(
    chunk: string | Buffer,
    test: TestCase | undefined,
    result: TestResult | undefined,
  ): void {
    const event: OnStdOutEvent = {
      ...this.createBaseEvent("onStdOut"),
      event: "onStdOut",
      chunk: typeof chunk === "string" ? chunk : chunk.toString("utf-8"),
      test: test ? serializeTestCase(test) : null,
      result: result ? serializeTestResult(result) : null,
    };

    if (this.batchAccumulator) {
      this.batchAccumulator.handleStdOut(event);
    } else {
      this.sendEvent(event);
    }
  }
```

#### 15. Update onStdErr Method
**File**: `ts/lib/src/reporter.ts`
**Changes**: Handle HTTP transport

Replace the method (around line 414-427):

```typescript
  onStdErr(
    chunk: string | Buffer,
    test: TestCase | undefined,
    result: TestResult | undefined,
  ): void {
    const event: OnStdErrEvent = {
      ...this.createBaseEvent("onStdErr"),
      event: "onStdErr",
      chunk: typeof chunk === "string" ? chunk : chunk.toString("utf-8"),
      test: test ? serializeTestCase(test) : null,
      result: result ? serializeTestResult(result) : null,
    };

    if (this.batchAccumulator) {
      this.batchAccumulator.handleStdErr(event);
    } else {
      this.sendEvent(event);
    }
  }
```

#### 16. Update onEnd Method
**File**: `ts/lib/src/reporter.ts`
**Changes**: Handle HTTP transport

Replace the event sending portion (around line 432-437):

```typescript
    const event: OnEndEvent = {
      ...this.createBaseEvent("onEnd"),
      event: "onEnd",
      result: serializeFullResult(result),
    };

    if (this.batchAccumulator) {
      this.batchAccumulator.handleEnd(event);
    } else {
      this.sendEvent(event);
    }
```

#### 17. Update onExit Method
**File**: `ts/lib/src/reporter.ts`
**Changes**: Handle HTTP transport

Replace the method (around line 448-471):

```typescript
  async onExit(): Promise<void> {
    if (this.disabled) return;

    // Upload artifacts
    if (this.uploader) {
      this.log("Uploading artifacts...");
      await this.uploader.uploadAll(this.runId);
    }

    // Send exit event
    const event: OnExitEvent = {
      ...this.createBaseEvent("onExit"),
      event: "onExit",
    };

    if (this.batchAccumulator) {
      await this.batchAccumulator.handleExit(event);
    } else {
      this.sendEvent(event);
      // Close WebSocket connection gracefully
      if (this.wsClient) {
        this.log("Closing WebSocket connection...");
        await this.wsClient.close();
      }
    }

    this.log("Reporter finished");
  }
```

### Success Criteria:

#### Automated Verification:
- [x] TypeScript compiles: `bun run typecheck`
- [x] Existing tests pass: `bun test lib/src/`
- [x] Build succeeds: `bun run build`

#### Manual Verification:
- [ ] Reporter initializes with `transport: "websocket"` (default)
- [ ] Reporter initializes with `transport: "http"` config option
- [ ] Reporter initializes with `DESPLEGA_TRANSPORT=http` env var

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the integration works correctly before proceeding to the next phase.

---

## Phase 5: Update Test Server

### Overview
Add `/batch` endpoint to the test server for development and testing.

### Changes Required:

#### 1. Add Batch Handling to Test Server
**File**: `ts/ws.ts`
**Changes**: Add `/batch` endpoint and tracking

Add batch tracking to summary interface (around line 28):

```typescript
  batches: {
    count: number;
    by_type: Record<string, number>;
    total_events: number;
  };
```

Initialize batches in summary (around line 46):

```typescript
  batches: { count: 0, by_type: {}, total_events: 0 },
```

Add batch endpoint handler in fetch function (after line 127, before health check):

```typescript
    // Batch endpoint for HTTP transport
    if (url.pathname === "/batch" && req.method === "POST") {
      return handleBatch(req);
    }
```

Add the batch handler function (after `handleChunkedUpload`):

```typescript
/**
 * Handle semantic batch from HTTP transport
 */
async function handleBatch(req: Request): Promise<Response> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const batch = await req.json();

    console.log(
      `[Batch] ${batch.batch_type} (seq: ${batch.sequence}, events: ${batch.events?.length ?? 0}) for run ${batch.run_id?.slice(0, 15)}...`,
    );

    // Track batch stats
    summary.batches.count++;
    summary.batches.by_type[batch.batch_type] =
      (summary.batches.by_type[batch.batch_type] ?? 0) + 1;
    summary.batches.total_events += batch.events?.length ?? 0;

    // Record individual events for consistent test counting
    if (batch.events) {
      for (const event of batch.events) {
        recordEvent(event);
      }
    }

    // Log details for specific batch types
    if (batch.batch_type === "run_begin") {
      const beginEvent = batch.events?.[0];
      console.log(`  - Projects: ${beginEvent?.config?.projects?.length ?? 0}`);
      console.log(`  - Config: ${batch.config_file ?? "unknown"}`);
    } else if (batch.batch_type === "test_complete") {
      console.log(`  - Test ID: ${batch.test_id}`);
      console.log(`  - Retry: ${batch.retry_count ?? 0}`);
    } else if (batch.batch_type === "run_end") {
      console.log(`  - Final status: ${batch.events?.[0]?.result?.status}`);
    }

    return Response.json({
      success: true,
      batch_type: batch.batch_type,
      sequence: batch.sequence,
      events_received: batch.events?.length ?? 0,
    });
  } catch (error) {
    console.error("[Batch] Error:", error);
    return new Response("Batch processing failed", { status: 500 });
  }
}
```

Update the server startup message (around line 312):

```typescript
console.log(`
====================================
  Test Server Running
====================================
  WebSocket: ws://localhost:${server.port}
  Batch:     http://localhost:${server.port}/batch
  Upload:    http://localhost:${server.port}/upload
  Health:    http://localhost:${server.port}/health
  Summary:   http://localhost:${server.port}/summary
  --summary: ${writeSummary ? "enabled" : "disabled"}
====================================
`);
```

### Success Criteria:

#### Automated Verification:
- [x] Server starts without errors: `bun ws.ts`
- [x] Build succeeds: `bun run build`

#### Manual Verification:
- [ ] POST to `/batch` endpoint returns success
- [ ] Batch events are logged correctly
- [ ] Summary endpoint shows batch statistics

---

## Phase 6: End-to-End Testing

### Overview
Test the complete HTTP batch transport with actual Playwright tests.

### Testing Scenarios:

1. **Single Test**
   ```bash
   # Terminal 1: Start test server
   bun ws.ts --summary

   # Terminal 2: Run single test with HTTP transport
   DESPLEGA_API_KEY=test DESPLEGA_ENDPOINT=localhost:5555 DESPLEGA_TRANSPORT=http DESPLEGA_SECURE=false bun run pw:test -- --grep "specific test"

   # Check summary
   cat .ws-summary.json
   ```

2. **Multiple Parallel Tests**
   ```bash
   DESPLEGA_API_KEY=test DESPLEGA_ENDPOINT=localhost:5555 DESPLEGA_TRANSPORT=http DESPLEGA_SECURE=false bun run pw:test
   ```
   Verify: Each test_complete batch contains events for exactly one test

3. **Test with Retries**
   Run a test that fails and retries. Verify retry_count is correct in batches.

4. **Sharded Run**
   ```bash
   DESPLEGA_API_KEY=test DESPLEGA_ENDPOINT=localhost:5555 DESPLEGA_TRANSPORT=http DESPLEGA_SECURE=false bun run pw:test:shard
   ```
   Verify: Shard info is included in batches

5. **Network Failure Retry**
   - Start test, stop server mid-run, restart server
   - Verify retry logic works for batch sending

### Success Criteria:

#### Automated Verification:
- [x] All existing tests pass: `bun test lib/src/`
- [ ] Playwright tests complete successfully
- [x] TypeScript compiles: `bun run typecheck`

#### Manual Verification:
- [ ] Single test produces: 1 run_begin, 1 test_complete, 1 run_end batch
- [ ] Parallel tests produce: correct number of test_complete batches
- [ ] Sequence numbers are incrementing correctly
- [ ] Shard info appears in batched runs
- [ ] Output events are batched (not sent individually)

---

## Testing Strategy

### Unit Tests

Consider adding tests for:
- `HttpBatchClient` retry logic
- `BatchAccumulator` event grouping
- Sequence number incrementing

### Integration Tests

The existing e2e test (`bun run e2e:test`) should be updated or a new HTTP-specific e2e test added.

### Manual Testing Steps

1. Start test server: `bun ws.ts --summary`
2. Run tests with HTTP transport
3. Verify batches in server logs
4. Check `.ws-summary.json` for statistics
5. Compare with WebSocket transport behavior

---

## Performance Considerations

- **Batch size**: test_complete batches can be large for tests with many steps. No explicit limit implemented, but monitor for issues.
- **Output buffering**: 5-second flush interval is a balance between latency and reducing HTTP requests. Can be made configurable if needed.
- **Memory**: Per-test event buffers are cleared after each test completes, so memory usage scales with parallel test count, not total tests.

---

## Migration Notes

- No database changes required
- No breaking changes to existing WebSocket behavior
- New config option is optional with sensible default
- Environment variable provides easy override for CI environments

---

## References

- WebSocket client implementation: `ts/lib/src/websocket/client.ts`
- HTTP uploader patterns: `ts/lib/src/uploader/http-uploader.ts`
- Event type definitions: `ts/lib/src/types.ts`
- Test server: `ts/ws.ts`

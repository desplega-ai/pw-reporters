import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestError,
  TestResult,
  TestStep,
} from "@playwright/test/reporter";

import type {
  OnBeginEvent,
  OnEndEvent,
  OnErrorEvent,
  OnExitEvent,
  OnStdErrEvent,
  OnStdOutEvent,
  OnStepBeginEvent,
  OnStepEndEvent,
  OnTestBeginEvent,
  OnTestEndEvent,
  ReporterEvent,
} from "./types";

import {
  serializeConfig,
  serializeFullResult,
  serializeSuite,
  serializeTestCase,
  serializeTestError,
  serializeTestResult,
  serializeTestStep,
} from "./serializers";

import { WebSocketClient } from "./websocket/client";
import { FileUploader } from "./uploader/index";

/**
 * Configuration options for the reporter
 */
export interface ReporterConfig {
  /** API key for authentication */
  apiKey: string;
  /** WebSocket endpoint URL (e.g., 'wss://api.example.com/ws') */
  wsEndpoint: string;
  /** HTTP endpoint for file uploads (defaults to deriving from wsEndpoint) */
  uploadEndpoint?: string;
  /** Reconnection settings */
  reconnect?: {
    /** Enable automatic reconnection (default: true) */
    enabled?: boolean;
    /** Maximum reconnection attempts (default: 10) */
    maxAttempts?: number;
    /** Initial delay in ms (default: 1000) */
    initialDelayMs?: number;
    /** Maximum delay in ms (default: 30000) */
    maxDelayMs?: number;
  };
  /** Upload settings */
  upload?: {
    /** Enable file uploads (default: true) */
    enabled?: boolean;
    /** Number of parallel uploads (default: 3) */
    parallel?: number;
    /** Chunk size in MB for large files (default: 5) */
    chunkSizeMb?: number;
    /** Number of retry attempts (default: 3) */
    retries?: number;
  };
  /** Enable debug logging (default: false) */
  debug?: boolean;
}

/**
 * Generate a unique run ID
 */
function generateRunId(): string {
  return `run_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Playwright Reporter that streams test events via WebSocket
 * and uploads artifacts via HTTP
 */
class PlaywrightReporter implements Reporter {
  private config: ReporterConfig;
  private wsClient: WebSocketClient;
  private uploader: FileUploader;
  private runId: string;
  private debug: boolean;

  constructor(config: ReporterConfig) {
    this.config = config;
    this.debug = config.debug ?? false;
    this.runId = generateRunId();

    // Initialize WebSocket client
    this.wsClient = new WebSocketClient({
      endpoint: config.wsEndpoint,
      apiKey: config.apiKey,
      reconnect: config.reconnect,
      debug: this.debug,
    });

    // Initialize file uploader
    const uploadEndpoint =
      config.uploadEndpoint ?? this.deriveUploadEndpoint(config.wsEndpoint);
    this.uploader = new FileUploader({
      endpoint: uploadEndpoint,
      apiKey: config.apiKey,
      parallel: config.upload?.parallel,
      chunkSizeMb: config.upload?.chunkSizeMb,
      retries: config.upload?.retries,
      debug: this.debug,
    });

    this.log("Reporter initialized with runId:", this.runId);
  }

  private log(...args: unknown[]): void {
    if (this.debug) {
      console.log("[pw-reporter]", ...args);
    }
  }

  /**
   * Derive HTTP upload endpoint from WebSocket endpoint
   * ws://localhost:5555 -> http://localhost:5555/upload
   * wss://api.example.com/ws -> https://api.example.com/upload
   */
  private deriveUploadEndpoint(wsEndpoint: string): string {
    const httpEndpoint = wsEndpoint
      .replace(/^wss:/, "https:")
      .replace(/^ws:/, "http:");

    // If endpoint ends with /ws, replace with /upload
    if (/\/ws\/?$/.test(httpEndpoint)) {
      return httpEndpoint.replace(/\/ws\/?$/, "/upload");
    }

    // Otherwise append /upload
    return httpEndpoint.replace(/\/?$/, "/upload");
  }

  /**
   * Create a base event with common fields
   */
  private createBaseEvent(eventName: string): {
    event: string;
    timestamp: string;
    runId: string;
  } {
    return {
      event: eventName,
      timestamp: new Date().toISOString(),
      runId: this.runId,
    };
  }

  /**
   * Send an event through WebSocket
   */
  private sendEvent(event: ReporterEvent): void {
    this.wsClient.send(event);
    this.log("Sent event:", event.event);
  }

  printsToStdio(): boolean {
    return false;
  }

  onBegin(config: FullConfig, suite: Suite): void {
    const event: OnBeginEvent = {
      ...this.createBaseEvent("onBegin"),
      event: "onBegin",
      config: serializeConfig(config),
      suite: serializeSuite(suite),
    };
    this.sendEvent(event);
  }

  onTestBegin(test: TestCase, result: TestResult): void {
    const event: OnTestBeginEvent = {
      ...this.createBaseEvent("onTestBegin"),
      event: "onTestBegin",
      test: serializeTestCase(test),
      result: serializeTestResult(result),
    };
    this.sendEvent(event);
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const event: OnTestEndEvent = {
      ...this.createBaseEvent("onTestEnd"),
      event: "onTestEnd",
      test: serializeTestCase(test),
      result: serializeTestResult(result),
    };
    this.sendEvent(event);
  }

  onStepBegin(test: TestCase, result: TestResult, step: TestStep): void {
    const event: OnStepBeginEvent = {
      ...this.createBaseEvent("onStepBegin"),
      event: "onStepBegin",
      test: serializeTestCase(test),
      result: serializeTestResult(result),
      step: serializeTestStep(step),
    };
    this.sendEvent(event);
  }

  onStepEnd(test: TestCase, result: TestResult, step: TestStep): void {
    const event: OnStepEndEvent = {
      ...this.createBaseEvent("onStepEnd"),
      event: "onStepEnd",
      test: serializeTestCase(test),
      result: serializeTestResult(result),
      step: serializeTestStep(step),
    };
    this.sendEvent(event);
  }

  onError(error: TestError): void {
    const event: OnErrorEvent = {
      ...this.createBaseEvent("onError"),
      event: "onError",
      error: serializeTestError(error),
    };
    this.sendEvent(event);
  }

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
    this.sendEvent(event);
  }

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
    this.sendEvent(event);
  }

  async onEnd(result: FullResult): Promise<void> {
    const event: OnEndEvent = {
      ...this.createBaseEvent("onEnd"),
      event: "onEnd",
      result: serializeFullResult(result),
    };
    this.sendEvent(event);

    // Build manifest of files to upload
    if (this.config.upload?.enabled !== false) {
      this.log("Scanning test-results for files to upload...");
      await this.uploader.scanFiles("test-results");
    }
  }

  async onExit(): Promise<void> {
    // Upload files if enabled
    if (this.config.upload?.enabled !== false) {
      this.log("Uploading artifacts...");
      await this.uploader.uploadAll(this.runId);
    }

    // Send exit event
    const event: OnExitEvent = {
      ...this.createBaseEvent("onExit"),
      event: "onExit",
    };
    this.sendEvent(event);

    // Close WebSocket connection gracefully
    this.log("Closing WebSocket connection...");
    await this.wsClient.close();

    this.log("Reporter finished");
  }
}

export default PlaywrightReporter;

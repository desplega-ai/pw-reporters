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
 *
 * All options can be set via environment variables prefixed with DESPLEGA_:
 * - DESPLEGA_API_KEY: API key for authentication
 * - DESPLEGA_ENDPOINT: Base endpoint (e.g., 'api.desplega.ai/pw-reporter')
 * - DESPLEGA_SECURE: Use secure connections (wss/https) - 'true' or 'false'
 * - DESPLEGA_DEBUG: Enable debug logging - 'true' or 'false'
 *
 * Config is fully optional - all values can come from environment variables.
 */
export interface ReporterConfig {
  /** API key for authentication (env: DESPLEGA_API_KEY) */
  apiKey?: string;
  /** Base endpoint without protocol (e.g., 'api.desplega.ai/pw-reporter') (env: DESPLEGA_ENDPOINT) */
  endpoint?: string;
  /** Use secure connections - wss:// and https:// (default: true for non-localhost) (env: DESPLEGA_SECURE) */
  secure?: boolean;
  /** Enable debug logging (default: false) (env: DESPLEGA_DEBUG) */
  debug?: boolean;
  /** WebSocket reconnection settings */
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
  /** File upload settings */
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
}

/**
 * Generate a unique run ID
 */
function generateRunId(): string {
  return `run_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Resolved configuration with all values populated
 */
interface ResolvedConfig {
  apiKey: string;
  endpoint: string;
  secure: boolean;
  debug: boolean;
}

/**
 * Playwright Reporter that streams test events via WebSocket
 * and uploads artifacts via HTTP
 */
class PlaywrightReporter implements Reporter {
  private config: ReporterConfig;
  private resolved: ResolvedConfig;
  private wsClient: WebSocketClient | null = null;
  private uploader: FileUploader | null = null;
  private runId: string;
  private disabled = false;
  private initialized = false;
  /** Map from absolute attachment path -> test.id */
  private attachmentTestMap: Map<string, string> = new Map();
  /** Output directory for test artifacts (from Playwright config) */
  private outputDir: string = "test-results";

  constructor(config: ReporterConfig = {}) {
    this.config = config;
    this.resolved = this.resolveConfig(config);
    this.runId = generateRunId();
    this.log("Reporter created with runId:", this.runId);
  }

  /**
   * Resolve configuration from options and environment variables
   * Environment variables take precedence over config options
   */
  private resolveConfig(config: ReporterConfig): ResolvedConfig {
    const endpoint =
      process.env.DESPLEGA_ENDPOINT ??
      config.endpoint ??
      "api.desplega.ai/pw-reporter";

    const apiKey = process.env.DESPLEGA_API_KEY ?? config.apiKey ?? "";

    // Default to secure for non-localhost endpoints
    const isLocalhost =
      endpoint.startsWith("localhost") || endpoint.startsWith("127.0.0.1");
    const secureEnv = process.env.DESPLEGA_SECURE;
    const secure =
      secureEnv !== undefined
        ? secureEnv === "true"
        : (config.secure ?? !isLocalhost);

    const debugEnv = process.env.DESPLEGA_DEBUG;
    const debug =
      debugEnv !== undefined ? debugEnv === "true" : (config.debug ?? false);

    return { apiKey, endpoint, secure, debug };
  }

  /**
   * Get WebSocket endpoint URL
   */
  private getWsEndpoint(): string {
    const protocol = this.resolved.secure ? "wss" : "ws";
    return `${protocol}://${this.resolved.endpoint}/ws`;
  }

  /**
   * Get HTTP upload endpoint URL
   */
  private getUploadEndpoint(): string {
    const protocol = this.resolved.secure ? "https" : "http";
    return `${protocol}://${this.resolved.endpoint}/upload`;
  }

  /**
   * Get HTTP health check endpoint URL
   */
  private getHealthEndpoint(): string {
    const protocol = this.resolved.secure ? "https" : "http";
    return `${protocol}://${this.resolved.endpoint}/health`;
  }

  /**
   * Initialize WebSocket client and uploader after health check passes
   */
  private initialize(): void {
    if (this.initialized) return;
    this.initialized = true;

    // Initialize WebSocket client
    this.wsClient = new WebSocketClient({
      endpoint: this.getWsEndpoint(),
      apiKey: this.resolved.apiKey,
      reconnect: this.config.reconnect,
      debug: this.resolved.debug,
    });

    // Initialize file uploader if enabled
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

    this.log("Reporter initialized");
    this.log("  WebSocket:", this.getWsEndpoint());
    this.log(
      "  Upload:",
      this.uploader ? this.getUploadEndpoint() : "disabled",
    );
  }

  private log(...args: unknown[]): void {
    if (this.resolved.debug) {
      console.log("[pw-reporter]", ...args);
    }
  }

  /**
   * Perform health check to verify server is reachable
   * Returns true if healthy, false otherwise
   */
  private async performHealthCheck(): Promise<boolean> {
    const timeoutMs = 3000;
    const endpoint = this.getHealthEndpoint();

    this.log("Performing health check to", endpoint, "with timeout", timeoutMs);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(endpoint, {
        method: "GET",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.resolved.apiKey}`,
        },
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        this.log("Health check passed");
        return true;
      }

      this.log("Health check failed with status:", response.status);
      return false;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        this.log("Health check timed out after", timeoutMs, "ms");
      } else {
        this.log("Health check failed:", error);
      }
      return false;
    }
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
    if (this.disabled || !this.wsClient) {
      return;
    }
    this.wsClient.send(event);
    // this.log("Sent event:", event.event);
  }

  printsToStdio(): boolean {
    return false;
  }

  async onBegin(config: FullConfig, suite: Suite): Promise<void> {
    // Extract outputDir from first project (all projects typically share the same outputDir)
    const firstProject = config.projects[0];
    if (firstProject) {
      this.outputDir = firstProject.outputDir;
      this.log("Output directory:", this.outputDir);
    }

    // Perform health check before initializing
    const healthy = await this.performHealthCheck();
    if (!healthy) {
      this.disabled = true;
      this.log("Reporter disabled due to failed health check");
      return;
    }

    // Initialize WebSocket and uploader after health check passes
    this.initialize();

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
    if (this.disabled) return;

    const event: OnEndEvent = {
      ...this.createBaseEvent("onEnd"),
      event: "onEnd",
      result: serializeFullResult(result),
    };
    this.sendEvent(event);

    // Build manifest of files to upload
    if (this.uploader) {
      this.log(`Scanning ${this.outputDir} for files to upload...`);
      await this.uploader.scanFiles(this.outputDir);
      // Enrich files with testId for accurate backend matching
      this.uploader.enrichWithTestIds(this.attachmentTestMap);
    }
  }

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
    this.sendEvent(event);

    // Close WebSocket connection gracefully
    if (this.wsClient) {
      this.log("Closing WebSocket connection...");
      await this.wsClient.close();
    }

    this.log("Reporter finished");
  }
}

export default PlaywrightReporter;

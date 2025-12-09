/**
 * JSON-serializable types for Playwright reporter data.
 * These types mirror Playwright's reporter types but with:
 * - Date → ISO 8601 string
 * - Buffer → Base64 string or omitted
 * - RegExp → source string
 * - Circular parent refs → omitted or string reference
 * - Methods → pre-computed as properties
 */

// ============================================
// Primitive Types (already JSON-safe)
// ============================================

/**
 * Generic metadata object for arbitrary key-value pairs
 */
export interface SerializedMetadata {
  [key: string]: unknown;
}

/**
 * Test execution status
 */
export type SerializedTestStatus =
  | "passed"
  | "failed"
  | "timedOut"
  | "skipped"
  | "interrupted";

/**
 * Source code location
 */
export interface SerializedLocation {
  file: string;
  line: number;
  column: number;
}

/**
 * Test annotation (skip, fail, fixme, etc.)
 */
export interface SerializedAnnotation {
  type: string;
  description?: string;
  location?: SerializedLocation;
}

// ============================================
// Types requiring serialization
// ============================================

/**
 * Test attachment (screenshot, video, trace, etc.)
 * Note: `body` is omitted for streaming - files uploaded separately via HTTP
 */
export interface SerializedAttachment {
  name: string;
  contentType: string;
  path?: string;
  // body omitted - uploaded separately
}

/**
 * Test error with stack trace
 */
export interface SerializedTestError {
  message?: string;
  stack?: string;
  value?: string;
  snippet?: string;
  location?: SerializedLocation;
  cause?: SerializedTestError; // Recursive but not circular
}

/**
 * Test step (action, assertion, hook, etc.)
 * Full recursive structure preserved
 */
export interface SerializedTestStep {
  title: string;
  titlePath: string[]; // Pre-computed from titlePath() method
  category: string;
  duration: number;
  startTime: string; // ISO 8601
  location?: SerializedLocation;
  error?: SerializedTestError;
  annotations: SerializedAnnotation[];
  attachments: SerializedAttachment[];
  steps: SerializedTestStep[]; // Recursive child steps
  // parent omitted - circular reference
}

/**
 * Test result from a single run attempt
 */
export interface SerializedTestResult {
  status: SerializedTestStatus;
  duration: number;
  startTime: string; // ISO 8601
  retry: number;
  workerIndex: number;
  parallelIndex: number;
  error?: SerializedTestError;
  errors: SerializedTestError[];
  stdout: string[]; // Buffer converted to string
  stderr: string[]; // Buffer converted to string
  steps: SerializedTestStep[];
  attachments: SerializedAttachment[];
  annotations: SerializedAnnotation[];
}

/**
 * Test case definition
 */
export interface SerializedTestCase {
  id: string;
  title: string;
  titlePath: string[]; // Pre-computed from titlePath() method
  location: SerializedLocation;
  tags: string[];
  timeout: number;
  retries: number;
  repeatEachIndex: number;
  expectedStatus: SerializedTestStatus;
  annotations: SerializedAnnotation[];
  outcome: "skipped" | "expected" | "unexpected" | "flaky"; // Pre-computed from outcome() method
  ok: boolean; // Pre-computed from ok() method
  // results omitted - sent separately via events
  // parent omitted - circular reference
}

/**
 * Test suite (file, describe block, project, or root)
 */
export interface SerializedSuite {
  title: string;
  titlePath: string[]; // Pre-computed from titlePath() method
  type: "root" | "project" | "file" | "describe";
  location?: SerializedLocation;
  suites: SerializedSuite[]; // Recursive child suites
  testIds: string[]; // Test IDs only to avoid circular refs
  // parent omitted - circular reference
}

/**
 * Project configuration
 */
export interface SerializedProject {
  name: string;
  testDir: string;
  outputDir: string;
  snapshotDir: string;
  repeatEach: number;
  retries: number;
  timeout: number;
  dependencies: string[];
  teardown?: string;
  metadata: SerializedMetadata;
  // grep/grepInvert/testIgnore/testMatch - RegExp converted to strings
  grep: string[];
  grepInvert: string[] | null;
  testIgnore: string[];
  testMatch: string[];
  // use omitted - contains complex fixture config
}

/**
 * Full Playwright configuration
 */
export interface SerializedConfig {
  configFile?: string;
  rootDir: string;
  version: string;
  workers: number;
  forbidOnly: boolean;
  fullyParallel: boolean;
  quiet: boolean;
  globalSetup: string | null;
  globalTeardown: string | null;
  globalTimeout: number;
  maxFailures: number;
  preserveOutput: "always" | "never" | "failures-only";
  updateSnapshots: "all" | "changed" | "missing" | "none";
  metadata: SerializedMetadata;
  grep: string[];
  grepInvert: string[] | null;
  shard: { total: number; current: number } | null;
  reportSlowTests: { max: number; threshold: number } | null;
  projects: SerializedProject[];
}

/**
 * Final test run result
 */
export interface SerializedFullResult {
  status: "passed" | "failed" | "timedout" | "interrupted";
  startTime: string; // ISO 8601
  duration: number;
}

// ============================================
// Event Message Types
// ============================================

/**
 * Base event structure
 */
interface BaseEvent {
  event: string;
  timestamp: string; // ISO 8601 when event was created
  runId: string; // Unique run identifier
}

export interface OnBeginEvent extends BaseEvent {
  event: "onBegin";
  config: SerializedConfig;
  suite: SerializedSuite;
}

export interface OnTestBeginEvent extends BaseEvent {
  event: "onTestBegin";
  test: SerializedTestCase;
  result: SerializedTestResult;
}

export interface OnTestEndEvent extends BaseEvent {
  event: "onTestEnd";
  test: SerializedTestCase;
  result: SerializedTestResult;
}

export interface OnStepBeginEvent extends BaseEvent {
  event: "onStepBegin";
  test: SerializedTestCase;
  result: SerializedTestResult;
  step: SerializedTestStep;
}

export interface OnStepEndEvent extends BaseEvent {
  event: "onStepEnd";
  test: SerializedTestCase;
  result: SerializedTestResult;
  step: SerializedTestStep;
}

export interface OnErrorEvent extends BaseEvent {
  event: "onError";
  error: SerializedTestError;
}

export interface OnEndEvent extends BaseEvent {
  event: "onEnd";
  result: SerializedFullResult;
}

export interface OnStdOutEvent extends BaseEvent {
  event: "onStdOut";
  chunk: string;
  test: SerializedTestCase | null;
  result: SerializedTestResult | null;
}

export interface OnStdErrEvent extends BaseEvent {
  event: "onStdErr";
  chunk: string;
  test: SerializedTestCase | null;
  result: SerializedTestResult | null;
}

export interface OnExitEvent extends BaseEvent {
  event: "onExit";
}

/**
 * Union of all event types
 */
export type ReporterEvent =
  | OnBeginEvent
  | OnTestBeginEvent
  | OnTestEndEvent
  | OnStepBeginEvent
  | OnStepEndEvent
  | OnErrorEvent
  | OnEndEvent
  | OnStdOutEvent
  | OnStdErrEvent
  | OnExitEvent;

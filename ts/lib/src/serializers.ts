import type {
  FullConfig,
  FullProject,
  FullResult,
  Suite,
  TestCase,
  TestError,
  TestResult,
  TestStep,
  Location,
} from "@playwright/test/reporter";

import type {
  SerializedAnnotation,
  SerializedAttachment,
  SerializedConfig,
  SerializedFullResult,
  SerializedLocation,
  SerializedProject,
  SerializedSuite,
  SerializedTestCase,
  SerializedTestError,
  SerializedTestResult,
  SerializedTestStep,
} from "./types";

// ============================================
// Utility Functions
// ============================================

/**
 * Convert Date to ISO 8601 string
 */
export function serializeDate(date: Date): string {
  return date.toISOString();
}

/**
 * Convert Buffer to string
 */
export function serializeBuffer(buffer: Buffer | string): string {
  return typeof buffer === "string" ? buffer : buffer.toString("utf-8");
}

/**
 * Convert RegExp or string to string
 */
export function serializeRegExp(pattern: RegExp | string): string {
  return pattern instanceof RegExp ? pattern.source : pattern;
}

/**
 * Convert array of RegExp/string to string array
 */
export function serializeRegExpArray(
  patterns: RegExp | string | (RegExp | string)[] | null | undefined,
): string[] | null {
  if (patterns === null || patterns === undefined) {
    return null;
  }
  if (Array.isArray(patterns)) {
    return patterns.map(serializeRegExp);
  }
  return [serializeRegExp(patterns)];
}

// ============================================
// Core Serializers
// ============================================

/**
 * Serialize Location (already JSON-safe, but explicit for type safety)
 */
export function serializeLocation(location: Location): SerializedLocation {
  return {
    file: location.file,
    line: location.line,
    column: location.column,
  };
}

/**
 * Serialize TestError (recursive for cause chain)
 */
export function serializeTestError(error: TestError): SerializedTestError {
  return {
    message: error.message,
    stack: error.stack,
    value: error.value,
    snippet: error.snippet,
    location: error.location ? serializeLocation(error.location) : undefined,
    cause: error.cause ? serializeTestError(error.cause) : undefined,
  };
}

/**
 * Serialize Attachment (omit body - uploaded separately)
 */
export function serializeAttachment(attachment: {
  name: string;
  contentType: string;
  path?: string;
  body?: Buffer;
}): SerializedAttachment {
  return {
    name: attachment.name,
    contentType: attachment.contentType,
    path: attachment.path,
    // body intentionally omitted
  };
}

/**
 * Serialize TestStep (recursive for nested steps)
 */
export function serializeTestStep(step: TestStep): SerializedTestStep {
  return {
    title: step.title,
    titlePath: step.titlePath(),
    category: step.category,
    duration: step.duration,
    startTime: serializeDate(step.startTime),
    location: step.location ? serializeLocation(step.location) : undefined,
    error: step.error ? serializeTestError(step.error) : undefined,
    annotations: step.annotations.map((a) => ({
      type: a.type,
      description: a.description,
      location: a.location ? serializeLocation(a.location) : undefined,
    })),
    attachments: step.attachments.map(serializeAttachment),
    steps: step.steps.map(serializeTestStep), // Recursive
    // parent omitted
  };
}

/**
 * Serialize TestResult
 */
export function serializeTestResult(result: TestResult): SerializedTestResult {
  return {
    status: result.status,
    duration: result.duration,
    startTime: serializeDate(result.startTime),
    retry: result.retry,
    workerIndex: result.workerIndex,
    parallelIndex: result.parallelIndex,
    error: result.error ? serializeTestError(result.error) : undefined,
    errors: result.errors.map(serializeTestError),
    stdout: result.stdout.map(serializeBuffer),
    stderr: result.stderr.map(serializeBuffer),
    steps: result.steps.map(serializeTestStep),
    attachments: result.attachments.map(serializeAttachment),
    annotations: result.annotations.map((a) => ({
      type: a.type,
      description: a.description,
      location: a.location ? serializeLocation(a.location) : undefined,
    })),
  };
}

/**
 * Serialize TestCase
 */
export function serializeTestCase(test: TestCase): SerializedTestCase {
  return {
    id: test.id,
    title: test.title,
    titlePath: test.titlePath(),
    location: serializeLocation(test.location),
    tags: test.tags,
    timeout: test.timeout,
    retries: test.retries,
    repeatEachIndex: test.repeatEachIndex,
    expectedStatus: test.expectedStatus,
    annotations: test.annotations.map((a) => ({
      type: a.type,
      description: a.description,
      location: a.location ? serializeLocation(a.location) : undefined,
    })),
    outcome: test.outcome(),
    ok: test.ok(),
    // results and parent omitted
  };
}

/**
 * Serialize Suite (recursive for nested suites)
 */
export function serializeSuite(suite: Suite): SerializedSuite {
  return {
    title: suite.title,
    titlePath: suite.titlePath(),
    type: suite.type,
    location: suite.location ? serializeLocation(suite.location) : undefined,
    suites: suite.suites.map(serializeSuite), // Recursive
    testIds: suite.tests.map((t) => t.id), // IDs only
    // parent omitted
  };
}

/**
 * Serialize FullProject
 */
export function serializeProject(project: FullProject): SerializedProject {
  return {
    name: project.name,
    testDir: project.testDir,
    outputDir: project.outputDir,
    snapshotDir: project.snapshotDir,
    repeatEach: project.repeatEach,
    retries: project.retries,
    timeout: project.timeout,
    dependencies: project.dependencies,
    teardown: project.teardown,
    metadata: project.metadata as Record<string, unknown>,
    grep: serializeRegExpArray(project.grep) ?? [],
    grepInvert: serializeRegExpArray(project.grepInvert),
    testIgnore: serializeRegExpArray(project.testIgnore) ?? [],
    testMatch: serializeRegExpArray(project.testMatch) ?? [],
    // use omitted
  };
}

/**
 * Serialize FullConfig
 */
export function serializeConfig(config: FullConfig): SerializedConfig {
  return {
    configFile: config.configFile,
    rootDir: config.rootDir,
    version: config.version,
    workers: config.workers,
    forbidOnly: config.forbidOnly,
    fullyParallel: config.fullyParallel,
    quiet: config.quiet,
    globalSetup: config.globalSetup,
    globalTeardown: config.globalTeardown,
    globalTimeout: config.globalTimeout,
    maxFailures: config.maxFailures,
    preserveOutput: config.preserveOutput,
    updateSnapshots: config.updateSnapshots,
    metadata: config.metadata as Record<string, unknown>,
    grep: serializeRegExpArray(config.grep) ?? [],
    grepInvert: serializeRegExpArray(config.grepInvert),
    shard: config.shard,
    reportSlowTests: config.reportSlowTests,
    projects: config.projects.map(serializeProject),
  };
}

/**
 * Serialize FullResult
 */
export function serializeFullResult(result: FullResult): SerializedFullResult {
  return {
    status: result.status,
    startTime: serializeDate(result.startTime),
    duration: result.duration,
  };
}

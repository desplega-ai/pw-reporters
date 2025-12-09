# JSON Serialization Layer Implementation Plan

## Overview

Create a complete, type-safe JSON serialization layer for Playwright reporter types. This is the foundational layer for the `@org/pw-reporter` library that handles converting Playwright's runtime objects (with Dates, Buffers, circular refs, methods) into JSON-safe structures suitable for WebSocket streaming.

## Current State Analysis

### Existing Code (`ts/reporter.ts:7-64`)
- 5 serialization functions exist but lack TypeScript output types
- `Date` objects passed implicitly (JSON.stringify handles)
- `Buffer` in attachments not addressed (typo: `attachements`)
- Steps flattened to titles only (loses structure)
- `FullResult` passed without explicit Date serialization
- No handling of `RegExp` in config/project

### Key Discoveries:
- Attachments have `path` and `contentType`, `body` is typically undefined for file-based attachments (`out.txt:6228-6233`)
- Current reporter sends events via WebSocket with `event` discriminator field (`ts/reporter.ts:91-94`)
- Steps can be deeply nested (fixture → close context pattern)

## Desired End State

A `ts/lib/src/` directory containing:
1. `types.ts` - Complete TypeScript interfaces for all serialized types
2. `serializers.ts` - Pure functions that transform Playwright types to serialized types
3. Unit tests validating serialization correctness

### Verification:
- All serializer functions have explicit input/output types
- `bun test ts/lib/src/serializers.test.ts` passes
- Serialized output is valid JSON (no Date, Buffer, RegExp, circular refs)
- Type-safe: TypeScript compilation catches mismatches

## What We're NOT Doing

- WebSocket client implementation (separate plan: `2025-12-09-pw-reporter-library.md`)
- File upload implementation (separate concern)
- Reporter class implementation (depends on this layer)
- Background worker for attachment streaming (future enhancement)

## Implementation Approach

Build types first, then serializers, then tests. Each serializer is a pure function with explicit types. Use Playwright's `JSONReport*` types as reference but with `Serialized*` naming convention.

---

## Phase 1: Project Structure & Type Definitions

### Overview
Set up the `ts/lib/` directory structure and define all TypeScript interfaces for serialized types.

### Changes Required:

#### 1. Create directory structure
```
ts/lib/
├── src/
│   ├── types.ts
│   └── serializers.ts
└── tsconfig.json
```

#### 2. Create `ts/lib/tsconfig.json`
**File**: `ts/lib/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "types": ["bun-types"]
  },
  "include": ["src/**/*"]
}
```

#### 3. Create `ts/lib/src/types.ts`
**File**: `ts/lib/src/types.ts`

```typescript
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
 * Test execution status
 */
export type SerializedTestStatus = 'passed' | 'failed' | 'timedOut' | 'skipped' | 'interrupted';

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
  outcome: 'skipped' | 'expected' | 'unexpected' | 'flaky'; // Pre-computed from outcome() method
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
  type: 'root' | 'project' | 'file' | 'describe';
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
  metadata: Record<string, unknown>;
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
  preserveOutput: 'always' | 'never' | 'failures-only';
  updateSnapshots: 'all' | 'changed' | 'missing' | 'none';
  metadata: Record<string, unknown>;
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
  status: 'passed' | 'failed' | 'timedout' | 'interrupted';
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
  event: 'onBegin';
  config: SerializedConfig;
  suite: SerializedSuite;
}

export interface OnTestBeginEvent extends BaseEvent {
  event: 'onTestBegin';
  test: SerializedTestCase;
  result: SerializedTestResult;
}

export interface OnTestEndEvent extends BaseEvent {
  event: 'onTestEnd';
  test: SerializedTestCase;
  result: SerializedTestResult;
}

export interface OnStepBeginEvent extends BaseEvent {
  event: 'onStepBegin';
  test: SerializedTestCase;
  result: SerializedTestResult;
  step: SerializedTestStep;
}

export interface OnStepEndEvent extends BaseEvent {
  event: 'onStepEnd';
  test: SerializedTestCase;
  result: SerializedTestResult;
  step: SerializedTestStep;
}

export interface OnErrorEvent extends BaseEvent {
  event: 'onError';
  error: SerializedTestError;
}

export interface OnEndEvent extends BaseEvent {
  event: 'onEnd';
  result: SerializedFullResult;
}

export interface OnStdOutEvent extends BaseEvent {
  event: 'onStdOut';
  chunk: string;
  test: SerializedTestCase | null;
  result: SerializedTestResult | null;
}

export interface OnStdErrEvent extends BaseEvent {
  event: 'onStdErr';
  chunk: string;
  test: SerializedTestCase | null;
  result: SerializedTestResult | null;
}

export interface OnExitEvent extends BaseEvent {
  event: 'onExit';
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
```

### Success Criteria:

#### Automated Verification:
- [x] Directory structure exists: `ls ts/lib/src/types.ts`
- [x] TypeScript compiles without errors: `cd ts/lib && bun run tsc --noEmit`

#### Manual Verification:
- [ ] Types cover all Playwright reporter lifecycle methods
- [ ] All non-JSON-safe types have serialization strategy documented in comments

---

## Phase 2: Core Serializers

### Overview
Implement pure serialization functions that transform Playwright types to the serialized interfaces.

### Changes Required:

#### 1. Create `ts/lib/src/serializers.ts`
**File**: `ts/lib/src/serializers.ts`

```typescript
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
} from '@playwright/test/reporter';

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
} from './types';

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
  return typeof buffer === 'string' ? buffer : buffer.toString('utf-8');
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
  patterns: RegExp | string | (RegExp | string)[] | null | undefined
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
```

### Success Criteria:

#### Automated Verification:
- [x] File exists: `ls ts/lib/src/serializers.ts`
- [x] TypeScript compiles: `cd ts/lib && bun run tsc --noEmit`
- [x] No type errors in serializers

#### Manual Verification:
- [ ] Each Playwright type has a corresponding serializer
- [ ] All Date fields converted to ISO strings
- [ ] All Buffer fields converted to strings
- [ ] All RegExp fields converted to source strings
- [ ] Circular references (parent) are omitted
- [ ] Methods (titlePath, ok, outcome) are pre-computed

---

## Phase 3: Unit Tests

### Overview
Create comprehensive unit tests for all serializers using mock Playwright objects.

### Changes Required:

#### 1. Create `ts/lib/src/serializers.test.ts`
**File**: `ts/lib/src/serializers.test.ts`

```typescript
import { describe, test, expect } from 'bun:test';
import {
  serializeDate,
  serializeBuffer,
  serializeRegExp,
  serializeRegExpArray,
  serializeLocation,
  serializeTestError,
  serializeAttachment,
  serializeTestStep,
  serializeTestResult,
  serializeTestCase,
  serializeSuite,
  serializeProject,
  serializeConfig,
  serializeFullResult,
} from './serializers';

// ============================================
// Utility Function Tests
// ============================================

describe('serializeDate', () => {
  test('converts Date to ISO string', () => {
    const date = new Date('2025-01-15T10:30:00.000Z');
    expect(serializeDate(date)).toBe('2025-01-15T10:30:00.000Z');
  });
});

describe('serializeBuffer', () => {
  test('converts Buffer to string', () => {
    const buffer = Buffer.from('hello world');
    expect(serializeBuffer(buffer)).toBe('hello world');
  });

  test('passes through string unchanged', () => {
    expect(serializeBuffer('hello')).toBe('hello');
  });
});

describe('serializeRegExp', () => {
  test('converts RegExp to source string', () => {
    expect(serializeRegExp(/test.*pattern/)).toBe('test.*pattern');
  });

  test('passes through string unchanged', () => {
    expect(serializeRegExp('test')).toBe('test');
  });
});

describe('serializeRegExpArray', () => {
  test('handles null', () => {
    expect(serializeRegExpArray(null)).toBe(null);
  });

  test('handles undefined', () => {
    expect(serializeRegExpArray(undefined)).toBe(null);
  });

  test('wraps single RegExp in array', () => {
    expect(serializeRegExpArray(/test/)).toEqual(['test']);
  });

  test('wraps single string in array', () => {
    expect(serializeRegExpArray('test')).toEqual(['test']);
  });

  test('converts array of mixed patterns', () => {
    expect(serializeRegExpArray([/foo/, 'bar', /baz/])).toEqual(['foo', 'bar', 'baz']);
  });
});

// ============================================
// Core Serializer Tests
// ============================================

describe('serializeLocation', () => {
  test('serializes location correctly', () => {
    const location = { file: '/path/to/test.ts', line: 10, column: 5 };
    expect(serializeLocation(location)).toEqual({
      file: '/path/to/test.ts',
      line: 10,
      column: 5,
    });
  });
});

describe('serializeTestError', () => {
  test('serializes basic error', () => {
    const error = {
      message: 'Test failed',
      stack: 'Error: Test failed\n    at ...',
    };
    const result = serializeTestError(error);
    expect(result.message).toBe('Test failed');
    expect(result.stack).toBe('Error: Test failed\n    at ...');
  });

  test('serializes error with cause (recursive)', () => {
    const error = {
      message: 'Outer error',
      cause: {
        message: 'Inner error',
      },
    };
    const result = serializeTestError(error);
    expect(result.message).toBe('Outer error');
    expect(result.cause?.message).toBe('Inner error');
  });

  test('serializes error with location', () => {
    const error = {
      message: 'Error',
      location: { file: '/test.ts', line: 5, column: 10 },
    };
    const result = serializeTestError(error);
    expect(result.location).toEqual({ file: '/test.ts', line: 5, column: 10 });
  });
});

describe('serializeAttachment', () => {
  test('serializes attachment with path', () => {
    const attachment = {
      name: 'screenshot',
      contentType: 'image/png',
      path: '/path/to/screenshot.png',
    };
    expect(serializeAttachment(attachment)).toEqual({
      name: 'screenshot',
      contentType: 'image/png',
      path: '/path/to/screenshot.png',
    });
  });

  test('omits body even if present', () => {
    const attachment = {
      name: 'data',
      contentType: 'text/plain',
      body: Buffer.from('secret data'),
    };
    const result = serializeAttachment(attachment);
    expect(result).not.toHaveProperty('body');
  });
});

describe('serializeTestStep', () => {
  test('serializes step with nested steps', () => {
    const mockStep = {
      title: 'Parent Step',
      titlePath: () => ['Test', 'Parent Step'],
      category: 'test.step',
      duration: 100,
      startTime: new Date('2025-01-15T10:00:00.000Z'),
      annotations: [],
      attachments: [],
      steps: [
        {
          title: 'Child Step',
          titlePath: () => ['Test', 'Parent Step', 'Child Step'],
          category: 'test.step',
          duration: 50,
          startTime: new Date('2025-01-15T10:00:00.050Z'),
          annotations: [],
          attachments: [],
          steps: [],
        },
      ],
    } as any;

    const result = serializeTestStep(mockStep);
    expect(result.title).toBe('Parent Step');
    expect(result.titlePath).toEqual(['Test', 'Parent Step']);
    expect(result.startTime).toBe('2025-01-15T10:00:00.000Z');
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].title).toBe('Child Step');
  });
});

describe('serializeTestResult', () => {
  test('serializes result with stdio', () => {
    const mockResult = {
      status: 'passed',
      duration: 1000,
      startTime: new Date('2025-01-15T10:00:00.000Z'),
      retry: 0,
      workerIndex: 0,
      parallelIndex: 0,
      errors: [],
      stdout: ['output line', Buffer.from('buffer output')],
      stderr: [],
      steps: [],
      attachments: [],
      annotations: [],
    } as any;

    const result = serializeTestResult(mockResult);
    expect(result.status).toBe('passed');
    expect(result.startTime).toBe('2025-01-15T10:00:00.000Z');
    expect(result.stdout).toEqual(['output line', 'buffer output']);
  });
});

describe('serializeTestCase', () => {
  test('serializes test case with computed properties', () => {
    const mockTest = {
      id: 'test-123',
      title: 'should work',
      titlePath: () => ['Suite', 'should work'],
      location: { file: '/test.ts', line: 10, column: 1 },
      tags: ['@smoke'],
      timeout: 30000,
      retries: 2,
      repeatEachIndex: 0,
      expectedStatus: 'passed',
      annotations: [],
      outcome: () => 'expected',
      ok: () => true,
    } as any;

    const result = serializeTestCase(mockTest);
    expect(result.id).toBe('test-123');
    expect(result.titlePath).toEqual(['Suite', 'should work']);
    expect(result.outcome).toBe('expected');
    expect(result.ok).toBe(true);
  });
});

describe('serializeSuite', () => {
  test('serializes suite with test IDs only', () => {
    const mockSuite = {
      title: 'My Suite',
      titlePath: () => ['', 'My Suite'],
      type: 'describe',
      location: { file: '/test.ts', line: 1, column: 1 },
      suites: [],
      tests: [{ id: 'test-1' }, { id: 'test-2' }],
    } as any;

    const result = serializeSuite(mockSuite);
    expect(result.testIds).toEqual(['test-1', 'test-2']);
    expect(result).not.toHaveProperty('tests');
  });

  test('serializes nested suites recursively', () => {
    const mockSuite = {
      title: 'Root',
      titlePath: () => ['Root'],
      type: 'file',
      suites: [
        {
          title: 'Child',
          titlePath: () => ['Root', 'Child'],
          type: 'describe',
          suites: [],
          tests: [],
        },
      ],
      tests: [],
    } as any;

    const result = serializeSuite(mockSuite);
    expect(result.suites).toHaveLength(1);
    expect(result.suites[0].title).toBe('Child');
  });
});

describe('serializeFullResult', () => {
  test('serializes final result', () => {
    const mockResult = {
      status: 'passed',
      startTime: new Date('2025-01-15T10:00:00.000Z'),
      duration: 5000,
    } as any;

    const result = serializeFullResult(mockResult);
    expect(result.status).toBe('passed');
    expect(result.startTime).toBe('2025-01-15T10:00:00.000Z');
    expect(result.duration).toBe(5000);
  });
});

// ============================================
// JSON Safety Tests
// ============================================

describe('JSON safety', () => {
  test('serialized objects are JSON-safe', () => {
    const mockResult = {
      status: 'passed',
      duration: 1000,
      startTime: new Date('2025-01-15T10:00:00.000Z'),
      retry: 0,
      workerIndex: 0,
      parallelIndex: 0,
      errors: [],
      stdout: [Buffer.from('test')],
      stderr: [],
      steps: [],
      attachments: [],
      annotations: [],
    } as any;

    const serialized = serializeTestResult(mockResult);
    const jsonString = JSON.stringify(serialized);
    const parsed = JSON.parse(jsonString);

    expect(parsed.startTime).toBe('2025-01-15T10:00:00.000Z');
    expect(parsed.stdout).toEqual(['test']);
  });
});
```

### Success Criteria:

#### Automated Verification:
- [x] Tests pass: `cd ts/lib && bun test`
- [x] All serializers have at least one test
- [x] JSON safety test confirms output is serializable

#### Manual Verification:
- [ ] Edge cases covered (null, undefined, empty arrays)
- [ ] Recursive structures tested (steps, suites, error cause)

---

## Phase 4: Integration & Exports

### Overview
Create the package entry point and verify integration with the existing reporter.

### Changes Required:

#### 1. Create `ts/lib/src/index.ts`
**File**: `ts/lib/src/index.ts`

```typescript
// Types
export type {
  SerializedTestStatus,
  SerializedLocation,
  SerializedAnnotation,
  SerializedAttachment,
  SerializedTestError,
  SerializedTestStep,
  SerializedTestResult,
  SerializedTestCase,
  SerializedSuite,
  SerializedProject,
  SerializedConfig,
  SerializedFullResult,
  // Event types
  ReporterEvent,
  OnBeginEvent,
  OnTestBeginEvent,
  OnTestEndEvent,
  OnStepBeginEvent,
  OnStepEndEvent,
  OnErrorEvent,
  OnEndEvent,
  OnStdOutEvent,
  OnStdErrEvent,
  OnExitEvent,
} from './types';

// Serializers
export {
  serializeDate,
  serializeBuffer,
  serializeRegExp,
  serializeRegExpArray,
  serializeLocation,
  serializeTestError,
  serializeAttachment,
  serializeTestStep,
  serializeTestResult,
  serializeTestCase,
  serializeSuite,
  serializeProject,
  serializeConfig,
  serializeFullResult,
} from './serializers';
```

#### 2. Create `ts/lib/package.json`
**File**: `ts/lib/package.json`

```json
{
  "name": "@org/pw-reporter-serializers",
  "version": "0.1.0",
  "description": "JSON serialization layer for Playwright reporter types",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "type": "module",
  "scripts": {
    "build": "bun build src/index.ts --outdir dist --target node",
    "typecheck": "tsc --noEmit",
    "test": "bun test"
  },
  "peerDependencies": {
    "@playwright/test": ">=1.40.0"
  },
  "devDependencies": {
    "@playwright/test": "^1.49.1",
    "bun-types": "latest",
    "typescript": "^5.0.0"
  },
  "files": [
    "dist",
    "src"
  ],
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  }
}
```

### Success Criteria:

#### Automated Verification:
- [x] Package installs dependencies: `cd ts/lib && bun install`
- [x] Build succeeds: `cd ts/lib && bun run build`
- [x] Type checking passes: `cd ts/lib && bun run typecheck`
- [x] Tests pass: `cd ts/lib && bun test`

#### Manual Verification:
- [ ] Exports are correctly exposed
- [ ] Package can be imported from parent directory

---

## Testing Strategy

### Unit Tests:
- Each serializer function tested in isolation
- Mock Playwright objects used (no real test runs needed)
- Edge cases: null/undefined values, empty arrays, deeply nested structures

### Integration Tests:
- Import serializers into existing `ts/reporter.ts`
- Run actual Playwright tests and verify JSON output
- Compare with current `out.txt` structure

### Manual Testing Steps:
1. Run `bun test` in `ts/lib/` directory
2. Import serializers into `ts/reporter.ts` and run `bun playwright test`
3. Verify WebSocket messages are valid JSON with correct structure

## Performance Considerations

- Serializers are pure functions with no side effects
- Recursive serialization for steps/suites could be deep - no explicit depth limit (Playwright already handles this)
- `titlePath()` method called once per serialization (not cached)

## References

- Research: `thoughts/shared/research/playwright-reporter-types.md`
- Parent plan: `thoughts/shared/plans/2025-12-09-pw-reporter-library.md`
- Existing reporter: `ts/reporter.ts:7-64`
- Playwright types: `node_modules/playwright/types/testReporter.d.ts`

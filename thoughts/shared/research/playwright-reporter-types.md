---
date: 2025-12-09T12:00:00-08:00
researcher: Claude
git_commit: ee4ac9262621f96425ed2f89a7695b9798f66100
branch: master
repository: pw-examples
topic: "Playwright Test Reporter API Types for JSON Serialization"
tags: [research, playwright, reporter, types, serialization, typescript, python, pydantic]
status: complete
last_updated: 2025-12-09
last_updated_by: Claude
---

# Research: Playwright Test Reporter API Types for JSON Serialization

**Date**: 2025-12-09T12:00:00-08:00
**Researcher**: Claude
**Git Commit**: ee4ac9262621f96425ed2f89a7695b9798f66100
**Branch**: master
**Repository**: pw-examples

## Research Question

Research the Playwright test reporter API types from the official documentation and local type definitions to provide a summary for implementing JSON serializable types in TypeScript and Python (Pydantic).

## Summary

The Playwright Test Reporter API provides 11 lifecycle methods that receive various typed objects during test execution. The core types (`TestCase`, `TestResult`, `TestStep`, `Suite`, `FullConfig`, `FullProject`, `FullResult`, `TestError`, `Location`) contain non-JSON-serializable elements (Date, Buffer, RegExp, circular references, methods) that require serialization layers.

Playwright already provides `JSONReport*` types for its built-in JSON reporter, but these are designed for final reports, not streaming events. Custom serialization is needed for real-time reporter use cases.

## Detailed Findings

### Reporter Interface Methods

The `Reporter` interface defines the following lifecycle methods:

| Method | Parameters | Return Type | Description |
|--------|------------|-------------|-------------|
| `onBegin` | `(config: FullConfig, suite: Suite)` | `void` | Called once before running tests |
| `onTestBegin` | `(test: TestCase, result: TestResult)` | `void` | Called when test starts |
| `onStepBegin` | `(test: TestCase, result: TestResult, step: TestStep)` | `void` | Called when step starts |
| `onStepEnd` | `(test: TestCase, result: TestResult, step: TestStep)` | `void` | Called when step ends |
| `onTestEnd` | `(test: TestCase, result: TestResult)` | `void` | Called when test ends |
| `onEnd` | `(result: FullResult)` | `Promise<{status?}> \| void` | Called after all tests |
| `onError` | `(error: TestError)` | `void` | Called on global errors |
| `onExit` | `()` | `Promise<void>` | Called before runner exits |
| `onStdOut` | `(chunk: string\|Buffer, test?, result?)` | `void` | Captures stdout |
| `onStdErr` | `(chunk: string\|Buffer, test?, result?)` | `void` | Captures stderr |
| `printsToStdio` | `()` | `boolean` | Whether reporter uses stdio |

### Core Types

#### Location

```typescript
interface Location {
  file: string;    // Path to source file
  line: number;    // Line number (1-based)
  column: number;  // Column number (1-based)
}
```

**Serialization**: Already JSON-safe.

#### TestStatus

```typescript
type TestStatus = 'passed' | 'failed' | 'timedOut' | 'skipped' | 'interrupted';
```

**Serialization**: Already JSON-safe (string literal union).

#### Annotation

```typescript
interface Annotation {
  type: string;           // e.g., 'skip', 'fail', 'fixme'
  description?: string;   // Optional description
  location?: Location;    // Optional source location
}
```

**Serialization**: Already JSON-safe.

#### Attachment

```typescript
interface Attachment {
  name: string;
  contentType: string;   // MIME type, e.g., 'image/png'
  path?: string;         // Path on filesystem
  body?: Buffer;         // Attachment body (binary data)
}
```

**Serialization**: `body` is a `Buffer` - needs Base64 encoding or omission.

#### TestError

```typescript
interface TestError {
  message?: string;      // Error message (when Error thrown)
  stack?: string;        // Error stack trace
  value?: string;        // Thrown value (when non-Error thrown)
  snippet?: string;      // Source code snippet with highlight
  location?: Location;   // Error location in source
  cause?: TestError;     // Nested error cause (recursive)
}
```

**Serialization**: Already JSON-safe (recursive but not circular).

#### TestStep

```typescript
interface TestStep {
  title: string;
  category: string;      // 'expect' | 'fixture' | 'hook' | 'pw:api' | 'test.step' | 'test.attach'
  duration: number;      // milliseconds
  startTime: Date;       // ⚠️ Date object
  location?: Location;
  error?: TestError;
  parent?: TestStep;     // ⚠️ Circular reference to parent
  steps: TestStep[];     // Recursive child steps
  annotations: Annotation[];
  attachments: Attachment[];  // ⚠️ May contain Buffer

  // Methods (not serializable)
  titlePath(): string[];
}
```

**Serialization Issues**:
- `startTime`: Date → ISO 8601 string
- `parent`: Circular reference → omit or use title/index reference
- `attachments[].body`: Buffer → Base64 or omit
- `titlePath()`: Method → pre-compute as `path: string[]`

#### TestResult

```typescript
interface TestResult {
  status: TestStatus;
  duration: number;        // milliseconds
  startTime: Date;         // ⚠️ Date object
  retry: number;           // Retry attempt index
  workerIndex: number;     // Worker ID (-1 if not run)
  parallelIndex: number;   // Parallel worker index
  error?: TestError;       // First error
  errors: TestError[];     // All errors
  stdout: (string | Buffer)[];  // ⚠️ May contain Buffer
  stderr: (string | Buffer)[];  // ⚠️ May contain Buffer
  steps: TestStep[];
  attachments: Attachment[];    // ⚠️ May contain Buffer
  annotations: Annotation[];
}
```

**Serialization Issues**:
- `startTime`: Date → ISO 8601 string
- `stdout`/`stderr`: Buffer entries → string (via `.toString()`)
- `attachments[].body`: Buffer → Base64 or omit

#### TestCase

```typescript
interface TestCase {
  id: string;              // Unique test ID
  title: string;           // Test name
  type: 'test';            // Always 'test'
  location: Location;
  tags: string[];
  timeout: number;         // milliseconds
  retries: number;         // Max retry attempts
  repeatEachIndex: number;
  expectedStatus: TestStatus;
  annotations: Annotation[];
  results: TestResult[];   // Results from each run
  parent: Suite;           // ⚠️ Circular reference

  // Methods (not serializable)
  ok(): boolean;
  outcome(): 'skipped' | 'expected' | 'unexpected' | 'flaky';
  titlePath(): string[];
}
```

**Serialization Issues**:
- `parent`: Circular reference → omit
- `ok()`, `outcome()`, `titlePath()`: Methods → pre-compute as properties

#### Suite

```typescript
interface Suite {
  title: string;
  type: 'root' | 'project' | 'file' | 'describe';
  location?: Location;     // Missing for root/project suites
  parent?: Suite;          // ⚠️ Circular reference
  suites: Suite[];         // Child suites (recursive)
  tests: TestCase[];       // Direct test cases

  // Methods (not serializable)
  allTests(): TestCase[];
  entries(): (TestCase | Suite)[];
  project(): FullProject | undefined;
  titlePath(): string[];
}
```

**Serialization Issues**:
- `parent`: Circular reference → omit
- `tests`: Contains circular refs back to suite → serialize test IDs only
- Methods → pre-compute `path: string[]`, flatten `allTests` if needed

#### FullProject

```typescript
interface FullProject {
  name: string;
  testDir: string;
  outputDir: string;
  snapshotDir: string;
  repeatEach: number;
  retries: number;
  timeout: number;
  dependencies: string[];
  teardown?: string;
  metadata: Record<string, any>;
  grep: RegExp | RegExp[];              // ⚠️ RegExp
  grepInvert: null | RegExp | RegExp[]; // ⚠️ RegExp
  testIgnore: string | RegExp | (string | RegExp)[];  // ⚠️ Mixed
  testMatch: string | RegExp | (string | RegExp)[];   // ⚠️ Mixed
  use: object;                          // Playwright fixtures/options
}
```

**Serialization Issues**:
- `grep`, `grepInvert`: RegExp → `regex.source` string
- `testIgnore`, `testMatch`: Mixed array → convert RegExp to strings
- `use`: Complex nested object → serialize as-is or omit sensitive data

#### FullConfig

```typescript
interface FullConfig {
  configFile?: string;
  rootDir: string;
  version: string;
  workers: number;
  forbidOnly: boolean;
  fullyParallel: boolean;
  quiet: boolean;
  globalSetup: null | string;
  globalTeardown: null | string;
  globalTimeout: number;
  maxFailures: number;
  preserveOutput: 'always' | 'never' | 'failures-only';
  updateSnapshots: 'all' | 'changed' | 'missing' | 'none';
  updateSourceMethod: 'overwrite' | '3way' | 'patch';
  metadata: Record<string, any>;
  grep: RegExp | RegExp[];              // ⚠️ RegExp
  grepInvert: null | RegExp | RegExp[]; // ⚠️ RegExp
  shard: null | { total: number; current: number };
  reportSlowTests: null | { max: number; threshold: number };
  projects: FullProject[];              // ⚠️ Contains RegExp
  reporter: ReporterDescription[];
  webServer: TestConfigWebServer | null;
}
```

**Serialization Issues**:
- `grep`, `grepInvert`: RegExp → string
- `projects`: Contains FullProject with RegExp fields

#### FullResult

```typescript
interface FullResult {
  status: 'passed' | 'failed' | 'timedout' | 'interrupted';
  startTime: Date;    // ⚠️ Date object
  duration: number;   // milliseconds
}
```

**Serialization Issues**:
- `startTime`: Date → ISO 8601 string

### Serialization Strategy Summary

| Type | Issue | Recommended Solution |
|------|-------|---------------------|
| `Date` | Not JSON | → ISO 8601 string (`date.toISOString()`) |
| `Buffer` | Binary data | → Base64 string or omit for large attachments |
| `RegExp` | Not JSON | → `regex.source` string |
| Circular `parent` refs | Infinite recursion | → Omit entirely |
| Methods | Functions | → Pre-compute results as properties |
| Recursive structures | Deep nesting | → Keep but handle circular refs |

### Existing Playwright JSON Types (Reference)

Playwright provides these serializable types in `testReporter.d.ts` for its JSON reporter:

```typescript
interface JSONReport {
  config: Omit<FullConfig, 'projects'> & { projects: {...}[] };
  suites: JSONReportSuite[];
  errors: TestError[];
  stats: { startTime: string; duration: number; expected: number; ... };
}

interface JSONReportSuite {
  title: string;
  file: string;
  column: number;
  line: number;
  specs: JSONReportSpec[];
  suites?: JSONReportSuite[];
}

interface JSONReportSpec {
  tags: string[];
  title: string;
  ok: boolean;
  tests: JSONReportTest[];
  id: string;
  file: string;
  line: number;
  column: number;
}

interface JSONReportTest {
  timeout: number;
  annotations: { type: string, description?: string }[];
  expectedStatus: TestStatus;
  projectName: string;
  projectId: string;
  results: JSONReportTestResult[];
  status: 'skipped' | 'expected' | 'unexpected' | 'flaky';
}

interface JSONReportTestResult {
  workerIndex: number;
  parallelIndex: number;
  status: TestStatus | undefined;
  duration: number;
  error: TestError | undefined;
  errors: JSONReportError[];
  stdout: JSONReportSTDIOEntry[];
  stderr: JSONReportSTDIOEntry[];
  retry: number;
  steps?: JSONReportTestStep[];
  startTime: string;  // ISO 8601
  attachments: { name: string; path?: string; body?: string; contentType: string }[];
  annotations: { type: string, description?: string }[];
  errorLocation?: Location;
}

interface JSONReportTestStep {
  title: string;
  duration: number;
  error: TestError | undefined;
  steps?: JSONReportTestStep[];
}

type JSONReportSTDIOEntry = { text: string } | { buffer: string };
```

These types flatten the hierarchy and use strings for dates/buffers, providing a good reference pattern.

## Code References

- `ts/reporter.ts:7-64` - Existing serialization functions (incomplete)
- `node_modules/playwright/types/testReporter.d.ts:1-817` - Full type definitions
- `node_modules/playwright/types/test.d.ts:738-812` - FullProject definition
- `node_modules/playwright/types/test.d.ts:1921-2049` - FullConfig definition
- `node_modules/playwright/types/test.d.ts:9751-9766` - Location definition
- `node_modules/playwright/types/test.d.ts:2576` - TestStatus definition

## Architecture Documentation

The current reporter in `ts/reporter.ts` implements a WebSocket-based streaming reporter with partial serialization. The existing `serializeX` functions handle basic cases but lack:

1. Type definitions for serialized output
2. Consistent handling of Buffers in attachments/stdio
3. Proper Date serialization (currently relies on JSON.stringify behavior)
4. Documentation of the serialization contract

## Open Questions

1. Should attachment bodies be included in streaming events or deferred to final report?
2. What level of step nesting should be preserved in serialized output?
3. Should `use` fixtures object be fully serialized or filtered for sensitive data?
4. For Python: Should Pydantic models use strict validation or coercion for dates/enums?

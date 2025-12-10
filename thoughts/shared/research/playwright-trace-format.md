---
date: 2025-12-09T21:55:00-05:00
researcher: Claude
git_commit: 2e03cc6
branch: main
repository: pw-examples
topic: "Playwright Trace Format Analysis"
tags: [research, playwright, trace, har, test-results]
status: complete
last_updated: 2025-12-09
last_updated_by: Claude
last_updated_note: "Added follow-up research for reconstructing spec files from trace data"
---

# Research: Playwright Trace Format Analysis

**Date**: 2025-12-09T21:55:00-05:00
**Researcher**: Claude
**Git Commit**: 2e03cc6
**Branch**: main
**Repository**: pw-examples

## Research Question

Based on the unzipped trace in `./test-results/`:
1. How to construct a HAR for the suite run?
2. How to know which files are which from the source dump?

## Summary

Playwright trace files use a structured format with multiple NDJSON files and a `resources/` directory containing actual file contents. The network data is already in HAR-compatible format, and all resources are content-addressed using SHA1 hashes.

## Detailed Findings

### Trace Directory Structure

A typical unzipped trace contains:

```
trace/
├── test.trace           # Test runner events (hooks, fixtures, steps)
├── 0-trace.trace        # Browser context events (navigation, clicks, assertions, DOM snapshots)
├── 0-trace.network      # Network requests/responses in HAR-like NDJSON format
├── 0-trace.stacks       # Source file paths + stack trace mappings
└── resources/           # Actual file contents (screenshots, videos, response bodies, source)
```

### 1. Constructing a HAR from Trace Data

The `0-trace.network` file **already contains HAR entries** in NDJSON format (newline-delimited JSON). Each line is a `resource-snapshot` event that follows the HAR 1.2 specification.

#### Network File Entry Structure

```json
{
  "type": "resource-snapshot",
  "snapshot": {
    "pageref": "page@226c463bf12178bae172e93a0e877401",
    "startedDateTime": "2025-12-09T20:12:51.371Z",
    "time": 203.255,
    "request": {
      "method": "GET",
      "url": "https://example.com/",
      "httpVersion": "HTTP/2.0",
      "cookies": [],
      "headers": [{"name": "accept", "value": "text/html,..."}],
      "queryString": [],
      "headersSize": 700,
      "bodySize": 0
    },
    "response": {
      "status": 200,
      "statusText": "",
      "httpVersion": "HTTP/2.0",
      "cookies": [],
      "headers": [...],
      "content": {
        "size": 11410,
        "mimeType": "text/html; charset=utf-8",
        "compression": 7646,
        "_sha1": "a54f0167100cfdb49043537fd0ab56243d9faf14.html"
      },
      "headersSize": 0,
      "bodySize": 3764,
      "redirectURL": "",
      "_transferSize": 3764
    },
    "timings": {
      "dns": 39.415,
      "connect": 67.646,
      "ssl": 57.659,
      "send": 0,
      "wait": 34.737,
      "receive": 3.798
    },
    "_frameref": "frame@4e1514969a1f3067fd19ae2d4b074430",
    "_monotonicTime": 1925.434,
    "serverIPAddress": "216.150.16.65",
    "_serverPort": 443,
    "_securityDetails": {
      "protocol": "TLS 1.3",
      "subjectName": "example.com",
      "issuer": "R13",
      "validFrom": 1764777309,
      "validTo": 1772553308
    }
  }
}
```

#### Steps to Construct Full HAR File

1. **Parse each line** of `0-trace.network` as JSON
2. **Extract metadata** from `0-trace.trace` line 1 (contains `playwrightVersion`, `browserName`, etc.)
3. **Wrap in HAR envelope**:
   ```json
   {
     "log": {
       "version": "1.2",
       "creator": { "name": "Playwright", "version": "1.57.0" },
       "pages": [{
         "id": "page@...",
         "title": "Test Name",
         "startedDateTime": "..."
       }],
       "entries": [ /* all snapshot.* objects from network file */ ]
     }
   }
   ```
4. **Response bodies**: Look up `response.content._sha1` in `resources/` directory to get actual content

### 2. Resource File Identification

#### File Naming Conventions in `resources/`

| Pattern | Type | Description |
|---------|------|-------------|
| `src@{sha1}.txt` | Test source code | Spec files, Page Object Models |
| `page@{pageId}-{timestamp}.jpeg` | Screencast frames | Screenshots during test execution |
| `{sha1}.html` | HTML response body | Network response content |
| `{sha1}.css` | CSS response body | Stylesheet content |
| `{sha1}.woff2` | Font file | Web font content |
| `{sha1}.htc` | HTC file | HTML Component files |
| `{sha1}` (no extension) | Binary attachment | Video recordings, final screenshots |

#### Mapping Source Files (`src@...`)

The `0-trace.stacks` file provides the complete mapping:

```json
{
  "files": [
    "/Users/taras/.../evals-page.pom.ts",
    "/Users/taras/.../acceptance.spec.ts"
  ],
  "stacks": [
    [8, [[0, 19, 21, "EvalPage.goto"], [1, 15, 15, ""]]]
  ]
}
```

**Structure explanation:**
- `files`: Array of absolute file paths (index is the file ID)
- `stacks`: Array of `[callId, frames]` where each frame is `[fileIndex, line, column, functionName]`

The `src@{sha1}.txt` files are content-hashed copies of test source files. The actual content matches the files listed in the `files` array.

#### Mapping Network Response Bodies

In `0-trace.network`, each entry's `response.content._sha1` field points to the resource file:

```json
"response": {
  "content": {
    "size": 11410,
    "mimeType": "text/html; charset=utf-8",
    "_sha1": "a54f0167100cfdb49043537fd0ab56243d9faf14.html"
  }
}
```

This maps to: `resources/a54f0167100cfdb49043537fd0ab56243d9faf14.html`

#### Mapping Screenshots and Videos

In `test.trace`, attachments are referenced in `after` events:

```json
{
  "type": "after",
  "callId": "fixture@40",
  "attachments": [
    {
      "name": "video",
      "contentType": "video/webm",
      "sha1": "421e4fe35d0660ca46931ae869409812ac2680be"
    }
  ]
}
```

And for screenshots:
```json
{
  "type": "after",
  "callId": "hook@38",
  "attachments": [
    {
      "name": "screenshot",
      "contentType": "image/png",
      "sha1": "cee871041f8007cc602bf6b159fb0dc7a2ba4fb5"
    }
  ]
}
```

### Trace Event Types

#### `test.trace` Event Types
- `context-options`: Initial configuration (version 8, origin: testRunner)
- `before`/`after`: Wraps test steps, hooks, fixtures, and API calls
- `fixture@*`: Fixture setup/teardown (browser, context, page)
- `hook@*`: beforeEach/afterEach hooks
- `pw:api@*`: Playwright API calls
- `expect@*`: Assertion calls

#### `0-trace.trace` Event Types
- `context-options`: Browser context configuration (origin: library)
- `before`/`after`: Browser API calls
- `event`: Browser events (page created, etc.)
- `screencast-frame`: Screenshot frame references
- `frame-snapshot`: DOM snapshot at a point in time
- `log`: Debug log messages

## Code References

- `ts/test-results/acceptance-Acceptance-should-display-page-title-base/trace/` - Example trace directory
- `ts/node_modules/playwright-core/lib/utils/isomorphic/traceUtils.js:25-33` - Stack parsing utility

## Architecture Documentation

### Content Addressing

All resources use SHA1 content hashing for deduplication and integrity:
- Same content across tests shares the same hash
- File extension is appended based on MIME type when available
- Binary files (video, screenshots) have no extension

### Trace File Separation

Playwright separates concerns across multiple files:
- `test.trace`: Test framework layer (fixtures, hooks, assertions)
- `0-trace.trace`: Browser automation layer (navigation, DOM)
- `0-trace.network`: Network layer (requests, responses)
- `0-trace.stacks`: Debug symbols (source locations)

The `0-` prefix indicates the browser context index (supports multiple contexts per test).

## Follow-up Research 2025-12-09T22:45:00-05:00

### Reconstructing .spec.ts Files from Trace Data

This section documents how an external process can extract and reconstruct working Playwright test files from trace.zip data.

#### Key Files for Source Reconstruction

| File | Purpose | Format |
|------|---------|--------|
| `0-trace.stacks` | Maps file indices to paths + contains actual file list | JSON (single line) |
| `resources/src@{hash}.txt` | Actual source code content | Plain text |
| `test.trace` | Test metadata including location and titles | NDJSON |
| `0-trace.trace` | Browser context info with test title | NDJSON |

#### Step-by-Step Algorithm

**Step 1: Extract test metadata from `0-trace.trace` line 1**

```json
{
  "version": 8,
  "type": "context-options",
  "origin": "library",
  "browserName": "chromium",
  "playwrightVersion": "1.57.0",
  "sdkLanguage": "javascript",
  "contextId": "browser-context@83348c64df60e077413900fa3b44dafb",
  "title": "acceptance.spec.ts:18 › Acceptance › should display page title"
}
```

Key fields:
- `title`: Full test path in format `<file>:<line> › <describe> › <test name>`
- `sdkLanguage`: "javascript" indicates TypeScript/JavaScript test

**Step 2: Parse `0-trace.stacks` to get source file mapping**

```json
{
  "files": [
    "/Users/.../evals-page.pom.ts",
    "/Users/.../acceptance.spec.ts"
  ],
  "stacks": [
    [8, [[0, 19, 21, "EvalPage.goto"], [1, 15, 15, ""]]],
    [10, [[1, 20, 57, ""]]]
  ]
}
```

The `files` array contains absolute paths of all source files used in the test.

**Step 3: Locate source content in `resources/`**

Source files are stored as `src@{sha1hash}.txt`. The hash is content-based but not a simple SHA1 of the file content - it appears to be an internal Playwright identifier.

To match sources to files:
1. List all `src@*.txt` files in `resources/`
2. Read each file's content
3. Parse the first line to identify the file type:
   - `import { test, expect } from "@playwright/test"` → spec file
   - `import type { Page, Locator }` → page object model
   - `export class` → helper class

**Step 4: Extract test structure from `test.trace`**

Each test has location information in hook entries:

```json
{
  "type": "before",
  "callId": "hook@2",
  "parentId": "hook@1",
  "title": "beforeEach hook",
  "stack": [{
    "file": "/Users/.../acceptance.spec.ts",
    "line": 13,
    "column": 10
  }]
}
```

And API calls with locations:

```json
{
  "type": "before",
  "callId": "pw:api@36",
  "title": "Navigate to \"/\"",
  "stack": [{
    "file": "/Users/.../evals-page.pom.ts",
    "line": 19,
    "column": 21,
    "function": "EvalPage.goto"
  }]
}
```

**Step 5: Correlate stack traces to reconstruct test flow**

The `stacks` array in `0-trace.stacks` uses this format:
- `[callId, frames]` where `callId` matches the number suffix in `pw:api@X` or `expect@X`
- Each frame is `[fileIndex, line, column, functionName]`
- `fileIndex` references the `files` array

Example: Stack entry `[8, [[0, 19, 21, "EvalPage.goto"], [1, 15, 15, ""]]]`
- callId `8` = `pw:api@8` or `call@8` in traces
- Frame 0: file[0] (evals-page.pom.ts), line 19, col 21, function "EvalPage.goto"
- Frame 1: file[1] (acceptance.spec.ts), line 15, col 15

#### Complete Data Extraction Structure

```typescript
interface TraceSourceData {
  // From 0-trace.trace line 1
  testInfo: {
    title: string;           // "file:line › describe › test name"
    browserName: string;     // "chromium"
    playwrightVersion: string;
    sdkLanguage: string;     // "javascript"
  };

  // From 0-trace.stacks
  sourceFiles: {
    path: string;            // Absolute file path
    content: string;         // From src@{hash}.txt
  }[];

  // From test.trace
  testSteps: {
    title: string;           // "Navigate to '/'", "Expect 'toBeVisible'"
    location?: {
      file: string;
      line: number;
      column: number;
      function?: string;
    };
    category: "hook" | "fixture" | "pw:api" | "expect";
    params?: Record<string, string>;
  }[];
}
```

#### Practical Example: Extract All Sources from trace.zip

```bash
# 1. Unzip trace
unzip trace.zip -d trace_extracted

# 2. Get file mapping
cat trace_extracted/0-trace.stacks | jq '.files'

# 3. Read source files
for f in trace_extracted/resources/src@*.txt; do
  echo "=== $f ==="
  head -5 "$f"
done

# 4. Get test title
head -1 trace_extracted/0-trace.trace | jq '.title'
```

#### JSON Schema for External Process

An external process wanting to reconstruct tests should:

1. **Parse trace metadata:**
   ```json
   {
     "specFile": "acceptance.spec.ts",
     "testTitle": "should display page title",
     "describePath": ["Acceptance"],
     "line": 18
   }
   ```

2. **Extract dependencies (imports):**
   - The spec file's imports point to page objects/helpers
   - All imported files should also be in the `files` array

3. **Reconstruct by copying:**
   - Main spec file content from `src@{hash}.txt`
   - All POM/helper files similarly
   - Preserve directory structure from absolute paths

#### Limitations and Considerations

1. **Not all source is captured**: Only files that appear in stack traces are included. Utility files not called during the test won't be in the trace.

2. **Hash is not deterministic**: The `src@{hash}` hash doesn't match simple SHA1 of file content. It may be a Playwright internal identifier.

3. **Absolute paths**: File paths are absolute to the machine where tests ran. External processes need to handle path translation.

4. **No node_modules**: Playwright dependencies aren't included - only user test code.

5. **Single test scope**: Each trace.zip contains data for ONE test. To reconstruct a full spec file with multiple tests, you'd need traces from all tests in that file.

## Open Questions

- How does trace merging work across multiple test runs in a suite?
- What determines when response bodies are included vs excluded from resources?
- How are large response bodies handled (truncation, streaming)?
- What algorithm does Playwright use for the `src@{hash}` identifier?

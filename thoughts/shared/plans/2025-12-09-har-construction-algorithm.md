# HAR Construction Algorithm from Playwright Trace

## Overview

This plan defines a pseudo-algorithm for constructing a valid HAR 1.2 file from Playwright trace data. The algorithm parses the trace directory structure, extracts network data from the `0-trace.network` file, and optionally embeds response bodies from the `resources/` directory.

## Current State Analysis

Based on research in `thoughts/shared/research/playwright-trace-format.md`:

### Trace Directory Structure
```
trace/
├── test.trace           # Test runner events (hooks, fixtures, steps)
├── 0-trace.trace        # Browser context events (metadata in line 1)
├── 0-trace.network      # Network requests/responses - NDJSON HAR entries
├── 0-trace.stacks       # Source file paths + stack trace mappings
└── resources/           # Actual file contents (SHA1-addressed)
```

### Key Discoveries
- `0-trace.network` already contains HAR-compatible entries in NDJSON format
- Each line is a `resource-snapshot` event following HAR 1.2 spec
- Response bodies are stored in `resources/` directory, referenced by `_sha1` field
- Metadata (browser version, etc.) is in the first line of `0-trace.trace`

## Desired End State

A function that:
1. Takes a trace directory path (unzipped trace or trace.zip path)
2. Returns a valid HAR 1.2 JSON object
3. Optionally embeds response body content (base64 encoded)
4. Handles missing files gracefully

### Verification
- Output passes HAR 1.2 schema validation
- All network entries from trace are present
- Response bodies correctly linked when `includeContent: true`

## What We're NOT Doing

- Parsing `test.trace` for test step information (separate concern)
- Handling multi-context traces (multiple `N-trace.network` files)
- Streaming/chunked HAR generation
- HAR compression/optimization

---

## Pseudo-Algorithm

### Types

```typescript
interface HarConstructorOptions {
  tracePath: string;          // Path to unzipped trace directory or trace.zip
  includeContent?: boolean;   // Whether to embed response bodies (default: false)
  contentSizeLimit?: number;  // Max bytes per response body (default: 10MB)
}

interface HarLog {
  version: "1.2";
  creator: {
    name: string;
    version: string;
  };
  browser?: {
    name: string;
    version: string;
  };
  pages: HarPage[];
  entries: HarEntry[];
}

interface HarPage {
  id: string;
  title: string;
  startedDateTime: string;
  pageTimings: {
    onContentLoad?: number;
    onLoad?: number;
  };
}

// HarEntry is the standard HAR 1.2 entry format
// (same structure as in 0-trace.network snapshot objects)
```

### Algorithm

```
FUNCTION constructHar(options: HarConstructorOptions) -> HarLog

  // ============================================
  // PHASE 1: Initialize and Extract Trace
  // ============================================

  1. IF options.tracePath ends with ".zip":
       traceDir = extractToTempDir(options.tracePath)
       cleanup = true
     ELSE:
       traceDir = options.tracePath
       cleanup = false

  2. Validate directory structure:
     - ASSERT exists(traceDir + "/0-trace.network")
     - WARN if missing(traceDir + "/0-trace.trace")
     - WARN if missing(traceDir + "/resources/")

  // ============================================
  // PHASE 2: Extract Metadata from 0-trace.trace
  // ============================================

  3. IF exists(traceDir + "/0-trace.trace"):
       firstLine = readFirstLine(traceDir + "/0-trace.trace")
       metadata = JSON.parse(firstLine)

       // Expected structure:
       // {
       //   "type": "context-options",
       //   "browserName": "chromium",
       //   "platform": "darwin",
       //   "wallTime": 1733781170914,
       //   "monotonicTime": 0,
       //   "sdkLanguage": "javascript",
       //   "testIdAttributeName": "data-testid",
       //   "origin": "library"
       // }

       browserName = metadata.browserName OR "chromium"
       sdkLanguage = metadata.sdkLanguage OR "javascript"
       platform = metadata.platform OR "unknown"
     ELSE:
       browserName = "chromium"
       sdkLanguage = "javascript"
       platform = "unknown"

  4. Determine Playwright version:
     - Check test.trace first line for "playwrightVersion" field
     - OR default to "unknown"

  // ============================================
  // PHASE 3: Parse Network Entries
  // ============================================

  5. Read 0-trace.network as lines (NDJSON format):
     networkFile = readFile(traceDir + "/0-trace.network")
     lines = networkFile.split("\n").filter(nonEmpty)

  6. FOR each line in lines:
       event = JSON.parse(line)

       IF event.type == "resource-snapshot":
         entry = event.snapshot

         // entry is already HAR-compatible with structure:
         // {
         //   pageref: "page@...",
         //   startedDateTime: "ISO8601",
         //   time: milliseconds,
         //   request: { method, url, httpVersion, headers, ... },
         //   response: { status, statusText, headers, content, ... },
         //   timings: { dns, connect, ssl, send, wait, receive },
         //   _frameref: "frame@...",
         //   _monotonicTime: number,
         //   serverIPAddress: string,
         //   _serverPort: number,
         //   _securityDetails: {...}
         // }

         entries.push(entry)

         // Track unique pages
         IF entry.pageref NOT IN pagesMap:
           pagesMap[entry.pageref] = {
             id: entry.pageref,
             startedDateTime: entry.startedDateTime,
             firstEntryTime: entry._monotonicTime
           }

         // Update page timing (track earliest request)
         IF entry._monotonicTime < pagesMap[entry.pageref].firstEntryTime:
           pagesMap[entry.pageref].startedDateTime = entry.startedDateTime
           pagesMap[entry.pageref].firstEntryTime = entry._monotonicTime

  // ============================================
  // PHASE 4: Embed Response Bodies (Optional)
  // ============================================

  7. IF options.includeContent == true:
       resourcesDir = traceDir + "/resources/"

       FOR each entry in entries:
         sha1 = entry.response?.content?._sha1

         IF sha1 AND exists(resourcesDir + sha1):
           resourcePath = resourcesDir + sha1
           fileSize = getFileSize(resourcePath)

           IF fileSize <= options.contentSizeLimit:
             content = readFile(resourcePath)
             mimeType = entry.response.content.mimeType OR "application/octet-stream"

             IF isTextMimeType(mimeType):
               entry.response.content.text = content.toString("utf-8")
             ELSE:
               entry.response.content.text = content.toString("base64")
               entry.response.content.encoding = "base64"
           ELSE:
             // Mark as truncated
             entry.response.content.comment = "Content omitted: exceeds size limit"

         // Remove internal _sha1 field (not part of HAR spec)
         DELETE entry.response.content._sha1

  // ============================================
  // PHASE 5: Build Pages Array
  // ============================================

  8. pages = []
     FOR each [pageId, pageInfo] in pagesMap:
       pages.push({
         id: pageId,
         title: pageId,  // Could be enhanced with page title from trace
         startedDateTime: pageInfo.startedDateTime,
         pageTimings: {
           onContentLoad: -1,  // Not available in trace
           onLoad: -1          // Not available in trace
         }
       })

     // Sort pages by startedDateTime
     pages.sort((a, b) => Date.parse(a.startedDateTime) - Date.parse(b.startedDateTime))

  // ============================================
  // PHASE 6: Construct Final HAR Object
  // ============================================

  9. Sort entries by startedDateTime:
     entries.sort((a, b) => Date.parse(a.startedDateTime) - Date.parse(b.startedDateTime))

  10. Clean entries (remove Playwright-internal fields):
      FOR each entry in entries:
        // These are Playwright extensions, not HAR spec
        DELETE entry._frameref
        DELETE entry._monotonicTime
        DELETE entry._serverPort
        DELETE entry._securityDetails
        DELETE entry.response._transferSize

  11. Construct HAR envelope:
      har = {
        log: {
          version: "1.2",
          creator: {
            name: "Playwright",
            version: playwrightVersion
          },
          browser: {
            name: browserName,
            version: ""  // Not available in trace metadata
          },
          pages: pages,
          entries: entries
        }
      }

  // ============================================
  // PHASE 7: Cleanup and Return
  // ============================================

  12. IF cleanup:
        deleteTempDir(traceDir)

  13. RETURN har

END FUNCTION
```

### Helper Functions

```
FUNCTION isTextMimeType(mimeType: string) -> boolean
  textTypes = [
    "text/",
    "application/json",
    "application/javascript",
    "application/xml",
    "application/xhtml+xml",
    "+json",
    "+xml"
  ]
  RETURN mimeType matches any pattern in textTypes

FUNCTION extractToTempDir(zipPath: string) -> string
  tempDir = createTempDir()
  unzip(zipPath, tempDir)
  RETURN tempDir

FUNCTION readFirstLine(filePath: string) -> string
  // Read until first newline
  stream = openFileStream(filePath)
  line = stream.readLine()
  stream.close()
  RETURN line
```

---

## Implementation Phases

### Phase 1: Core HAR Construction

**File**: `ts/lib/src/har/constructor.ts`

**Changes**: Create new module with:
- `HarConstructorOptions` interface
- `constructHar()` function implementing the algorithm
- Helper functions for file reading and MIME type detection

### Success Criteria

#### Automated Verification:
- [ ] Unit tests pass: `bun test ts/lib/src/har/`
- [ ] Type checking passes: `bun run tsc --noEmit`
- [ ] Generated HAR validates against HAR 1.2 schema

#### Manual Verification:
- [ ] HAR file opens correctly in Chrome DevTools Network panel
- [ ] Request/response data matches original trace

---

### Phase 2: Zip Extraction Support

**File**: `ts/lib/src/har/constructor.ts`

**Changes**: Add zip extraction using Bun's built-in capabilities or `node:zlib`

### Success Criteria

#### Automated Verification:
- [ ] Can construct HAR from both `.zip` and unzipped directories
- [ ] Temp directories are properly cleaned up

---

### Phase 3: Content Embedding

**File**: `ts/lib/src/har/constructor.ts`

**Changes**: Implement optional response body embedding from `resources/` directory

### Success Criteria

#### Automated Verification:
- [ ] Response bodies correctly base64-encoded for binary content
- [ ] Text responses embedded as plain text
- [ ] Size limits respected

---

## Edge Cases

1. **Empty trace**: Return HAR with empty entries array
2. **Missing network file**: Throw descriptive error
3. **Malformed JSON lines**: Skip with warning, continue processing
4. **Missing resource files**: Omit content, add comment
5. **Large response bodies**: Respect size limit, add truncation comment
6. **Multiple contexts**: Only process `0-trace.network` (primary context)

## References

- Research: `thoughts/shared/research/playwright-trace-format.md`
- HAR 1.2 Spec: https://w3c.github.io/web-performance/specs/HAR/Overview.html
- Playwright trace source: `node_modules/playwright-core/lib/utils/isomorphic/traceUtils.js`

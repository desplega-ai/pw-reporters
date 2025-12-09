# Playwright Reporter Library Plan

## Summary
Create an npm package `@org/pw-reporter` that streams test events via WebSocket and uploads artifacts to an HTTP endpoint.

---

## Key Design Decisions

### 1. WebSocket for Streaming - Yes, Good Choice

**Why WebSocket is right:**
- Real-time bidirectional communication (server can acknowledge, send commands)
- Low overhead after handshake (no HTTP headers per event)
- Persistent connection = no latency per event
- Natural fit for event streams

**Mitigations for WebSocket risks:**
- Exponential backoff reconnection with jitter
- Message queue to buffer events during disconnection
- Heartbeat/ping-pong for stale connection detection

### 2. Library Structure

**Note:** No separate package.json in ts/lib/ - use root ts/package.json to avoid workspaces complexity.

```
ts/
├── package.json              # Root package - manages all dependencies
├── tsconfig.json             # TypeScript config
├── lib/
│   └── src/
│       ├── index.ts          # Exports reporter class + types + serializers
│       ├── reporter.ts       # Main Reporter implementation
│       ├── types.ts          # TypeScript interfaces
│       ├── serializers.ts    # Serialize Playwright objects (port from existing)
│       ├── websocket/
│       │   ├── client.ts     # WS client with reconnection
│       │   └── message-queue.ts  # Buffer during disconnection
│       └── uploader/
│           ├── index.ts      # Upload orchestrator
│           ├── file-scanner.ts   # Scan test-results/
│           └── http-uploader.ts  # HTTP upload with retry/chunking
└── dist/                     # Compiled output
```

### 3. 1-Liner Usage

```typescript
// playwright.config.ts
export default defineConfig({
  reporter: [
    ['@org/pw-reporter', {
      apiKey: process.env.REPORTER_API_KEY,
      wsEndpoint: 'wss://api.example.com/ws'
    }]
  ]
});
```

### 4. Static File Upload Strategy

**Approach:** Parallel uploads with controlled concurrency

1. **Scan** `test-results/` in `onEnd` - build manifest of files
2. **Upload** in `onExit`:
   - Parallel with concurrency limit (default: 3)
   - Chunked upload for files > 5MB
   - Per-file retry with exponential backoff (up to 3 attempts)
   - Failed uploads logged but don't fail the test run

---

## Configuration Interface

```typescript
interface ReporterConfig {
  // Required
  apiKey: string;
  wsEndpoint: string;           // 'wss://api.example.com/ws'

  // Optional
  uploadEndpoint?: string;      // Defaults to deriving from wsEndpoint
  reconnect?: {
    enabled?: boolean;          // default: true
    maxAttempts?: number;       // default: 10
    initialDelayMs?: number;    // default: 1000
    maxDelayMs?: number;        // default: 30000
  };
  upload?: {
    enabled?: boolean;          // default: true
    parallel?: number;          // default: 3
    chunkSizeMb?: number;       // default: 5
    retries?: number;           // default: 3
  };
  debug?: boolean;              // default: false
```

---

## Implementation Steps

### Phase 1: Package Setup
- [x] Create `ts/lib/src/` directory structure
- [x] Root `ts/package.json` already configured with build scripts, peer dependency on `@playwright/test`
- [x] Root `ts/tsconfig.json` already configured
- [x] Create `lib/src/types.ts` with all interfaces

**Note:** No separate package.json/tsconfig.json in ts/lib/ - using root ts/package.json to avoid workspaces.

### Phase 2: Port Existing Code
- [x] Port serializers from `ts/example-reporter.ts` to `lib/src/serializers.ts`
  - **See detailed plan**: [`2025-12-09-json-serialization-layer.md`](./2025-12-09-json-serialization-layer.md)
- [ ] Create basic reporter skeleton in `lib/src/reporter.ts`

### Phase 3: WebSocket Client
- [ ] Implement `lib/src/websocket/client.ts` with:
  - Connection with auth header (`Authorization: Bearer {apiKey}`)
  - Reconnection with exponential backoff + jitter
  - Message queue for buffering
- [ ] Implement `lib/src/websocket/message-queue.ts`

### Phase 4: File Uploader
- [ ] Implement `lib/src/uploader/file-scanner.ts` - recursive scan with glob patterns
- [ ] Implement `lib/src/uploader/http-uploader.ts`:
  - Multipart form upload
  - Chunking for large files
  - Retry with exponential backoff
- [ ] Implement `lib/src/uploader/index.ts` - orchestrator with concurrency control

### Phase 5: Integration
- [ ] Wire everything together in `lib/src/reporter.ts`
- [ ] Update `lib/src/index.ts` with default export of reporter class
- [ ] Update `ts/playwright.config.ts` to use the new library

### Phase 6: Testing & Polish
- [ ] Test with local WebSocket server (`ts/ws.ts`)
- [ ] Add debug logging
- [ ] Write README

---

## Files to Modify/Create

| File | Action |
|------|--------|
| `ts/package.json` | Already exists - root package |
| `ts/tsconfig.json` | Already exists |
| `ts/lib/src/index.ts` | Exists - update to export reporter |
| `ts/lib/src/reporter.ts` | Create |
| `ts/lib/src/types.ts` | Exists |
| `ts/lib/src/serializers.ts` | Exists |
| `ts/lib/src/websocket/client.ts` | Create |
| `ts/lib/src/websocket/message-queue.ts` | Create |
| `ts/lib/src/uploader/index.ts` | Create |
| `ts/lib/src/uploader/file-scanner.ts` | Create |
| `ts/lib/src/uploader/http-uploader.ts` | Create |
| `ts/playwright.config.ts` | Modify (use new lib) |

---

## Reference Files

- `ts/example-reporter.ts` - Existing reporter to replace
- `ts/ws.ts` - Local WS server for testing (needs to be created)
- `ts/playwright.config.ts` - Current config pattern

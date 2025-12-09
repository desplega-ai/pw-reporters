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

```
ts/lib/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts              # Default export of reporter class
│   ├── reporter.ts           # Main Reporter implementation
│   ├── types.ts              # TypeScript interfaces
│   ├── serializers.ts        # Serialize Playwright objects (port from existing)
│   ├── websocket/
│   │   ├── client.ts         # WS client with reconnection
│   │   └── message-queue.ts  # Buffer during disconnection
│   └── uploader/
│       ├── index.ts          # Upload orchestrator
│       ├── file-scanner.ts   # Scan test-results/
│       └── http-uploader.ts  # HTTP upload with retry/chunking
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
- [ ] Create `ts/lib/` directory structure
- [ ] Set up `package.json` with tsup build, peer dependency on `@playwright/test`
- [ ] Create `tsconfig.json`
- [ ] Create `src/types.ts` with all interfaces

### Phase 2: Port Existing Code
- [ ] Port serializers from `ts/reporter.ts` to `src/serializers.ts`
  - **See detailed plan**: [`2025-12-09-json-serialization-layer.md`](./2025-12-09-json-serialization-layer.md)
- [ ] Create basic reporter skeleton in `src/reporter.ts`

### Phase 3: WebSocket Client
- [ ] Implement `src/websocket/client.ts` with:
  - Connection with auth header (`Authorization: Bearer {apiKey}`)
  - Reconnection with exponential backoff + jitter
  - Message queue for buffering
- [ ] Implement `src/websocket/message-queue.ts`

### Phase 4: File Uploader
- [ ] Implement `src/uploader/file-scanner.ts` - recursive scan with glob patterns
- [ ] Implement `src/uploader/http-uploader.ts`:
  - Multipart form upload
  - Chunking for large files
  - Retry with exponential backoff
- [ ] Implement `src/uploader/index.ts` - orchestrator with concurrency control

### Phase 5: Integration
- [ ] Wire everything together in `src/reporter.ts`
- [ ] Create `src/index.ts` with default export
- [ ] Update `ts/playwright.config.ts` to use the new library

### Phase 6: Testing & Polish
- [ ] Test with local WebSocket server (`ts/ws.ts`)
- [ ] Add debug logging
- [ ] Write README

---

## Files to Modify/Create

| File | Action |
|------|--------|
| `ts/lib/package.json` | Create |
| `ts/lib/tsconfig.json` | Create |
| `ts/lib/src/index.ts` | Create |
| `ts/lib/src/reporter.ts` | Create |
| `ts/lib/src/types.ts` | Create |
| `ts/lib/src/serializers.ts` | Create (port from ts/reporter.ts) |
| `ts/lib/src/websocket/client.ts` | Create |
| `ts/lib/src/websocket/message-queue.ts` | Create |
| `ts/lib/src/uploader/index.ts` | Create |
| `ts/lib/src/uploader/file-scanner.ts` | Create |
| `ts/lib/src/uploader/http-uploader.ts` | Create |
| `ts/playwright.config.ts` | Modify (use new lib) |

---

## Reference Files

- `ts/reporter.ts` - Existing serializers to port
- `ts/ws.ts` - Local WS server for testing
- `ts/playwright.config.ts` - Current config pattern

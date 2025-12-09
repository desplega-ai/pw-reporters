# @desplega.ai/playwright-reporter

A Playwright reporter that streams test events via WebSocket and uploads artifacts via HTTP.

## Installation

```bash
bun add @desplega.ai/playwright-reporter
```

## Usage

```typescript
// playwright.config.ts
import { defineConfig } from "@playwright/test";
import type { ReporterConfig } from "@desplega.ai/playwright-reporter";

export default defineConfig({
  reporter: [
    [
      "@desplega.ai/playwright-reporter",
      {
        apiKey: process.env.REPORTER_API_KEY,
        wsEndpoint: "wss://api.example.com/ws",
      } satisfies ReporterConfig,
    ],
  ],
});
```

## Configuration

```typescript
interface ReporterConfig {
  // Required
  apiKey: string; // API key for authentication
  wsEndpoint: string; // WebSocket endpoint (e.g., 'wss://api.example.com/ws')

  // Optional
  uploadEndpoint?: string; // HTTP endpoint for uploads (derived from wsEndpoint if not set)
  reconnect?: {
    enabled?: boolean; // Enable auto-reconnection (default: true)
    maxAttempts?: number; // Max reconnect attempts (default: 10)
    initialDelayMs?: number; // Initial delay (default: 1000)
    maxDelayMs?: number; // Max delay (default: 30000)
  };
  upload?: {
    enabled?: boolean; // Enable file uploads (default: true)
    parallel?: number; // Concurrent uploads (default: 3)
    chunkSizeMb?: number; // Chunk size for large files (default: 5)
    retries?: number; // Retry attempts per file (default: 3)
  };
  debug?: boolean; // Enable debug logging (default: false)
}
```

## Features

- **WebSocket streaming**: Real-time test events with automatic reconnection
- **Message buffering**: Events queued during disconnection, delivered on reconnect
- **Artifact uploads**: Screenshots, videos, and traces uploaded via HTTP
- **Chunked uploads**: Large files automatically split into chunks
- **Parallel uploads**: Configurable concurrency for faster uploads

## Events

The reporter sends the following events:

| Event         | Description                                            |
| ------------- | ------------------------------------------------------ |
| `onBegin`     | Test run started (includes config and suite structure) |
| `onTestBegin` | Individual test started                                |
| `onTestEnd`   | Individual test finished (includes result/status)      |
| `onStepBegin` | Test step started                                      |
| `onStepEnd`   | Test step finished                                     |
| `onError`     | Global error occurred                                  |
| `onStdOut`    | Test wrote to stdout                                   |
| `onStdErr`    | Test wrote to stderr                                   |
| `onEnd`       | Test run finished                                      |
| `onExit`      | Reporter exiting                                       |

## JSON Schema

Event types are available as a JSON schema:

```typescript
import schema from "@desplega.ai/playwright-reporter/schema.json";
```

## Development

### Test Server

A local WebSocket server is included for testing:

```bash
# Start the test server
bun ws.ts

# With summary file output
bun ws.ts --summary
```

The server provides:

- `ws://localhost:5555` - WebSocket endpoint
- `POST /upload` - File upload endpoint
- `POST /upload/chunk` - Chunked upload endpoint
- `GET /health` - Health check
- `GET /summary` - Current run summary

### Run Tests

```bash
# Run Playwright tests with the reporter
bun run pw:test
```

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
        // Config via env vars (recommended) or inline options
        // Env vars: DESPLEGA_ENDPOINT, DESPLEGA_API_KEY, DESPLEGA_SECURE, DESPLEGA_DEBUG
      } satisfies ReporterConfig,
    ],
  ],
});
```

## Configuration

Configuration can be set via environment variables (recommended) or inline options.
Environment variables take precedence over inline options.

### Environment Variables

```bash
# Base endpoint without protocol (default: localhost:5555)
DESPLEGA_ENDPOINT=api.desplega.ai

# API key for authentication
DESPLEGA_API_KEY=your-api-key

# Use secure connections - wss/https (default: true for non-localhost)
DESPLEGA_SECURE=true

# Enable debug logging (default: false)
DESPLEGA_DEBUG=false
```

### Inline Options

```typescript
interface ReporterConfig {
  endpoint?: string; // Base endpoint without protocol (e.g., 'api.desplega.ai')
  apiKey?: string; // API key for authentication
  secure?: boolean; // Use wss/https (default: true for non-localhost)
  debug?: boolean; // Enable debug logging (default: false)

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
}
```

All options are optional - configuration can come entirely from environment variables.

### Auto-derived Endpoints

From the base endpoint, the reporter derives:

- WebSocket: `ws[s]://{endpoint}/ws`
- Upload: `http[s]://{endpoint}/upload`
- Health: `http[s]://{endpoint}/health`

### Fail-safe Health Check

The reporter performs a health check at startup (default 3s timeout). If the server is unreachable, the reporter silently disables itself and tests continue normally.

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

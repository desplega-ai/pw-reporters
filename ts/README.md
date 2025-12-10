# @desplega.ai/playwright-reporter

A Playwright reporter that streams test events via WebSocket and uploads artifacts to the desplega.ai platform for real-time test monitoring and analysis.

## Installation

```bash
npm install @desplega.ai/playwright-reporter
# or
bun add @desplega.ai/playwright-reporter
```

## Quick Start

Add the reporter to your `playwright.config.ts`:

```typescript
import { defineConfig } from "@playwright/test";

export default defineConfig({
  reporter: [
    ["@desplega.ai/playwright-reporter"],
  ],
  // Enable these options to capture recordings, logs, and traces
  use: {
    trace: "on",
    video: "on",
    screenshot: "on",
  },
});
```

> **Note:** The reporter works without these options, but you won't have visibility into recordings, screenshots, or traces on the desplega.ai platform unless they are enabled.

Configure via environment variables:

```bash
export DESPLEGA_ENDPOINT="api.desplega.ai"
export DESPLEGA_API_KEY="your-api-key"
```

## Configuration

The reporter can be configured via environment variables or inline config. Environment variables take precedence.

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DESPLEGA_ENDPOINT` | Base endpoint (e.g., `api.desplega.ai/pw-reporter`) | `api.desplega.ai/pw-reporter` |
| `DESPLEGA_API_KEY` | API key for authentication | - |
| `DESPLEGA_SECURE` | Use secure connections (`true`/`false`) | `true` for non-localhost |
| `DESPLEGA_DEBUG` | Enable debug logging (`true`/`false`) | `false` |

### Inline Configuration

```typescript
import { defineConfig } from "@playwright/test";
import type { ReporterConfig } from "@desplega.ai/playwright-reporter";

export default defineConfig({
  reporter: [
    [
      "@desplega.ai/playwright-reporter",
      {
        endpoint: "api.desplega.ai/pw-reporter",
        apiKey: "your-api-key",
        secure: true,
        debug: false,
        reconnect: {
          enabled: true,
          maxAttempts: 10,
          initialDelayMs: 1000,
          maxDelayMs: 30000,
        },
        upload: {
          enabled: true,
          parallel: 3,
          chunkSizeMb: 5,
          retries: 3,
        },
      } satisfies ReporterConfig,
    ],
  ],
});
```

### Configuration Options

| Option | Type | Description |
|--------|------|-------------|
| `endpoint` | `string` | Base endpoint without protocol |
| `apiKey` | `string` | API key for authentication |
| `secure` | `boolean` | Use wss/https (default: true for non-localhost) |
| `debug` | `boolean` | Enable debug logging |
| `reconnect.enabled` | `boolean` | Enable auto-reconnection (default: true) |
| `reconnect.maxAttempts` | `number` | Max reconnection attempts (default: 10) |
| `reconnect.initialDelayMs` | `number` | Initial retry delay (default: 1000) |
| `reconnect.maxDelayMs` | `number` | Max retry delay (default: 30000) |
| `upload.enabled` | `boolean` | Enable file uploads (default: true) |
| `upload.parallel` | `number` | Parallel upload count (default: 3) |
| `upload.chunkSizeMb` | `number` | Chunk size for large files (default: 5) |
| `upload.retries` | `number` | Upload retry attempts (default: 3) |

## Features

- **Real-time streaming**: Test events sent via WebSocket as they occur
- **Automatic reconnection**: Resilient WebSocket connection with exponential backoff
- **Artifact uploads**: Screenshots, videos, and traces uploaded via HTTP
- **Health checks**: Reporter disables gracefully if server is unreachable
- **JSON serialization**: Converts Playwright's complex objects to JSON-safe structures

## Exported Types

The package exports serialized types for building custom integrations:

```typescript
import type {
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
  // Data types
  SerializedTestCase,
  SerializedTestResult,
  SerializedTestStep,
  SerializedSuite,
  SerializedConfig,
  SerializedProject,
  SerializedTestError,
  SerializedAttachment,
  SerializedAnnotation,
} from "@desplega.ai/playwright-reporter";
```

## Serializers

For building custom reporters or processing events:

```typescript
import {
  serializeTestCase,
  serializeTestResult,
  serializeTestStep,
  serializeSuite,
  serializeConfig,
  serializeProject,
  serializeFullResult,
  serializeTestError,
} from "@desplega.ai/playwright-reporter";
```

### Serialization Behavior

- **Date**: Converted to ISO 8601 string
- **Buffer**: Converted to UTF-8 string
- **RegExp**: Converted to source string
- **Methods**: Pre-computed (e.g., `titlePath()`, `ok()`, `outcome()`)
- **Circular refs**: Parent references omitted

## JSON Schema

The package includes a JSON schema for validating reporter events:

```typescript
import schema from "@desplega.ai/playwright-reporter/schema.json";
```

## License

MIT

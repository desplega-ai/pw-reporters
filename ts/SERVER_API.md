# Playwright Reporter Server API Specification

This document defines the backend contract required for the `@desplega.ai/playwright-reporter` to work.

## Overview

The server must provide:

1. **WebSocket endpoint** - for streaming real-time test events
2. **HTTP endpoints** - for file uploads (artifacts like screenshots, videos, traces)

## Authentication

All requests include an API key:

- **WebSocket**: Query parameter `?token={apiKey}`
- **HTTP**: Header `Authorization: Bearer {apiKey}`

---

## WebSocket Endpoint

### Connection

```
ws(s)://{host}/ws?token={apiKey}
```

The client connects immediately when the reporter is initialized and maintains the connection throughout the test run.

### Client → Server Messages

All messages are JSON with the following structure:

```typescript
{
  event: string;      // Event type (see below)
  timestamp: string;  // ISO 8601 timestamp
  runId: string;      // Unique run identifier (e.g., "run_1234567890_abc123")
  ...                 // Event-specific payload
}
```

#### Event Types

Refer to `ReporterEvent` union type in the JSON schema (`schemas/reporter-events.schema.json`).

| Event         | Schema Type        | Description                                                                                            |
| ------------- | ------------------ | ------------------------------------------------------------------------------------------------------ |
| `onBegin`     | `OnBeginEvent`     | Test run started. Contains full config (`SerializedConfig`) and root suite (`SerializedSuite`)         |
| `onTestBegin` | `OnTestBeginEvent` | Individual test started. Contains test case (`SerializedTestCase`) and result (`SerializedTestResult`) |
| `onTestEnd`   | `OnTestEndEvent`   | Individual test finished. Contains final test result with status                                       |
| `onStepBegin` | `OnStepBeginEvent` | Test step started. Contains step info (`SerializedTestStep`)                                           |
| `onStepEnd`   | `OnStepEndEvent`   | Test step finished. Contains step result                                                               |
| `onError`     | `OnErrorEvent`     | Global error occurred. Contains error (`SerializedTestError`)                                          |
| `onStdOut`    | `OnStdOutEvent`    | Test wrote to stdout                                                                                   |
| `onStdErr`    | `OnStdErrEvent`    | Test wrote to stderr                                                                                   |
| `onEnd`       | `OnEndEvent`       | Test run finished. Contains final result (`SerializedFullResult`)                                      |
| `onExit`      | `OnExitEvent`      | Reporter exiting (last event before disconnect)                                                        |

#### Heartbeat

The client sends periodic heartbeat pings:

```json
{ "type": "ping" }
```

### Server → Client Messages

#### Acknowledgment (optional but recommended)

```json
{ "type": "ack" }
```

#### Heartbeat Response

```json
{ "type": "pong" }
```

### Reconnection Behavior

The client implements automatic reconnection with exponential backoff:

- Initial delay: 1000ms
- Max delay: 30000ms
- Max attempts: 10 (configurable)
- Jitter: 0-25% added to delay

Messages sent during disconnection are queued and delivered on reconnect.

### Connection Close

The client closes the connection with code `1000` after sending `onExit`.

---

## HTTP Upload Endpoints

### Simple Upload

```
POST {uploadEndpoint}
Content-Type: multipart/form-data
Authorization: Bearer {apiKey}
```

#### Form Fields

| Field          | Type   | Description                                                            |
| -------------- | ------ | ---------------------------------------------------------------------- |
| `file`         | File   | The file content                                                       |
| `runId`        | string | Run identifier (matches WebSocket `runId`)                             |
| `relativePath` | string | Path relative to test-results/ (e.g., `test-name-base/screenshot.png`) |

#### Response

```json
{
  "success": true,
  "file": "test-name-base/screenshot.png",
  "size": 12345
}
```

### Chunked Upload

For files larger than the chunk size (default 5MB), the client splits the file and uploads chunks sequentially.

```
POST {uploadEndpoint}/chunk
Content-Type: multipart/form-data
Authorization: Bearer {apiKey}
```

#### Form Fields

| Field          | Type   | Description                       |
| -------------- | ------ | --------------------------------- |
| `file`         | File   | The chunk content                 |
| `runId`        | string | Run identifier                    |
| `relativePath` | string | Original file path                |
| `uploadId`     | string | Unique ID for this upload session |
| `chunkIndex`   | string | 0-based chunk index               |
| `totalChunks`  | string | Total number of chunks            |

#### Response

```json
{
  "success": true,
  "uploadId": "run_123_456_abc",
  "chunkIndex": 0,
  "totalChunks": 3,
  "received": 5242880
}
```

The server should reassemble chunks when all have been received.

---

## Endpoint URL Derivation

If `uploadEndpoint` is not explicitly configured, the client derives it from `wsEndpoint`:

| WebSocket Endpoint                  | Derived Upload Endpoint                   |
| ----------------------------------- | ----------------------------------------- |
| `ws://localhost:5555`               | `http://localhost:5555/upload`            |
| `wss://api.example.com/ws`          | `https://api.example.com/upload`          |
| `wss://api.example.com/reporter/ws` | `https://api.example.com/reporter/upload` |

---

## File Types

Common artifacts uploaded:

| File Type   | Content-Type      | Typical Size |
| ----------- | ----------------- | ------------ |
| Screenshots | `image/png`       | 50KB - 500KB |
| Videos      | `video/webm`      | 500KB - 10MB |
| Traces      | `application/zip` | 100KB - 5MB  |

---

## Error Handling

### HTTP Errors

The client retries failed uploads with exponential backoff (1s, 2s, 4s, up to 10s).

Expected error responses:

- `401 Unauthorized` - Invalid API key
- `400 Bad Request` - Missing required fields
- `500 Internal Server Error` - Server-side failure

### WebSocket Errors

On connection errors, the client attempts reconnection automatically. If max attempts are reached, messages remain queued but may be lost.

---

## JSON Schema

The full type definitions are available as a JSON schema:

```
ts/schemas/reporter-events.schema.json
```

Key types to implement server-side validation:

- `ReporterEvent` - Union of all event types
- `SerializedConfig` - Test configuration
- `SerializedSuite` - Test suite tree
- `SerializedTestCase` - Individual test
- `SerializedTestResult` - Test execution result
- `SerializedTestStep` - Step within a test
- `SerializedTestError` - Error details

---

## Example Server Implementation

See `ts/ws.ts` for a reference Bun server implementation that handles all the above endpoints.

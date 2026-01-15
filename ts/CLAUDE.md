# @desplega.ai/playwright-reporter

Playwright reporter that streams test events via WebSocket and uploads artifacts to desplega.ai.

## Quick Commands

```bash
bun install              # Install dependencies
bun test                 # Run unit tests (lib/src/)
bun run pw:test          # Run Playwright tests
bun run typecheck        # TypeScript validation
bun run build            # Build for publishing
bun run format           # Format with Prettier
```

## Architecture

```
lib/src/
  reporter.ts       # Main Reporter class implementing Playwright's Reporter interface
  serializers.ts    # Convert Playwright objects to JSON-safe structures
  types.ts          # TypeScript type definitions
  websocket/        # WebSocket client with reconnection & message queue
  http/             # HTTP transport for batched events
  uploader/         # File upload for screenshots, videos, traces
schemas/            # JSON schema generated from types.ts
examples/tests/     # Sample Playwright tests for development
```

## Key Concepts

- **Events**: Reporter emits events (onBegin, onTestBegin, onTestEnd, etc.) - see `ReporterEvent` union in types.ts
- **Serializers**: Playwright objects contain circular refs & methods - serializers produce JSON-safe versions
- **Transport**: WebSocket for real-time events, HTTP for artifacts (chunked upload for large files)
- **Config**: Via env vars (DESPLEGA_ENDPOINT, DESPLEGA_API_KEY) or inline config in playwright.config.ts

## Testing

- `bun test` - Unit tests for serializers, git helpers, etc.
- `bun run pw:test` - E2E tests using the reporter with a mock server
- `bun run e2e:test` - Full E2E test harness (e2e-test.ts)

## Code Style

- Uses Prettier (run `bun run format:check` before committing)
- TypeScript strict mode
- Bun runtime (not Node.js) - use Bun APIs where possible

## Publishing

```bash
npm version patch && bun publish --access public
```

## Related Docs

- README.md - User-facing documentation and config options
- SERVER_API.md - Backend contract (WebSocket events, HTTP upload endpoints)
- CONTRIBUTING.md - Development setup and publish workflow

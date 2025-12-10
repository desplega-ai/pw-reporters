# Contributing

## Development Setup

```bash
# Install dependencies
bun install

# Run library tests
bun test

# Run Playwright tests
bun run pw:test

# Type check
bun run typecheck

# Format code
bun run format

# Build library for publishing
bun run build
```

## Project Structure

```
lib/src/
  index.ts          # Package exports
  reporter.ts       # Main Playwright reporter implementation
  types.ts          # Serialized type definitions
  serializers.ts    # Serialization functions
  websocket/        # WebSocket client for event streaming
  uploader/         # HTTP file uploader for artifacts
examples/
  tests/            # Example Playwright tests for development
schemas/
  reporter-events.schema.json  # JSON schema for event validation
```

## Available Scripts

| Script | Description |
|--------|-------------|
| `bun test` | Run library unit tests |
| `bun run pw:test` | Run Playwright tests |
| `bun run pw:test:ui` | Run Playwright with UI mode |
| `bun run pw:test:headed` | Run Playwright in headed mode |
| `bun run typecheck` | Run TypeScript type checking |
| `bun run format` | Format code with Prettier |
| `bun run build` | Build library for publishing |
| `bun run e2e:test` | Run end-to-end tests |
| `bun run generate-schema` | Regenerate JSON schema from types |

## Publishing

### Prerequisites

1. Authenticate with npm registry:

   ```bash
   bun login
   ```

   Or set `NPM_CONFIG_TOKEN` environment variable for CI/CD.

2. Ensure you have access to the `@desplega.ai` scope.

### Publish Commands

```bash
# Dry run (verify what will be published)
bun publish --dry-run

# Publish to npm
bun publish --access public

# Publish with specific tag (e.g., beta)
bun publish --access public --tag beta

# If re-running in CI and version already exists
bun publish --access public --tolerate-republish
```

### Version Bumping

Before publishing a new version, update the version in `package.json`:

```bash
# Patch release (0.1.0 -> 0.1.1)
npm version patch

# Minor release (0.1.0 -> 0.2.0)
npm version minor

# Major release (0.1.0 -> 1.0.0)
npm version major
```

### Publish Checklist

1. [ ] Run tests: `bun test`
2. [ ] Type check: `bun run typecheck`
3. [ ] Build: `bun run build`
4. [ ] Bump version: `npm version <patch|minor|major>`
5. [ ] Dry run: `bun publish --dry-run`
6. [ ] Publish: `bun publish --access public`

## Environment Variables

Create a `.env` file based on `.env.example`:

```bash
cp .env.example .env
```

Configure the following for local development:

| Variable | Description |
|----------|-------------|
| `DESPLEGA_ENDPOINT` | Server endpoint (default: `api.desplega.ai/pw-reporter`) |
| `DESPLEGA_API_KEY` | API key for authentication |
| `DESPLEGA_SECURE` | Use secure connections (`false` for local) |
| `DESPLEGA_DEBUG` | Enable debug logging (`true` for development) |

# @desplega.ai/playwright-reporter

JSON serialization layer for Playwright reporter types. Converts Playwright's runtime objects (with Dates, Buffers, circular refs, methods) into JSON-safe structures suitable for WebSocket streaming.

## Installation

```bash
bun add @desplega.ai/playwright-reporter
```

## Usage

```typescript
import {
  serializeTestCase,
  serializeTestResult,
  serializeSuite,
  serializeConfig,
} from "@desplega.ai/playwright-reporter";

// In your Playwright reporter
class MyReporter {
  onTestEnd(test, result) {
    const serializedTest = serializeTestCase(test);
    const serializedResult = serializeTestResult(result);
    // Send via WebSocket, HTTP, etc.
  }
}
```

## Serialization Features

- **Date → ISO 8601 string**: All timestamps converted to strings
- **Buffer → UTF-8 string**: stdout/stderr converted to strings
- **RegExp → source string**: grep patterns converted to strings
- **Methods → pre-computed**: `titlePath()`, `ok()`, `outcome()` called and stored
- **Circular refs → omitted**: `parent` references removed

## Available Exports

### Types

- `SerializedTestCase`, `SerializedTestResult`, `SerializedTestStep`
- `SerializedSuite`, `SerializedConfig`, `SerializedProject`
- `SerializedTestError`, `SerializedAttachment`, `SerializedAnnotation`
- `ReporterEvent` (union of all event types)

### Serializers

- `serializeTestCase(test)` - Serialize a TestCase
- `serializeTestResult(result)` - Serialize a TestResult
- `serializeTestStep(step)` - Serialize a TestStep
- `serializeSuite(suite)` - Serialize a Suite
- `serializeConfig(config)` - Serialize FullConfig
- `serializeProject(project)` - Serialize FullProject
- `serializeFullResult(result)` - Serialize FullResult
- `serializeTestError(error)` - Serialize TestError

### Utilities

- `serializeDate(date)` - Convert Date to ISO string
- `serializeBuffer(buffer)` - Convert Buffer to string
- `serializeRegExp(pattern)` - Convert RegExp to source string
- `serializeRegExpArray(patterns)` - Convert RegExp array to string array

## Development

```bash
# Install dependencies
bun install

# Run library tests
bun test

# Run Playwright tests
bun run pw:test

# Type check
bun run typecheck

# Build library for publishing
bun run build
```

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

## License

MIT

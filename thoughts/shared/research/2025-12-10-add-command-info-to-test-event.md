---
date: 2025-12-10T12:00:00-08:00
researcher: Claude
git_commit: 585ae601c498c15e1fa46914e78f9ddc15fe66a2
branch: main
repository: pw-examples
topic: "Adding Command-Line Information to Test Start Event"
tags: [research, codebase, reporter, events, cli]
status: complete
last_updated: 2025-12-10
last_updated_by: Claude
last_updated_note: "Added decisions for sanitization and env var whitelist approach"
---

# Research: Adding Command-Line Information to Test Start Event

**Date**: 2025-12-10T12:00:00-08:00
**Researcher**: Claude
**Git Commit**: 585ae601c498c15e1fa46914e78f9ddc15fe66a2
**Branch**: main
**Repository**: pw-examples

## Research Question

How to pass information about the command that was ran (e.g. `pw test <flags...> <opts...>`) in the test start event, following the same safe pattern used for git info.

## Summary

Playwright's `FullConfig` does **not** expose raw command-line arguments. To capture the command that was run, we need to read `process.argv` directly. The pattern established by the git info implementation provides a clear template for safely adding this information to `OnBeginEvent`.

## Detailed Findings

### Current Event Structure

The `OnBeginEvent` is defined in `lib/src/types.ts:242-248`:

```typescript
export interface OnBeginEvent extends BaseEvent {
  event: "onBegin";
  config: SerializedConfig;
  suite: SerializedSuite;
  git: SerializedGitInfo | null;
}
```

### What FullConfig Provides

From `lib/src/reporter.ts:289`, the `onBegin()` receives `config: FullConfig` which includes:

- `configFile`: Path to playwright config file
- `rootDir`, `version`, `workers`
- `metadata`: Arbitrary key-value object
- `grep`, `grepInvert`: Filter patterns
- `shard`: Sharding configuration `{ total, current }`
- `projects`: Array of project configs

**Key limitation**: `FullConfig` does NOT include raw command-line arguments like `--grep`, `--project`, `--shard`, etc.

### Accessing Command-Line Arguments

To capture the actual command run, we need to use `process.argv`:

```typescript
// Example process.argv when running:
// npx playwright test --project=chromium --grep="login" --shard=1/4
[
  '/path/to/node',
  '/path/to/playwright',
  'test',
  '--project=chromium',
  '--grep=login',
  '--shard=1/4'
]
```

### Existing Pattern: Git Info Implementation

The git info implementation in `lib/src/git.ts` provides the template:

1. **Utility module** (`lib/src/git.ts:73-130`):
   - Async function that safely gathers info
   - Returns `null` if unavailable (no errors thrown)
   - Parallel execution for performance

2. **Type definition** (`lib/src/types.ts:206-227`):
   - `SerializedGitInfo` interface with all fields documented

3. **Integration in reporter** (`lib/src/reporter.ts:308-319`):
   - Call utility function
   - Log the result for debugging
   - Include in event

### Recommended Implementation Approach

Following the git info pattern, create:

#### 1. Command Info Utility (`lib/src/command.ts`)

```typescript
export interface CommandInfo {
  /** Full command line as array (process.argv) */
  argv: string[];
  /** Reconstructed command string */
  command: string;
  /** Node.js executable path */
  nodeExecutable: string;
  /** Script path (playwright runner) */
  scriptPath: string;
  /** Arguments after 'test' command */
  testArgs: string[];
}

export function getCommandInfo(): CommandInfo {
  const argv = process.argv;
  const nodeExecutable = argv[0] ?? '';
  const scriptPath = argv[1] ?? '';

  // Find 'test' command and extract args after it
  const testIndex = argv.indexOf('test');
  const testArgs = testIndex >= 0 ? argv.slice(testIndex + 1) : [];

  return {
    argv,
    command: argv.join(' '),
    nodeExecutable,
    scriptPath,
    testArgs,
  };
}
```

#### 2. Type in `types.ts`

```typescript
export interface SerializedCommandInfo {
  /** Full command line as array */
  argv: string[];
  /** Reconstructed command string */
  command: string;
  /** Node.js executable path */
  nodeExecutable: string;
  /** Script path */
  scriptPath: string;
  /** Arguments after 'test' command */
  testArgs: string[];
}
```

#### 3. Update OnBeginEvent

```typescript
export interface OnBeginEvent extends BaseEvent {
  event: "onBegin";
  config: SerializedConfig;
  suite: SerializedSuite;
  git: SerializedGitInfo | null;
  command: SerializedCommandInfo;  // Always available
}
```

### Key Differences from Git Info

| Aspect | Git Info | Command Info |
|--------|----------|--------------|
| Can fail | Yes (not in repo) | No (always available) |
| Return type | `GitInfo \| null` | `CommandInfo` |
| Async | Yes (shell commands) | No (synchronous) |
| Performance | Multiple git commands | Single property access |

### Security Considerations

The command may contain sensitive information:
- API keys passed via `--env`
- Authentication tokens
- File paths revealing system structure

Consider:
- Sanitizing known sensitive flags
- Allowing configuration to disable command capture
- Only capturing test-relevant flags

## Code References

- `lib/src/reporter.ts:289-329` - `onBegin()` implementation
- `lib/src/types.ts:242-248` - `OnBeginEvent` interface
- `lib/src/types.ts:172-192` - `SerializedConfig` interface
- `lib/src/git.ts:73-130` - `getGitInfo()` implementation
- `lib/src/git.ts:52-59` - `execGit()` helper pattern

## Architecture Documentation

The reporter follows an event-driven architecture:
1. Playwright lifecycle hooks trigger event creation
2. Events are serialized to JSON-safe structures
3. Events sent via WebSocket to backend
4. Utilities gather additional context (git, command)

## Related Research

- `thoughts/shared/plans/2025-12-10-add-git-info-to-test-start.md` - Implementation plan for git info (model for this feature)

## Decisions

1. **Command capture enabled by default** - Always capture command info, no opt-out needed
2. **Sanitize sensitive arguments** - Filter out known sensitive flags (API keys, tokens, passwords)
3. **Environment variables via whitelist** - Only send known safe env vars by default, allow configuration to extend the whitelist

### Sanitization Strategy

**CLI Arguments to Sanitize** (redact values, keep flag names):
- `--env` values containing `KEY`, `TOKEN`, `SECRET`, `PASSWORD`, `CREDENTIAL`
- Any flag with `password`, `secret`, `token`, `key`, `auth` in the name

**Default Environment Variable Whitelist** (safe to send):
- `CI`, `CI_*` - CI system detection
- `NODE_ENV`, `NODE_VERSION`
- `PLAYWRIGHT_*` (except `*_KEY`, `*_TOKEN`, `*_SECRET`)
- `PW_*` (except `*_KEY`, `*_TOKEN`, `*_SECRET`)
- `GITHUB_ACTIONS`, `GITHUB_REF`, `GITHUB_SHA`, `GITHUB_REPOSITORY`
- `GITLAB_CI`, `CI_COMMIT_*`, `CI_PROJECT_*`
- `JENKINS_*` (non-sensitive)
- `BUILD_*`, `BUILD_NUMBER`

**Configurable Extension**:
```typescript
// In reporter config
command?: {
  /** Additional env vars to include (added to default whitelist) */
  includeEnvVars?: string[];
  /** Env var patterns to exclude (overrides whitelist) */
  excludeEnvVars?: string[];
}
```

## External References

- [Playwright FullConfig API](https://playwright.dev/docs/api/class-fullconfig) - Documents available config properties
- [Playwright Command Line](https://playwright.dev/docs/test-cli) - Available CLI options
- [GitHub Issue #21294](https://github.com/microsoft/playwright/issues/21294) - Discussion on passing parameters to config

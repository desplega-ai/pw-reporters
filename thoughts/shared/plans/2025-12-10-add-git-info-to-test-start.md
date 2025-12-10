# Add Git Information to Test Start Event - Implementation Plan

## Overview

Add extended git repository information to the `OnBeginEvent` when tests start. This will help track which code version/branch was being tested. The implementation must be safe - if git is not available or the directory is not a git repository, it should be a no-op (no errors, just null/undefined git info).

## Current State Analysis

- `OnBeginEvent` is sent in `lib/src/reporter.ts:307-313` during `onBegin()`
- Event types are defined in `lib/src/types.ts`
- Serialization functions are in `lib/src/serializers.ts`
- No git utilities currently exist in the project

### Key Files:

- `lib/src/reporter.ts:288-314` - `onBegin()` hook where event is created
- `lib/src/types.ts:216-220` - `OnBeginEvent` interface
- `lib/src/serializers.ts` - Serialization utilities

## Desired End State

When tests begin, the `OnBeginEvent` will include a `git` field containing:

- Branch name
- Commit SHA (full and short)
- Commit message (subject line)
- Author name and email
- Commit timestamp
- Tags pointing to current commit
- Remote origin URL (sanitized to remove credentials)
- Dirty status (whether working directory has uncommitted changes)

If git is not available or the project is not a git repo, the `git` field will be `null`.

### Verification:

- Run tests in a git repo → `git` field should be populated
- Run tests in a non-git directory → `git` field should be `null`, no errors
- Unit tests for git utility functions

## What We're NOT Doing

- Not making git info configurable (always collected if available)
- Not collecting detailed file-level changes or diffs
- Not storing git credentials (URL sanitization)
- Not blocking test execution if git commands fail

## Implementation Approach

1. Create a git utility module that safely executes git commands
2. Add new types for serialized git info
3. Update `OnBeginEvent` to include optional git field
4. Gather git info in `onBegin()` and include in event

## Phase 1: Create Git Utility Module

### Overview

Create a new utility module that safely retrieves git information using shell commands.

### Changes Required:

#### 1. Create `lib/src/git.ts`

**File**: `lib/src/git.ts` (new file)
**Purpose**: Safe git information retrieval

```typescript
import { $ } from "bun";

/**
 * Git repository information
 */
export interface GitInfo {
  /** Current branch name (e.g., "main", "feature/foo") */
  branch: string;
  /** Full commit SHA (40 characters) */
  commitSha: string;
  /** Short commit SHA (7 characters) */
  commitShaShort: string;
  /** Commit message subject line */
  commitMessage: string;
  /** Commit author name */
  authorName: string;
  /** Commit author email */
  authorEmail: string;
  /** Commit timestamp in ISO 8601 format */
  commitTimestamp: string;
  /** Tags pointing to current commit (empty array if none) */
  tags: string[];
  /** Remote origin URL (sanitized - no credentials) */
  remoteOrigin: string | null;
  /** Whether working directory has uncommitted changes */
  isDirty: boolean;
}

/**
 * Sanitize a git remote URL to remove any embedded credentials
 * e.g., https://user:pass@github.com/repo.git -> https://github.com/repo.git
 */
function sanitizeRemoteUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.username = "";
    parsed.password = "";
    return parsed.toString();
  } catch {
    // Not a valid URL (might be SSH format like git@github.com:user/repo.git)
    // SSH URLs don't have credentials embedded the same way, return as-is
    return url;
  }
}

/**
 * Execute a git command and return the trimmed output, or null if it fails
 */
async function execGit(args: string[]): Promise<string | null> {
  try {
    const result = await $`git ${args}`.quiet().text();
    return result.trim();
  } catch {
    return null;
  }
}

/**
 * Check if the current directory is inside a git repository
 */
export async function isGitRepo(): Promise<boolean> {
  const result = await execGit(["rev-parse", "--is-inside-work-tree"]);
  return result === "true";
}

/**
 * Get git repository information safely.
 * Returns null if git is not available or directory is not a git repo.
 */
export async function getGitInfo(): Promise<GitInfo | null> {
  // First check if we're in a git repo
  if (!(await isGitRepo())) {
    return null;
  }

  // Gather all git info in parallel for performance
  const [
    branch,
    commitSha,
    commitMessage,
    authorName,
    authorEmail,
    commitTimestamp,
    tagsRaw,
    remoteOriginRaw,
    statusPorcelain,
  ] = await Promise.all([
    execGit(["rev-parse", "--abbrev-ref", "HEAD"]),
    execGit(["rev-parse", "HEAD"]),
    execGit(["log", "-1", "--format=%s"]),
    execGit(["log", "-1", "--format=%an"]),
    execGit(["log", "-1", "--format=%ae"]),
    execGit(["log", "-1", "--format=%aI"]), // ISO 8601 format
    execGit(["tag", "--points-at", "HEAD"]),
    execGit(["config", "--get", "remote.origin.url"]),
    execGit(["status", "--porcelain"]),
  ]);

  // If we couldn't get basic info, return null
  if (!branch || !commitSha) {
    return null;
  }

  // Parse tags (newline-separated, may be empty)
  const tags = tagsRaw ? tagsRaw.split("\n").filter(Boolean) : [];

  // Sanitize remote URL
  const remoteOrigin = remoteOriginRaw
    ? sanitizeRemoteUrl(remoteOriginRaw)
    : null;

  // Check if dirty (any output from porcelain status means changes)
  const isDirty = statusPorcelain !== null && statusPorcelain.length > 0;

  return {
    branch,
    commitSha,
    commitShaShort: commitSha.slice(0, 7),
    commitMessage: commitMessage ?? "",
    authorName: authorName ?? "",
    authorEmail: authorEmail ?? "",
    commitTimestamp: commitTimestamp ?? "",
    tags,
    remoteOrigin,
    isDirty,
  };
}
```

### Success Criteria:

#### Automated Verification:

- [x] TypeScript compiles without errors: `bun build lib/src/git.ts`
- [x] Unit tests pass: `bun test lib/src/git.test.ts`

#### Manual Verification:

- [ ] Running in git repo returns populated GitInfo
- [ ] Running in non-git directory returns null without errors

---

## Phase 2: Add Types for Serialized Git Info

### Overview

Add the `SerializedGitInfo` type and update `OnBeginEvent` to include optional git field.

### Changes Required:

#### 1. Update `lib/src/types.ts`

**File**: `lib/src/types.ts`
**Changes**: Add `SerializedGitInfo` interface and update `OnBeginEvent`

Add after `SerializedFullResult` (around line 201):

```typescript
/**
 * Git repository information at time of test run
 */
export interface SerializedGitInfo {
  /** Current branch name */
  branch: string;
  /** Full commit SHA */
  commitSha: string;
  /** Short commit SHA (7 chars) */
  commitShaShort: string;
  /** Commit message subject line */
  commitMessage: string;
  /** Commit author name */
  authorName: string;
  /** Commit author email */
  authorEmail: string;
  /** Commit timestamp (ISO 8601) */
  commitTimestamp: string;
  /** Tags pointing to current commit */
  tags: string[];
  /** Remote origin URL (sanitized) */
  remoteOrigin: string | null;
  /** Whether working directory has uncommitted changes */
  isDirty: boolean;
}
```

Update `OnBeginEvent` (around line 216-220):

```typescript
export interface OnBeginEvent extends BaseEvent {
  event: "onBegin";
  config: SerializedConfig;
  suite: SerializedSuite;
  /** Git repository info, null if not in a git repo */
  git: SerializedGitInfo | null;
}
```

### Success Criteria:

#### Automated Verification:

- [x] TypeScript compiles without errors
- [x] Existing serializer tests still pass: `bun test lib/src/serializers.test.ts`

---

## Phase 3: Update Reporter to Include Git Info

### Overview

Modify the reporter's `onBegin()` method to gather git info and include it in the event.

### Changes Required:

#### 1. Update `lib/src/reporter.ts`

**File**: `lib/src/reporter.ts`
**Changes**: Import git utility and use it in `onBegin()`

Add import at top:

```typescript
import { getGitInfo, type GitInfo } from "./git";
```

Update `onBegin()` method (around line 288-314):

```typescript
async onBegin(config: FullConfig, suite: Suite): Promise<void> {
  // Extract outputDir from first project (all projects typically share the same outputDir)
  const firstProject = config.projects[0];
  if (firstProject) {
    this.outputDir = firstProject.outputDir;
    this.log("Output directory:", this.outputDir);
  }

  // Perform health check before initializing
  const healthy = await this.performHealthCheck();
  if (!healthy) {
    this.disabled = true;
    this.log("Reporter disabled due to failed health check");
    return;
  }

  // Initialize WebSocket and uploader after health check passes
  this.initialize();

  // Gather git info (safe - returns null if not in git repo)
  const gitInfo = await getGitInfo();
  if (gitInfo) {
    this.log("Git info:", gitInfo.branch, gitInfo.commitShaShort, gitInfo.isDirty ? "(dirty)" : "");
  } else {
    this.log("Git info: not available (not a git repo or git not installed)");
  }

  const event: OnBeginEvent = {
    ...this.createBaseEvent("onBegin"),
    event: "onBegin",
    config: serializeConfig(config),
    suite: serializeSuite(suite),
    git: gitInfo,
  };
  this.sendEvent(event);
}
```

### Success Criteria:

#### Automated Verification:

- [x] TypeScript compiles without errors: `bun build lib/src/reporter.ts`
- [x] E2E test passes: `bun e2e-test.ts`

#### Manual Verification:

- [ ] Run tests with `DESPLEGA_DEBUG=true` and verify git info is logged
- [ ] Verify `OnBeginEvent` in WebSocket output contains git field

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation that the git info appears correctly in the test events.

---

## Phase 4: Add Unit Tests

### Overview

Add unit tests for the git utility functions.

### Changes Required:

#### 1. Create `lib/src/git.test.ts`

**File**: `lib/src/git.test.ts` (new file)

```typescript
import { test, expect, describe } from "bun:test";
import { getGitInfo, isGitRepo } from "./git";

describe("git utilities", () => {
  test("isGitRepo returns true in a git repository", async () => {
    // This test file is in a git repo
    const result = await isGitRepo();
    expect(result).toBe(true);
  });

  test("getGitInfo returns info in a git repository", async () => {
    const info = await getGitInfo();

    // Should return info since we're in a git repo
    expect(info).not.toBeNull();

    if (info) {
      // Branch should be a non-empty string
      expect(typeof info.branch).toBe("string");
      expect(info.branch.length).toBeGreaterThan(0);

      // Commit SHA should be 40 characters
      expect(info.commitSha).toMatch(/^[a-f0-9]{40}$/);

      // Short SHA should be 7 characters
      expect(info.commitShaShort).toMatch(/^[a-f0-9]{7}$/);
      expect(info.commitShaShort).toBe(info.commitSha.slice(0, 7));

      // isDirty should be a boolean
      expect(typeof info.isDirty).toBe("boolean");

      // Tags should be an array
      expect(Array.isArray(info.tags)).toBe(true);

      // Remote origin can be null or string
      expect(
        info.remoteOrigin === null || typeof info.remoteOrigin === "string",
      ).toBe(true);
    }
  });

  test("sanitizes URLs with credentials", async () => {
    const info = await getGitInfo();

    if (info?.remoteOrigin) {
      // Should not contain credentials
      expect(info.remoteOrigin).not.toMatch(/:.*@/);
    }
  });
});
```

### Success Criteria:

#### Automated Verification:

- [x] All git tests pass: `bun test lib/src/git.test.ts`
- [x] All existing tests still pass: `bun test lib/src/`

---

## Testing Strategy

### Unit Tests:

- `isGitRepo()` returns true in git repo
- `getGitInfo()` returns populated object in git repo
- URL sanitization removes credentials
- All fields have expected types and formats

### Integration Tests:

- E2E test verifies `OnBeginEvent` is sent with git field
- Git field is `null` when running outside git repo (manual test)

### Manual Testing Steps:

1. Run `DESPLEGA_DEBUG=true bun e2e-test.ts` and verify git info is logged
2. Check WebSocket output for `OnBeginEvent` with populated `git` field
3. Test in non-git directory to ensure graceful fallback to `null`

## Performance Considerations

- Git commands are executed in parallel using `Promise.all()` to minimize latency
- Git info is gathered once at test start, not for each test
- If git is not available, we fail fast on `isGitRepo()` check

## References

- Current reporter implementation: `lib/src/reporter.ts:288-314`
- Event types: `lib/src/types.ts:216-220`
- Bun shell documentation: `node_modules/bun-types/docs/`

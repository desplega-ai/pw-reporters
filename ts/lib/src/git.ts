import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

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
    const { stdout } = await execAsync(`git ${args.join(" ")}`);
    return stdout.trim();
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

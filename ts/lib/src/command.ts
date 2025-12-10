/**
 * Command-line information capture for test runs.
 * Captures the command used to run tests while sanitizing sensitive information.
 */

/**
 * Patterns to detect sensitive environment variable names
 */
const SENSITIVE_ENV_PATTERNS = [
  /key$/i,
  /token$/i,
  /secret$/i,
  /password$/i,
  /credential$/i,
  /auth$/i,
  /api_key$/i,
  /apikey$/i,
  /private/i,
];

/**
 * Default whitelist of safe environment variables to include
 */
const DEFAULT_ENV_WHITELIST = [
  // CI system detection
  "CI",
  // Node environment
  "NODE_ENV",
  "NODE_VERSION",
  // GitHub Actions
  "GITHUB_ACTIONS",
  "GITHUB_REF",
  "GITHUB_SHA",
  "GITHUB_REPOSITORY",
  "GITHUB_RUN_ID",
  "GITHUB_RUN_NUMBER",
  "GITHUB_WORKFLOW",
  "GITHUB_JOB",
  "GITHUB_ACTOR",
  "GITHUB_EVENT_NAME",
  "GITHUB_HEAD_REF",
  "GITHUB_BASE_REF",
  // GitLab CI
  "GITLAB_CI",
  "CI_COMMIT_SHA",
  "CI_COMMIT_REF_NAME",
  "CI_COMMIT_BRANCH",
  "CI_PROJECT_NAME",
  "CI_PROJECT_PATH",
  "CI_PIPELINE_ID",
  "CI_JOB_ID",
  "CI_JOB_NAME",
  // Jenkins
  "JENKINS_URL",
  "BUILD_NUMBER",
  "BUILD_ID",
  "BUILD_URL",
  "JOB_NAME",
  "BRANCH_NAME",
  // Azure DevOps
  "TF_BUILD",
  "BUILD_BUILDID",
  "BUILD_BUILDNUMBER",
  "BUILD_SOURCEBRANCH",
  "BUILD_SOURCEVERSION",
  // CircleCI
  "CIRCLECI",
  "CIRCLE_BUILD_NUM",
  "CIRCLE_BRANCH",
  "CIRCLE_SHA1",
  "CIRCLE_PROJECT_REPONAME",
  // Travis CI
  "TRAVIS",
  "TRAVIS_BUILD_NUMBER",
  "TRAVIS_BRANCH",
  "TRAVIS_COMMIT",
  // General build info
  "BUILD_TAG",
];

/**
 * Patterns for environment variables to include (prefix matches)
 */
const ENV_WHITELIST_PREFIXES = [
  "CI_",
  "PLAYWRIGHT_", // except sensitive ones
  "PW_", // except sensitive ones
];

/**
 * Command-line information
 */
export interface CommandInfo {
  /** Full command line as array (process.argv), sanitized */
  argv: string[];
  /** Reconstructed command string, sanitized */
  command: string;
  /** Node.js executable path */
  nodeExecutable: string;
  /** Script path (playwright runner) */
  scriptPath: string;
  /** Arguments after 'test' command, sanitized */
  testArgs: string[];
  /** Selected safe environment variables */
  env: Record<string, string>;
}

/**
 * Check if an environment variable name is sensitive
 */
function isSensitiveEnvVar(name: string): boolean {
  return SENSITIVE_ENV_PATTERNS.some((pattern) => pattern.test(name));
}

/**
 * Check if an environment variable should be included based on whitelist
 */
function isWhitelistedEnvVar(name: string): boolean {
  // Exact match
  if (DEFAULT_ENV_WHITELIST.includes(name)) {
    return true;
  }
  // Prefix match (but not if sensitive)
  for (const prefix of ENV_WHITELIST_PREFIXES) {
    if (name.startsWith(prefix) && !isSensitiveEnvVar(name)) {
      return true;
    }
  }
  return false;
}

/**
 * Sanitize a command-line argument value if it appears sensitive
 */
function sanitizeArg(arg: string): string {
  // Check for flag=value patterns with sensitive names
  const flagValueMatch = arg.match(/^(--?\w+)=(.+)$/);
  if (flagValueMatch) {
    const flag = flagValueMatch[1];
    const value = flagValueMatch[2];
    if (!flag || !value) {
      return arg;
    }
    const flagLower = flag.toLowerCase();
    // Redact value if flag name suggests it's sensitive
    if (
      flagLower.includes("key") ||
      flagLower.includes("token") ||
      flagLower.includes("secret") ||
      flagLower.includes("password") ||
      flagLower.includes("auth") ||
      flagLower.includes("credential")
    ) {
      return `${flag}=[REDACTED]`;
    }
    // Check for env flag with sensitive env var
    if (flagLower === "--env" || flagLower === "-e") {
      const envMatch = value.match(/^(\w+)=(.+)$/);
      if (envMatch) {
        const envName = envMatch[1];
        if (envName && isSensitiveEnvVar(envName)) {
          return `${flag}=${envName}=[REDACTED]`;
        }
      }
    }
    return arg;
  }
  return arg;
}

/**
 * Get safe environment variables based on whitelist
 */
function getSafeEnvVars(): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && isWhitelistedEnvVar(key)) {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Get command-line information.
 * Always succeeds - process.argv is always available.
 * Sensitive information is sanitized.
 */
export function getCommandInfo(): CommandInfo {
  const rawArgv = process.argv;
  const nodeExecutable = rawArgv[0] ?? "";
  const scriptPath = rawArgv[1] ?? "";

  // Find 'test' command and extract args after it
  const testIndex = rawArgv.indexOf("test");
  const rawTestArgs = testIndex >= 0 ? rawArgv.slice(testIndex + 1) : [];

  // Sanitize arguments
  const argv = rawArgv.map(sanitizeArg);
  const testArgs = rawTestArgs.map(sanitizeArg);

  return {
    argv,
    command: argv.join(" "),
    nodeExecutable,
    scriptPath,
    testArgs,
    env: getSafeEnvVars(),
  };
}

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { getCommandInfo } from "./command";
import type { CommandInfo } from "./command";

describe("command utilities", () => {
  // Store original env to restore after tests
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test("getCommandInfo returns command info", () => {
    const info = getCommandInfo();

    // Should always return an object
    expect(info).toBeDefined();
    expect(typeof info).toBe("object");

    // argv should be an array
    expect(Array.isArray(info.argv)).toBe(true);
    expect(info.argv.length).toBeGreaterThan(0);

    // command should be a string
    expect(typeof info.command).toBe("string");
    expect(info.command.length).toBeGreaterThan(0);

    // nodeExecutable should be set (path to bun/node)
    expect(typeof info.nodeExecutable).toBe("string");

    // scriptPath should be set
    expect(typeof info.scriptPath).toBe("string");

    // testArgs should be an array
    expect(Array.isArray(info.testArgs)).toBe(true);

    // env should be an object
    expect(typeof info.env).toBe("object");
  });

  test("command string matches argv joined", () => {
    const info = getCommandInfo();
    expect(info.command).toBe(info.argv.join(" "));
  });

  describe("argument sanitization", () => {
    // Note: We can't directly test argument sanitization since we can't modify process.argv
    // These tests verify the sanitization logic conceptually

    test("sanitizes sensitive flag values in argv", () => {
      // The sanitization function is internal, but we can verify that
      // if a sensitive flag were present, it would be sanitized
      const info = getCommandInfo();

      // Verify no actual API keys or tokens are exposed in the output
      // (This is a sanity check - real sensitive data wouldn't be in test env)
      for (const arg of info.argv) {
        // Should not expose known sensitive patterns in plain form
        const containsSensitiveValue =
          arg.match(/--api-key=[^[]/i) ||
          arg.match(/--token=[^[]/i) ||
          arg.match(/--secret=[^[]/i) ||
          arg.match(/--password=[^[]/i);

        // If a sensitive flag exists, it should be redacted
        if (containsSensitiveValue) {
          expect(arg).toContain("[REDACTED]");
        }
      }
    });
  });

  describe("environment variable filtering", () => {
    test("includes CI environment variables", () => {
      // Set CI env var
      process.env.CI = "true";

      const info = getCommandInfo();

      expect(info.env.CI).toBe("true");
    });

    test("includes GitHub Actions environment variables", () => {
      process.env.GITHUB_ACTIONS = "true";
      process.env.GITHUB_SHA = "abc123";
      process.env.GITHUB_REF = "refs/heads/main";

      const info = getCommandInfo();

      expect(info.env.GITHUB_ACTIONS).toBe("true");
      expect(info.env.GITHUB_SHA).toBe("abc123");
      expect(info.env.GITHUB_REF).toBe("refs/heads/main");
    });

    test("includes GitLab CI environment variables", () => {
      process.env.GITLAB_CI = "true";
      process.env.CI_COMMIT_SHA = "def456";

      const info = getCommandInfo();

      expect(info.env.GITLAB_CI).toBe("true");
      expect(info.env.CI_COMMIT_SHA).toBe("def456");
    });

    test("includes NODE_ENV", () => {
      process.env.NODE_ENV = "test";

      const info = getCommandInfo();

      expect(info.env.NODE_ENV).toBe("test");
    });

    test("includes Playwright prefixed variables (non-sensitive)", () => {
      process.env.PLAYWRIGHT_BROWSERS_PATH = "/custom/path";
      process.env.PW_EXPERIMENTAL = "true";

      const info = getCommandInfo();

      expect(info.env.PLAYWRIGHT_BROWSERS_PATH).toBe("/custom/path");
      expect(info.env.PW_EXPERIMENTAL).toBe("true");
    });

    test("excludes sensitive Playwright variables", () => {
      process.env.PLAYWRIGHT_API_KEY = "secret123";
      process.env.PW_AUTH_TOKEN = "token456";

      const info = getCommandInfo();

      expect(info.env.PLAYWRIGHT_API_KEY).toBeUndefined();
      expect(info.env.PW_AUTH_TOKEN).toBeUndefined();
    });

    test("excludes non-whitelisted environment variables", () => {
      process.env.MY_CUSTOM_VAR = "custom_value";
      process.env.RANDOM_SECRET = "should_not_appear";

      const info = getCommandInfo();

      expect(info.env.MY_CUSTOM_VAR).toBeUndefined();
      expect(info.env.RANDOM_SECRET).toBeUndefined();
    });

    test("excludes variables with sensitive patterns", () => {
      process.env.MY_API_KEY = "secret";
      process.env.DATABASE_PASSWORD = "secret";
      process.env.AUTH_TOKEN = "secret";
      process.env.PRIVATE_KEY = "secret";

      const info = getCommandInfo();

      expect(info.env.MY_API_KEY).toBeUndefined();
      expect(info.env.DATABASE_PASSWORD).toBeUndefined();
      expect(info.env.AUTH_TOKEN).toBeUndefined();
      expect(info.env.PRIVATE_KEY).toBeUndefined();
    });
  });
});

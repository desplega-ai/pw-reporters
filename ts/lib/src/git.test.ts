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

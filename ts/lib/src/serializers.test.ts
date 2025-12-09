import { describe, test, expect } from "bun:test";
import {
  serializeDate,
  serializeBuffer,
  serializeRegExp,
  serializeRegExpArray,
  serializeLocation,
  serializeTestError,
  serializeAttachment,
  serializeTestStep,
  serializeTestResult,
  serializeTestCase,
  serializeSuite,
  serializeProject,
  serializeConfig,
  serializeFullResult,
} from "./serializers";

// ============================================
// Utility Function Tests
// ============================================

describe("serializeDate", () => {
  test("converts Date to ISO string", () => {
    const date = new Date("2025-01-15T10:30:00.000Z");
    expect(serializeDate(date)).toBe("2025-01-15T10:30:00.000Z");
  });
});

describe("serializeBuffer", () => {
  test("converts Buffer to string", () => {
    const buffer = Buffer.from("hello world");
    expect(serializeBuffer(buffer)).toBe("hello world");
  });

  test("passes through string unchanged", () => {
    expect(serializeBuffer("hello")).toBe("hello");
  });
});

describe("serializeRegExp", () => {
  test("converts RegExp to source string", () => {
    expect(serializeRegExp(/test.*pattern/)).toBe("test.*pattern");
  });

  test("passes through string unchanged", () => {
    expect(serializeRegExp("test")).toBe("test");
  });
});

describe("serializeRegExpArray", () => {
  test("handles null", () => {
    expect(serializeRegExpArray(null)).toBe(null);
  });

  test("handles undefined", () => {
    expect(serializeRegExpArray(undefined)).toBe(null);
  });

  test("wraps single RegExp in array", () => {
    expect(serializeRegExpArray(/test/)).toEqual(["test"]);
  });

  test("wraps single string in array", () => {
    expect(serializeRegExpArray("test")).toEqual(["test"]);
  });

  test("converts array of mixed patterns", () => {
    expect(serializeRegExpArray([/foo/, "bar", /baz/])).toEqual([
      "foo",
      "bar",
      "baz",
    ]);
  });
});

// ============================================
// Core Serializer Tests
// ============================================

describe("serializeLocation", () => {
  test("serializes location correctly", () => {
    const location = { file: "/path/to/test.ts", line: 10, column: 5 };
    expect(serializeLocation(location)).toEqual({
      file: "/path/to/test.ts",
      line: 10,
      column: 5,
    });
  });
});

describe("serializeTestError", () => {
  test("serializes basic error", () => {
    const error = {
      message: "Test failed",
      stack: "Error: Test failed\n    at ...",
    };
    const result = serializeTestError(error);
    expect(result.message).toBe("Test failed");
    expect(result.stack).toBe("Error: Test failed\n    at ...");
  });

  test("serializes error with cause (recursive)", () => {
    const error = {
      message: "Outer error",
      cause: {
        message: "Inner error",
      },
    };
    const result = serializeTestError(error);
    expect(result.message).toBe("Outer error");
    expect(result.cause?.message).toBe("Inner error");
  });

  test("serializes error with location", () => {
    const error = {
      message: "Error",
      location: { file: "/test.ts", line: 5, column: 10 },
    };
    const result = serializeTestError(error);
    expect(result.location).toEqual({ file: "/test.ts", line: 5, column: 10 });
  });
});

describe("serializeAttachment", () => {
  test("serializes attachment with path", () => {
    const attachment = {
      name: "screenshot",
      contentType: "image/png",
      path: "/path/to/screenshot.png",
    };
    expect(serializeAttachment(attachment)).toEqual({
      name: "screenshot",
      contentType: "image/png",
      path: "/path/to/screenshot.png",
    });
  });

  test("omits body even if present", () => {
    const attachment = {
      name: "data",
      contentType: "text/plain",
      body: Buffer.from("secret data"),
    };
    const result = serializeAttachment(attachment);
    expect(result).not.toHaveProperty("body");
  });
});

describe("serializeTestStep", () => {
  test("serializes step with nested steps", () => {
    const mockStep = {
      title: "Parent Step",
      titlePath: () => ["Test", "Parent Step"],
      category: "test.step",
      duration: 100,
      startTime: new Date("2025-01-15T10:00:00.000Z"),
      annotations: [],
      attachments: [],
      steps: [
        {
          title: "Child Step",
          titlePath: () => ["Test", "Parent Step", "Child Step"],
          category: "test.step",
          duration: 50,
          startTime: new Date("2025-01-15T10:00:00.050Z"),
          annotations: [],
          attachments: [],
          steps: [],
        },
      ],
    } as any;

    const result = serializeTestStep(mockStep);
    expect(result.title).toBe("Parent Step");
    expect(result.titlePath).toEqual(["Test", "Parent Step"]);
    expect(result.startTime).toBe("2025-01-15T10:00:00.000Z");
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]!.title).toBe("Child Step");
  });
});

describe("serializeTestResult", () => {
  test("serializes result with stdio", () => {
    const mockResult = {
      status: "passed",
      duration: 1000,
      startTime: new Date("2025-01-15T10:00:00.000Z"),
      retry: 0,
      workerIndex: 0,
      parallelIndex: 0,
      errors: [],
      stdout: ["output line", Buffer.from("buffer output")],
      stderr: [],
      steps: [],
      attachments: [],
      annotations: [],
    } as any;

    const result = serializeTestResult(mockResult);
    expect(result.status).toBe("passed");
    expect(result.startTime).toBe("2025-01-15T10:00:00.000Z");
    expect(result.stdout).toEqual(["output line", "buffer output"]);
  });
});

describe("serializeTestCase", () => {
  test("serializes test case with computed properties", () => {
    const mockTest = {
      id: "test-123",
      title: "should work",
      titlePath: () => ["Suite", "should work"],
      location: { file: "/test.ts", line: 10, column: 1 },
      tags: ["@smoke"],
      timeout: 30000,
      retries: 2,
      repeatEachIndex: 0,
      expectedStatus: "passed",
      annotations: [],
      outcome: () => "expected",
      ok: () => true,
    } as any;

    const result = serializeTestCase(mockTest);
    expect(result.id).toBe("test-123");
    expect(result.titlePath).toEqual(["Suite", "should work"]);
    expect(result.outcome).toBe("expected");
    expect(result.ok).toBe(true);
  });
});

describe("serializeSuite", () => {
  test("serializes suite with test IDs only", () => {
    const mockSuite = {
      title: "My Suite",
      titlePath: () => ["", "My Suite"],
      type: "describe",
      location: { file: "/test.ts", line: 1, column: 1 },
      suites: [],
      tests: [{ id: "test-1" }, { id: "test-2" }],
    } as any;

    const result = serializeSuite(mockSuite);
    expect(result.testIds).toEqual(["test-1", "test-2"]);
    expect(result).not.toHaveProperty("tests");
  });

  test("serializes nested suites recursively", () => {
    const mockSuite = {
      title: "Root",
      titlePath: () => ["Root"],
      type: "file",
      suites: [
        {
          title: "Child",
          titlePath: () => ["Root", "Child"],
          type: "describe",
          suites: [],
          tests: [],
        },
      ],
      tests: [],
    } as any;

    const result = serializeSuite(mockSuite);
    expect(result.suites).toHaveLength(1);
    expect(result.suites[0]!.title).toBe("Child");
  });
});

describe("serializeFullResult", () => {
  test("serializes final result", () => {
    const mockResult = {
      status: "passed",
      startTime: new Date("2025-01-15T10:00:00.000Z"),
      duration: 5000,
    } as any;

    const result = serializeFullResult(mockResult);
    expect(result.status).toBe("passed");
    expect(result.startTime).toBe("2025-01-15T10:00:00.000Z");
    expect(result.duration).toBe(5000);
  });
});

// ============================================
// JSON Safety Tests
// ============================================

describe("JSON safety", () => {
  test("serialized objects are JSON-safe", () => {
    const mockResult = {
      status: "passed",
      duration: 1000,
      startTime: new Date("2025-01-15T10:00:00.000Z"),
      retry: 0,
      workerIndex: 0,
      parallelIndex: 0,
      errors: [],
      stdout: [Buffer.from("test")],
      stderr: [],
      steps: [],
      attachments: [],
      annotations: [],
    } as any;

    const serialized = serializeTestResult(mockResult);
    const jsonString = JSON.stringify(serialized);
    const parsed = JSON.parse(jsonString);

    expect(parsed.startTime).toBe("2025-01-15T10:00:00.000Z");
    expect(parsed.stdout).toEqual(["test"]);
  });
});

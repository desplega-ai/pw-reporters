#!/usr/bin/env bun
/**
 * E2E test for the Playwright reporter
 *
 * 1. Starts the WebSocket test server
 * 2. Runs Playwright tests
 * 3. Fetches summary from server via HTTP
 * 4. Verifies the summary contains expected data
 */

const SERVER_PORT = 5555;

interface RunSummary {
  runId: string | null;
  events: Record<string, number>;
  tests: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
  };
  uploads: {
    files: number;
    chunks: number;
    totalBytes: number;
  };
  startTime: string | null;
  endTime: string | null;
}

async function waitForServer(maxAttempts = 30): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(`http://localhost:${SERVER_PORT}/health`);
      if (response.ok) {
        return true;
      }
    } catch {
      // Server not ready yet
    }
    await Bun.sleep(100);
  }
  return false;
}

async function main() {
  console.log("=== E2E Test: Playwright Reporter ===\n");

  // Start the server in background
  console.log("1. Starting WebSocket server...");
  const server = Bun.spawn(["bun", "ws.ts"], {
    cwd: import.meta.dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  // Wait for server to be ready
  const serverReady = await waitForServer();
  if (!serverReady) {
    console.error("   ERROR: Server failed to start");
    server.kill();
    process.exit(1);
  }
  console.log("   Server started on port", SERVER_PORT);

  // Run Playwright tests
  console.log("\n2. Running Playwright tests...");
  const testResult = await Bun.$`bun run pw:test --project=base`
    .quiet()
    .nothrow();

  if (testResult.exitCode !== 0) {
    console.error("   ERROR: Playwright tests failed");
    console.error(testResult.stderr.toString());
    server.kill();
    process.exit(1);
  }
  console.log("   Tests completed successfully");

  // Fetch summary from server before stopping it
  console.log("\n3. Fetching summary from server...");
  let summary: RunSummary;
  try {
    const response = await fetch(`http://localhost:${SERVER_PORT}/summary`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    summary = await response.json();
  } catch (err) {
    console.error("   ERROR: Failed to fetch summary:", err);
    server.kill();
    process.exit(1);
  }

  // Stop the server
  server.kill();
  console.log("   Server stopped");

  // Validate summary
  console.log("\n4. Verifying summary...");
  const errors: string[] = [];

  if (!summary.runId) {
    errors.push("Missing runId");
  }

  if (!summary.events.onBegin) {
    errors.push("Missing onBegin event");
  }

  if (!summary.events.onEnd) {
    errors.push("Missing onEnd event");
  }

  if (!summary.events.onExit) {
    errors.push("Missing onExit event");
  }

  if (summary.tests.total === 0) {
    errors.push("No tests recorded");
  }

  if (summary.tests.passed !== summary.tests.total) {
    errors.push(
      `Some tests failed: ${summary.tests.passed}/${summary.tests.total} passed`,
    );
  }

  if (summary.uploads.files === 0 && summary.uploads.chunks === 0) {
    errors.push("No uploads recorded");
  }

  if (!summary.startTime || !summary.endTime) {
    errors.push("Missing timing data");
  }

  if (errors.length > 0) {
    console.error("   ERRORS:");
    errors.forEach((e) => console.error(`   - ${e}`));
    process.exit(1);
  }

  // Print summary
  console.log("   Summary validated successfully:");
  console.log(`   - Run ID: ${summary.runId?.slice(0, 20)}...`);
  console.log(`   - Events: ${Object.keys(summary.events).length} types`);
  console.log(
    `   - Tests: ${summary.tests.passed}/${summary.tests.total} passed`,
  );
  console.log(
    `   - Uploads: ${summary.uploads.files} files, ${summary.uploads.chunks} chunks`,
  );
  console.log(
    `   - Total uploaded: ${(summary.uploads.totalBytes / 1024 / 1024).toFixed(2)} MB`,
  );

  console.log("\n=== E2E Test PASSED ===");
  process.exit(0);
}

main().catch((err) => {
  console.error("E2E test failed:", err);
  process.exit(1);
});

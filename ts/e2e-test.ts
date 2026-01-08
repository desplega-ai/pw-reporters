#!/usr/bin/env bun
/**
 * E2E test for the Playwright reporter
 *
 * Tests both WebSocket and HTTP batch transports:
 * 1. Starts the test server
 * 2. Runs Playwright tests with WebSocket transport
 * 3. Verifies the summary
 * 4. Runs Playwright tests with HTTP batch transport
 * 5. Verifies the summary including batch stats
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
  batches: {
    count: number;
    by_type: Record<string, number>;
    total_events: number;
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

async function resetServer(): Promise<void> {
  // The server resets on new connections, but we need to restart it
  // to get a fresh summary. For now, we'll just note the batch counts
  // are cumulative if testing both transports in sequence.
}

async function runE2ETest(
  transport: "websocket" | "http",
  server: ReturnType<typeof Bun.spawn>,
): Promise<RunSummary> {
  console.log(`\n--- Testing ${transport.toUpperCase()} transport ---`);

  // Run Playwright tests with specified transport
  console.log(`Running Playwright tests with ${transport} transport...`);
  const testResult = await Bun.$`bun run pw:test`
    .env({
      ...process.env,
      DESPLEGA_ENDPOINT: `localhost:${SERVER_PORT}`,
      DESPLEGA_SECURE: "false",
      DESPLEGA_DEBUG: "true",
      DESPLEGA_TRANSPORT: transport,
    })
    .quiet()
    .nothrow();

  if (testResult.exitCode !== 0) {
    console.error(`   ERROR: Playwright tests failed with ${transport}`);
    console.error(testResult.stderr.toString());
    server.kill();
    process.exit(1);
  }
  console.log("   Tests completed successfully");

  // Small delay to ensure server has processed everything
  await Bun.sleep(500);

  // Fetch summary from server
  console.log("   Fetching summary...");
  const response = await fetch(`http://localhost:${SERVER_PORT}/summary`);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return (await response.json()) as RunSummary;
}

function validateSummary(
  summary: RunSummary,
  transport: "websocket" | "http",
): string[] {
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

  if (summary.tests.failed > 0) {
    errors.push(
      `Some tests failed: ${summary.tests.failed}/${summary.tests.total} failed`,
    );
  }

  if (summary.uploads.files === 0 && summary.uploads.chunks === 0) {
    errors.push("No uploads recorded");
  }

  if (!summary.startTime || !summary.endTime) {
    errors.push("Missing timing data");
  }

  // HTTP-specific validations
  if (transport === "http") {
    if (summary.batches.count === 0) {
      errors.push("No batches recorded for HTTP transport");
    }

    if (!summary.batches.by_type.run_begin) {
      errors.push("Missing run_begin batch");
    }

    if (!summary.batches.by_type.run_end) {
      errors.push("Missing run_end batch");
    }

    if (!summary.batches.by_type.test_complete) {
      errors.push("Missing test_complete batches");
    }
  }

  return errors;
}

function printSummary(summary: RunSummary, transport: "websocket" | "http") {
  console.log(`   Summary for ${transport}:`);
  console.log(`   - Run ID: ${summary.runId?.slice(0, 20)}...`);
  console.log(`   - Events: ${Object.keys(summary.events).length} types`);
  console.log(
    `   - Tests: ${summary.tests.passed}/${summary.tests.total} passed`,
  );
  console.log(
    `   - Uploads: ${summary.uploads.files} files, ${summary.uploads.chunks} chunks`,
  );

  if (transport === "http") {
    console.log(`   - Batches: ${summary.batches.count} total`);
    console.log(
      `     - run_begin: ${summary.batches.by_type.run_begin ?? 0}`,
    );
    console.log(
      `     - test_complete: ${summary.batches.by_type.test_complete ?? 0}`,
    );
    console.log(`     - run_end: ${summary.batches.by_type.run_end ?? 0}`);
    console.log(
      `     - output: ${summary.batches.by_type.output ?? 0}`,
    );
  }
}

async function main() {
  console.log("=== E2E Test: Playwright Reporter ===\n");

  // Get transport to test from args, or test both
  const args = process.argv.slice(2);
  const transportsToTest: Array<"websocket" | "http"> =
    args.includes("--websocket")
      ? ["websocket"]
      : args.includes("--http")
        ? ["http"]
        : ["websocket", "http"];

  for (const transport of transportsToTest) {
    // Start a fresh server for each transport test
    console.log(`\n1. Starting test server for ${transport} test...`);
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

    try {
      // Run tests
      const summary = await runE2ETest(transport, server);

      // Validate
      console.log(`\n2. Verifying ${transport} summary...`);
      const errors = validateSummary(summary, transport);

      if (errors.length > 0) {
        console.error("   ERRORS:");
        errors.forEach((e) => console.error(`   - ${e}`));
        server.kill();
        process.exit(1);
      }

      console.log("   Summary validated successfully:");
      printSummary(summary, transport);

      console.log(`\n=== ${transport.toUpperCase()} E2E Test PASSED ===`);
    } finally {
      // Stop the server
      server.kill();
      console.log("   Server stopped");
      // Wait a moment for port to be released
      await Bun.sleep(500);
    }
  }

  console.log("\n=== ALL E2E Tests PASSED ===");
  process.exit(0);
}

main().catch((err) => {
  console.error("E2E test failed:", err);
  process.exit(1);
});

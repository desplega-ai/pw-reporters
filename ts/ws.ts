/**
 * Example WebSocket + HTTP upload server for testing the Playwright reporter
 *
 * Usage:
 *   bun ws.ts                    # Normal mode - just logs
 *   bun ws.ts --summary          # Writes summary to .ws-summary.json on exit
 *
 * Endpoints:
 * - ws://localhost:5555?token=xxx - WebSocket for streaming events
 * - POST http://localhost:5555/upload - File upload (multipart form)
 * - POST http://localhost:5555/upload/chunk - Chunked file upload
 */

// Parse CLI args
const writeSummary = process.argv.includes("--summary");
const summaryFile = ".ws-summary.json";

// Track run statistics
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
  finalStatus: string | null;
}

const summary: RunSummary = {
  runId: null,
  events: {},
  tests: { total: 0, passed: 0, failed: 0, skipped: 0 },
  uploads: { files: 0, chunks: 0, totalBytes: 0 },
  startTime: null,
  endTime: null,
  finalStatus: null,
};

function recordEvent(event: {
  event: string;
  runId?: string;
  result?: { status?: string };
  test?: unknown;
}) {
  // Track event counts
  summary.events[event.event] = (summary.events[event.event] ?? 0) + 1;

  // Capture run ID
  if (event.runId && !summary.runId) {
    summary.runId = event.runId;
  }

  // Track test results
  if (event.event === "onTestEnd" && event.result?.status) {
    summary.tests.total++;
    const status = event.result.status;
    if (status === "passed") summary.tests.passed++;
    else if (status === "failed" || status === "timedOut")
      summary.tests.failed++;
    else if (status === "skipped") summary.tests.skipped++;
  }

  // Track timing
  if (event.event === "onBegin" && !summary.startTime) {
    summary.startTime = new Date().toISOString();
  }
  if (event.event === "onEnd") {
    summary.endTime = new Date().toISOString();
  }
}

async function writeSummaryFile() {
  if (!writeSummary) return;

  await Bun.write(summaryFile, JSON.stringify(summary, null, 2));
  console.log(`[Summary] Written to ${summaryFile}`);
}

const server = Bun.serve({
  port: 5555,
  async fetch(req, server) {
    const url = new URL(req.url);

    console.log(`[HTTP] ${req.method} ${url.pathname}`);

    // WebSocket upgrade
    if (req.headers.get("upgrade") === "websocket") {
      const token = url.searchParams.get("token");
      console.log(
        "[WS] Upgrade request with token:",
        token?.slice(0, 10) + "...",
      );

      const success = server.upgrade(req, {
        data: { token: token ?? undefined },
      });

      if (success) {
        return undefined;
      }
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    // File upload endpoint
    if (url.pathname === "/upload" && req.method === "POST") {
      return handleUpload(req);
    }

    // Chunked upload endpoint
    if (url.pathname === "/upload/chunk" && req.method === "POST") {
      return handleChunkedUpload(req);
    }

    // Health check
    if (url.pathname === "/health") {
      return new Response("OK");
    }

    // Get current summary (for testing)
    if (url.pathname === "/summary") {
      return Response.json(summary);
    }

    return new Response("Not found", { status: 404 });
  },
  websocket: {
    data: {} as { token?: string },

    open(ws) {
      console.log("[WS] Client connected");
    },

    message(ws, message) {
      const text = typeof message === "string" ? message : message.toString();

      // Handle ping
      try {
        const data = JSON.parse(text);
        if (data.type === "ping") {
          ws.send(JSON.stringify({ type: "pong" }));
          return;
        }
      } catch {
        // Not JSON, that's fine
      }

      // Log event
      try {
        const event = JSON.parse(text);
        console.log(
          `[WS] Event: ${event.event} (runId: ${event.runId?.slice(0, 15)}...)`,
        );

        // Record for summary
        recordEvent(event);

        // Log some details for specific events
        if (event.event === "onBegin") {
          console.log(`  - Projects: ${event.config?.projects?.length ?? 0}`);
          console.log(`  - Root suite tests: ${countTests(event.suite)}`);
        } else if (
          event.event === "onTestBegin" ||
          event.event === "onTestEnd"
        ) {
          console.log(`  - Test: ${event.test?.titlePath?.join(" > ")}`);
          if (event.event === "onTestEnd") {
            console.log(`  - Status: ${event.result?.status}`);
          }
        } else if (event.event === "onError") {
          console.log(`  - Error: ${event.error?.message?.slice(0, 100)}`);
        }
      } catch {
        console.log(`[WS] Raw message: ${text.slice(0, 100)}...`);
      }

      // Acknowledge
      ws.send(JSON.stringify({ type: "ack" }));
    },

    async close(ws, code, reason) {
      console.log(`[WS] Client disconnected: ${code} ${reason}`);
      await writeSummaryFile();
    },
  },
});

/**
 * Handle simple file upload
 */
async function handleUpload(req: Request): Promise<Response> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const runId = formData.get("runId") as string | null;
    const relativePath = formData.get("relativePath") as string | null;

    if (!file) {
      return new Response("No file provided", { status: 400 });
    }

    console.log(
      `[Upload] ${relativePath} (${formatSize(file.size)}) for run ${runId?.slice(0, 15)}...`,
    );

    // Track upload stats
    summary.uploads.files++;
    summary.uploads.totalBytes += file.size;

    // In a real server, you'd save the file here
    // For now, just consume it to simulate processing
    await file.arrayBuffer();

    return Response.json({
      success: true,
      file: relativePath,
      size: file.size,
    });
  } catch (error) {
    console.error("[Upload] Error:", error);
    return new Response("Upload failed", { status: 500 });
  }
}

/**
 * Handle chunked file upload
 */
async function handleChunkedUpload(req: Request): Promise<Response> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const runId = formData.get("runId") as string | null;
    const relativePath = formData.get("relativePath") as string | null;
    const uploadId = formData.get("uploadId") as string | null;
    const chunkIndex = parseInt(formData.get("chunkIndex") as string, 10);
    const totalChunks = parseInt(formData.get("totalChunks") as string, 10);

    if (!file) {
      return new Response("No file provided", { status: 400 });
    }

    console.log(
      `[Upload] Chunk ${chunkIndex + 1}/${totalChunks} of ${relativePath} (${formatSize(file.size)})`,
    );

    // Track upload stats
    summary.uploads.chunks++;
    summary.uploads.totalBytes += file.size;

    // Consume the chunk
    await file.arrayBuffer();

    return Response.json({
      success: true,
      uploadId,
      chunkIndex,
      totalChunks,
      received: file.size,
    });
  } catch (error) {
    console.error("[Upload] Chunk error:", error);
    return new Response("Chunk upload failed", { status: 500 });
  }
}

/**
 * Count total tests in a suite tree
 */
function countTests(suite: { testIds?: string[]; suites?: unknown[] }): number {
  if (!suite) return 0;
  const direct = suite.testIds?.length ?? 0;
  const nested =
    (suite.suites as (typeof suite)[])?.reduce(
      (sum, s) => sum + countTests(s),
      0,
    ) ?? 0;
  return direct + nested;
}

/**
 * Format bytes to human readable
 */
function formatSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

console.log(`
====================================
  Test Server Running
====================================
  WebSocket: ws://localhost:${server.port}
  Upload:    http://localhost:${server.port}/upload
  Health:    http://localhost:${server.port}/health
  Summary:   http://localhost:${server.port}/summary
  --summary: ${writeSummary ? "enabled" : "disabled"}
====================================
`);

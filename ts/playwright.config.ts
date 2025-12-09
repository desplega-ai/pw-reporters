import { defineConfig, devices } from "@playwright/test";
import type { ReporterConfig } from "./lib/src/index";

export default defineConfig({
  testDir: "./examples/tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    // ['line'],
    // ['blob', { outputFile: 'test-results/results.zip' }],
    // ['json', { outputFile: 'test-results/results.json' }],
    // New library-based reporter:
    [
      "./lib/src/reporter.ts",
      {
        apiKey: process.env.REPORTER_API_KEY ?? "dev-api-key",
        wsEndpoint: process.env.REPORTER_WS_ENDPOINT ?? "ws://localhost:5555",
        debug: true,
        upload: {
          parallel: 10,
          chunkSizeMb: 10,
        },
      } satisfies ReporterConfig,
    ],
  ],
  use: {
    baseURL: "https://evals.desplega.ai",
    trace: "on",
    video: "on",
    screenshot: "on",
  },
  projects: [
    {
      name: "base",
      use: { ...devices["Desktop Chrome"] },
      metadata: {
        id: "1",
      },
    },
  ],
});

import "dotenv/config";

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
    // Desplega reporter - config via env vars (DESPLEGA_ENDPOINT, DESPLEGA_API_KEY, etc.)
    // or inline config below. Env vars take precedence.
    [
      "./lib/src/reporter.ts",
      {
        // All config can come from env vars:
        // DESPLEGA_ENDPOINT, DESPLEGA_API_KEY, DESPLEGA_SECURE, DESPLEGA_DEBUG
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
      name: "desplega.ai Evals - Desktop Chrome",
      use: { ...devices["Desktop Chrome"] },
      metadata: {
        id: "1",
      },
    },
  ],
});

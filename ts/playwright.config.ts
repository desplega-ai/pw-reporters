import { defineConfig, devices } from "@playwright/test";

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
    ["./reporter.ts"],
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

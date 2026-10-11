import { defineConfig } from "@playwright/test";

// Start the candidate CRM only on this VPS loopback address before running.
// The browser suite substitutes every API response and never uses real credentials.
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "pipeline-board.spec.ts",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: "line",
  outputDir: "test-results/pipeline-board",
  use: {
    baseURL: "http://127.0.0.1:3107",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
    viewport: { width: 1440, height: 1000 },
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});

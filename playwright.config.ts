import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: "line",
  outputDir: process.env.QCRM_E2E_ARTIFACT_DIRECTORY ?? "test-results",
  use: {
    baseURL: process.env.QCRM_E2E_ADMIN_ORIGIN,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
    ignoreHTTPSErrors: false,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});

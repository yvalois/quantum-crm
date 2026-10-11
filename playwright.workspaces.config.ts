import { defineConfig } from "@playwright/test";

// Run only against the candidate on VPS loopback; all API data is synthetic.
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "crm-workspaces.spec.ts",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: "line",
  outputDir: "test-results/crm-workspaces",
  use: {
    baseURL: "http://127.0.0.1:3107",
    // Next dev requires eval for HMR; this loopback suite does not test CSP.
    bypassCSP: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
    viewport: { width: 1440, height: 1000 },
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});

import { defineConfig, devices } from "@playwright/test";

// Dashboard SPA is served under /app/ (vite base). API is proxied at /api.
export default defineConfig({
  testDir: "./tests",
  outputDir: "./results",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [
    ["list"],
    ["html", { outputFolder: "./report", open: "never" }],
    ["json", { outputFile: "./results/results.json" }],
  ],
  use: {
    baseURL: "http://localhost:13100",
    screenshot: "on",
    trace: "retain-on-failure",
    video: "off",
    actionTimeout: 12_000,
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: "./.auth/user.json" },
      dependencies: ["setup"],
      testIgnore: /auth\.setup\.ts/,
    },
  ],
});

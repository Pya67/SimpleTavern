import { defineConfig } from "@playwright/test";

// Runs against the dev server with the built-in OpenRouter mock and AUTH_BYPASS=true.
// Uses the locally installed Chrome (no browser download needed).
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    channel: "chrome",
    viewport: { width: 1360, height: 860 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120_000,
    env: { AUTH_BYPASS: "true", OPENROUTER_MOCK: "true" },
  },
});

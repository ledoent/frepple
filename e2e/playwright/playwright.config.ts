import { defineConfig } from "@playwright/test";

// Drives the compose stack (e2e/docker-compose.yml) through the nginx origin.
// Start the stack first:  docker compose -f e2e/docker-compose.yml up --build
export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  globalSetup: "./global-setup.ts",
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://127.0.0.1:18080",
    storageState: "storage.json",
    trace: "on-first-retry",
  },
});

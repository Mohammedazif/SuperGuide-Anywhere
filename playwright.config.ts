import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/helpers/global-setup.ts",
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  use: {
    trace: "retain-on-failure",
  },
});

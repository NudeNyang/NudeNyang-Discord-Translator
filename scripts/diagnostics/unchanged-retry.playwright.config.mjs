import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "../../extension/e2e",
  testMatch: "discord-retry.spec.mjs",
  outputDir: "../../test-results/unchanged-retry-probe",
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 8_000 },
  reporter: [["list"]],
});

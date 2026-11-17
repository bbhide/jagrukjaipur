import { defineConfig, devices } from "@playwright/test";

/** E2E tests run against a running stack: `npm run dev` (web :4321, API :4000) with OTP_DEV_CODE=1234 and a seeded database. */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: process.env.BASE_URL ?? "http://127.0.0.1:4321", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, grepInvert: /@mobile/ },
    { name: "mobile", use: { ...devices["Pixel 7"] }, grep: /@mobile/ },
  ],
});

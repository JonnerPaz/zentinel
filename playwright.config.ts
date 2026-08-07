import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/ui",
  testMatch: "**/*.e2e.ts",
  timeout: 30000,
  fullyParallel: true,
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm start",
    url: "http://localhost:3000/api/users",
    reuseExistingServer: true,
    timeout: 30000,
  },
  reporter: [["list"]],
});

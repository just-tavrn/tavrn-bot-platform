// SPDX-License-Identifier: Apache-2.0
// Local only (never in CI): the web UI against the dev servers with the fake bot (FAKE_BOT=1).
//   pnpm exec playwright install chromium   (once)
//   pnpm e2e
import { defineConfig, devices } from "@playwright/test";

const api = Number(process.env.E2E_API_PORT ?? 8797);
const web = Number(process.env.E2E_WEB_PORT ?? 5197);

export default defineConfig({
  testDir: ".",
  timeout: 30_000,
  use: { baseURL: `http://127.0.0.1:${web}`, trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-android", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "node scripts/dev.mjs",
    cwd: "..",
    url: `http://127.0.0.1:${web}/healthz`,
    reuseExistingServer: false,
    env: { FAKE_BOT: "1", NO_WATCH: "1", API_PORT: String(api), WEB_PORT: String(web), DATA_DIR: `test-results/e2e-data-${Date.now()}` },
  },
});

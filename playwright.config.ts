import { existsSync } from "node:fs";
import { chromium, defineConfig } from "@playwright/test";

const fallback =
  "/home/trakshan/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome";
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  timeout: 60_000,
  workers: 1,
  use: {
    baseURL: "http://localhost:5182",
    viewport: { width: 1280, height: 800 },
    launchOptions: {
      executablePath: existsSync(chromium.executablePath())
        ? chromium.executablePath()
        : fallback
    },
    trace: "retain-on-failure"
  },
  webServer: {
    command: "npx vite --config e2e/vite.config.ts --port 5182 --strictPort",
    url: "http://localhost:5182",
    timeout: 120_000,
    reuseExistingServer: false
  }
});

const { defineConfig, devices } = require("@playwright/test");
process.env.E2E_PORT ||= String(30_000 + (process.pid % 20_000));
const e2ePort = Number(process.env.E2E_PORT);

module.exports = defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  outputDir: `test-results/${e2ePort}`,
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  reporter: process.env.CI ? [["line"], ["html", { open: "never" }]] : "line",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://127.0.0.1:${e2ePort}`,
    trace: "retain-on-failure",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: {
      args: [
        "--autoplay-policy=no-user-gesture-required",
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
      ],
    },
  },
  webServer: {
    command: "node tests/e2e/fixture-server.cjs",
    url: `http://127.0.0.1:${e2ePort}/__test/ready`,
    env: { E2E_PORT: String(e2ePort) },
    reuseExistingServer: false,
    timeout: 15_000,
  },
});

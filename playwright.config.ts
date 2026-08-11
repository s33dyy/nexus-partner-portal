import { defineConfig, devices } from "@playwright/test";

// Point these at deployed services to run the suite against an environment
// instead of the locally-started pair below.
const FRONTEND_URL = process.env.E2E_FRONTEND_URL ?? "http://localhost:8080";
const BACKEND_URL = process.env.E2E_BACKEND_URL ?? "http://localhost:3000";
const useLocalServers = !process.env.E2E_FRONTEND_URL;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: FRONTEND_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: useLocalServers
    ? [
        {
          command: "bun run dev:backend",
          url: `${BACKEND_URL}/health`,
          reuseExistingServer: !process.env.CI,
          timeout: 120 * 1000,
          env: {
            FRONTEND_URL,
            CORS_ALLOWED_ORIGIN: FRONTEND_URL,
          },
        },
        {
          command: "bun run dev:frontend",
          url: FRONTEND_URL,
          reuseExistingServer: !process.env.CI,
          timeout: 120 * 1000,
          env: { VITE_API_BASE_URL: BACKEND_URL },
        },
      ]
    : undefined,
});

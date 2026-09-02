// Playwright end-to-end config.
//
//   start an isolated instance on its own port and DATA_DIR before running this
//   E2E_BASE_URL=http://127.0.0.1:20137 npx playwright test -c tests/e2e
//   npx playwright test -c tests/e2e --headed              watch it run
//
// The base URL is configurable and defaults to 20137 because 20127, 20128 and
// 20129 on this host are the dev server, production, and a foreign tokenproxy. A
// suite that defaulted to one of those would drive real traffic through a live
// gateway, so the default points at the throwaway instance instead.
//
// There is deliberately no `webServer` block. Starting the app is
// instance.sh's job: it builds in a scratch worktree, snapshots the standalone
// output and seeds a DATA_DIR from a read-only copy of the live database. A
// `webServer` here would have to build in the repository root, which is unsafe
// while other sessions are editing the same checkout.
//
// `playwright/test` rather than `@playwright/test`: the pinned `playwright`
// package re-exports the whole test runner from ./test, so the suite needs no
// third dependency.
import { defineConfig, devices } from 'playwright/test';

const BASE_URL = process.env.E2E_BASE_URL || 'http://127.0.0.1:20137';

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.js',
  // The instance is single-process and backed by one SQLite file, so parallel
  // workers would contend on it and produce failures that say nothing about the
  // UI. Correctness over speed until a test actually needs the parallelism.
  workers: 1,
  fullyParallel: false,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['json', { outputFile: 'e2e-results.json' }]] : 'list',
  outputDir: process.env.E2E_OUTPUT_DIR || '/tmp/tp-e2e-artifacts',
  use: {
    baseURL: BASE_URL,
    // A failed run should leave enough to diagnose it without a re-run.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  // Chromium only. It is the browser already in the playwright cache on this
  // host, and adding firefox/webkit projects would make every run fail on a
  // missing download rather than on the application.
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});

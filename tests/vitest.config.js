import { defineConfig } from "vitest/config";
import { transformWithOxc } from "vite";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  // Dashboard components use JSX in .js files. Next handles this in production,
  // while Vitest's Vite 8 import analysis needs an explicit test-only transform.
  // Test files get the same treatment so a component test can render with JSX.
  plugins: [{
    name: "dashboard-jsx-test-transform",
    enforce: "pre",
    async transform(code, id) {
      if (!id.endsWith(".js")) return null;
      const inSrc = id.startsWith(resolve(__dirname, "../src") + "/");
      const inTests = id.startsWith(__dirname) && !id.includes("/node_modules/");
      if (!inSrc && !inTests) return null;
      return transformWithOxc(code, id, { lang: "jsx", jsx: { runtime: "automatic" } });
    },
  }],
  test: {
    // DATA_DIR ISOLATION. src/lib/dataDir.js:16 falls back to ~/.tokenproxy when
    // DATA_DIR is unset, so without this every DB-touching test wrote the LIVE
    // production database: fixture connection ids (ok, out, conn-1, kilo-2) landed
    // in quotaWindows and accountSwitches, and /api/admin/receipts reported them
    // as real model_failure switches. DATA_DIR is read at import time, so it must
    // be in the environment before any test module loads, which is what env does.
    env: { DATA_DIR: mkdtempSync(join(tmpdir(), "tokenproxy-test-")) },

    // Node by default — most of the suite is handlers and translators. A test that
    // needs a DOM opts in per file with a `// @vitest-environment jsdom` docblock
    // on its first line (jsdom is pinned in tests/package.json).
    environment: "node",
    // Node 22.4+ ships its own `globalThis.localStorage`, and vitest's jsdom
    // environment copies a window property onto the global only when the name is
    // absent from the global or on its own KEYS list. localStorage is on neither,
    // so Node's stub wins and every storage call fails with "is not a function".
    // Turning the Node implementation off lets jsdom's real Storage through.
    execArgv: ["--no-experimental-webstorage"],
    globals: true,
    include: ["**/*.test.js"],
    // Don't scan into git worktrees nested under .claude/ — they carry their
    // own copies of the test files but lack an installed node_modules (open-sse,
    // etc.), which makes provider imports fail during collection.
    exclude: ["**/node_modules/**", "**/.claude/**", "**/dist/**"],
    // Allow many it.concurrent cases (real provider smoke runs ~50 providers in parallel)
    maxConcurrency: 60,
    // Suppress noisy console output from handlers under test
    silent: false,
  },
  resolve: {
    // Use array form so subpath aliases (e.g. "@/lib/db/index.js") resolve correctly.
    alias: [
      { find: /^open-sse\//, replacement: resolve(__dirname, "../open-sse") + "/" },
      { find: "open-sse", replacement: resolve(__dirname, "../open-sse") },
      { find: /^@\//, replacement: resolve(__dirname, "../src") + "/" },
    ],
  },
});

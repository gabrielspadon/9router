import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(join(root, p), "utf8");

describe("heavy startup runs at boot, not on a page render (#3061, #1312)", () => {
  const instrumentation = read("src/instrumentation.js");
  const layout = read("src/app/layout.js");
  const bootstrap = read("src/shared/services/bootstrap.js");

  it("the server boot hook starts the bootstrap", () => {
    expect(instrumentation).toContain('await import("@/shared/services/bootstrap")');
    // Only the node runtime; the edge runtime cannot run any of this.
    const i = instrumentation.indexOf('NEXT_RUNTIME === "nodejs"');
    expect(i).toBeGreaterThan(-1);
    expect(instrumentation.indexOf('await import("@/shared/services/bootstrap")')).toBeGreaterThan(i);
  });

  it("a failing bootstrap does not take the boot hook down with it", () => {
    const block = instrumentation.slice(
      instrumentation.indexOf('await import("@/shared/services/bootstrap")') - 200,
      instrumentation.indexOf('await import("@/shared/services/bootstrap")') + 200,
    );
    expect(block).toContain("try {");
    expect(block).toContain("catch");
  });

  it("subscribes the webhook watcher before the first request", () => {
    expect(instrumentation).toContain("ensureWatcher()");
  });

  it("keeps the layout import as a no-op fallback rather than the trigger", () => {
    expect(layout).toContain('import "@/shared/services/bootstrap"');
    expect(layout).toContain("src/instrumentation.js");
  });

  it("is idempotent, so running from both places starts it once", () => {
    expect(bootstrap).toContain("global.__appBootstrapped");
  });

  it("still skips during a build", () => {
    expect(bootstrap).toContain("phase-production-build");
  });
});

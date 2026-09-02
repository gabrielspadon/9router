import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.js", import.meta.url),
  "utf8",
);

describe("ProviderLimits diagnostics", () => {
  it("keeps quota failures in the interface instead of the browser console", () => {
    expect(source).not.toMatch(/console\.(log|warn|error)\(/);
  });

  it("reports a failed connection mutation with named recovery feedback", () => {
    expect(source).toContain('import { useNotificationStore } from "@/store/notificationStore";');
    expect(source).toContain("notifyMutationFailure");
    expect(source).toContain("Refresh before retrying.");
  });
});

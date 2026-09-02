import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const files = [
  "src/app/(dashboard)/layout.js",
  "src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js",
  "src/app/(dashboard)/dashboard/endpoint/components/EndpointRow.js",
  "src/app/(dashboard)/dashboard/providers/page.js",
  "src/app/(dashboard)/dashboard/providers/components/AddCompatibleModal.js",
  "src/app/(dashboard)/dashboard/providers/components/NewModelsButton.js",
  "src/app/(dashboard)/dashboard/providers/components/ModelAvailabilityBadge.js",
  "src/app/(dashboard)/dashboard/token-saver/TokenSaverClient.js",
];

describe("primary route import boundaries", () => {
  it("does not pull the all-components barrel into performance-critical routes", () => {
    for (const file of files) {
      const source = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
      expect(source, file).not.toContain('from "@/shared/components"');
    }
  });

  it("loads the Changelog module only after the menu action opens it", () => {
    const source = readFileSync(
      new URL("../../src/shared/components/HeaderMenu.js", import.meta.url),
      "utf8"
    );

    expect(source).not.toMatch(/import\s+ChangelogModal\s+from/);
    expect(source).toMatch(
      /dynamic\(\(\) => import\("\.\/ChangelogModal"\),\s*\{\s*ssr:\s*false\s*\}\)/
    );
    expect(source).toMatch(/\{changelogOpen\s*&&\s*\(\s*<ChangelogModal/);
  });
});

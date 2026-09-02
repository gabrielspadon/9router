import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const bar = readFileSync(resolve(root, "src/shared/components/layouts/JobBar.js"), "utf8");
const layout = readFileSync(resolve(root, "src/shared/components/layouts/DashboardLayout.js"), "utf8");
const sidebar = readFileSync(resolve(root, "src/shared/components/Sidebar.js"), "utf8");

// design-system.md section 10: "At phone width the rail becomes a bottom-anchored
// bar carrying the four jobs." The shell shipped only the off-canvas drawer.
describe("phone job bar", () => {
  it("is rendered by the shell and hidden once the rail itself is visible", () => {
    expect(layout).toContain("<JobBar />");
    expect(bar).toMatch(/lg:hidden/);
  });

  it("carries the four jobs the rail is grouped by, from the rail's own list", () => {
    expect(bar).toMatch(/NAV_JOBS, navItems, NAV_ID_BY_HREF/);
    expect(sidebar).toMatch(/export const NAV_JOBS = \["Connect", "Compose", "Point", "Watch"\]/);
  });

  it("respects minimal mode through the same source the rail reads", () => {
    expect(bar).toMatch(/useNavSettings\(\)/);
    expect(sidebar).toMatch(/useNavSettings\(\)/);
  });

  it("keeps every target at the 44px minimum", () => {
    const targets = bar.match(/min-h-11/g) || [];
    expect(targets.length).toBeGreaterThanOrEqual(2);
  });
});

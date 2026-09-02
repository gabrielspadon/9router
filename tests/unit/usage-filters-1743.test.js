import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const tab = read("../../src/app/(dashboard)/dashboard/usage/components/RequestDetailsTab.js");
const route = read("../../src/app/api/usage/request-details/route.js");
const repo = read("../../src/lib/db/repos/requestDetailsRepo.js");

// The request-details route, the repo and the SQL have accepted model and status
// filters all along; the UI sent only provider and the two dates, so a busy
// install could not narrow by either (#1743).
describe("usage request details can be filtered by model and status (#1743)", () => {
  it("the whole chain below the UI already supported them", () => {
    expect(route).toContain('const model = searchParams.get("model")');
    expect(route).toContain('const status = searchParams.get("status")');
    expect(repo).toContain('if (filter.model) { conds.push("model = ?");');
    expect(repo).toContain('if (filter.status) { conds.push("status = ?");');
  });

  it("the UI now sends them", () => {
    expect(tab).toContain('params.append("model", filters.model.trim())');
    expect(tab).toContain('params.append("status", filters.status)');
  });

  it("both are in the initial state and in Clear Filters", () => {
    // A key missing from either makes the control uncontrolled or unclearable.
    const init = tab.match(/const \[filters, setFilters\] = useState\(\{[\s\S]*?\}\)/)[0];
    expect(init).toContain("model:");
    expect(init).toContain("status:");
    expect(tab).toContain('setFilters({ provider: "", model: "", status: "", startDate: "", endDate: "" })');
  });

  it("each control has a label bound to its input", () => {
    expect(tab).toContain('htmlFor="model-filter"');
    expect(tab).toContain('id="model-filter"');
    expect(tab).toContain('htmlFor="status-filter"');
    expect(tab).toContain('id="status-filter"');
  });

  it("the grid fits five filters without orphaning one", () => {
    expect(tab).toContain("lg:grid-cols-3 xl:grid-cols-5");
  });

  it("an empty filter is not sent, so it does not narrow to nothing", () => {
    // append() with "" would filter on the empty string rather than skip.
    expect(tab).toContain("if (filters.model) params.append");
    expect(tab).toContain("if (filters.status) params.append");
  });
});

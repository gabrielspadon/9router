import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const cli = JSON.parse(readFileSync(new URL("../../cli/package.json", import.meta.url), "utf8"));
const sqliteRuntime = readFileSync(new URL("../../cli/hooks/sqliteRuntime.js", import.meta.url), "utf8");

// The CLI declared >=18 while the runtime needs Node 20: `File` only became a
// global in v20 and undici's fetch internals reference it. A Node 18 user
// installed cleanly and then hit "ReferenceError: File is not defined", which
// surfaces as an unrelated-looking "Invalid" on the provider Check button.
describe("the CLI declares the Node floor it actually needs (#2795)", () => {
  it("requires at least Node 20", () => {
    expect(cli.engines?.node).toBeTruthy();
    const floor = Number(String(cli.engines.node).match(/(\d+)/)?.[1]);
    expect(floor).toBeGreaterThanOrEqual(20);
  });

  it("agrees with the native-module support set, which already starts at 20", () => {
    // sqliteRuntime independently enumerates the majors better-sqlite3 builds
    // for; a floor below its minimum would contradict it.
    const majors = [...sqliteRuntime.matchAll(/BETTER_SQLITE3_NODE_MAJORS = new Set\(\[([^\]]+)\]/g)][0]?.[1];
    expect(majors).toBeTruthy();
    const lowest = Math.min(...majors.split(",").map((n) => Number(n.trim())));
    const floor = Number(String(cli.engines.node).match(/(\d+)/)?.[1]);
    expect(floor).toBeLessThanOrEqual(lowest);
    expect(lowest).toBeGreaterThanOrEqual(20);
  });

  it("File really is the global the floor is about", () => {
    // If this ever stops being true the reason for the floor has changed and
    // this test should be revisited rather than silently kept.
    expect(typeof File).toBe("function");
  });
});

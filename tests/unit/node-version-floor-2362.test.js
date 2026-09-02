import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Opening a dashboard page on Node 18 answered 500 with nothing naming the
// cause (#2362). Next 16 requires >=20.9.0, so that runtime was never supported;
// what was missing is anything that SAYS so. The floor is one number and every
// place that states it has to agree, or the guard tells the user something the
// install already contradicted.
const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));

const nextFloor = read("../../node_modules/next/package.json").engines.node;
const rootPkg = read("../../package.json");
const cliPkg = read("../../cli/package.json");
const server = readFileSync(new URL("../../custom-server.js", import.meta.url), "utf8");

describe("supported Node floor is stated once and consistently (#2362)", () => {
  it("the gateway package declares the floor Next requires", () => {
    expect(rootPkg.engines?.node).toBe(nextFloor);
  });

  it("the CLI launcher declares the same floor", () => {
    expect(cliPkg.engines?.node).toBe(nextFloor);
  });

  it("the server refuses to boot below that floor instead of answering 500", () => {
    const declared = server.match(/const MIN_NODE_VERSION = '([\d.]+)'/)?.[1];
    expect(declared).toBe(nextFloor.replace(/^>=/, ""));
    expect(server).toContain("process.versions.node");
  });
});

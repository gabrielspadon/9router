import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const chat = readFileSync(new URL("../../src/sse/handlers/chat.js", import.meta.url), "utf8");
const security = readFileSync(new URL("../../SECURITY.md", import.meta.url), "utf8");

// REQUIRE_API_KEY appeared in .env.example and the deployment docs while no code
// read it, so an operator who set it believed the /v1 gate was on when it was
// not. A security control that silently does nothing is worse than an absent one.
describe("REQUIRE_API_KEY actually enforces the gate (#2834)", () => {
  it("is read where the gate is decided", () => {
    expect(chat).toContain('process.env.REQUIRE_API_KEY === "true"');
    expect(chat).toContain("const requireApiKey = settings.requireApiKey ||");
  });

  it("can only tighten, never loosen", () => {
    // The stored setting alone must still be able to require a key, so the env
    // var has to be OR'd in, never AND'ed and never used as an override that can
    // turn the requirement off.
    const line = chat.split("\n").find((l) => l.includes("const requireApiKey ="));
    expect(line).toContain("||");
    expect(line).not.toContain("&&");
    expect(line).not.toMatch(/!==\s*"true"/);
    expect(line).not.toMatch(/REQUIRE_API_KEY\s*===\s*"false"/);
  });

  it("still rejects a missing and an invalid key once required", () => {
    const gate = chat.slice(chat.indexOf("if (requireApiKey) {"));
    const body = gate.slice(0, gate.indexOf("\n  }"));
    expect(body).toContain("Missing API key");
    expect(body).toContain("Invalid API key");
    expect(body).toContain("isValidApiKey");
  });

  it("SECURITY.md no longer says it enforces nothing", () => {
    expect(security).not.toMatch(/no code reads it/);
    expect(security).toContain("REQUIRE_API_KEY=true");
    expect(security).toMatch(/can only tighten/);
  });
});

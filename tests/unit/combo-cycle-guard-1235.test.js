import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const chat = readFileSync(new URL("../../src/sse/handlers/chat.js", import.meta.url), "utf8");

// A combo member with no provider is expanded as a combo in its own right —
// nested combos are deliberate. With no cycle guard, a combo naming itself, or
// A listing B while B lists A, recurses until the stack overflows and takes the
// gateway down. Reachable by anyone who can save a combo.
describe("a self-referencing combo is refused, not recursed (#1235)", () => {
  it("refuses to re-enter a combo already being expanded", () => {
    expect(chat).toContain("if (chain.has(modelStr))");
    expect(chat).toContain("Combo cycle refused");
  });

  it("answers with a client error naming the cycle, not a crash", () => {
    const guard = chat.slice(chat.indexOf("if (chain.has(modelStr))"));
    const body = guard.slice(0, guard.indexOf("chain.add(modelStr);"));
    expect(body).toContain("HTTP_STATUS.BAD_REQUEST");
    expect(body).toContain('" -> "');
    expect(body).toContain("contains itself");
  });

  it("records the combo before expanding its members", () => {
    const add = chat.indexOf("chain.add(modelStr);");
    const check = chat.indexOf("if (chain.has(modelStr))");
    expect(check).toBeGreaterThan(0);
    expect(add).toBeGreaterThan(check);
  });

  it("passes a COPY of the chain to each member, so siblings do not poison each other", () => {
    // A shared Set would make the second member look like a cycle merely because
    // the first member had been expanded.
    const nested = chat.slice(chat.indexOf("chain.add(modelStr);"));
    const calls = nested.match(/handleSingleModelChat\([^)]*\)/g) || [];
    const threaded = calls.filter((c) => c.includes("chain"));
    expect(threaded.length).toBeGreaterThanOrEqual(2);
    for (const c of threaded) expect(c, `${c} shares the chain`).toContain("new Set(chain)");
  });

  it("seeds the chain at the top-level dispatch, catching self-reference at the first hop", () => {
    const top = chat.slice(0, chat.indexOf("async function handleSingleModelChat"));
    const seeded = (top.match(/new Set\(\[modelStr\]\)/g) || []).length;
    expect(seeded).toBeGreaterThanOrEqual(2);
  });

  it("leaves the solo capacity-adapter path unseeded, since it is not a combo", () => {
    // That branch is reached only when getComboModels returned nothing, so the
    // model is not a combo and seeding it would assert something untrue.
    const solo = chat.slice(chat.indexOf("Capacity adapter for"));
    const call = solo.slice(0, solo.indexOf("adapterAdded"));
    // Asserted on the cycle-guard argument itself rather than the whole call,
    // so a later parameter added after it does not read as a seeded chain.
    expect(call).toMatch(/handleSingleModelChat\(b, m, clientRawRequest, request, apiKey(, null)?[,)]/);
    expect(call).not.toContain("new Set([modelStr])");
  });
});

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const row = readFileSync(new URL("../../src/app/(dashboard)/dashboard/providers/[id]/ConnectionRow.js", import.meta.url), "utf8");
const card = readFileSync(new URL("../../src/app/(dashboard)/dashboard/providers/components/ConnectionsCard.js", import.meta.url), "utf8");

// The dashboard's "N Error (AUTH/429/...)" badge counts disabled connections,
// but both row renderers hid lastError whenever isActive was false. The operator
// saw a count, clicked in to investigate, and found blank rows.
describe("a disabled connection still shows why it failed (#1447)", () => {
  it.each([["ConnectionRow", row], ["ConnectionsCard", card]])("%s no longer gates the error on isActive", (_n, src) => {
    expect(src).not.toContain("connection.lastError && connection.isActive !== false");
    expect(src).toContain("{connection.lastError && (");
  });

  it.each([["ConnectionRow", row], ["ConnectionsCard", card]])("%s mutes it when disabled rather than dropping it", (_n, src) => {
    expect(src).toContain('connection.isActive === false ? "text-text-muted" : "text-danger"');
  });

  it.each([["ConnectionRow", row], ["ConnectionsCard", card]])("%s keeps the full text on hover", (_n, src) => {
    expect(src).toContain("title={connection.lastError}");
  });

  it("leaves the cooldown timer gated, which is a different question", () => {
    // A cooldown on a disabled connection really is irrelevant: it is not being
    // routed to. Only the error TEXT was the missing information.
    expect(row).toContain("isCooldown && connection.isActive !== false");
  });
});

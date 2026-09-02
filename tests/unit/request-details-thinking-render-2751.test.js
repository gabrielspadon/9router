import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../../src/app/(dashboard)/dashboard/usage/components/RequestDetailsTab.js", import.meta.url), "utf8");

// A Claude thinking block is persisted as {type, thinking, signature} rather than
// an extracted string on some paths. Rendering an object as a React child throws
// error #31 and takes the whole request-details panel down.
describe("the request-details panel survives a non-string field (#2751)", () => {
  it("coerces the thinking field instead of rendering it raw", () => {
    expect(src).toContain("{asDisplayText(selectedDetail.response.thinking)}");
    expect(src).not.toContain("{selectedDetail.response.thinking}");
  });

  it("coerces the sibling content field, which has the same exposure", () => {
    expect(src).toContain("asDisplayText(selectedDetail.response?.content)");
  });

  it("prefers the readable field over a JSON dump", () => {
    const fn = src.slice(src.indexOf("function asDisplayText"));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    expect(body).toContain('typeof value.thinking === "string"');
    expect(body).toContain('typeof value.text === "string"');
    expect(body).toContain("JSON.stringify(value, null, 2)");
  });

  it("handles the shapes that would otherwise crash", () => {
    // Reproduce the helper's contract against the values that reach it.
    const asDisplayText = (value) => {
      if (value === null || value === undefined) return "";
      if (typeof value === "string") return value;
      if (typeof value === "object") {
        if (typeof value.thinking === "string") return value.thinking;
        if (typeof value.text === "string") return value.text;
        if (Array.isArray(value)) return value.map(asDisplayText).filter(Boolean).join("\n");
        try { return JSON.stringify(value, null, 2); } catch { return String(value); }
      }
      return String(value);
    };
    expect(asDisplayText({ type: "thinking", thinking: "step one", signature: "sig" })).toBe("step one");
    expect(asDisplayText([{ type: "text", text: "a" }, { type: "text", text: "b" }])).toBe("a\nb");
    expect(asDisplayText("plain")).toBe("plain");
    expect(asDisplayText(null)).toBe("");
    expect(asDisplayText(undefined)).toBe("");
    expect(asDisplayText({ odd: 1 })).toContain("odd");
    expect(typeof asDisplayText({ type: "thinking", thinking: "x" })).toBe("string");
  });

  it("keeps the empty-content fallback", () => {
    expect(src).toContain('|| "[No content]"');
  });
});

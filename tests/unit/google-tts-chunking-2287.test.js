import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { chunkForTts } from "../../open-sse/handlers/ttsProviders/googleTts.js";

const src = readFileSync(new URL("../../open-sse/handlers/ttsProviders/googleTts.js", import.meta.url), "utf8");
const LIMIT = 200;

// Google Translate TTS rejects long input: past roughly 200 characters the
// batchexecute reply comes back in a different shape and split[0][2] is null, so
// the parse threw "unexpected token" and said nothing about length.
describe("long text is split before it reaches Google TTS (#2287)", () => {
  it("leaves short text as one piece", () => {
    expect(chunkForTts("Hello there.")).toEqual(["Hello there."]);
  });

  it("never emits a piece over the limit", () => {
    const long = "The quick brown fox jumps over the lazy dog. ".repeat(30);
    for (const p of chunkForTts(long)) expect(p.length).toBeLessThanOrEqual(LIMIT);
  });

  it("prefers a sentence boundary and keeps the punctuation", () => {
    const text = "First sentence here. Second sentence here. " + "x".repeat(180);
    const parts = chunkForTts(text);
    expect(parts[0].endsWith(".")).toBe(true);
  });

  it("falls back to a word boundary when there is no sentence break", () => {
    const words = Array.from({ length: 80 }, (_, i) => `word${i}`).join(" ");
    for (const p of chunkForTts(words)) {
      expect(p.length).toBeLessThanOrEqual(LIMIT);
      expect(p.startsWith(" ")).toBe(false);
    }
  });

  it("cuts mid-token only when one token exceeds the cap on its own", () => {
    const parts = chunkForTts("y".repeat(450));
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(LIMIT);
    expect(parts.join("")).toBe("y".repeat(450));
  });

  it("loses no words when rejoined", () => {
    const text = "Alpha beta gamma. Delta epsilon zeta. ".repeat(12).trim();
    const rejoined = chunkForTts(text).join(" ").replace(/\s+/g, " ");
    expect(rejoined).toBe(text.replace(/\s+/g, " "));
  });

  it("handles empty and non-string input", () => {
    expect(chunkForTts("")).toEqual([]);
    expect(chunkForTts(null)).toEqual([]);
    expect(chunkForTts(undefined)).toEqual([]);
  });

  it("concatenates the decoded segments rather than the base64 strings", () => {
    // Joining base64 text would not produce a playable MP3; the buffers must be
    // decoded, concatenated and re-encoded.
    expect(src).toContain('Buffer.from(part, "base64")');
    expect(src).toContain('Buffer.concat(buffers).toString("base64")');
  });
});

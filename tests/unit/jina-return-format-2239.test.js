import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../../open-sse/handlers/fetch/index.js", import.meta.url), "utf8");
const runJina = src.slice(src.indexOf("async function runJina"), src.indexOf("async function runTavily"));

// runJina accepted fmt and then dropped it: the request carried only {url}, so
// every fetch came back in Jina's default format however the caller asked, while
// the response still reported `format: fmt` — describing itself wrongly.
describe("jina-reader honours the requested format (#2239)", () => {
  it("sends the format on the header Jina reads", () => {
    expect(runJina).toContain('"x-return-format"');
  });

  it("only sends a format Jina accepts, so an unknown value cannot 400 the fetch", () => {
    expect(src).toContain("const JINA_RETURN_FORMATS = new Set([");
    for (const f of ["markdown", "html", "text", "screenshot", "pageshot"]) {
      expect(src, `${f} is not offered`).toContain(`"${f}"`);
    }
    expect(runJina).toContain("JINA_RETURN_FORMATS.has(fmt) ? fmt : null");
  });

  it("omits the header rather than sending a bad one", () => {
    expect(runJina).toContain('...(returnFormat ? { "x-return-format": returnFormat } : {})');
  });

  it("reports the format it actually asked for", () => {
    expect(runJina).toContain("format: returnFormat || DEFAULT_FORMAT");
    expect(runJina).not.toContain("title: parseJinaTitle(body), format: fmt,");
  });

  it("still sends the url in the body and the key when there is one", () => {
    expect(runJina).toContain("body: JSON.stringify({ url })");
    expect(runJina).toContain("authorization: `Bearer ${apiKey}`");
  });

  it("the sibling backends already forwarded the format, which is the asymmetry", () => {
    const firecrawl = src.slice(src.indexOf("async function runFirecrawl"), src.indexOf("async function runJina"));
    expect(firecrawl).toContain("formats: [fmt]");
  });
});

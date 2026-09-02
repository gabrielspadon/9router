import { describe, expect, it } from "vitest";
import { stripUnsupportedParams } from "../../open-sse/translator/concerns/paramSupport.js";
import { getStaticCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

// Cloudflare Workers AI rejects the OpenAI content-part array, so its messages
// are flattened to a plain string (#1926). The flatten mapped every NON-text
// block to "" and joined, unconditionally — so an image sent to a VISION model
// was discarded for nothing and the request went upstream as a text-only
// question the user never asked.
const TEXT = { type: "text", text: "describe this" };
const MORE = { type: "text", text: " please" };
const IMAGE = { type: "image_url", image_url: { url: "data:image/png;base64,IMGDATA" } };
const VISION = "@cf/moonshotai/kimi-k2.5";
const TEXT_ONLY = "@cf/meta/llama-3.1-8b-instruct";

const run = (content, model) => {
  const body = { model, messages: [{ role: "user", content }] };
  stripUnsupportedParams("cloudflare-ai", model, body);
  return body.messages[0].content;
};

describe("the Cloudflare flatten is keyed on the model, not the message (#2749)", () => {
  it("the two models really do differ in vision, or this test is vacuous", () => {
    expect(getStaticCapabilitiesForModel("cloudflare-ai", VISION).vision).toBe(true);
    expect(getStaticCapabilitiesForModel("cloudflare-ai", TEXT_ONLY).vision).not.toBe(true);
  });

  it("keeps the array for a vision model, so the image survives", () => {
    const out = run([TEXT, IMAGE], VISION);
    expect(Array.isArray(out)).toBe(true);
    expect(JSON.stringify(out)).toContain("IMGDATA");
  });

  it("still flattens for a text-only model, which is why the rule exists", () => {
    expect(run([TEXT, MORE], TEXT_ONLY)).toBe("describe this please");
  });

  it("a text-only model cannot use the image either way, so dropping it is graceful", () => {
    // Not a regression: this is the #1926 behaviour, and the image is unusable
    // by that model regardless.
    expect(run([TEXT, IMAGE, MORE], TEXT_ONLY)).toBe("describe this please");
  });

  it("leaves a plain string message alone on both", () => {
    expect(run("just text", VISION)).toBe("just text");
    expect(run("just text", TEXT_ONLY)).toBe("just text");
  });

  it("does not touch another provider's messages", () => {
    const body = { model: "gpt-5.5", messages: [{ role: "user", content: [TEXT, IMAGE] }] };
    stripUnsupportedParams("openai", "gpt-5.5", body);
    expect(Array.isArray(body.messages[0].content)).toBe(true);
  });
});

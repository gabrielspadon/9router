/**
 * #2897 "add Pi (pi.dev) coding agent support".
 *
 * Pi keeps every custom provider in one file, `~/.pi/agent/models.json`, and the
 * apply writes the WHOLE file back. That is the same shape that cost this repo
 * `~/.codex/auth.json` once already (see cli-tools-refuse-to-clobber), so the
 * merge is tested on what it PRESERVES, not on what it sets.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import {
  mergePiProvider,
  removePiProvider,
  normalizeBaseUrl,
  getTokenProxyModelIds,
  hasTokenProxy,
} from "@/lib/cliTools/piConfig.js";

const APPLY = { baseUrl: "http://localhost:20128", apiKey: "sk_test", models: ["cc/claude-sonnet-5"] };

describe("mergePiProvider writes the entry Pi's schema documents (#2897)", () => {
  it("produces providers.tokenproxy with baseUrl / api / apiKey / models", () => {
    const out = mergePiProvider(null, APPLY);
    expect(out.providers["tokenproxy"]).toMatchObject({
      baseUrl: "http://localhost:20128/v1",
      api: "openai-completions",
      apiKey: "sk_test",
    });
    expect(out.providers["tokenproxy"].models).toEqual([{ id: "cc/claude-sonnet-5", input: ["text", "image"] }]);
  });

  it("appends /v1 once, and not twice", () => {
    expect(normalizeBaseUrl("http://localhost:20128")).toBe("http://localhost:20128/v1");
    expect(normalizeBaseUrl("http://localhost:20128/v1")).toBe("http://localhost:20128/v1");
    expect(normalizeBaseUrl("http://localhost:20128/")).toBe("http://localhost:20128/v1");
  });

  it("falls back to sk_tokenproxy when no key is chosen", () => {
    expect(mergePiProvider(null, { ...APPLY, apiKey: "" }).providers["tokenproxy"].apiKey).toBe("sk_tokenproxy");
  });
});

describe("the merge keeps everything the user already had (#2897)", () => {
  const existing = {
    defaultModel: "ollama/llama3.1:8b",
    providers: {
      ollama: { baseUrl: "http://localhost:11434/v1", api: "openai-completions", models: [{ id: "llama3.1:8b" }] },
      "tokenproxy": {
        baseUrl: "http://old:1/v1",
        api: "openai-completions",
        apiKey: "sk_old",
        authHeader: true,
        headers: { "X-Mine": "1" },
        models: [{ id: "kept/model", contextWindow: 400000, reasoning: true }],
      },
    },
  };

  it("does not drop another provider", () => {
    const out = mergePiProvider(existing, APPLY);
    expect(out.providers.ollama).toEqual(existing.providers.ollama);
  });

  it("does not drop a top-level key it does not own", () => {
    expect(mergePiProvider(existing, APPLY).defaultModel).toBe("ollama/llama3.1:8b");
  });

  it("keeps the provider's own extra fields while refreshing url and key", () => {
    const p = mergePiProvider(existing, APPLY).providers["tokenproxy"];
    expect(p.authHeader).toBe(true);
    expect(p.headers).toEqual({ "X-Mine": "1" });
    expect(p.baseUrl).toBe("http://localhost:20128/v1");
    expect(p.apiKey).toBe("sk_test");
  });

  it("unions models instead of replacing the array", () => {
    const ids = getTokenProxyModelIds(mergePiProvider(existing, APPLY));
    expect(ids).toEqual(["kept/model", "cc/claude-sonnet-5"]);
  });

  it("leaves a hand-tuned model entry alone when it is re-applied", () => {
    const out = mergePiProvider(existing, { ...APPLY, models: ["kept/model"] });
    expect(out.providers["tokenproxy"].models).toEqual([{ id: "kept/model", contextWindow: 400000, reasoning: true }]);
  });

  it("does not mutate the config it was handed", () => {
    const before = JSON.stringify(existing);
    mergePiProvider(existing, APPLY);
    expect(JSON.stringify(existing)).toBe(before);
  });

  it("refuses a models.json that is not an object, rather than replacing it", () => {
    expect(() => mergePiProvider([1, 2], APPLY)).toThrow(/refusing to overwrite it/);
  });
});

describe("removePiProvider takes out TokenProxy only (#2897)", () => {
  const config = {
    providers: {
      ollama: { baseUrl: "http://localhost:11434/v1", api: "openai-completions" },
      "tokenproxy": { baseUrl: "http://x/v1", api: "openai-completions", models: [{ id: "a" }, { id: "b" }] },
    },
  };

  it("removes one model and keeps the rest", () => {
    const out = removePiProvider(config, "a");
    expect(getTokenProxyModelIds(out)).toEqual(["b"]);
    expect(out.providers.ollama).toBeDefined();
  });

  it("drops the provider once its last model goes", () => {
    const out = removePiProvider(removePiProvider(config, "a"), "b");
    expect(hasTokenProxy(out)).toBe(false);
    expect(out.providers.ollama).toBeDefined();
  });

  it("removes the whole provider when no model is named", () => {
    const out = removePiProvider(config, null);
    expect(hasTokenProxy(out)).toBe(false);
    expect(out.providers.ollama).toBeDefined();
  });

  it("is a no-op on a config that never had TokenProxy", () => {
    const other = { providers: { ollama: {} } };
    expect(removePiProvider(other, null)).toEqual(other);
  });
});

describe("the route pairs the merge with the clobber refusal (#2897)", () => {
  const src = fs.readFileSync(new URL("../../src/app/api/cli-tools/pi-settings/route.js", import.meta.url), "utf8");

  it("reads the existing file through readExistingConfig before writing it back", () => {
    expect(src).toContain("readExistingConfig(configPath, JSON.parse)");
    expect(src).not.toContain("catch { /* No existing config */ }");
  });

  it("is reachable from the batch status endpoint", () => {
    const all = fs.readFileSync(new URL("../../src/app/api/cli-tools/all-statuses/route.js", import.meta.url), "utf8");
    expect(all).toContain('from "../pi-settings/route"');
    expect(all).toContain("pi: piGet,");
  });
});

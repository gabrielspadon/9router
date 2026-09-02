// #2968 — "The 'connection' counter field provided by Cloudflare and Ollama has
// gone wrong", after downloading a backup from v0.5.40 and restoring it into a
// newer build.
//
// `providerConnections.authType` is NOT NULL, so the restore has to put
// something there, and it put "oauth" for every connection whose backup row
// carried no authType. Cloudflare AI and Ollama both declare
// `authModes: ["apikey"]` (open-sse/providers/registry/{cloudflare-ai,ollama}.js)
// and have no OAuth flow at all, so those connections came back filed and
// counted as OAuth accounts. The fallback now asks the provider what it
// supports; an authType present in the backup is never second-guessed.
import { describe, it, expect } from "vitest";
import { importedAuthType } from "@/lib/db/index.js";

// Shape of the field this reads, taken from src/shared/constants/providers.js.
const CATALOG = {
  "cloudflare-ai": { authModes: ["apikey"] },
  ollama: { authModes: ["apikey"] },
  claude: { authModes: ["oauth"] },
  xai: { authModes: ["oauth", "apikey"] },
  kiro: {},
  "cookie-only": { authModes: ["cookie"] },
};

describe("restoring an older backup keeps a connection's auth mode honest (#2968)", () => {
  it("does not hand an api-key-only provider an OAuth mode it has no flow for", () => {
    expect(importedAuthType(undefined, "cloudflare-ai", CATALOG)).toBe("apikey");
    expect(importedAuthType(undefined, "ollama", CATALOG)).toBe("apikey");
    expect(importedAuthType("", "ollama", CATALOG)).toBe("apikey");
    expect(importedAuthType(null, "cloudflare-ai", CATALOG)).toBe("apikey");
  });

  it("never overrides an authType the backup actually carried", () => {
    for (const raw of ["oauth", "apikey", "api_key", "access_token"]) {
      expect(importedAuthType(raw, "cloudflare-ai", CATALOG)).toBe(raw);
      expect(importedAuthType(raw, "claude", CATALOG)).toBe(raw);
    }
  });

  it("keeps oauth wherever the provider can actually do oauth", () => {
    expect(importedAuthType(undefined, "claude", CATALOG)).toBe("oauth");
    // Dual-auth: oauth stays the default, as it was before.
    expect(importedAuthType(undefined, "xai", CATALOG)).toBe("oauth");
  });

  it("keeps oauth when the registry says nothing, which is the old behaviour", () => {
    expect(importedAuthType(undefined, "kiro", CATALOG)).toBe("oauth");
    expect(importedAuthType(undefined, "not-in-registry", CATALOG)).toBe("oauth");
    expect(importedAuthType(undefined, "cloudflare-ai", {})).toBe("oauth");
    expect(importedAuthType(undefined, "cloudflare-ai", undefined)).toBe("oauth");
  });

  it("uses the provider's only declared mode when it is neither oauth nor apikey", () => {
    expect(importedAuthType(undefined, "cookie-only", CATALOG)).toBe("cookie");
  });

  it("agrees with the shipped registry, not just the fixture", async () => {
    const { AI_PROVIDERS } = await import("@/shared/constants/providers");
    // Guard the premise: if either provider ever grows an OAuth mode, this test
    // should fail rather than quietly assert the wrong thing.
    for (const id of ["cloudflare-ai", "ollama"]) {
      expect(AI_PROVIDERS[id]?.authModes).toEqual(["apikey"]);
      expect(importedAuthType(undefined, id, AI_PROVIDERS)).toBe("apikey");
    }
  });
});

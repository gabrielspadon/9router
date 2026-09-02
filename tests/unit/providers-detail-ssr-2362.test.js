// "/dashboard/providers/gemini returns HTTP 500" (#2362). The route is a client
// component, but Next still renders it on the server for the initial document,
// so a throw anywhere in its first render is a 500 on the document itself —
// which is what the reporter saw, plain-text and unstyled.
//
// This sweeps every provider id the registry knows, plus the ids that reach the
// route without a registry entry, through that server render. It is the check
// the report asks for, and it is also the guard: the detail page reads
// provider-shaped data (models, thinking levels, aliases, node type) at render
// time, so a registry entry missing a field a later edit starts assuming would
// reintroduce exactly this failure.
import { describe, it, expect, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: globalThis.__PROVIDER_UNDER_RENDER__ }),
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => "/dashboard/providers",
  useSearchParams: () => new URLSearchParams(),
}));

describe("the provider detail route renders on the server (#2362)", () => {
  it("throws for no provider id, known or unknown", async () => {
    const { renderToString } = await import("react-dom/server");
    const { AI_PROVIDERS } = await import("@/shared/constants/providers.js");
    const { default: ProviderDetailPage } = await import(
      "@/app/(dashboard)/dashboard/providers/[id]/page.js"
    );

    const ids = [
      ...Object.keys(AI_PROVIDERS),
      // Reachable by typing a URL, and by a stale link to a deleted node.
      "nope-not-real",
      "",
      "openai-compatible-chat-gone",
      "anthropic-compatible-gone",
    ];
    expect(ids.length).toBeGreaterThan(100);

    const failures = [];
    for (const id of ids) {
      globalThis.__PROVIDER_UNDER_RENDER__ = id;
      try {
        renderToString(<ProviderDetailPage />);
      } catch (error) {
        failures.push(`${id}: ${error.message}`);
      }
    }
    expect(failures).toEqual([]);
  });
});

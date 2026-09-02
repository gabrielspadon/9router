import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, vi } from "vitest";

const TEMP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tokenproxy-providers-filter-"));
process.env.DATA_DIR = TEMP_DATA_DIR;

vi.mock("next/server", () => ({
  NextResponse: {
    json(body, init = {}) {
      return new Response(JSON.stringify(body), {
        status: init.status || 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  },
}));

const { GET } = await import("@/app/api/providers/route.js");
const { createProviderConnection } = await import("@/models/index.js");

beforeAll(async () => {
  await createProviderConnection({ provider: "openai", apiKey: "k-openai", name: "OpenAI one" });
  await createProviderConnection({ provider: "openai", apiKey: "k-openai-2", name: "OpenAI two" });
  await createProviderConnection({ provider: "groq", apiKey: "k-groq", name: "Groq one" });
});

const list = async (query = "") => {
  const response = await GET(new Request(`https://tokenproxy.local/api/providers${query}`));
  expect(response.status).toBe(200);
  return (await response.json()).connections;
};

// #2998: the provider detail page pulled the whole connection table on every
// visit and threw away everything belonging to another provider. The repository
// has always taken a provider filter; the route just never offered it.
describe("provider connection listing filter (#2998)", () => {
  it("returns only the requested provider's connections", async () => {
    const connections = await list("?provider=openai");

    expect(connections).toHaveLength(2);
    expect(connections.every((c) => c.provider === "openai")).toBe(true);
  });

  it("still lists every provider when no filter is given", async () => {
    const connections = await list();

    expect(connections).toHaveLength(3);
    expect(new Set(connections.map((c) => c.provider))).toEqual(new Set(["openai", "groq"]));
  });

  it("resolves a display-name spelling to the stored provider id", async () => {
    expect(await list("?provider=OpenAI")).toHaveLength(2);
  });

  it("treats a blank filter as unfiltered and an unknown one as empty", async () => {
    expect(await list("?provider=%20%20")).toHaveLength(3);
    expect(await list("?provider=not-a-provider")).toHaveLength(0);
  });

  it("keeps redacting secrets on the filtered path", async () => {
    for (const connection of await list("?provider=openai")) {
      expect(connection.apiKey).not.toBe("k-openai");
    }
  });
});

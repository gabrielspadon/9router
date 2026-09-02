import { describe, it, expect, vi, beforeEach } from "vitest";

const store = { combos: [] };

vi.mock("@/lib/localDb", () => ({
  getComboById: vi.fn(async (id) => store.combos.find((c) => c.id === id) || null),
  getComboByName: vi.fn(async (name) => store.combos.find((c) => c.name === name) || null),
  getCombos: vi.fn(async () => store.combos),
  updateCombo: vi.fn(async (id, patch) => ({ ...store.combos.find((c) => c.id === id), ...patch })),
  deleteCombo: vi.fn(async () => true),
  getSettings: vi.fn(async () => ({})),
  updateSettings: vi.fn(async () => ({})),
}));
vi.mock("open-sse/services/combo.js", () => ({
  validateComboAcyclic: () => ({ valid: true }),
  resetComboRotation: vi.fn(),
}));

const { PUT } = await import("@/app/api/combos/[id]/route.js");

const put = (id, body) => PUT({ json: async () => body }, { params: Promise.resolve({ id }) });

beforeEach(() => {
  store.combos = [
    { id: "a", name: "shared", models: ["p/one"] },
    { id: "b", name: "shared", models: ["p/two"] },
    { id: "c", name: "unique", models: [] },
  ];
});

describe("editing a combo without renaming it (#2763)", () => {
  it("saves even when another row already holds the same name", async () => {
    // Two rows share a name because combos(name) has no unique constraint. The
    // lookup returns one of them, and the other used to be unsaveable forever.
    const res = await put("b", { name: "shared", models: ["p/two", "p/three"] });
    expect(res.status ?? 200).toBe(200);
    expect((await res.json()).error).toBeUndefined();
  });

  it("saves a combo whose name is the one the lookup returns", async () => {
    const res = await put("a", { name: "shared", models: [] });
    expect((await res.json()).error).toBeUndefined();
  });

  it("still refuses a rename onto a name another combo holds", async () => {
    const res = await put("c", { name: "shared", models: [] });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Combo name already exists");
  });

  it("allows a rename to a name nobody holds", async () => {
    const res = await put("c", { name: "fresh", models: [] });
    expect((await res.json()).error).toBeUndefined();
  });

  it("still rejects an invalid name", async () => {
    const res = await put("c", { name: "has space" });
    expect(res.status).toBe(400);
  });

  it("still reports a missing combo rather than a name collision", async () => {
    const res = await put("nope", { name: "shared" });
    expect(res.status).toBe(404);
  });
});

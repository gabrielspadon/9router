import { describe, it, expect, vi, beforeEach } from "vitest";

// #1030 asks for "Import Models" and "Refresh" controls on every model page.
// Refresh already has its endpoints (POST /api/models/free-sync for the synced
// free catalogues, GET /api/providers/{id}/models for a connection's live one).
// Import had none: registering a fetched catalogue meant one POST per model,
// each rewriting the capability overrides. The buttons are the dashboard's;
// this is the endpoint they need.
const addCustomModel = vi.fn();
const refreshModelCapabilityOverrides = vi.fn();

vi.mock("@/models", () => ({
  getCustomModels: vi.fn(),
  addCustomModel: (...a) => addCustomModel(...a),
  deleteCustomModel: vi.fn(),
}));
vi.mock("@/lib/modelCapabilityOverrides", () => ({
  refreshModelCapabilityOverrides: (...a) => refreshModelCapabilityOverrides(...a),
}));

const { POST } = await import("@/app/api/models/custom/route.js");

const post = async (body) => {
  const res = await POST({ json: async () => body });
  return { status: res.status, body: await res.json() };
};

beforeEach(() => {
  addCustomModel.mockReset().mockResolvedValue(true);
  refreshModelCapabilityOverrides.mockReset().mockResolvedValue(undefined);
});

describe("custom models can be imported as a batch (#1030)", () => {
  it("registers every model in one request and reports the count", async () => {
    const { body } = await post({
      models: [
        { providerAlias: "p", id: "a" },
        { providerAlias: "p", id: "b" },
        { providerAlias: "p", id: "c" },
      ],
    });

    expect(addCustomModel).toHaveBeenCalledTimes(3);
    expect(body).toMatchObject({ success: true, added: 3 });
  });

  it("refreshes the capability overrides once, not once per model", async () => {
    await post({ models: [{ providerAlias: "p", id: "a" }, { providerAlias: "p", id: "b" }] });

    expect(refreshModelCapabilityOverrides).toHaveBeenCalledTimes(1);
  });

  it("counts a model that was already registered as imported-but-not-added", async () => {
    addCustomModel.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const { body } = await post({
      models: [{ providerAlias: "p", id: "a" }, { providerAlias: "p", id: "b" }],
    });

    expect(body.success).toBe(true);
    expect(body.added).toBe(1);
    expect(body.results).toEqual([
      { id: "a", success: true, added: true },
      { id: "b", success: true, added: false },
    ]);
  });

  it("reports a bad entry against that entry, keeping the rest of the import", async () => {
    const { body } = await post({
      models: [
        { providerAlias: "p", id: "a" },
        { providerAlias: "p" },
        { providerAlias: "p", id: "c", maxInputTokens: 0 },
      ],
    });

    expect(addCustomModel).toHaveBeenCalledTimes(1);
    expect(body.success).toBe(false);
    expect(body.results[1]).toEqual({
      id: null,
      success: false,
      error: "providerAlias and id required",
    });
    expect(body.results[2].error).toContain("maxInputTokens");
  });

  it("applies the same field validation the single shape applies", async () => {
    const { body } = await post({ models: [{ providerAlias: "p", id: "a", vision: "yes" }] });

    expect(addCustomModel).not.toHaveBeenCalled();
    expect(body.results[0].error).toBe("vision must be a boolean");
  });

  it("refuses an empty or oversized batch outright", async () => {
    const empty = await post({ models: [] });
    expect(empty.status).toBe(400);

    const huge = await post({
      models: Array.from({ length: 1001 }, (_, i) => ({ providerAlias: "p", id: `m${i}` })),
    });
    expect(huge.status).toBe(400);
    expect(addCustomModel).not.toHaveBeenCalled();
  });

  it("still answers a single model the way it always did", async () => {
    const { body } = await post({ providerAlias: "p", id: "a", vision: true });

    expect(addCustomModel).toHaveBeenCalledWith({
      providerAlias: "p",
      id: "a",
      type: "llm",
      name: undefined,
      maxInputTokens: undefined,
      maxOutputTokens: undefined,
      vision: true,
    });
    expect(body).toEqual({ success: true, added: true });
  });
});

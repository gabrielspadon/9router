import { beforeEach, describe, expect, it, vi } from "vitest";
import * as comboService from "../../open-sse/services/combo.js";

const db = vi.hoisted(() => ({
  createCombo: vi.fn(),
  deleteCombo: vi.fn(),
  getComboById: vi.fn(),
  getComboByName: vi.fn(),
  getCombos: vi.fn(),
  updateCombo: vi.fn(),
}));

vi.mock("@/lib/localDb", () => db);

const { POST: createCombo } = await import("../../src/app/api/combos/route.js");
const { PUT: updateCombo } = await import("../../src/app/api/combos/[id]/route.js");

function jsonRequest(body) {
  return new Request("http://localhost/api/combos", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("combo graph validation (#1423)", () => {
  it("rejects an indirect cycle reached through a provider-prefixed combo member", () => {
    const validation = comboService.validateComboAcyclic({
      name: "alpha",
      models: ["openrouter/beta"],
      combosData: [
        { id: "beta", name: "beta", models: ["alpha"] },
      ],
    });

    expect(validation).toEqual({
      valid: false,
      error: "Combo circular dependency detected: alpha -> beta -> alpha",
    });
  });

  it("accepts a chain ending at real provider models", () => {
    const validation = comboService.validateComboAcyclic({
      name: "alpha",
      models: ["beta", "openai/gpt-5"],
      combosData: [
        { id: "beta", name: "beta", models: ["anthropic/claude-sonnet"] },
      ],
    });

    expect(validation).toEqual({ valid: true, error: null });
  });
});

describe("combo API cycle validation (#1423)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.getCombos.mockResolvedValue([]);
    db.getComboByName.mockResolvedValue(null);
  });

  it("rejects a direct cycle before creating the combo", async () => {
    const response = await createCombo(jsonRequest({
      name: "alpha",
      models: ["alpha"],
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Combo circular dependency detected: alpha -> alpha",
    });
    expect(db.createCombo).not.toHaveBeenCalled();
  });

  it("rejects an update that closes an indirect cycle", async () => {
    db.getComboById.mockResolvedValue({
      id: "alpha-id",
      name: "alpha",
      models: ["openai/gpt-5"],
    });
    db.getCombos.mockResolvedValue([
      { id: "alpha-id", name: "alpha", models: ["openai/gpt-5"] },
      { id: "beta-id", name: "beta", models: ["alpha"] },
    ]);

    const response = await updateCombo(
      jsonRequest({ models: ["beta"] }),
      { params: Promise.resolve({ id: "alpha-id" }) },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Combo circular dependency detected: alpha -> beta -> alpha",
    });
    expect(db.updateCombo).not.toHaveBeenCalled();
  });
});

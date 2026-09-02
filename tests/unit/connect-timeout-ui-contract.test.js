import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  buildConnectTimeoutPayload,
  extractConfirmedConnectTimeout,
  parseConnectTimeoutDraft,
  saveConnectTimeout,
} from "../../src/shared/utils/connectTimeoutInput.js";

describe("connect timeout input contract", () => {
  it("resets empty global draft to 15000", () => {
    expect(parseConnectTimeoutDraft("", { provider: false })).toEqual({
      ok: true,
      value: 15000,
      canonical: "15000",
    });
  });

  it("unsets empty provider draft", () => {
    expect(parseConnectTimeoutDraft("   ", { provider: true })).toEqual({
      ok: true,
      value: null,
      canonical: "",
    });
  });

  it.each(["999", "120001", "15000.5", "1e4", "abc", "-1000"])(
    "rejects draft %s",
    (draft) => {
      expect(parseConnectTimeoutDraft(draft, { provider: false })).toMatchObject({ ok: false });
    },
  );

  it.each(["1000", "15000", "120000"])("accepts canonical integer %s", (draft) => {
    expect(parseConnectTimeoutDraft(draft, { provider: false })).toEqual({
      ok: true,
      value: Number(draft),
      canonical: draft,
    });
  });

  it("builds global and provider payloads", () => {
    expect(buildConnectTimeoutPayload({ value: 15000 })).toEqual({ connectTimeoutMs: 15000 });
    expect(buildConnectTimeoutPayload({ providerId: "qoder", value: 8000 })).toEqual({
      providerStrategyPatch: { providerId: "qoder", values: { connectTimeoutMs: 8000 } },
    });
    expect(buildConnectTimeoutPayload({ providerId: "qoder", value: null })).toEqual({
      providerStrategyPatch: { providerId: "qoder", values: { connectTimeoutMs: null } },
    });
  });

  it("extracts server-confirmed values", () => {
    const settings = {
      connectTimeoutMs: 15000,
      providerStrategies: { qoder: { connectTimeoutMs: 8000 } },
    };
    expect(extractConfirmedConnectTimeout(settings)).toBe(15000);
    expect(extractConfirmedConnectTimeout(settings, "qoder")).toBe(8000);
    expect(extractConfirmedConnectTimeout(settings, "codex")).toBe(null);
  });

  it("throws on non-OK save and returns validated server state on success", async () => {
    const failedFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "rejected" }), { status: 400 }),
    );
    await expect(saveConnectTimeout({ fetchImpl: failedFetch, value: 15000 })).rejects.toThrow(
      "rejected",
    );
    const okFetch = vi.fn().mockResolvedValue(
      Response.json({ connectTimeoutMs: 16000, providerStrategies: {} }),
    );
    await expect(saveConnectTimeout({ fetchImpl: okFetch, value: 16000 })).resolves.toMatchObject({
      confirmed: 16000,
    });
    expect(okFetch).toHaveBeenCalledTimes(1);
  });

  it("requires the server to confirm the exact requested value", async () => {
    const missingProvider = vi.fn().mockResolvedValue(
      Response.json({
        connectTimeoutMs: 15000,
        providerStrategies: {},
      }),
    );
    await expect(
      saveConnectTimeout({
        fetchImpl: missingProvider,
        providerId: "qoder",
        value: 8000,
      }),
    ).rejects.toThrow("did not confirm");

    const staleGlobal = vi.fn().mockResolvedValue(
      Response.json({
        connectTimeoutMs: 15000,
        providerStrategies: {},
      }),
    );
    await expect(saveConnectTimeout({ fetchImpl: staleGlobal, value: 16000 })).rejects.toThrow(
      "did not confirm",
    );
  });

  it("accepts null only when confirming a provider unset", async () => {
    const unsetFetch = vi.fn().mockResolvedValue(
      Response.json({
        connectTimeoutMs: 15000,
        providerStrategies: {},
      }),
    );
    await expect(
      saveConnectTimeout({
        fetchImpl: unsetFetch,
        providerId: "qoder",
        value: null,
      }),
    ).resolves.toMatchObject({ confirmed: null });
  });

  it("rejects a provider unset when the server retains an own null field", async () => {
    const retainedNullFetch = vi.fn().mockResolvedValue(
      Response.json({
        connectTimeoutMs: 15000,
        providerStrategies: { qoder: { connectTimeoutMs: null } },
      }),
    );

    await expect(
      saveConnectTimeout({
        fetchImpl: retainedNullFetch,
        providerId: "qoder",
        value: null,
      }),
    ).rejects.toThrow("did not confirm");
  });

  it.each([
    ["missing", {}],
    ["null", { providerStrategies: null }],
    ["array", { providerStrategies: [] }],
  ])("rejects a %s provider strategy envelope", async (_label, data) => {
    const malformedFetch = vi.fn().mockResolvedValue(Response.json(data));

    await expect(
      saveConnectTimeout({
        fetchImpl: malformedFetch,
        providerId: "qoder",
        value: null,
      }),
    ).rejects.toThrow("did not confirm");
  });

  it("keeps request execution out of the component and commits only on blur", () => {
    const componentSource = readFileSync(
      new URL("../../src/shared/components/ConnectTimeoutInput.js", import.meta.url),
      "utf8",
    );
    expect(componentSource).toContain("setDraft(event.target.value)");
    expect(componentSource).toContain("onBlur={commit}");
    expect(componentSource).toContain("event.currentTarget.blur()");
    expect(componentSource).not.toContain("fetch(");
  });

  it("renders global and provider controls from server-confirmed settings", () => {
    const profileSource = readFileSync(
      new URL("../../src/app/(dashboard)/dashboard/profile/page.js", import.meta.url),
      "utf8",
    );
    const providerSource = readFileSync(
      new URL("../../src/app/(dashboard)/dashboard/providers/[id]/page.js", import.meta.url),
      "utf8",
    );

    expect(profileSource).toContain('import ConnectTimeoutInput from "@/shared/components/ConnectTimeoutInput"');
    expect(profileSource).toContain("<ConnectTimeoutInput");
    expect(profileSource).toContain("value={settings.connectTimeoutMs}");
    expect(profileSource).toContain("setSettings((previous)");
    expect(providerSource).toContain('import ConnectTimeoutInput from "@/shared/components/ConnectTimeoutInput"');
    expect(providerSource).toContain("providerId={providerId}");
    expect(providerSource).toContain("value={providerConnectTimeoutMs}");
    expect(providerSource).toContain("setProviderConnectTimeoutMs(value)");
  });

  it("wires an accessible provider-wide Codex Sol Fast control through the persistent queue", () => {
    const providerSource = readFileSync(
      new URL("../../src/app/(dashboard)/dashboard/providers/[id]/page.js", import.meta.url),
      "utf8",
    );
    expect(providerSource).toContain('providerId === "codex"');
    expect(providerSource).toContain('ariaLabel="Use Fast tier for Codex Sol models"');
    expect(providerSource).toContain("Sol and Sol Review only");
    expect(providerSource).toContain("all Codex accounts");
    expect(providerSource).toContain("2.5× subscription credits");
    expect(providerSource).toContain("backend may fall back to Standard");
    expect(providerSource).toContain("values: { fastMode: enabled ? true : null }");
    expect(providerSource).toContain("enqueueProviderStrategySave({");
    expect(providerSource).toContain("onStart:");
    expect(providerSource).toContain("onSuccess:");
    expect(providerSource).toContain("onError:");
    expect(providerSource).toContain('role="alert"');
    // The Toggle's accessible name is asserted as behaviour in
    // tests/unit/toggle-accessible-name.test.js rather than as source text here.
    // A string match on a component's implementation breaks when the
    // implementation improves, which is what happened to this line.
  });
});

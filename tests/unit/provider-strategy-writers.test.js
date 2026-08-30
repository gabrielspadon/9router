import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

const providerPageSource = readFileSync(
  new URL("../../src/app/(dashboard)/dashboard/providers/[id]/page.js", import.meta.url),
  "utf8",
);
const connectionsCardSource = readFileSync(
  new URL(
    "../../src/app/(dashboard)/dashboard/providers/components/ConnectionsCard.js",
    import.meta.url,
  ),
  "utf8",
);
const noAuthProxySource = readFileSync(
  new URL("../../src/shared/components/NoAuthProxyCard.js", import.meta.url),
  "utf8",
);

async function loadHelper() {
  return import("../../src/shared/utils/providerStrategyPatch.js");
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe("provider strategy writer source contract", () => {
  it("uses a persistent queue from every event-driven writer", () => {
    for (const source of [providerPageSource, connectionsCardSource, noAuthProxySource]) {
      expect(source).toContain("createProviderStrategySaveQueue");
      expect(source).toContain("enqueueProviderStrategySave");
      expect(source).not.toContain("await saveProviderStrategyPatch(");
      expect(source).not.toContain("JSON.stringify({ providerStrategies: updated })");
    }
  });

  it("makes provider-page sticky edits draft-only until blur or Enter", () => {
    expect(providerPageSource).toContain("providerStrategySaving");
    expect(providerPageSource).toContain("disabled={providerStrategySaving}");
    expect(providerPageSource).toContain("onBlur={handleStickyLimitCommit}");
    expect(providerPageSource).toContain("event.currentTarget.blur()");
    expect(providerPageSource).toContain("onChange={(event) => setProviderStickyLimit(event.target.value)}");
  });

  it("makes media-provider sticky edits draft-only and disables only strategy controls", () => {
    expect(connectionsCardSource).toContain("strategySaving");
    expect(connectionsCardSource).toContain("disabled={strategySaving}");
    expect(connectionsCardSource).toContain("onBlur={handleStickyLimitCommit}");
    expect(connectionsCardSource).toContain("event.currentTarget.blur()");
    expect(connectionsCardSource).toContain(
      "onChange={(event) => setProviderStickyLimit(event.target.value)}",
    );
  });

  it("keeps no-auth controls disabled until queued saves settle and reports errors", () => {
    expect(noAuthProxySource).toContain("disabled={saving || isRotation}");
    expect(noAuthProxySource).toContain("disabled={saving}");
    expect(noAuthProxySource).toContain("setError(");
    expect(noAuthProxySource).toContain("text-red-500");
  });
});

describe("provider strategy atomic patch helper", () => {
  it("builds exact fallback and proxy payloads", async () => {
    const { buildProviderStrategyPatch } = await loadHelper();

    expect(
      buildProviderStrategyPatch("qoder", {
        fallbackStrategy: "round-robin",
        stickyRoundRobinLimit: 2,
      }),
    ).toEqual({
      providerStrategyPatch: {
        providerId: "qoder",
        values: {
          fallbackStrategy: "round-robin",
          stickyRoundRobinLimit: 2,
        },
      },
    });
    expect(
      buildProviderStrategyPatch("qoder", {
        fallbackStrategy: null,
        stickyRoundRobinLimit: null,
      }),
    ).toEqual({
      providerStrategyPatch: {
        providerId: "qoder",
        values: { fallbackStrategy: null, stickyRoundRobinLimit: null },
      },
    });
    expect(
      buildProviderStrategyPatch("opencode", {
        proxyPoolId: null,
        rotateStrategy: "random",
      }),
    ).toEqual({
      providerStrategyPatch: {
        providerId: "opencode",
        values: { proxyPoolId: null, rotateStrategy: "random" },
      },
    });
  });

  it("rejects HTTP failure, malformed success, stale values, and undeleted values", async () => {
    const { saveProviderStrategyPatch } = await loadHelper();
    const failedFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "rejected" }), { status: 400 }),
    );
    await expect(
      saveProviderStrategyPatch({
        fetchImpl: failedFetch,
        providerId: "qoder",
        values: { fallbackStrategy: "round-robin" },
      }),
    ).rejects.toThrow("rejected");

    const malformedFetch = vi.fn().mockResolvedValue(Response.json({ providerStrategies: {} }));
    await expect(
      saveProviderStrategyPatch({
        fetchImpl: malformedFetch,
        providerId: "qoder",
        values: { fallbackStrategy: "round-robin" },
      }),
    ).rejects.toThrow("did not confirm");

    const staleFetch = vi.fn().mockResolvedValue(
      Response.json({ providerStrategies: { qoder: { fallbackStrategy: "fill-first" } } }),
    );
    await expect(
      saveProviderStrategyPatch({
        fetchImpl: staleFetch,
        providerId: "qoder",
        values: { fallbackStrategy: "round-robin" },
      }),
    ).rejects.toThrow("did not confirm");

    const undeletedFetch = vi.fn().mockResolvedValue(
      Response.json({ providerStrategies: { qoder: { stickyRoundRobinLimit: 2 } } }),
    );
    await expect(
      saveProviderStrategyPatch({
        fetchImpl: undeletedFetch,
        providerId: "qoder",
        values: { stickyRoundRobinLimit: null },
      }),
    ).rejects.toThrow("did not confirm");
  });

  it("returns server settings only after every requested set and deletion is confirmed", async () => {
    const { saveProviderStrategyPatch } = await loadHelper();
    const fetchImpl = vi.fn().mockResolvedValue(
      Response.json({
        connectTimeoutMs: 15000,
        providerStrategies: {
          qoder: { fallbackStrategy: "round-robin", connectTimeoutMs: 8000 },
        },
      }),
    );

    await expect(
      saveProviderStrategyPatch({
        fetchImpl,
        providerId: "qoder",
        values: { fallbackStrategy: "round-robin", stickyRoundRobinLimit: null },
      }),
    ).resolves.toMatchObject({ connectTimeoutMs: 15000 });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({
      providerStrategyPatch: {
        providerId: "qoder",
        values: { fallbackStrategy: "round-robin", stickyRoundRobinLimit: null },
      },
    });
  });

  it("rejects a deletion confirmation that retains the field as own null", async () => {
    const { saveProviderStrategyPatch } = await loadHelper();
    const fetchImpl = vi.fn().mockResolvedValue(
      Response.json({
        providerStrategies: { qoder: { stickyRoundRobinLimit: null } },
      }),
    );

    await expect(
      saveProviderStrategyPatch({
        fetchImpl,
        providerId: "qoder",
        values: { stickyRoundRobinLimit: null },
      }),
    ).rejects.toThrow("did not confirm");
  });

  it.each([
    ["missing", {}],
    ["null", { providerStrategies: null }],
    ["array", { providerStrategies: [] }],
    ["null provider", { providerStrategies: { qoder: null } }],
    ["array provider", { providerStrategies: { qoder: [] } }],
  ])("rejects a %s confirmation envelope for deletion-only patches", async (_label, data) => {
    const { saveProviderStrategyPatch } = await loadHelper();
    const fetchImpl = vi.fn().mockResolvedValue(Response.json(data));

    await expect(
      saveProviderStrategyPatch({
        fetchImpl,
        providerId: "qoder",
        values: { stickyRoundRobinLimit: null },
      }),
    ).rejects.toThrow("did not confirm");
  });

  it("rejects inherited provider and field confirmations", async () => {
    const { saveProviderStrategyPatch } = await loadHelper();
    const inheritedProviderStrategies = Object.create({
      qoder: { stickyRoundRobinLimit: null },
    });
    const inheritedField = Object.create({ stickyRoundRobinLimit: null });

    for (const providerStrategies of [
      inheritedProviderStrategies,
      { qoder: inheritedField },
    ]) {
      const fetchImpl = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ providerStrategies }),
      });
      await expect(
        saveProviderStrategyPatch({
          fetchImpl,
          providerId: "qoder",
          values: { stickyRoundRobinLimit: null },
        }),
      ).rejects.toThrow("did not confirm");
    }
  });

  it("accepts absent-key deletion while preserving unrelated sibling fields", async () => {
    const { saveProviderStrategyPatch } = await loadHelper();
    const data = {
      providerStrategies: {
        qoder: { fallbackStrategy: "round-robin", connectTimeoutMs: 8000 },
      },
    };
    const fetchImpl = vi.fn().mockResolvedValue(Response.json(data));

    await expect(
      saveProviderStrategyPatch({
        fetchImpl,
        providerId: "qoder",
        values: { stickyRoundRobinLimit: null },
      }),
    ).resolves.toEqual(data);
  });

  it("serializes same-field writes and keeps busy true through the final confirmation", async () => {
    const { createProviderStrategySaveQueue, saveProviderStrategyPatch } = await loadHelper();
    const firstResponse = deferred();
    const secondResponse = deferred();
    const fetchImpl = vi
      .fn()
      .mockImplementationOnce(() => firstResponse.promise)
      .mockImplementationOnce(() => secondResponse.promise);
    const busyChanges = [];
    const enqueue = createProviderStrategySaveQueue(
      saveProviderStrategyPatch,
      (busy) => busyChanges.push(busy),
    );

    const first = enqueue({
      fetchImpl,
      providerId: "qoder",
      values: { fallbackStrategy: "round-robin" },
    });
    const second = enqueue({
      fetchImpl,
      providerId: "qoder",
      values: { fallbackStrategy: null },
    });

    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    expect(busyChanges).toEqual([true]);
    firstResponse.resolve(
      Response.json({ providerStrategies: { qoder: { fallbackStrategy: "round-robin" } } }),
    );
    await first;
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
    expect(busyChanges).toEqual([true]);
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toEqual({
      providerStrategyPatch: {
        providerId: "qoder",
        values: { fallbackStrategy: null },
      },
    });
    secondResponse.resolve(Response.json({ providerStrategies: {} }));
    await expect(second).resolves.toMatchObject({ providerStrategies: {} });
    expect(busyChanges).toEqual([true, false]);
  });

  it("continues queued writes after rejection without clearing busy early", async () => {
    const { createProviderStrategySaveQueue, saveProviderStrategyPatch } = await loadHelper();
    const firstResponse = deferred();
    const secondResponse = deferred();
    const fetchImpl = vi
      .fn()
      .mockImplementationOnce(() => firstResponse.promise)
      .mockImplementationOnce(() => secondResponse.promise);
    const busyChanges = [];
    const enqueue = createProviderStrategySaveQueue(
      saveProviderStrategyPatch,
      (busy) => busyChanges.push(busy),
    );

    const first = enqueue({
      fetchImpl,
      providerId: "qoder",
      values: { stickyRoundRobinLimit: 2 },
    });
    const second = enqueue({
      fetchImpl,
      providerId: "qoder",
      values: { stickyRoundRobinLimit: 4 },
    });

    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    firstResponse.resolve(new Response(JSON.stringify({ error: "first failed" }), { status: 500 }));
    await expect(first).rejects.toThrow("first failed");
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
    expect(busyChanges).toEqual([true]);
    secondResponse.resolve(
      Response.json({ providerStrategies: { qoder: { stickyRoundRobinLimit: 4 } } }),
    );
    await expect(second).resolves.toMatchObject({
      providerStrategies: { qoder: { stickyRoundRobinLimit: 4 } },
    });
    expect(busyChanges).toEqual([true, false]);
  });
});

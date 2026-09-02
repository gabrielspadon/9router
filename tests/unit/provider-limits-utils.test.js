import { describe, expect, it } from "vitest";
import { isQuotaCollectionDepleted } from "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";

describe("ProviderLimits quota depletion", () => {
  it("keeps a connection available while a usable secondary pool remains", () => {
    const quotas = [
      { name: "credit", used: 50, total: 50 },
      { name: "credit_freetrial", used: 0, total: 500 },
    ];

    expect(isQuotaCollectionDepleted(quotas, 5)).toBe(false);
  });

  it("marks a connection depleted after every usable pool reaches the threshold", () => {
    const quotas = [
      { name: "credit", used: 50, total: 50 },
      { name: "credit_freetrial", used: 495, total: 500 },
    ];

    expect(isQuotaCollectionDepleted(quotas, 5)).toBe(true);
  });

  it("fails open for a positive-total pool with a non-finite explicit remaining value", () => {
    const quotas = [
      { name: "credit", used: 50, total: 50 },
      { name: "credit_freetrial", total: 500, remaining: Number.NaN },
    ];

    expect(isQuotaCollectionDepleted(quotas, 5)).toBe(false);
  });
});

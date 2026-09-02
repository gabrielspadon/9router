import { beforeEach, describe, expect, it, vi } from "vitest";

const randomInt = vi.hoisted(() => vi.fn());

vi.mock("crypto", () => ({ randomInt }));

const { generateShortId } = await import("../../src/lib/tunnel/shared/state.js");

const ALPHABET = "abcdefghijklmnpqrstuvwxyz23456789";

describe("public tunnel short ID generation", () => {
  beforeEach(() => {
    randomInt.mockReset();
  });

  it("uses cryptographic bounded draws while preserving the public ID format", () => {
    randomInt.mockImplementation((max) => randomInt.mock.calls.length - 1);

    const shortId = generateShortId();

    expect(shortId).toBe(ALPHABET.slice(0, 6));
    expect(shortId).toMatch(/^[abcdefghijklmnpqrstuvwxyz23456789]{6}$/);
    expect(randomInt).toHaveBeenCalledTimes(6);
    expect(randomInt).toHaveBeenNthCalledWith(1, ALPHABET.length);
    expect(randomInt).toHaveBeenNthCalledWith(6, ALPHABET.length);
  });
});

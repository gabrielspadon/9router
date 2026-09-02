import { describe, expect, it } from "vitest";

import { classifyAntigravityValidation } from "../../open-sse/services/antigravityValidation.js";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";
import antigravity from "../../open-sse/providers/registry/antigravity.js";

// #2632: an account Google has gated behind browser verification answers the
// CHAT call with a 403 VALIDATION_REQUIRED. Chat runs on the daily host, so the
// ErrorInfo carries that domain — read it from the registry rather than a
// literal, so moving the transport moves this test with it.
const CHAT_HOST = new URL(antigravity.transport.baseUrls[0]).hostname;
const VALIDATION_URL = "https://accounts.google.com/AccountChooser?token=opaque#step";

const rpc403 = (domain) => ({
  error: {
    code: 403,
    message: "validation needed",
    details: [
      {
        "@type": "type.googleapis.com/google.rpc.ErrorInfo",
        domain,
        reason: "VALIDATION_REQUIRED",
        metadata: {},
      },
      {
        "@type": "type.googleapis.com/google.rpc.Help",
        links: [{ url: VALIDATION_URL }],
      },
    ],
  },
});

describe("Antigravity chat-host verification 403 (#2632)", () => {
  it("the chat transport really is the daily host", () => {
    expect(CHAT_HOST).toBe("daily-cloudcode-pa.googleapis.com");
  });

  it("classifies a VALIDATION_REQUIRED 403 raised by the chat host", () => {
    expect(classifyAntigravityValidation({ status: 403, payload: rpc403(CHAT_HOST), source: "chat" }))
      .toEqual({ kind: "antigravity_validation_required", url: VALIDATION_URL, source: "chat" });
  });

  it("surfaces the recovery path through the executor's parseError", () => {
    const executor = new AntigravityExecutor();
    const parsed = executor.parseError(
      { status: 403, statusText: "Forbidden", headers: new Headers() },
      JSON.stringify(rpc403(CHAT_HOST)),
    );
    expect(parsed.validation).toEqual({
      kind: "antigravity_validation_required",
      url: VALIDATION_URL,
      source: "chat",
    });
  });

  it("still refuses a 403 from an unrelated domain", () => {
    expect(classifyAntigravityValidation({ status: 403, payload: rpc403("evil.example.com"), source: "chat" }))
      .toBeNull();
  });

  it("still refuses a non-verification 403 from the chat host", () => {
    const payload = rpc403(CHAT_HOST);
    payload.error.details[0].reason = "RATE_LIMIT_EXCEEDED";
    expect(classifyAntigravityValidation({ status: 403, payload, source: "chat" })).toBeNull();
  });
});

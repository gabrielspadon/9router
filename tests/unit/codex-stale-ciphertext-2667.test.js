// #2667 — the Codex retry loop only ever looked at SSE-200 transients, and
// errorConfig's `{ status: 400, pass: true }` rule stops a 400 from rotating or
// locking, so a request carrying an encrypted reasoning blob the backend can no
// longer decrypt (minted by another account, or expired) hard-failed the turn.
// The blob is continuity-only, so dropping it and resending is a complete local
// recovery — no other account is needed.
import { afterEach, describe, expect, it, vi } from "vitest";

import { BaseExecutor } from "../../open-sse/executors/base.js";
import { CodexExecutor } from "../../open-sse/executors/codex.js";

const STALE_CIPHERTEXT_BODY = JSON.stringify({
  error: {
    message:
      "Invalid value for 'input[1].encrypted_content': the encrypted content could not be decrypted.",
    type: "invalid_request_error",
    code: "invalid_value",
  },
});

const UNRELATED_400_BODY = JSON.stringify({
  error: { message: "Unknown model 'gpt-9'.", type: "invalid_request_error" },
});

function jsonResponse(status, body) {
  return new Response(body, { status, headers: { "Content-Type": "application/json" } });
}

function emptySseResponse() {
  return new Response(
    new ReadableStream({ start: (controller) => controller.close() }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } }
  );
}

function bodyWithCiphertext() {
  return {
    input: [
      { role: "user", content: [{ type: "input_text", text: "run it" }] },
      {
        type: "reasoning",
        id: "rs_1",
        summary: [{ type: "summary_text", text: "planning" }],
        encrypted_content: "B".repeat(64),
      },
      { type: "function_call", call_id: "call_1", name: "shell", arguments: "{}" },
      { type: "function_call_output", call_id: "call_1", output: "done" },
    ],
  };
}

// Records the ciphertext present in args.body at each upstream attempt.
function stubUpstream(responses) {
  const seen = [];
  vi.spyOn(BaseExecutor.prototype, "execute").mockImplementation(function execute(args) {
    seen.push(
      (args.body?.input || [])
        .filter((item) => typeof item?.encrypted_content === "string")
        .length
    );
    return Promise.resolve({ response: responses[seen.length - 1], transformedBody: args.body });
  });
  return seen;
}

describe("Codex recovers from a stale encrypted-reasoning 400 (#2667)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("strips the ciphertext and retries once", async () => {
    const seen = stubUpstream([
      jsonResponse(400, STALE_CIPHERTEXT_BODY),
      emptySseResponse(),
    ]);
    const warn = vi.fn();

    const result = await new CodexExecutor().execute({
      model: "gpt-5.3-codex",
      body: bodyWithCiphertext(),
      log: { warn },
    });

    expect(seen).toEqual([1, 0]);
    expect(result.response.status).toBe(200);
  });

  it("also recognises a bare decrypt failure", async () => {
    const seen = stubUpstream([
      jsonResponse(400, JSON.stringify({ error: { message: "Failed to decrypt reasoning item." } })),
      emptySseResponse(),
    ]);

    const result = await new CodexExecutor().execute({
      model: "gpt-5.3-codex",
      body: bodyWithCiphertext(),
    });

    expect(seen).toEqual([1, 0]);
    expect(result.response.status).toBe(200);
  });

  it("retries once only — a second stale 400 is surfaced", async () => {
    const seen = stubUpstream([
      jsonResponse(400, STALE_CIPHERTEXT_BODY),
      jsonResponse(400, STALE_CIPHERTEXT_BODY),
    ]);

    const result = await new CodexExecutor().execute({
      model: "gpt-5.3-codex",
      body: bodyWithCiphertext(),
    });

    expect(seen).toEqual([1, 0]);
    expect(result.response.status).toBe(400);
  });

  it("leaves an unrelated 400 untouched and readable", async () => {
    const seen = stubUpstream([jsonResponse(400, UNRELATED_400_BODY)]);

    const result = await new CodexExecutor().execute({
      model: "gpt-5.3-codex",
      body: bodyWithCiphertext(),
    });

    expect(seen).toEqual([1]);
    expect(result.response.status).toBe(400);
    await expect(result.response.text()).resolves.toBe(UNRELATED_400_BODY);
  });

  it("does not retry when the request carries no ciphertext to drop", async () => {
    const seen = stubUpstream([jsonResponse(400, STALE_CIPHERTEXT_BODY)]);

    const result = await new CodexExecutor().execute({
      model: "gpt-5.3-codex",
      body: { input: [{ role: "user", content: [{ type: "input_text", text: "hi" }] }] },
    });

    expect(seen).toEqual([0]);
    expect(result.response.status).toBe(400);
  });
});

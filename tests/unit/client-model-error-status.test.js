import { describe, expect, it } from "vitest";

import { projectClientModelStatus } from "../../open-sse/config/modelErrorClassifier.js";
import { createErrorResult } from "../../open-sse/utils/error.js";

describe("client model error status projection", () => {
  it.each([
    [
      "a verified Gemini unknown-model payload",
      {
        provider: "gemini",
        requestedModel: "gemini-missing",
        status: 404,
        payload: {
          error: {
            code: 404,
            status: "NOT_FOUND",
            message: "models/gemini-missing is not found for API version v1beta",
          },
        },
      },
      { clientErrorStatus: 404, unknownModelVerified: true },
    ],
    [
      "generic ModelError prose",
      {
        provider: "gemini",
        requestedModel: "gemini-missing",
        status: 502,
        payload: { error: { message: "ModelError: model not supported" } },
      },
      { clientErrorStatus: 502, unknownModelVerified: false },
    ],
    [
      "a non-model authentication failure",
      {
        provider: "gemini",
        requestedModel: "gemini-missing",
        status: 401,
        payload: { error: { code: 401, status: "UNAUTHENTICATED", message: "API key not valid" } },
      },
      { clientErrorStatus: 401, unknownModelVerified: false },
    ],
    [
      "a request parameter failure",
      {
        provider: "gemini",
        requestedModel: "gemini-missing",
        status: 400,
        payload: { error: { code: 400, status: "INVALID_ARGUMENT", message: "temperature must be non-negative" } },
      },
      { clientErrorStatus: 400, unknownModelVerified: false },
    ],
    [
      "an absent payload",
      { provider: "gemini", requestedModel: "gemini-missing", status: 503, payload: null },
      { clientErrorStatus: 503, unknownModelVerified: false },
    ],
  ])("projects %s only from a verified structured model signature", (_name, input, expected) => {
    expect(projectClientModelStatus(input)).toEqual(expected);
  });

  it("keeps failure metadata internal to the result and client error body", async () => {
    const failureMetadata = { clientErrorStatus: 404, unknownModelVerified: true };
    const result = createErrorResult(502, "upstream unavailable", undefined, failureMetadata);

    expect(result).toMatchObject({ status: 502, failureMetadata });
    await expect(result.response.json()).resolves.toMatchObject({ error: { message: "upstream unavailable" } });
  });
});

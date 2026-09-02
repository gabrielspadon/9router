import { describe, expect, it } from "vitest";
import { IFlowExecutor } from "../../open-sse/executors/iflow.js";

describe("IFlowExecutor authorization and header generation", () => {
  it("sets Authorization header and signature when apiKey is provided", () => {
    const executor = new IFlowExecutor();
    const creds = { apiKey: "test-api-key" };
    const headers = executor.buildHeaders(creds, false);

    expect(headers["Authorization"]).toBe("Bearer test-api-key");
    expect(headers["x-iflow-signature"]).toBeDefined();
    expect(headers["x-iflow-signature"]).not.toBe("");
  });

  it("sets Authorization header fallback and signature when only accessToken is provided", () => {
    const executor = new IFlowExecutor();
    const creds = { accessToken: "fake-credential" };
    const headers = executor.buildHeaders(creds, false);

    expect(headers["Authorization"]).toBe("Bearer fake-credential");
    expect(headers["x-iflow-signature"]).toBeDefined();
    expect(headers["x-iflow-signature"]).not.toBe("");
  });
});

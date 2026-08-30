import { describe, expect, it } from "vitest";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";

const transformImageRequest = body => new AntigravityExecutor().transformRequest(
  "gemini-3.1-flash-image",
  body,
  false,
  { projectId: "project-1", connectionId: "connection-1" },
);

describe("Antigravity image editing requests", () => {
  it("preserves decoded inline image data in the outbound image request", () => {
    const inlineData = { mimeType: "image/png", data: "aW1hZ2U=" };

    const output = transformImageRequest({
      contents: [
        { role: "user", parts: [{ inlineData }] },
      ],
    });

    expect(output.request.contents).toEqual([
      { role: "user", parts: [{ inlineData }] },
    ]);
  });

  it("preserves text and inline image order from nested request contents", () => {
    const output = transformImageRequest({
      request: {
        contents: [{
          role: "user",
          parts: [
            { text: "Use this reference" },
            { inlineData: { mimeType: "image/jpeg", data: "cmVmZXJlbmNl" } },
            { text: "Add a lighthouse" },
          ],
        }],
      },
    });

    expect(output.request.contents).toEqual([{
      role: "user",
      parts: [
        { text: "Use this reference" },
        { inlineData: { mimeType: "image/jpeg", data: "cmVmZXJlbmNl" } },
        { text: "Add a lighthouse" },
      ],
    }]);
  });

  it("preserves valid parts across multiple messages", () => {
    const output = transformImageRequest({
      contents: [
        { role: "user", parts: [{ text: "First instruction" }] },
        {
          role: "model",
          parts: [{ inlineData: { mimeType: "image/webp", data: "cHJldmlldw==" } }],
        },
        { parts: [{ text: "Final instruction" }] },
      ],
    });

    expect(output.request.contents).toEqual([
      { role: "user", parts: [{ text: "First instruction" }] },
      {
        role: "model",
        parts: [{ inlineData: { mimeType: "image/webp", data: "cHJldmlldw==" } }],
      },
      { role: "user", parts: [{ text: "Final instruction" }] },
    ]);
  });

  it("drops unsupported parts and strips every field outside the outbound allowlist", () => {
    const output = transformImageRequest({
      contents: [{
        role: "user",
        parts: [
          { text: "Keep text", thought: true, metadata: { private: true } },
          {
            inlineData: { mimeType: "image/png", data: "c2FmZQ==" },
            fileData: { fileUri: "https://example.invalid/private.png" },
          },
          {
            text: "Text wins for malformed dual-kind parts",
            inlineData: { mimeType: "image/png", data: "ZHJvcA==" },
            extra: "drop",
          },
          { functionCall: { name: "unsafe", args: {} } },
        ],
      }],
    });

    expect(output.request.contents).toEqual([{
      role: "user",
      parts: [
        { text: "Keep text" },
        { inlineData: { mimeType: "image/png", data: "c2FmZQ==" } },
        { text: "Text wins for malformed dual-kind parts" },
      ],
    }]);
  });
});

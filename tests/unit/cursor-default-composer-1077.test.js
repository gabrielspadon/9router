// #1077 — "Cursor doesn't respond with default". Cursor's `default` entry is
// "Auto (Server Picks)" and the server routinely picks Composer, which sends
// its visible answer inside the thinking field after a </think> marker rather
// than as text. The executor keyed the Composer decode on the REQUESTED model
// name, so `default` never matched and the whole reply was dropped: reporters
// saw an empty response with `default` while a named model worked.
import { describe, it, expect } from "vitest";

import { CursorExecutor } from "../../open-sse/executors/cursor.js";
import { encodeField, wrapConnectRPCFrame } from "../../open-sse/utils/cursorProtobuf.js";

const LEN = 2;

function cursorResponseFrame({ text = "", thinking = "" }) {
  const fields = [];
  if (text) fields.push(encodeField(1, LEN, text));
  if (thinking) fields.push(encodeField(25, LEN, encodeField(1, LEN, thinking)));
  const response = Buffer.concat(fields.map((field) => Buffer.from(field)));
  return Buffer.from(wrapConnectRPCFrame(encodeField(2, LEN, response)));
}

function parseSSE(text) {
  return text
    .split("\n\n")
    .filter((chunk) => chunk.startsWith("data: "))
    .map((chunk) => chunk.slice("data: ".length))
    .filter((data) => data !== "[DONE]")
    .map((data) => JSON.parse(data));
}

const body = { messages: [{ role: "user", content: "reply OK" }] };

describe("Cursor Auto (Server Picks) decodes a Composer reply (#1077)", () => {
  for (const model of ["default", "cu/default"]) {
    it(`returns the visible answer for non-streaming ${model}`, async () => {
      const buffer = cursorResponseFrame({
        thinking: "private reasoning that must not leak</think>OK",
      });

      const payload = await new CursorExecutor()
        .transformProtobufToJSON(buffer, model, body)
        .json();

      expect(payload.choices[0].message.content).toBe("OK");
      expect(JSON.stringify(payload)).not.toContain("private reasoning");
    });

    it(`streams the visible answer for ${model}`, async () => {
      const buffer = Buffer.concat([
        cursorResponseFrame({ thinking: "private reasoning" }),
        cursorResponseFrame({ thinking: " that must not leak</think>O" }),
        cursorResponseFrame({ thinking: "K" }),
      ]);

      const events = parseSSE(
        await new CursorExecutor().transformProtobufToSSE(buffer, model, body).text(),
      );
      const content = events
        .map((event) => event.choices?.[0]?.delta?.content || "")
        .join("");

      expect(content).toBe("OK");
      expect(JSON.stringify(events)).not.toContain("private reasoning");
    });
  }

  // A pick that is not Composer emits no </think>, so the fallback stays shut
  // and the privacy guard the Composer decode was written with is unchanged.
  it("surfaces nothing when the server pick sends plain reasoning", async () => {
    const buffer = cursorResponseFrame({ thinking: "opaque reasoning, no marker" });

    const payload = await new CursorExecutor()
      .transformProtobufToJSON(buffer, "default", body)
      .json();

    expect(payload.choices[0].message.content).toBeNull();
    expect(JSON.stringify(payload)).not.toContain("opaque reasoning");
  });

  // Real text always wins: a Composer-shaped thinking block must not displace
  // or duplicate the answer a server pick sent as ordinary content.
  it("prefers real text content over the thinking fallback", async () => {
    const buffer = cursorResponseFrame({
      text: "REAL",
      thinking: "reasoning</think>SHADOW",
    });

    const payload = await new CursorExecutor()
      .transformProtobufToJSON(buffer, "default", body)
      .json();

    expect(payload.choices[0].message.content).toBe("REAL");
  });

  // Named non-Composer models keep the existing behaviour (guards #1310).
  it("still hides thinking for a named non-Composer model", async () => {
    const buffer = cursorResponseFrame({
      thinking: "private reasoning</think>SHOULD_NOT_APPEAR",
    });

    const payload = await new CursorExecutor()
      .transformProtobufToJSON(buffer, "gpt-5.3-codex", body)
      .json();

    expect(payload.choices[0].message.content).toBeNull();
    expect(JSON.stringify(payload)).not.toContain("SHOULD_NOT_APPEAR");
  });
});

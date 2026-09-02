// #1316 — Composer's visible answer is preceded by a `<｜final｜>` sentinel that
// the </think> split left in the reply, so clients rendered the raw token ahead
// of every Composer answer. The streaming path has the harder half: the
// sentinel arrives split across protobuf frames, so the tail has to be held
// back until it can no longer complete the sentinel — and only then, because a
// blanket hold on any "<" stalls ordinary markup and comparisons.
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

function streamedContent(frames, model = "composer-2.5") {
  const buffer = Buffer.concat(frames.map((thinking) => cursorResponseFrame({ thinking })));
  const response = new CursorExecutor().transformProtobufToSSE(buffer, model, body);
  return response.text().then((text) =>
    text
      .split("\n\n")
      .filter((chunk) => chunk.startsWith("data: "))
      .map((chunk) => chunk.slice("data: ".length))
      .filter((data) => data !== "[DONE]")
      .map((data) => JSON.parse(data))
      .map((event) => event.choices?.[0]?.delta?.content || "")
      .join("")
  );
}

const body = { messages: [{ role: "user", content: "reply OK" }] };

describe("Cursor Composer strips the final-answer sentinel (#1316)", () => {
  it("drops the sentinel from a non-streaming reply", async () => {
    const buffer = cursorResponseFrame({ thinking: "private reasoning</think><｜final｜>OK" });

    const payload = await new CursorExecutor()
      .transformProtobufToJSON(buffer, "composer-2.5", body)
      .json();

    expect(payload.choices[0].message.content).toBe("OK");
  });

  it("drops the sentinel when it is separated by whitespace", async () => {
    const buffer = cursorResponseFrame({ thinking: "reasoning</think>\n<｜final｜> OK" });

    const payload = await new CursorExecutor()
      .transformProtobufToJSON(buffer, "composer-2.5", body)
      .json();

    expect(payload.choices[0].message.content).toBe("OK");
  });

  it("never emits a sentinel fragment when the marker straddles two frames", async () => {
    const content = await streamedContent(["reasoning</think><｜fi", "nal｜>OK"]);

    expect(content).toBe("OK");
    expect(content).not.toContain("<｜");
  });

  it("streams an ordinary '<' in the answer instead of buffering it", async () => {
    const content = await streamedContent(["reasoning</think>if (a < b) ", "return;"]);

    expect(content).toBe("if (a < b) return;");
  });

  it("flushes a trailing '<' the stream never completes", async () => {
    const content = await streamedContent(["reasoning</think>a <"]);

    expect(content).toBe("a <");
  });
});

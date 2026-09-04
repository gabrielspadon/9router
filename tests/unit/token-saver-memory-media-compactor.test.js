import { describe, it, expect } from "vitest";

import { pruneHistoricalMedia } from "../../open-sse/services/memory/mediaPruner.js";
import { compactContextWindow, estimateTokenCount } from "../../open-sse/services/memory/contextCompactor.js";

const MEDIA_NOTE = "omitted by tokenproxy memory optimizer";

function claudeBody({ historicalMedia = true } = {}) {
  return {
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "look at this" },
          historicalMedia
            ? { type: "image", source: { type: "base64", media_type: "image/png", data: "QUJD" } }
            : { type: "text", text: "no media" },
        ],
      },
      { role: "assistant", content: [{ type: "text", text: "I see it" }] },
      { role: "user", content: [{ type: "text", text: "follow-up" }] },
      { role: "assistant", content: [{ type: "text", text: "answer" }] },
      // trailing user turn = active question, must be untouched
      {
        role: "user",
        content: [
          { type: "text", text: "now what?" },
          { type: "image", source: { type: "base64", media_type: "image/png", data: "UVdF" } },
        ],
      },
    ],
  };
}

describe("token-saver media pruner: contract per mediaPruner.js", () => {
  it("historical image block replaced by text note; mixed text survives; trailing user media untouched", () => {
    const body = claudeBody();
    const res = pruneHistoricalMedia(body);

    expect(res.pruned).toBe(true);
    const historical = body.messages[0].content;
    expect(historical[0]).toEqual({ type: "text", text: "look at this" });
    expect(historical[1]).toEqual({ type: "text", text: "[Historical image omitted by tokenproxy memory optimizer]" });
    // trailing user turn byte-identical
    expect(body.messages[4]).toEqual({
      role: "user",
      content: [
        { type: "text", text: "now what?" },
        { type: "image", source: { type: "base64", media_type: "image/png", data: "UVdF" } },
      ],
    });
  });

  it("audio / input_audio blocks in historical turns replaced with their type in the note", () => {
    const body = {
      messages: [
        {
          role: "user",
          content: [
            { type: "input_audio", input_audio: { data: "QUJD", format: "wav" } },
            { type: "audio_url", audio_url: { url: "https://example.com/a.mp3" } },
          ],
        },
        { role: "assistant", content: "heard" },
        { role: "user", content: "now?" },
      ],
    };
    pruneHistoricalMedia(body);
    expect(body.messages[0].content[0]).toEqual({ type: "text", text: "[Historical input_audio omitted by tokenproxy memory optimizer]" });
    expect(body.messages[0].content[1]).toEqual({ type: "text", text: "[Historical audio_url omitted by tokenproxy memory optimizer]" });
  });

  it("inlineData / fileData Gemini parts replaced; text part kept", () => {
    const body = {
      messages: [
        {
          role: "user",
          parts: [
            { text: "describe this" },
            { inlineData: { mimeType: "image/png", data: "QUJD" } },
            { fileData: { mimeType: "application/pdf", fileUri: "gs://x/y.pdf" } },
          ],
        },
        { role: "model", parts: [{ text: "done" }] },
        { role: "user", parts: [{ text: "next" }] },
      ],
    };
    pruneHistoricalMedia(body);
    expect(body.messages[0].parts[0]).toEqual({ text: "describe this" });
    expect(body.messages[0].parts[1]).toEqual({ text: "[Historical media omitted by tokenproxy memory optimizer]" });
    expect(body.messages[0].parts[2]).toEqual({ text: "[Historical media omitted by tokenproxy memory optimizer]" });
  });

  it("data URI in historical string content replaced with base64 note", () => {
    const body = {
      messages: [
        { role: "user", content: "see data:image/png;base64,QUJDRA== here" },
        { role: "assistant", content: "ok" },
        { role: "user", content: "next" },
      ],
    };
    pruneHistoricalMedia(body);
    expect(body.messages[0].content).toBe("see [Historical base64 media omitted by tokenproxy] here");
  });

  it("message-level images array emptied and note appended", () => {
    const body = {
      messages: [
        { role: "user", content: "pics attached", images: [{ url: "https://x/1.png" }, { url: "https://x/2.png" }] },
        { role: "assistant", content: "seen" },
        { role: "user", content: "next" },
      ],
    };
    const res = pruneHistoricalMedia(body);
    expect(res.savedItems).toBe(2);
    expect(body.messages[0].images).toEqual([]);
    expect(body.messages[0].content).toContain("[Historical images removed by tokenproxy memory optimizer]");
  });

  it("non-media blocks (pdf via type=file, plain text) are NOT media per isMediaBlock and survive", () => {
    const body = {
      messages: [
        {
          role: "user",
          content: [
            { type: "file", file: { filename: "report.pdf", file_data: "data:application/pdf;base64,QUJD" } },
          ],
        },
        { role: "assistant", content: "read" },
        { role: "user", content: "next" },
      ],
    };
    const res = pruneHistoricalMedia(body);
    expect(res.pruned).toBe(false);
    expect(body.messages[0].content[0].type).toBe("file");
  });

  it("no assistant/model message -> nothing pruned (trailing-run detection finds no cutoff)", () => {
    const body = {
      messages: [
        { role: "user", content: [{ type: "image", source: { data: "QUJD" } }] },
        { role: "user", content: [{ type: "image", source: { data: "UVdF" } }] },
      ],
    };
    const snapshot = JSON.stringify(body.messages);
    const res = pruneHistoricalMedia(body);
    expect(res.pruned).toBe(false);
    expect(JSON.stringify(body.messages)).toBe(snapshot);
  });

  it("enabled:false -> untouched", () => {
    const body = claudeBody();
    const snapshot = JSON.stringify(body.messages);
    const res = pruneHistoricalMedia(body, { enabled: false });
    expect(res.pruned).toBe(false);
    expect(JSON.stringify(body.messages)).toBe(snapshot);
  });
});

describe("token-saver compactor: compactContextWindow called directly (default off in settings)", () => {
  const MARKER = "[Historical Context Summary by tokenproxy Memory Optimizer]";

  function bigHistory(oldTurns, { charsPerTurn = 12000, recentTurns = 8, withThinking = true } = {}) {
    const messages = [{ role: "system", content: "system prompt" }];
    for (let i = 0; i < oldTurns; i++) {
      const content = [];
      if (withThinking) content.push({ type: "thinking", thinking: `SECRET_THINKING_${i}_` + "z".repeat(200) });
      content.push({ type: "text", text: `old turn ${i} ` + "a".repeat(charsPerTurn) });
      messages.push({ role: "user", content });
      messages.push({ role: "assistant", content: `old answer ${i} ` + "b".repeat(charsPerTurn) });
    }
    for (let i = 0; i < recentTurns; i++) {
      messages.push({ role: "user", content: `recent question ${i}` });
      messages.push({ role: "assistant", content: `recent answer ${i}` });
    }
    return messages;
  }

  it("input over threshold -> old turns replaced, exactly one marker-bearing block, recent turns verbatim", () => {
    const messages = bigHistory(12);
    const originalTokens = estimateTokenCount(messages);
    expect(originalTokens).toBeGreaterThan(32000);

    const body = { messages };
    const res = compactContextWindow(body, { enabled: true, thresholdTokens: 32000, recentTurnsToKeep: 8 });

    expect(res.compacted).toBe(true);
    expect(body.messages.length).toBe(1 /* system */ + 2 /* summary + notice */ + 8 /* recent */);

    const markerBlocks = body.messages.filter((m) => typeof m.content === "string" && m.content.includes(MARKER));
    expect(markerBlocks.length).toBe(1);
    expect(markerBlocks[0].role).toBe("system");

    // recent 8 turns verbatim at the tail
    expect(body.messages.slice(-8)).toEqual(messages.slice(-8));
    // leading system prompt preserved
    expect(body.messages[0]).toEqual({ role: "system", content: "system prompt" });
  });

  it("summary keeps only text highlights; thinking blocks from old turns are dropped", () => {
    const messages = bigHistory(12);
    const body = { messages };
    compactContextWindow(body, { enabled: true, thresholdTokens: 32000, recentTurnsToKeep: 8 });

    const summary = body.messages.find((m) => typeof m.content === "string" && m.content.includes(MARKER)).content;
    expect(summary).toContain("old turn 11");
    expect(summary).not.toContain("SECRET_THINKING_");
    // the fabricated-dialogue guard: both inserted blocks are system role
    expect(body.messages[1].role).toBe("system");
    expect(body.messages[2].role).toBe("system");
  });

  it("threshold under -> untouched", () => {
    const messages = bigHistory(2, { charsPerTurn: 100 });
    const snapshot = JSON.stringify(messages);
    const res = compactContextWindow({ messages }, { enabled: true, thresholdTokens: 32000, recentTurnsToKeep: 8 });
    expect(res.compacted).toBe(false);
    expect(JSON.stringify(messages)).toBe(snapshot);
  });

  it("conversational items <= recentTurnsToKeep -> untouched even over threshold", () => {
    const messages = bigHistory(2, { charsPerTurn: 40000, recentTurns: 2 });
    const snapshot = JSON.stringify(messages);
    const res = compactContextWindow({ messages }, { enabled: true, thresholdTokens: 32000, recentTurnsToKeep: 8 });
    expect(res.compacted).toBe(false);
    expect(JSON.stringify(messages)).toBe(snapshot);
  });

  it("enabled:false -> untouched", () => {
    const messages = bigHistory(12);
    const snapshot = JSON.stringify(messages);
    const res = compactContextWindow({ messages }, { enabled: false, thresholdTokens: 32000, recentTurnsToKeep: 8 });
    expect(res.compacted).toBe(false);
    expect(JSON.stringify(messages)).toBe(snapshot);
  });
});

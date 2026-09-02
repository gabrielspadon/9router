/**
 * Claude-backed traffic reported prompt tokens twice, and under-reported them
 * on the other exit (#3075).
 *
 * `claude-to-openai` folds Claude's cache-EXCLUSIVE `input_tokens` into a
 * cache-INCLUSIVE `prompt_tokens` at both usage sites, but leaves the raw
 * `cache_read_input_tokens` / `cache_creation_input_tokens` on the same object
 * and never writes the top-level `cached_tokens` marker. `canonicalizeUsage()`
 * uses exactly that marker to tell a folded object from an unfolded one, so the
 * object reaching the usage DB is folded a SECOND time and every cached request
 * is billed for its cache twice.
 *
 * The `message_stop` exit has the opposite error: it rebuilds usage by hand
 * from `input_tokens` alone, so a stream that ends without a `stop_reason`
 * delta reports a prompt that excludes the cache entirely — the same numbers
 * disagreeing with the `message_delta` exit on the same route.
 */
import { describe, expect, it } from "vitest";
import { FORMATS } from "open-sse/translator/formats.js";
import { initState, translateResponse } from "open-sse/translator/index.js";
import { canonicalizeUsage } from "open-sse/utils/usageTracking.js";

const INPUT = 100;
const CACHE_READ = 900;
const CACHE_CREATE = 50;
const OUTPUT = 20;
const FOLDED_PROMPT = INPUT + CACHE_READ + CACHE_CREATE;

const START = {
  type: "message_start",
  message: {
    id: "msg_1",
    model: "claude-opus-4.6",
    usage: {
      input_tokens: INPUT,
      cache_read_input_tokens: CACHE_READ,
      cache_creation_input_tokens: CACHE_CREATE,
    },
  },
};

const DELTA = (extra = {}) => ({
  type: "message_delta",
  usage: { output_tokens: OUTPUT },
  ...extra,
});

function run(chunks) {
  const state = initState(FORMATS.OPENAI);
  const events = [];
  for (const c of chunks) {
    const out = translateResponse(FORMATS.CLAUDE, FORMATS.OPENAI, c, state);
    if (out?.length) events.push(...out);
  }
  return { state, events };
}

const lastUsage = (events) => events.filter((e) => e.usage).at(-1)?.usage;

describe("Claude cache tokens are folded exactly once (#3075)", () => {
  it("does not let the usage DB fold the cache a second time", () => {
    const { state } = run([START, DELTA({ delta: { stop_reason: "end_turn" } }), { type: "message_stop" }]);

    expect(state.usage.prompt_tokens).toBe(FOLDED_PROMPT);
    expect(canonicalizeUsage(state.usage).prompt_tokens).toBe(FOLDED_PROMPT);
  });

  it("marks the message_start snapshot as folded too", () => {
    const { state } = run([START]);

    expect(canonicalizeUsage(state.usage).prompt_tokens).toBe(FOLDED_PROMPT);
  });

  it("reports a cache-inclusive prompt on the message_stop exit as well", () => {
    const { events } = run([START, DELTA(), { type: "message_stop" }]);

    expect(lastUsage(events).prompt_tokens).toBe(FOLDED_PROMPT);
  });

  it("folds a cache-creation-only first write exactly once too", () => {
    const firstWrite = {
      type: "message_start",
      message: { id: "msg_2", model: "claude-opus-4.6", usage: { input_tokens: INPUT, cache_creation_input_tokens: CACHE_CREATE } },
    };
    const { state } = run([firstWrite, DELTA({ delta: { stop_reason: "end_turn" } })]);

    expect(canonicalizeUsage(state.usage).prompt_tokens).toBe(INPUT + CACHE_CREATE);
  });

  it("still agrees with the message_delta exit", () => {
    const { events } = run([START, DELTA({ delta: { stop_reason: "end_turn" } })]);

    expect(lastUsage(events).prompt_tokens).toBe(FOLDED_PROMPT);
  });
});

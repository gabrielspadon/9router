import { describe, expect, it } from 'vitest';
import { PROVIDERS } from 'open-sse/config/providers.js';
import { resolveBareModelStaticOwner } from 'open-sse/services/model.js';
import { canonicalEndpoint, openAIEndpoints } from '@/app/api/provider-nodes/endpointUrls.js';

const ARK_PLAN_OPENAI = 'https://ark.cn-beijing.volces.com/api/plan/v3';
const ARK_PLAN_ANTHROPIC = 'https://ark.cn-beijing.volces.com/api/plan';

// #3253 reports that a custom OpenAI/Anthropic-compatible provider "does not
// support the Volces API". It does. The endpoint builders take the operator's base
// URL verbatim and append only the format's canonical path, so nothing about Ark's
// own base path is unrepresentable — no registry entry or executor is needed for it.
//
// What the report's own error shows is a different failure: "No active credentials
// for provider: volcengine-ark" names the BUILT-IN registry entry, which ships only
// Ark's Coding Plan and which the user never connected. A bare Ark model id is
// statically claimed by that entry, so it is model-name ownership that misrouted the
// request, not an endpoint the custom node could not reach.
describe('a custom node already expresses the Ark plan endpoints (#3253)', () => {
  it('the OpenAI-compatible base is used verbatim, plan path and all', () => {
    const { baseUrl, chatUrl, responsesUrl } = openAIEndpoints(ARK_PLAN_OPENAI);
    expect(baseUrl).toBe(ARK_PLAN_OPENAI);
    expect(chatUrl).toBe(`${ARK_PLAN_OPENAI}/chat/completions`);
    // The report notes this endpoint also serves the Responses API; a
    // multi-compatible node opts into exactly this URL for it.
    expect(responsesUrl).toBe(`${ARK_PLAN_OPENAI}/responses`);
  });

  it('the Anthropic-compatible base is used verbatim too', () => {
    expect(canonicalEndpoint(ARK_PLAN_ANTHROPIC, '/messages')).toBe(
      `${ARK_PLAN_ANTHROPIC}/messages`
    );
  });

  it('a base pasted with the canonical path already on it is not doubled', () => {
    // The likeliest operator mistake, and it is already handled.
    expect(openAIEndpoints(`${ARK_PLAN_OPENAI}/chat/completions`).chatUrl).toBe(
      `${ARK_PLAN_OPENAI}/chat/completions`
    );
    expect(canonicalEndpoint(`${ARK_PLAN_ANTHROPIC}/messages`, '/messages')).toBe(
      `${ARK_PLAN_ANTHROPIC}/messages`
    );
  });
});

describe('the reported 404 is model-name ownership, not the endpoint (#3253)', () => {
  it('the built-in entry ships only the Coding Plan, which is the gap actually reported', () => {
    // The follow-up comment on the issue says the Coding Plan works and the Agent
    // Plan does not — consistent with this being the only base URL shipped.
    expect(PROVIDERS['volcengine-ark'].baseUrl).toContain('/api/coding/');
    expect(PROVIDERS['volcengine-ark'].baseUrl).not.toContain('/api/plan/');
  });

  it('a bare Ark model id resolves to that built-in entry, producing the error in the report', () => {
    // With no volcengine-ark connection this is what answers 404 "No active
    // credentials for provider: volcengine-ark" — the message the reporter pasted.
    for (const id of ['Kimi-K2.6', 'Doubao-Seed-Code', 'GLM-5.2']) {
      expect(resolveBareModelStaticOwner(id)).toBe('volcengine-ark');
    }
  });

  it("prefixing the model with the node's own prefix is what avoids the collision", () => {
    // A prefixed model never reaches bare-name ownership at all, which is why the
    // custom node works when the client sends `<prefix>/<model>`.
    expect(resolveBareModelStaticOwner('my-ark/Kimi-K2.6')).toBeNull();
  });
});

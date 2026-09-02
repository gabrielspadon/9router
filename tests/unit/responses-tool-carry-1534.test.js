// #1534 (MCP tools collapsed into an empty namespace placeholder on Codex CLI
// → /v1/responses → an Anthropic backend) and #1707 (Codex editing tools such
// as apply_patch unusable on a non-Codex backend, while shell keeps working).
//
// Both are the same crossing and the same loss. openaiResponsesToOpenAIRequest
// flattens a declared `namespace` into `namespace__tool` and re-declares a
// freeform `custom` tool as a function with one `input` string, and records
// what it did on the intermediate OpenAI body as `_responsesToolNameMap` /
// `_customToolNames`. Those two fields are the ONLY record of the mapping, and
// the response conversion needs them to hand the client back a `custom_tool_call`
// with `input`, and a `function_call` under its declared name plus `namespace`.
// A Claude upstream is reached through the OpenAI pivot, and the second hop
// builds a fresh body — so both fields were dropped and chatCore read undefined.
// A plain function tool (`shell`) is unaffected either way, which is exactly the
// asymmetry #1707 reports.
import { describe, expect, it } from 'vitest';

import { translateRequest, translateResponse, initState } from '../../open-sse/translator/index.js';
import { FORMATS } from '../../open-sse/translator/formats.js';

const MCP = {
  type: 'namespace',
  name: 'mcp__context7',
  tools: [
    {
      type: 'function',
      name: 'get_docs',
      description: 'Fetch library docs.',
      parameters: { type: 'object', properties: { id: { type: 'string' } } },
    },
  ],
};

const APPLY_PATCH = {
  type: 'custom',
  name: 'apply_patch',
  description: 'Edit files.',
  format: { type: 'grammar', syntax: 'lark', definition: 'start: /(.|\\n)+/' },
};

const SHELL = {
  type: 'function',
  name: 'shell',
  description: 'Run a command.',
  parameters: { type: 'object', properties: { command: { type: 'string' } } },
};

function codexRequest(target) {
  return translateRequest(
    FORMATS.OPENAI_RESPONSES,
    target,
    'claude-opus-4.7',
    {
      model: 'claude-opus-4.7',
      instructions: 'You are a coding agent running in the Codex CLI.',
      input: [
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'patch it' }] },
      ],
      tools: [SHELL, APPLY_PATCH, MCP],
      stream: true,
    },
    true,
    {},
    null,
    null,
    [],
    null,
    null
  );
}

// The Responses events a Codex client would receive for one tool call, driven
// through the real claude → openai → openai_responses pivot.
function responsesEventsForClaudeToolUse(translated, toolName) {
  const state = initState(FORMATS.OPENAI_RESPONSES);
  state.responsesToolNameMap = translated._responsesToolNameMap;
  state.customToolNames = new Set(translated._customToolNames || []);

  const claudeEvents = [
    { type: 'message_start', message: { id: 'msg_1', model: 'claude-opus-4.7' } },
    {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: 'toolu_1', name: toolName },
    },
    {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: '{"id":"x"}' },
    },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 5 } },
    { type: 'message_stop' },
  ];
  return claudeEvents.flatMap((event) =>
    translateResponse(FORMATS.CLAUDE, FORMATS.OPENAI_RESPONSES, event, state)
  );
}

const addedItem = (events) =>
  events.find((e) => e.event === 'response.output_item.added')?.data?.item;

describe('Responses tool identity survives the pivot to a Claude upstream (#1534, #1707)', () => {
  it('declares the namespaced MCP tool by its own name, not an empty placeholder', () => {
    const claude = codexRequest(FORMATS.CLAUDE);
    // The collapse #1534 reports is a single empty-schema `mcp__<server>__`
    // function with the server's tools gone.
    expect(claude.tools.map((t) => t.name)).toEqual([
      'shell',
      'apply_patch',
      'mcp__context7__get_docs',
    ]);
    expect(claude.tools[2].input_schema).toMatchObject({ properties: { id: { type: 'string' } } });
  });

  it('carries the request-scoped tool metadata onto the Claude body', () => {
    const claude = codexRequest(FORMATS.CLAUDE);
    expect(claude._customToolNames).toEqual(['apply_patch']);
    expect(claude._responsesToolNameMap.get('mcp__context7__get_docs')).toMatchObject({
      name: 'get_docs',
      namespace: 'mcp__context7',
    });
    // Same body the OpenAI target has always produced — this is a carry, not a
    // second source of truth.
    expect([...claude._responsesToolNameMap.keys()]).toEqual([
      ...codexRequest(FORMATS.OPENAI)._responsesToolNameMap.keys(),
    ]);
  });

  it('returns the MCP call under its declared name and namespace (#1534)', () => {
    const translated = codexRequest(FORMATS.CLAUDE);
    expect(
      addedItem(responsesEventsForClaudeToolUse(translated, 'mcp__context7__get_docs'))
    ).toMatchObject({
      type: 'function_call',
      name: 'get_docs',
      namespace: 'mcp__context7',
    });
  });

  it('returns apply_patch as a custom_tool_call the Codex CLI can run (#1707)', () => {
    const translated = codexRequest(FORMATS.CLAUDE);
    expect(addedItem(responsesEventsForClaudeToolUse(translated, 'apply_patch'))).toMatchObject({
      type: 'custom_tool_call',
      name: 'apply_patch',
    });
  });

  it('leaves a plain function tool exactly as it was — the half that never broke', () => {
    const translated = codexRequest(FORMATS.CLAUDE);
    const item = addedItem(responsesEventsForClaudeToolUse(translated, 'shell'));
    expect(item).toMatchObject({ type: 'function_call', name: 'shell' });
    expect(item).not.toHaveProperty('namespace');
  });

  it('resolves nothing when the request declared no tools', () => {
    const state = initState(FORMATS.OPENAI_RESPONSES);
    const events = [
      { type: 'message_start', message: { id: 'msg_2', model: 'claude-opus-4.7' } },
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 't', name: 'mcp__context7__get_docs' },
      },
      { type: 'content_block_stop', index: 0 },
    ].flatMap((e) => translateResponse(FORMATS.CLAUDE, FORMATS.OPENAI_RESPONSES, e, state));
    expect(addedItem(events)).toMatchObject({
      type: 'function_call',
      name: 'mcp__context7__get_docs',
    });
    expect(addedItem(events)).not.toHaveProperty('namespace');
  });
});

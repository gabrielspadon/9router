/**
 * #1528 — CommandCode asked the project to stop reverse-engineering the
 * subscription/CLI API and to call the documented Provider API instead.
 *
 * The old transport posted to https://api.commandcode.ai/alpha/generate while
 * claiming to be the CLI (`x-command-code-version`, `x-cli-environment: cli`,
 * a per-request `x-session-id`), which reached plans that carry no API access.
 * The Provider API is plain OpenAI Chat Completions over a Bearer key, so the
 * whole `commandcode` NDJSON transport went away with it.
 *
 * These assertions are the ones that would go quiet if someone restored the CLI
 * endpoint or the impersonation headers, so they pin both the destination and
 * the absence.
 */

import { describe, it, expect } from 'vitest';
import { PROVIDERS } from '../../open-sse/config/providers.js';
import { CommandCodeExecutor } from '../../open-sse/executors/commandcode.js';

const config = PROVIDERS.commandcode;

describe('#1528 commandcode uses the documented Provider API', () => {
  it("posts to /provider/v1/chat/completions, never the CLI's /alpha/generate", () => {
    expect(config.baseUrl).toBe('https://api.commandcode.ai/provider/v1/chat/completions');
    expect(config.validateUrl).toBe('https://api.commandcode.ai/provider/v1/models');
    expect(JSON.stringify(config)).not.toContain('/alpha/generate');
  });

  it('speaks OpenAI chat completions, so no commandcode-format hop remains', () => {
    expect(config.format).toBe('openai');
    // The Provider API answers a non-streaming request with a JSON body, so the
    // forced-stream workaround the NDJSON transport needed is gone too.
    expect(config.forceStream).not.toBe(true);
  });

  it('sends no CLI-impersonation headers', () => {
    const serialized = JSON.stringify(config.headers || {});
    expect(serialized).not.toContain('x-command-code-version');
    expect(serialized).not.toContain('x-cli-environment');

    const headers = new CommandCodeExecutor().buildHeaders({ apiKey: 'user_test' }, true);
    expect(headers['x-command-code-version']).toBeUndefined();
    expect(headers['x-cli-environment']).toBeUndefined();
    // A per-request session id is what made a gateway call look like a CLI seat.
    expect(headers['x-session-id']).toBeUndefined();
  });

  it('still authenticates with the Bearer key and still honours ZDR', () => {
    const executor = new CommandCodeExecutor();

    expect(executor.buildHeaders({ apiKey: 'user_test' }, true).Authorization).toBe(
      'Bearer user_test'
    );

    expect(executor.buildHeaders({ apiKey: 'user_test' }, true)['x-cmd-zdr']).toBeUndefined();
    expect(
      executor.buildHeaders(
        { apiKey: 'user_test', providerSpecificData: { zdrEnabled: true } },
        true
      )['x-cmd-zdr']
    ).toBe('1');
  });
});

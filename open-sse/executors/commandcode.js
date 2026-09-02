import { BaseExecutor } from './base.js';
import { PROVIDERS } from '../config/providers.js';

/**
 * CommandCodeExecutor — talks to the documented Provider API at
 * https://api.commandcode.ai/provider/v1/chat/completions (#1528).
 *
 * That endpoint is plain OpenAI Chat Completions over a Bearer key, so
 * BaseExecutor's own request/stream handling covers everything: no forced
 * stream, no NDJSON unwrapping, no per-request CLI session id, and no
 * `commandcode` translator hop. What is left here is the one header the OpenAI
 * schema has no field for.
 *
 * The previous implementation posted to the CLI's `/alpha/generate` while
 * sending `x-command-code-version` and `x-cli-environment: cli`, which
 * impersonated the CommandCode CLI to reach subscription plans that carry no
 * API access. CommandCode reported that as a terms-of-service violation and
 * asked for the Provider API instead; do not reintroduce those headers or that
 * endpoint.
 */
export class CommandCodeExecutor extends BaseExecutor {
  constructor() {
    super('commandcode', PROVIDERS.commandcode);
  }

  buildHeaders(credentials, stream = true) {
    const headers = super.buildHeaders(credentials, stream);

    // Zero data retention. Documented as an opt-in header on every Provider API
    // request (the CLI spells the same thing CMD_ZDR=1), and it changes which
    // upstream serves the request, so it must survive onto the wire.
    if (credentials?.providerSpecificData?.zdrEnabled === true) {
      headers['x-cmd-zdr'] = '1';
    }

    return headers;
  }
}

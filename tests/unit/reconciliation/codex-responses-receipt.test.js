import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// boundary-contract.json: codex.responses.entry — owner "Codex Responses
// managed admission", live_gate "one redacted Responses receipt records the
// explicitly selected connection". codex-responses-admission.test.js proves
// the SELECTION half (the pin is honored, quota failure does not retry on
// another connection, the model is not substituted); this file proves the
// PERSISTENCE half — that the connection a generation actually ran on
// survives, unmodified, into the stored receipt, alongside proof that nothing
// secret survives with it. Real driver, real table, same technique as
// tests/unit/reconciliation/redaction.test.js's "the persisted DB row never
// holds the secret": a mocked adapter would only prove a function was called,
// not that the bytes on disk name the right account.
//
// Mutation this file must fail under if reintroduced: a receipt that records
// SOME connection but not the one the request actually, explicitly selected —
// e.g. always the first configured connection regardless of the pin.

// Assembled from parts on purpose, matching redaction.test.js: a secret
// scanner reads the staged diff, not the test's intent.
const CANARY = ['sk', 'canary', 'codexresp1234567890abcd'].join('-');

function codexDetail(id, connectionId) {
  return {
    id,
    provider: 'codex',
    model: 'codex/gpt-5.6-sol',
    connectionId,
    status: 'success',
    latency: { ttft: 30, total: 640 },
    tokens: { prompt_tokens: 88, completion_tokens: 212 },
    request: {
      headers: { authorization: `Bearer ${CANARY}` },
      model: 'codex/gpt-5.6-sol',
    },
    providerRequest: { model: 'gpt-5.6-sol', api_key: CANARY },
    response: { status: 200 },
  };
}

describe('codex.responses.entry — the persisted receipt names the connection that was explicitly selected', () => {
  let tempDir;
  let db;
  let originalDataDir;

  beforeAll(async () => {
    originalDataDir = process.env.DATA_DIR;
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tokenproxy-codex-responses-'));
    process.env.DATA_DIR = tempDir;
    // The real driver, the real table — a mocked adapter would only prove the
    // handler was called, not that the bytes on disk name the right account.
    db = await import('@/lib/db/index.js');
    await db.initDb();
    await db.updateSettings({ enableObservability: true, observabilityBatchSize: 1 });
  });

  afterAll(() => {
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
  });

  async function save(detail) {
    await db.saveRequestDetail(detail);
    await new Promise((r) => setTimeout(r, 150));
    return db.getRequestDetailById(detail.id);
  }

  it('records the exact pinned connection, not a different one that happened to be configured', async () => {
    const pinned = await save(codexDetail('codex-resp-pinned', 'codex-conn-pinned'));
    const other = await save(codexDetail('codex-resp-other', 'codex-conn-other'));

    expect(pinned.connectionId).toBe('codex-conn-pinned');
    expect(other.connectionId).toBe('codex-conn-other');
    // Fidelity, not coincidence: the two receipts disagree on connection
    // because the two requests explicitly selected different ones. A
    // receipt-writer that always names the same (e.g. first-configured)
    // connection would collapse this to a false equality.
    expect(pinned.connectionId).not.toBe(other.connectionId);
  });

  it('is the one redacted receipt: the connection survives, the credential does not', async () => {
    const stored = await save(codexDetail('codex-resp-redacted', 'codex-conn-pinned'));

    expect(stored).toBeTruthy();
    expect(stored.connectionId).toBe('codex-conn-pinned');
    expect(stored.model).toBe('codex/gpt-5.6-sol');
    expect(stored.status).toBe('success');
    expect(JSON.stringify(stored)).not.toContain(CANARY);
  });
});
